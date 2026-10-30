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
  AdjustmentParams
} from './colorScience';
import { simulatePrinterOutput, applyUserAdjustments } from './simulation';
import { CardStandard, PrinterProfile, PipelineAnalysisResult, InputMode } from './types';

export interface RunPrintPipelineParams {
  sourceCanvas: HTMLCanvasElement;
  inputMode: InputMode | string;
  cardStandard: CardStandard;
  printerProfile: PrinterProfile;
  adjustments: AdjustmentParams;
  padMpcBleed?: boolean;
  bleedMm?: number;
}

export function runFullPrintPipeline({
  sourceCanvas,
  inputMode,
  cardStandard,
  printerProfile,
  adjustments,
  padMpcBleed = false,
  bleedMm
}: RunPrintPipelineParams): PipelineAnalysisResult | null {
  if (!sourceCanvas) return null;

  const rawW = sourceCanvas.width;
  const rawH = sourceCanvas.height;

  const effectiveBleedMm = bleedMm !== undefined ? Math.max(0, bleedMm) : (padMpcBleed ? 3.0 : 0.0);
  const isNativeBleed = Math.abs(rawW / rawH - 69 / 94) < 0.008;
  const has3mmBleed = isNativeBleed || effectiveBleedMm > 0;

  const baseW = cardStandard.widthMm || 63.0;
  const baseH = cardStandard.heightMm || 88.0;

  const bleedFactorX = !isNativeBleed && effectiveBleedMm > 0 ? (baseW + 2 * effectiveBleedMm) / baseW : 1.0;
  const bleedFactorY = !isNativeBleed && effectiveBleedMm > 0 ? (baseH + 2 * effectiveBleedMm) / baseH : 1.0;
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

  const padRatioX = effectiveBleedMm > 0 ? effectiveBleedMm / (baseW + 2 * effectiveBleedMm) : (3.0 / 69.0);
  const padRatioY = effectiveBleedMm > 0 ? effectiveBleedMm / (baseH + 2 * effectiveBleedMm) : (3.0 / 94.0);

  const padX = !isNativeBleed && effectiveBleedMm > 0 ? Math.round(AN_W * padRatioX) : 0;
  const padY = !isNativeBleed && effectiveBleedMm > 0 ? Math.round(AN_H * padRatioY) : 0;
  ctx.drawImage(sourceCanvas, padX, padY, AN_W - padX * 2, AN_H - padY * 2);

  const rawImgData = ctx.getImageData(0, 0, AN_W, AN_H);
  const rawPixels = rawImgData.data;

  // --------------------------------------------------------------------------
  // STAGE 1 & 2: RESOLUTION, BLEED GEOMETRY, LAPLACIAN & 2D FFT SHARPNESS
  // --------------------------------------------------------------------------
  const targetWIn = (baseW + (isNativeBleed ? 6.0 : 2 * effectiveBleedMm)) / 25.4;
  const targetHIn = (baseH + (isNativeBleed ? 6.0 : 2 * effectiveBleedMm)) / 25.4;
  const ppiX = effectiveW / targetWIn;
  const ppiY = effectiveH / targetHIn;
  const nominalPpi = Math.round(Math.min(ppiX, ppiY));

  const targetAspect = (baseW + (isNativeBleed ? 6.0 : 2 * effectiveBleedMm)) / (baseH + (isNativeBleed ? 6.0 : 2 * effectiveBleedMm));
  const actualAspect = effectiveW / effectiveH;
  const aspectDiffPct = (Math.abs(actualAspect - targetAspect) / targetAspect) * 100;

  // Measure Laplacian Edge Gradient & 2D FFT High-Frequency Energy
  const sharpW = 120;
  const sharpH = 165;
  const sharpCanvas = document.createElement('canvas');
  sharpCanvas.width = sharpW;
  sharpCanvas.height = sharpH;
  const sCtx = sharpCanvas.getContext('2d', { willReadFrequently: true })!;
  sCtx.drawImage(workCanvas, 0, 0, sharpW, sharpH);
  const sData = sCtx.getImageData(0, 0, sharpW, sharpH).data;

  const gray = new Float32Array(sharpW * sharpH);
  for (let i = 0; i < sharpW * sharpH; i++) {
    const p = i * 4;
    gray[i] = 0.299 * sData[p] + 0.587 * sData[p + 1] + 0.114 * sData[p + 2];
  }

  const sBleedX = has3mmBleed ? Math.round(sharpW * padRatioX) : 0;
  const sBleedY = has3mmBleed ? Math.round(sharpH * padRatioY) : 0;
  const sTrimW = sharpW - sBleedX * 2;
  const sTrimH = sharpH - sBleedY * 2;
  const sAx0 = Math.floor(sBleedX + sTrimW * 0.078);
  const sAx1 = Math.ceil(sBleedX + sTrimW * 0.922);
  const sAy0 = Math.floor(sBleedY + sTrimH * 0.112);
  const sAy1 = Math.ceil(sBleedY + sTrimH * 0.547);

  const sTx0 = sAx0;
  const sTx1 = sAx1;
  const sTy0 = Math.floor(sBleedY + sTrimH * 0.614);
  const sTy1 = Math.ceil(sBleedY + sTrimH * 0.889);

  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;

  for (let y = sAy0 + 2; y < sAy1 - 2; y++) {
    for (let x = sAx0 + 2; x < sAx1 - 2; x++) {
      const idx = y * sharpW + x;
      const lap =
        -4 * gray[idx] +
        gray[idx - 1] +
        gray[idx + 1] +
        gray[idx - sharpW] +
        gray[idx + sharpW];
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount++;
    }
  }
  const lapMean = lapSum / Math.max(1, lapCount);
  const lapVariance = lapSqSum / Math.max(1, lapCount) - lapMean * lapMean;

  let textLapSum = 0;
  let textLapSqSum = 0;
  let textLapCount = 0;
  for (let y = sTy0 + 2; y < sTy1 - 2; y++) {
    for (let x = sTx0 + 2; x < sTx1 - 2; x++) {
      const idx = y * sharpW + x;
      const lap =
        -4 * gray[idx] +
        gray[idx - 1] +
        gray[idx + 1] +
        gray[idx - sharpW] +
        gray[idx + sharpW];
      textLapSum += lap;
      textLapSqSum += lap * lap;
      textLapCount++;
    }
  }
  const textLapMean = textLapSum / Math.max(1, textLapCount);
  const textLapVariance = textLapSqSum / Math.max(1, textLapCount) - textLapMean * textLapMean;

  const lapSharpnessFactor = Math.min(1.0, Math.max(0.38, Math.sqrt(lapVariance) / 19.5));
  const textLapSharpnessFactor = Math.min(1.0, Math.max(0.38, Math.sqrt(textLapVariance) / 22.0));
  const fftSharpnessFactor = computeFftHighFrequencyFactor(gray, sharpW, sharpH);
  const opticalSharpnessFactor = 0.65 * lapSharpnessFactor + 0.35 * fftSharpnessFactor;
  const textOpticalSharpnessFactor = 0.72 * textLapSharpnessFactor + 0.28 * fftSharpnessFactor;

  const clampedNominalPpi = Math.min(DPI_BENCHMARKS.max, nominalPpi);
  const effectiveOpticalPpi = Math.min(
    DPI_BENCHMARKS.max,
    Math.round(clampedNominalPpi * opticalSharpnessFactor)
  );
  const textOpticalPpi = Math.min(
    DPI_BENCHMARKS.max,
    Math.round(clampedNominalPpi * textOpticalSharpnessFactor)
  );
  const isLikelyUpscaled = nominalPpi >= 250 && opticalSharpnessFactor < 0.68;

  const artDpiScore = computeDpiResolutionScore(effectiveOpticalPpi);
  const textDpiScore = computeDpiResolutionScore(textOpticalPpi);
  let resolutionScore = Math.round(0.65 * artDpiScore + 0.35 * textDpiScore);
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

    const bleedOffsetX = has3mmBleed ? Math.round(AN_W * padRatioX) : 0;
    const bleedOffsetY = has3mmBleed ? Math.round(AN_H * padRatioY) : 0;
    const trimSpanW = AN_W - bleedOffsetX * 2;
    const trimSpanH = AN_H - bleedOffsetY * 2;

    const maskX0 = Math.floor(bleedOffsetX + trimSpanW * 0.078);
    const maskX1 = Math.ceil(bleedOffsetX + trimSpanW * 0.922);
    const maskY0 = Math.floor(bleedOffsetY + trimSpanH * 0.112);
    const maskY1 = Math.ceil(bleedOffsetY + trimSpanH * 0.547);

    const textX0 = maskX0;
    const textX1 = maskX1;
    const textY0 = Math.floor(bleedOffsetY + trimSpanH * 0.614);
    const textY1 = Math.ceil(bleedOffsetY + trimSpanH * 0.889);

    const typeX0 = Math.floor(bleedOffsetX + trimSpanW * 0.068);
    const typeX1 = Math.ceil(bleedOffsetX + trimSpanW * 0.932);
    const typeY0 = Math.floor(bleedOffsetY + trimSpanH * 0.556);
    const typeY1 = Math.ceil(bleedOffsetY + trimSpanH * 0.604);

    // Apply Smart MTG Unsharp Mask independently to Art Box and Card Text Box
    const workPixels = new Uint8ClampedArray(rawPixels);
    const sharpenAmt = adj.sharpen || 0;
    const textSharpenAmt = adj.textBoxSharpen || 0;
    if (sharpenAmt > 0) {
      applyUnsharpMaskRgba(
        workPixels,
        AN_W,
        AN_H,
        sharpenAmt,
        inputMode === 'full_card' ? { x0: maskX0, x1: maskX1, y0: maskY0, y1: maskY1 } : null
      );
    }
    if (textSharpenAmt > 0) {
      applyUnsharpMaskRgba(workPixels, AN_W, AN_H, textSharpenAmt, {
        x0: textX0,
        x1: textX1,
        y0: textY0,
        y1: textY1
      });
    }

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

        const [ar, ag, ab] = isAnalyzed
          ? applyUserAdjustments(workPixels[p], workPixels[p + 1], workPixels[p + 2], adj)
          : [workPixels[p], workPixels[p + 1], workPixels[p + 2]];
        const [L_adj, a_adj, b_adj] = rgbToLab(ar, ag, ab);
        adjustedL[idx] = L_adj;

        const [sr, sg, sb] = sample3DLut(ar, ag, ab, printer3DLut, 17);
        const [L_sim, a_sim, b_sim] = rgbToLab(sr, sg, sb);
        simulatedL[idx] = L_sim;

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
    const effectiveArtPpi =
      adj.artTargetDpi && adj.artTargetDpi > DPI_BENCHMARKS.min
        ? Math.min(DPI_BENCHMARKS.max, Math.max(effectiveOpticalPpi, adj.artTargetDpi))
        : sharpenAmt > 0
        ? Math.min(DPI_BENCHMARKS.max, Math.max(effectiveOpticalPpi, DPI_BENCHMARKS.ideal))
        : effectiveOpticalPpi;

    const effectiveTextPpi =
      adj.textTargetDpi && adj.textTargetDpi > DPI_BENCHMARKS.min
        ? Math.min(DPI_BENCHMARKS.max, Math.max(textOpticalPpi, adj.textTargetDpi))
        : textSharpenAmt > 0
        ? Math.min(DPI_BENCHMARKS.max, Math.max(textOpticalPpi, DPI_BENCHMARKS.ideal))
        : textOpticalPpi;
    const artBoost =
      sharpenAmt > 0
        ? Math.round(Math.min(10, (sharpenAmt / 100) * 14 * (artDpiScore < 90 ? 1.0 : 0.4)))
        : 0;
    const textBoost =
      textSharpenAmt > 0
        ? Math.round(Math.min(8, (textSharpenAmt / 100) * 12 * (textDpiScore < 90 ? 1.0 : 0.4)))
        : 0;
    const sharpenBoost = Math.round(0.65 * artBoost + 0.35 * textBoost);
    const effectiveResolutionScore = Math.min(100, resolutionScore + sharpenBoost);

    const qWeighted =
      0.20 * effectiveResolutionScore +
      0.35 * shadowScore +
      0.10 * highlightScore +
      0.15 * contrastScore +
      0.20 * colorScore;

    const minCritical = Math.min(effectiveResolutionScore, shadowScore, contrastScore);
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
            : minCritical === effectiveResolutionScore
            ? 'Resolution'
            : 'Contrast',
        resolution: effectiveResolutionScore,
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
        lowContrastPatches,
        effectiveArtPpi,
        effectiveTextPpi
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
            },
            textBoxNorm: {
              x: textX0 / AN_W,
              y: textY0 / AN_H,
              w: (textX1 - textX0) / AN_W,
              h: (textY1 - textY0) / AN_H
            },
            typeBannerNorm: {
              x: typeX0 / AN_W,
              y: typeY0 / AN_H,
              w: (typeX1 - typeX0) / AN_W,
              h: (typeY1 - typeY0) / AN_H
            }
          }
        : null
    };
  };

  const baselineResult = evaluateColorAndTones(
    { shadowLift: 0, gamma: 1.0, brightness: 0, contrast: 0, saturation: 0, sharpen: 0, textBoxSharpen: 0 },
    false
  );
  const currentResult = evaluateColorAndTones(adjustments, true);

  return {
    geometry: {
      rawW,
      rawH,
      effectiveW,
      effectiveH,
      nominalPpi: clampedNominalPpi,
      effectiveOpticalPpi,
      textOpticalPpi,
      dpiBenchmarks: DPI_BENCHMARKS,
      opticalSharpnessFactor: Math.round(opticalSharpnessFactor * 100),
      fftSharpnessRatio: Math.round(fftSharpnessFactor * 100),
      isLikelyUpscaled,
      has3mmBleed,
      bleedMm: effectiveBleedMm,
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
