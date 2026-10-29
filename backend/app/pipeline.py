"""
The 6-Stage Printability Analysis Pipeline for ProxyPrint Lab:
1. Preparation & MTG Geometry Masking (3mm Bleed Check & Full-Card vs. Art-Crop Mode)
2. Resolution & Sharpness (Anti-Upscale Laplacian Edge Variance & 2D FFT High-Frequency Ratio)
3. Shadow Detail Retention (CIELAB L* < 15 Crush Zone & 11x11 Sliding Window Local StdDev)
4. Local Contrast (CLAHE-style 8x8 Grid RMS Contrast)
5. Color Gamut & Output Simulation (Synthetic Profiles + Pixel-Wise ΔE_2000)
6. Bottleneck Scoring Algorithm: Q_final = min(Q_weighted, min(R, S, C) + 15)
"""

import base64
import io
from typing import Dict, Any, Optional
import cv2
import numpy as np
from PIL import Image

from .constants import CARD_STANDARDS, PRINTER_PROFILES
from .color_science import (
    srgb_to_lab,
    delta_e_cie2000,
    apply_user_adjustments,
    simulate_printer_output,
    generate_printer_3d_lut,
)


def compute_fft_high_freq_ratio(gray_img: np.ndarray) -> float:
    """
    Compute the 2D Fast Fourier Transform (FFT) high-frequency energy ratio
    on the artwork region to detect bicubic/AI upscales that have high pixel counts
    but lack authentic optical high-frequency detail.
    Returns a normalized factor in [0.35, 1.0].
    """
    h, w = gray_img.shape
    f_transform = np.fft.fft2(gray_img.astype(np.float32))
    f_shift = np.fft.fftshift(f_transform)
    magnitude = np.log1p(np.abs(f_shift))

    cy, cx = h // 2, w // 2
    y_idx, x_idx = np.ogrid[:h, :w]
    dist = np.hypot(x_idx - cx, y_idx - cy)
    max_radius = np.hypot(cx, cy)

    # High frequencies lie outside 22% of the Nyquist radius
    hf_mask = dist > (0.22 * max_radius)
    total_energy = np.sum(magnitude) + 1e-6
    hf_energy = np.sum(magnitude[hf_mask])
    hf_ratio = float(hf_energy / total_energy)

    # Normalize typical sharp artwork (~0.72-0.82 ratio) to [0.38, 1.0]
    norm_fft = float(np.clip((hf_ratio - 0.58) / 0.20, 0.38, 1.0))
    return norm_fft


def compute_sliding_window_std_11x11(L_channel: np.ndarray) -> np.ndarray:
    """
    Compute local standard deviation within an 11x11 sliding window across the CIELAB L*
    channel using fast box-filter integral images:
      std = sqrt(max(0, E[L^2] - (E[L])^2))
    Distinguishes between a muddy, detail-less swamp (low gradient) and a crisp night scene.
    """
    L_f32 = L_channel.astype(np.float32)
    mean_L = cv2.boxFilter(L_f32, ddepth=-1, ksize=(11, 11), borderType=cv2.BORDER_REFLECT)
    mean_L2 = cv2.boxFilter(
        L_f32 * L_f32, ddepth=-1, ksize=(11, 11), borderType=cv2.BORDER_REFLECT
    )
    variance = np.maximum(0.0, mean_L2 - mean_L * mean_L)
    return np.sqrt(variance)


