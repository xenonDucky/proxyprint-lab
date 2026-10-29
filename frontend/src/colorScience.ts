/**
 * Color Science, CIELAB, CIE Delta E 2000 (ΔE_00), 11x11 Sliding Window Shadow StdDev,
 * 2D Radix-2 FFT High-Frequency Sharpness, and Trilinear 3D LUT Interpolation.
 */

// Precompute sRGB to linear LUT for fast pixel processing
export const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255.0;
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = SRGB_TO_LINEAR[r];
  const lg = SRGB_TO_LINEAR[g];
  const lb = SRGB_TO_LINEAR[b];

  // D65 reference white
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) / 1.0;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  const L = Math.max(0, Math.min(100, 116 * fy - 16));
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);
  return [L, a, bVal];
}

/**
 * Full CIE Delta E 2000 (ΔE_00) color difference formula between two CIELAB colors.
 * Accurately weights perceptual lightness, chroma, and hue rotation differences
 * to flag out-of-gamut CMYK shifts in neon greens, cyans, magentas, and deep blues.
 */
export function deltaE2000(
  L1: number,
  a1: number,
  b1: number,
  L2: number,
  a2: number,
  b2: number
): number {
  const DEG2RAD = Math.PI / 180.0;
  const RAD2DEG = 180.0 / Math.PI;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const CBar = 0.5 * (C1 + C2);
  const CBar7 = Math.pow(CBar, 7);
  const pow25_7 = 6103515625.0; // 25^7
  const G = 0.5 * (1.0 - Math.sqrt(CBar7 / (CBar7 + pow25_7)));

  const a1Prime = (1.0 + G) * a1;
  const a2Prime = (1.0 + G) * a2;
  const C1Prime = Math.hypot(a1Prime, b1);
  const C2Prime = Math.hypot(a2Prime, b2);

  let h1Prime = Math.atan2(b1, a1Prime) * RAD2DEG;
  if (h1Prime < 0) h1Prime += 360.0;
  let h2Prime = Math.atan2(b2, a2Prime) * RAD2DEG;
  if (h2Prime < 0) h2Prime += 360.0;

  const dLPrime = L2 - L1;
  const dCPrime = C2Prime - C1Prime;

  let dhPrime = 0.0;
  if (C1Prime * C2Prime !== 0.0) {
    const diff = h2Prime - h1Prime;
    if (Math.abs(diff) <= 180.0) dhPrime = diff;
    else if (diff > 180.0) dhPrime = diff - 360.0;
    else dhPrime = diff + 360.0;
  }

  const dHPrime = 2.0 * Math.sqrt(C1Prime * C2Prime) * Math.sin(0.5 * dhPrime * DEG2RAD);

  const LBarPrime = 0.5 * (L1 + L2);
  const CBarPrime = 0.5 * (C1Prime + C2Prime);

  let hBarPrime = h1Prime + h2Prime;
  if (C1Prime * C2Prime !== 0.0) {
    if (Math.abs(h1Prime - h2Prime) <= 180.0) {
      hBarPrime = 0.5 * (h1Prime + h2Prime);
    } else if (h1Prime + h2Prime < 360.0) {
      hBarPrime = 0.5 * (h1Prime + h2Prime + 360.0);
    } else {
      hBarPrime = 0.5 * (h1Prime + h2Prime - 360.0);
    }
  }

  const T =
    1.0 -
    0.17 * Math.cos((hBarPrime - 30.0) * DEG2RAD) +
    0.24 * Math.cos(2.0 * hBarPrime * DEG2RAD) +
    0.32 * Math.cos((3.0 * hBarPrime + 6.0) * DEG2RAD) -
    0.2 * Math.cos((4.0 * hBarPrime - 63.0) * DEG2RAD);

  const dTheta = 30.0 * Math.exp(-Math.pow((hBarPrime - 275.0) / 25.0, 2));
  const CBarPrime7 = Math.pow(CBarPrime, 7);
  const RC = 2.0 * Math.sqrt(CBarPrime7 / (CBarPrime7 + pow25_7));

  const LTerm = Math.pow(LBarPrime - 50.0, 2);
  const SL = 1.0 + (0.015 * LTerm) / Math.sqrt(20.0 + LTerm);
  const SC = 1.0 + 0.045 * CBarPrime;
  const SH = 1.0 + 0.015 * CBarPrime * T;
  const RT = -Math.sin(2.0 * dTheta * DEG2RAD) * RC;

  const termL = dLPrime / SL;
  const termC = dCPrime / SC;
  const termH = dHPrime / SH;

  return Math.sqrt(
    Math.max(0.0, termL * termL + termC * termC + termH * termH + RT * termC * termH)
  );
}

