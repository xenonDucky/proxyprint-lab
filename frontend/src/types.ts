import { AdjustmentParams } from './colorScience';

export type StudioMode = 'single' | 'batch';

export type ViewMode =
  | 'three_way'
  | 'simulated'
  | 'shadow_heatmap'
  | 'gamut_heatmap'
  | 'contrast_grid'
  | 'original_srgb';

export type InputMode = 'full_card' | 'artwork_only';

export interface CardStandard {
  id: string;
  name: string;
  subtitle: string;
  widthMm: number;
  heightMm: number;
  widthIn: number;
  heightIn: number;
  idealPxW: number;
  idealPxH: number;
  requiresBleed: boolean;
  aspectRatio: number;
}

export interface PrinterProfile {
  id: string;
  name: string;
  badge: string;
  description: string;
  blackFloorL: number;
  paperWhiteL: number;
  shadowCrushThreshold: number;
  shadowCrushStrength: number;
  saturationMultiplier: number;
  gamutClampStrength: number;
  recommendedToeLift: number;
}

export interface PresetCard {
  id: string;
  name: string;
  tag: string;
  tagColor: string;
  summary: string;
}

export interface GeometryResult {
  rawW: number;
  rawH: number;
  effectiveW: number;
  effectiveH: number;
  nominalPpi: number;
  effectiveOpticalPpi: number;
  textOpticalPpi: number;
  dpiBenchmarks: {
    min: number;
    ideal: number;
    max: number;
  };
  opticalSharpnessFactor: number;
  fftSharpnessRatio: number;
  isLikelyUpscaled: boolean;
  has3mmBleed: boolean;
  aspectDiffPct: string;
}

export interface StageScores {
  overall: number;
  weightedRaw: number;
  isBottleneckCapped: boolean;
  bottleneckMetric: string;
  resolution: number;
  shadow: number;
  highlight: number;
  contrast: number;
  color: number;
}

export interface StageMetrics {
  pctUnder5: string;
  pctUnder10: string;
  pctUnder15: string;
  pctUnder20: string;
  pctOver95: string;
  crushedShadowPct: string;
  shadowRetentionPct: number;
  meanDeltaE: string;
  pctHighDeltaE: string;
  avgPatchRms: string;
  lowContrastPatches: number;
  effectiveArtPpi: number;
  effectiveTextPpi: number;
}

export interface NormalizedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ContrastPatchCell {
  rms: number;
  mean: number;
  active: boolean;
}

export interface VisualMaps {
  anW: number;
  anH: number;
  shadowRiskMap: Uint8Array | null;
  deltaEArr: Float32Array;
  inArtMask: Uint8Array;
  patchContrastGrid: ContrastPatchCell[][];
  artBoxNorm: NormalizedRegion;
  textBoxNorm: NormalizedRegion | null;
}

export interface EvaluationResult {
  scores: StageScores;
  metrics: StageMetrics;
  histograms: {
    original: number[];
    simulated: number[];
  };
  visualMaps: VisualMaps | null;
}

export interface PipelineAnalysisResult {
  geometry: GeometryResult;
  anW: number;
  anH: number;
  rawAnalysisPixels: Uint8ClampedArray;
  resolutionScore: number;
  printer3DLut: Uint8Array;
  baseline: EvaluationResult;
  current: EvaluationResult;
}

export interface BatchCardItem {
  id: string;
  fileName: string;
  sourceCanvas: HTMLCanvasElement;
  padBleed: boolean;
  adjustments: AdjustmentParams;
  baselineScores: StageScores;
  optimizedScores: StageScores;
  geometry: GeometryResult;
  origThumbUrl: string;
  simThumbUrl: string;
}
