import { describe, it, expect } from 'vitest';
import {
  rgbToLab,
  deltaE2000,
  computeSlidingWindowStd11x11,
  computeFftHighFrequencyFactor,
  buildPrinter3DLut,
  sample3DLut,
  applyUnsharpMaskRgba,
  DPI_BENCHMARKS,
  computeDpiResolutionScore,
  computeOptimalRegionSharpening,
  optimizePrintAdjustments
} from './colorScience';
import { createZipArchive } from './zipBuilder';
import { PRINTER_PROFILES, CARD_STANDARDS, simulatePrinterOutput, applyUserAdjustments } from './App';
import { runFullPrintPipeline } from './printPipeline';

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
    // Sharpening sliders remain 0 during auto-optimization
    expect(opt.sharpen).toBe(0);
    expect(opt.textBoxSharpen).toBe(0);
    expect(opt.artTargetDpi).toBe(DPI_BENCHMARKS.min);
    expect(opt.textTargetDpi).toBe(DPI_BENCHMARKS.min);
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

  it('applies Smart MTG Unsharp Mask inside the Art Box while keeping Text Box & Borders untouched', () => {
    const W = 20;
    const H = 20;
    const rgba = new Uint8ClampedArray(W * H * 4);
    // Create a high-contrast vertical edge at x = 10 across the whole image
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const val = x < 10 ? 80 : 180;
        rgba[idx] = val;
        rgba[idx + 1] = val;
        rgba[idx + 2] = val;
        rgba[idx + 3] = 255;
      }
    }

    // Art Box is y: 2..10, x: 2..18; Text Box is y: 12..18
    applyUnsharpMaskRgba(rgba, W, H, 60, { x0: 2, x1: 18, y0: 2, y1: 10 });

    // Inside Art Box (y = 5): dark side of edge (x = 9) becomes darker (< 80), bright side (x = 10) becomes brighter (> 180)
    const artDarkIdx = (5 * W + 9) * 4;
    const artBrightIdx = (5 * W + 10) * 4;
    expect(rgba[artDarkIdx]).toBeLessThan(80);
    expect(rgba[artBrightIdx]).toBeGreaterThan(180);

    // Inside Text Box (y = 15): edge pixels remain 100% untouched (80 and 180)
    const textDarkIdx = (15 * W + 9) * 4;
    const textBrightIdx = (15 * W + 10) * 4;
    expect(rgba[textDarkIdx]).toBe(80);
    expect(rgba[textBrightIdx]).toBe(180);
  });

  it('evaluates Art Box and Card Text Box against 300 Min / 600 Ideal / 1200 Max DPI benchmarks', () => {
    expect(DPI_BENCHMARKS).toEqual({ min: 300, ideal: 600, max: 1200 });

    // Score benchmarks: 300 DPI -> 75, 600 DPI -> 95, 1200 DPI -> 100
    expect(computeDpiResolutionScore(300)).toBe(75);
    expect(computeDpiResolutionScore(600)).toBe(95);
    expect(computeDpiResolutionScore(1200)).toBe(100);
    expect(computeDpiResolutionScore(150)).toBeLessThan(75);

    // At >= 600 DPI (ideal), both Art Box and Text Box target 600 DPI with 0% additional sharpen
    const idealRegions = computeOptimalRegionSharpening(600, 600);
    expect(idealRegions.artTargetDpi).toBe(600);
    expect(idealRegions.textTargetDpi).toBe(600);
    expect(idealRegions.sharpen).toBe(0);
    expect(idealRegions.textBoxSharpen).toBe(0);

    // At 300 DPI (minimum acceptable), both sliders set target DPI to 600 and receive optical sharpening
    const minRegions = computeOptimalRegionSharpening(300, 300);
    expect(minRegions.artTargetDpi).toBe(600);
    expect(minRegions.textTargetDpi).toBe(600);
    expect(minRegions.sharpen).toBe(32);
    expect(minRegions.textBoxSharpen).toBe(20);

    // Below 300 DPI (e.g. 210 DPI), both sliders increase while Text Box stays gentler than Art Box
    const lowRegions = computeOptimalRegionSharpening(210, 210);
    expect(lowRegions.sharpen).toBeGreaterThan(minRegions.sharpen);
    expect(lowRegions.textBoxSharpen).toBeGreaterThan(minRegions.textBoxSharpen);
    expect(lowRegions.textBoxSharpen).toBeLessThan(lowRegions.sharpen);
  });

  it('correctly simulates Vinyl Sticker Glossy and Vinyl Sticker Matte paper profiles', () => {
    // 1. Vinyl Glossy Profile Check
    const vinylGlossy = PRINTER_PROFILES.vinyl_glossy;
    expect(vinylGlossy).toBeDefined();
    expect(vinylGlossy.blackFloorL).toBeCloseTo(5.0, 1);
    expect(vinylGlossy.paperWhiteL).toBeCloseTo(97.5, 1);
    expect(vinylGlossy.shadowCrushThreshold).toBeLessThanOrEqual(15.0);

    // Deep black simulation on glossy vinyl retains high darkness (low RGB values)
    const [vgR, vgG, vgB] = simulatePrinterOutput(0, 0, 0, vinylGlossy);
    const [vgL] = rgbToLab(vgR, vgG, vgB);
    expect(vgR).toBeLessThanOrEqual(6);
    expect(vgL).toBeLessThan(2.0);

    // 2. Vinyl Matte Profile Check
    const vinylMatte = PRINTER_PROFILES.vinyl_matte;
    expect(vinylMatte).toBeDefined();
    expect(vinylMatte.blackFloorL).toBeCloseTo(14.0, 1);
    expect(vinylMatte.paperWhiteL).toBeCloseTo(94.0, 1);
    expect(vinylMatte.recommendedToeLift).toBeGreaterThan(40);

    // Matte coating scattering causes black to lift significantly compared to glossy vinyl
    const [vmR, vmG, vmB] = simulatePrinterOutput(0, 0, 0, vinylMatte);
    const [vmL] = rgbToLab(vmR, vmG, vmB);
    expect(vmR).toBeGreaterThan(vgR);
    expect(vmL).toBeGreaterThan(vgL);
    expect(vmR).toBeGreaterThanOrEqual(13);
  });

  it('accurately positions textbox guides and dynamically updates them when bleed is toggled', () => {
    const mockContext = {
      fillStyle: '',
      fillRect: () => {},
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(240 * 330 * 4) })
    };
    const prevDoc = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => mockContext
      })
    };

    const trimCanvas = {
      width: 744,
      height: 1039,
      getContext: () => mockContext
    } as unknown as HTMLCanvasElement;

    try {
      // 1. Evaluate with padMpcBleed: false
      const unpaddedResult = runFullPrintPipeline({
        sourceCanvas: trimCanvas,
        inputMode: 'full_card',
        cardStandard: CARD_STANDARDS.tcg_trim,
        printerProfile: PRINTER_PROFILES.mpc_commercial,
        adjustments: { shadowLift: 0, gamma: 1.0, brightness: 0, contrast: 0, saturation: 0, sharpen: 0, textBoxSharpen: 0 },
        padMpcBleed: false
      })!;

      expect(unpaddedResult.geometry.has3mmBleed).toBe(false);
      const unpaddedVm = unpaddedResult.current.visualMaps!;
      expect(unpaddedVm.artBoxNorm.x).toBeCloseTo(0.078, 2);
      expect(unpaddedVm.artBoxNorm.y).toBeCloseTo(0.112, 2);
      // Rules text box must be aligned at y: 0.614 (not overlapping type banner at 0.556)
      expect(unpaddedVm.textBoxNorm!.y).toBeCloseTo(0.614, 2);
      expect(unpaddedVm.textBoxNorm!.h).toBeCloseTo(0.275, 2);
      // Type banner guide must be at y: 0.556
      expect(unpaddedVm.typeBannerNorm!.y).toBeCloseTo(0.556, 2);
      expect(unpaddedVm.typeBannerNorm!.h).toBeCloseTo(0.048, 2);

      // 2. Evaluate with padMpcBleed: true
      const paddedResult = runFullPrintPipeline({
        sourceCanvas: trimCanvas,
        inputMode: 'full_card',
        cardStandard: CARD_STANDARDS.mpc_bleed,
        printerProfile: PRINTER_PROFILES.mpc_commercial,
        adjustments: { shadowLift: 0, gamma: 1.0, brightness: 0, contrast: 0, saturation: 0, sharpen: 0, textBoxSharpen: 0 },
        padMpcBleed: true
      })!;

      expect(paddedResult.geometry.has3mmBleed).toBe(true);
      const paddedVm = paddedResult.current.visualMaps!;
      // When bleed is padded, the guides must shift inward to match the padded trim frame
      expect(paddedVm.artBoxNorm.x).toBeGreaterThan(unpaddedVm.artBoxNorm.x);
      expect(paddedVm.textBoxNorm!.x).toBeGreaterThan(unpaddedVm.textBoxNorm!.x);
      expect(paddedVm.artBoxNorm.w).toBeLessThan(unpaddedVm.artBoxNorm.w);
      expect(paddedVm.textBoxNorm!.w).toBeLessThan(unpaddedVm.textBoxNorm!.w);

      // 3. Evaluate with dynamic bleedMm: 3.0 on TCG standard trim
      const dynamicBleedResult = runFullPrintPipeline({
        sourceCanvas: trimCanvas,
        inputMode: 'full_card',
        cardStandard: CARD_STANDARDS.tcg_trim,
        printerProfile: PRINTER_PROFILES.mpc_commercial,
        adjustments: { shadowLift: 0, gamma: 1.0, brightness: 0, contrast: 0, saturation: 0, sharpen: 0, textBoxSharpen: 0 },
        bleedMm: 3.0
      })!;

      expect(dynamicBleedResult.geometry.bleedMm).toBe(3.0);
      expect(dynamicBleedResult.geometry.has3mmBleed).toBe(true);
      expect(dynamicBleedResult.geometry.effectiveW).toBe(Math.round(744 * (69.0 / 63.0)));
      expect(dynamicBleedResult.geometry.effectiveH).toBe(Math.round(1039 * (94.0 / 88.0)));
      const dynamicVm = dynamicBleedResult.current.visualMaps!;
      expect(dynamicVm.artBoxNorm.x).toBeGreaterThan(unpaddedVm.artBoxNorm.x);
      expect(dynamicVm.textBoxNorm!.x).toBeGreaterThan(unpaddedVm.textBoxNorm!.x);
    } finally {
      (globalThis as any).document = prevDoc;
    }
  });
});
