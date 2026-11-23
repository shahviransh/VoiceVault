"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
  { mode: "light", icon: Sun, label: "Light" },
  { mode: "dark", icon: Moon, label: "Dark" },
  { mode: "system", icon: Monitor, label: "System" },
];

export function ThemeToggle({
  mode,
  onChange,
  className,
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  className?: string;
}) {
  const index = OPTIONS.findIndex((o) => o.mode === mode);
  return (
    <div
      className={cn(
        "relative grid grid-cols-3 rounded-xl border border-line bg-surface-2 p-1",
        className,
      )}
      role="radiogroup"
      aria-label="Theme"
    >
      <span
        className="absolute bottom-1 top-1 rounded-lg bg-surface shadow-sm ring-1 ring-line-strong transition-transform duration-300"
        style={{
          width: "calc((100% - 0.5rem) / 3)",
          left: "0.25rem",
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {OPTIONS.map(({ mode: m, icon: Icon, label }) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          title={label}
          onClick={() => onChange(m)}
          className={cn(
            "relative z-10 inline-flex h-7 items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors",
            mode === m ? "text-ink" : "text-ink-faint hover:text-ink-soft",
          )}
        >
          <Icon className={cn("h-3.5 w-3.5", mode === m && "text-accent")} />
          <span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
