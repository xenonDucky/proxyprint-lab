import {
  applyUnsharpMaskRgba,
  sample3DLut,
  AdjustmentParams
} from './colorScience';
import { applyUserAdjustments } from './simulation';

export function renderCardToPrintReadyCanvas(
  sourceCanvas: HTMLCanvasElement,
  padMpcBleed: boolean,
  has3mmBleed: boolean,
  inputMode: string,
  adjustments: AdjustmentParams
): HTMLCanvasElement {
  const rawW = sourceCanvas.width;
  const rawH = sourceCanvas.height;
  const isNativeBleed = Math.abs(rawW / rawH - 69 / 94) < 0.008;
  const shouldPad = !isNativeBleed && padMpcBleed;
  const outW = shouldPad ? Math.round(rawW * (69 / 63)) : rawW;
  const outH = shouldPad ? Math.round(rawH * (94 / 88)) : rawH;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const ctx = outCanvas.getContext('2d')!;

  ctx.fillStyle = '#070709';
  ctx.fillRect(0, 0, outW, outH);

  const px = shouldPad ? Math.round(outW * (3 / 69)) : 0;
  const py = shouldPad ? Math.round(outH * (3 / 94)) : 0;
  ctx.drawImage(sourceCanvas, px, py, outW - px * 2, outH - py * 2);

  const imgData = ctx.getImageData(0, 0, outW, outH);
  const d = imgData.data;
  const effectiveBleed = isNativeBleed || padMpcBleed;
  const bleedOffX = effectiveBleed ? Math.round(outW * (3 / 69)) : 0;
  const bleedOffY = effectiveBleed ? Math.round(outH * (3 / 94)) : 0;
  const trimW = outW - bleedOffX * 2;
  const trimH = outH - bleedOffY * 2;
  const ax0 = Math.floor(bleedOffX + trimW * 0.078);
  const ax1 = Math.ceil(bleedOffX + trimW * 0.922);
  const ay0 = Math.floor(bleedOffY + trimH * 0.112);
  const ay1 = Math.ceil(bleedOffY + trimH * 0.547);

  const tx0 = ax0;
  const tx1 = ax1;
  const ty0 = Math.floor(bleedOffY + trimH * 0.614);
  const ty1 = Math.ceil(bleedOffY + trimH * 0.889);

  if ((adjustments.sharpen || 0) > 0) {
    applyUnsharpMaskRgba(
      d,
      outW,
      outH,
      adjustments.sharpen || 0,
      inputMode === 'full_card' ? { x0: ax0, x1: ax1, y0: ay0, y1: ay1 } : null
    );
  }
  if ((adjustments.textBoxSharpen || 0) > 0) {
    applyUnsharpMaskRgba(d, outW, outH, adjustments.textBoxSharpen || 0, {
      x0: tx0,
      x1: tx1,
      y0: ty0,
      y1: ty1
    });
  }

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

export function generateBatchThumbnails(
  sourceCanvas: HTMLCanvasElement,
  padMpcBleed: boolean,
  has3mmBleed: boolean,
  inputMode: string,
  adjustments: AdjustmentParams,
  printer3DLut: Uint8Array
): { origThumbUrl: string; simThumbUrl: string } {
  const TW = 156;
  const TH = 214;

  const rawW = sourceCanvas.width;
  const rawH = sourceCanvas.height;
  const isNativeBleed = Math.abs(rawW / rawH - 69 / 94) < 0.008;
  const shouldPad = !isNativeBleed && padMpcBleed;

  const origC = document.createElement('canvas');
  origC.width = TW;
  origC.height = TH;
  const oCtx = origC.getContext('2d')!;
  oCtx.fillStyle = '#070709';
  oCtx.fillRect(0, 0, TW, TH);
  const px = shouldPad ? Math.round(TW * (3 / 69)) : 0;
  const py = shouldPad ? Math.round(TH * (3 / 94)) : 0;
  oCtx.drawImage(sourceCanvas, px, py, TW - px * 2, TH - py * 2);

  const simC = document.createElement('canvas');
  simC.width = TW;
  simC.height = TH;
  const sCtx = simC.getContext('2d')!;
  sCtx.drawImage(origC, 0, 0);

  const imgData = sCtx.getImageData(0, 0, TW, TH);
  const d = imgData.data;
  const effectiveBleed = isNativeBleed || padMpcBleed;
  const bleedOffX = effectiveBleed ? Math.round(TW * (3 / 69)) : 0;
  const bleedOffY = effectiveBleed ? Math.round(TH * (3 / 94)) : 0;
  const trimW = TW - bleedOffX * 2;
  const trimH = TH - bleedOffY * 2;
  const ax0 = Math.floor(bleedOffX + trimW * 0.078);
  const ax1 = Math.ceil(bleedOffX + trimW * 0.922);
  const ay0 = Math.floor(bleedOffY + trimH * 0.112);
  const ay1 = Math.ceil(bleedOffY + trimH * 0.547);

  const tx0 = ax0;
  const tx1 = ax1;
  const ty0 = Math.floor(bleedOffY + trimH * 0.614);
  const ty1 = Math.ceil(bleedOffY + trimH * 0.889);

  if ((adjustments.sharpen || 0) > 0) {
    applyUnsharpMaskRgba(
      d,
      TW,
      TH,
      adjustments.sharpen || 0,
      inputMode === 'full_card' ? { x0: ax0, x1: ax1, y0: ay0, y1: ay1 } : null
    );
  }
  if ((adjustments.textBoxSharpen || 0) > 0) {
    applyUnsharpMaskRgba(d, TW, TH, adjustments.textBoxSharpen || 0, {
      x0: tx0,
      x1: tx1,
      y0: ty0,
      y1: ty1
    });
  }

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
