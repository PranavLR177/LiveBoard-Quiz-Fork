/* Background sound and chimes for Focus, made on the device with Web Audio: no files to download, nothing streamed.
   Each sound is a few seconds of shaped noise that loops; volume changes fade so nothing clicks. */

export type Sound = "off" | "brown" | "rain" | "white";
export const SOUNDS: [Sound, string][] = [["off", "Off"], ["brown", "Brown noise"], ["rain", "Rain"], ["white", "White noise"]];

let ctx: AudioContext | null = null;
let src: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
let playing: Sound = "off";
let level = 0.5;
const cache = new Map<Sound, AudioBuffer>();

function ac() {
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function make(c: AudioContext, kind: Sound) {
  const hit = cache.get(kind); if (hit) return hit;
  const len = c.sampleRate * 6, buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      else if (kind === "white") d[i] = w * 0.22;
      else {
        // rain: pink noise, with a slow swell and the odd brighter drop
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.09; b6 = w * 0.115926;
        const swell = 0.8 + 0.2 * Math.sin((i / len) * Math.PI * 2 * 3 + ch);
        d[i] = pink * swell + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 0.35 : 0);
      }
    }
    // fade the ends into each other so the loop has no seam
    const x = Math.floor(c.sampleRate * 0.25);
    for (let i = 0; i < x; i++) { const t = i / x; d[i] = d[i] * t + d[len - x + i] * (1 - t); }
  }
  cache.set(kind, buf);
  return buf;
}

/** Plays (or switches to) a background sound at the current volume. "off" stops it. */
export function play(kind: Sound, vol = level) {
  level = vol;
  if (kind === playing && src) { setVolume(vol); return; }
  stop();
  if (kind === "off") return;
  const c = ac(); if (!c) return;
  gain = c.createGain(); gain.gain.value = 0;
  let node: AudioNode = gain;
  if (kind === "rain") { const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 380; hp.connect(gain); node = hp; }
  if (kind === "white") { const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7000; lp.connect(gain); node = lp; }
  gain.connect(c.destination);
  src = c.createBufferSource(); src.buffer = make(c, kind); src.loop = true; src.connect(node); src.start();
  playing = kind;
  gain.gain.linearRampToValueAtTime(curve(vol), c.currentTime + 1.2);
}
const curve = (v: number) => Math.pow(Math.max(0, Math.min(1, v)), 2) * 0.9;
export function setVolume(vol: number) {
  level = vol;
  if (ctx && gain) { gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.setTargetAtTime(curve(vol), ctx.currentTime, 0.08); }
}
export function stop() {
  if (src && gain && ctx) {
    const s = src, g = gain;
    g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    setTimeout(() => { try { s.stop(); s.disconnect(); g.disconnect(); } catch { /* already stopped */ } }, 1200);
  }
  src = null; gain = null; playing = "off";
}
export const nowPlaying = () => playing;

/** A soft bell: "break" falls, "back" rises, "done" is three notes. */
export function chime(kind: "break" | "back" | "done") {
  const c = ac(); if (!c) return;
  const notes = kind === "break" ? [988, 740] : kind === "back" ? [659, 988] : [659, 831, 988];
  notes.forEach((f, i) => {
    const t = c.currentTime + i * 0.22, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = f; o2.type = "sine"; o2.frequency.value = f * 2.01;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.6);
    const g2 = c.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(g);
    o.connect(g); g.connect(c.destination); o.start(t); o2.start(t); o.stop(t + 1.7); o2.stop(t + 1.7);
  });
}