/**
 * Computes the local standard deviation within an 11x11 sliding window across a 2D float buffer
 * using fast 2D integral images (summed-area tables) in O(1) per pixel.
 * Distinguishes between a muddy, detail-less swamp (low gradient) and a crisp night scene (high gradient).
 */
export function computeSlidingWindowStd11x11(
  LBuffer: Float32Array,
  width: number,
  height: number
): Float32Array {
  const w1 = width + 1;
  const h1 = height + 1;
  const integralSum = new Float64Array(w1 * h1);
  const integralSqSum = new Float64Array(w1 * h1);

  for (let y = 1; y <= height; y++) {
    let rowSum = 0.0;
    let rowSqSum = 0.0;
    for (let x = 1; x <= width; x++) {
      const val = LBuffer[(y - 1) * width + (x - 1)];
      rowSum += val;
      rowSqSum += val * val;
      const idx = y * w1 + x;
      integralSum[idx] = integralSum[(y - 1) * w1 + x] + rowSum;
      integralSqSum[idx] = integralSqSum[(y - 1) * w1 + x] + rowSqSum;
    }
  }

  const outStd = new Float32Array(width * height);
  const radius = 5; // 11x11 window (2*5 + 1)

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius) + 1;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius) + 1;

      const count = (x1 - x0) * (y1 - y0);
      const sum =
        integralSum[y1 * w1 + x1] -
        integralSum[y0 * w1 + x1] -
        integralSum[y1 * w1 + x0] +
        integralSum[y0 * w1 + x0];
      const sqSum =
        integralSqSum[y1 * w1 + x1] -
        integralSqSum[y0 * w1 + x1] -
        integralSqSum[y1 * w1 + x0] +
        integralSqSum[y0 * w1 + x0];

      const mean = sum / count;
      const variance = Math.max(0.0, sqSum / count - mean * mean);
      outStd[y * width + x] = Math.sqrt(variance);
    }
  }

  return outStd;
}

/**
 * In-place 1D Cooley-Tukey Radix-2 FFT for power-of-two length N.
 */
function fft1D(real: Float32Array, imag: Float32Array, n: number): void {
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wLenR = Math.cos(angle);
    const wLenI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const uIdx = i + k;
        const vIdx = i + k + halfLen;
        const tR = wR * real[vIdx] - wI * imag[vIdx];
        const tI = wR * imag[vIdx] + wI * real[vIdx];
        real[vIdx] = real[uIdx] - tR;
        imag[vIdx] = imag[uIdx] - tI;
        real[uIdx] += tR;
        imag[uIdx] += tI;
        const nextWR = wR * wLenR - wI * wLenI;
        wI = wR * wLenI + wI * wLenR;
        wR = nextWR;
      }
    }
  }
}

/**
 * Computes the 2D Fast Fourier Transform (FFT) High-Frequency Energy Ratio on a 128x128 crop
 * of the artwork region to detect "fake" upscaled resolution.
 * Returns a normalized factor in [0.38, 1.0].
 */
export function computeFftHighFrequencyFactor(
  gray: Float32Array,
  width: number,
  height: number
): number {
  const N = 128;
  const real2D = new Float32Array(N * N);
  const imag2D = new Float32Array(N * N);

  const xStart = Math.floor(width * 0.15);
  const yStart = Math.floor(height * 0.14);
  const spanW = Math.max(N, Math.floor(width * 0.7));
  const spanH = Math.max(N, Math.floor(height * 0.4));

  for (let y = 0; y < N; y++) {
    const sy = Math.min(height - 1, yStart + Math.floor((y / N) * spanH));
    for (let x = 0; x < N; x++) {
      const sx = Math.min(width - 1, xStart + Math.floor((x / N) * spanW));
      // Apply Hann window to prevent boundary spectral leakage
      const wx = 0.5 * (1 - Math.cos((2 * Math.PI * x) / (N - 1)));
      const wy = 0.5 * (1 - Math.cos((2 * Math.PI * y) / (N - 1)));
      real2D[y * N + x] = gray[sy * width + sx] * wx * wy;
    }
  }

  const rowR = new Float32Array(N);
  const rowI = new Float32Array(N);

  // Transform rows
  for (let y = 0; y < N; y++) {
    const offset = y * N;
    for (let x = 0; x < N; x++) {
      rowR[x] = real2D[offset + x];
      rowI[x] = 0;
    }
    fft1D(rowR, rowI, N);
    for (let x = 0; x < N; x++) {
      real2D[offset + x] = rowR[x];
      imag2D[offset + x] = rowI[x];
    }
  }

  // Transform columns
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      rowR[y] = real2D[y * N + x];
      rowI[y] = imag2D[y * N + x];
    }
    fft1D(rowR, rowI, N);
    for (let y = 0; y < N; y++) {
      real2D[y * N + x] = rowR[y];
      imag2D[y * N + x] = rowI[y];
    }
  }

  const half = N >> 1;
  const maxRadius = Math.hypot(half, half);
  let totalEnergy = 0.0;
  let highFreqEnergy = 0.0;

  for (let y = 0; y < N; y++) {
    const sy = (y + half) % N;
    const dy = sy - half;
    for (let x = 0; x < N; x++) {
      const sx = (x + half) % N;
      const dx = sx - half;
      const mag = Math.log1p(Math.hypot(real2D[y * N + x], imag2D[y * N + x]));
      const dist = Math.hypot(dx, dy);
      totalEnergy += mag;
      if (dist > 0.22 * maxRadius) {
        highFreqEnergy += mag;
      }
    }
  }

  const ratio = highFreqEnergy / Math.max(1e-6, totalEnergy);
  return Math.min(1.0, Math.max(0.38, (ratio - 0.56) / 0.22));
}

