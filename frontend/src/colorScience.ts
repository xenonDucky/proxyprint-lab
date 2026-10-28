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