def evaluate_color_and_tones(
    work_rgb: np.ndarray,
    has_3mm_bleed: bool,
    input_mode: str,
    printer_profile: Dict[str, Any],
    resolution_score: int,
    adj: Dict[str, float],
    build_visual_buffers: bool = False,
) -> Dict[str, Any]:
    """
    Execute Stages 3, 4, 5, and 6 on the analysis buffer for a given adjustment state.
    """
    an_h, an_w, _ = work_rgb.shape
    total_pixels = an_w * an_h

    bleed_offset_x = an_w * (3.0 / 69.0) if has_3mm_bleed else 0.0
    bleed_offset_y = an_h * (3.0 / 94.0) if has_3mm_bleed else 0.0
    trim_span_w = an_w - bleed_offset_x * 2.0
    trim_span_h = an_h - bleed_offset_y * 2.0

    mask_x0 = int(np.floor(bleed_offset_x + trim_span_w * 0.078))
    mask_x1 = int(np.ceil(bleed_offset_x + trim_span_w * 0.922))
    mask_y0 = int(np.floor(bleed_offset_y + trim_span_h * 0.112))
    mask_y1 = int(np.ceil(bleed_offset_y + trim_span_h * 0.547))

    if input_mode == "artwork_only":
        in_art_mask = np.ones((an_h, an_w), dtype=bool)
    else:
        in_art_mask = np.zeros((an_h, an_w), dtype=bool)
        in_art_mask[mask_y0 : mask_y1 + 1, mask_x0 : mask_x1 + 1] = True

    mask_pixel_count = int(np.sum(in_art_mask))
    norm_count = max(1, mask_pixel_count)

    # Apply user adjustments ONLY inside the analyzed region (so in 'full_card' Art-Box mode,
    # the black card border and text box are untouched and only the Art Analysis Region is changed)
    if input_mode == "artwork_only":
        adj_rgb = apply_user_adjustments(work_rgb, adj)
    else:
        adj_rgb = work_rgb.copy()
        adj_rgb[mask_y0 : mask_y1 + 1, mask_x0 : mask_x1 + 1] = apply_user_adjustments(
            work_rgb[mask_y0 : mask_y1 + 1, mask_x0 : mask_x1 + 1], adj
        )
    L_adj, a_adj, b_adj = srgb_to_lab(adj_rgb)

    sim_rgb = simulate_printer_output(adj_rgb, printer_profile)
    L_sim, a_sim, b_sim = srgb_to_lab(sim_rgb)

    # Stage 5: Pixel-wise ΔE_2000 between adjusted sRGB and soft-proofed cardstock output
    delta_e_arr = delta_e_cie2000(L_adj, a_adj, b_adj, L_sim, a_sim, b_sim)

    masked_L_adj = L_adj[in_art_mask]
    masked_L_sim = L_sim[in_art_mask]
    masked_de = delta_e_arr[in_art_mask]

    # Histograms (50 bins for L* 0..100)
    hist_orig, _ = np.histogram(np.clip(masked_L_adj, 0.0, 99.99), bins=50, range=(0.0, 100.0))
    hist_sim, _ = np.histogram(np.clip(masked_L_sim, 0.0, 99.99), bins=50, range=(0.0, 100.0))

    pct_under_5 = float(np.sum(masked_L_adj < 5.0) / norm_count * 100.0)
    pct_under_10 = float(np.sum(masked_L_adj < 10.0) / norm_count * 100.0)
    pct_under_15 = float(np.sum(masked_L_adj < 15.0) / norm_count * 100.0)
    pct_under_20 = float(np.sum(masked_L_adj < 20.0) / norm_count * 100.0)
    pct_over_95 = float(np.sum(masked_L_adj > 95.0) / norm_count * 100.0)

    mean_delta_e = float(np.mean(masked_de))
    pct_high_delta_e = float(np.sum(masked_de > 6.5) / norm_count * 100.0)

    # Stage 3: Shadow Detail Retention using 11x11 sliding window standard deviation
    std_orig_11x11 = compute_sliding_window_std_11x11(L_adj)
    std_sim_11x11 = compute_sliding_window_std_11x11(L_sim)

    black_floor_l = float(printer_profile["black_floor_l"])
    shadow_zone = in_art_mask & (L_adj < 25.0)
    shadow_pixels_count = int(np.sum(shadow_zone))

    retention_map = np.where(
        std_orig_11x11 > 0.35, std_sim_11x11 / np.maximum(std_orig_11x11, 1e-5), 0.4
    )

    high_risk_cond = shadow_zone & (
        (L_adj < black_floor_l * 0.9)
        | ((L_adj < 18.0) & (retention_map < 0.48))
        | (std_sim_11x11 < 0.65)
    )
    mod_risk_cond = (
        shadow_zone
        & (~high_risk_cond)
        & (L_adj < 22.0)
        & ((retention_map < 0.72) | (std_sim_11x11 < 1.35))
    )
    safe_shadow_cond = shadow_zone & (~high_risk_cond) & (~mod_risk_cond)

    crushed_shadow_pixels = int(np.sum(high_risk_cond))
    orig_shadow_grad_sum = float(np.sum(std_orig_11x11[shadow_zone])) if shadow_pixels_count > 0 else 0.0
    sim_shadow_grad_sum = float(np.sum(std_sim_11x11[shadow_zone])) if shadow_pixels_count > 0 else 0.0

    shadow_ratio = shadow_pixels_count / norm_count
    crushed_ratio_in_shadows = (
        crushed_shadow_pixels / shadow_pixels_count if shadow_pixels_count > 0 else 0.0
    )
    crushed_ratio_total = crushed_shadow_pixels / norm_count
    mean_sim_shadow_grad = (
        sim_shadow_grad_sum / shadow_pixels_count if shadow_pixels_count > 0 else 2.5
    )

    shadow_score = 96
    if shadow_ratio > 0.03:
        crush_penalty = crushed_ratio_total * 145.0 + crushed_ratio_in_shadows * 38.0
        mud_penalty = max(0.0, (1.6 - mean_sim_shadow_grad) * 18.0)
        shadow_score = int(round(max(12.0, min(98.0, 98.0 - crush_penalty - mud_penalty))))

    # Stage 4: Local Contrast (8x8 CLAHE-style Grid RMS Contrast)
    grid_n = 8
    patch_contrast_grid = []
    low_contrast_patches = 0
    valid_patches = 0
    rms_contrast_sum = 0.0

    for gy in range(grid_n):
        row = []
        py0 = int(np.floor((gy / grid_n) * an_h))
        py1 = int(np.floor(((gy + 1) / grid_n) * an_h))
        for gx in range(grid_n):
            px0 = int(np.floor((gx / grid_n) * an_w))
            px1 = int(np.floor(((gx + 1) / grid_n) * an_w))

            patch_mask = in_art_mask[py0:py1, px0:px1]
            count = int(np.sum(patch_mask))
            if count > 10:
                patch_vals = L_sim[py0:py1, px0:px1][patch_mask]
                mean_val = float(np.mean(patch_vals))
                rms_val = float(np.std(patch_vals))
                row.append({"rms": round(rms_val, 2), "mean": round(mean_val, 2), "active": True})
                valid_patches += 1
                rms_contrast_sum += rms_val
                if rms_val < 4.2:
                    low_contrast_patches += 1
            else:
                row.append({"rms": 0.0, "mean": 0.0, "active": False})
        patch_contrast_grid.append(row)

    avg_patch_rms = rms_contrast_sum / max(1, valid_patches)
    low_contrast_patch_ratio = low_contrast_patches / max(1, valid_patches)

    contrast_score = int(
        round(
            max(
                20.0,
                min(98.0, 55.0 + avg_patch_rms * 3.4 - low_contrast_patch_ratio * 42.0),
            )
        )
    )
    highlight_score = int(round(max(25.0, min(99.0, 97.0 - pct_over_95 * 3.2))))
    color_score = int(
        round(
            max(
                18.0,
                min(
                    98.0,
                    100.0 - max(0.0, mean_delta_e - 2.2) * 3.2 - pct_high_delta_e * 0.62,
                ),
            )
        )
    )

    # Stage 6: Bottleneck Scoring Algorithm
    # Q_final = min(Q_weighted, min(R, S, C) + 15)
    q_weighted = (
        0.20 * resolution_score
        + 0.35 * shadow_score
        + 0.10 * highlight_score
        + 0.15 * contrast_score
        + 0.20 * color_score
    )
    min_critical = min(resolution_score, shadow_score, contrast_score)
    q_final = int(round(min(q_weighted, min_critical + 15.0)))
    is_bottleneck_capped = (min_critical + 15.0) < (q_weighted - 0.5)

    if min_critical == shadow_score:
        bottleneck_metric = "Shadow Detail"
    elif min_critical == resolution_score:
        bottleneck_metric = "Resolution"
    else:
        bottleneck_metric = "Contrast"

    visual_maps = None
    if build_visual_buffers:
        shadow_risk_map = np.zeros((an_h, an_w), dtype=np.uint8)
        shadow_risk_map[safe_shadow_cond] = 1
        shadow_risk_map[mod_risk_cond] = 2
        shadow_risk_map[high_risk_cond] = 3

        visual_maps = {
            "anW": an_w,
            "anH": an_h,
            "shadowRiskMap": shadow_risk_map.flatten().tolist(),
            "deltaEArr": np.round(delta_e_arr.flatten(), 2).tolist(),
            "inArtMask": in_art_mask.astype(np.uint8).flatten().tolist(),
            "patchContrastGrid": patch_contrast_grid,
            "artBoxNorm": {
                "x": round(mask_x0 / an_w, 4),
                "y": round(mask_y0 / an_h, 4),
                "w": round((mask_x1 - mask_x0) / an_w, 4),
                "h": round((mask_y1 - mask_y0) / an_h, 4),
            },
        }

    return {
        "scores": {
            "overall": q_final,
            "weightedRaw": int(round(q_weighted)),
            "isBottleneckCapped": bool(is_bottleneck_capped),
            "bottleneckMetric": bottleneck_metric,
            "resolution": resolution_score,
            "shadow": shadow_score,
            "highlight": highlight_score,
            "contrast": contrast_score,
            "color": color_score,
        },
        "metrics": {
            "pctUnder5": f"{pct_under_5:.1f}",
            "pctUnder10": f"{pct_under_10:.1f}",
            "pctUnder15": f"{pct_under_15:.1f}",
            "pctUnder20": f"{pct_under_20:.1f}",
            "pctOver95": f"{pct_over_95:.1f}",
            "crushedShadowPct": f"{(crushed_ratio_total * 100.0):.1f}",
            "shadowRetentionPct": int(
                round(min(100.0, (sim_shadow_grad_sum / max(0.1, orig_shadow_grad_sum)) * 100.0))
            ),
            "meanDeltaE": f"{mean_delta_e:.1f}",
            "pctHighDeltaE": f"{pct_high_delta_e:.1f}",
            "avgPatchRms": f"{avg_patch_rms:.1f}",
            "lowContrastPatches": low_contrast_patches,
        },
        "histograms": {
            "original": hist_orig.astype(int).tolist(),
            "simulated": hist_sim.astype(int).tolist(),
        },
        "visualMaps": visual_maps,
    }