/**
 * Generates a 17x17x17 3D Look-Up Table (3D LUT) for the given printer profile
 * and provides trilinear interpolation for 60 FPS real-time soft-proofing.
 */
export function buildPrinter3DLut(
  simulateFn: (r: number, g: number, b: number, profile: any) => [number, number, number],
  profile: any,
  gridSize = 17
): Uint8Array {
  const lut = new Uint8Array(gridSize * gridSize * gridSize * 3);
  const scale = 255 / (gridSize - 1);
  let ptr = 0;
  for (let r = 0; r < gridSize; r++) {
    const rv = Math.round(r * scale);
    for (let g = 0; g < gridSize; g++) {
      const gv = Math.round(g * scale);
      for (let b = 0; b < gridSize; b++) {
        const bv = Math.round(b * scale);
        const [sr, sg, sb] = simulateFn(rv, gv, bv, profile);
        lut[ptr++] = sr;
        lut[ptr++] = sg;
        lut[ptr++] = sb;
      }
    }
  }
  return lut;
}

export function sample3DLut(
  r: number,
  g: number,
  b: number,
  lut: Uint8Array,
  gridSize = 17
): [number, number, number] {
  const maxIdx = gridSize - 1;
  const rf = (r / 255) * maxIdx;
  const gf = (g / 255) * maxIdx;
  const bf = (b / 255) * maxIdx;

  const r0 = Math.min(maxIdx - 1, Math.floor(rf));
  const g0 = Math.min(maxIdx - 1, Math.floor(gf));
  const b0 = Math.min(maxIdx - 1, Math.floor(bf));

  const dr = rf - r0;
  const dg = gf - g0;
  const db = bf - b0;

  const strideG = gridSize * 3;
  const strideR = gridSize * strideG;

  const idx000 = r0 * strideR + g0 * strideG + b0 * 3;
  const idx100 = idx000 + strideR;
  const idx010 = idx000 + strideG;
  const idx110 = idx100 + strideG;

  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = lut[idx000 + c] * (1 - dr) + lut[idx100 + c] * dr;
    const c01 = lut[idx000 + 3 + c] * (1 - dr) + lut[idx100 + 3 + c] * dr;
    const c10 = lut[idx010 + c] * (1 - dr) + lut[idx110 + c] * dr;
    const c11 = lut[idx010 + 3 + c] * (1 - dr) + lut[idx110 + 3 + c] * dr;

    const c0 = c00 * (1 - dg) + c10 * dg;
    const c1 = c01 * (1 - dg) + c11 * dg;
    out[c] = Math.round(c0 * (1 - db) + c1 * db);
  }
  return out;
}

export const DPI_BENCHMARKS = {
  min: 300,
  ideal: 600,
  max: 1200
} as const;

/**
 * Maps an effective optical PPI to a 0-100 resolution score using the MTG print benchmarks:
 *   - Minimum acceptable print DPI: 300 DPI (Score = 75)
 *   - Ideal crisp print DPI:        600 DPI (Score = 95)
 *   - Maximum benchmark cap:       1200 DPI (Score = 100)
 */
export function computeDpiResolutionScore(effectivePpi: number): number {
  const clamped = Math.max(0, Math.min(DPI_BENCHMARKS.max, effectivePpi));
  if (clamped < DPI_BENCHMARKS.min) {
    return Math.round(15 + (clamped / DPI_BENCHMARKS.min) * 60);
  }
  if (clamped < DPI_BENCHMARKS.ideal) {
    return Math.round(
      75 + ((clamped - DPI_BENCHMARKS.min) / (DPI_BENCHMARKS.ideal - DPI_BENCHMARKS.min)) * 20
    );
  }
  return Math.round(
    95 + ((clamped - DPI_BENCHMARKS.ideal) / (DPI_BENCHMARKS.max - DPI_BENCHMARKS.ideal)) * 5
  );
}

