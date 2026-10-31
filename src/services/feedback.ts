// Synthesised sound effects and haptics. No audio files: everything is built
// with Web Audio so it works offline and adds nothing to the download.
export type Cue =
  | "tap"
  | "select"
  | "match"
  | "blocked"
  | "hint"
  | "shuffle"
  | "undo"
  | "win"
  | "stuck"
  | "open"
  | "close"
  | "bonus"
  | "tick"
  | "perfect";

const haptics: Record<Cue, number | number[]> = {
  tap: 6,
  select: 12,
  match: [14, 40, 24],
  blocked: [35, 30, 35],
  hint: [8, 30, 8],
  shuffle: [10, 20, 10, 20, 10],
  undo: 10,
  win: [30, 60, 30, 60, 90],
  stuck: [60, 40, 60],
  open: 8,
  close: 5,
  bonus: [20, 40, 20, 40, 60],
  tick: 4,
  perfect: [20, 40, 20, 40, 20, 40, 140],
};
/** Matches and bonuses buzz a little longer as the combo grows. */
const streakHaptic = (cue: Cue, streak: number): number | number[] => {
  const base = haptics[cue];
  if ((cue !== "match" && cue !== "bonus") || streak < 3) return base;
  const extra = Math.min(4, streak - 2);
  return [...(Array.isArray(base) ? base : [base]), ...Array(extra).fill(0).flatMap(() => [30, 18])];
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let ambient: { nodes: AudioScheduledSourceNode[]; gain: GainNode } | null =
  null;
let volume = 0.7;
let vibrate = true;

function audio() {
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from the first user gesture so iOS/Android allow audio output. */
export function unlock() {
  const c = audio();
  if (!c) return;
  const b = c.createBufferSource();
  b.buffer = c.createBuffer(1, 1, 22050);
  b.connect(c.destination);
  b.start();
}

export function configure(opts: { sound: number; haptics: boolean }) {
  volume = opts.sound;
  vibrate = opts.haptics;
}

function tone(
  freq: number,
  at: number,
  dur: number,
  peak: number,
  type: OscillatorType = "sine",
  glide?: number,
) {
  const c = ctx!,
    osc = c.createOscillator(),
    gain = c.createGain(),
    t = c.currentTime + at;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak * volume, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master!);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// A soft bell: fundamental plus two quiet inharmonic partials.
function bell(freq: number, at: number, dur = 0.9, peak = 0.16) {
  tone(freq, at, dur, peak);
  tone(freq * 2.01, at, dur * 0.6, peak * 0.35);
  tone(freq * 3.03, at, dur * 0.35, peak * 0.12);
}

function whoosh(at: number, dur: number, from: number, to: number) {
  const c = ctx!;
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource(),
    filter = c.createBiquadFilter(),
    gain = c.createGain(),
    t = c.currentTime + at;
  src.buffer = noise;
  filter.type = "bandpass";
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.22 * volume, t + dur * 0.4);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(master!);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** k = pitch factor; matches climb a semitone per combo step. */
const sounds: Record<Cue, (k: number) => void> = {
  tap: () => tone(1250, 0, 0.035, 0.05, "triangle"),
  open: () => tone(520, 0, 0.12, 0.06, "sine", 780),
  close: () => tone(700, 0, 0.1, 0.05, "sine", 460),
  // Wooden "tok" of a tile being picked up.
  select: () => {
    tone(880, 0, 0.07, 0.14, "triangle", 520);
    tone(220, 0, 0.05, 0.08, "sine", 160);
  },
  match: (k) => {
    bell(784 * k, 0, 0.7, 0.13);
    bell(1175 * k, 0.07, 0.9, 0.11);
  },
  blocked: () => {
    tone(190, 0, 0.12, 0.16, "square", 120);
    tone(150, 0.09, 0.12, 0.12, "square", 100);
  },
  hint: () =>
    [1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.06, 0.25, 0.07)),
  shuffle: () => {
    whoosh(0, 0.35, 400, 2600);
    [0.1, 0.17, 0.24, 0.31].forEach((t) =>
      tone(900 + Math.random() * 500, t, 0.04, 0.05, "triangle"),
    );
  },
  undo: () => tone(660, 0, 0.14, 0.08, "sine", 380),
  // Golden cascade for multipliers, combos and events.
  bonus: (k) => {
    [988, 1319, 1568, 1976].forEach((f, i) => bell(f * k, i * 0.05, 0.5, 0.09));
    whoosh(0.05, 0.4, 2400, 6000);
  },
  tick: () => tone(1800, 0, 0.03, 0.04, "square"),
  stuck: () => {
    tone(330, 0, 0.3, 0.1, "triangle", 300);
    tone(262, 0.18, 0.45, 0.1, "triangle", 247);
  },
  // Rising pentatonic run resolving into a held chord.
  win: () => {
    [523, 587, 659, 784, 880, 1047].forEach((f, i) =>
      bell(f, i * 0.09, 0.6, 0.1),
    );
    [523, 659, 784].forEach((f) => bell(f, 0.62, 1.8, 0.08));
  },
  // Win run, then a sparkling octave cascade and a bright held chord.
  perfect: () => {
    [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) =>
      bell(f, i * 0.07, 0.7, 0.09),
    );
    whoosh(0.4, 0.6, 3000, 8000);
    [784, 988, 1175, 1568].forEach((f) => bell(f, 0.6, 2.2, 0.07));
  },
};

/** Plays a cue; `streak` (current combo) raises match/bonus pitch and buzz. */
export function play(cue: Cue, streak = 0) {
  // Browsers only allow vibration after a real tap on the page.
  if (
    vibrate &&
    "vibrate" in navigator &&
    (navigator.userActivation?.hasBeenActive ?? true)
  ) {
    try {
      navigator.vibrate(streakHaptic(cue, streak));
    } catch {
      /* Some browsers block vibration outside a gesture. */
    }
  }
  if (volume <= 0) return;
  if (!audio()) return;
  sounds[cue](2 ** (Math.min(Math.max(streak - 1, 0), 12) / 12));
}

/** Gentle evolving pad: two detuned fifths through a breathing low-pass. */
export function setAmbient(level: number) {
  if (ambient) {
    const old = ambient,
      t = ctx!.currentTime;
    old.gain.gain.setTargetAtTime(0.0001, t, 0.4);
    setTimeout(() => old.nodes.forEach((n) => n.stop()), 1500);
    ambient = null;
  }
  if (!level) return;
  const c = audio();
  if (!c) return;
  const gain = c.createGain(),
    filter = c.createBiquadFilter(),
    lfo = c.createOscillator(),
    lfoGain = c.createGain();
  filter.type = "lowpass";
  filter.frequency.value = 700;
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 350;
  lfo.connect(lfoGain).connect(filter.frequency);
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.setTargetAtTime(level * 0.05, c.currentTime, 1.2);
  filter.connect(gain).connect(c.destination);
  const nodes: AudioScheduledSourceNode[] = [lfo];
  for (const [f, detune] of [
    [130.81, -6],
    [196, 5],
    [261.63, 3],
  ]) {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(filter);
    nodes.push(o);
  }
  nodes.forEach((n) => n.start());
  ambient = { nodes, gain };
}

// Silence everything while the app is in the background.
document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden) void ctx.suspend();
  else void ctx.resume();
});