def optimize_adjustments_coordinate_search(
    work_rgb: np.ndarray,
    has_3mm_bleed: bool,
    input_mode: str,
    printer_profile: Dict[str, Any],
    resolution_score: int,
) -> Dict[str, float]:
    """
    Coarse-to-Fine Coordinate Pattern Search (Hooke-Jeeves) with Tikhonov Regularization.
    Evaluates on a stride-4 subsampled 60x82 grid to find the 5D adjustment vector
    θ = (shadowLift, gamma, brightness, contrast, saturation) that maximizes
    Q_final + 0.35 * Q_weighted - λ ||θ - θ_0||^2.
    """
    sub_rgb = work_rgb[1::4, 1::4]
    sub_h, sub_w, _ = sub_rgb.shape
    L_sub, _, _ = srgb_to_lab(sub_rgb)

    if input_mode == "artwork_only":
        art_L = L_sub
    else:
        bx = sub_w * (3.0 / 69.0) if has_3mm_bleed else 0.0
        by = sub_h * (3.0 / 94.0) if has_3mm_bleed else 0.0
        tw = sub_w - bx * 2.0
        th = sub_h - by * 2.0
        mx0, mx1 = int(bx + tw * 0.078), int(bx + tw * 0.922)
        my0, my1 = int(by + th * 0.112), int(by + th * 0.547)
        art_L = L_sub[my0 : my1 + 1, mx0 : mx1 + 1]

    p10_l = float(np.percentile(art_L, 10))
    p25_l = float(np.percentile(art_L, 25))
    p90_l = float(np.percentile(art_L, 90))

    def clamp_params(p: Dict[str, float]) -> Dict[str, float]:
        return {
            "shadowLift": float(np.clip(round(p["shadowLift"]), 0, 75)),
            "gamma": float(np.clip(round(p["gamma"], 2), 0.82, 1.38)),
            "brightness": float(np.clip(round(p["brightness"]), -18, 18)),
            "contrast": float(np.clip(round(p["contrast"]), -20, 32)),
            "saturation": float(np.clip(round(p["saturation"]), -28, 25)),
            "sharpen": float(np.clip(round(p.get("sharpen", 0.0)), 0, 80)),
        }

    def eval_obj(adj: Dict[str, float]) -> float:
        res = evaluate_color_and_tones(
            work_rgb=sub_rgb,
            has_3mm_bleed=has_3mm_bleed,
            input_mode=input_mode,
            printer_profile=printer_profile,
            resolution_score=resolution_score,
            adj=adj,
            build_visual_buffers=False,
        )
        sc = res["scores"]
        reg = (
            0.0012 * (adj["shadowLift"] ** 2)
            + 8.5 * ((adj["gamma"] - 1.0) ** 2)
            + 0.0035 * (adj["contrast"] ** 2)
            + 0.012 * (adj["brightness"] ** 2)
            + 0.003 * (adj["saturation"] ** 2)
        )
        return (
            sc["overall"]
            + 0.35 * sc["weightedRaw"]
            + 0.15 * sc["shadow"]
            + 0.10 * sc["contrast"]
            + 0.10 * sc["color"]
            - reg
        )

    adaptive_lift = max(
        0.0, min(68.0, round((float(printer_profile["black_floor_l"]) + 8.0 - p10_l) * 2.8))
    )
    adaptive_gamma = 1.12 if p25_l < 22.0 else (0.94 if p25_l > 55.0 else 1.04)
    adaptive_contrast = 12.0 if (p90_l - p10_l) < 45.0 else 6.0
    adaptive_sharpen = 42.0 if resolution_score < 72 else (22.0 if resolution_score < 85 else 0.0)

    seeds = [
        {"shadowLift": 0.0, "gamma": 1.0, "brightness": 0.0, "contrast": 0.0, "saturation": 0.0, "sharpen": adaptive_sharpen},
        clamp_params(
            {
                "shadowLift": adaptive_lift,
                "gamma": adaptive_gamma,
                "brightness": 0.0,
                "contrast": adaptive_contrast,
                "saturation": 0.0,
                "sharpen": adaptive_sharpen,
            }
        ),
        clamp_params(
            {
                "shadowLift": float(printer_profile["recommended_toe_lift"]),
                "gamma": 1.08,
                "brightness": 0.0,
                "contrast": 8.0,
                "saturation": -6.0,
                "sharpen": adaptive_sharpen,
            }
        ),
    ]

    best_params = seeds[0]
    best_obj = eval_obj(best_params)
    for seed in seeds[1:]:
        s = eval_obj(seed)
        if s > best_obj:
            best_obj = s
            best_params = dict(seed)

    step_schedule = [
        {"shadowLift": 12.0, "contrast": 6.0, "gamma": 0.06, "saturation": 6.0, "brightness": 4.0},
        {"shadowLift": 4.0, "contrast": 3.0, "gamma": 0.02, "saturation": 3.0, "brightness": 2.0},
        {"shadowLift": 2.0, "contrast": 1.0, "gamma": 0.01, "saturation": 1.0, "brightness": 1.0},
    ]
    keys = ["shadowLift", "contrast", "gamma", "saturation", "brightness"]

    for steps in step_schedule:
        improved = True
        it = 0
        while improved and it < 3:
            improved = False
            it += 1
            for k in keys:
                delta = steps[k]
                best_dir_score = best_obj
                best_cand = best_params
                for d in (1.0, -1.0):
                    cand = clamp_params({**best_params, k: best_params[k] + d * delta})
                    if cand[k] == best_params[k]:
                        continue
                    score = eval_obj(cand)
                    if score > best_dir_score + 1e-4:
                        best_dir_score = score
                        best_cand = cand
                if best_cand is not best_params:
                    best_params = best_cand
                    best_obj = best_dir_score
                    improved = True

    return best_params


