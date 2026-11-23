"use client";

import { useEffect, useId, useState } from "react";

export function ScoreRing({
  value,
  max = 10,
  size = 140,
  stroke = 10,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
}) {
  const gid = `ring${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value]);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, shown / max));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="absolute inset-3 rounded-full blur-2xl"
        style={{ background: "var(--glow)", opacity: 0.35 * pct }}
      />
      <svg width={size} height={size} className="relative -rotate-90">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--accent-2)" }} />
            <stop offset="100%" style={{ stopColor: "var(--accent)" }} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          style={{ stroke: "var(--line-strong)" }}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{
            stroke: `url(#${gid})`,
            transition: "stroke-dashoffset 1s cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[2.6rem] font-semibold leading-none tracking-tight text-ink">
          {value.toFixed(1)}
        </span>
        <span className="kicker mt-1">of {max}</span>
      </div>
    </div>
  );
}
