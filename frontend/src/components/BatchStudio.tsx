import React, { RefObject } from 'react';
import {
  FolderArchive,
  Sparkles,
  Trash2,
  Upload,
  CheckCircle2,
  Sliders,
  FileSpreadsheet,
  Plus
} from 'lucide-react';
import { BatchCardItem, PrinterProfile, InputMode } from '../types';
import { getScoreBadgeStyle } from '../constants';
import { DPI_BENCHMARKS } from '../colorScience';

export interface BatchStudioProps {
  batchItems: BatchCardItem[];
  setBatchItems: React.Dispatch<React.SetStateAction<BatchCardItem[]>>;
  printerProfile: PrinterProfile;
  inputMode: InputMode | string;
  handleLoadDemoBatch: () => void;
  handleOptimizeBatch: () => void;
  handleExportBatchZip: () => void;
  isExportingZip: boolean;
  isBatchProcessing: boolean;
  handleBatchFilesUpload: (files: FileList | File[] | null) => void;
  batchFileInputRef: RefObject<HTMLInputElement | null>;
  handleInspectBatchItem: (item: BatchCardItem) => void;
  onAddBatchItemToPdf?: (item: BatchCardItem) => void;
  onAddAllBatchToPdf?: () => void;
}

export function BatchStudio({
  batchItems,
  setBatchItems,
  printerProfile,
  inputMode,
  handleLoadDemoBatch,
  handleOptimizeBatch,
  handleExportBatchZip,
  isExportingZip,
  isBatchProcessing,
  handleBatchFilesUpload,
  batchFileInputRef,
  handleInspectBatchItem,
  onAddBatchItemToPdf,
  onAddAllBatchToPdf
}: BatchStudioProps) {
  return (
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
              Upload multiple cards, configure your target on the left, and click{' '}
              <span className="text-indigo-300 font-semibold">Optimize</span> to tune all cards for{' '}
              <span className="text-indigo-300 font-semibold">{printerProfile.name}</span>{' '}
              ({inputMode === 'full_card' ? 'Art Box Only' : 'Entire Card'}).
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={handleLoadDemoBatch}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              Load 4 Sample Cards
            </button>
            <button
              type="button"
              onClick={handleOptimizeBatch}
              disabled={batchItems.length === 0 || isBatchProcessing}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg transition cursor-pointer ${
                batchItems.length === 0 || isBatchProcessing
                  ? 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-600/25'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              {isBatchProcessing ? 'Optimizing...' : 'Optimize'}
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
            {batchItems.length > 0 && onAddAllBatchToPdf && (
              <button
                type="button"
                onClick={onAddAllBatchToPdf}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-indigo-600/20 transition cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Send to PDF Generator
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
              ? 'Processing Batch Cards...'
              : 'Drop multiple MTG proxy images here or click to select files'}
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Cards are added to the batch queue without automatic modification. Click <span className="text-indigo-300 font-semibold">Optimize</span> when ready to run the 6-Stage Pipeline + Coarse-to-Fine Pattern Search using the Print Target settings on the left.
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
                        Art {item.geometry.effectiveOpticalPpi} DPI • Text {item.geometry.textOpticalPpi} DPI
                        {item.padBleed ? ' • +3mm Bleed' : ''}
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
                      {item.isOptimized !== false ? (
                        <span className="text-[10px] font-bold text-emerald-400 mb-1 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Adjusted ({optScore}/100)
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-amber-400 mb-1 flex items-center gap-1">
                          Unoptimized ({optScore}/100)
                        </span>
                      )}
                      <img
                        src={item.simThumbUrl}
                        alt="Simulated Print"
                        className={`w-full max-w-[125px] h-auto rounded-lg border shadow-md ${
                          item.isOptimized !== false
                            ? 'border-indigo-500/50'
                            : 'border-slate-800'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Applied Optimal Parameters Pills */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.isOptimized === false ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                        Not Optimized — Click Optimize to auto-adjust
                      </span>
                    ) : (
                      <>
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
                        {((item.adjustments.sharpen || 0) > 0 ||
                          (item.adjustments.artTargetDpi ?? 300) > 300) && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                            Art: {item.adjustments.artTargetDpi ?? DPI_BENCHMARKS.ideal} DPI (+{item.adjustments.sharpen}%)
                          </span>
                        )}
                        {((item.adjustments.textBoxSharpen || 0) > 0 ||
                          (item.adjustments.textTargetDpi ?? 300) > 300) && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300">
                            Text: {item.adjustments.textTargetDpi ?? DPI_BENCHMARKS.ideal} DPI (+{item.adjustments.textBoxSharpen}%)
                          </span>
                        )}
                      </>
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

                  <div className="flex items-center gap-2">
                    {onAddBatchItemToPdf && (
                      <button
                        type="button"
                        onClick={() => onAddBatchItemToPdf(item)}
                        className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                        title="Add to PDF Sheet"
                      >
                        <FileSpreadsheet className="w-3 h-3" />
                        + PDF
                      </button>
                    )}
                    <button
                      onClick={() => handleInspectBatchItem(item)}
                      className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Sliders className="w-3 h-3" />
                      Fine-Tune in Studio
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
export default BatchStudio;
