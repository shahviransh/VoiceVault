"use client";

import type { OfflineStatus } from "@/lib/tauri/rag";
import { cn } from "@/lib/utils";

export function OfflineIndicator({ status }: { status: OfflineStatus | null }) {
  const ready = status?.offline_ready;
  return (
    <span
      className={cn("chip", ready ? "chip-good" : "chip-warn")}
      title={status ? `${status.embedding_backend} · ${status.db_path}` : "Checking…"}
    >
      <span className={cn("dot", !ready && "animate-breathe")} />
      {ready ? "Offline Ready" : "Warming up"}
    </span>
  );
}