/**
 * Given a region's autodetected Optical DPI and a user/optimizer Target DPI (300..1200 DPI),
 * calculates the Unsharp Mask percentage (0..80%) needed to compensate the region's edges.
 * - At 300 DPI (minimum slider setting), returns 0% (unsharpened baseline).
 * - At 600 DPI (ideal Auto-Optimize setting), computes sharpening proportional to how far
 *   the autodetected Optical DPI falls below 600 DPI (using a gentler curve for the Text Box
 *   so rules text stays crisp without white halos).
 * - Above 600 DPI up to 1200 DPI (max slider setting), scales edge enhancement up to 80% (Art) / 55% (Text).
 */
export function computeSharpenForTargetDpi(
  detectedOpticalPpi: number,
  targetDpi: number,
  region: 'art' | 'text'
): number {
  const clampedTarget = Math.max(DPI_BENCHMARKS.min, Math.min(DPI_BENCHMARKS.max, targetDpi));
  if (clampedTarget <= DPI_BENCHMARKS.min) {
    return 0;
  }

  const clampedDetected = Math.max(60, Math.min(DPI_BENCHMARKS.max, detectedOpticalPpi));

  // Ideal 600 DPI base sharpening calculated from autodetected card DPI
  let ideal600Sharpen = 0;
  if (region === 'art') {
    if (clampedDetected < DPI_BENCHMARKS.min) {
      ideal600Sharpen = Math.min(
        68,
        Math.round(34 + ((DPI_BENCHMARKS.min - clampedDetected) / 200) * 28)
      );
    } else if (clampedDetected < DPI_BENCHMARKS.ideal) {
      ideal600Sharpen = Math.round(
        ((DPI_BENCHMARKS.ideal - clampedDetected) /
          (DPI_BENCHMARKS.ideal - DPI_BENCHMARKS.min)) *
          32
      );
    } else {
      ideal600Sharpen = 12;
    }
  } else {
    if (clampedDetected < DPI_BENCHMARKS.min) {
      ideal600Sharpen = Math.min(
        36,
        Math.round(20 + ((DPI_BENCHMARKS.min - clampedDetected) / 200) * 14)
      );
    } else if (clampedDetected < DPI_BENCHMARKS.ideal) {
      ideal600Sharpen = Math.round(
        ((DPI_BENCHMARKS.ideal - clampedDetected) /
          (DPI_BENCHMARKS.ideal - DPI_BENCHMARKS.min)) *
          20
      );
    } else {
      ideal600Sharpen = 8;
    }
  }

  if (clampedTarget <= DPI_BENCHMARKS.ideal) {
    const t =
      (clampedTarget - DPI_BENCHMARKS.min) / (DPI_BENCHMARKS.ideal - DPI_BENCHMARKS.min);
    return Math.round(ideal600Sharpen * t);
  }

  // Between 600 DPI (ideal) and 1200 DPI (max)
  const maxCap = region === 'art' ? 80 : 55;
  const tHigh =
    (clampedTarget - DPI_BENCHMARKS.ideal) / (DPI_BENCHMARKS.max - DPI_BENCHMARKS.ideal);
  return Math.min(maxCap, Math.round(ideal600Sharpen + (maxCap - ideal600Sharpen) * tHigh));
}

/**
 * Computes optimal Unsharp Mask percentages and Target DPI (600 DPI Ideal) for both
 * the Art Box and the Card Text Box based on each region's autodetected Optical DPI
 * relative to 300 DPI (min), 600 DPI (ideal), and 1200 DPI (max).
 */
export function computeOptimalRegionSharpening(
  artOpticalPpi: number,
  textOpticalPpi: number
): {
  sharpen: number;
  textBoxSharpen: number;
  artTargetDpi: number;
  textTargetDpi: number;
} {
  const clampedArt = Math.max(0, Math.min(DPI_BENCHMARKS.max, artOpticalPpi));
  const clampedText = Math.max(0, Math.min(DPI_BENCHMARKS.max, textOpticalPpi));

  const sharpen =
    clampedArt >= DPI_BENCHMARKS.ideal
      ? 0
      : computeSharpenForTargetDpi(clampedArt, DPI_BENCHMARKS.ideal, 'art');
  const textBoxSharpen =
    clampedText >= DPI_BENCHMARKS.ideal
      ? 0
      : computeSharpenForTargetDpi(clampedText, DPI_BENCHMARKS.ideal, 'text');

  return {
    sharpen,
    textBoxSharpen,
    artTargetDpi: DPI_BENCHMARKS.ideal,
    textTargetDpi: DPI_BENCHMARKS.ideal
  };
}

export interface AdjustmentParams {
  shadowLift: number;
  gamma: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  textBoxSharpen: number;
  artTargetDpi?: number;
  textTargetDpi?: number;
}

