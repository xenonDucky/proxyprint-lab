import React, { RefObject } from 'react';
import {
  Printer,
  Sliders,
  FolderArchive,
  Sparkles,
  CheckCircle2,
  Plus,
  Download,
  Server,
  Cpu
} from 'lucide-react';
import { StudioMode, BatchCardItem } from '../types';
import { getScoreBadgeStyle } from '../constants';

export interface StudioHeaderProps {
  studioMode: StudioMode;
  setStudioMode: (mode: StudioMode) => void;
  backendStatus: 'checking' | 'connected' | 'local';
  batchItems: BatchCardItem[];
  overallScore: number;
  baseOverallScore: number;
  hasAnyAdjustment: boolean;
  onAutoOptimize: () => void;
  onSaveCurrentToBatch: () => void;
  batchSaveFlash: boolean;
  existingBatchMatch: BatchCardItem | null;
  onExportPng: () => void;
  onExportBatchZip: () => void;
  isExportingZip: boolean;
  batchFileInputRef: RefObject<HTMLInputElement | null>;
  onBatchFilesUpload: (files: FileList | null) => void;
}

export function StudioHeader({
  studioMode,
  setStudioMode,
  backendStatus,
  batchItems,
  overallScore,
  baseOverallScore,
  hasAnyAdjustment,
  onAutoOptimize,
  onSaveCurrentToBatch,
  batchSaveFlash,
  existingBatchMatch,
  onExportPng,
  onExportBatchZip,
  isExportingZip,
  batchFileInputRef,
  onBatchFilesUpload
}: StudioHeaderProps) {
  const overallStyle = getScoreBadgeStyle(overallScore);

  return (
    <header className="border-b border-slate-800/80 bg-slate-900/75 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Printer className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg font-bold tracking-tight text-white">
                ProxyPrint Lab
              </h1>
              <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                6-Stage Soft-Proofing Studio
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                  backendStatus === 'connected'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                }`}
              >
                {backendStatus === 'connected' ? (
                  <>
                    <Server className="w-3 h-3" />
                    FastAPI + 3D LUT Active
                  </>
                ) : (
                  <>
                    <Cpu className="w-3 h-3" />
                    60 FPS Client 3D LUT Engine
                  </>
                )}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              MTG &amp; TCG Custom Artwork Printability Checker • CIELAB 11×11 Shadow Crush, 2D FFT Sharpness &amp; ΔE_2000 Gamut Simulator
            </p>
          </div>
        </div>

        {/* Right Header Actions: Mode Switcher, Overall Suitability Pill & Export */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Studio Mode Switcher: Single Card vs Batch Auto-Adjust & ZIP */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setStudioMode('single')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                studioMode === 'single'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Single Card Studio
            </button>
            <button
              onClick={() => setStudioMode('batch')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                studioMode === 'batch'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderArchive className="w-3.5 h-3.5" />
              Batch Auto-Adjust &amp; ZIP
              {batchItems.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  {batchItems.length}
                </span>
              )}
            </button>
          </div>

          {studioMode === 'single' ? (
            <>
              <div
                className={`flex items-center gap-3 px-3.5 py-1.5 rounded-xl border ${overallStyle.bg} ${overallStyle.border}`}
              >
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Overall Printability
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xl font-extrabold ${overallStyle.text}`}>
                      {overallScore}/100
                    </span>
                    {hasAnyAdjustment && overallScore !== baseOverallScore && (
                      <span className="text-xs font-semibold text-emerald-400">
                        ({overallScore > baseOverallScore ? '+' : ''}
                        {overallScore - baseOverallScore} vs original)
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${overallStyle.bg} ${overallStyle.border} ${overallStyle.text}`}
                >
                  {overallStyle.label}
                </span>
              </div>

              <button
                onClick={onAutoOptimize}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                Auto-Optimize for Printer
              </button>

              <button
                onClick={onSaveCurrentToBatch}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
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
                    Saved to Batch!
                  </>
                ) : existingBatchMatch ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-amber-400" />
                    Update in Batch
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 text-indigo-400" />
                    Save to Batch
                  </>
                )}
              </button>

              <button
                onClick={onExportPng}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition cursor-pointer"
              >
                <Download className="w-4 h-4 text-indigo-400" />
                Export Print-Ready PNG
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => batchFileInputRef.current?.click()}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition cursor-pointer"
              >
                <Plus className="w-4 h-4 text-indigo-400" />
                Add Cards to Batch
              </button>
              <input
                ref={batchFileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  onBatchFilesUpload(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                onClick={onExportBatchZip}
                disabled={batchItems.length === 0 || isExportingZip}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer ${
                  batchItems.length === 0 || isExportingZip
                    ? 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
                    : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/25'
                }`}
              >
                <FolderArchive className="w-4 h-4" />
                {isExportingZip
                  ? 'Building ZIP...'
                  : `Export All as ZIP (${batchItems.length})`}
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
export default StudioHeader;
