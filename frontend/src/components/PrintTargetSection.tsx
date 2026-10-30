import React, { useState } from 'react';
import { Printer } from 'lucide-react';
import { CARD_STANDARDS, PRINTER_PROFILES } from '../constants';
import { InputMode } from '../types';

export interface PrintTargetSectionProps {
  inputMode: InputMode | string;
  setInputMode: (mode: 'full_card' | 'artwork_only') => void;
  cardStandardId: string;
  setCardStandardId: (id: string) => void;
  bleedMm: number;
  setBleedMm: (val: number) => void;
  printerProfileId: string;
  setPrinterProfileId: (id: string) => void;
}

export function PrintTargetSection({
  inputMode,
  setInputMode,
  cardStandardId,
  setCardStandardId,
  bleedMm,
  setBleedMm,
  printerProfileId,
  setPrinterProfileId
}: PrintTargetSectionProps) {
  const [bleedUnit, setBleedUnit] = useState<'mm' | 'mil'>('mm');

  const currentStandard = CARD_STANDARDS[cardStandardId] || CARD_STANDARDS.tcg_trim;
  const totalW = currentStandard.widthMm + 2 * bleedMm;
  const totalH = currentStandard.heightMm + 2 * bleedMm;
  const totalWIn = totalW / 25.4;
  const totalHIn = totalH / 25.4;

  const displayBleedVal = bleedUnit === 'mil'
    ? Math.round(bleedMm / 0.0254)
    : bleedMm;

  const handleBleedChange = (valStr: string) => {
    const rawNum = parseFloat(valStr);
    if (isNaN(rawNum) || rawNum < 0) {
      setBleedMm(0);
      return;
    }
    if (bleedUnit === 'mil') {
      setBleedMm(parseFloat((rawNum * 0.0254).toFixed(3)));
    } else {
      setBleedMm(rawNum);
    }
  };

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

      {/* Card Dimensions Standard */}
      <div>
        <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
          Card Trim Size
        </label>
        <div className="space-y-1.5">
          {Object.values(CARD_STANDARDS)
            .filter((std) => std.id !== 'mpc_bleed')
            .map((std) => (
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

      {/* Bleed / Border Margin Numeric Input */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-semibold text-slate-300">
            Bleed / Border Margin
          </label>
          <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded-md border border-slate-800">
            <button
              type="button"
              onClick={() => setBleedUnit('mm')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer ${
                bleedUnit === 'mm' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              mm
            </button>
            <span className="text-slate-700 text-xs">|</span>
            <button
              type="button"
              onClick={() => setBleedUnit('mil')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer ${
                bleedUnit === 'mil' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              mil
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              min="0"
              max={bleedUnit === 'mil' ? 600 : 15}
              step={bleedUnit === 'mil' ? 10 : 0.5}
              value={displayBleedVal}
              onChange={(e) => handleBleedChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-3 pr-10 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 transition"
              placeholder="0"
            />
            <span className="absolute right-3 top-2.5 text-[11px] font-mono text-slate-500 pointer-events-none uppercase">
              {bleedUnit}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {[
              { label: '0', mm: 0, tip: 'No bleed' },
              { label: '2mm', mm: 2, tip: '2mm bleed (79 mil)' },
              { label: '3mm', mm: 3, tip: 'Standard MPC 3mm bleed (118 mil)' },
              { label: '1/8″', mm: 3.175, tip: '1/8 inch bleed (125 mil)' }
            ].map((p) => {
              const active = Math.abs(bleedMm - p.mm) < 0.05;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setBleedMm(p.mm)}
                  title={p.tip}
                  className={`px-2 py-2 rounded-xl text-[10px] font-mono font-semibold transition cursor-pointer ${
                    active
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2 text-[11px] text-slate-400 leading-snug space-y-0.5 bg-slate-950/40 p-2 rounded-xl border border-slate-800/60">
          <div className="flex justify-between">
            <span>Bleed Margin:</span>
            <span className="font-mono text-indigo-300">
              {bleedMm.toFixed(2)} mm ({(bleedMm / 0.0254).toFixed(0)} mils)
            </span>
          </div>
          <div className="flex justify-between">
            <span>Total Target Canvas:</span>
            <span className="font-mono text-slate-200 font-semibold">
              {totalW.toFixed(1)} × {totalH.toFixed(1)} mm ({totalWIn.toFixed(2)}″ × {totalHIn.toFixed(2)}″)
            </span>
          </div>
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