/**
 * Applies a 3x3 Luminance Unsharp Mask (USM) convolution across an RGBA image buffer.
 * - Preserves hue/chroma by computing the high-pass Laplacian detail strictly on luminance.
 * - Smart Region Awareness for MTG Cards:
 *   When `artBoxOnly` is true (or inside the Art Box), applies 100% of `sharpenAmount`
 *   to the illustration, and 0% to the text box & black borders so rasterized rules text
 *   never becomes jagged or crunchy.
 */
export function applyUnsharpMaskRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  sharpenAmount: number,
  artBoxBounds?: { x0: number; x1: number; y0: number; y1: number } | null
): void {
  if (!sharpenAmount || sharpenAmount <= 0) return;

  const strength = (sharpenAmount / 100) * 1.45;
  const srcCopy = new Uint8ClampedArray(rgba);

  const yStart = artBoxBounds ? Math.max(1, artBoxBounds.y0) : 1;
  const yEnd = artBoxBounds ? Math.min(height - 2, artBoxBounds.y1) : height - 2;
  const xStart = artBoxBounds ? Math.max(1, artBoxBounds.x0) : 1;
  const xEnd = artBoxBounds ? Math.min(width - 2, artBoxBounds.x1) : width - 2;

  const stride = width * 4;

  for (let y = yStart; y <= yEnd; y++) {
    const rowOff = y * stride;
    for (let x = xStart; x <= xEnd; x++) {
      const p = rowOff + x * 4;

      const rC = srcCopy[p];
      const gC = srcCopy[p + 1];
      const bC = srcCopy[p + 2];
      const lumC = 0.299 * rC + 0.587 * gC + 0.114 * bC;

      const pUp = p - stride;
      const pDown = p + stride;
      const pLeft = p - 4;
      const pRight = p + 4;

      const lumUp = 0.299 * srcCopy[pUp] + 0.587 * srcCopy[pUp + 1] + 0.114 * srcCopy[pUp + 2];
      const lumDown =
        0.299 * srcCopy[pDown] + 0.587 * srcCopy[pDown + 1] + 0.114 * srcCopy[pDown + 2];
      const lumLeft =
        0.299 * srcCopy[pLeft] + 0.587 * srcCopy[pLeft + 1] + 0.114 * srcCopy[pLeft + 2];
      const lumRight =
        0.299 * srcCopy[pRight] + 0.587 * srcCopy[pRight + 1] + 0.114 * srcCopy[pRight + 2];

      const highPass = 4 * lumC - (lumUp + lumDown + lumLeft + lumRight);

      // Soft noise gate: ignore tiny compression noise (< 1.5 luma diff) so JPEG artifacts aren't amplified
      if (Math.abs(highPass) > 1.5) {
        const delta = highPass * 0.25 * strength;
        rgba[p] = Math.max(0, Math.min(255, Math.round(rC + delta)));
        rgba[p + 1] = Math.max(0, Math.min(255, Math.round(gC + delta)));
        rgba[p + 2] = Math.max(0, Math.min(255, Math.round(bC + delta)));
      }
    }
  }
}

/**
 * Coarse-to-Fine Coordinate Pattern Search (Hooke-Jeeves) with Tikhonov Regularization.
 * Finds the optimal 5D pre-press adjustment vector θ = (shadowLift, gamma, brightness, contrast, saturation)
 * that maximizes the 6-Stage Printability Objective:
 *   J(θ) = Q_final(θ) + 0.30 * Q_weighted(θ) + 0.15 * S(θ) - λ * ||θ - θ_0||^2
 *
 * Evaluates on a decimated 60x82 analysis grid using the 17x17x17 3D LUT so the entire
 * multi-pass optimization completes in < 12 ms on the client.
 */
