import React, { RefObject } from 'react';
import { Upload, Image as ImageIcon } from 'lucide-react';
import { BUILTIN_PRESETS } from '../constants';

export interface CardSourceSectionProps {
  customFileName: string | null;
  activePresetId: string | null;
  onSelectPreset: (presetId: string) => void;
  onImageUpload: (file?: File) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

export function CardSourceSection({
  customFileName,
  activePresetId,
  onSelectPreset,
  onImageUpload,
  fileInputRef
}: CardSourceSectionProps) {
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-indigo-400" />
          1. Card Artwork Source
        </h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload File
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => onImageUpload(e.target.files?.[0])}
        />
      </div>

      {/* Drag and Drop Zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onImageUpload(e.dataTransfer.files?.[0]);
        }}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-slate-700/80 hover:border-indigo-500/60 bg-slate-950/50 rounded-xl p-3 text-center cursor-pointer transition mb-3"
      >
        <p className="text-xs font-medium text-slate-300">
          {customFileName ? (
            <span className="text-indigo-400 font-semibold">
              Loaded: {customFileName}
            </span>
          ) : (
            'Drop custom MTG proxy / artwork here or click to browse'
          )}
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          PNG, JPG, WebP • 60 FPS 3D-LUT Soft-Proofing
        </p>
      </div>

      {/* 4 Built-in Calibration Presets */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-slate-400">
          Or test built-in diagnostic calibration cards:
        </div>
        {BUILTIN_PRESETS.map((preset) => {
          const isSelected = activePresetId === preset.id && !customFileName;
          return (
            <button
              key={preset.id}
              onClick={() => onSelectPreset(preset.id)}
              className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                isSelected
                  ? 'bg-indigo-500/15 border-indigo-500/60 shadow-md'
                  : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-100">
                  {preset.name}
                </span>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${preset.tagColor}`}
                >
                  {preset.tag}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                {preset.summary}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
export default CardSourceSection;
