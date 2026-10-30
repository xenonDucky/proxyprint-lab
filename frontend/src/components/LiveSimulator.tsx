import React from 'react';
import {
  Sliders,
  RotateCcw,
  Moon,
  Sparkles,
  ShieldAlert,
  CheckCircle2,
  Plus
} from 'lucide-react';
import {
  DPI_BENCHMARKS,
  computeSharpenForTargetDpi,
  AdjustmentParams
} from '../colorScience';
import { PipelineAnalysisResult, BatchCardItem, StudioMode, InputMode } from '../types';

export interface LiveSimulatorProps {
  adjustments: AdjustmentParams;
  setAdjustments: React.Dispatch<React.SetStateAction<AdjustmentParams>>;
  hasAnyAdjustment: boolean;
  resetAdjustments: () => void;
  analysis: PipelineAnalysisResult;
  inputMode: InputMode | string;
  padMpcBleed: boolean;
  setPadMpcBleed: (pad: boolean) => void;
  handleSaveCurrentToBatch: () => void;
  batchSaveFlash: boolean;
  existingBatchMatch: BatchCardItem | null;
  setStudioMode: (mode: StudioMode) => void;
}

export function LiveSimulator({
  adjustments,
  setAdjustments,
  hasAnyAdjustment,
  resetAdjustments,
  analysis,
  inputMode,
  padMpcBleed,
  setPadMpcBleed,
  handleSaveCurrentToBatch,
  batchSaveFlash,
  existingBatchMatch,
  setStudioMode
}: LiveSimulatorProps) {
  const curScores = analysis.current.scores;
  const baseScores = analysis.baseline.scores;
  const curMetrics = analysis.current.metrics;
  const geom = analysis.geometry;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-indigo-400" />
          3. Live Adjustment Simulator (60 FPS)
        </h2>
        {hasAnyAdjustment && (
          <button
            onClick={resetAdjustments}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        )}
      </div>

      {/* Live Before -> After Score Comparison Banner */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[10px] uppercase text-slate-400 font-semibold">
            Original Shadow
          </div>
          <div className="text-base font-bold text-slate-300">
            {baseScores.shadow}/100
          </div>
        </div>
        <div className="border-x border-slate-800">
          <div className="text-[10px] uppercase text-indigo-300 font-semibold">
            Adjusted Shadow
          </div>
          <div className="text-base font-extrabold text-emerald-400">
            {curScores.shadow}/100
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-400 font-semibold">
            Detail Retained
          </div>
          <div className="text-base font-bold text-indigo-400">
            {curMetrics.shadowRetentionPct}%
          </div>
        </div>
      </div>

      {/* 5 Adjustment Sliders */}
      <div className="space-y-3">
        {/* Slider 1: Shadow Recovery (Toe Lift) */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              Shadow Recovery (Toe Lift)
            </span>
            <span className="font-mono text-indigo-300 font-bold">
              +{adjustments.shadowLift}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="80"
            step="1"
            value={adjustments.shadowLift}
            onChange={(e) =>
              setAdjustments((prev) => ({
                ...prev,
                shadowLift: Number(e.target.value)
              }))
            }
            className="w-full accent-indigo-500 cursor-pointer"
          />
          <p className="text-[10px] text-slate-400">
            Selectively lifts L* 3–25 above the printer&apos;s black crush floor without washing out highlights.
          </p>
        </div>

        {/* Slider 2: Gamma */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-semibold text-slate-200">
              Midtone Gamma
            </span>
            <span className="font-mono text-indigo-300 font-bold">
              {adjustments.gamma.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="0.75"
            max="1.45"
            step="0.02"
            value={adjustments.gamma}
            onChange={(e) =>
              setAdjustments((prev) => ({
                ...prev,
                gamma: Number(e.target.value)
              }))
            }
            className="w-full accent-indigo-500 cursor-pointer"
          />
        </div>

        {/* Slider 3: Local Contrast */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-semibold text-slate-200">
              Tonal Contrast
            </span>
            <span className="font-mono text-indigo-300 font-bold">
              {adjustments.contrast > 0 ? `+${adjustments.contrast}` : adjustments.contrast}%
            </span>
          </div>
          <input
            type="range"
            min="-30"
            max="40"
            step="1"
            value={adjustments.contrast}
            onChange={(e) =>
              setAdjustments((prev) => ({
                ...prev,
                contrast: Number(e.target.value)
              }))
            }
            className="w-full accent-indigo-500 cursor-pointer"
          />
        </div>

        {/* Slider 4 & 5: Global Brightness & Saturation */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-semibold text-slate-200">Brightness</span>
              <span className="font-mono text-slate-300">
                {adjustments.brightness > 0
                  ? `+${adjustments.brightness}`
                  : adjustments.brightness}
                %
              </span>
            </div>
            <input
              type="range"
              min="-25"
              max="35"
              step="1"
              value={adjustments.brightness}
              onChange={(e) =>
                setAdjustments((prev) => ({
                  ...prev,
                  brightness: Number(e.target.value)
                }))
              }
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-semibold text-slate-200">Saturation</span>
              <span className="font-mono text-slate-300">
                {adjustments.saturation > 0
                  ? `+${adjustments.saturation}`
                  : adjustments.saturation}
                %
              </span>
            </div>
            <input
              type="range"
              min="-35"
              max="35"
              step="1"
              value={adjustments.saturation}
              onChange={(e) =>
                setAdjustments((prev) => ({
                  ...prev,
                  saturation: Number(e.target.value)
                }))
              }
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Dual-Region Smart Sharpen (Art Box + Card Text Box) */}
        <div className="pt-2.5 border-t border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Dual-Region DPI &amp; Smart Sharpen
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400">
              Min {DPI_BENCHMARKS.min} • Ideal {DPI_BENCHMARKS.ideal} • Max {DPI_BENCHMARKS.max} DPI
            </span>
          </div>

          {/* Slider 6a: Art Box Target DPI & Sharpen */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                Art Box DPI &amp; Sharpen
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {inputMode === 'full_card' ? 'Art Region' : 'Whole Card'}
                </span>
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                    curMetrics.effectiveArtPpi >= DPI_BENCHMARKS.ideal
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : curMetrics.effectiveArtPpi >= DPI_BENCHMARKS.min
                      ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                      : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                  }`}
                >
                  {geom.effectiveOpticalPpi} → {curMetrics.effectiveArtPpi} DPI
                </span>
                <span className="font-mono text-amber-300 font-bold">
                  {adjustments.artTargetDpi ??
                    ((adjustments.sharpen || 0) > 0 ? DPI_BENCHMARKS.ideal : DPI_BENCHMARKS.min)}{' '}
                  DPI (+{adjustments.sharpen || 0}%)
                </span>
              </div>
            </div>
            <input
              type="range"
              min={DPI_BENCHMARKS.min}
              max={DPI_BENCHMARKS.max}
              step={10}
              value={
                adjustments.artTargetDpi ??
                ((adjustments.sharpen || 0) > 0 ? DPI_BENCHMARKS.ideal : DPI_BENCHMARKS.min)
              }
              onChange={(e) => {
                const targetDpi = Number(e.target.value);
                const computedSharpen = computeSharpenForTargetDpi(
                  geom.effectiveOpticalPpi,
                  targetDpi,
                  'art'
                );
                setAdjustments((prev) => ({
                  ...prev,
                  artTargetDpi: targetDpi,
                  sharpen: computedSharpen
                }));
              }}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono">
              <span>Min: {DPI_BENCHMARKS.min} DPI</span>
              <span className="text-amber-300 font-semibold">
                Ideal: {DPI_BENCHMARKS.ideal} DPI
              </span>
              <span>Max: {DPI_BENCHMARKS.max} DPI</span>
            </div>
          </div>

          {/* Slider 6b: Card Text Box Target DPI & Sharpen */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                Card Text Box DPI &amp; Sharpen
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">
                  Type &amp; Rules Box
                </span>
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                    curMetrics.effectiveTextPpi >= DPI_BENCHMARKS.ideal
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : curMetrics.effectiveTextPpi >= DPI_BENCHMARKS.min
                      ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                      : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                  }`}
                >
                  {geom.textOpticalPpi} → {curMetrics.effectiveTextPpi} DPI
                </span>
                <span className="font-mono text-violet-300 font-bold">
                  {adjustments.textTargetDpi ??
                    ((adjustments.textBoxSharpen || 0) > 0 ? DPI_BENCHMARKS.ideal : DPI_BENCHMARKS.min)}{' '}
                  DPI (+{adjustments.textBoxSharpen || 0}%)
                </span>
              </div>
            </div>
            <input
              type="range"
              min={DPI_BENCHMARKS.min}
              max={DPI_BENCHMARKS.max}
              step={10}
              value={
                adjustments.textTargetDpi ??
                ((adjustments.textBoxSharpen || 0) > 0 ? DPI_BENCHMARKS.ideal : DPI_BENCHMARKS.min)
              }
              onChange={(e) => {
                const targetDpi = Number(e.target.value);
                const computedTextSharpen = computeSharpenForTargetDpi(
                  geom.textOpticalPpi,
                  targetDpi,
                  'text'
                );
                setAdjustments((prev) => ({
                  ...prev,
                  textTargetDpi: targetDpi,
                  textBoxSharpen: computedTextSharpen
                }));
              }}
              className="w-full accent-violet-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono">
              <span>Min: {DPI_BENCHMARKS.min} DPI</span>
              <span className="text-violet-300 font-semibold">
                Ideal: {DPI_BENCHMARKS.ideal} DPI
              </span>
              <span>Max: {DPI_BENCHMARKS.max} DPI</span>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 leading-relaxed">
            <span className="text-slate-200 font-semibold">Auto-Optimize for Printer</span> optimizes tone, gamma, shadow lift, and color reproduction without applying artificial sharpening, preserving unadulterated source resolution so you can easily identify artwork that requires a higher-quality source image.
          </p>

          {/* Golden Rule of Print Warning for Low-Resolution / Upscaled Artwork */}
          {(geom.isLikelyUpscaled ||
            geom.effectiveOpticalPpi < DPI_BENCHMARKS.min ||
            geom.textOpticalPpi < DPI_BENCHMARKS.min ||
            baseScores.resolution < 75) && (
            <div className="mt-2 p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-200 leading-snug font-medium">
                Warning: This image’s original resolution is too low. Sharpening will increase edge contrast but cannot restore lost detail. For best results, use higher resolution source artwork.
              </p>
            </div>
          )}
        </div>

        {/* 3mm MPC Bleed Padding Toggle */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-200">
              Add 3mm MPC Black Bleed Border
            </div>
            <div className="text-[11px] text-slate-400">
              Pads trim-sized cards (63×88mm → 69×94mm) for die-cutting safety
            </div>
          </div>
          <button
            onClick={() => setPadMpcBleed(!padMpcBleed)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
              padMpcBleed
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {padMpcBleed ? 'Added (+3mm)' : 'Off'}
          </button>
        </div>

        {/* Save / Overwrite Card in Batch Queue Action */}
        <div className="pt-2 border-t border-slate-800 flex items-center gap-2">
          <button
            onClick={handleSaveCurrentToBatch}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-2 transition cursor-pointer ${
              batchSaveFlash
                ? 'bg-emerald-500/25 text-emerald-200 border-emerald-400 shadow-lg shadow-emerald-500/20'
                : existingBatchMatch
                ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-500/40'
                : 'bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 border-indigo-500/40'
            }`}
          >
            {batchSaveFlash ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                {existingBatchMatch ? 'Updated Parameters in Batch!' : 'Saved to Batch Queue!'}
              </>
            ) : existingBatchMatch ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-amber-400" />
                Save &amp; Overwrite in Batch ({existingBatchMatch.fileName})
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 text-indigo-400" />
                Save Card to Batch Queue
              </>
            )}
          </button>

          {existingBatchMatch && (
            <button
              onClick={() => {
                handleSaveCurrentToBatch();
                setStudioMode('batch');
              }}
              className="py-2 px-3 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow transition cursor-pointer whitespace-nowrap"
            >
              Save &amp; Return to Batch
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
export default LiveSimulator;
