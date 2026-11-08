// Alle Geräusche werden live synthetisiert – keine Audiodateien nötig.

let ctx = null;
let master = null;
let noiseBuf = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = on;
}

function ac() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Muss bei der ersten Berührung aufgerufen werden (Autoplay-Regeln). */
export function unlockAudio() {
  ac();
}

function env(gain, t, attack, peak, decay) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone({ type = 'sine', from, to, dur, vol = 0.3, delay = 0 }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env(g, t, 0.005, vol, dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise({ dur, vol = 0.4, filter = 'lowpass', from = 2000, to = 100, q = 0.7, delay = 0 }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = c.createGain();
  env(g, t, 0.01, vol, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

export const sfx = {
  click() {
    tone({ type: 'sine', from: 1400, to: 900, dur: 0.05, vol: 0.12 });
  },
  select() {
    tone({ type: 'triangle', from: 600, to: 1200, dur: 0.07, vol: 0.15 });
  },
  laser(enemy = false) {
    const base = enemy ? 900 : 1500;
    tone({ type: 'sawtooth', from: base, to: base / 9, dur: 0.22, vol: 0.18 });
    tone({ type: 'square', from: base * 1.5, to: base / 6, dur: 0.16, vol: 0.08, delay: 0.02 });
  },
  miss() {
    noise({ dur: 0.45, vol: 0.18, filter: 'bandpass', from: 2500, to: 400, q: 1.2 });
  },
  hit() {
    noise({ dur: 0.7, vol: 0.55, from: 3000, to: 80 });
    tone({ type: 'sine', from: 140, to: 40, dur: 0.5, vol: 0.5 });
  },
  sunk() {
    noise({ dur: 1.6, vol: 0.7, from: 2500, to: 40 });
    tone({ type: 'sine', from: 110, to: 28, dur: 1.4, vol: 0.6 });
    noise({ dur: 0.9, vol: 0.4, from: 1800, to: 60, delay: 0.35 });
  },
  turn() {
    tone({ type: 'sine', from: 660, dur: 0.09, vol: 0.18 });
    tone({ type: 'sine', from: 990, dur: 0.12, vol: 0.18, delay: 0.1 });
  },
  error() {
    tone({ type: 'square', from: 180, to: 140, dur: 0.18, vol: 0.12 });
  },
  hyperspace() {
    noise({ dur: 1.4, vol: 0.35, filter: 'bandpass', from: 200, to: 4000, q: 0.9 });
    tone({ type: 'sawtooth', from: 60, to: 600, dur: 1.2, vol: 0.12 });
  },
  victory() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.28, vol: 0.12, delay: i * 0.16 }));
    tone({ type: 'triangle', from: 1047, dur: 0.9, vol: 0.18, delay: 0.64 });
  },
  defeat() {
    [392, 349, 311, 262].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.4, vol: 0.18, delay: i * 0.28 }));
  },
};

let vibrateEnabled = true;
export function setVibrateEnabled(on) {
  vibrateEnabled = on;
}

/** ms: Dauer oder Muster [an, aus, an, ...] */
export function vibrate(ms) {
  if (!vibrateEnabled) return;
  try {
    if (window.AndroidBridge?.vibrate) {
      const pattern = Array.isArray(ms) ? ms : [ms];
      window.AndroidBridge.vibrate(JSON.stringify(pattern));
    } else navigator.vibrate?.(ms);
  } catch {
    /* egal */
  }
}
