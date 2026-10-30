import { CardStandard, PrinterProfile, PresetCard } from './types';

export const CARD_STANDARDS: Record<string, CardStandard> = {
  mpc_bleed: {
    id: 'mpc_bleed',
    name: 'MPC Commercial Bleed (69 × 94 mm)',
    subtitle: '63×88mm Trim + 3mm Bleed on all sides',
    widthMm: 69,
    heightMm: 94,
    widthIn: 69 / 25.4,
    heightIn: 94 / 25.4,
    idealPxW: 816,
    idealPxH: 1110,
    requiresBleed: true,
    aspectRatio: 69 / 94
  },
  tcg_trim: {
    id: 'tcg_trim',
    name: 'Standard MTG / TCG Trim (63 × 88 mm)',
    subtitle: 'Exact cut size (No bleed margin)',
    widthMm: 63,
    heightMm: 88,
    widthIn: 63 / 25.4,
    heightIn: 88 / 25.4,
    idealPxW: 744,
    idealPxH: 1039,
    requiresBleed: false,
    aspectRatio: 63 / 88
  },
  poker_trim: {
    id: 'poker_trim',
    name: 'Poker Card Size (2.5 × 3.5 in)',
    subtitle: '63.5×88.9mm standard US poker size',
    widthMm: 63.5,
    heightMm: 88.9,
    widthIn: 2.5,
    heightIn: 3.5,
    idealPxW: 750,
    idealPxH: 1050,
    requiresBleed: false,
    aspectRatio: 2.5 / 3.5
  }
};

export const PRINTER_PROFILES: Record<string, PrinterProfile> = {
  mpc_commercial: {
    id: 'mpc_commercial',
    name: 'Commercial Cardstock (MPC S30/S33 / PrintingProxies)',
    badge: 'Offset / Indigo CMYK',
    description:
      'Simulates 300–330gsm coated cardstock (GRACoL/FOGRA39 CMYK conversion) with a 12% dot-gain shadow crush below L*=18 and neon gamut clamping.',
    blackFloorL: 9.5, // Minimum L* achievable on semi-matte cardstock
    paperWhiteL: 95.5, // Maximum L* of cardstock white
    shadowCrushThreshold: 22.0, // Below this L*, dot gain compresses tonal separation
    shadowCrushStrength: 0.58, // Tonal compression factor in darks
    saturationMultiplier: 0.90, // General CMYK chroma dampener
    gamutClampStrength: 0.72, // Clamping on out-of-gamut neon cyan/magenta/blue
    recommendedToeLift: 38
  },
  home_matte: {
    id: 'home_matte',
    name: 'Home Inkjet — Matte Cardstock (Unlaminated)',
    badge: 'High Dot Gain / Elevated Black',
    description:
      'Simulates absorbent matte photo paper where black ink spreads into fibers (L*_min = 16.0), causing all dark tones below L*=18 to merge into flat charcoal gray.',
    blackFloorL: 16.0,
    paperWhiteL: 93.0,
    shadowCrushThreshold: 26.0,
    shadowCrushStrength: 0.45,
    saturationMultiplier: 0.82,
    gamutClampStrength: 0.65,
    recommendedToeLift: 52
  },
  home_glossy: {
    id: 'home_glossy',
    name: 'Home Inkjet — Glossy Photo + Laminate Pouch',
    badge: 'Wide Gamut / Deep Dmax',
    description:
      'Simulates dye/pigment inkjet on glossy photo paper with thermal gloss laminate. Preserves deep blacks (L*_min = 6.0) with mild cyan/magenta gamut compression.',
    blackFloorL: 6.0,
    paperWhiteL: 97.0,
    shadowCrushThreshold: 14.0,
    shadowCrushStrength: 0.78,
    saturationMultiplier: 0.95,
    gamutClampStrength: 0.85,
    recommendedToeLift: 20
  },
  vinyl_glossy: {
    id: 'vinyl_glossy',
    name: 'Vinyl Sticker Glossy Paper',
    badge: 'Impermeable / Razor Sharp Dmax',
    description:
      'Plastic base holds razor-sharp dots with zero droplet wicking and incredibly deep Dmax (L*_min = 5.0). Needs slight shadow/gamma lift to prevent heavy black ink pooling and smearing.',
    blackFloorL: 5.0, // Minimum L* achievable on glossy vinyl
    paperWhiteL: 97.5, // Crisp synthetic white point
    shadowCrushThreshold: 14.0, // Low dot gain, sharp edge definition
    shadowCrushStrength: 0.80,
    saturationMultiplier: 0.96, // Wide gamut, punchy saturation
    gamutClampStrength: 0.86,
    recommendedToeLift: 22
  },
  vinyl_matte: {
    id: 'vinyl_matte',
    name: 'Vinyl Sticker Matte Paper',
    badge: 'Synthetic Matte Hybrid / Elevated Gray',
    description:
      'Hybrid substrate: lacks fibrous wicking of cardstock but scatters ambient light (L*_min = 14.0). Requires heavy shadow/gamma lift to prevent dark artwork crushing into a flat gray block.',
    blackFloorL: 14.0, // Matte coating scatters light into flat dark gray
    paperWhiteL: 94.0, // Muted matte synthetic white
    shadowCrushThreshold: 24.0, // Moderate dot gain and early shadow flattening
    shadowCrushStrength: 0.50,
    saturationMultiplier: 0.85, // Medium gamut with muted colors
    gamutClampStrength: 0.68,
    recommendedToeLift: 48
  }
};

export const BUILTIN_PRESETS: PresetCard[] = [
  {
    id: 'abyssal_dragon',
    name: 'Abyssal Dragon',
    tag: 'Muddy Shadow Risk',
    tagColor: 'text-rose-400 bg-rose-500/15 border-rose-500/30',
    summary: 'Dark cavern fantasy art with low-contrast shadow textures (L* 4–15) that crush into black on cardstock.'
  },
  {
    id: 'aetherstorm_surge',
    name: 'Aetherstorm Surge',
    tag: 'Neon Gamut Risk',
    tagColor: 'text-fuchsia-400 bg-fuchsia-500/15 border-fuchsia-500/30',
    summary: 'Electric cyan & neon magenta spell art that suffers severe ΔE_2000 color shift when converted to CMYK.'
  },
  {
    id: 'blurry_upscale',
    name: 'Ancient Relic (Upscaled)',
    tag: 'Resolution & Bleed Risk',
    tagColor: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
    summary: 'Bicubic-upscaled from a low-res web image (744×1039px) with soft edges and missing 3mm MPC bleed.'
  },
  {
    id: 'sunlit_sanctuary',
    name: 'Sunlit Sanctuary',
    tag: 'Print-Ready Reference',
    tagColor: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
    summary: 'Balanced tonal range, crisp high-frequency brushwork, CMYK-safe palette, and full 816×1110px bleed.'
  }
];

export function getScoreBadgeStyle(score: number) {
  if (score >= 82) {
    return {
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/15',
      border: 'border-emerald-500/30',
      bar: 'bg-emerald-500',
      label: 'Print-Ready'
    };
  }
  if (score >= 65) {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-500/15',
      border: 'border-amber-500/30',
      bar: 'bg-amber-500',
      label: 'Test Print / Adjust'
    };
  }
  return {
    text: 'text-rose-400',
    bg: 'bg-rose-500/15',
    border: 'border-rose-500/30',
    bar: 'bg-rose-500',
    label: 'High Print Risk'
  };
}
