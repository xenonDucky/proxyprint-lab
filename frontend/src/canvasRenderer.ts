import { applyUnsharpMaskRgba, sample3DLut, AdjustmentParams } from './colorScience';
import { applyUserAdjustments } from './simulation';
import { ViewMode, InputMode, PrinterProfile, PipelineAnalysisResult, CardStandard } from './types';

export interface CanvasRendererParams {
  sourceCanvas: HTMLCanvasElement | null;
  analysis: PipelineAnalysisResult | null;
  viewMode: ViewMode;
  showGeometryGuides: boolean;
  adjustments: AdjustmentParams;
  printerProfile: PrinterProfile;
  padMpcBleed?: boolean;
  bleedMm?: number;
  inputMode: InputMode | string;
  cardStandard?: CardStandard;
  mainPreviewCanvas: HTMLCanvasElement | null;
  origCompareCanvas: HTMLCanvasElement | null;
  simCompareCanvas: HTMLCanvasElement | null;
  heatmapCompareCanvas: HTMLCanvasElement | null;
}

export function renderPreviewCanvases({
  sourceCanvas,
  analysis,
  viewMode,
  showGeometryGuides,
  adjustments,
  printerProfile,
  padMpcBleed = false,
  bleedMm,
  inputMode,
  cardStandard,
  mainPreviewCanvas,
  origCompareCanvas,
  simCompareCanvas,
  heatmapCompareCanvas
}: CanvasRendererParams): void {
  if (!sourceCanvas || !analysis) return;

  const DISP_W = 360;
  const DISP_H = 490;
  const lut3D = analysis.printer3DLut;

  const rawW = sourceCanvas.width;
  const rawH = sourceCanvas.height;
  const isNativeBleed = Math.abs(rawW / rawH - 69 / 94) < 0.008;
  const effectiveBleedMm = bleedMm !== undefined ? Math.max(0, bleedMm) : (padMpcBleed ? 3.0 : 0.0);
  const baseW = cardStandard?.widthMm || 63.0;
  const baseH = cardStandard?.heightMm || 88.0;

  const padRatioX = effectiveBleedMm > 0 ? effectiveBleedMm / (baseW + 2 * effectiveBleedMm) : (3.0 / 69.0);
  const padRatioY = effectiveBleedMm > 0 ? effectiveBleedMm / (baseH + 2 * effectiveBleedMm) : (3.0 / 94.0);

  const drawBaseImage = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = '#070709';
    ctx.fillRect(0, 0, w, h);
    const px = (!isNativeBleed && effectiveBleedMm > 0) ? Math.round(w * padRatioX) : 0;
    const py = (!isNativeBleed && effectiveBleedMm > 0) ? Math.round(h * padRatioY) : 0;
    ctx.drawImage(sourceCanvas, px, py, w - px * 2, h - py * 2);
  };

  const drawGuidesOverlay = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (!showGeometryGuides) return;
    ctx.save();

    const hasBleed = analysis.geometry.has3mmBleed;
    const bleedPxX = hasBleed ? Math.round(w * padRatioX) : 0;
    const bleedPxY = hasBleed ? Math.round(h * padRatioY) : 0;

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

    const trimSpanW = w - bleedPxX * 2;
    const trimSpanH = h - bleedPxY * 2;
    // MTG card frame black border is uniform in physical millimeters (~3mm on all 4 sides).
    // In normalized trim space: Width margin is 0.048 (3mm / 63mm). Height margin is 0.048 * (baseW / baseH).
    const safeOffsetX = bleedPxX + trimSpanW * 0.048;
    const safeOffsetY = bleedPxY + trimSpanH * (0.048 * (baseW / baseH));
    const safeWidth = trimSpanW * (1 - 2 * 0.048);
    const safeHeight = trimSpanH * (1 - 2 * 0.048 * (baseW / baseH));
    const safeRadius = trimSpanW * 0.03;

    ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(safeOffsetX, safeOffsetY, safeWidth, safeHeight, safeRadius);
    } else {
      ctx.rect(safeOffsetX, safeOffsetY, safeWidth, safeHeight);
    }
    ctx.stroke();

    if (inputMode === 'full_card' && analysis.current.visualMaps) {
      const ab = analysis.current.visualMaps.artBoxNorm;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(ab.x * w, ab.y * h, ab.w * w, ab.h * h);

      ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('ART ANALYSIS REGION', ab.x * w + 6, ab.y * h + 13);

      const tb = analysis.current.visualMaps.textBoxNorm;
      if (tb) {
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(tb.x * w, tb.y * h, tb.w * w, tb.h * h);

        ctx.fillStyle = 'rgba(196, 181, 253, 0.95)';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText('RULES TEXT BOX', tb.x * w + 6, tb.y * h + 12);
      }

      const ty = analysis.current.visualMaps.typeBannerNorm;
      if (ty) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(ty.x * w, ty.y * h, ty.w * w, ty.h * h);

        ctx.fillStyle = 'rgba(125, 211, 252, 0.9)';
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText('TYPE LINE', ty.x * w + 6, ty.y * h + 10);
      }
    }

    ctx.restore();
  };

  const renderShadowHeatmapOnCanvas = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    drawBaseImage(ctx, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const vm = analysis.current.visualMaps!;

    if ((adjustments.sharpen || 0) > 0) {
      const abNorm = vm.artBoxNorm;
      applyUnsharpMaskRgba(
        d,
        w,
        h,
        adjustments.sharpen || 0,
        inputMode === 'full_card'
          ? {
              x0: Math.floor(abNorm.x * w),
              x1: Math.ceil((abNorm.x + abNorm.w) * w),
              y0: Math.floor(abNorm.y * h),
              y1: Math.ceil((abNorm.y + abNorm.h) * h)
            }
          : null
      );
    }
    if ((adjustments.textBoxSharpen || 0) > 0 && vm.textBoxNorm) {
      const tbNorm = vm.textBoxNorm;
      applyUnsharpMaskRgba(d, w, h, adjustments.textBoxSharpen || 0, {
        x0: Math.floor(tbNorm.x * w),
        x1: Math.ceil((tbNorm.x + tbNorm.w) * w),
        y0: Math.floor(tbNorm.y * h),
        y1: Math.ceil((tbNorm.y + tbNorm.h) * h)
      });
    }

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
        const risk = vm.shadowRiskMap ? vm.shadowRiskMap[mapIdx] : 0;

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
    if (origCompareCanvas) {
      origCompareCanvas.width = CW;
      origCompareCanvas.height = CH;
      const ctx = origCompareCanvas.getContext('2d')!;
      drawBaseImage(ctx, CW, CH);
      drawGuidesOverlay(ctx, CW, CH);
    }

    // 2. Simulated Print (with Current User Adjustments + Smart Sharpen + 3D LUT)
    if (simCompareCanvas) {
      simCompareCanvas.width = CW;
      simCompareCanvas.height = CH;
      const ctx = simCompareCanvas.getContext('2d')!;
      drawBaseImage(ctx, CW, CH);
      const imgData = ctx.getImageData(0, 0, CW, CH);
      const d = imgData.data;
      const abNorm = analysis.current.visualMaps!.artBoxNorm;
      const tbNorm = analysis.current.visualMaps!.textBoxNorm;
      const ax0 = Math.floor(abNorm.x * CW);
      const ax1 = Math.ceil((abNorm.x + abNorm.w) * CW);
      const ay0 = Math.floor(abNorm.y * CH);
      const ay1 = Math.ceil((abNorm.y + abNorm.h) * CH);

      if ((adjustments.sharpen || 0) > 0) {
        applyUnsharpMaskRgba(
          d,
          CW,
          CH,
          adjustments.sharpen || 0,
          inputMode === 'full_card' ? { x0: ax0, x1: ax1, y0: ay0, y1: ay1 } : null
        );
      }
      if ((adjustments.textBoxSharpen || 0) > 0 && tbNorm) {
        applyUnsharpMaskRgba(d, CW, CH, adjustments.textBoxSharpen || 0, {
          x0: Math.floor(tbNorm.x * CW),
          x1: Math.ceil((tbNorm.x + tbNorm.w) * CW),
          y0: Math.floor(tbNorm.y * CH),
          y1: Math.ceil((tbNorm.y + tbNorm.h) * CH)
        });
      }

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

    // 3. Shadow Loss Risk Heatmap
    if (heatmapCompareCanvas) {
      heatmapCompareCanvas.width = CW;
      heatmapCompareCanvas.height = CH;
      const ctx = heatmapCompareCanvas.getContext('2d')!;
      renderShadowHeatmapOnCanvas(ctx, CW, CH);
    }
  } else if (mainPreviewCanvas) {
    mainPreviewCanvas.width = DISP_W;
    mainPreviewCanvas.height = DISP_H;
    const ctx = mainPreviewCanvas.getContext('2d')!;

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

    if ((adjustments.sharpen || 0) > 0) {
      const abNorm = vm.artBoxNorm;
      applyUnsharpMaskRgba(
        d,
        DISP_W,
        DISP_H,
        adjustments.sharpen || 0,
        inputMode === 'full_card'
          ? {
              x0: Math.floor(abNorm.x * DISP_W),
              x1: Math.ceil((abNorm.x + abNorm.w) * DISP_W),
              y0: Math.floor(abNorm.y * DISP_H),
              y1: Math.ceil((abNorm.y + abNorm.h) * DISP_H)
            }
          : null
      );
    }
    if ((adjustments.textBoxSharpen || 0) > 0 && vm.textBoxNorm) {
      const tbNorm = vm.textBoxNorm;
      applyUnsharpMaskRgba(d, DISP_W, DISP_H, adjustments.textBoxSharpen || 0, {
        x0: Math.floor(tbNorm.x * DISP_W),
        x1: Math.ceil((tbNorm.x + tbNorm.w) * DISP_W),
        y0: Math.floor(tbNorm.y * DISP_H),
        y1: Math.ceil((tbNorm.y + tbNorm.h) * DISP_H)
      });
    }

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
}
