import type { AiProviderKind } from "./types";

export type ProviderTag = "Cloud" | "Local" | "Browser" | "Offline";

export const PROVIDERS: {
  id: AiProviderKind;
  label: string;
  tag: ProviderTag;
  blurb: string;
}[] = [
  { id: "jev", label: "Jev", tag: "Cloud", blurb: "TypeSafe System One, calibrated" },
  { id: "lmstudio", label: "LM Studio", tag: "Local", blurb: "OpenAI-compatible on :1234" },
  { id: "ollama", label: "Ollama", tag: "Local", blurb: "Local models on :11434" },
  { id: "chrome_prompt", label: "Built-in AI", tag: "Browser", blurb: "Chrome / Edge Prompt API" },
  { id: "web_llm", label: "WebLLM", tag: "Browser", blurb: "Quantized model on WebGPU" },
  { id: "heuristic", label: "Heuristic", tag: "Offline", blurb: "Zero-AI deterministic rules" },
  { id: "openai", label: "OpenAI", tag: "Cloud", blurb: "Bring your own key" },
  { id: "anthropic", label: "Anthropic", tag: "Cloud", blurb: "Bring your own key" },
  { id: "gemini", label: "Gemini", tag: "Cloud", blurb: "Bring your own key" },
];

export function providerLabel(id: AiProviderKind): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id;
}
