"""Unit tests for the ProxyPrint Lab 6-Stage Analysis Pipeline and FastAPI endpoints."""

import io
import json
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

from app.main import app
from app.color_science import srgb_to_lab, delta_e_cie2000, generate_printer_3d_lut
from app.constants import PRINTER_PROFILES

client = TestClient(app)


def create_synthetic_test_card(width: int = 816, height: int = 1110, dark_art: bool = True) -> bytes:
    """Create a synthetic MTG card image with black border and dark or bright center art."""
    img = np.full((height, width, 3), [7, 7, 9], dtype=np.uint8)
    # Art box region
    y0, y1 = int(height * 0.11), int(height * 0.55)
    x0, x1 = int(width * 0.08), int(width * 0.92)
    if dark_art:
        # Muddy dark shadow pattern (L* ~ 5..14)
        xv, yv = np.meshgrid(np.arange(x1 - x0), np.arange(y1 - y0))
        pattern = ((xv // 8 + yv // 8) % 2) * 12 + 15
        img[y0:y1, x0:x1, 0] = pattern
        img[y0:y1, x0:x1, 1] = pattern - 3
        img[y0:y1, x0:x1, 2] = pattern + 4
    else:
        # Crisp high-contrast bright pattern
        xv, yv = np.meshgrid(np.arange(x1 - x0), np.arange(y1 - y0))
        pattern = ((xv % 6 < 3) ^ (yv % 6 < 3)) * 160 + 60
        img[y0:y1, x0:x1, 0] = pattern
        img[y0:y1, x0:x1, 1] = np.clip(pattern + 20, 0, 255)
        img[y0:y1, x0:x1, 2] = np.clip(pattern - 20, 0, 255)

    pil_img = Image.fromarray(img)
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    return buf.getvalue()


def test_health_endpoint():
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "mpc_commercial" in data["profiles"]
    assert "vinyl_glossy" in data["profiles"]
    assert "vinyl_matte" in data["profiles"]


def test_cielab_and_delta_e_2000():
    rgb1 = np.array([[[0, 255, 255], [20, 20, 20]]], dtype=np.uint8)
    rgb2 = np.array([[[40, 200, 200], [20, 20, 20]]], dtype=np.uint8)
    L1, a1, b1 = srgb_to_lab(rgb1)
    L2, a2, b2 = srgb_to_lab(rgb2)
    de = delta_e_cie2000(L1, a1, b1, L2, a2, b2)
    assert de.shape == (1, 2)
    assert de[0, 0] > 5.0  # Significant shift on neon cyan
    assert de[0, 1] == 0.0  # Identical dark gray pixel


def test_3d_lut_generation():
    lut = generate_printer_3d_lut(PRINTER_PROFILES["mpc_commercial"], grid_size=9)
    assert lut["gridSize"] == 9
    assert len(lut["lutUint8"]) == 9 * 9 * 9 * 3


def test_analyze_and_bottleneck_scoring():
    card_bytes = create_synthetic_test_card(816, 1110, dark_art=True)
    res = client.post(
        "/api/analyze",
        files={"file": ("dark_card.png", card_bytes, "image/png")},
        data={
            "input_mode": "full_card",
            "card_standard_id": "mpc_bleed",
            "printer_profile_id": "home_matte",
            "pad_mpc_bleed": "false",
            "adjustments_json": json.dumps(
                {"shadowLift": 45, "gamma": 1.12, "brightness": 0, "contrast": 8, "saturation": 0}
            ),
        },
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["geometry"]["has3mmBleed"] is True
    # Lifting shadows should improve the shadow score over the unadjusted baseline
    assert payload["current"]["scores"]["shadow"] >= payload["baseline"]["scores"]["shadow"]
    assert "printerLut3D" in payload
    assert payload["workingImageDataUrl"].startswith("data:image/png;base64,")


def test_batch_auto_optimize_and_export_zip():
    card1 = create_synthetic_test_card(816, 1110, dark_art=True)
    card2 = create_synthetic_test_card(744, 1039, dark_art=False)
    res = client.post(
        "/api/batch-export-zip",
        files=[
            ("files", ("dark_dragon.png", card1, "image/png")),
            ("files", ("bright_relic.png", card2, "image/png")),
        ],
        data={
            "input_mode": "full_card",
            "card_standard_id": "mpc_bleed",
            "printer_profile_id": "mpc_commercial",
        },
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"
    assert res.content[:4] == b"PK\x03\x04"


def test_smart_mtg_sharpening_respects_art_box_only():
    card_bytes = create_synthetic_test_card(816, 1110, dark_art=False)
    res = client.post(
        "/api/export",
        files={"file": ("bright_relic.png", card_bytes, "image/png")},
        data={
            "input_mode": "full_card",
            "pad_mpc_bleed": "false",
            "adjustments_json": json.dumps(
                {"shadowLift": 0, "gamma": 1.0, "brightness": 0, "contrast": 0, "saturation": 0, "sharpen": 60}
            ),
        },
    )
    assert res.status_code == 200
    orig_arr = np.array(Image.open(io.BytesIO(card_bytes)).convert("RGB"))
    out_arr = np.array(Image.open(io.BytesIO(res.content)).convert("RGB"))
    # Text box / bottom border (y = 800..1000) must be 100% untouched in 'full_card' (Art Box Only) mode when textBoxSharpen == 0
    assert np.array_equal(orig_arr[800:1000, :, :], out_arr[800:1000, :, :])
    # Art Box (y = 200..450, x = 150..650) must have increased edge contrast from Unsharp Masking
    assert not np.array_equal(orig_arr[200:450, 150:650, :], out_arr[200:450, 150:650, :])


def test_dual_region_sharpening_and_dpi_benchmarks():
    from app.pipeline import compute_dpi_resolution_score, compute_optimal_region_sharpening

    assert compute_dpi_resolution_score(300) == 75
    assert compute_dpi_resolution_score(600) == 95
    assert compute_dpi_resolution_score(1200) == 100

    ideal = compute_optimal_region_sharpening(600, 600)
    assert ideal["sharpen"] == 0.0
    assert ideal["textBoxSharpen"] == 0.0

    min_dpi = compute_optimal_region_sharpening(300, 300)
    assert min_dpi["sharpen"] == 26.0
    assert min_dpi["textBoxSharpen"] == 14.0
