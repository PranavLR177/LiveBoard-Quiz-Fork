/* Voice: the browser's own speech recognition and speech, nothing to install or set up.
   Recognition is the Web Speech API (Chrome, Edge and Safari; not Firefox). Where it's missing, no mic is shown.
   Chrome sends the audio to Google's speech service to transcribe it; Safari uses Apple's. LiveBoard never records
   or keeps the audio, only the words that come back. Speaking aloud is speechSynthesis, which works almost everywhere. */

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const Ctor = (): (new () => Rec) | null => (globalThis as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  || (globalThis as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition || null;

export const canListen = () => !!Ctor();
export const canSpeak = () => typeof speechSynthesis !== "undefined";

export type Listening = { stop(): void; cancel(): void };
type Opts = {
  /** Called as words come in: everything heard so far, and whether the last bit is settled. */
  onWords?: (text: string, final: boolean) => void;
  /** Called once with everything heard, when listening ends (stopped, or a pause after speech). */
  onDone: (text: string) => void;
  onError?: (message: string) => void;
  /** Stop by itself after this long without new words, once something has been said. 0: only when told. */
  pauseMs?: number;
};

let current: Listening | null = null;

/** Starts listening. One listener at a time: starting another stops the first. */
export function listen(o: Opts): Listening | null {
  const C = Ctor();
  if (!C) { o.onError?.("Voice isn't available in this browser. Try Chrome, Edge or Safari."); return null; }
  current?.cancel();
  const r = new C();
  r.lang = navigator.language || "en-US";
  r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  let settled = "", live = "", done = false, cancelled = false, quiet: ReturnType<typeof setTimeout> | null = null;
  const text = () => (settled + " " + live).replace(/\s+/g, " ").trim();
  const finish = () => {
    if (done) return;
    done = true;
    if (quiet) clearTimeout(quiet);
    if (current === handle) current = null;
    try { r.stop(); } catch { /* already stopped */ }
    if (!cancelled) o.onDone(text());
  };
  r.onresult = e => {
    live = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], t = res[0]?.transcript || "";
      if (res.isFinal) settled += " " + t; else live += " " + t;
    }
    o.onWords?.(text(), !live.trim());
    if (o.pauseMs && text()) { if (quiet) clearTimeout(quiet); quiet = setTimeout(finish, o.pauseMs); }
  };
  r.onerror = e => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    cancelled = true;
    o.onError?.(e.error === "not-allowed" || e.error === "service-not-allowed" ? "LiveBoard can't hear you: allow the microphone for this site in your browser." : e.error === "network" ? "Voice needs a connection to transcribe." : "Couldn't hear that. Try again.");
    finish();
  };
  r.onend = finish;
  const handle: Listening = { stop: finish, cancel: () => { cancelled = true; finish(); } };
  try { r.start(); } catch { o.onError?.("Couldn't start the microphone."); return null; }
  current = handle;
  return handle;
}

/** Says `text` aloud. Resolves when it's finished (or straight away where speech isn't available). */
export function say(text: string): Promise<void> {
  if (!canSpeak() || !text.trim()) return Promise.resolve();
  speechSynthesis.cancel();
  return new Promise(res => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || "en-US"; u.rate = 1.02;
    u.onend = () => res(); u.onerror = () => res();
    speechSynthesis.speak(u);
    setTimeout(res, Math.min(20000, 1500 + text.length * 90)); // some browsers never fire onend
  });
}
export const hush = () => { if (canSpeak()) speechSynthesis.cancel(); };
export const stopListening = () => current?.cancel();

export const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11a6.500 6.500 0 0 0 13 0M12 17.500V21"/></svg>`;
