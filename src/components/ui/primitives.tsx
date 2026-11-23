"use client";

import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  index,
  kicker,
  title,
  description,
  actions,
}: {
  index: string;
  kicker: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-5 animate-rise">
      <div className="min-w-0">
        <div className="kicker flex items-center gap-2">
          <span className="text-accent">{index}</span>
          <span className="h-px w-6 bg-line-strong" />
          {kicker}
        </div>
        <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-[2.75rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-ink-soft">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  className,
  children,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  className?: string;
  children: ReactNode;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      className={cn("card", className)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-accent">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div>
          <h3 className="font-display text-lg font-semibold leading-tight text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="mb-1.5 flex items-center justify-between gap-2">
      <span className="kicker">{children}</span>
      {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-left transition hover:border-line-strong",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
          checked ? "border-transparent bg-accent" : "border-line-strong bg-surface",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-[18px] w-[18px] rounded-full shadow-sm transition-all",
            checked ? "left-[22px] bg-accent-fg" : "left-0.5 bg-ink-faint",
          )}
        />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string; icon?: ComponentType<{ className?: string }> }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-xl border border-line bg-surface-2 p-1",
        className,
      )}
      role="radiogroup"
    >
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition",
            value === v
              ? "bg-surface text-ink shadow-sm ring-1 ring-line-strong"
              : "text-ink-soft hover:text-ink",
          )}
        >
          {Icon && <Icon className={cn("h-3.5 w-3.5", value === v && "text-accent")} />}
          {label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mono-num inline-grid h-5 min-w-5 place-items-center rounded-md border border-line-strong bg-surface px-1 text-[10px] text-ink-faint">
      {children}
    </kbd>
  );
}

function toneColor(value: number, max: number): string {
  const r = value / max;
  if (r >= 0.75) return "var(--good)";
  if (r >= 0.5) return "var(--accent)";
  return "var(--danger)";
}

export function SegmentMeter({
  value,
  max = 10,
  segments = 10,
}: {
  value: number;
  max?: number;
  segments?: number;
}) {
  const filled = Math.round((value / max) * segments);
  const color = toneColor(value, max);
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          className="h-2 flex-1 rounded-[3px] transition-colors duration-500"
          style={{
            background: i < filled ? color : "var(--line-strong)",
            opacity: i < filled ? 0.55 + (0.45 * (i + 1)) / segments : 0.6,
            transitionDelay: `${i * 35}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-surface-2 text-ink-faint">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-soft">{body}</p>
    </div>
  );
}
