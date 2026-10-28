"""Card Geometry Standards & Synthetic Printer/Cardstock Profiles."""

from typing import Dict, Any

CARD_STANDARDS: Dict[str, Dict[str, Any]] = {
    "mpc_bleed": {
        "id": "mpc_bleed",
        "name": "MPC Commercial Bleed (69 × 94 mm)",
        "subtitle": "63×88mm Trim + 3mm Bleed on all sides",
        "width_mm": 69.0,
        "height_mm": 94.0,
        "width_in": 69.0 / 25.4,
        "height_in": 94.0 / 25.4,
        "ideal_px_w": 816,
        "ideal_px_h": 1110,
        "requires_bleed": True,
        "aspect_ratio": 69.0 / 94.0,
    },
    "tcg_trim": {
        "id": "tcg_trim",
        "name": "Standard MTG / TCG Trim (63 × 88 mm)",
        "subtitle": "Exact cut size (No bleed margin)",
        "width_mm": 63.0,
        "height_mm": 88.0,
        "width_in": 63.0 / 25.4,
        "height_in": 88.0 / 25.4,
        "ideal_px_w": 744,
        "ideal_px_h": 1039,
        "requires_bleed": False,
        "aspect_ratio": 63.0 / 88.0,
    },
    "poker_trim": {
        "id": "poker_trim",
        "name": "Poker Card Size (2.5 × 3.5 in)",
        "subtitle": "63.5×88.9mm standard US poker size",
        "width_mm": 63.5,
        "height_mm": 88.9,
        "width_in": 2.5,
        "height_in": 3.5,
        "ideal_px_w": 750,
        "ideal_px_h": 1050,
        "requires_bleed": False,
        "aspect_ratio": 2.5 / 3.5,
    },
}

PRINTER_PROFILES: Dict[str, Dict[str, Any]] = {
    "mpc_commercial": {
        "id": "mpc_commercial",
        "name": "Commercial Cardstock (MPC S30/S33 / PrintingProxies)",
        "badge": "Offset / Indigo CMYK",
        "description": (
            "Simulates 300–330gsm coated cardstock (GRACoL/FOGRA39 CMYK conversion) "
            "with a 12% dot-gain shadow crush below L*=18 and neon gamut clamping."
        ),
        "black_floor_l": 9.5,
        "paper_white_l": 95.5,
        "shadow_crush_threshold": 22.0,
        "shadow_crush_strength": 0.58,
        "saturation_multiplier": 0.90,
        "gamut_clamp_strength": 0.72,
        "recommended_toe_lift": 38,
    },
    "home_matte": {
        "id": "home_matte",
        "name": "Home Inkjet — Matte Cardstock (Unlaminated)",
        "badge": "High Dot Gain / Elevated Black",
        "description": (
            "Simulates absorbent matte photo paper where black ink spreads into fibers "
            "(L*_min = 16.0), causing all dark tones below L*=18 to merge into flat charcoal gray."
        ),
        "black_floor_l": 16.0,
        "paper_white_l": 93.0,
        "shadow_crush_threshold": 26.0,
        "shadow_crush_strength": 0.45,
        "saturation_multiplier": 0.82,
        "gamut_clamp_strength": 0.65,
        "recommended_toe_lift": 52,
    },
    "home_glossy": {
        "id": "home_glossy",
        "name": "Home Inkjet — Glossy Photo + Laminate Pouch",
        "badge": "Wide Gamut / Deep Dmax",
        "description": (
            "Simulates dye/pigment inkjet on glossy photo paper with thermal gloss laminate. "
            "Preserves deep blacks (L*_min = 6.0) with mild cyan/magenta gamut compression."
        ),
        "black_floor_l": 6.0,
        "paper_white_l": 97.0,
        "shadow_crush_threshold": 14.0,
        "shadow_crush_strength": 0.78,
        "saturation_multiplier": 0.95,
        "gamut_clamp_strength": 0.85,
        "recommended_toe_lift": 20,
    },
}
