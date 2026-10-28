import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Upload,
  Sliders,
  Eye,
  Sparkles,
  Download,
  Layers,
  Printer,
  RotateCcw,
  ShieldAlert,
  Moon,
  Palette,
  Grid,
  Activity,
  FileCheck,
  Flame,
  Image as ImageIcon,
  Cpu,
  Server,
  FolderArchive,
  CheckCircle2,
  Trash2,
  Plus
} from 'lucide-react';
import {
  rgbToLab,
  deltaE2000,
  computeSlidingWindowStd11x11,
  computeFftHighFrequencyFactor,
  buildPrinter3DLut,
  sample3DLut,
  optimizePrintAdjustments,
  AdjustmentParams
} from './colorScience';
import { createZipArchive, dataUrlToUint8Array, ZipEntryInput } from './zipBuilder';

// ============================================================================
// 1. CONSTANTS: CARD GEOMETRY & PRINTER PROFILES
// ============================================================================

export const CARD_STANDARDS = {
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

export const PRINTER_PROFILES = {
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
  }
};

const BUILTIN_PRESETS = [
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

// ============================================================================
// 2. PIXEL ADJUSTMENTS & SOFT-PROOFING SIMULATION
// ============================================================================

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Applies user adjustments (Shadow Recovery Toe Lift, Gamma, Brightness, Contrast, Saturation)
 * to an RGB triplet.
 */
export function applyUserAdjustments(r: number, g: number, b: number, adj: any): [number, number, number] {
  let rf = r / 255;
  let gf = g / 255;
  let bf = b / 255;

  // 1. Shadow Recovery (Perceptual Toe Lift that targets dark regions without blowing out highlights)
  if (adj.shadowLift !== 0) {
    const lum = 0.2126 * rf + 0.7152 * gf + 0.0722 * bf;
    const liftAmount = (adj.shadowLift / 100) * 0.26;
    const shadowWeight = Math.pow(1.0 - Math.min(1.0, lum / 0.48), 1.85);
    const boost = liftAmount * shadowWeight * (0.35 + 0.65 * Math.min(1, lum * 12));
    rf = Math.min(1, rf + boost);
    gf = Math.min(1, gf + boost);
    bf = Math.min(1, bf + boost);
  }

  // 2. Gamma correction
  if (adj.gamma !== 1.0) {
    const invGamma = 1.0 / adj.gamma;
    rf = Math.pow(Math.max(0, rf), invGamma);
    gf = Math.pow(Math.max(0, gf), invGamma);
    bf = Math.pow(Math.max(0, bf), invGamma);
  }

  // 3. Brightness offset
  if (adj.brightness !== 0) {
    const bOffset = (adj.brightness / 100) * 0.35;
    rf += bOffset;
    gf += bOffset;
    bf += bOffset;
  }

  // 4. Contrast around midpoint 0.5
  if (adj.contrast !== 0) {
    const cFactor = Math.pow((adj.contrast + 100) / 100, 1.6);
    rf = (rf - 0.5) * cFactor + 0.5;
    gf = (gf - 0.5) * cFactor + 0.5;
    bf = (bf - 0.5) * cFactor + 0.5;
  }

  // 5. Saturation
  if (adj.saturation !== 0) {
    const sFactor = 1.0 + adj.saturation / 100;
    const luma = 0.2126 * rf + 0.7152 * gf + 0.0722 * bf;
    rf = luma + (rf - luma) * sFactor;
    gf = luma + (gf - luma) * sFactor;
    bf = luma + (bf - luma) * sFactor;
  }

  return [clampByte(rf * 255), clampByte(gf * 255), clampByte(bf * 255)];
}

/**
 * Simulates how a specific Printer + Cardstock Profile reproduces an sRGB pixel.
 */
export function simulatePrinterOutput(r: number, g: number, b: number, profile: any): [number, number, number] {
  let rf = r / 255;
  let gf = g / 255;
  let bf = b / 255;

  const luma = 0.2126 * rf + 0.7152 * gf + 0.0722 * bf;

  // 1. Simulate dot-gain shadow crush in dark tones
  const crushNorm = profile.shadowCrushThreshold / 100;
  let crushedLuma = luma;
  if (luma < crushNorm && crushNorm > 0) {
    const ratio = luma / crushNorm;
    const crushedRatio = Math.pow(ratio, 1.0 / profile.shadowCrushStrength);
    crushedLuma = crushedRatio * crushNorm;
  }

  const lumaScale = luma > 0.001 ? crushedLuma / luma : 0;
  rf *= lumaScale;
  gf *= lumaScale;
  bf *= lumaScale;

  // 2. Simulate CMYK gamut compression on high-chroma neon colors
  const maxC = Math.max(rf, gf, bf);
  const minC = Math.min(rf, gf, bf);
  const chroma = maxC - minC;

  let gamutPenalty = profile.saturationMultiplier;
  if (chroma > 0.32) {
    const isNeonCyan = gf > 0.55 && bf > 0.55 && rf < 0.35;
    const isNeonMagenta = rf > 0.55 && bf > 0.50 && gf < 0.35;
    const isElectricBlue = bf > 0.65 && rf < 0.30 && gf < 0.40;
    const isNeonGreen = gf > 0.65 && rf < 0.35 && bf < 0.35;

    if (isNeonCyan || isNeonMagenta || isElectricBlue || isNeonGreen) {
      const excess = (chroma - 0.32) / 0.68;
      gamutPenalty *= 1.0 - excess * (1.0 - profile.gamutClampStrength) * 0.85;
      rf *= 0.93;
      gf *= 0.92;
      bf *= 0.91;
    }
  }

  const midLuma = 0.2126 * rf + 0.7152 * gf + 0.0722 * bf;
  rf = midLuma + (rf - midLuma) * gamutPenalty;
  gf = midLuma + (gf - midLuma) * gamutPenalty;
  bf = midLuma + (bf - midLuma) * gamutPenalty;

  // 3. Map to physical Paper White ceiling and Ink Black Floor (Dmax)
  const minRGB = Math.pow((profile.blackFloorL + 16) / 116, 3) * 1.35 + (profile.blackFloorL / 100) * 0.22;
  const maxRGB = profile.paperWhiteL / 100;

  rf = minRGB + rf * (maxRGB - minRGB);
  gf = minRGB + gf * (maxRGB - minRGB);
  bf = minRGB + bf * (maxRGB - minRGB);

  return [
    clampByte(rf * 255),
    clampByte(gf * 254),
    clampByte(bf * 251)
  ];
}

// ============================================================================
// 3. PROCEDURAL MTG TEST CARD GENERATOR
// ============================================================================

function generatePresetCardCanvas(presetId: string) {
  const canvas = document.createElement('canvas');

  if (presetId === 'blurry_upscale') {
    canvas.width = 744;
    canvas.height = 1039;
    const lowCanvas = document.createElement('canvas');
    lowCanvas.width = 248;
    lowCanvas.height = 346;
    drawCardContent(lowCanvas.getContext('2d')!, 248, 346, presetId, false);

    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(lowCanvas, 0, 0, 744, 1039);
    return canvas;
  }

  canvas.width = 816;
  canvas.height = 1110;
  const ctx = canvas.getContext('2d')!;
  drawCardContent(ctx, 816, 1110, presetId, true);
  return canvas;
}

function drawCardContent(ctx: CanvasRenderingContext2D, W: number, H: number, presetId: string, hasBleed: boolean) {
  const bleedX = hasBleed ? W * (3 / 69) : 0;
  const bleedY = hasBleed ? H * (3 / 94) : 0;
  const trimW = W - bleedX * 2;
  const trimH = H - bleedY * 2;

  ctx.fillStyle = '#070709';
  ctx.fillRect(0, 0, W, H);

  const borderT = trimW * 0.048;
  const frameX = bleedX + borderT;
  const frameY = bleedY + borderT;
  const frameW = trimW - borderT * 2;
  const frameH = trimH - borderT * 2;

  const themes: Record<string, any> = {
    abyssal_dragon: {
      frameGrad: ['#1e1b24', '#121017', '#261822'],
      pinline: '#6b21a8',
      titleBg: '#27232f',
      textBg: '#1c1922',
      textColor: '#e2e8f0',
      title: 'Vorath, Abyssal Dreadwing',
      cost: ['4', 'B', 'B'],
      type: 'Legendary Creature — Elder Dragon',
      rules: [
        'Flying, deathtouch',
        'Whenever Vorath attacks, defending player sacrifices a creature inside the cavernous shadows.',
        '"In the lightless depths below Urborg, even dragonfire freezes into obsidian."'
      ],
      pt: '6/6'
    },
    aetherstorm_surge: {
      frameGrad: ['#083344', '#1e1b4b', '#4a044e'],
      pinline: '#00f5d4',
      titleBg: '#0f2942',
      textBg: '#0c1e33',
      textColor: '#ecfeff',
      title: 'Aetherstorm Hyperflux',
      cost: ['2', 'U', 'R'],
      type: 'Instant — Arcane Overload',
      rules: [
        'Copy target instant or sorcery spell twice. You may choose new targets for the copies.',
        'Draw two cards, then discard a card at random.',
        '"Raw prismatic aether burns brighter than paper or ink can ever contain."'
      ],
      pt: null
    },
    blurry_upscale: {
      frameGrad: ['#3f3324', '#292118', '#443727'],
      pinline: '#d97706',
      titleBg: '#dfd5c6',
      textBg: '#e7dfd3',
      textColor: '#1c1917',
      title: 'Gilded Lotus Reliquary',
      cost: ['5'],
      type: 'Artifact — Mythic Relic',
      rules: [
        '{T}: Add three mana of any one color.',
        'Sacrifice Gilded Lotus Reliquary: Return target historic card from your graveyard to your hand.',
        '"Downloaded from a low-res spoiler gallery and stretched to fit."'
      ],
      pt: null
    },
    sunlit_sanctuary: {
      frameGrad: ['#2d4a34', '#1b3322', '#3d5a3b'],
      pinline: '#eab308',
      titleBg: '#e2e8dd',
      textBg: '#ecf2e8',
      textColor: '#142618',
      title: 'Sunlit Canopy Sanctuary',
      cost: ['1', 'G', 'W'],
      type: 'Enchantment — Aura Sanctuary',
      rules: [
        'Creatures you control have vigilance and "+1/+1 as long as you control an enchanted land."',
        'When Sunlit Canopy Sanctuary enters, you gain 4 life and draw a card.',
        '"Crisp brushwork, balanced midtones, and well-separated shadow foliage."'
      ],
      pt: null
    }
  };

  const theme = themes[presetId] || themes.sunlit_sanctuary;

  const fGrad = ctx.createLinearGradient(frameX, frameY, frameX + frameW, frameY + frameH);
  fGrad.addColorStop(0, theme.frameGrad[0]);
  fGrad.addColorStop(0.5, theme.frameGrad[1]);
  fGrad.addColorStop(1, theme.frameGrad[2]);
  ctx.fillStyle = fGrad;
  ctx.beginPath();
  ctx.roundRect(frameX, frameY, frameW, frameH, trimW * 0.03);
  ctx.fill();

  ctx.strokeStyle = theme.pinline;
  ctx.lineWidth = Math.max(1.5, trimW * 0.005);
  ctx.stroke();

  const artX = bleedX + trimW * 0.078;
  const artY = bleedY + trimH * 0.112;
  const artW = trimW * 0.844;
  const artH = trimH * 0.435;

  ctx.save();
  ctx.beginPath();
  ctx.rect(artX, artY, artW, artH);
  ctx.clip();

  if (presetId === 'abyssal_dragon') {
    const bgGrad = ctx.createRadialGradient(
      artX + artW * 0.5,
      artY + artH * 0.42,
      artW * 0.05,
      artX + artW * 0.5,
      artY + artH * 0.5,
      artW * 0.75
    );
    bgGrad.addColorStop(0, '#1f1928');
    bgGrad.addColorStop(0.45, '#120f18');
    bgGrad.addColorStop(1, '#08060c');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(artX, artY, artW, artH);

    for (let i = 0; i < 28; i++) {
      const rx = artX + (i / 28) * artW;
      const rw = artW * 0.05;
      const rh = artH * (0.25 + 0.35 * Math.sin(i * 1.7));
      ctx.fillStyle = i % 2 === 0 ? '#15111c' : '#0d0b12';
      ctx.beginPath();
      ctx.moveTo(rx, artY);
      ctx.lineTo(rx + rw, artY);
      ctx.lineTo(rx + rw * 0.5, artY + rh);
      ctx.fill();
    }

    ctx.fillStyle = '#181320';
    ctx.strokeStyle = '#271f33';
    ctx.lineWidth = Math.max(1.5, artW * 0.004);

    ctx.beginPath();
    ctx.moveTo(artX + artW * 0.5, artY + artH * 0.55);
    ctx.quadraticCurveTo(artX + artW * 0.22, artY + artH * 0.12, artX + artW * 0.04, artY + artH * 0.42);
    ctx.quadraticCurveTo(artX + artW * 0.25, artY + artH * 0.65, artX + artW * 0.45, artY + artH * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(artX + artW * 0.5, artY + artH * 0.55);
    ctx.quadraticCurveTo(artX + artW * 0.78, artY + artH * 0.12, artX + artW * 0.96, artY + artH * 0.42);
    ctx.quadraticCurveTo(artX + artW * 0.75, artY + artH * 0.65, artX + artW * 0.55, artY + artH * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 16; col++) {
        const sx = artX + artW * (0.15 + (col / 16) * 0.7);
        const sy = artY + artH * (0.28 + (row / 12) * 0.58);
        const dist = Math.hypot(sx - (artX + artW * 0.5), sy - (artY + artH * 0.55));
        if (dist < artW * 0.34) {
          ctx.fillStyle = (row + col) % 2 === 0 ? '#1d1726' : '#14101b';
          ctx.beginPath();
          ctx.arc(sx, sy, artW * 0.022, 0, Math.PI, false);
          ctx.fill();
          ctx.strokeStyle = '#251e30';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    ctx.fillStyle = '#231b2e';
    ctx.beginPath();
    ctx.moveTo(artX + artW * 0.43, artY + artH * 0.35);
    ctx.lineTo(artX + artW * 0.57, artY + artH * 0.35);
    ctx.lineTo(artX + artW * 0.53, artY + artH * 0.52);
    ctx.lineTo(artX + artW * 0.47, artY + artH * 0.52);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#c084fc';
    ctx.beginPath();
    ctx.arc(artX + artW * 0.475, artY + artH * 0.42, artW * 0.011, 0, Math.PI * 2);
    ctx.arc(artX + artW * 0.525, artY + artH * 0.42, artW * 0.011, 0, Math.PI * 2);
    ctx.fill();
  } else if (presetId === 'aetherstorm_surge') {
    const bg = ctx.createLinearGradient(artX, artY, artX + artW, artY + artH);
    bg.addColorStop(0, '#020617');
    bg.addColorStop(0.35, '#1d046e');
    bg.addColorStop(0.7, '#004dff');
    bg.addColorStop(1, '#3b0764');
    ctx.fillStyle = bg;
    ctx.fillRect(artX, artY, artW, artH);

    for (let i = 0; i < 18; i++) {
      const radius = artW * (0.06 + i * 0.028);
      ctx.strokeStyle = i % 3 === 0 ? '#00ffff' : i % 3 === 1 ? '#ff00ff' : '#00ff66';
      ctx.lineWidth = artW * 0.014;
      ctx.beginPath();
      ctx.arc(
        artX + artW * 0.5 + Math.sin(i) * artW * 0.04,
        artY + artH * 0.48 + Math.cos(i) * artH * 0.04,
        radius,
        i * 0.4,
        i * 0.4 + Math.PI * 1.35
      );
      ctx.stroke();
    }

    ctx.strokeStyle = '#e0ffff';
    ctx.lineWidth = Math.max(2, artW * 0.006);
    for (let b = 0; b < 8; b++) {
      let lx = artX + artW * 0.5;
      let ly = artY + artH * 0.48;
      const angle = (b / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      for (let seg = 1; seg <= 6; seg++) {
        lx += Math.cos(angle + (seg % 2 === 0 ? 0.25 : -0.25)) * (artW * 0.08);
        ly += Math.sin(angle + (seg % 2 === 0 ? -0.25 : 0.25)) * (artH * 0.08);
        ctx.lineTo(lx, ly);
      }
      ctx.stroke();
    }
  } else {
    const sky = ctx.createLinearGradient(artX, artY, artX, artY + artH);
    sky.addColorStop(0, presetId === 'blurry_upscale' ? '#4f6d7a' : '#38bdf8');
    sky.addColorStop(0.55, '#fde68a');
    sky.addColorStop(1, '#14532d');
    ctx.fillStyle = sky;
    ctx.fillRect(artX, artY, artW, artH);

    ctx.fillStyle = 'rgba(254, 249, 195, 0.35)';
    ctx.beginPath();
    ctx.arc(artX + artW * 0.5, artY + artH * 0.28, artW * 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(artX, artY + artH * 0.65);
    ctx.lineTo(artX + artW * 0.22, artY + artH * 0.36);
    ctx.lineTo(artX + artW * 0.42, artY + artH * 0.55);
    ctx.lineTo(artX + artW * 0.72, artY + artH * 0.30);
    ctx.lineTo(artX + artW, artY + artH * 0.62);
    ctx.lineTo(artX + artW, artY + artH);
    ctx.lineTo(artX, artY + artH);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f1f5f9';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = Math.max(1.5, artW * 0.004);
    for (let c = 0; c < 5; c++) {
      const cx = artX + artW * (0.22 + c * 0.13);
      const cy = artY + artH * 0.38;
      const cw = artW * 0.055;
      const ch = artH * 0.42;
      ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeRect(cx, cy, cw, ch);
      for (let f = 1; f <= 3; f++) {
        ctx.beginPath();
        ctx.moveTo(cx + (cw * f) / 4, cy);
        ctx.lineTo(cx + (cw * f) / 4, cy + ch);
        ctx.stroke();
      }
    }

    for (let leaf = 0; leaf < 45; leaf++) {
      const lx = artX + ((leaf * 37) % 100) * 0.01 * artW;
      const ly = artY + artH * (0.72 + ((leaf * 19) % 28) * 0.01);
      ctx.fillStyle = leaf % 3 === 0 ? '#166534' : leaf % 3 === 1 ? '#15803d' : '#1e3a2f';
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = Math.max(1, artW * 0.0025);
      ctx.beginPath();
      ctx.ellipse(lx, ly, artW * 0.04, artH * 0.025, (leaf % 5) * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();

  ctx.strokeStyle = theme.pinline;
  ctx.lineWidth = Math.max(2, trimW * 0.005);
  ctx.strokeRect(artX, artY, artW, artH);

  const titleX = bleedX + trimW * 0.068;
  const titleY = bleedY + trimH * 0.052;
  const titleW = trimW * 0.864;
  const titleH = trimH * 0.052;

  ctx.fillStyle = theme.titleBg;
  ctx.beginPath();
  ctx.roundRect(titleX, titleY, titleW, titleH, titleH * 0.35);
  ctx.fill();
  ctx.strokeStyle = theme.pinline;
  ctx.lineWidth = Math.max(1.5, trimW * 0.004);
  ctx.stroke();

  ctx.fillStyle = theme.textColor;
  ctx.font = `bold ${Math.round(trimH * 0.027)}px Georgia, serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(theme.title, titleX + titleW * 0.03, titleY + titleH * 0.52);

  const pipRadius = titleH * 0.33;
  theme.cost.forEach((sym: string, idx: number) => {
    const px = titleX + titleW - (theme.cost.length - idx) * (pipRadius * 2.35) - titleW * 0.015;
    const py = titleY + titleH * 0.5;
    ctx.fillStyle =
      sym === 'B'
        ? '#a855f7'
        : sym === 'U'
        ? '#38bdf8'
        : sym === 'R'
        ? '#f87171'
        : sym === 'G'
        ? '#4ade80'
        : sym === 'W'
        ? '#fef08a'
        : '#cbd5e1';
    ctx.beginPath();
    ctx.arc(px, py, pipRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${Math.round(pipRadius * 1.25)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(sym, px, py + 1);
    ctx.textAlign = 'left';
  });

  const typeX = titleX;
  const typeY = bleedY + trimH * 0.556;
  const typeW = titleW;
  const typeH = trimH * 0.048;

  ctx.fillStyle = theme.titleBg;
  ctx.beginPath();
  ctx.roundRect(typeX, typeY, typeW, typeH, typeH * 0.35);
  ctx.fill();
  ctx.strokeStyle = theme.pinline;
  ctx.stroke();

  ctx.fillStyle = theme.textColor;
  ctx.font = `bold ${Math.round(trimH * 0.023)}px Georgia, serif`;
  ctx.fillText(theme.type, typeX + typeW * 0.03, typeY + typeH * 0.53);

  const rulesX = artX;
  const rulesY = bleedY + trimH * 0.614;
  const rulesW = artW;
  const rulesH = trimH * 0.275;

  ctx.fillStyle = theme.textBg;
  ctx.fillRect(rulesX, rulesY, rulesW, rulesH);
  ctx.strokeStyle = theme.pinline;
  ctx.strokeRect(rulesX, rulesY, rulesW, rulesH);

  ctx.fillStyle = theme.textColor;
  const fontSize = Math.round(trimH * 0.0215);
  let curY = rulesY + rulesH * 0.16;
  theme.rules.forEach((line: string, idx: number) => {
    const isFlavor = idx === theme.rules.length - 1;
    ctx.font = `${isFlavor ? 'italic' : 'normal'} ${fontSize}px Georgia, serif`;
    curY = wrapCanvasText(ctx, line, rulesX + rulesW * 0.04, curY, rulesW * 0.92, fontSize * 1.32);
    curY += fontSize * 0.45;
  });

  if (theme.pt) {
    const ptW = trimW * 0.16;
    const ptH = trimH * 0.048;
    const ptX = bleedX + trimW * 0.77;
    const ptY = bleedY + trimH * 0.865;
    ctx.fillStyle = theme.titleBg;
    ctx.beginPath();
    ctx.roundRect(ptX, ptY, ptW, ptH, ptH * 0.35);
    ctx.fill();
    ctx.strokeStyle = theme.pinline;
    ctx.lineWidth = Math.max(2, trimW * 0.005);
    ctx.stroke();

    ctx.fillStyle = theme.textColor;
    ctx.font = `bold ${Math.round(trimH * 0.026)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillText(theme.pt, ptX + ptW * 0.5, ptY + ptH * 0.54);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = '#94a3b8';
  ctx.font = `${Math.round(trimH * 0.015)}px sans-serif`;
  ctx.fillText(
    'PROXYPRINT LAB CALIBRATION • NOT FOR SALE',
    bleedX + trimW * 0.08,
    bleedY + trimH * 0.935
  );
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
  return currentY + lineHeight;
}

// ============================================================================
// 4. CORE 6-STAGE PIXEL ANALYSIS PIPELINE (CLIENT + 3D LUT + 11x11 STDDEV + ΔE2000)
// ============================================================================

export function runFullPrintPipeline({
  sourceCanvas,
  inputMode,
  cardStandard,
  printerProfile,
  adjustments,
  padMpcBleed
}: any) {
  if (!sourceCanvas) return null;

  const rawW = sourceCanvas.width;
  const rawH = sourceCanvas.height;

  const bleedFactorX = padMpcBleed ? 69 / 63 : 1.0;
  const bleedFactorY = padMpcBleed ? 94 / 88 : 1.0;
  const effectiveW = Math.round(rawW * bleedFactorX);
  const effectiveH = Math.round(rawH * bleedFactorY);

  const AN_W = 240;
  const AN_H = 330;
  const workCanvas = document.createElement('canvas');
  workCanvas.width = AN_W;
  workCanvas.height = AN_H;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true })!;

  ctx.fillStyle = '#070709';
  ctx.fillRect(0, 0, AN_W, AN_H);

  const padX = padMpcBleed ? Math.round(AN_W * (3 / 69)) : 0;
  const padY = padMpcBleed ? Math.round(AN_H * (3 / 94)) : 0;
  ctx.drawImage(sourceCanvas, padX, padY, AN_W - padX * 2, AN_H - padY * 2);

  const rawImgData = ctx.getImageData(0, 0, AN_W, AN_H);
  const rawPixels = rawImgData.data;

  // --------------------------------------------------------------------------
  // STAGE 1 & 2: RESOLUTION, BLEED GEOMETRY, LAPLACIAN & 2D FFT SHARPNESS
  // --------------------------------------------------------------------------
  const ppiX = effectiveW / cardStandard.widthIn;
  const ppiY = effectiveH / cardStandard.heightIn;
  const nominalPpi = Math.round(Math.min(ppiX, ppiY));

  const actualAspect = effectiveW / effectiveH;
  const aspectDiffPct = (Math.abs(actualAspect - cardStandard.aspectRatio) / cardStandard.aspectRatio) * 100;

  // Detect whether the uploaded card already includes a 3mm MPC bleed margin:
  // A standard trim-sized MTG card (63x88mm) ALREADY has a ~3mm black border around the frame,
  // so checking outerBorderDarkRatio > 0.85 alone falsely triggers on standard 63x88mm cards
  // and shrinks the Art Analysis Region by an extra 3mm on every side!
  // Instead, check whether the outer dark border is double-thick (~6mm total = 3mm bleed + 3mm border)
  // or whether the image's aspect ratio / dimensions match 69x94mm MPC bleed.
  let outerEdgeDarkCount = 0;
  let outerEdgeTotal = 0;
  let innerRingDarkCount = 0;
  let innerRingTotal = 0;
  const edgeBandX = Math.max(4, Math.round(AN_W * (3 / 69)));
  const edgeBandY = Math.max(4, Math.round(AN_H * (3 / 94)));
  const innerBandX = Math.max(8, Math.round(AN_W * (5.5 / 69)));
  const innerBandY = Math.max(8, Math.round(AN_H * (5.5 / 94)));

  for (let y = 0; y < AN_H; y++) {
    for (let x = 0; x < AN_W; x++) {
      const isOuter = x < edgeBandX || x >= AN_W - edgeBandX || y < edgeBandY || y >= AN_H - edgeBandY;
      const isInnerRing =
        !isOuter &&
        (x < innerBandX || x >= AN_W - innerBandX || y < innerBandY || y >= AN_H - innerBandY);
      if (isOuter || isInnerRing) {
        const idx = (y * AN_W + x) * 4;
        const [L] = rgbToLab(rawPixels[idx], rawPixels[idx + 1], rawPixels[idx + 2]);
        if (isOuter) {
          if (L < 14) outerEdgeDarkCount++;
          outerEdgeTotal++;
        } else {
          if (L < 14) innerRingDarkCount++;
          innerRingTotal++;
        }
      }
    }
  }
  const outerBorderDarkRatio = outerEdgeDarkCount / Math.max(1, outerEdgeTotal);
  const innerRingDarkRatio = innerRingDarkCount / Math.max(1, innerRingTotal);
  const isMpcAspect = Math.abs(actualAspect - 69 / 94) < Math.abs(actualAspect - 63 / 88);

  const has3mmBleed =
    padMpcBleed ||
    (outerBorderDarkRatio > 0.85 && innerRingDarkRatio > 0.72) ||
    (isMpcAspect && effectiveW >= 800 && effectiveH >= 1090 && outerBorderDarkRatio > 0.75);

  const sharpW = Math.min(480, rawW);
  const sharpH = Math.min(660, rawH);
  const sharpCanvas = document.createElement('canvas');
  sharpCanvas.width = sharpW;
  sharpCanvas.height = sharpH;
  const sCtx = sharpCanvas.getContext('2d', { willReadFrequently: true })!;
  sCtx.drawImage(sourceCanvas, 0, 0, sharpW, sharpH);
  const sData = sCtx.getImageData(0, 0, sharpW, sharpH).data;

  const gray = new Float32Array(sharpW * sharpH);
  for (let i = 0; i < sharpW * sharpH; i++) {
    const p = i * 4;
    gray[i] = 0.299 * sData[p] + 0.587 * sData[p + 1] + 0.114 * sData[p + 2];
  }

  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  // Crop exactly to the unmasked Art Box for Laplacian + 2D FFT sharpness analysis
  const sharpBleedX = has3mmBleed ? sharpW * (3 / 69) : 0;
  const sharpBleedY = has3mmBleed ? sharpH * (3 / 94) : 0;
  const sharpTrimW = sharpW - sharpBleedX * 2;
  const sharpTrimH = sharpH - sharpBleedY * 2;

  const xStart = Math.max(1, Math.floor(sharpBleedX + sharpTrimW * 0.078));
  const xEnd = Math.min(sharpW - 1, Math.ceil(sharpBleedX + sharpTrimW * 0.922));
  const yStart = Math.max(1, Math.floor(sharpBleedY + sharpTrimH * 0.112));
  const yEnd = Math.min(sharpH - 1, Math.ceil(sharpBleedY + sharpTrimH * 0.547));

  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const c = gray[y * sharpW + x];
      const lap =
        -4 * c +
        gray[(y - 1) * sharpW + x] +
        gray[(y + 1) * sharpW + x] +
        gray[y * sharpW + (x - 1)] +
        gray[y * sharpW + (x + 1)];
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount++;
    }
  }
  const lapMean = lapSum / Math.max(1, lapCount);
  const lapVariance = lapSqSum / Math.max(1, lapCount) - lapMean * lapMean;

  const lapSharpnessFactor = Math.min(1.0, Math.max(0.38, Math.sqrt(lapVariance) / 19.5));
  const fftSharpnessFactor = computeFftHighFrequencyFactor(gray, sharpW, sharpH);
  const opticalSharpnessFactor = 0.65 * lapSharpnessFactor + 0.35 * fftSharpnessFactor;

  const effectiveOpticalPpi = Math.round(nominalPpi * opticalSharpnessFactor);
  const isLikelyUpscaled = nominalPpi >= 250 && opticalSharpnessFactor < 0.68;

  let resolutionScore = Math.min(100, Math.round((effectiveOpticalPpi / 300) * 95 + 5));
  if (cardStandard.requiresBleed && !has3mmBleed) {
    resolutionScore = Math.max(25, resolutionScore - 22);
  }
  if (aspectDiffPct > 3.5) {
    resolutionScore = Math.max(20, resolutionScore - 12);
  }

  // Build 17x17x17 3D LUT for fast 60 FPS printer output interpolation
  const printer3DLut = buildPrinter3DLut(simulatePrinterOutput, printerProfile, 17);

  // --------------------------------------------------------------------------
  // HELPER: RUN STAGES 3, 4, 5, 6 ON A GIVEN ADJUSTMENT SET
  // --------------------------------------------------------------------------
  const evaluateColorAndTones = (adj: any, buildVisualBuffers = false) => {
    const totalPixels = AN_W * AN_H;
    const adjustedL = new Float32Array(totalPixels);
    const simulatedL = new Float32Array(totalPixels);
    const deltaEArr = new Float32Array(totalPixels);
    const inArtMask = new Uint8Array(totalPixels);

    const histOriginal = new Uint32Array(50);
    const histSimulated = new Uint32Array(50);

    const bleedOffsetX = has3mmBleed ? AN_W * (3 / 69) : 0;
    const bleedOffsetY = has3mmBleed ? AN_H * (3 / 94) : 0;
    const trimSpanW = AN_W - bleedOffsetX * 2;
    const trimSpanH = AN_H - bleedOffsetY * 2;

    const maskX0 = Math.floor(bleedOffsetX + trimSpanW * 0.078);
    const maskX1 = Math.ceil(bleedOffsetX + trimSpanW * 0.922);
    const maskY0 = Math.floor(bleedOffsetY + trimSpanH * 0.112);
    const maskY1 = Math.ceil(bleedOffsetY + trimSpanH * 0.547);

    let maskPixelCount = 0;
    let lUnder5 = 0;
    let lUnder10 = 0;
    let lUnder15 = 0;
    let lUnder20 = 0;
    let lOver95 = 0;
    let deltaESum = 0;
    let highDeltaECount = 0;

    for (let y = 0; y < AN_H; y++) {
      for (let x = 0; x < AN_W; x++) {
        const idx = y * AN_W + x;
        const p = idx * 4;

        const isAnalyzed =
          inputMode === 'artwork_only' ||
          (x >= maskX0 && x <= maskX1 && y >= maskY0 && y <= maskY1);

        if (isAnalyzed) {
          inArtMask[idx] = 1;
          maskPixelCount++;
        }

        // Only apply user adjustments inside the analyzed region (so in 'full_card' Art-Box mode,
        // the black card border and text box are untouched and only the Art Analysis Region is changed)
        const [ar, ag, ab] = isAnalyzed
          ? applyUserAdjustments(rawPixels[p], rawPixels[p + 1], rawPixels[p + 2], adj)
          : [rawPixels[p], rawPixels[p + 1], rawPixels[p + 2]];
        const [L_adj, a_adj, b_adj] = rgbToLab(ar, ag, ab);
        adjustedL[idx] = L_adj;

        // Sample 3D LUT for fast 60 FPS printer soft-proofing
        const [sr, sg, sb] = sample3DLut(ar, ag, ab, printer3DLut, 17);
        const [L_sim, a_sim, b_sim] = rgbToLab(sr, sg, sb);
        simulatedL[idx] = L_sim;

        // Stage 5: Pixel-wise ΔE_2000 between sRGB and soft-proofed cardstock output
        const dE = deltaE2000(L_adj, a_adj, b_adj, L_sim, a_sim, b_sim);
        deltaEArr[idx] = dE;

        if (isAnalyzed) {
          const binOrig = Math.min(49, Math.floor(L_adj / 2));
          const binSim = Math.min(49, Math.floor(L_sim / 2));
          histOriginal[binOrig]++;
          histSimulated[binSim]++;

          if (L_adj < 5) lUnder5++;
          if (L_adj < 10) lUnder10++;
          if (L_adj < 15) lUnder15++;
          if (L_adj < 20) lUnder20++;
          if (L_adj > 95) lOver95++;

          deltaESum += dE;
          if (dE > 6.5) highDeltaECount++;
        }
      }
    }

    const normCount = Math.max(1, maskPixelCount);
    const pctUnder5 = (lUnder5 / normCount) * 100;
    const pctUnder10 = (lUnder10 / normCount) * 100;
    const pctUnder15 = (lUnder15 / normCount) * 100;
    const pctUnder20 = (lUnder20 / normCount) * 100;
    const pctOver95 = (lOver95 / normCount) * 100;
    const meanDeltaE = deltaESum / normCount;
    const pctHighDeltaE = (highDeltaECount / normCount) * 100;

    // ------------------------------------------------------------------------
    // STAGE 3: 11x11 SLIDING WINDOW SHADOW DETAIL RETENTION
    // ------------------------------------------------------------------------
    const stdOrig11x11 = computeSlidingWindowStd11x11(adjustedL, AN_W, AN_H);
    const stdSim11x11 = computeSlidingWindowStd11x11(simulatedL, AN_W, AN_H);

    let shadowPixelsCount = 0;
    let crushedShadowPixels = 0;
    let origShadowGradSum = 0;
    let simShadowGradSum = 0;

    const shadowRiskMap = buildVisualBuffers ? new Uint8Array(totalPixels) : null;

    for (let y = 0; y < AN_H; y++) {
      for (let x = 0; x < AN_W; x++) {
        const idx = y * AN_W + x;
        if (!inArtMask[idx]) continue;

        const L0 = adjustedL[idx];
        if (L0 < 25.0) {
          shadowPixelsCount++;
          const localStdOrig = stdOrig11x11[idx];
          const localStdSim = stdSim11x11[idx];
          origShadowGradSum += localStdOrig;
          simShadowGradSum += localStdSim;

          const retention = localStdOrig > 0.35 ? localStdSim / localStdOrig : 0.4;

          if (
            L0 < printerProfile.blackFloorL * 0.9 ||
            (L0 < 18 && retention < 0.48) ||
            localStdSim < 0.65
          ) {
            crushedShadowPixels++;
            if (shadowRiskMap) shadowRiskMap[idx] = 3; // High risk (Red)
          } else if (L0 < 22 && (retention < 0.72 || localStdSim < 1.35)) {
            if (shadowRiskMap) shadowRiskMap[idx] = 2; // Moderate risk (Yellow)
          } else {
            if (shadowRiskMap) shadowRiskMap[idx] = 1; // Safe dark texture (Green)
          }
        }
      }
    }

    const shadowRatio = shadowPixelsCount / normCount;
    const crushedRatioInShadows =
      shadowPixelsCount > 0 ? crushedShadowPixels / shadowPixelsCount : 0;
    const crushedRatioTotal = crushedShadowPixels / normCount;
    const meanSimShadowGrad =
      shadowPixelsCount > 0 ? simShadowGradSum / shadowPixelsCount : 2.5;

    let shadowScore = 96;
    if (shadowRatio > 0.03) {
      const crushPenalty = crushedRatioTotal * 145 + crushedRatioInShadows * 38;
      const mudPenalty = Math.max(0, (1.6 - meanSimShadowGrad) * 18);
      shadowScore = Math.round(Math.max(12, Math.min(98, 98 - crushPenalty - mudPenalty)));
    }

    // ------------------------------------------------------------------------
    // STAGE 4: 8x8 GRID PATCH RMS CONTRAST & HIGHLIGHT RETENTION
    // ------------------------------------------------------------------------
    const GRID_N = 8;
    const patchContrastGrid = [];
    let lowContrastPatches = 0;
    let validPatches = 0;
    let rmsContrastSum = 0;

    for (let gy = 0; gy < GRID_N; gy++) {
      const row = [];
      for (let gx = 0; gx < GRID_N; gx++) {
        const px0 = Math.floor((gx / GRID_N) * AN_W);
        const px1 = Math.floor(((gx + 1) / GRID_N) * AN_W);
        const py0 = Math.floor((gy / GRID_N) * AN_H);
        const py1 = Math.floor(((gy + 1) / GRID_N) * AN_H);

        let sumL = 0;
        let sumSqL = 0;
        let count = 0;

        for (let y = py0; y < py1; y++) {
          for (let x = px0; x < px1; x++) {
            const idx = y * AN_W + x;
            if (inArtMask[idx]) {
              const lVal = simulatedL[idx];
              sumL += lVal;
              sumSqL += lVal * lVal;
              count++;
            }
          }
        }

        if (count > 10) {
          const mean = sumL / count;
          const rms = Math.sqrt(Math.max(0, sumSqL / count - mean * mean));
          row.push({ rms, mean, active: true });
          validPatches++;
          rmsContrastSum += rms;
          if (rms < 4.2) lowContrastPatches++;
        } else {
          row.push({ rms: 0, mean: 0, active: false });
        }
      }
      patchContrastGrid.push(row);
    }

    const avgPatchRms = rmsContrastSum / Math.max(1, validPatches);
    const lowContrastPatchRatio = lowContrastPatches / Math.max(1, validPatches);

    const contrastScore = Math.round(
      Math.max(20, Math.min(98, 55 + avgPatchRms * 3.4 - lowContrastPatchRatio * 42))
    );

    const highlightScore = Math.round(Math.max(25, Math.min(99, 97 - pctOver95 * 3.2)));

    // ------------------------------------------------------------------------
    // STAGE 5: COLOR SUITABILITY SCORE (ΔE_2000 & GAMUT CLIPPING)
    // ------------------------------------------------------------------------
    const colorScore = Math.round(
      Math.max(18, Math.min(98, 100 - Math.max(0, meanDeltaE - 2.2) * 3.2 - pctHighDeltaE * 0.62))
    );

    // ------------------------------------------------------------------------
    // STAGE 6: BOTTLENECK-CAPPED FINAL SUITABILITY SCORE
    // ------------------------------------------------------------------------
    const qWeighted =
      0.20 * resolutionScore +
      0.35 * shadowScore +
      0.10 * highlightScore +
      0.15 * contrastScore +
      0.20 * colorScore;

    const minCritical = Math.min(resolutionScore, shadowScore, contrastScore);
    const qFinal = Math.round(Math.min(qWeighted, minCritical + 15));
    const isBottleneckCapped = minCritical + 15 < qWeighted - 0.5;

    return {
      scores: {
        overall: qFinal,
        weightedRaw: Math.round(qWeighted),
        isBottleneckCapped,
        bottleneckMetric:
          minCritical === shadowScore
            ? 'Shadow Detail'
            : minCritical === resolutionScore
            ? 'Resolution'
            : 'Contrast',
        resolution: resolutionScore,
        shadow: shadowScore,
        highlight: highlightScore,
        contrast: contrastScore,
        color: colorScore
      },
      metrics: {
        pctUnder5: pctUnder5.toFixed(1),
        pctUnder10: pctUnder10.toFixed(1),
        pctUnder15: pctUnder15.toFixed(1),
        pctUnder20: pctUnder20.toFixed(1),
        pctOver95: pctOver95.toFixed(1),
        crushedShadowPct: (crushedRatioTotal * 100).toFixed(1),
        shadowRetentionPct: Math.round(
          Math.min(100, (simShadowGradSum / Math.max(0.1, origShadowGradSum)) * 100)
        ),
        meanDeltaE: meanDeltaE.toFixed(1),
        pctHighDeltaE: pctHighDeltaE.toFixed(1),
        avgPatchRms: avgPatchRms.toFixed(1),
        lowContrastPatches
      },
      histograms: {
        original: Array.from(histOriginal),
        simulated: Array.from(histSimulated)
      },
      visualMaps: buildVisualBuffers
        ? {
            anW: AN_W,
            anH: AN_H,
            shadowRiskMap,
            deltaEArr,
            inArtMask,
            patchContrastGrid,
            artBoxNorm: {
              x: maskX0 / AN_W,
              y: maskY0 / AN_H,
              w: (maskX1 - maskX0) / AN_W,
              h: (maskY1 - maskY0) / AN_H
            }
          }
        : null
    };
  };

  const baselineResult = evaluateColorAndTones(
    { shadowLift: 0, gamma: 1.0, brightness: 0, contrast: 0, saturation: 0 },
    false
  );
  const currentResult = evaluateColorAndTones(adjustments, true);

  return {
    geometry: {
      rawW,
      rawH,
      effectiveW,
      effectiveH,
      nominalPpi,
      effectiveOpticalPpi,
      opticalSharpnessFactor: Math.round(opticalSharpnessFactor * 100),
      fftSharpnessRatio: Math.round(fftSharpnessFactor * 100),
      isLikelyUpscaled,
      has3mmBleed,
      aspectDiffPct: aspectDiffPct.toFixed(1)
    },
    anW: AN_W,
    anH: AN_H,
    rawAnalysisPixels: rawPixels,
    resolutionScore,
    printer3DLut,
    baseline: baselineResult,
    current: currentResult
  };
}

// ============================================================================
// 5. BATCH ITEM & EXPORT HELPER
// ============================================================================

interface BatchCardItem {
  id: string;
  fileName: string;
  sourceCanvas: HTMLCanvasElement;
  padBleed: boolean;
  adjustments: AdjustmentParams;
  baselineScores: any;
  optimizedScores: any;
  geometry: any;
  origThumbUrl: string;
  simThumbUrl: string;
}

function renderCardToPrintReadyCanvas(
  sourceCanvas: HTMLCanvasElement,
  padMpcBleed: boolean,
  has3mmBleed: boolean,
  inputMode: string,
  adjustments: AdjustmentParams
): HTMLCanvasElement {
  const rawW = sourceCanvas.width;
  const rawH = sourceCanvas.height;
  const outW = padMpcBleed ? Math.round(rawW * (69 / 63)) : rawW;
  const outH = padMpcBleed ? Math.round(rawH * (94 / 88)) : rawH;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const ctx = outCanvas.getContext('2d')!;

  ctx.fillStyle = '#070709';
  ctx.fillRect(0, 0, outW, outH);

  const px = padMpcBleed ? Math.round(outW * (3 / 69)) : 0;
  const py = padMpcBleed ? Math.round(outH * (3 / 94)) : 0;
  ctx.drawImage(sourceCanvas, px, py, outW - px * 2, outH - py * 2);

  const imgData = ctx.getImageData(0, 0, outW, outH);
  const d = imgData.data;
  const effectiveBleed = has3mmBleed || padMpcBleed;
  const bleedOffX = effectiveBleed ? outW * (3 / 69) : 0;
  const bleedOffY = effectiveBleed ? outH * (3 / 94) : 0;
  const trimW = outW - bleedOffX * 2;
  const trimH = outH - bleedOffY * 2;
  const ax0 = Math.floor(bleedOffX + trimW * 0.078);
  const ax1 = Math.ceil(bleedOffX + trimW * 0.922);
  const ay0 = Math.floor(bleedOffY + trimH * 0.112);
  const ay1 = Math.ceil(bleedOffY + trimH * 0.547);

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = (y * outW + x) * 4;
      const inRegion =
        inputMode === 'artwork_only' ||
        (x >= ax0 && x <= ax1 && y >= ay0 && y <= ay1);
      if (inRegion) {
        const [ar, ag, ab] = applyUserAdjustments(d[i], d[i + 1], d[i + 2], adjustments);
        d[i] = ar;
        d[i + 1] = ag;
        d[i + 2] = ab;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return outCanvas;
}

function generateBatchThumbnails(
  sourceCanvas: HTMLCanvasElement,
  padMpcBleed: boolean,
  has3mmBleed: boolean,
  inputMode: string,
  adjustments: AdjustmentParams,
  printer3DLut: Uint8Array
): { origThumbUrl: string; simThumbUrl: string } {
  const TW = 156;
  const TH = 214;

  const origC = document.createElement('canvas');
  origC.width = TW;
  origC.height = TH;
  const oCtx = origC.getContext('2d')!;
  oCtx.fillStyle = '#070709';
  oCtx.fillRect(0, 0, TW, TH);
  const px = padMpcBleed ? Math.round(TW * (3 / 69)) : 0;
  const py = padMpcBleed ? Math.round(TH * (3 / 94)) : 0;
  oCtx.drawImage(sourceCanvas, px, py, TW - px * 2, TH - py * 2);

  const simC = document.createElement('canvas');
  simC.width = TW;
  simC.height = TH;
  const sCtx = simC.getContext('2d')!;
  sCtx.drawImage(origC, 0, 0);

  const imgData = sCtx.getImageData(0, 0, TW, TH);
  const d = imgData.data;
  const effectiveBleed = has3mmBleed || padMpcBleed;
  const bleedOffX = effectiveBleed ? TW * (3 / 69) : 0;
  const bleedOffY = effectiveBleed ? TH * (3 / 94) : 0;
  const trimW = TW - bleedOffX * 2;
  const trimH = TH - bleedOffY * 2;
  const ax0 = Math.floor(bleedOffX + trimW * 0.078);
  const ax1 = Math.ceil(bleedOffX + trimW * 0.922);
  const ay0 = Math.floor(bleedOffY + trimH * 0.112);
  const ay1 = Math.ceil(bleedOffY + trimH * 0.547);

  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const i = (y * TW + x) * 4;
      const inRegion =
        inputMode === 'artwork_only' ||
        (x >= ax0 && x <= ax1 && y >= ay0 && y <= ay1);
      const [ar, ag, ab] = inRegion
        ? applyUserAdjustments(d[i], d[i + 1], d[i + 2], adjustments)
        : [d[i], d[i + 1], d[i + 2]];
      const [sr, sg, sb] = sample3DLut(ar, ag, ab, printer3DLut, 17);
      d[i] = sr;
      d[i + 1] = sg;
      d[i + 2] = sb;
    }
  }
  sCtx.putImageData(imgData, 0, 0);

  return {
    origThumbUrl: origC.toDataURL('image/jpeg', 0.88),
    simThumbUrl: simC.toDataURL('image/jpeg', 0.88)
  };
}

// ============================================================================
// 6. MAIN APPLICATION COMPONENT
// ============================================================================

export default function App() {
  const [studioMode, setStudioMode] = useState<'single' | 'batch'>('single');
  const [activePresetId, setActivePresetId] = useState<string | null>('abyssal_dragon');
  const [customFileName, setCustomFileName] = useState<string | null>(null);
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);

  // Batch Queue State
  const [batchItems, setBatchItems] = useState<BatchCardItem[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const batchFileInputRef = useRef<HTMLInputElement | null>(null);

  const [inputMode, setInputMode] = useState('full_card'); // 'full_card' | 'artwork_only'
  const [cardStandardId, setCardStandardId] = useState('mpc_bleed');
  const [printerProfileId, setPrinterProfileId] = useState('mpc_commercial');

  const [adjustments, setAdjustments] = useState({
    shadowLift: 0,
    gamma: 1.0,
    brightness: 0,
    contrast: 0,
    saturation: 0
  });
  const [padMpcBleed, setPadMpcBleed] = useState(false);

  const [viewMode, setViewMode] = useState('three_way'); // 'three_way' | 'simulated' | 'shadow_heatmap' | 'gamut_heatmap' | 'contrast_grid'
  const [showGeometryGuides, setShowGeometryGuides] = useState(true);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'local'>('checking');

  const mainPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const origCompareCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const simCompareCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapCompareCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cardStandard = CARD_STANDARDS[cardStandardId as keyof typeof CARD_STANDARDS];
  const printerProfile = PRINTER_PROFILES[printerProfileId as keyof typeof PRINTER_PROFILES];

  // Probe FastAPI Backend availability on mount
  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (data?.status === 'ok') setBackendStatus('connected');
        else setBackendStatus('local');
      })
      .catch(() => setBackendStatus('local'));
  }, []);

  // Load built-in preset whenever activePresetId changes
  useEffect(() => {
    if (!activePresetId) return;
    const generated = generatePresetCardCanvas(activePresetId);
    setSourceCanvas(generated);
    setCustomFileName(null);
    setAdjustments({
      shadowLift: 0,
      gamma: 1.0,
      brightness: 0,
      contrast: 0,
      saturation: 0
    });
    setPadMpcBleed(false);
  }, [activePresetId]);

  const handleImageUpload = useCallback((file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        setActivePresetId(null);
        setCustomFileName(file.name);
        setSourceCanvas(c);
        setAdjustments({
          shadowLift: 0,
          gamma: 1.0,
          brightness: 0,
          contrast: 0,
          saturation: 0
        });
        setPadMpcBleed(false);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  // Run the 6-Stage Pixel Analysis Engine + 3D LUT generator
  const analysis = useMemo(() => {
    if (!sourceCanvas) return null;
    return runFullPrintPipeline({
      sourceCanvas,
      inputMode,
      cardStandard,
      printerProfile,
      adjustments,
      padMpcBleed
    });
  }, [sourceCanvas, inputMode, cardStandard, printerProfile, adjustments, padMpcBleed]);

  // Render visual inspection canvases at 60 FPS using the 3D LUT
  useEffect(() => {
    if (!sourceCanvas || !analysis) return;

    const DISP_W = 360;
    const DISP_H = 490;
    const lut3D = analysis.printer3DLut;

    const drawBaseImage = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.fillStyle = '#070709';
      ctx.fillRect(0, 0, w, h);
      const px = padMpcBleed ? Math.round(w * (3 / 69)) : 0;
      const py = padMpcBleed ? Math.round(h * (3 / 94)) : 0;
      ctx.drawImage(sourceCanvas, px, py, w - px * 2, h - py * 2);
    };

    const drawGuidesOverlay = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      if (!showGeometryGuides) return;
      ctx.save();

      const hasBleed = analysis.geometry.has3mmBleed;
      const bleedPxX = hasBleed ? w * (3 / 69) : 0;
      const bleedPxY = hasBleed ? h * (3 / 94) : 0;

      if (hasBleed) {
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(2, 2, w - 4, h - 4);
      }

      ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.strokeRect(
        bleedPxX + 1,
        bleedPxY + 1,
        w - bleedPxX * 2 - 2,
        h - bleedPxY * 2 - 2
      );

      const safeOffsetX = bleedPxX + (w - bleedPxX * 2) * 0.048;
      const safeOffsetY = bleedPxY + (h - bleedPxY * 2) * 0.048;
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(
        safeOffsetX,
        safeOffsetY,
        w - safeOffsetX * 2,
        h - safeOffsetY * 2
      );

      if (inputMode === 'full_card' && analysis.current.visualMaps) {
        const ab = analysis.current.visualMaps.artBoxNorm;
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(ab.x * w, ab.y * h, ab.w * w, ab.h * h);

        ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('ART ANALYSIS REGION', ab.x * w + 6, ab.y * h + 13);
      }

      ctx.restore();
    };

    const renderShadowHeatmapOnCanvas = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      drawBaseImage(ctx, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;
      const vm = analysis.current.visualMaps!;

      for (let y = 0; y < h; y++) {
        const mapY = Math.min(vm.anH - 1, Math.floor((y / h) * vm.anH));
        for (let x = 0; x < w; x++) {
          const mapX = Math.min(vm.anW - 1, Math.floor((x / w) * vm.anW));
          const mapIdx = mapY * vm.anW + mapX;
          const p = (y * w + x) * 4;

          const isMask = vm.inArtMask[mapIdx] === 1;
          const [ar, ag, ab] = isMask
            ? applyUserAdjustments(d[p], d[p + 1], d[p + 2], adjustments)
            : [d[p], d[p + 1], d[p + 2]];
          const [sr, sg, sb] = sample3DLut(ar, ag, ab, lut3D, 17);
          const risk = vm.shadowRiskMap![mapIdx];

          if (risk === 3) {
            d[p] = Math.min(255, sr * 0.3 + 239 * 0.7);
            d[p + 1] = Math.round(sg * 0.25);
            d[p + 2] = Math.round(sb * 0.25);
          } else if (risk === 2) {
            d[p] = Math.min(255, sr * 0.35 + 245 * 0.65);
            d[p + 1] = Math.min(255, sg * 0.35 + 158 * 0.65);
            d[p + 2] = Math.round(sb * 0.25);
          } else if (risk === 1) {
            d[p] = Math.round(sr * 0.3);
            d[p + 1] = Math.min(255, sg * 0.35 + 16 * 0.65 + 185 * 0.6);
            d[p + 2] = Math.min(255, sb * 0.35 + 129 * 0.6);
          } else {
            const gray = Math.round(0.299 * sr + 0.587 * sg + 0.114 * sb);
            d[p] = gray;
            d[p + 1] = gray;
            d[p + 2] = gray;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      drawGuidesOverlay(ctx, w, h);
    };

    if (viewMode === 'three_way') {
      const CW = 264;
      const CH = 360;

      // 1. Original sRGB Canvas
      if (origCompareCanvasRef.current) {
        const c = origCompareCanvasRef.current;
        c.width = CW;
        c.height = CH;
        const ctx = c.getContext('2d')!;
        drawBaseImage(ctx, CW, CH);
        drawGuidesOverlay(ctx, CW, CH);
      }

      // 2. Simulated Print (with Current User Adjustments + 3D LUT)
      if (simCompareCanvasRef.current) {
        const c = simCompareCanvasRef.current;
        c.width = CW;
        c.height = CH;
        const ctx = c.getContext('2d')!;
        drawBaseImage(ctx, CW, CH);
        const imgData = ctx.getImageData(0, 0, CW, CH);
        const d = imgData.data;
        const abNorm = analysis.current.visualMaps!.artBoxNorm;
        const ax0 = Math.floor(abNorm.x * CW);
        const ax1 = Math.ceil((abNorm.x + abNorm.w) * CW);
        const ay0 = Math.floor(abNorm.y * CH);
        const ay1 = Math.ceil((abNorm.y + abNorm.h) * CH);

        for (let y = 0; y < CH; y++) {
          for (let x = 0; x < CW; x++) {
            const i = (y * CW + x) * 4;
            const inRegion =
              inputMode === 'artwork_only' ||
              (x >= ax0 && x <= ax1 && y >= ay0 && y <= ay1);
            const [ar, ag, ab] = inRegion
              ? applyUserAdjustments(d[i], d[i + 1], d[i + 2], adjustments)
              : [d[i], d[i + 1], d[i + 2]];
            const [sr, sg, sb] = sample3DLut(ar, ag, ab, lut3D, 17);
            d[i] = sr;
            d[i + 1] = sg;
            d[i + 2] = sb;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        drawGuidesOverlay(ctx, CW, CH);
      }

      // 3. Shadow Loss Risk Heatmap (Highlighting crushed blacks per spec)
      if (heatmapCompareCanvasRef.current) {
        const c = heatmapCompareCanvasRef.current;
        c.width = CW;
        c.height = CH;
        const ctx = c.getContext('2d')!;
        renderShadowHeatmapOnCanvas(ctx, CW, CH);
      }
    } else if (mainPreviewCanvasRef.current) {
      const c = mainPreviewCanvasRef.current;
      c.width = DISP_W;
      c.height = DISP_H;
      const ctx = c.getContext('2d')!;

      if (viewMode === 'shadow_heatmap') {
        renderShadowHeatmapOnCanvas(ctx, DISP_W, DISP_H);
        return;
      }

      drawBaseImage(ctx, DISP_W, DISP_H);

      if (viewMode === 'original_srgb') {
        drawGuidesOverlay(ctx, DISP_W, DISP_H);
        return;
      }

      const imgData = ctx.getImageData(0, 0, DISP_W, DISP_H);
      const d = imgData.data;
      const vm = analysis.current.visualMaps!;

      for (let y = 0; y < DISP_H; y++) {
        const mapY = Math.min(vm.anH - 1, Math.floor((y / DISP_H) * vm.anH));
        for (let x = 0; x < DISP_W; x++) {
          const mapX = Math.min(vm.anW - 1, Math.floor((x / DISP_W) * vm.anW));
          const mapIdx = mapY * vm.anW + mapX;
          const p = (y * DISP_W + x) * 4;

          const isMask = vm.inArtMask[mapIdx] === 1;
          const [ar, ag, ab] = isMask
            ? applyUserAdjustments(d[p], d[p + 1], d[p + 2], adjustments)
            : [d[p], d[p + 1], d[p + 2]];
          const [sr, sg, sb] = sample3DLut(ar, ag, ab, lut3D, 17);

          if (viewMode === 'simulated' || viewMode === 'contrast_grid') {
            d[p] = sr;
            d[p + 1] = sg;
            d[p + 2] = sb;
          } else if (viewMode === 'gamut_heatmap') {
            const dE = vm.deltaEArr[mapIdx];
            if (vm.inArtMask[mapIdx] && dE > 6.5) {
              const intensity = Math.min(1, (dE - 6.5) / 14);
              d[p] = Math.round(sr * (1 - intensity * 0.75) + 236 * (intensity * 0.75));
              d[p + 1] = Math.round(sg * (1 - intensity * 0.75) + 72 * (intensity * 0.75));
              d[p + 2] = Math.round(sb * (1 - intensity * 0.75) + 153 * (intensity * 0.75));
            } else {
              const gray = Math.round(0.299 * sr + 0.587 * sg + 0.114 * sb);
              d[p] = Math.round(gray * 0.85);
              d[p + 1] = Math.round(gray * 0.85);
              d[p + 2] = Math.round(gray * 0.85);
            }
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);

      if (viewMode === 'contrast_grid') {
        const grid = vm.patchContrastGrid;
        const tileW = DISP_W / 8;
        const tileH = DISP_H / 8;
        ctx.save();
        for (let gy = 0; gy < 8; gy++) {
          for (let gx = 0; gx < 8; gx++) {
            const cell = grid[gy][gx];
            const tx = gx * tileW;
            const ty = gy * tileH;
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
            ctx.strokeRect(tx, ty, tileW, tileH);

            if (cell.active) {
              const isLow = cell.rms < 4.2;
              ctx.fillStyle = isLow
                ? 'rgba(244, 63, 94, 0.32)'
                : 'rgba(16, 185, 129, 0.16)';
              ctx.fillRect(tx + 1, ty + 1, tileW - 2, tileH - 2);

              ctx.fillStyle = isLow ? '#fda4af' : '#a7f3d0';
              ctx.font = 'bold 10px monospace';
              ctx.fillText(`±${cell.rms.toFixed(1)}`, tx + 5, ty + tileH / 2 + 4);
            }
          }
        }
        ctx.restore();
      }

      drawGuidesOverlay(ctx, DISP_W, DISP_H);
    }
  }, [
    sourceCanvas,
    analysis,
    viewMode,
    showGeometryGuides,
    adjustments,
    printerProfile,
    padMpcBleed,
    inputMode
  ]);

  const handleAutoOptimize = () => {
    if (!analysis) return;

    // If missing required 3mm MPC bleed, enable bleed padding automatically
    const nextPadBleed = cardStandard.requiresBleed && !analysis.geometry.has3mmBleed ? true : padMpcBleed;
    if (nextPadBleed !== padMpcBleed) {
      setPadMpcBleed(nextPadBleed);
    }

    // Run Coarse-to-Fine Coordinate Pattern Search with Tikhonov Regularization
    const optimalParams = optimizePrintAdjustments({
      rawPixels: analysis.rawAnalysisPixels,
      anW: analysis.anW,
      anH: analysis.anH,
      has3mmBleed: analysis.geometry.has3mmBleed || nextPadBleed,
      inputMode,
      printerProfile,
      printer3DLut: analysis.printer3DLut,
      resolutionScore: analysis.resolutionScore,
      applyUserAdjustmentsFn: applyUserAdjustments
    });

    setAdjustments(optimalParams);
  };

  const handleExportPng = () => {
    if (!sourceCanvas || !analysis) return;
    const outCanvas = renderCardToPrintReadyCanvas(
      sourceCanvas,
      padMpcBleed,
      analysis.geometry.has3mmBleed,
      inputMode,
      adjustments
    );

    const link = document.createElement('a');
    const baseName = customFileName
      ? customFileName.replace(/\.[^/.]+$/, '')
      : activePresetId || 'mtg_proxy';
    link.download = `${baseName}_print_ready_${outCanvas.width}x${outCanvas.height}.png`;
    link.href = outCanvas.toDataURL('image/png');
    link.click();
  };

  // Process a single canvas into an auto-optimized BatchCardItem
  const buildOptimizedBatchItem = useCallback(
    (c: HTMLCanvasElement, fileName: string, id: string): BatchCardItem => {
      const initialAnalysis = runFullPrintPipeline({
        sourceCanvas: c,
        inputMode,
        cardStandard,
        printerProfile,
        adjustments: { shadowLift: 0, gamma: 1.0, brightness: 0, contrast: 0, saturation: 0 },
        padMpcBleed: false
      })!;

      const shouldPadBleed =
        cardStandard.requiresBleed && !initialAnalysis.geometry.has3mmBleed;

      const workingAnalysis = shouldPadBleed
        ? runFullPrintPipeline({
            sourceCanvas: c,
            inputMode,
            cardStandard,
            printerProfile,
            adjustments: { shadowLift: 0, gamma: 1.0, brightness: 0, contrast: 0, saturation: 0 },
            padMpcBleed: true
          })!
        : initialAnalysis;

      const optParams = optimizePrintAdjustments({
        rawPixels: workingAnalysis.rawAnalysisPixels,
        anW: workingAnalysis.anW,
        anH: workingAnalysis.anH,
        has3mmBleed: workingAnalysis.geometry.has3mmBleed,
        inputMode,
        printerProfile,
        printer3DLut: workingAnalysis.printer3DLut,
        resolutionScore: workingAnalysis.resolutionScore,
        applyUserAdjustmentsFn: applyUserAdjustments
      });

      const finalAnalysis = runFullPrintPipeline({
        sourceCanvas: c,
        inputMode,
        cardStandard,
        printerProfile,
        adjustments: optParams,
        padMpcBleed: shouldPadBleed
      })!;

      const thumbs = generateBatchThumbnails(
        c,
        shouldPadBleed,
        finalAnalysis.geometry.has3mmBleed,
        inputMode,
        optParams,
        finalAnalysis.printer3DLut
      );

      return {
        id,
        fileName,
        sourceCanvas: c,
        padBleed: shouldPadBleed,
        adjustments: optParams,
        baselineScores: initialAnalysis.baseline.scores,
        optimizedScores: finalAnalysis.current.scores,
        geometry: finalAnalysis.geometry,
        origThumbUrl: thumbs.origThumbUrl,
        simThumbUrl: thumbs.simThumbUrl
      };
    },
    [inputMode, cardStandard, printerProfile]
  );

  // Re-optimize existing batch items whenever inputMode, cardStandard, or printerProfile changes
  useEffect(() => {
    if (batchItems.length === 0) return;
    setBatchItems((prev) =>
      prev.map((item) => buildOptimizedBatchItem(item.sourceCanvas, item.fileName, item.id))
    );
  }, [inputMode, cardStandardId, printerProfileId]);

  // Handle multi-file upload in Batch Auto-Adjust mode
  const handleBatchFilesUpload = useCallback(
    async (fileList: FileList | File[] | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      setIsBatchProcessing(true);
      setStudioMode('batch');

      const loadFileAsCanvas = (file: File): Promise<{ canvas: HTMLCanvasElement; name: string }> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
              const c = document.createElement('canvas');
              c.width = img.naturalWidth || img.width;
              c.height = img.naturalHeight || img.height;
              const ctx = c.getContext('2d')!;
              ctx.drawImage(img, 0, 0);
              resolve({ canvas: c, name: file.name });
            };
            img.onerror = reject;
            img.src = e.target?.result as string;
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

      try {
        const newItems: BatchCardItem[] = [];
        for (let i = 0; i < files.length; i++) {
          const { canvas, name } = await loadFileAsCanvas(files[i]);
          const id = `${Date.now()}_${i}_${name}`;
          newItems.push(buildOptimizedBatchItem(canvas, name, id));
        }
        setBatchItems((prev) => [...prev, ...newItems]);
      } finally {
        setIsBatchProcessing(false);
      }
    },
    [buildOptimizedBatchItem]
  );

  // Load the 4 built-in calibration cards into Batch mode for instant demo/testing
  const handleLoadDemoBatch = () => {
    setIsBatchProcessing(true);
    setStudioMode('batch');
    setTimeout(() => {
      const demoItems = BUILTIN_PRESETS.map((preset, idx) => {
        const c = generatePresetCardCanvas(preset.id);
        return buildOptimizedBatchItem(c, `${preset.id}.png`, `demo_${Date.now()}_${idx}`);
      });
      setBatchItems(demoItems);
      setIsBatchProcessing(false);
    }, 20);
  };

  // Export all batch items as a single print-ready ZIP archive
  const handleExportBatchZip = async () => {
    if (batchItems.length === 0) return;
    setIsExportingZip(true);

    setTimeout(() => {
      try {
        const entries: ZipEntryInput[] = batchItems.map((item, idx) => {
          const outCanvas = renderCardToPrintReadyCanvas(
            item.sourceCanvas,
            item.padBleed,
            item.geometry.has3mmBleed,
            inputMode,
            item.adjustments
          );
          const dataUrl = outCanvas.toDataURL('image/png');
          const bytes = dataUrlToUint8Array(dataUrl);
          const cleanName = item.fileName.replace(/\.[^/.]+$/, '');
          return {
            filename: `${String(idx + 1).padStart(2, '0')}_${cleanName}_print_ready_${outCanvas.width}x${outCanvas.height}.png`,
            data: bytes
          };
        });

        const zipBlob = createZipArchive(entries);
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `proxyprint_batch_${printerProfileId}_${batchItems.length}cards.zip`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } finally {
        setIsExportingZip(false);
      }
    }, 20);
  };

  // Open a specific batch card in Single Card Inspector for manual fine-tuning
  const handleInspectBatchItem = (item: BatchCardItem) => {
    setActivePresetId(null);
    setCustomFileName(item.fileName);
    setSourceCanvas(item.sourceCanvas);
    setPadMpcBleed(item.padBleed);
    setAdjustments({ ...item.adjustments });
    setStudioMode('single');
  };

  const resetAdjustments = () => {
    setAdjustments({
      shadowLift: 0,
      gamma: 1.0,
      brightness: 0,
      contrast: 0,
      saturation: 0
    });
    setPadMpcBleed(false);
  };

  const hasAnyAdjustment =
    adjustments.shadowLift !== 0 ||
    adjustments.gamma !== 1.0 ||
    adjustments.brightness !== 0 ||
    adjustments.contrast !== 0 ||
    adjustments.saturation !== 0 ||
    padMpcBleed;

  const getScoreBadgeStyle = (score: number) => {
    if (score >= 82)
      return {
        text: 'text-emerald-400',
        bg: 'bg-emerald-500/15',
        border: 'border-emerald-500/30',
        bar: 'bg-emerald-500',
        label: 'Print-Ready'
      };
    if (score >= 65)
      return {
        text: 'text-amber-400',
        bg: 'bg-amber-500/15',
        border: 'border-amber-500/30',
        bar: 'bg-amber-500',
        label: 'Test Print / Adjust'
      };
    return {
      text: 'text-rose-400',
      bg: 'bg-rose-500/15',
      border: 'border-rose-500/30',
      bar: 'bg-rose-500',
      label: 'High Print Risk'
    };
  };

  if (!analysis) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <Activity className="w-5 h-5 animate-spin text-indigo-400" />
          <span>Initializing ProxyPrint Lab Color Engine...</span>
        </div>
      </div>
    );
  }

  const curScores = analysis.current.scores;
  const baseScores = analysis.baseline.scores;
  const curMetrics = analysis.current.metrics;
  const geom = analysis.geometry;
  const overallStyle = getScoreBadgeStyle(curScores.overall);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* ================================================================== */}
      {/* TOP STUDIO HEADER                                                  */}
      {/* ================================================================== */}
      <header className="border-b border-slate-800/80 bg-slate-900/75 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Printer className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  ProxyPrint Lab
                </h1>
                <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  6-Stage Soft-Proofing Studio
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                    backendStatus === 'connected'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                  }`}
                >
                  {backendStatus === 'connected' ? (
                    <>
                      <Server className="w-3 h-3" />
                      FastAPI + 3D LUT Active
                    </>
                  ) : (
                    <>
                      <Cpu className="w-3 h-3" />
                      60 FPS Client 3D LUT Engine
                    </>
                  )}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                MTG & TCG Custom Artwork Printability Checker • CIELAB 11×11 Shadow Crush, 2D FFT Sharpness & ΔE_2000 Gamut Simulator
              </p>
            </div>
          </div>

          {/* Right Header Actions: Mode Switcher, Overall Suitability Pill & Export */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Studio Mode Switcher: Single Card vs Batch Auto-Adjust & ZIP */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setStudioMode('single')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  studioMode === 'single'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                Single Card Studio
              </button>
              <button
                onClick={() => setStudioMode('batch')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  studioMode === 'batch'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FolderArchive className="w-3.5 h-3.5" />
                Batch Auto-Adjust &amp; ZIP
                {batchItems.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    {batchItems.length}
                  </span>
                )}
              </button>
            </div>

            {studioMode === 'single' ? (
              <>
                <div
                  className={`flex items-center gap-3 px-3.5 py-1.5 rounded-xl border ${overallStyle.bg} ${overallStyle.border}`}
                >
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                      Overall Printability
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-xl font-extrabold ${overallStyle.text}`}>
                        {curScores.overall}/100
                      </span>
                      {hasAnyAdjustment && curScores.overall !== baseScores.overall && (
                        <span className="text-xs font-semibold text-emerald-400">
                          ({curScores.overall > baseScores.overall ? '+' : ''}
                          {curScores.overall - baseScores.overall} vs original)
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${overallStyle.bg} ${overallStyle.border} ${overallStyle.text}`}
                  >
                    {overallStyle.label}
                  </span>
                </div>

                <button
                  onClick={handleAutoOptimize}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  Auto-Optimize for Printer
                </button>

                <button
                  onClick={handleExportPng}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  <Download className="w-4 h-4 text-indigo-400" />
                  Export Print-Ready PNG
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => batchFileInputRef.current?.click()}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-indigo-400" />
                  Add Cards to Batch
                </button>
                <input
                  ref={batchFileInputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    handleBatchFilesUpload(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={handleExportBatchZip}
                  disabled={batchItems.length === 0 || isExportingZip}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer ${
                    batchItems.length === 0 || isExportingZip
                      ? 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
                      : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/25'
                  }`}
                >
                  <FolderArchive className="w-4 h-4" />
                  {isExportingZip
                    ? 'Building ZIP...'
                    : `Export All as ZIP (${batchItems.length})`}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ================================================================== */}
      {/* MAIN 3-COLUMN WORKSPACE                                            */}
      {/* ================================================================== */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ================================================================ */}
        {/* LEFT COLUMN (3 COLS): PRESETS, UPLOAD & STAGE 1 PRINT CONFIG     */}
        {/* ================================================================ */}
        <section className="lg:col-span-3 space-y-5">
          {/* Card Source & Built-in Diagnostic Presets */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-indigo-400" />
                1. Card Artwork Source
              </h2>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => handleImageUpload(e.target.files?.[0])}
              />
            </div>

            {/* Drag and Drop Zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleImageUpload(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700/80 hover:border-indigo-500/60 bg-slate-950/50 rounded-xl p-3 text-center cursor-pointer transition mb-3"
            >
              <p className="text-xs font-medium text-slate-300">
                {customFileName ? (
                  <span className="text-indigo-400 font-semibold">
                    Loaded: {customFileName}
                  </span>
                ) : (
                  'Drop custom MTG proxy / artwork here or click to browse'
                )}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                PNG, JPG, WebP • 60 FPS 3D-LUT Soft-Proofing
              </p>
            </div>

            {/* 4 Built-in Calibration Presets */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-slate-400">
                Or test built-in diagnostic calibration cards:
              </div>
              {BUILTIN_PRESETS.map((preset) => {
                const isSelected = activePresetId === preset.id && !customFileName;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setActivePresetId(preset.id)}
                    className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-500/15 border-indigo-500/60 shadow-md'
                        : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-100">
                        {preset.name}
                      </span>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${preset.tagColor}`}
                      >
                        {preset.tag}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                      {preset.summary}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stage 1 Configuration: Input Mode, Card Size & Printer Profile */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Printer className="w-4 h-4 text-indigo-400" />
              2. Print Target & Geometry
            </h2>

            {/* Input Mode Toggle */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                Analysis & Adjustment Region
              </label>
              <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setInputMode('full_card')}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    inputMode === 'full_card'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Art Box Only
                </button>
                <button
                  onClick={() => setInputMode('artwork_only')}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    inputMode === 'artwork_only'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Entire Card
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                {inputMode === 'full_card'
                  ? 'Only analyzes and adjusts the Art Analysis Region, keeping the black card border and text box untouched.'
                  : 'Analyzes and adjusts 100% of pixels across the entire card (including borders and frame).'}
              </p>
            </div>

            {/* Card Dimensions & Bleed Standard */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                Card Size & Bleed Standard
              </label>
              <div className="space-y-1.5">
                {Object.values(CARD_STANDARDS).map((std) => (
                  <button
                    key={std.id}
                    onClick={() => setCardStandardId(std.id)}
                    className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                      cardStandardId === std.id
                        ? 'bg-indigo-500/15 border-indigo-500/60'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-100">{std.name}</div>
                    <div className="text-[11px] text-slate-400">{std.subtitle}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Printer & Cardstock Soft-Proofing Profile */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                Synthetic Printer & Cardstock Profile
              </label>
              <div className="space-y-2">
                {Object.values(PRINTER_PROFILES).map((prof) => (
                  <button
                    key={prof.id}
                    onClick={() => setPrinterProfileId(prof.id)}
                    className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                      printerProfileId === prof.id
                        ? 'bg-purple-500/15 border-purple-500/60'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-slate-100">
                        {prof.name}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-purple-300">
                        {prof.badge}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        L*min={prof.blackFloorL}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">
                      {prof.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================ */}
        {/* CENTER & RIGHT COLUMNS: SINGLE CARD STUDIO vs BATCH QUEUE        */}
        {/* ================================================================ */}
        {studioMode === 'batch' ? (
          <section className="lg:col-span-9 flex flex-col gap-5">
            {/* Batch Upload & Summary Control Bar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                    <FolderArchive className="w-4 h-4 text-indigo-400" />
                    Batch Auto-Adjust &amp; Print-Ready ZIP Exporter
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Upload multiple cards at once — each card is individually analyzed and auto-optimized for{' '}
                    <span className="text-indigo-300 font-semibold">{printerProfile.name}</span>{' '}
                    ({inputMode === 'full_card' ? 'Art Box Only' : 'Entire Card'}).
                  </p>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    onClick={handleLoadDemoBatch}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Load 4 Sample Cards
                  </button>
                  {batchItems.length > 0 && (
                    <button
                      onClick={() => setBatchItems([])}
                      className="px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear All
                    </button>
                  )}
                  <button
                    onClick={handleExportBatchZip}
                    disabled={batchItems.length === 0 || isExportingZip}
                    className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg transition cursor-pointer ${
                      batchItems.length === 0 || isExportingZip
                        ? 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
                        : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/25'
                    }`}
                  >
                    <FolderArchive className="w-4 h-4" />
                    {isExportingZip
                      ? 'Packaging ZIP Archive...'
                      : `Download Print-Ready ZIP (${batchItems.length} Cards)`}
                  </button>
                </div>
              </div>

              {/* Multi-File Drag & Drop Zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleBatchFilesUpload(e.dataTransfer.files);
                }}
                onClick={() => batchFileInputRef.current?.click()}
                className="border-2 border-dashed border-indigo-500/40 hover:border-indigo-400 bg-slate-950/70 rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2"
              >
                <div className="w-10 h-10 rounded-full bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-sm font-bold text-slate-200">
                  {isBatchProcessing
                    ? 'Analyzing & Auto-Optimizing Cards...'
                    : 'Drop multiple MTG proxy images here or click to select files'}
                </div>
                <p className="text-xs text-slate-400 max-w-xl">
                  Automatically runs the 6-Stage Pipeline + Coarse-to-Fine Pattern Search on every card, pads missing 3mm MPC bleed if required, and packages all compensated PNGs into a single `.zip`.
                </p>
              </div>
            </div>

            {/* Batch Cards Grid */}
            {batchItems.length === 0 ? (
              <div className="flex-1 bg-slate-900/50 border border-slate-800/80 rounded-2xl p-12 flex flex-col items-center justify-center text-center">
                <FolderArchive className="w-10 h-10 text-slate-600 mb-3" />
                <h3 className="text-sm font-bold text-slate-300">
                  No Cards in Batch Queue Yet
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md">
                  Select multiple PNG/JPG/WebP card images above, or click &ldquo;Load 4 Sample Cards&rdquo; to test instant batch optimization and ZIP export.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {batchItems.map((item) => {
                  const baseScore = item.baselineScores.overall;
                  const optScore = item.optimizedScores.overall;
                  const diff = optScore - baseScore;
                  const badge = getScoreBadgeStyle(optScore);

                  return (
                    <div
                      key={item.id}
                      className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col justify-between gap-3"
                    >
                      <div>
                        {/* Card Header */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="min-w-0">
                            <div
                              className="text-xs font-bold text-white truncate"
                              title={item.fileName}
                            >
                              {item.fileName}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {item.geometry.effectiveW}×{item.geometry.effectiveH}px •{' '}
                              {item.geometry.effectiveOpticalPpi} PPI
                              {item.padBleed ? ' • +3mm Bleed Added' : ''}
                            </div>
                          </div>
                          <button
                            onClick={() =>
                              setBatchItems((prev) => prev.filter((x) => x.id !== item.id))
                            }
                            className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer"
                            title="Remove from batch"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Before / After Thumbnails */}
                        <div className="grid grid-cols-2 gap-2.5 bg-slate-950/90 p-2.5 rounded-xl border border-slate-800">
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] font-semibold text-slate-400 mb-1">
                              Original ({baseScore}/100)
                            </span>
                            <img
                              src={item.origThumbUrl}
                              alt="Original"
                              className="w-full max-w-[125px] h-auto rounded-lg border border-slate-800"
                            />
                          </div>
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] font-bold text-emerald-400 mb-1 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Auto-Adjusted ({optScore}/100)
                            </span>
                            <img
                              src={item.simThumbUrl}
                              alt="Simulated Print"
                              className="w-full max-w-[125px] h-auto rounded-lg border border-indigo-500/50 shadow-md"
                            />
                          </div>
                        </div>

                        {/* Applied Optimal Parameters Pills */}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                            Toe Lift: +{item.adjustments.shadowLift}%
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            γ: {item.adjustments.gamma.toFixed(2)}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            Contrast: {item.adjustments.contrast >= 0 ? `+${item.adjustments.contrast}` : item.adjustments.contrast}%
                          </span>
                          {item.adjustments.saturation !== 0 && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                              Sat: {item.adjustments.saturation >= 0 ? `+${item.adjustments.saturation}` : item.adjustments.saturation}%
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Footer Score & Open in Studio Button */}
                      <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badge.bg} ${badge.border} ${badge.text}`}
                          >
                            {badge.label}
                          </span>
                          {diff !== 0 && (
                            <span className="text-[11px] font-bold text-emerald-400">
                              {diff > 0 ? `+${diff}` : diff} pts
                            </span>
                          )}
                        </div>

                        <button
                          onClick={() => handleInspectBatchItem(item)}
                          className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                        >
                          <Sliders className="w-3 h-3" />
                          Fine-Tune in Studio
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
        <>
        {/* ================================================================ */}
        {/* CENTER COLUMN (5 COLS): SOFT-PROOFING VIEWER & HISTOGRAM         */}
        {/* ================================================================ */}
        <section className="lg:col-span-5 flex flex-col gap-5">
          {/* Interactive Visual Inspection Toolbar */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setViewMode('three_way')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    viewMode === 'three_way'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  3-Way Preview
                </button>
                <button
                  onClick={() => setViewMode('original_srgb')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    viewMode === 'original_srgb'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  Original sRGB
                </button>
                <button
                  onClick={() => setViewMode('simulated')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    viewMode === 'simulated'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Simulated Print
                </button>
                <button
                  onClick={() => setViewMode('shadow_heatmap')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    viewMode === 'shadow_heatmap'
                      ? 'bg-rose-600 text-white shadow'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" />
                  Shadow Loss Heatmap
                </button>
                <button
                  onClick={() => setViewMode('gamut_heatmap')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    viewMode === 'gamut_heatmap'
                      ? 'bg-fuchsia-600 text-white shadow'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" />
                  ΔE_2000 Shift
                </button>
                <button
                  onClick={() => setViewMode('contrast_grid')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    viewMode === 'contrast_grid'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Grid className="w-3.5 h-3.5" />
                  8×8 Contrast
                </button>
              </div>

              <button
                onClick={() => setShowGeometryGuides(!showGeometryGuides)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                  showGeometryGuides
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                {showGeometryGuides ? 'Guides: ON' : 'Guides: OFF'}
              </button>
            </div>

            {/* Canvas Display Area */}
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-950/90 rounded-xl border border-slate-800/80 p-4 min-h-[420px]">
              {viewMode === 'three_way' ? (
                <div className="w-full space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                    {/* Preview 1: Original sRGB */}
                    <div className="flex flex-col items-center bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                      <span className="text-[11px] font-bold text-slate-200 mb-1">
                        1. Original sRGB
                      </span>
                      <span className="text-[10px] text-slate-400 mb-2 text-center">
                        Backlit monitor emission
                      </span>
                      <canvas
                        ref={origCompareCanvasRef}
                        className="w-full max-w-[210px] h-auto rounded-lg shadow-lg border border-slate-700"
                      />
                      <div className="mt-2 text-[11px] text-slate-300 font-medium">
                        Baseline Score:{' '}
                        <span className="font-bold text-amber-400">
                          {baseScores.overall}/100
                        </span>
                      </div>
                    </div>

                    {/* Preview 2: Simulated Print with User Adjustments */}
                    <div className="flex flex-col items-center bg-indigo-950/30 p-2.5 rounded-xl border-2 border-indigo-500/60 shadow-lg">
                      <span className="text-[11px] font-bold text-indigo-300 mb-1 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" />
                        2. Simulated Print {hasAnyAdjustment ? '(Live LUT)' : ''}
                      </span>
                      <span className="text-[10px] text-indigo-200/70 mb-2 text-center">
                        {printerProfile.badge} • L*min={printerProfile.blackFloorL}
                      </span>
                      <canvas
                        ref={simCompareCanvasRef}
                        className="w-full max-w-[210px] h-auto rounded-lg shadow-lg border border-indigo-500/40"
                      />
                      <div className="mt-2 text-[11px] text-slate-200 font-medium">
                        Shadow Score:{' '}
                        <span className="font-bold text-emerald-400">
                          {curScores.shadow}/100
                        </span>
                      </div>
                    </div>

                    {/* Preview 3: Shadow Loss Risk Heatmap */}
                    <div className="flex flex-col items-center bg-slate-900/80 p-2.5 rounded-xl border border-rose-500/40">
                      <span className="text-[11px] font-bold text-rose-300 mb-1 flex items-center gap-1">
                        <Flame className="w-3.5 h-3.5" />
                        3. Shadow Loss Risk Heatmap
                      </span>
                      <span className="text-[10px] text-slate-400 mb-2 text-center">
                        11×11 Window Crush Risk
                      </span>
                      <canvas
                        ref={heatmapCompareCanvasRef}
                        className="w-full max-w-[210px] h-auto rounded-lg shadow-lg border border-slate-700"
                      />
                      <div className="mt-2 text-[11px] text-rose-300/90 font-medium">
                        Crushed Dark Area: {curMetrics.crushedShadowPct}%
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <canvas
                    ref={mainPreviewCanvasRef}
                    className="max-w-[330px] w-full h-auto rounded-xl shadow-2xl border border-slate-700"
                  />
                </div>
              )}

              {/* Legend for Overlays & Geometry Guides */}
              <div className="w-full mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                {viewMode === 'shadow_heatmap' || viewMode === 'three_way' ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-slate-200">
                      Shadow Heatmap:
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />
                      Red: Crushed (L*&lt;15 / Low 11×11 StdDev)
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
                      Yellow: Moderate
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                      Green: Crisp Shadow Texture
                    </span>
                  </div>
                ) : viewMode === 'gamut_heatmap' ? (
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="font-semibold text-slate-200">
                      CMYK Color Gamut Shift (ΔE_2000):
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm bg-pink-500 inline-block" />
                      Magenta Highlight: Out-of-gamut color shift (ΔE_00 &gt; 6.5)
                    </span>
                    <span>Mean ΔE_00: {curMetrics.meanDeltaE}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-0.5 bg-rose-500 inline-block" />
                      3mm Bleed Edge
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" />
                      63×88mm Cut Line
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" />
                      Safe Margin
                    </span>
                    {inputMode === 'full_card' && (
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-0.5 bg-amber-400 inline-block" />
                        Art Analysis Window
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Perceptual CIELAB L* Luminance Histogram & Printer Black Floor Cutoff */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  CIELAB Perceptual Lightness (L*) Histogram
                </h3>
                <p className="text-[11px] text-slate-400">
                  Red zone indicates tones in the crush zone (L* &lt; 15 / ink floor L*={' '}
                  {printerProfile.blackFloorL}) where shadow details merge.
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1.5 text-indigo-300">
                  <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500/70 inline-block" />
                  Artwork L*
                </span>
                <span className="flex items-center gap-1.5 text-rose-300">
                  <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/40 border border-rose-500 inline-block" />
                  Crush Zone (L*&lt;15: {curMetrics.pctUnder15}%)
                </span>
              </div>
            </div>

            {/* Histogram SVG Bars */}
            <div className="relative h-28 bg-slate-950 rounded-xl border border-slate-800 p-2 flex items-end gap-[2px] overflow-hidden">
              <div
                className="absolute top-0 bottom-0 left-0 bg-rose-500/15 border-r border-dashed border-rose-500/70 z-10 pointer-events-none flex items-start justify-end pr-1 pt-1"
                style={{ width: `${printerProfile.shadowCrushThreshold}%` }}
              >
                <span className="text-[9px] font-bold text-rose-300 uppercase">
                  Dot-Gain Crush Zone
                </span>
              </div>

              {analysis.current.histograms.original.map((count: number, idx: number) => {
                const maxBin = Math.max(...analysis.current.histograms.original, 1);
                const heightPct = Math.min(100, Math.round((count / maxBin) * 100));
                const binL = idx * 2;
                const isInCrush = binL < 15 || binL < printerProfile.blackFloorL;
                const isInShadow = binL < 22;
                return (
                  <div
                    key={idx}
                    className="flex-1 h-full flex items-end"
                    title={`L* ${binL}–${binL + 2}: ${count} px`}
                  >
                    <div
                      className={`w-full rounded-t transition-all duration-150 ${
                        isInCrush
                          ? 'bg-rose-500'
                          : isInShadow
                          ? 'bg-amber-400/85'
                          : 'bg-indigo-500/75'
                      }`}
                      style={{ height: `${Math.max(3, heightPct)}%` }}
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1.5 px-1">
              <span>L*=0 (Pure Black)</span>
              <span>L*&lt;15 ({curMetrics.pctUnder15}% px)</span>
              <span>L*&lt;20 ({curMetrics.pctUnder20}% px)</span>
              <span>L*=50 (Midtones)</span>
              <span>L*=100 (Paper White)</span>
            </div>
          </div>
        </section>

        {/* ================================================================ */}
        {/* RIGHT COLUMN (4 COLS): 6-STAGE REPORT & ADJUSTMENT SIMULATOR     */}
        {/* ================================================================ */}
        <section className="lg:col-span-4 flex flex-col gap-5">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                3. Live Adjustment Simulator (60 FPS)
              </h2>
              {hasAnyAdjustment && (
                <button
                  onClick={resetAdjustments}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              )}
            </div>

            {/* Live Before -> After Score Comparison Banner */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] uppercase text-slate-400 font-semibold">
                  Original Shadow
                </div>
                <div className="text-base font-bold text-slate-300">
                  {baseScores.shadow}/100
                </div>
              </div>
              <div className="border-x border-slate-800">
                <div className="text-[10px] uppercase text-indigo-300 font-semibold">
                  Adjusted Shadow
                </div>
                <div className="text-base font-extrabold text-emerald-400">
                  {curScores.shadow}/100
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-400 font-semibold">
                  Detail Retained
                </div>
                <div className="text-base font-bold text-indigo-400">
                  {curMetrics.shadowRetentionPct}%
                </div>
              </div>
            </div>

            {/* 5 Adjustment Sliders */}
            <div className="space-y-3">
              {/* Slider 1: Shadow Recovery (Toe Lift) */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Moon className="w-3.5 h-3.5 text-indigo-400" />
                    Shadow Recovery (Toe Lift)
                  </span>
                  <span className="font-mono text-indigo-300 font-bold">
                    +{adjustments.shadowLift}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="80"
                  step="1"
                  value={adjustments.shadowLift}
                  onChange={(e) =>
                    setAdjustments((prev) => ({
                      ...prev,
                      shadowLift: Number(e.target.value)
                    }))
                  }
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400">
                  Selectively lifts L* 3–25 above the printer&apos;s black crush floor without washing out highlights.
                </p>
              </div>

              {/* Slider 2: Gamma */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-200">
                    Midtone Gamma
                  </span>
                  <span className="font-mono text-indigo-300 font-bold">
                    {adjustments.gamma.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.75"
                  max="1.45"
                  step="0.02"
                  value={adjustments.gamma}
                  onChange={(e) =>
                    setAdjustments((prev) => ({
                      ...prev,
                      gamma: Number(e.target.value)
                    }))
                  }
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              {/* Slider 3: Local Contrast */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-200">
                    Tonal Contrast
                  </span>
                  <span className="font-mono text-indigo-300 font-bold">
                    {adjustments.contrast > 0 ? `+${adjustments.contrast}` : adjustments.contrast}%
                  </span>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="40"
                  step="1"
                  value={adjustments.contrast}
                  onChange={(e) =>
                    setAdjustments((prev) => ({
                      ...prev,
                      contrast: Number(e.target.value)
                    }))
                  }
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              {/* Slider 4 & 5: Global Brightness & Saturation */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-200">Brightness</span>
                    <span className="font-mono text-slate-300">
                      {adjustments.brightness > 0
                        ? `+${adjustments.brightness}`
                        : adjustments.brightness}
                      %
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-25"
                    max="35"
                    step="1"
                    value={adjustments.brightness}
                    onChange={(e) =>
                      setAdjustments((prev) => ({
                        ...prev,
                        brightness: Number(e.target.value)
                      }))
                    }
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-200">Saturation</span>
                    <span className="font-mono text-slate-300">
                      {adjustments.saturation > 0
                        ? `+${adjustments.saturation}`
                        : adjustments.saturation}
                      %
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-35"
                    max="35"
                    step="1"
                    value={adjustments.saturation}
                    onChange={(e) =>
                      setAdjustments((prev) => ({
                        ...prev,
                        saturation: Number(e.target.value)
                      }))
                    }
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* 3mm MPC Bleed Padding Toggle */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Add 3mm MPC Black Bleed Border
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Pads trim-sized cards (63×88mm → 69×94mm) for die-cutting safety
                  </div>
                </div>
                <button
                  onClick={() => setPadMpcBleed(!padMpcBleed)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                    padMpcBleed
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {padMpcBleed ? 'Added (+3mm)' : 'Off'}
                </button>
              </div>
            </div>
          </div>

          {/* 6-Stage Pipeline Breakdown & Bottleneck-Capped Scores */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-indigo-400" />
                4. 6-Stage Diagnostic Scorecard
              </h2>
              <span className="text-[11px] font-mono text-slate-400">
                Q = min(Weighted, min(R,S,C)+15)
              </span>
            </div>

            {/* Bottleneck Cap Warning Banner */}
            {curScores.isBottleneckCapped && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-200 leading-relaxed">
                  <span className="font-bold">Critical Bottleneck Cap Active:</span> Linear weighted score would be{' '}
                  <span className="font-mono font-bold">{curScores.weightedRaw}/100</span>, but{' '}
                  <span className="font-bold underline">{curScores.bottleneckMetric}</span> is critically low, capping Overall Print Suitability at{' '}
                  <span className="font-mono font-bold">{curScores.overall}/100</span>.
                </div>
              </div>
            )}

            <div className="space-y-3">
              <StageScoreCard
                title="Stage 1 & 2: Resolution, FFT Sharpness & Bleed"
                weight="20%"
                score={curScores.resolution}
                baseScore={baseScores.resolution}
                metrics={[
                  `Size: ${geom.effectiveW}×${geom.effectiveH}px`,
                  `Nominal: ${geom.nominalPpi} PPI`,
                  `Optical: ${geom.effectiveOpticalPpi} PPI`,
                  `FFT HF: ${geom.fftSharpnessRatio}%`,
                  `3mm Bleed: ${geom.has3mmBleed ? 'Yes' : 'Missing'}`
                ]}
                explanation={
                  geom.isLikelyUpscaled
                    ? 'Warning: High pixel count detected, but Laplacian edge gradient & 2D FFT high-frequency energy are low. This image appears upscaled from a low-res source.'
                    : cardStandard.requiresBleed && !geom.has3mmBleed
                    ? 'Missing 3mm bleed margin for commercial cutting. Toggle "Add 3mm MPC Black Bleed Border" above.'
                    : 'Sharp enough for trading card viewing distance with clean high-frequency edge gradients.'
                }
              />

              <StageScoreCard
                title="Stage 3: Shadow Detail Retention (11×11 Window)"
                weight="35%"
                score={curScores.shadow}
                baseScore={baseScores.shadow}
                metrics={[
                  `Crush Zone L*<15: ${curMetrics.pctUnder15}%`,
                  `Crushed Dark Area: ${curMetrics.crushedShadowPct}%`,
                  `11×11 Gradient Kept: ${curMetrics.shadowRetentionPct}%`
                ]}
                explanation={
                  curScores.shadow < 65
                    ? `High risk of muddy shadows: ${curMetrics.crushedShadowPct}% of artwork pixels have low 11×11 local standard deviation inside the crush zone (L*<15 / ink floor L*=${printerProfile.blackFloorL}).`
                    : 'Dark regions retain crisp 11×11 local luminance gradients on the selected paper profile.'
                }
              />

              <StageScoreCard
                title="Stage 4: Local Contrast (8×8 CLAHE Grid)"
                weight="15%"
                score={curScores.contrast}
                baseScore={baseScores.contrast}
                metrics={[
                  `Mean Patch RMS: ±${curMetrics.avgPatchRms} L*`,
                  `Low-Contrast Tiles: ${curMetrics.lowContrastPatches}/64`
                ]}
                explanation={
                  curScores.contrast < 68
                    ? 'Several 8×8 regions have compressed tonal separation and may look flat in reflected light.'
                    : 'Strong local RMS contrast across midtones and highlights.'
                }
              />

              <StageScoreCard
                title="Stage 4b: Highlight Detail & Paper White"
                weight="10%"
                score={curScores.highlight}
                baseScore={baseScores.highlight}
                metrics={[
                  `L*>95 Clipped: ${curMetrics.pctOver95}%`,
                  `Paper White L*: ${printerProfile.paperWhiteL}`
                ]}
                explanation={
                  curScores.highlight < 75
                    ? 'Bright regions risk blowing out to bare paper white with loss of specular detail.'
                    : 'Bright areas retain smooth gradations without clipping to bare cardstock.'
                }
              />

              <StageScoreCard
                title="Stage 5: Color Gamut & Output Simulation (ΔE_2000)"
                weight="20%"
                score={curScores.color}
                baseScore={baseScores.color}
                metrics={[
                  `Mean ΔE_00: ${curMetrics.meanDeltaE}`,
                  `Pixels ΔE_00>6.5: ${curMetrics.pctHighDeltaE}%`
                ]}
                explanation={
                  curScores.color < 68
                    ? `${curMetrics.pctHighDeltaE}% of artwork contains out-of-gamut neon greens, cyans, or deep blues that shift noticeably (ΔE_2000 > 6.5) when printed.`
                    : 'Colors fall comfortably within the reproducible gamut of the selected printer and paper.'
                }
              />
            </div>
          </div>
        </section>
        </>
        )}
      </main>
    </div>
  );
}

// ============================================================================
// SUBCOMPONENT: STAGE SCORE CARD
// ============================================================================

function StageScoreCard({ title, weight, score, baseScore, metrics, explanation }: any) {
  const diff = score - baseScore;
  const barColor =
    score >= 80 ? 'bg-emerald-500' : score >= 62 ? 'bg-amber-500' : 'bg-rose-500';
  const textColor =
    score >= 80 ? 'text-emerald-400' : score >= 62 ? 'text-amber-400' : 'text-rose-400';

  return (
    <div className="bg-slate-950/75 border border-slate-800/90 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-200">{title}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
            w={weight}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          {diff !== 0 && (
            <span
              className={`text-[11px] font-bold ${
                diff > 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {diff > 0 ? `+${diff}` : diff}
            </span>
          )}
          <span className={`text-sm font-extrabold font-mono ${textColor}`}>
            {score}/100
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${Math.max(4, score)}%` }}
        />
      </div>

      {/* Key Metric Pills */}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {metrics.map((m: string, i: number) => (
          <span
            key={i}
            className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
          >
            {m}
          </span>
        ))}
      </div>

      {/* Diagnostic Explanation */}
      <p className="text-[11px] text-slate-400 leading-snug">{explanation}</p>
    </div>
  );
}
