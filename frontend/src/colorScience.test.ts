import { describe, it, expect } from 'vitest';
import {
  rgbToLab,
  deltaE2000,
  computeSlidingWindowStd11x11,
  computeFftHighFrequencyFactor,
  buildPrinter3DLut,
  sample3DLut,
  optimizePrintAdjustments
} from './colorScience';
import { createZipArchive } from './zipBuilder';
import { PRINTER_PROFILES, simulatePrinterOutput, applyUserAdjustments } from './App';

describe('ProxyPrint Lab Color Science & 6-Stage Math', () => {
  it('converts sRGB to CIELAB accurately', () => {
    const [L0, a0, b0] = rgbToLab(0, 0, 0);
    expect(L0).toBeCloseTo(0, 1);
    expect(a0).toBeCloseTo(0, 1);
    expect(b0).toBeCloseTo(0, 1);

    const [L100, a100, b100] = rgbToLab(255, 255, 255);
    expect(L100).toBeCloseTo(100, 0);
    expect(Math.abs(a100)).toBeLessThan(0.5);
    expect(Math.abs(b100)).toBeLessThan(0.5);
  });

  it('computes CIE Delta E 2000 (ΔE_00) accurately for neon gamut shifts', () => {
    const [L1, a1, b1] = rgbToLab(0, 255, 255); // Pure sRGB neon cyan
    const [sr, sg, sb] = simulatePrinterOutput(0, 255, 255, PRINTER_PROFILES.mpc_commercial);
    const [L2, a2, b2] = rgbToLab(sr, sg, sb);
    const dE = deltaE2000(L1, a1, b1, L2, a2, b2);
    expect(dE).toBeGreaterThan(6.5);
    expect(deltaE2000(L1, a1, b1, L1, a1, b1)).toBeCloseTo(0, 5);
  });

  it('computes 11x11 sliding window standard deviation to separate flat vs textured shadows', () => {
    const W = 32;
    const H = 32;
    const flatBuffer = new Float32Array(W * H).fill(10.0);
    const flatStd = computeSlidingWindowStd11x11(flatBuffer, W, H);
    expect(flatStd[16 * W + 16]).toBeCloseTo(0, 4);

    const texturedBuffer = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      texturedBuffer[i] = i % 2 === 0 ? 6.0 : 14.0;
    }
    const texStd = computeSlidingWindowStd11x11(texturedBuffer, W, H);
    expect(texStd[16 * W + 16]).toBeGreaterThan(3.5);
  });

  it('computes 2D FFT high-frequency factor to distinguish sharp vs flat images', () => {
    const W = 256;
    const H = 256;
    const flatGray = new Float32Array(W * H).fill(128);
    const sharpGray = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        sharpGray[y * W + x] = ((x + y) % 2) * 200 + 20;
      }
    }
    const fFlat = computeFftHighFrequencyFactor(flatGray, W, H);
    const fSharp = computeFftHighFrequencyFactor(sharpGray, W, H);
    expect(fSharp).toBeGreaterThan(fFlat);
  });

  it('builds and trilinearly interpolates the 17x17x17 3D LUT accurately', () => {
    const lut = buildPrinter3DLut(simulatePrinterOutput, PRINTER_PROFILES.mpc_commercial, 17);
    expect(lut.length).toBe(17 * 17 * 17 * 3);

    const [sr, sg, sb] = simulatePrinterOutput(120, 80, 200, PRINTER_PROFILES.mpc_commercial);
    const [lr, lg, lb] = sample3DLut(120, 80, 200, lut, 17);
    expect(Math.abs(sr - lr)).toBeLessThanOrEqual(3);
    expect(Math.abs(sg - lg)).toBeLessThanOrEqual(3);
    expect(Math.abs(sb - lb)).toBeLessThanOrEqual(3);
  });

  it('finds optimal pre-press parameters via Coarse-to-Fine Pattern Search', () => {
    const anW = 240;
    const anH = 330;
    const rawPixels = new Uint8ClampedArray(anW * anH * 4);
    // Populate with dark muddy cavern textures (RGB ~ 12..34)
    for (let y = 0; y < anH; y++) {
      for (let x = 0; x < anW; x++) {
        const idx = (y * anW + x) * 4;
        const v = ((x + y) % 5) * 4 + 14;
        rawPixels[idx] = v;
        rawPixels[idx + 1] = v - 2;
        rawPixels[idx + 2] = v + 3;
        rawPixels[idx + 3] = 255;
      }
    }

    const lut = buildPrinter3DLut(simulatePrinterOutput, PRINTER_PROFILES.home_matte, 17);
    const opt = optimizePrintAdjustments({
      rawPixels,
      anW,
      anH,
      has3mmBleed: true,
      inputMode: 'full_card',
      printerProfile: PRINTER_PROFILES.home_matte,
      printer3DLut: lut,
      resolutionScore: 95,
      applyUserAdjustmentsFn: applyUserAdjustments
    });

    // For a dark muddy card on Home Matte paper, the optimizer should lift shadows & boost contrast
    expect(opt.shadowLift).toBeGreaterThan(20);
    expect(opt.gamma).toBeGreaterThanOrEqual(0.95);
  });

  it('builds a standards-compliant ZIP archive for batch card export', async () => {
    const file1 = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic header
    const file2 = new Uint8Array([1, 2, 3, 4, 5]);
    const blob = createZipArchive([
      { filename: '01_abyssal_dragon.png', data: file1 },
      { filename: '02_aetherstorm_surge.png', data: file2 }
    ]);

    expect(blob.type).toBe('application/zip');
    const buf = new Uint8Array(await blob.arrayBuffer());
    // PK\x03\x04 local header signature
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });
});
