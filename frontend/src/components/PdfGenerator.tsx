import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  Plus,
  Minus,
  Trash2,
  Sliders,
  Scissors,
  CheckCircle2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Info,
  Maximize2
} from 'lucide-react';
import {
  PdfCardItem,
  BatchCardItem,
  CardStandard,
  InputMode
} from '../types';
import {
  createProxyPrintPdf,
  PdfSheetConfig,
  PaperSize,
  PAPER_DIMENSIONS_PT,
  MM_TO_PT
} from '../pdfBuilder';
import { renderCardForPdfSheet } from '../renderExport';

export interface PdfGeneratorProps {
  pdfCards: PdfCardItem[];
  setPdfCards: React.Dispatch<React.SetStateAction<PdfCardItem[]>>;
  batchItems: BatchCardItem[];
  cardStandard: CardStandard;
  inputMode: InputMode | string;
  bleedMm: number;
  onSwitchToBatch: () => void;
  onAddBatchItemToPdf: (item: BatchCardItem) => void;
  onAddAllBatchToPdf: () => void;
}

export function PdfGenerator({
  pdfCards,
  setPdfCards,
  batchItems,
  cardStandard,
  inputMode,
  bleedMm,
  onSwitchToBatch,
  onAddBatchItemToPdf,
  onAddAllBatchToPdf
}: PdfGeneratorProps) {
  // Page & Guide Settings
  const [paperSize, setPaperSize] = useState<PaperSize>('letter');
  const [guideWidthMm, setGuideWidthMm] = useState<number>(0.265);
  const [guideColor, setGuideColor] = useState<string>('#000000');
  const [showGuides, setShowGuides] = useState<boolean>(true);
  const [extendGuidesToEdge, setExtendGuidesToEdge] = useState<boolean>(true);
  const [trimToCutSize, setTrimToCutSize] = useState<boolean>(true);

  // Active preview page
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number } | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Flattened cards across all quantities
  const flattenedCards = useMemo(() => {
    const list: PdfCardItem[] = [];
    for (const item of pdfCards) {
      const q = Math.max(1, item.quantity || 1);
      for (let i = 0; i < q; i++) {
        list.push(item);
      }
    }
    return list;
  }, [pdfCards]);

  const totalCards = flattenedCards.length;
  const totalPages = Math.max(1, Math.ceil(totalCards / 9));

  // Clamp current page if totalPages shrinks
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Adjust quantity
  const handleUpdateQuantity = (id: string, delta: number) => {
    setPdfCards((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const newQ = Math.max(1, (item.quantity || 1) + delta);
            return { ...item, quantity: newQ };
          }
          return item;
        })
    );
  };

  const handleSetPlayset = (id: string, count: number) => {
    setPdfCards((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity: count } : item))
    );
  };

  const handleRemoveCard = (id: string) => {
    setPdfCards((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearAll = () => {
    setPdfCards([]);
  };

  // Render the interactive 3x3 sheet canvas preview for the current page
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const paper = PAPER_DIMENSIONS_PT[paperSize] || PAPER_DIMENSIONS_PT.letter;

    // Render preview canvas at 2x screen resolution for crisp display
    const renderScale = 2.0;
    const canvasW = Math.round(paper.wPt * renderScale);
    const canvasH = Math.round(paper.hPt * renderScale);

    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    // 1. Draw crisp white paper sheet background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // 2. Compute exact 3x3 layout
    const cardWPt = (cardStandard.widthMm || 63.0) * MM_TO_PT;
    const cardHPt = (cardStandard.heightMm || 88.0) * MM_TO_PT;

    const gridWPt = 3 * cardWPt;
    const gridHPt = 3 * cardHPt;

    const marginXPt = (paper.wPt - gridWPt) / 2;
    const marginYPt = (paper.hPt - gridHPt) / 2;

    const startIdx = (currentPage - 1) * 9;
    const pageItems = flattenedCards.slice(startIdx, startIdx + 9);

    // 3. Draw cards or empty slot placeholders
    for (let slot = 0; slot < 9; slot++) {
      const col = slot % 3;
      const row = Math.floor(slot / 3);

      const xPt = marginXPt + col * cardWPt;
      // In canvas, y=0 is top, so row 0 is top
      const yPt = marginYPt + row * cardHPt;

      const destX = Math.round(xPt * renderScale);
      const destY = Math.round(yPt * renderScale);
      const destW = Math.round(cardWPt * renderScale);
      const destH = Math.round(cardHPt * renderScale);

      if (slot < pageItems.length) {
        const item = pageItems[slot];
        try {
          ctx.drawImage(item.renderedCanvas, destX, destY, destW, destH);
        } catch {
          // Fallback if drawImage fails
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(destX, destY, destW, destH);
        }
      } else {
        // Empty slot placeholder
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(destX, destY, destW, destH);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.strokeRect(destX, destY, destW, destH);

        ctx.fillStyle = '#94a3b8';
        ctx.font = `${Math.round(10 * renderScale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Empty Slot ${slot + 1}`, destX + destW / 2, destY + destH / 2);
      }
    }

    // 4. Draw Cutting Guides (0.265mm width)
    if (showGuides) {
      ctx.strokeStyle = guideColor;
      const strokeWidthPx = Math.max(0.5, guideWidthMm * MM_TO_PT * renderScale);
      ctx.lineWidth = strokeWidthPx;

      const x0 = marginXPt * renderScale;
      const x1 = (marginXPt + 1 * cardWPt) * renderScale;
      const x2 = (marginXPt + 2 * cardWPt) * renderScale;
      const x3 = (marginXPt + 3 * cardWPt) * renderScale;

      const y0 = marginYPt * renderScale;
      const y1 = (marginYPt + 1 * cardHPt) * renderScale;
      const y2 = (marginYPt + 2 * cardHPt) * renderScale;
      const y3 = (marginYPt + 3 * cardHPt) * renderScale;

      const vertXs = [x0, x1, x2, x3];
      const horizYs = [y0, y1, y2, y3];

      ctx.beginPath();

      // Vertical guide lines
      for (const vx of vertXs) {
        if (extendGuidesToEdge) {
          ctx.moveTo(vx, 0);
          ctx.lineTo(vx, canvasH);
        } else {
          const tickPx = 5 * MM_TO_PT * renderScale;
          ctx.moveTo(vx, y0 - tickPx);
          ctx.lineTo(vx, y3 + tickPx);
        }
      }

      // Horizontal guide lines
      for (const hy of horizYs) {
        if (extendGuidesToEdge) {
          ctx.moveTo(0, hy);
          ctx.lineTo(canvasW, hy);
        } else {
          const tickPx = 5 * MM_TO_PT * renderScale;
          ctx.moveTo(x0 - tickPx, hy);
          ctx.lineTo(x3 + tickPx, hy);
        }
      }

      ctx.stroke();
    }
  }, [
    paperSize,
    currentPage,
    flattenedCards,
    cardStandard,
    guideWidthMm,
    guideColor,
    showGuides,
    extendGuidesToEdge
  ]);

  // Export full print-ready PDF
  const handleDownloadPdf = async () => {
    if (pdfCards.length === 0) return;
    setIsGeneratingPdf(true);
    setPdfProgress({ current: 0, total: flattenedCards.length });

    try {
      const config: PdfSheetConfig = {
        paperSize,
        cardWidthMm: cardStandard.widthMm || 63.0,
        cardHeightMm: cardStandard.heightMm || 88.0,
        guideWidthMm,
        guideColor,
        showGuides,
        extendGuidesToEdge
      };

      const pdfInputs = pdfCards.map((c) => ({
        id: c.id,
        fileName: c.fileName,
        canvas: c.renderedCanvas,
        quantity: c.quantity,
        adjustments: c.adjustments
      }));

      const pdfBlob = await createProxyPrintPdf({
        cards: pdfInputs,
        config,
        onProgress: (cur, tot) => setPdfProgress({ current: cur, total: tot })
      });

      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `proxyprint_sheet_${paperSize}_${totalCards}cards.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setIsGeneratingPdf(false);
      setPdfProgress(null);
    }
  };

  const paperInfo = PAPER_DIMENSIONS_PT[paperSize] || PAPER_DIMENSIONS_PT.letter;
  const paperWIn = (paperInfo.wPt / 72).toFixed(2);
  const paperHIn = (paperInfo.hPt / 72).toFixed(2);
  const paperWMm = (paperInfo.wPt / MM_TO_PT).toFixed(1);
  const paperHMm = (paperInfo.hPt / MM_TO_PT).toFixed(1);

  const cardWMm = (cardStandard.widthMm || 63.0).toFixed(1);
  const cardHMm = (cardStandard.heightMm || 88.0).toFixed(1);
  const marginX = (((paperInfo.wPt - 3 * (cardStandard.widthMm || 63.0) * MM_TO_PT) / 2) / MM_TO_PT).toFixed(1);
  const marginY = (((paperInfo.hPt - 3 * (cardStandard.heightMm || 88.0) * MM_TO_PT) / 2) / MM_TO_PT).toFixed(1);

  return (
    <div className="lg:col-span-12 flex flex-col gap-6">
      {/* Top Banner & Primary Sheet Actions */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 font-mono text-[10px] uppercase font-bold border border-indigo-500/30">
                Print Sheets
              </span>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
                PDF Generator (3×3 Grid)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Formats pre-press compensated cards into a centered 3×3 grid on standard US Letter or A4 paper.
              Embeds 100% lossless full-resolution pixels with razor-sharp {guideWidthMm}mm cut lines.
            </p>
          </div>

          {/* Quick Settings & Download Button */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Paper Size Toggle */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setPaperSize('letter')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  paperSize === 'letter'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                US Letter (8.5×11″)
              </button>
              <button
                type="button"
                onClick={() => setPaperSize('a4')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  paperSize === 'a4'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                A4 (210×297mm)
              </button>
            </div>

            {/* Guides Toggle */}
            <button
              type="button"
              onClick={() => setShowGuides(!showGuides)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition cursor-pointer ${
                showGuides
                  ? 'bg-indigo-500/15 text-indigo-200 border-indigo-500/40'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              Guides: {showGuides ? `${guideWidthMm}mm` : 'Off'}
            </button>

            {/* Primary Download Button */}
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={pdfCards.length === 0 || isGeneratingPdf}
              className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg transition cursor-pointer ${
                pdfCards.length === 0 || isGeneratingPdf
                  ? 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
                  : 'bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white shadow-indigo-600/30'
              }`}
            >
              <Download className="w-4 h-4" />
              {isGeneratingPdf
                ? pdfProgress
                  ? `Compressing (${pdfProgress.current}/${pdfProgress.total})...`
                  : 'Generating PDF...'
                : `Download Print-Ready PDF (${totalCards} Cards • ${totalPages} ${
                    totalPages === 1 ? 'Sheet' : 'Sheets'
                  })`}
            </button>
          </div>
        </div>

        {/* Paper Geometry & Scale Notice */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400">
          <div className="flex items-center gap-4 flex-wrap">
            <span>
              Sheet:{' '}
              <span className="font-mono text-slate-200 font-semibold">
                {paperWMm} × {paperHMm} mm ({paperWIn}″ × {paperHIn}″)
              </span>
            </span>
            <span>
              Card Cut Size:{' '}
              <span className="font-mono text-slate-200 font-semibold">
                {cardWMm} × {cardHMm} mm
              </span>
            </span>
            <span>
              Margins:{' '}
              <span className="font-mono text-indigo-300">
                H: {marginX} mm • V: {marginY} mm
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-amber-300 font-medium">
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>Printer Scale: Select <strong>&ldquo;Actual Size&rdquo;</strong> (100%), do not select &ldquo;Fit to Page&rdquo;.</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Grid (Left: Card Queue, Right: Sheet Preview) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (5 cols): Card Selection, Playsets & Guide Options */}
        <div className="lg:col-span-5 space-y-5">
          {/* Queue Header & Batch Selector */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  Cards in PDF Queue
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {totalCards} Total ({pdfCards.length} Unique)
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Set quantities or add playsets (4x) of each card.
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {batchItems.length > 0 && (
                  <button
                    type="button"
                    onClick={onAddAllBatchToPdf}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition cursor-pointer flex items-center gap-1"
                    title="Add all optimized cards from batch"
                  >
                    <Plus className="w-3 h-3" />
                    Add All from Batch ({batchItems.length})
                  </button>
                )}
                {pdfCards.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="p-1.5 rounded-lg bg-slate-950 text-slate-400 hover:text-rose-400 border border-slate-800 text-xs transition cursor-pointer"
                    title="Clear PDF queue"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Card Queue List */}
            {pdfCards.length === 0 ? (
              <div className="bg-slate-950/70 border border-dashed border-slate-800 rounded-xl p-8 text-center flex flex-col items-center justify-center gap-2">
                <FileSpreadsheet className="w-8 h-8 text-slate-600 mb-1" />
                <div className="text-xs font-bold text-slate-300">
                  PDF Queue is Empty
                </div>
                <p className="text-[11px] text-slate-500 max-w-xs">
                  {batchItems.length > 0
                    ? `You have ${batchItems.length} cards in Batch Auto-Adjust. Click below to add them to your printable sheets.`
                    : 'Switch to Batch Studio to upload or generate cards with pre-press compensation.'}
                </p>
                {batchItems.length > 0 ? (
                  <button
                    type="button"
                    onClick={onAddAllBatchToPdf}
                    className="mt-2 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Load {batchItems.length} Batch Cards
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSwitchToBatch}
                    className="mt-2 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
                  >
                    Open Batch Studio
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {pdfCards.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-3 hover:border-slate-700 transition"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={item.thumbUrl}
                        alt={item.fileName}
                        className="w-10 h-14 object-cover rounded border border-slate-800 shrink-0"
                      />
                      <div className="min-w-0">
                        <div
                          className="text-xs font-bold text-slate-100 truncate"
                          title={item.fileName}
                        >
                          {item.fileName}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {item.renderedCanvas.width}×{item.renderedCanvas.height}px
                          {item.adjustments.shadowLift > 0 ? ` • Lift +${item.adjustments.shadowLift}` : ''}
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSetPlayset(item.id, 1)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold transition cursor-pointer ${
                              item.quantity === 1
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                            }`}
                          >
                            1x
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetPlayset(item.id, 4)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold transition cursor-pointer ${
                              item.quantity === 4
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                            }`}
                          >
                            4x (Playset)
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Quantity Stepper & Remove */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center bg-slate-900 rounded-lg border border-slate-800 p-0.5">
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(item.id, -1)}
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white rounded transition cursor-pointer"
                          title="Decrease quantity"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center text-xs font-mono font-bold text-slate-200">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(item.id, 1)}
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white rounded transition cursor-pointer"
                          title="Increase quantity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveCard(item.id)}
                        className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer transition"
                        title="Remove from sheet"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Guide Line & Cutting Settings Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Scissors className="w-4 h-4 text-indigo-400" />
              Guide &amp; Cutting Configuration
            </h3>

            {/* Guide Width input (width 0.265mm) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-slate-300">
                  Guide Line Width (Stroke)
                </label>
                <span className="text-[10px] text-indigo-400 font-mono">
                  {guideWidthMm} mm ({((guideWidthMm / 25.4) * 1000).toFixed(1)} mils)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="0.05"
                    max="2.0"
                    step="0.015"
                    value={guideWidthMm}
                    onChange={(e) => setGuideWidthMm(Math.max(0.05, parseFloat(e.target.value) || 0.265))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  <span className="absolute right-3 top-2 text-[11px] font-mono text-slate-500 pointer-events-none">
                    mm
                  </span>
                </div>
                <div className="flex gap-1">
                  {[0.15, 0.265, 0.4].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setGuideWidthMm(w)}
                      className={`px-2 py-1.5 rounded-lg text-[10px] font-mono font-semibold transition cursor-pointer ${
                        guideWidthMm === w
                          ? 'bg-indigo-600 text-white shadow'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {w === 0.265 ? '0.265 (Std)' : `${w}mm`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Guide Color */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                Guide Line Color
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Black', hex: '#000000', border: 'border-slate-800' },
                  { label: 'Dark Gray', hex: '#333333', border: 'border-slate-700' },
                  { label: 'Light Gray', hex: '#999999', border: 'border-slate-600' }
                ].map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setGuideColor(c.hex)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                      guideColor === c.hex
                        ? 'bg-indigo-600/20 text-white border-indigo-500 shadow'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border-slate-800'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-slate-500"
                      style={{ backgroundColor: c.hex }}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Extend Guides to Edge */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={extendGuidesToEdge}
                onChange={(e) => setExtendGuidesToEdge(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-slate-950 border-slate-800"
              />
              <span className="text-xs text-slate-300 font-medium">
                Extend cutting lines to paper edges (optimal for rotary trimmers)
              </span>
            </label>

            {/* Quality & Lossless Guarantee */}
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                100% Bit-for-Bit Lossless Quality
              </div>
              <p className="leading-relaxed">
                Images are embedded into PDF streams using mathematical Flate/Deflate encoding with <strong>zero downscaling</strong> and <strong>zero JPEG quantization</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column (7 cols): Interactive Physical Sheet Preview */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          {/* Sheet Preview Navigation Bar */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 shadow-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className={`p-1.5 rounded-lg border transition ${
                  currentPage <= 1
                    ? 'bg-slate-950 text-slate-600 border-slate-800 cursor-not-allowed'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 cursor-pointer'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="text-xs font-mono font-bold text-slate-200 px-2">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className={`p-1.5 rounded-lg border transition ${
                  currentPage >= totalPages
                    ? 'bg-slate-950 text-slate-600 border-slate-800 cursor-not-allowed'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 cursor-pointer'
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="text-[11px] font-mono text-slate-400">
              Showing cards {(currentPage - 1) * 9 + 1}–{Math.min(totalCards, currentPage * 9)} of {totalCards}
            </div>
          </div>

          {/* Physical Sheet Canvas Display (Drafting Board) */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center justify-center min-h-[550px] relative overflow-hidden">
            {/* Background Grid Pattern */}
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#6366f1_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

            {/* Paper Sheet Preview Container */}
            <div
              className="relative bg-white shadow-2xl transition-all duration-300 rounded-[2px]"
              style={{
                maxWidth: '100%',
                maxHeight: '680px',
                aspectRatio: `${PAPER_DIMENSIONS_PT[paperSize].wPt} / ${PAPER_DIMENSIONS_PT[paperSize].hPt}`,
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1)'
              }}
            >
              <canvas
                ref={previewCanvasRef}
                className="w-full h-full object-contain block rounded-[2px]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PdfGenerator;