def run_full_backend_pipeline(
    image_bytes: bytes,
    input_mode: str = "full_card",
    card_standard_id: str = "mpc_bleed",
    printer_profile_id: str = "mpc_commercial",
    adjustments: Optional[Dict[str, float]] = None,
    pad_mpc_bleed: bool = False,
) -> Dict[str, Any]:
    """
    Execute the complete 6-Stage Heavy Analysis Pipeline on an uploaded image:
      - Computes full-resolution Laplacian & 2D FFT sharpness metrics
      - Computes CIELAB 11x11 shadow retention & ΔE_2000 color gamut shifts
      - Generates a downscaled working image and 3D LUT for the 60 FPS frontend simulator
    """
    if adjustments is None:
        adjustments = {
            "shadowLift": 0.0,
            "gamma": 1.0,
            "brightness": 0.0,
            "contrast": 0.0,
            "saturation": 0.0,
        }

    card_standard = CARD_STANDARDS.get(card_standard_id, CARD_STANDARDS["mpc_bleed"])
    printer_profile = PRINTER_PROFILES.get(printer_profile_id, PRINTER_PROFILES["mpc_commercial"])

    pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    raw_rgb = np.array(pil_img, dtype=np.uint8)
    raw_h, raw_w, _ = raw_rgb.shape

    bleed_factor_x = 69.0 / 63.0 if pad_mpc_bleed else 1.0
    bleed_factor_y = 94.0 / 88.0 if pad_mpc_bleed else 1.0
    effective_w = int(round(raw_w * bleed_factor_x))
    effective_h = int(round(raw_h * bleed_factor_y))

    # Build 240x330 working analysis image
    an_w, an_h = 240, 330
    work_rgb = np.full((an_h, an_w, 3), [7, 7, 9], dtype=np.uint8)
    pad_x = int(round(an_w * (3.0 / 69.0))) if pad_mpc_bleed else 0
    pad_y = int(round(an_h * (3.0 / 94.0))) if pad_mpc_bleed else 0
    inner_w = an_w - pad_x * 2
    inner_h = an_h - pad_y * 2

    resized_inner = cv2.resize(raw_rgb, (inner_w, inner_h), interpolation=cv2.INTER_AREA)
    work_rgb[pad_y : pad_y + inner_h, pad_x : pad_x + inner_w] = resized_inner

    # Stage 1 & 2: Resolution, Bleed Check, Laplacian Edge Variance & 2D FFT Sharpness
    ppi_x = effective_w / float(card_standard["width_in"])
    ppi_y = effective_h / float(card_standard["height_in"])
    nominal_ppi = int(round(min(ppi_x, ppi_y)))

    actual_aspect = effective_w / max(1.0, float(effective_h))
    std_aspect = float(card_standard["aspect_ratio"])
    aspect_diff_pct = (abs(actual_aspect - std_aspect) / std_aspect) * 100.0

    # Outer 3mm bleed border vs. inner 3mm black frame border check:
    # A standard 63x88mm trim card already has a ~3mm black border, so checking only
    # the outer 3mm ring falsely flags trim cards as having 3mm bleed and shrinks the Art Box!
    # A card with true 3mm bleed has ~6mm of dark border (3mm bleed + 3mm frame border).
    edge_band_x = max(4, int(round(an_w * (3.0 / 69.0))))
    edge_band_y = max(4, int(round(an_h * (3.0 / 94.0))))
    inner_band_x = max(8, int(round(an_w * (5.5 / 69.0))))
    inner_band_y = max(8, int(round(an_h * (5.5 / 94.0))))
    L_work, _, _ = srgb_to_lab(work_rgb)

    edge_mask = np.zeros((an_h, an_w), dtype=bool)
    edge_mask[:edge_band_y, :] = True
    edge_mask[an_h - edge_band_y :, :] = True
    edge_mask[:, :edge_band_x] = True
    edge_mask[:, an_w - edge_band_x :] = True

    inner_ring_mask = np.zeros((an_h, an_w), dtype=bool)
    inner_ring_mask[:inner_band_y, :] = True
    inner_ring_mask[an_h - inner_band_y :, :] = True
    inner_ring_mask[:, :inner_band_x] = True
    inner_ring_mask[:, an_w - inner_band_x :] = True
    inner_ring_mask = inner_ring_mask & (~edge_mask)

    outer_border_dark_ratio = float(np.sum(L_work[edge_mask] < 14.0) / max(1, np.sum(edge_mask)))
    inner_ring_dark_ratio = float(
        np.sum(L_work[inner_ring_mask] < 14.0) / max(1, np.sum(inner_ring_mask))
    )
    is_mpc_aspect = abs(actual_aspect - (69.0 / 94.0)) < abs(actual_aspect - (63.0 / 88.0))

    has_3mm_bleed = bool(
        pad_mpc_bleed
        or (outer_border_dark_ratio > 0.85 and inner_ring_dark_ratio > 0.72)
        or (is_mpc_aspect and effective_w >= 800 and effective_h >= 1090 and outer_border_dark_ratio > 0.75)
    )

    # Full/High-Res Laplacian + 2D FFT High-Frequency Sharpness Check aligned with Art Box
    sharp_w = min(480, raw_w)
    sharp_h = min(660, raw_h)
    sharp_rgb = cv2.resize(raw_rgb, (sharp_w, sharp_h), interpolation=cv2.INTER_AREA)
    gray = (
        0.299 * sharp_rgb[..., 0].astype(np.float32)
        + 0.587 * sharp_rgb[..., 1].astype(np.float32)
        + 0.114 * sharp_rgb[..., 2].astype(np.float32)
    )

    sharp_bleed_x = sharp_w * (3.0 / 69.0) if has_3mm_bleed else 0.0
    sharp_bleed_y = sharp_h * (3.0 / 94.0) if has_3mm_bleed else 0.0
    sharp_trim_w = sharp_w - sharp_bleed_x * 2.0
    sharp_trim_h = sharp_h - sharp_bleed_y * 2.0

    x_start = max(0, int(np.floor(sharp_bleed_x + sharp_trim_w * 0.078)))
    x_end = min(sharp_w, int(np.ceil(sharp_bleed_x + sharp_trim_w * 0.922)))
    y_start = max(0, int(np.floor(sharp_bleed_y + sharp_trim_h * 0.112)))
    y_end = min(sharp_h, int(np.ceil(sharp_bleed_y + sharp_trim_h * 0.547)))
    art_gray = gray[y_start:y_end, x_start:x_end]

    lap = cv2.Laplacian(art_gray, cv2.CV_32F, ksize=1)
    lap_variance = float(np.var(lap))
    lap_factor = float(np.clip(np.sqrt(lap_variance) / 19.5, 0.38, 1.0))

    fft_factor = compute_fft_high_freq_ratio(art_gray)
    optical_sharpness_factor = float(0.65 * lap_factor + 0.35 * fft_factor)

    effective_optical_ppi = int(round(nominal_ppi * optical_sharpness_factor))
    is_likely_upscaled = bool(nominal_ppi >= 250 and optical_sharpness_factor < 0.68)

    resolution_score = int(min(100, round((effective_optical_ppi / 300.0) * 95.0 + 5.0)))
    if card_standard["requires_bleed"] and not has_3mm_bleed:
        resolution_score = max(25, resolution_score - 22)
    if aspect_diff_pct > 3.5:
        resolution_score = max(20, resolution_score - 12)

    baseline_result = evaluate_color_and_tones(
        work_rgb=work_rgb,
        has_3mm_bleed=has_3mm_bleed,
        input_mode=input_mode,
        printer_profile=printer_profile,
        resolution_score=resolution_score,
        adj={"shadowLift": 0.0, "gamma": 1.0, "brightness": 0.0, "contrast": 0.0, "saturation": 0.0},
        build_visual_buffers=False,
    )

    current_result = evaluate_color_and_tones(
        work_rgb=work_rgb,
        has_3mm_bleed=has_3mm_bleed,
        input_mode=input_mode,
        printer_profile=printer_profile,
        resolution_score=resolution_score,
        adj=adjustments,
        build_visual_buffers=True,
    )

    # Encode downscaled working preview image (360x490) for fast frontend rendering
    disp_w, disp_h = 360, 490
    disp_rgb = cv2.resize(raw_rgb, (disp_w, disp_h), interpolation=cv2.INTER_AREA)
    disp_pil = Image.fromarray(disp_rgb)
    buf = io.BytesIO()
    disp_pil.save(buf, format="PNG")
    working_image_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

    lut_3d = generate_printer_3d_lut(printer_profile, grid_size=17)
    recommended_adjustments = optimize_adjustments_coordinate_search(
        work_rgb=work_rgb,
        has_3mm_bleed=has_3mm_bleed,
        input_mode=input_mode,
        printer_profile=printer_profile,
        resolution_score=resolution_score,
    )

    return {
        "engine": "fastapi-opencv-cielab-v1",
        "geometry": {
            "rawW": raw_w,
            "rawH": raw_h,
            "effectiveW": effective_w,
            "effectiveH": effective_h,
            "nominalPpi": nominal_ppi,
            "effectiveOpticalPpi": effective_optical_ppi,
            "opticalSharpnessFactor": int(round(optical_sharpness_factor * 100)),
            "fftSharpnessRatio": int(round(fft_factor * 100)),
            "isLikelyUpscaled": is_likely_upscaled,
            "has3mmBleed": has_3mm_bleed,
            "aspectDiffPct": f"{aspect_diff_pct:.1f}",
        },
        "baseline": baseline_result,
        "current": current_result,
        "recommendedAdjustments": recommended_adjustments,
        "workingImageDataUrl": working_image_b64,
        "printerLut3D": lut_3d,
    }
