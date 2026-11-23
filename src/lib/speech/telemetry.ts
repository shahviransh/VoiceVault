export type PaceSample = { t: number; words: number };

export class PaceTracker {
  private startMs = 0;
  private samples: PaceSample[] = [];
  private lastSpeechMs = 0;
  private silenceGaps = 0;
  private lastWordCount = 0;

  start() {
    this.startMs = Date.now();
    this.samples = [{ t: 0, words: 0 }];
    this.lastSpeechMs = this.startMs;
    this.silenceGaps = 0;
    this.lastWordCount = 0;
  }

  tick(transcript: string) {
    const now = Date.now();
    const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
    const elapsed = (now - this.startMs) / 1000;
    this.samples.push({ t: elapsed, words });

    if (words > this.lastWordCount) {
      const gap = (now - this.lastSpeechMs) / 1000;
      if (this.lastWordCount > 0 && gap > 2.5) {
        this.silenceGaps += 1;
      }
      this.lastSpeechMs = now;
      this.lastWordCount = words;
    }
  }

  snapshot() {
    const elapsed = Math.max(0.1, (Date.now() - this.startMs) / 1000);
    const words = this.lastWordCount;
    const wpm = (words / elapsed) * 60;
    const mid = elapsed / 2;
    const early = this.samples.filter((s) => s.t <= mid);
    const late = this.samples.filter((s) => s.t > mid);
    const earlyWpm = wpmFromSamples(early, mid || 0.1);
    const lateWpm = wpmFromSamples(late, Math.max(0.1, elapsed - mid));
    return {
      durationSec: elapsed,
      wordCount: words,
      wpm,
      earlyWpm,
      lateWpm,
      silenceGaps: this.silenceGaps,
    };
  }
}

function wpmFromSamples(samples: PaceSample[], windowSec: number): number {
  if (!samples.length || windowSec <= 0) return 0;
  const first = samples[0]?.words ?? 0;
  const last = samples[samples.length - 1]?.words ?? 0;
  return ((last - first) / windowSec) * 60;
}

export function countFillers(text: string): number {
  const fillers = ["um", "uh", "erm", "like", "basically", "sort of", "kind of", "you know"];
  const lower = text.toLowerCase();
  return fillers.reduce((n, f) => {
    const re = new RegExp(`\\b${f.replace(" ", "\\s+")}\\b`, "gi");
    return n + (lower.match(re)?.length ?? 0);
  }, 0);
}
