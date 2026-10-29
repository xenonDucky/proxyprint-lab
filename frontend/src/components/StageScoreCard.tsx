import React from 'react';

export interface StageScoreCardProps {
  title: string;
  weight: string;
  score: number;
  baseScore: number;
  metrics: string[];
  explanation: string;
}

export function StageScoreCard({
  title,
  weight,
  score,
  baseScore,
  metrics,
  explanation
}: StageScoreCardProps) {
  const diff = score - baseScore;
  const barColor =
    score >= 80 ? 'bg-emerald-500' : score >= 62 ? 'bg-amber-500' : 'bg-rose-500';
  const textColor =
    score >= 80 ? 'text-emerald-400' : score >= 62 ? 'text-amber-400' : 'text-rose-400';

  return (
    <div className="bg-slate-950/75 border border-slate-800/90 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-200">{title}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
            w={weight}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          {diff !== 0 && (
            <span
              className={`text-[11px] font-bold ${
                diff > 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {diff > 0 ? `+${diff}` : diff}
            </span>
          )}
          <span className={`text-sm font-extrabold font-mono ${textColor}`}>
            {score}/100
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${Math.max(4, score)}%` }}
        />
      </div>

      {/* Key Metric Pills */}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {metrics.map((m: string, i: number) => (
          <span
            key={i}
            className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
          >
            {m}
          </span>
        ))}
      </div>

      {/* Diagnostic Explanation */}
      <p className="text-[11px] text-slate-400 leading-snug">{explanation}</p>
    </div>
  );
}
export default StageScoreCard;
