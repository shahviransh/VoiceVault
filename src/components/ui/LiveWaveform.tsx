"use client";

import { useEffect, useRef } from "react";

function readColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    accent: s.getPropertyValue("--accent").trim() || "#ff6b2c",
    accent2: s.getPropertyValue("--accent-2").trim() || "#ffa24c",
    idle: s.getPropertyValue("--line-strong").trim() || "rgba(128,128,128,0.3)",
  };
}

/** Mic level bars driven by an AnalyserNode; idles with a gentle wave when no stream. */
export function LiveWaveform({
  stream,
  active,
  bars = 56,
  height = 84,
}: {
  stream: MediaStream | null;
  active: boolean;
  bars?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let data: Uint8Array<ArrayBuffer> | null = null;

    if (stream && active) {
      try {
        audioCtx = new AudioContext();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.78;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        data = new Uint8Array(analyser.frequencyBinCount);
      } catch {
        analyser = null;
        data = null;
      }
    }

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = Math.max(1, canvas.clientWidth * dpr);
      canvas.height = height * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let colors = readColors();
    let frame = 0;
    let raf = 0;

    const draw = () => {
      if (frame % 60 === 0) colors = readColors();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (analyser && data) analyser.getByteFrequencyData(data);

      const gap = 3 * dpr;
      const bw = Math.max(1, (w - gap * (bars - 1)) / bars);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, colors.accent2);
      grad.addColorStop(0.5, colors.accent);
      grad.addColorStop(1, colors.accent2);

      for (let i = 0; i < bars; i++) {
        let v: number;
        if (data) {
          // mirror around center so the voice band sits in the middle
          const center = Math.abs(i - (bars - 1) / 2) / (bars / 2);
          const idx = Math.floor(center * data.length * 0.6);
          v = (data[idx] ?? 0) / 255;
        } else {
          v = 0.16 + 0.1 * Math.sin(frame / 22 + i * 0.42);
        }
        const bh = Math.max(3 * dpr, v * h * 0.96);
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        ctx.fillStyle = data ? grad : colors.idle;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, Math.min(bw / 2, 3 * dpr));
        ctx.fill();
      }

      frame++;
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      void audioCtx?.close();
    };
  }, [stream, active, bars, height]);

  return <canvas ref={canvasRef} style={{ height }} className="block w-full" />;
}