export function optimizePrintAdjustments({
  rawPixels,
  anW,
  anH,
  has3mmBleed,
  inputMode,
  printerProfile,
  printer3DLut,
  resolutionScore,
  artOpticalPpi,
  textOpticalPpi,
  applyUserAdjustmentsFn
}: {
  rawPixels: Uint8ClampedArray;
  anW: number;
  anH: number;
  has3mmBleed: boolean;
  inputMode: string;
  printerProfile: any;
  printer3DLut: Uint8Array;
  resolutionScore: number;
  artOpticalPpi?: number;
  textOpticalPpi?: number;
  applyUserAdjustmentsFn: (r: number, g: number, b: number, adj: AdjustmentParams) => [number, number, number];
}): AdjustmentParams {
  // Decimate 240x330 -> 60x82 (stride 4) for 16x faster objective evaluation
  const STRIDE = 4;
  const subW = Math.floor(anW / STRIDE);
  const subH = Math.floor(anH / STRIDE);
  const totalSub = subW * subH;

  const subR = new Uint8Array(totalSub);
  const subG = new Uint8Array(totalSub);
  const subB = new Uint8Array(totalSub);
  const subMask = new Uint8Array(totalSub);

  const bleedOffsetX = has3mmBleed ? anW * (3 / 69) : 0;
  const bleedOffsetY = has3mmBleed ? anH * (3 / 94) : 0;
  const trimSpanW = anW - bleedOffsetX * 2;
  const trimSpanH = anH - bleedOffsetY * 2;

  const maskX0 = Math.floor(bleedOffsetX + trimSpanW * 0.078);
  const maskX1 = Math.ceil(bleedOffsetX + trimSpanW * 0.922);
  const maskY0 = Math.floor(bleedOffsetY + trimSpanH * 0.112);
  const maskY1 = Math.ceil(bleedOffsetY + trimSpanH * 0.547);

  let maskCount = 0;
  const baseLValues: number[] = [];

  for (let sy = 0; sy < subH; sy++) {
    const y = sy * STRIDE + 1;
    for (let sx = 0; sx < subW; sx++) {
      const x = sx * STRIDE + 1;
      const sIdx = sy * subW + sx;
      const p = (y * anW + x) * 4;

      const r = rawPixels[p];
      const g = rawPixels[p + 1];
      const b = rawPixels[p + 2];
      subR[sIdx] = r;
      subG[sIdx] = g;
      subB[sIdx] = b;

      const isAnalyzed =
        inputMode === 'artwork_only' ||
        (x >= maskX0 && x <= maskX1 && y >= maskY0 && y <= maskY1);

      if (isAnalyzed) {
        subMask[sIdx] = 1;
        maskCount++;
        const [L] = rgbToLab(r, g, b);
        baseLValues.push(L);
      }
    }
  }

  const normCount = Math.max(1, maskCount);
  baseLValues.sort((a, b) => a - b);
  const p10L = baseLValues[Math.floor(baseLValues.length * 0.10)] ?? 25;
  const p25L = baseLValues[Math.floor(baseLValues.length * 0.25)] ?? 40;
  const p90L = baseLValues[Math.floor(baseLValues.length * 0.90)] ?? 80;

  const adjustedL = new Float32Array(totalSub);
  const simulatedL = new Float32Array(totalSub);

  // Fast local gradient radius=1 on the stride-4 grid (corresponds to 11x11 window on full grid)
  const evaluateObjective = (adj: AdjustmentParams): number => {
    let lOver95 = 0;
    let deltaESum = 0;
    let highDeltaECount = 0;

    for (let i = 0; i < totalSub; i++) {
      const [ar, ag, ab] = subMask[i]
        ? applyUserAdjustmentsFn(subR[i], subG[i], subB[i], adj)
        : [subR[i], subG[i], subB[i]];
      const [L_adj, a_adj, b_adj] = rgbToLab(ar, ag, ab);
      adjustedL[i] = L_adj;

      const [sr, sg, sb] = sample3DLut(ar, ag, ab, printer3DLut, 17);
      const [L_sim, a_sim, b_sim] = rgbToLab(sr, sg, sb);
      simulatedL[i] = L_sim;

      if (subMask[i]) {
        if (L_adj > 95) lOver95++;
        const dE = deltaE2000(L_adj, a_adj, b_adj, L_sim, a_sim, b_sim);
        deltaESum += dE;
        if (dE > 6.5) highDeltaECount++;
      }
    }

    const pctOver95 = (lOver95 / normCount) * 100;
    const meanDeltaE = deltaESum / normCount;
    const pctHighDeltaE = (highDeltaECount / normCount) * 100;

    // 3x3 local standard deviation on stride-4 grid (= 11x11 on full 240x330 buffer)
    let shadowPixelsCount = 0;
    let crushedShadowPixels = 0;
    let simShadowGradSum = 0;

    for (let sy = 1; sy < subH - 1; sy++) {
      for (let sx = 1; sx < subW - 1; sx++) {
        const idx = sy * subW + sx;
        if (!subMask[idx]) continue;

        const L0 = adjustedL[idx];
        if (L0 < 25.0) {
          shadowPixelsCount++;
          let sumOrig = 0;
          let sumSqOrig = 0;
          let sumSim = 0;
          let sumSqSim = 0;

          for (let dy = -1; dy <= 1; dy++) {
            const rowOff = (sy + dy) * subW + sx;
            for (let dx = -1; dx <= 1; dx++) {
              const lo = adjustedL[rowOff + dx];
              const ls = simulatedL[rowOff + dx];
              sumOrig += lo;
              sumSqOrig += lo * lo;
              sumSim += ls;
              sumSqSim += ls * ls;
            }
          }

          const stdOrig = Math.sqrt(Math.max(0, sumSqOrig / 9 - (sumOrig / 9) ** 2));
          const stdSim = Math.sqrt(Math.max(0, sumSqSim / 9 - (sumSim / 9) ** 2));
          simShadowGradSum += stdSim;

          const retention = stdOrig > 0.35 ? stdSim / stdOrig : 0.4;
          if (
            L0 < printerProfile.blackFloorL * 0.9 ||
            (L0 < 18 && retention < 0.48) ||
            stdSim < 0.65
          ) {
            crushedShadowPixels++;
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

    // 8x8 Grid RMS Contrast
    let lowContrastPatches = 0;
    let validPatches = 0;
    let rmsContrastSum = 0;

    for (let gy = 0; gy < 8; gy++) {
      const py0 = Math.floor((gy / 8) * subH);
      const py1 = Math.floor(((gy + 1) / 8) * subH);
      for (let gx = 0; gx < 8; gx++) {
        const px0 = Math.floor((gx / 8) * subW);
        const px1 = Math.floor(((gx + 1) / 8) * subW);

        let sumL = 0;
        let sumSqL = 0;
        let count = 0;
        for (let y = py0; y < py1; y++) {
          for (let x = px0; x < px1; x++) {
            const idx = y * subW + x;
            if (subMask[idx]) {
              const lv = simulatedL[idx];
              sumL += lv;
              sumSqL += lv * lv;
              count++;
            }
          }
        }
        if (count > 2) {
          const mean = sumL / count;
          const rms = Math.sqrt(Math.max(0, sumSqL / count - mean * mean));
          validPatches++;
          rmsContrastSum += rms;
          if (rms < 4.2) lowContrastPatches++;
        }
      }
    }

    const avgPatchRms = rmsContrastSum / Math.max(1, validPatches);
    const lowContrastPatchRatio = lowContrastPatches / Math.max(1, validPatches);

    const contrastScore = Math.round(
      Math.max(20, Math.min(98, 55 + avgPatchRms * 3.4 - lowContrastPatchRatio * 42))
    );
    const highlightScore = Math.round(Math.max(25, Math.min(99, 97 - pctOver95 * 3.2)));
    const colorScore = Math.round(
      Math.max(18, Math.min(98, 100 - Math.max(0, meanDeltaE - 2.2) * 3.2 - pctHighDeltaE * 0.62))
    );

    const qWeighted =
      0.2 * resolutionScore +
      0.35 * shadowScore +
      0.1 * highlightScore +
      0.15 * contrastScore +
      0.2 * colorScore;

    const minCritical = Math.min(resolutionScore, shadowScore, contrastScore);
    const qFinal = Math.min(qWeighted, minCritical + 15);

    // Tikhonov regularization: prefer minimal natural adjustments when scores are tied,
    // and strongly penalize washing out black borders or blowing out highlights
    const regPenalty =
      0.0012 * (adj.shadowLift ** 2) +
      8.5 * ((adj.gamma - 1.0) ** 2) +
      0.0035 * (adj.contrast ** 2) +
      0.012 * (adj.brightness ** 2) +
      0.003 * (adj.saturation ** 2);

    return (
      qFinal +
      0.35 * qWeighted +
      0.15 * shadowScore +
      0.10 * contrastScore +
      0.10 * colorScore -
      regPenalty
    );
  };

  // Bounds helper
  const clampParams = (p: AdjustmentParams): AdjustmentParams => ({
    shadowLift: Math.max(0, Math.min(75, Math.round(p.shadowLift))),
    gamma: Math.max(0.82, Math.min(1.38, Math.round(p.gamma * 100) / 100)),
    brightness: Math.max(-18, Math.min(18, Math.round(p.brightness))),
    contrast: Math.max(-20, Math.min(32, Math.round(p.contrast))),
    saturation: Math.max(-28, Math.min(25, Math.round(p.saturation))),
    sharpen: Math.max(0, Math.min(80, Math.round(p.sharpen ?? 0))),
    textBoxSharpen: Math.max(0, Math.min(80, Math.round(p.textBoxSharpen ?? 0))),
    artTargetDpi: Math.max(
      DPI_BENCHMARKS.min,
      Math.min(DPI_BENCHMARKS.max, Math.round(p.artTargetDpi ?? DPI_BENCHMARKS.ideal))
    ),
    textTargetDpi: Math.max(
      DPI_BENCHMARKS.min,
      Math.min(DPI_BENCHMARKS.max, Math.round(p.textTargetDpi ?? DPI_BENCHMARKS.ideal))
    )
  });

  // Compute optimal sharpening for both Art Box and Card Text Box using 300 DPI min / 600 DPI ideal / 1200 DPI max
  const fallbackPpi = Math.round(((resolutionScore - 15) / 60) * 300);
  const {
    sharpen: recommendedSharpen,
    textBoxSharpen: recommendedTextSharpen,
    artTargetDpi: recommendedArtTargetDpi,
    textTargetDpi: recommendedTextTargetDpi
  } = computeOptimalRegionSharpening(
    artOpticalPpi ?? fallbackPpi,
    textOpticalPpi ?? fallbackPpi
  );

  // Histogram-informed warm start seeds (ensures global awareness across dark, neon, and washed-out art)
  const adaptiveLift = Math.max(
    0,
    Math.min(68, Math.round((printerProfile.blackFloorL + 8 - p10L) * 2.8))
  );
  const adaptiveGamma = p25L < 22 ? 1.12 : p25L > 55 ? 0.94 : 1.04;
  const adaptiveContrast = p90L - p10L < 45 ? 12 : 6;

  const seeds: AdjustmentParams[] = [
    {
      shadowLift: 0,
      gamma: 1.0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpen: recommendedSharpen,
      textBoxSharpen: recommendedTextSharpen,
      artTargetDpi: recommendedArtTargetDpi,
      textTargetDpi: recommendedTextTargetDpi
    },
    clampParams({
      shadowLift: adaptiveLift,
      gamma: adaptiveGamma,
      brightness: 0,
      contrast: adaptiveContrast,
      saturation: 0,
      sharpen: recommendedSharpen,
      textBoxSharpen: recommendedTextSharpen,
      artTargetDpi: recommendedArtTargetDpi,
      textTargetDpi: recommendedTextTargetDpi
    }),
    clampParams({
      shadowLift: printerProfile.recommendedToeLift,
      gamma: 1.08,
      brightness: 0,
      contrast: 8,
      saturation: -6,
      sharpen: recommendedSharpen,
      textBoxSharpen: recommendedTextSharpen,
      artTargetDpi: recommendedArtTargetDpi,
      textTargetDpi: recommendedTextTargetDpi
    }),
    clampParams({
      shadowLift: Math.round(printerProfile.recommendedToeLift * 0.5),
      gamma: 1.02,
      brightness: 0,
      contrast: 10,
      saturation: 8,
      sharpen: recommendedSharpen,
      textBoxSharpen: recommendedTextSharpen,
      artTargetDpi: recommendedArtTargetDpi,
      textTargetDpi: recommendedTextTargetDpi
    }),
    clampParams({
      shadowLift: 15,
      gamma: 0.96,
      brightness: -2,
      contrast: 14,
      saturation: -12,
      sharpen: recommendedSharpen,
      textBoxSharpen: recommendedTextSharpen,
      artTargetDpi: recommendedArtTargetDpi,
      textTargetDpi: recommendedTextTargetDpi
    })
  ];

  let bestParams = seeds[0];
  let bestObj = evaluateObjective(bestParams);

  for (let i = 1; i < seeds.length; i++) {
    const score = evaluateObjective(seeds[i]);
    if (score > bestObj) {
      bestObj = score;
      bestParams = { ...seeds[i] };
    }
  }

  // Coarse-to-Fine Coordinate Pattern Search (3 multi-scale passes)
  const stepSchedule: Array<Record<'shadowLift' | 'contrast' | 'gamma' | 'saturation' | 'brightness', number>> = [
    { shadowLift: 12, contrast: 6, gamma: 0.06, saturation: 6, brightness: 4 },
    { shadowLift: 4, contrast: 3, gamma: 0.02, saturation: 3, brightness: 2 },
    { shadowLift: 2, contrast: 1, gamma: 0.01, saturation: 1, brightness: 1 }
  ];

  const paramKeys: Array<'shadowLift' | 'contrast' | 'gamma' | 'saturation' | 'brightness'> = [
    'shadowLift',
    'contrast',
    'gamma',
    'saturation',
    'brightness'
  ];

  for (const steps of stepSchedule) {
    let improvedInPass = true;
    let iter = 0;
    while (improvedInPass && iter < 4) {
      improvedInPass = false;
      iter++;
      for (const key of paramKeys) {
        const delta = steps[key];
        let bestDirScore = bestObj;
        let bestCandidate = bestParams;

        for (const dir of [1, -1]) {
          const candidate = clampParams({
            ...bestParams,
            [key]: bestParams[key] + dir * delta
          });
          if (candidate[key] === bestParams[key]) continue;
          const s = evaluateObjective(candidate);
          if (s > bestDirScore + 1e-4) {
            bestDirScore = s;
            bestCandidate = candidate;
          }
        }

        if (bestCandidate !== bestParams) {
          const prevVal = bestParams[key];
          bestParams = bestCandidate;
          bestObj = bestDirScore;
          improvedInPass = true;

          // Pattern acceleration step: try one more step in the winning direction
          const stepDelta = bestCandidate[key] - prevVal;
          const accelCandidate = clampParams({
            ...bestParams,
            [key]: bestParams[key] + stepDelta
          });
          if (accelCandidate[key] !== bestParams[key]) {
            const sAccel = evaluateObjective(accelCandidate);
            if (sAccel > bestObj + 1e-4) {
              bestParams = accelCandidate;
              bestObj = sAccel;
            }
          }
        }
      }
    }
  }

  return bestParams;
}

