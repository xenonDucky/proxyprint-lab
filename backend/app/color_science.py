"""
CIELAB Color Science, CIE Delta E 2000 (ΔE_2000), Soft-Proofing Simulation,
and 3D Look-Up Table (LUT) Generation for ProxyPrint Lab.
"""

from typing import Dict, Any, Tuple
import numpy as np


def srgb_to_lab(rgb_uint8: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Convert an (H, W, 3) uint8 sRGB image array into floating-point CIELAB (L*, a*, b*).
    L* in [0, 100], a* and b* in [-128, 127].
    """
    v = rgb_uint8.astype(np.float32) / 255.0
    linear = np.where(v <= 0.04045, v / 12.92, np.power((v + 0.055) / 1.055, 2.4))

    r, g, b = linear[..., 0], linear[..., 1], linear[..., 2]

    # D65 standard observer XYZ
    x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047
    y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) / 1.00000
    z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883

    def f(t: np.ndarray) -> np.ndarray:
        return np.where(t > 0.008856, np.cbrt(t), 7.787 * t + (16.0 / 116.0))

    fx, fy, fz = f(x), f(y), f(z)
    L = np.clip(116.0 * fy - 16.0, 0.0, 100.0)
    a = 500.0 * (fx - fy)
    b_val = 200.0 * (fy - fz)
    return L, a, b_val


def delta_e_cie2000(
    L1: np.ndarray,
    a1: np.ndarray,
    b1: np.ndarray,
    L2: np.ndarray,
    a2: np.ndarray,
    b2: np.ndarray,
) -> np.ndarray:
    """
    Vectorized CIE Delta E 2000 (ΔE_00) color difference formula.
    Accurately weights perceptual lightness, chroma, and hue rotation differences
    to flag out-of-gamut CMYK shifts in neon greens, cyans, magentas, and deep blues.
    """
    kL, kC, kH = 1.0, 1.0, 1.0

    C1 = np.hypot(a1, b1)
    C2 = np.hypot(a2, b2)
    C_bar = 0.5 * (C1 + C2)

    C_bar7 = np.power(C_bar, 7.0)
    G = 0.5 * (1.0 - np.sqrt(C_bar7 / (C_bar7 + 25.0**7)))

    a1_prime = (1.0 + G) * a1
    a2_prime = (1.0 + G) * a2

    C1_prime = np.hypot(a1_prime, b1)
    C2_prime = np.hypot(a2_prime, b2)

    h1_prime = np.degrees(np.arctan2(b1, a1_prime)) % 360.0
    h2_prime = np.degrees(np.arctan2(b2, a2_prime)) % 360.0

    dL_prime = L2 - L1
    dC_prime = C2_prime - C1_prime

    dh_diff = h2_prime - h1_prime
    dh_prime = np.where(
        (C1_prime * C2_prime) == 0.0,
        0.0,
        np.where(
            np.abs(dh_diff) <= 180.0,
            dh_diff,
            np.where(dh_diff > 180.0, dh_diff - 360.0, dh_diff + 360.0),
        ),
    )

    dH_prime = 2.0 * np.sqrt(C1_prime * C2_prime) * np.sin(np.radians(0.5 * dh_prime))

    L_bar_prime = 0.5 * (L1 + L2)
    C_bar_prime = 0.5 * (C1_prime + C2_prime)

    h_sum = h1_prime + h2_prime
    h_bar_prime = np.where(
        (C1_prime * C2_prime) == 0.0,
        h_sum,
        np.where(
            np.abs(h1_prime - h2_prime) <= 180.0,
            0.5 * h_sum,
            np.where(h_sum < 360.0, 0.5 * (h_sum + 360.0), 0.5 * (h_sum - 360.0)),
        ),
    )

    T = (
        1.0
        - 0.17 * np.cos(np.radians(h_bar_prime - 30.0))
        + 0.24 * np.cos(np.radians(2.0 * h_bar_prime))
        + 0.32 * np.cos(np.radians(3.0 * h_bar_prime + 6.0))
        - 0.20 * np.cos(np.radians(4.0 * h_bar_prime - 63.0))
    )

    d_theta = 30.0 * np.exp(-np.square((h_bar_prime - 275.0) / 25.0))
    C_bar_prime7 = np.power(C_bar_prime, 7.0)
    R_C = 2.0 * np.sqrt(C_bar_prime7 / (C_bar_prime7 + 25.0**7))

    L_term = np.square(L_bar_prime - 50.0)
    S_L = 1.0 + (0.015 * L_term) / np.sqrt(20.0 + L_term)
    S_C = 1.0 + 0.045 * C_bar_prime
    S_H = 1.0 + 0.015 * C_bar_prime * T
    R_T = -np.sin(np.radians(2.0 * d_theta)) * R_C

    term_L = dL_prime / (kL * S_L)
    term_C = dC_prime / (kC * S_C)
    term_H = dH_prime / (kH * S_H)

    de00 = np.sqrt(
        np.maximum(
            0.0,
            np.square(term_L)
            + np.square(term_C)
            + np.square(term_H)
            + R_T * term_C * term_H,
        )
    )
    return de00


def apply_user_adjustments(rgb_uint8: np.ndarray, adj: Dict[str, float]) -> np.ndarray:
    """
    Apply user pre-press adjustments (Shadow Recovery Toe Lift, Gamma, Brightness,
    Contrast, Saturation) to an (..., 3) uint8 RGB image array.
    """
    rf = rgb_uint8[..., 0].astype(np.float32) / 255.0
    gf = rgb_uint8[..., 1].astype(np.float32) / 255.0
    bf = rgb_uint8[..., 2].astype(np.float32) / 255.0

    shadow_lift = float(adj.get("shadowLift", 0.0))
    gamma = float(adj.get("gamma", 1.0))
    brightness = float(adj.get("brightness", 0.0))
    contrast = float(adj.get("contrast", 0.0))
    saturation = float(adj.get("saturation", 0.0))

    if shadow_lift != 0.0:
        lum = 0.2126 * rf + 0.7152 * gf + 0.0722 * bf
        lift_amount = (shadow_lift / 100.0) * 0.26
        shadow_weight = np.power(1.0 - np.minimum(1.0, lum / 0.48), 1.85)
        boost = lift_amount * shadow_weight * (0.35 + 0.65 * np.minimum(1.0, lum * 12.0))
        rf = np.minimum(1.0, rf + boost)
        gf = np.minimum(1.0, gf + boost)
        bf = np.minimum(1.0, bf + boost)

    if gamma != 1.0 and gamma > 0:
        inv_gamma = 1.0 / gamma
        rf = np.power(np.maximum(0.0, rf), inv_gamma)
        gf = np.power(np.maximum(0.0, gf), inv_gamma)
        bf = np.power(np.maximum(0.0, bf), inv_gamma)

    if brightness != 0.0:
        b_offset = (brightness / 100.0) * 0.35
        rf += b_offset
        gf += b_offset
        bf += b_offset

    if contrast != 0.0:
        c_factor = np.power((contrast + 100.0) / 100.0, 1.6)
        rf = (rf - 0.5) * c_factor + 0.5
        gf = (gf - 0.5) * c_factor + 0.5
        bf = (bf - 0.5) * c_factor + 0.5

    if saturation != 0.0:
        s_factor = 1.0 + saturation / 100.0
        luma = 0.2126 * rf + 0.7152 * gf + 0.0722 * bf
        rf = luma + (rf - luma) * s_factor
        gf = luma + (gf - luma) * s_factor
        bf = luma + (bf - luma) * s_factor

    out = np.stack([rf, gf, bf], axis=-1)
    return np.clip(np.round(out * 255.0), 0, 255).astype(np.uint8)


def simulate_printer_output(rgb_uint8: np.ndarray, profile: Dict[str, Any]) -> np.ndarray:
    """
    Simulate how a Synthetic Printer + Cardstock Profile reproduces an sRGB image.
    Models:
      1. Dot-gain shadow crush below shadow_crush_threshold
      2. CMYK out-of-gamut clamping on neon cyans, magentas, electric blues, and neon greens
      3. Physical cardstock paper white ceiling (L*_max) and ink black floor (L*_min / Dmax)
    """
    rf = rgb_uint8[..., 0].astype(np.float32) / 255.0
    gf = rgb_uint8[..., 1].astype(np.float32) / 255.0
    bf = rgb_uint8[..., 2].astype(np.float32) / 255.0

    luma = 0.2126 * rf + 0.7152 * gf + 0.0722 * bf

    crush_norm = float(profile["shadow_crush_threshold"]) / 100.0
    crush_strength = float(profile["shadow_crush_strength"])

    crushed_luma = np.where(
        (luma < crush_norm) & (crush_norm > 0),
        np.power(np.maximum(0.0, luma / crush_norm), 1.0 / crush_strength) * crush_norm,
        luma,
    )
    luma_scale = np.where(luma > 0.001, crushed_luma / np.maximum(luma, 1e-6), 0.0)
    rf *= luma_scale
    gf *= luma_scale
    bf *= luma_scale

    max_c = np.maximum(np.maximum(rf, gf), bf)
    min_c = np.minimum(np.minimum(rf, gf), bf)
    chroma = max_c - min_c

    is_neon_cyan = (gf > 0.55) & (bf > 0.55) & (rf < 0.35)
    is_neon_magenta = (rf > 0.55) & (bf > 0.50) & (gf < 0.35)
    is_electric_blue = (bf > 0.65) & (rf < 0.30) & (gf < 0.40)
    is_neon_green = (gf > 0.65) & (rf < 0.35) & (bf < 0.35)
    is_oog = (chroma > 0.32) & (
        is_neon_cyan | is_neon_magenta | is_electric_blue | is_neon_green
    )

    excess = np.clip((chroma - 0.32) / 0.68, 0.0, 1.0)
    clamp_str = float(profile["gamut_clamp_strength"])
    sat_mult = float(profile["saturation_multiplier"])

    gamut_penalty = np.where(
        is_oog,
        sat_mult * (1.0 - excess * (1.0 - clamp_str) * 0.85),
        sat_mult,
    )

    rf = np.where(is_oog, rf * 0.93, rf)
    gf = np.where(is_oog, gf * 0.92, gf)
    bf = np.where(is_oog, bf * 0.91, bf)

    mid_luma = 0.2126 * rf + 0.7152 * gf + 0.0722 * bf
    rf = mid_luma + (rf - mid_luma) * gamut_penalty
    gf = mid_luma + (gf - mid_luma) * gamut_penalty
    bf = mid_luma + (bf - mid_luma) * gamut_penalty

    black_floor_l = float(profile["black_floor_l"])
    paper_white_l = float(profile["paper_white_l"])

    min_rgb = ((black_floor_l + 16.0) / 116.0) ** 3 * 1.35 + (black_floor_l / 100.0) * 0.22
    max_rgb = paper_white_l / 100.0

    rf = min_rgb + rf * (max_rgb - min_rgb)
    gf = min_rgb + gf * (max_rgb - min_rgb)
    bf = min_rgb + bf * (max_rgb - min_rgb)

    out_r = np.clip(np.round(rf * 255.0), 0, 255).astype(np.uint8)
    out_g = np.clip(np.round(gf * 254.0), 0, 255).astype(np.uint8)
    out_b = np.clip(np.round(bf * 251.0), 0, 255).astype(np.uint8)

    return np.stack([out_r, out_g, out_b], axis=-1)


def generate_printer_3d_lut(profile: Dict[str, Any], grid_size: int = 17) -> Dict[str, Any]:
    """
    Generate a 3D Look-Up Table (grid_size x grid_size x grid_size x 3)
    representing the printer's soft-proofing color transform so the WebGL/Canvas
    frontend can interpolate it at 60 FPS without server round-trips.
    """
    steps = np.linspace(0, 255, grid_size, dtype=np.float32)
    r_grid, g_grid, b_grid = np.meshgrid(steps, steps, steps, indexing="ij")
    rgb_lattice = np.stack([r_grid, g_grid, b_grid], axis=-1).astype(np.uint8)

    sim_lattice = simulate_printer_output(rgb_lattice, profile)
    # Normalize to [0.0, 1.0] or uint8 list for compact JSON transport
    return {
        "profileId": profile["id"],
        "gridSize": grid_size,
        "lutUint8": sim_lattice.flatten().tolist(),
    }
