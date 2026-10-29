import React, { RefObject } from 'react';
import {
  Layers,
  Image as ImageIcon,
  Eye,
  Flame,
  Palette,
  Grid,
  Sparkles,
  Activity
} from 'lucide-react';
import { ViewMode, InputMode, PrinterProfile, PipelineAnalysisResult } from '../types';

export interface SoftProofViewerProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  showGeometryGuides: boolean;
  setShowGeometryGuides: (show: boolean) => void;
  inputMode: InputMode | string;
  printerProfile: PrinterProfile;
  analysis: PipelineAnalysisResult;
  hasAnyAdjustment: boolean;
  mainPreviewCanvasRef: RefObject<HTMLCanvasElement | null>;
  origCompareCanvasRef: RefObject<HTMLCanvasElement | null>;
  simCompareCanvasRef: RefObject<HTMLCanvasElement | null>;
  heatmapCompareCanvasRef: RefObject<HTMLCanvasElement | null>;
}

export function SoftProofViewer({
  viewMode,
  setViewMode,
  showGeometryGuides,
  setShowGeometryGuides,
  inputMode,
  printerProfile,
  analysis,
  hasAnyAdjustment,
  mainPreviewCanvasRef,
  origCompareCanvasRef,
  simCompareCanvasRef,
  heatmapCompareCanvasRef
}: SoftProofViewerProps) {
  const curScores = analysis.current.scores;
  const baseScores = analysis.baseline.scores;
  const curMetrics = analysis.current.metrics;

  return (
    <section className="lg:col-span-5 flex flex-col gap-5">
      {/* Interactive Visual Inspection Toolbar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setViewMode('three_way')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'three_way'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              3-Way Preview
            </button>
            <button
              onClick={() => setViewMode('original_srgb')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'original_srgb'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Original sRGB
            </button>
            <button
              onClick={() => setViewMode('simulated')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'simulated'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Simulated Print
            </button>
            <button
              onClick={() => setViewMode('shadow_heatmap')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'shadow_heatmap'
                  ? 'bg-rose-600 text-white shadow'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              Shadow Loss Heatmap
            </button>
            <button
              onClick={() => setViewMode('gamut_heatmap')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'gamut_heatmap'
                  ? 'bg-fuchsia-600 text-white shadow'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              ΔE_2000 Shift
            </button>
            <button
              onClick={() => setViewMode('contrast_grid')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'contrast_grid'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              8×8 Contrast
            </button>
          </div>

          <button
            onClick={() => setShowGeometryGuides(!showGeometryGuides)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
              showGeometryGuides
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            {showGeometryGuides ? 'Guides: ON' : 'Guides: OFF'}
          </button>
        </div>

        {/* Canvas Display Area */}
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-950/90 rounded-xl border border-slate-800/80 p-4 min-h-[420px]">
          {viewMode === 'three_way' ? (
            <div className="w-full space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                {/* Preview 1: Original sRGB */}
                <div className="flex flex-col items-center bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[11px] font-bold text-slate-200 mb-1">
                    1. Original sRGB
                  </span>
                  <span className="text-[10px] text-slate-400 mb-2 text-center">
                    Backlit monitor emission
                  </span>
                  <canvas
                    ref={origCompareCanvasRef}
                    className="w-full max-w-[210px] h-auto rounded-lg shadow-lg border border-slate-700"
                  />
                  <div className="mt-2 text-[11px] text-slate-300 font-medium">
                    Baseline Score:{' '}
                    <span className="font-bold text-amber-400">
                      {baseScores.overall}/100
                    </span>
                  </div>
                </div>

                {/* Preview 2: Simulated Print with User Adjustments */}
                <div className="flex flex-col items-center bg-indigo-950/30 p-2.5 rounded-xl border-2 border-indigo-500/60 shadow-lg">
                  <span className="text-[11px] font-bold text-indigo-300 mb-1 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    2. Simulated Print {hasAnyAdjustment ? '(Live LUT)' : ''}
                  </span>
                  <span className="text-[10px] text-indigo-200/70 mb-2 text-center">
                    {printerProfile.badge} • L*min={printerProfile.blackFloorL}
                  </span>
                  <canvas
                    ref={simCompareCanvasRef}
                    className="w-full max-w-[210px] h-auto rounded-lg shadow-lg border border-indigo-500/40"
                  />
                  <div className="mt-2 text-[11px] text-slate-200 font-medium">
                    Shadow Score:{' '}
                    <span className="font-bold text-emerald-400">
                      {curScores.shadow}/100
                    </span>
                  </div>
                </div>

                {/* Preview 3: Shadow Loss Risk Heatmap */}
                <div className="flex flex-col items-center bg-slate-900/80 p-2.5 rounded-xl border border-rose-500/40">
                  <span className="text-[11px] font-bold text-rose-300 mb-1 flex items-center gap-1">
                    <Flame className="w-3.5 h-3.5" />
                    3. Shadow Loss Risk Heatmap
                  </span>
                  <span className="text-[10px] text-slate-400 mb-2 text-center">
                    11×11 Window Crush Risk
                  </span>
                  <canvas
                    ref={heatmapCompareCanvasRef}
                    className="w-full max-w-[210px] h-auto rounded-lg shadow-lg border border-slate-700"
                  />
                  <div className="mt-2 text-[11px] text-rose-300/90 font-medium">
                    Crushed Dark Area: {curMetrics.crushedShadowPct}%
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <canvas
                ref={mainPreviewCanvasRef}
                className="max-w-[330px] w-full h-auto rounded-xl shadow-2xl border border-slate-700"
              />
            </div>
          )}

          {/* Legend for Overlays & Geometry Guides */}
          <div className="w-full mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            {viewMode === 'shadow_heatmap' || viewMode === 'three_way' ? (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-slate-200">
                  Shadow Heatmap:
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />
                  Red: Crushed (L*&lt;15 / Low 11×11 StdDev)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
                  Yellow: Moderate
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                  Green: Crisp Shadow Texture
                </span>
              </div>
            ) : viewMode === 'gamut_heatmap' ? (
              <div className="flex items-center gap-4 flex-wrap">
                <span className="font-semibold text-slate-200">
                  CMYK Color Gamut Shift (ΔE_2000):
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-pink-500 inline-block" />
                  Magenta Highlight: Out-of-gamut color shift (ΔE_00 &gt; 6.5)
                </span>
                <span>Mean ΔE_00: {curMetrics.meanDeltaE}</span>
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-rose-500 inline-block" />
                  3mm Bleed Edge
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" />
                  63×88mm Cut Line
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" />
                  Safe Margin
                </span>
                {inputMode === 'full_card' && (
                  <>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-0.5 bg-amber-400 inline-block" />
                      Art Box Window
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-0.5 bg-violet-400 inline-block" />
                      Card Text Box Window
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Perceptual CIELAB L* Luminance Histogram & Printer Black Floor Cutoff */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-400" />
              CIELAB Perceptual Lightness (L*) Histogram
            </h3>
            <p className="text-[11px] text-slate-400">
              Red zone indicates tones in the crush zone (L* &lt; 15 / ink floor L*={' '}
              {printerProfile.blackFloorL}) where shadow details merge.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-indigo-300">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500/70 inline-block" />
              Artwork L*
            </span>
            <span className="flex items-center gap-1.5 text-rose-300">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/40 border border-rose-500 inline-block" />
              Crush Zone (L*&lt;15: {curMetrics.pctUnder15}%)
            </span>
          </div>
        </div>

        {/* Histogram SVG Bars */}
        <div className="relative h-28 bg-slate-950 rounded-xl border border-slate-800 p-2 flex items-end gap-[2px] overflow-hidden">
          <div
            className="absolute top-0 bottom-0 left-0 bg-rose-500/15 border-r border-dashed border-rose-500/70 z-10 pointer-events-none flex items-start justify-end pr-1 pt-1"
            style={{ width: `${printerProfile.shadowCrushThreshold}%` }}
          >
            <span className="text-[9px] font-bold text-rose-300 uppercase">
              Dot-Gain Crush Zone
            </span>
          </div>

          {analysis.current.histograms.original.map((count: number, idx: number) => {
            const maxBin = Math.max(...analysis.current.histograms.original, 1);
            const heightPct = Math.min(100, Math.round((count / maxBin) * 100));
            const binL = idx * 2;
            const isInCrush = binL < 15 || binL < printerProfile.blackFloorL;
            const isInShadow = binL < 22;
            return (
              <div
                key={idx}
                className="flex-1 h-full flex items-end"
                title={`L* ${binL}–${binL + 2}: ${count} px`}
              >
                <div
                  className={`w-full rounded-t transition-all duration-150 ${
                    isInCrush
                      ? 'bg-rose-500'
                      : isInShadow
                      ? 'bg-amber-400/85'
                      : 'bg-indigo-500/75'
                  }`}
                  style={{ height: `${Math.max(3, heightPct)}%` }}
                />
              </div>
            );
          })}
        </div>

        <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1.5 px-1">
          <span>L*=0 (Pure Black)</span>
          <span>L*&lt;15 ({curMetrics.pctUnder15}% px)</span>
          <span>L*&lt;20 ({curMetrics.pctUnder20}% px)</span>
          <span>L*=50 (Midtones)</span>
          <span>L*=100 (Paper White)</span>
        </div>
      </div>
    </section>
  );
}
export default SoftProofViewer;
