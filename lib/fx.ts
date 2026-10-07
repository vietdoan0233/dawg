// Tiny synth chimes for feedback (no audio files to ship). Off when muted; the mute choice is a per-device
// convenience, so storage failures (private mode) just fall back to "sound on".
const KEY = "fp-muted";
let ctx: AudioContext | undefined;

export function isMuted() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();
export function subscribeMuted(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {}
  listeners.forEach((fn) => fn());
}

const NOTES = { tap: [660], send: [523, 784], lit: [523, 659, 784], level: [392, 523, 659, 784, 1047] };

export function chime(kind: keyof typeof NOTES) {
  if (isMuted() || typeof AudioContext === "undefined") return;
  ctx ??= new AudioContext(); // browsers only start it after a user gesture; until then this is silent
  void ctx.resume();
  const c = ctx;
  NOTES[kind].forEach((f, i) => {
    const t = c.currentTime + i * 0.085;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}
