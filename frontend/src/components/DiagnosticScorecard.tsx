import React from 'react';
import { FileCheck, ShieldAlert } from 'lucide-react';
import { StageScoreCard } from './StageScoreCard';
import { CardStandard, PrinterProfile, PipelineAnalysisResult } from '../types';

export interface DiagnosticScorecardProps {
  cardStandard: CardStandard;
  printerProfile: PrinterProfile;
  analysis: PipelineAnalysisResult;
}

export function DiagnosticScorecard({
  cardStandard,
  printerProfile,
  analysis
}: DiagnosticScorecardProps) {
  const curScores = analysis.current.scores;
  const baseScores = analysis.baseline.scores;
  const curMetrics = analysis.current.metrics;
  const geom = analysis.geometry;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-indigo-400" />
          4. 6-Stage Diagnostic Scorecard
        </h2>
        <span className="text-[11px] font-mono text-slate-400">
          Q = min(Weighted, min(R,S,C)+15)
        </span>
      </div>

      {/* Bottleneck Cap Warning Banner */}
      {curScores.isBottleneckCapped && (
        <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="text-xs text-rose-200 leading-relaxed">
            <span className="font-bold">Critical Bottleneck Cap Active:</span> Linear weighted score would be{' '}
            <span className="font-mono font-bold">{curScores.weightedRaw}/100</span>, but{' '}
            <span className="font-bold underline">{curScores.bottleneckMetric}</span> is critically low, capping Overall Print Suitability at{' '}
            <span className="font-mono font-bold">{curScores.overall}/100</span>.
          </div>
        </div>
      )}

      <div className="space-y-3">
        <StageScoreCard
          title="Stage 1 & 2: Resolution, FFT Sharpness & Bleed (300 Min / 600 Ideal / 1200 Max DPI)"
          weight="20%"
          score={curScores.resolution}
          baseScore={baseScores.resolution}
          metrics={[
            `Size: ${geom.effectiveW}×${geom.effectiveH}px`,
            `Nominal: ${geom.nominalPpi} DPI`,
            `Art DPI: ${geom.effectiveOpticalPpi} → ${curMetrics.effectiveArtPpi} DPI`,
            `Text DPI: ${geom.textOpticalPpi} → ${curMetrics.effectiveTextPpi} DPI`,
            `FFT HF: ${geom.fftSharpnessRatio}%`,
            `3mm Bleed: ${geom.has3mmBleed ? 'Yes' : 'Missing'}`
          ]}
          explanation={
            geom.isLikelyUpscaled
              ? 'Warning: High pixel count detected, but Laplacian edge gradient & 2D FFT high-frequency energy are low. This image appears upscaled from a low-res source.'
              : cardStandard.requiresBleed && !geom.has3mmBleed
              ? 'Missing 3mm bleed margin for commercial cutting. Toggle "Add 3mm MPC Black Bleed Border" above.'
              : `Evaluated against 300 DPI minimum, 600 DPI ideal, and 1200 DPI maximum for both Art Box (${curMetrics.effectiveArtPpi} DPI) and Card Text Box (${curMetrics.effectiveTextPpi} DPI).`
          }
        />

        <StageScoreCard
          title="Stage 3: Shadow Detail Retention (11×11 Window)"
          weight="35%"
          score={curScores.shadow}
          baseScore={baseScores.shadow}
          metrics={[
            `Crush Zone L*<15: ${curMetrics.pctUnder15}%`,
            `Crushed Dark Area: ${curMetrics.crushedShadowPct}%`,
            `11×11 Gradient Kept: ${curMetrics.shadowRetentionPct}%`
          ]}
          explanation={
            curScores.shadow < 65
              ? `High risk of muddy shadows: ${curMetrics.crushedShadowPct}% of artwork pixels have low 11×11 local standard deviation inside the crush zone (L*<15 / ink floor L*=${printerProfile.blackFloorL}).`
              : 'Dark regions retain crisp 11×11 local luminance gradients on the selected paper profile.'
          }
        />

        <StageScoreCard
          title="Stage 4: Local Contrast (8×8 CLAHE Grid)"
          weight="15%"
          score={curScores.contrast}
          baseScore={baseScores.contrast}
          metrics={[
            `Mean Patch RMS: ±${curMetrics.avgPatchRms} L*`,
            `Low-Contrast Tiles: ${curMetrics.lowContrastPatches}/64`
          ]}
          explanation={
            curScores.contrast < 68
              ? 'Several 8×8 regions have compressed tonal separation and may look flat in reflected light.'
              : 'Strong local RMS contrast across midtones and highlights.'
          }
        />

        <StageScoreCard
          title="Stage 4b: Highlight Detail & Paper White"
          weight="10%"
          score={curScores.highlight}
          baseScore={baseScores.highlight}
          metrics={[
            `L*>95 Clipped: ${curMetrics.pctOver95}%`,
            `Paper White L*: ${printerProfile.paperWhiteL}`
          ]}
          explanation={
            curScores.highlight < 75
              ? 'Bright regions risk blowing out to bare paper white with loss of specular detail.'
              : 'Bright areas retain smooth gradations without clipping to bare cardstock.'
          }
        />

        <StageScoreCard
          title="Stage 5: Color Gamut & Output Simulation (ΔE_2000)"
          weight="20%"
          score={curScores.color}
          baseScore={baseScores.color}
          metrics={[
            `Mean ΔE_00: ${curMetrics.meanDeltaE}`,
            `Pixels ΔE_00>6.5: ${curMetrics.pctHighDeltaE}%`
          ]}
          explanation={
            curScores.color < 68
              ? `${curMetrics.pctHighDeltaE}% of artwork contains out-of-gamut neon greens, cyans, or deep blues that shift noticeably (ΔE_2000 > 6.5) when printed.`
              : 'Colors fall comfortably within the reproducible gamut of the selected printer and paper.'
          }
        />
      </div>
    </div>
  );
}
export default DiagnosticScorecard;
