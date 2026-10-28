"""FastAPI server for ProxyPrint Lab Heavy Pre-Press Analysis & Export."""

import io
import json
import zipfile
from typing import List, Optional
import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image

from .constants import CARD_STANDARDS, PRINTER_PROFILES
from .color_science import apply_user_adjustments, generate_printer_3d_lut
from .pipeline import run_full_backend_pipeline

app = FastAPI(
    title="ProxyPrint Lab API",
    description=(
        "6-Stage TCG/MTG Card Printability Analysis & Soft-Proofing Engine "
        "(OpenCV FFT Sharpness, CIELAB 11x11 Shadow Retention, ΔE_2000 & 3D LUTs)"
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check():
    """Health check endpoint reporting available profiles and engine status."""
    return {
        "status": "ok",
        "engine": "fastapi-opencv-cielab-v1",
        "profiles": list(PRINTER_PROFILES.keys()),
        "standards": list(CARD_STANDARDS.keys()),
    }


@app.get("/api/profiles")
def get_profiles():
    """Return all built-in card geometry standards, synthetic printer profiles, and 3D LUTs."""
    luts = {
        pid: generate_printer_3d_lut(prof, grid_size=17)
        for pid, prof in PRINTER_PROFILES.items()
    }
    return {
        "cardStandards": CARD_STANDARDS,
        "printerProfiles": PRINTER_PROFILES,
        "printerLuts3D": luts,
    }


@app.post("/api/analyze")
async def analyze_card_image(
    file: UploadFile = File(...),
    input_mode: str = Form("full_card"),
    card_standard_id: str = Form("mpc_bleed"),
    printer_profile_id: str = Form("mpc_commercial"),
    pad_mpc_bleed: bool = Form(False),
    adjustments_json: Optional[str] = Form(None),
):
    """
    Run the 6-Stage Heavy Analysis Pipeline on an uploaded card image.
    Returns baseline scores, current adjusted scores, visual risk maps,
    a downscaled working image for the 60 FPS frontend simulator, and the 3D LUT.
    """
    try:
        image_bytes = await file.read()
        adjustments = None
        if adjustments_json:
            adjustments = json.loads(adjustments_json)

        result = run_full_backend_pipeline(
            image_bytes=image_bytes,
            input_mode=input_mode,
            card_standard_id=card_standard_id,
            printer_profile_id=printer_profile_id,
            adjustments=adjustments,
            pad_mpc_bleed=pad_mpc_bleed,
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Image analysis failed: {str(exc)}") from exc


@app.post("/api/export")
async def export_print_ready_png(
    file: UploadFile = File(...),
    input_mode: str = Form("full_card"),
    pad_mpc_bleed: bool = Form(False),
    adjustments_json: Optional[str] = Form(None),
):
    """
    Generate a full-resolution, color-compensated, print-ready PNG (300 DPI metadata)
    with optional 3mm MPC bleed padding applied.
    In 'full_card' (Art Box Only) mode, only the Art Analysis Region is modified,
    keeping the black card border and text box untouched.
    """
    try:
        image_bytes = await file.read()
        pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        raw_rgb = np.array(pil_img, dtype=np.uint8)
        raw_h, raw_w, _ = raw_rgb.shape

        out_w = int(round(raw_w * (69.0 / 63.0))) if pad_mpc_bleed else raw_w
        out_h = int(round(raw_h * (94.0 / 88.0))) if pad_mpc_bleed else raw_h

        canvas_rgb = np.full((out_h, out_w, 3), [7, 7, 9], dtype=np.uint8)
        px = int(round(out_w * (3.0 / 69.0))) if pad_mpc_bleed else 0
        py = int(round(out_h * (3.0 / 94.0))) if pad_mpc_bleed else 0
        inner_w = out_w - px * 2
        inner_h = out_h - py * 2

        if inner_w != raw_w or inner_h != raw_h:
            inner_rgb = cv2.resize(raw_rgb, (inner_w, inner_h), interpolation=cv2.INTER_LANCZOS4)
        else:
            inner_rgb = raw_rgb

        canvas_rgb[py : py + inner_h, px : px + inner_w] = inner_rgb

        adj = {
            "shadowLift": 0.0,
            "gamma": 1.0,
            "brightness": 0.0,
            "contrast": 0.0,
            "saturation": 0.0,
        }
        if adjustments_json:
            adj.update(json.loads(adjustments_json))

        if input_mode == "artwork_only":
            compensated_rgb = apply_user_adjustments(canvas_rgb, adj)
        else:
            # Detect whether output canvas has 3mm bleed and compute Art Box coordinates
            actual_aspect = out_w / max(1.0, float(out_h))
            is_mpc_aspect = abs(actual_aspect - (69.0 / 94.0)) < abs(actual_aspect - (63.0 / 88.0))
            has_bleed = pad_mpc_bleed or is_mpc_aspect
            bx = out_w * (3.0 / 69.0) if has_bleed else 0.0
            by = out_h * (3.0 / 94.0) if has_bleed else 0.0
            tw = out_w - bx * 2.0
            th = out_h - by * 2.0
            ax0, ax1 = int(np.floor(bx + tw * 0.078)), int(np.ceil(bx + tw * 0.922))
            ay0, ay1 = int(np.floor(by + th * 0.112)), int(np.ceil(by + th * 0.547))

            compensated_rgb = canvas_rgb.copy()
            compensated_rgb[ay0 : ay1 + 1, ax0 : ax1 + 1] = apply_user_adjustments(
                canvas_rgb[ay0 : ay1 + 1, ax0 : ax1 + 1], adj
            )

        out_pil = Image.fromarray(compensated_rgb)

        buf = io.BytesIO()
        out_pil.save(buf, format="PNG", dpi=(300, 300))
        return Response(
            content=buf.getvalue(),
            media_type="image/png",
            headers={
                "Content-Disposition": f'attachment; filename="proxyprint_ready_{out_w}x{out_h}.png"'
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Export failed: {str(exc)}") from exc


@app.post("/api/batch-export-zip")
async def batch_auto_optimize_and_export_zip(
    files: List[UploadFile] = File(...),
    input_mode: str = Form("full_card"),
    card_standard_id: str = Form("mpc_bleed"),
    printer_profile_id: str = Form("mpc_commercial"),
):
    """
    Accept multiple card images, run the 6-Stage Analysis + Coordinate Pattern Search
    auto-optimizer on each image, pad missing 3mm MPC bleed if required by the standard,
    and return a single ZIP archive containing all print-ready 300 DPI PNGs and a
    batch_report.json summary.
    """
    try:
        card_standard = CARD_STANDARDS.get(card_standard_id, CARD_STANDARDS["mpc_bleed"])
        zip_buf = io.BytesIO()
        batch_report = []

        with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_STORED) as zf:
            for idx, upload in enumerate(files):
                img_bytes = await upload.read()
                initial = run_full_backend_pipeline(
                    image_bytes=img_bytes,
                    input_mode=input_mode,
                    card_standard_id=card_standard_id,
                    printer_profile_id=printer_profile_id,
                    pad_mpc_bleed=False,
                )
                should_pad = bool(
                    card_standard["requires_bleed"] and not initial["geometry"]["has3mmBleed"]
                )
                if should_pad:
                    analysis = run_full_backend_pipeline(
                        image_bytes=img_bytes,
                        input_mode=input_mode,
                        card_standard_id=card_standard_id,
                        printer_profile_id=printer_profile_id,
                        pad_mpc_bleed=True,
                    )
                else:
                    analysis = initial

                opt_adj = analysis["recommendedAdjustments"]

                pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                raw_rgb = np.array(pil_img, dtype=np.uint8)
                raw_h, raw_w, _ = raw_rgb.shape

                out_w = int(round(raw_w * (69.0 / 63.0))) if should_pad else raw_w
                out_h = int(round(raw_h * (94.0 / 88.0))) if should_pad else raw_h

                canvas_rgb = np.full((out_h, out_w, 3), [7, 7, 9], dtype=np.uint8)
                px = int(round(out_w * (3.0 / 69.0))) if should_pad else 0
                py = int(round(out_h * (3.0 / 94.0))) if should_pad else 0
                inner_w = out_w - px * 2
                inner_h = out_h - py * 2

                if inner_w != raw_w or inner_h != raw_h:
                    inner_rgb = cv2.resize(
                        raw_rgb, (inner_w, inner_h), interpolation=cv2.INTER_LANCZOS4
                    )
                else:
                    inner_rgb = raw_rgb

                canvas_rgb[py : py + inner_h, px : px + inner_w] = inner_rgb

                if input_mode == "artwork_only":
                    comp_rgb = apply_user_adjustments(canvas_rgb, opt_adj)
                else:
                    has_bleed = bool(analysis["geometry"]["has3mmBleed"] or should_pad)
                    bx = out_w * (3.0 / 69.0) if has_bleed else 0.0
                    by = out_h * (3.0 / 94.0) if has_bleed else 0.0
                    tw = out_w - bx * 2.0
                    th = out_h - by * 2.0
                    ax0, ax1 = int(np.floor(bx + tw * 0.078)), int(np.ceil(bx + tw * 0.922))
                    ay0, ay1 = int(np.floor(by + th * 0.112)), int(np.ceil(by + th * 0.547))

                    comp_rgb = canvas_rgb.copy()
                    comp_rgb[ay0 : ay1 + 1, ax0 : ax1 + 1] = apply_user_adjustments(
                        canvas_rgb[ay0 : ay1 + 1, ax0 : ax1 + 1], opt_adj
                    )

                out_pil = Image.fromarray(comp_rgb)
                png_buf = io.BytesIO()
                out_pil.save(png_buf, format="PNG", dpi=(300, 300))

                base_name = (upload.filename or f"card_{idx + 1}").rsplit(".", 1)[0]
                out_filename = f"{idx + 1:02d}_{base_name}_print_ready_{out_w}x{out_h}.png"
                zf.writestr(out_filename, png_buf.getvalue())

                batch_report.append(
                    {
                        "filename": out_filename,
                        "padded3mmBleed": should_pad,
                        "appliedAdjustments": opt_adj,
                        "baselineScore": initial["baseline"]["scores"]["overall"],
                        "embarrassingBottleneck": initial["baseline"]["scores"]["bottleneckMetric"],
                    }
                )

            zf.writestr("batch_report.json", json.dumps(batch_report, indent=2))

        return Response(
            content=zip_buf.getvalue(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="proxyprint_batch_{printer_profile_id}.zip"'
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Batch ZIP export failed: {str(exc)}") from exc
