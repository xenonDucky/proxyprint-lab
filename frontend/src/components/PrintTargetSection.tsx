import React from 'react';
import { Printer } from 'lucide-react';
import { CARD_STANDARDS, PRINTER_PROFILES } from '../constants';
import { InputMode } from '../types';

export interface PrintTargetSectionProps {
  inputMode: InputMode | string;
  setInputMode: (mode: 'full_card' | 'artwork_only') => void;
  cardStandardId: string;
  setCardStandardId: (id: string) => void;
  printerProfileId: string;
  setPrinterProfileId: (id: string) => void;
}

export function PrintTargetSection({
  inputMode,
  setInputMode,
  cardStandardId,
  setCardStandardId,
  printerProfileId,
  setPrinterProfileId
}: PrintTargetSectionProps) {
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
        <Printer className="w-4 h-4 text-indigo-400" />
        2. Print Target &amp; Geometry
      </h2>

      {/* Input Mode Toggle */}
      <div>
        <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
          Analysis &amp; Adjustment Region
        </label>
        <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setInputMode('full_card')}
            className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              inputMode === 'full_card'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Art Box Only
          </button>
          <button
            onClick={() => setInputMode('artwork_only')}
            className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              inputMode === 'artwork_only'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Entire Card
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
          {inputMode === 'full_card'
            ? 'Only analyzes and adjusts the Art Analysis Region, keeping the black card border and text box untouched.'
            : 'Analyzes and adjusts 100% of pixels across the entire card (including borders and frame).'}
        </p>
      </div>

      {/* Card Dimensions & Bleed Standard */}
      <div>
        <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
          Card Size &amp; Bleed Standard
        </label>
        <div className="space-y-1.5">
          {Object.values(CARD_STANDARDS).map((std) => (
            <button
              key={std.id}
              onClick={() => setCardStandardId(std.id)}
              className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                cardStandardId === std.id
                  ? 'bg-indigo-500/15 border-indigo-500/60'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-slate-100">{std.name}</div>
              <div className="text-[11px] text-slate-400">{std.subtitle}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Printer & Cardstock Soft-Proofing Profile */}
      <div>
        <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
          Synthetic Printer &amp; Cardstock Profile
        </label>
        <div className="space-y-2">
          {Object.values(PRINTER_PROFILES).map((prof) => (
            <button
              key={prof.id}
              onClick={() => setPrinterProfileId(prof.id)}
              className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                printerProfileId === prof.id
                  ? 'bg-purple-500/15 border-purple-500/60'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold text-slate-100">
                  {prof.name}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-purple-300">
                  {prof.badge}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  L*min={prof.blackFloorL}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">
                {prof.description}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
export default PrintTargetSection;
