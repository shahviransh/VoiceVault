import { cn } from "@/lib/utils";

const BARS = [0.35, 0.7, 1, 0.55, 0.85];

export function LogoMark({ live = false, className }: { live?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-linear-to-b from-accent-2 to-accent shadow-[0_8px_20px_-8px_var(--glow)]",
        className,
      )}
    >
      <span className="flex h-5 items-center gap-[3px]">
        {BARS.map((h, i) => (
          <span
            key={i}
            className={cn("w-[3px] rounded-full bg-accent-fg", live && "animate-breathe")}
            style={{ height: `${h * 100}%`, animationDelay: `${i * 140}ms` }}
          />
        ))}
      </span>
    </span>
  );
}
