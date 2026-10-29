import { AdjustmentParams } from './colorScience';
import { PrinterProfile } from './types';

export function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Applies user adjustments (Shadow Recovery Toe Lift, Gamma, Brightness, Contrast, Saturation)
 * to an RGB triplet.
 */
export function applyUserAdjustments(
  r: number,
  g: number,
  b: number,
  adj: AdjustmentParams | any
): [number, number, number] {
  let rf = r / 255;
  let gf = g / 255;
  let bf = b / 255;

  // 1. Shadow Recovery (Perceptual Toe Lift that targets dark regions without blowing out highlights)
  if (adj.shadowLift && adj.shadowLift !== 0) {
    const lum = 0.2126 * rf + 0.7152 * gf + 0.0722 * bf;
    const liftAmount = (adj.shadowLift / 100) * 0.26;
    const shadowWeight = Math.pow(1.0 - Math.min(1.0, lum / 0.48), 1.85);
    const boost = liftAmount * shadowWeight * (0.35 + 0.65 * Math.min(1, lum * 12));
    rf = Math.min(1, rf + boost);
    gf = Math.min(1, gf + boost);
    bf = Math.min(1, bf + boost);
  }

  // 2. Gamma correction
  if (adj.gamma && adj.gamma !== 1.0) {
    const invGamma = 1.0 / adj.gamma;
    rf = Math.pow(Math.max(0, rf), invGamma);
    gf = Math.pow(Math.max(0, gf), invGamma);
    bf = Math.pow(Math.max(0, bf), invGamma);
  }

  // 3. Brightness offset
  if (adj.brightness && adj.brightness !== 0) {
    const bOffset = (adj.brightness / 100) * 0.35;
    rf += bOffset;
    gf += bOffset;
    bf += bOffset;
  }

  // 4. Contrast around midpoint 0.5
  if (adj.contrast && adj.contrast !== 0) {
    const cFactor = Math.pow((adj.contrast + 100) / 100, 1.6);
    rf = (rf - 0.5) * cFactor + 0.5;
    gf = (gf - 0.5) * cFactor + 0.5;
    bf = (bf - 0.5) * cFactor + 0.5;
  }

  // 5. Saturation
  if (adj.saturation && adj.saturation !== 0) {
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
export function simulatePrinterOutput(
  r: number,
  g: number,
  b: number,
  profile: PrinterProfile | any
): [number, number, number] {
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
