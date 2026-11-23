export type SpeechHandlers = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return !!getRecognitionCtor();
}

export class LiveTranscriber {
  private recognition: SpeechRecognitionLike | null = null;
  private handlers: SpeechHandlers = {};
  private running = false;
  private finals: string[] = [];

  start(handlers: SpeechHandlers, lang = "en-US") {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      handlers.onError?.("Web Speech API not supported in this browser");
      return;
    }
    this.handlers = handlers;
    this.finals = [];
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      this.running = true;
      this.handlers.onStart?.();
    };
    recognition.onend = () => {
      this.running = false;
      this.handlers.onEnd?.();
    };
    recognition.onerror = (e) => {
      this.handlers.onError?.(e.error);
    };
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          this.finals.push(transcript.trim());
          this.handlers.onFinal?.(this.finals.join(" "));
        } else {
          interim += transcript;
        }
      }
      const full = [this.finals.join(" "), interim].filter(Boolean).join(" ").trim();
      this.handlers.onPartial?.(full);
    };

    this.recognition = recognition;
    recognition.start();
  }

  stop() {
    this.recognition?.stop();
    this.recognition = null;
    this.running = false;
  }

  abort() {
    this.recognition?.abort();
    this.recognition = null;
    this.running = false;
  }

  isRunning() {
    return this.running;
  }

  getFinalText() {
    return this.finals.join(" ").trim();
  }
}

export function speakAsInterviewer(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export class LocalAudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  async stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: "audio/webm" });
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this.mediaRecorder = null;
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }
}
