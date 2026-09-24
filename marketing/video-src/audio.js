// audio.js — synthesize the music bed and SFX for the ARTech POS marketing video
const fs = require('fs');
const { TL } = require('./scenes');

const SR = 44100;
const BEAT = 0.5333;              // 112.5 BPM — matches the cut grid in scenes.js
const DUR = TL.s7[1] + 0.35;      // a touch of tail
const N = Math.ceil(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);

// deterministic PRNG
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };

// ---------- primitives ----------
function write(t, l, r) {
  const i = Math.floor(t * SR);
  if (i < 0 || i >= N) return;
  L[i] += l; R[i] += r;
}
function wave(type, p) {
  switch (type) {
    case 'sine': return Math.sin(p);
    case 'saw': return 2 * (p / (2 * Math.PI) - Math.floor(0.5 + p / (2 * Math.PI)));
    case 'square': return Math.sin(p) >= 0 ? 1 : -1;
    case 'tri': return 2 * Math.abs(2 * (p / (2 * Math.PI) - Math.floor(p / (2 * Math.PI) + 0.5))) - 1;
    default: return Math.sin(p);
  }
}
// one-pole lowpass state helper
function LP(fc) { let y = 0; const a = 1 - Math.exp(-2 * Math.PI * fc / SR); return x => (y += (x - y) * a); }
function HP(fc) { const lp = LP(fc); return x => x - lp(x); }
function BP(fc, q = 1) { // simple bandpass = HP+LP
  const hp = HP(fc / q), lp = LP(fc * q); return x => lp(hp(x));
}

// generic tone
function tone(o) {
  const { t, dur, f, f2 = null, type = 'sine', gain = 0.4, atk = 0.004, dec = 0.3, pan = 0, lp = null, lp2 = null, vib = 0 } = o;
  const n0 = Math.max(0, Math.floor(t * SR)), n1 = Math.min(N, Math.floor((t + dur) * SR));
  let ph = 0; let lpState = null, hpState = null;
  const lpF = lp ? LP(lp) : null, hpF = null;
  for (let i = n0; i < n1; i++) {
    const x = (i - n0) / SR;
    const env = (x < atk ? x / atk : 1) * Math.exp(-x / dec);
    const fr = f2 != null ? f + (f2 - f) * Math.min(1, x / (dur * 0.6)) : f;
    ph += 2 * Math.PI * (fr + (vib ? Math.sin(x * 30) * vib : 0)) / SR;
    let s = wave(type, ph) * env * gain;
    if (lpF) s = lpF(s);
    const pl = Math.min(1, 0.5 + pan * 0.5), pr = Math.min(1, 0.5 - pan * 0.5);
    L[i] += s * pl; R[i] += s * pr;
  }
}
// noise burst through a filter
function noise(o) {
  const { t, dur, gain = 0.3, filt = null, atk = 0.002, dec = 0.1, pan = 0, sweep = null } = o;
  const n0 = Math.max(0, Math.floor(t * SR)), n1 = Math.min(N, Math.floor((t + dur) * SR));
  const f = filt ? BP(filt, 1.4) : null;
  const lpF = sweep ? LP(sweep[0]) : null;
  for (let i = n0; i < n1; i++) {
    const x = (i - n0) / SR;
    let s = rnd();
    if (f) s = f(s);
    if (lpF && sweep) { /* handled below */ }
    const env = (x < atk ? x / atk : 1) * Math.exp(-x / dec);
    s *= env * gain;
    const pl = Math.min(1, 0.5 + pan * 0.5), pr = Math.min(1, 0.5 - pan * 0.5);
    L[i] += s * pl; R[i] += s * pr;
  }
}
// swept noise (whoosh / riser)
function sweepNoise(o) {
  const { t, dur, gain = 0.3, f0, f1, q = 1.2, pan = 0, ampShape = 'swell' } = o;
  const n0 = Math.max(0, Math.floor(t * SR)), n1 = Math.min(N, Math.floor((t + dur) * SR));
  // two cascaded one-pole band approximation
  let lp1 = 0, lp2 = 0;
  for (let i = n0; i < n1; i++) {
    const x = (i - n0) / SR, p = x / dur;
    const fc = f0 + (f1 - f0) * p;
    const a = 1 - Math.exp(-2 * Math.PI * fc / SR);
    let s = rnd();
    lp1 += (s - lp1) * a;         // lowpass at fc
    const b = 1 - Math.exp(-2 * Math.PI * (fc / q) / SR);
    lp2 += (lp1 - lp2) * b;       // second stage -> band-ish
    s = lp1 - lp2;
    const amp = ampShape === 'swell' ? Math.sin(Math.PI * p) : (ampShape === 'rise' ? p * p : (1 - p));
    s *= amp * gain;
    const pl = Math.min(1, 0.5 + pan * 0.5), pr = Math.min(1, 0.5 - pan * 0.5);
    L[i] += s * pl; R[i] += s * pr;
  }
}

// ---------- drums ----------
function kick(t, g = 1) {
  const n0 = Math.floor(t * SR), len = Math.floor(0.26 * SR);
  let ph = 0;
  for (let i = 0; i < len && n0 + i < N; i++) {
    const x = i / SR;
    const fr = 45 + 120 * Math.exp(-x / 0.028);
    ph += 2 * Math.PI * fr / SR;
    const env = Math.exp(-x / 0.11) * (x < 0.002 ? x / 0.002 : 1);
    const s = Math.sin(ph) * env * 0.9 * g;
    L[n0 + i] += s; R[n0 + i] += s;
  }
  // click
  noise({ t, dur: 0.012, gain: 0.16 * g, filt: 3500, dec: 0.004 });
}
function clap(t, g = 1) {
  for (let k = 0; k < 3; k++) noise({ t: t + k * 0.009, dur: 0.05, gain: 0.22 * g, filt: 1700, dec: 0.014 });
  noise({ t: t + 0.026, dur: 0.16, gain: 0.16 * g, filt: 1400, dec: 0.05 });
}
function hat(t, g = 1, open = false) {
  noise({ t, dur: open ? 0.24 : 0.045, gain: 0.1 * g, filt: 8200, dec: open ? 0.09 : 0.012 });
}
function crash(t, g = 1) {
  sweepNoise({ t, dur: 1.4, gain: 0.2 * g, f0: 9000, f1: 2500, ampShape: 'swell' });
  noise({ t, dur: 0.5, gain: 0.1 * g, filt: 6000, dec: 0.2 });
}

// ---------- tonal ----------
function bass(t, f, dur = 0.45, g = 0.5) {
  tone({ t, dur, f, type: 'saw', gain: g, dec: dur * 0.9, atk: 0.006, lp: 900 });
  tone({ t, dur, f: f / 2, type: 'sine', gain: g * 0.7, dec: dur * 0.8, atk: 0.006 });
}
function pluck(t, f, dur = 0.34, g = 0.22, pan = 0) {
  tone({ t, dur, f, type: 'tri', gain: g, dec: dur * 0.8, atk: 0.003, lp: 3200, pan });
  tone({ t, dur, f: f * 2, type: 'sine', gain: g * 0.35, dec: dur * 0.5, atk: 0.003, pan });
  // echo
  tone({ t: t + 0.26, dur: dur * 0.8, f, type: 'tri', gain: g * 0.3, dec: dur * 0.6, atk: 0.003, lp: 2600, pan: -pan });
}
function pad(t, freqs, dur = 2.2, g = 0.1) {
  freqs.forEach((f, i) => {
    tone({ t, dur, f, type: 'sine', gain: g, dec: dur * 0.8, atk: 0.35, pan: (i % 2 ? 0.3 : -0.3) });
    tone({ t, dur, f: f * 1.005, type: 'sine', gain: g * 0.8, dec: dur * 0.8, atk: 0.4, pan: (i % 2 ? -0.3 : 0.3) });
  });
}

// ---------- SFX ----------
function whoosh(t, g = 1) { sweepNoise({ t, dur: 0.42, gain: 0.3 * g, f0: 3200, f1: 350, ampShape: 'swell' }); }
function riser(t, dur = 1.2, g = 1) { sweepNoise({ t, dur, gain: 0.24 * g, f0: 400, f1: 7000, ampShape: 'rise' }); }
function impact(t, g = 1) {
  tone({ t, dur: 0.7, f: 120, f2: 32, type: 'sine', gain: 0.85 * g, dec: 0.32, atk: 0.001 });
  noise({ t, dur: 0.22, gain: 0.3 * g, filt: 900, dec: 0.07 });
  sweepNoise({ t, dur: 0.8, gain: 0.14 * g, f0: 5000, f1: 400, ampShape: 'swell' });
}
function chaChing(t, g = 1) {
  // cash-register bell: two bright partials, twice
  [0, 0.085].forEach((dt, k) => {
    [1318.5, 1975.5, 2637].forEach((f, i) => {
      tone({ t: t + dt, dur: 0.85, f, type: 'sine', gain: (0.24 - i * 0.05) * g, dec: 0.34, atk: 0.001, pan: i % 2 ? 0.25 : -0.25 });
    });
  });
  noise({ t, dur: 0.03, gain: 0.2 * g, filt: 5200, dec: 0.008 });
  tone({ t, dur: 0.3, f: 660, f2: 880, type: 'tri', gain: 0.12 * g, dec: 0.1, atk: 0.002 });
}
function pop(t, g = 1) {
  tone({ t, dur: 0.09, f: 950, f2: 380, type: 'sine', gain: 0.34 * g, dec: 0.045, atk: 0.001 });
  noise({ t, dur: 0.02, gain: 0.06 * g, filt: 3000, dec: 0.006 });
}
function blip(t, dir = 1, g = 1) {
  tone({ t, dur: 0.16, f: dir > 0 ? 420 : 900, f2: dir > 0 ? 900 : 420, type: 'tri', gain: 0.26 * g, dec: 0.09, atk: 0.002 });
}
function sparkle(t, g = 1) {
  [2093, 2637, 3136, 3520].forEach((f, i) => tone({ t: t + i * 0.045, dur: 0.3, f, type: 'sine', gain: 0.12 * g, dec: 0.12, atk: 0.002, pan: (i % 2 ? 0.3 : -0.3) }));
}
function chime(t, g = 1) {
  [1046.5, 1568].forEach((f, i) => tone({ t: t + i * 0.06, dur: 0.9, f, type: 'sine', gain: 0.16 * g, dec: 0.4, atk: 0.004 }));
  tone({ t, dur: 0.5, f: 523, type: 'sine', gain: 0.1 * g, dec: 0.25, atk: 0.004 });
}
function click(t, g = 1) { noise({ t, dur: 0.014, gain: 0.18 * g, filt: 4200, dec: 0.004 }); }

// ---------- arrangement ----------
// chord loop (A minor): Am – F – C – G  (roots + triad tones)
const CHORDS = [
  { root: 110.00, tones: [220.00, 261.63, 329.63] },  // Am
  { root: 87.31, tones: [174.61, 220.00, 261.63] },   // F
  { root: 130.81, tones: [261.63, 329.63, 392.00] },  // C
  { root: 98.00, tones: [196.00, 246.94, 293.66] },   // G
];
const b = beat => beat * BEAT;

function arrange() {
  const totalBeats = Math.floor(DUR / BEAT);
  // --- intro (beats 0-5): sparse, tension
  kick(b(0), 0.8); kick(b(2), 0.8);
  for (let i = 2; i < 10; i++) hat(b(0) + i * BEAT / 2, i % 2 ? 0.5 : 0.3);
  pad(b(0), [110, 164.81, 220], 2.6, 0.09);
  riser(b(3.4), 1.25, 1);

  // --- groove from beat 5 (logo reveal)
  for (let beat = 5; beat < totalBeats; beat++) {
    const t = b(beat);
    const bar = Math.floor((beat - 5) / 4) % 4;
    const ch = CHORDS[bar];
    // kick four-on-the-floor
    kick(t, beat % 4 === 0 ? 1 : 0.85);
    // clap on 2 & 4
    if (beat % 2 === 1) clap(t, 0.85);
    // hats: closed on 8ths, open on the "and" of 4
    hat(t + BEAT / 2, 0.7, beat % 4 === 3);
    if (beat % 2 === 0) hat(t, 0.45);
    // bass on every beat
    bass(t, ch.root, 0.42, 0.5);
    // arp from beat 8 (desktop scene) — 16th plucks
    if (beat >= 8 && beat < 32) {
      const tones = [ch.tones[0] * 2, ch.tones[1] * 2, ch.tones[2] * 2, ch.tones[1] * 2];
      for (let s = 0; s < 4; s++) {
        pluck(t + s * BEAT / 4, tones[s], 0.3, 0.16 + (s === 0 ? 0.05 : 0), (s % 2 ? 0.35 : -0.35));
      }
    }
    // pad at section starts
    if (beat === 5 || beat === 13 || beat === 21 || beat === 29) pad(t, ch.tones, 2.4, 0.085);
  }

  // --- SFX events (absolute seconds, matched to scene.js beats) ---
  whoosh(TL.s1[0] + 0.85);                 // "NO INTERNET?" cut
  impact(TL.s1[0] + 1.60, 1.0);            // "NO PROBLEM."
  sparkle(TL.s1[0] + 1.62, 0.9);
  whoosh(TL.s2[0], 0.7);                   // logo reveal
  sparkle(TL.s2[0] + 0.45, 0.8);           // logo pop
  chime(TL.s2[0] + 0.5, 0.5);
  whoosh(TL.s3[0], 0.8);                   // desktop scene
  // item adds in scene 3 (relative 1.35, 1.65, 1.95)
  [1.35, 1.65, 1.95].forEach(dt => pop(TL.s3[0] + dt, 0.9));
  chaChing(TL.s3[0] + 2.60, 1.0);          // charge
  whoosh(TL.s4[0], 0.8);                   // hold scene
  click(TL.s4[0] + 1.15, 1.0);             // hold pressed
  blip(TL.s4[0] + 1.18, -1, 0.8);          // pause feel
  pop(TL.s4[0] + 2.30, 0.8);               // next customer's first item
  chaChing(TL.s4[0] + 3.05, 0.95);         // customer B charged
  blip(TL.s4[0] + 3.72, 1, 0.9);           // resume
  whoosh(TL.s5[0], 0.8);                   // offline scene
  // wifi dies
  blip(TL.s5[0] + 0.15, -1, 1.0);
  noise({ t: TL.s5[0] + 0.16, dur: 0.3, gain: 0.14, filt: 1600, dec: 0.14 });
  // offline sales pops (relative 0.7, 1.05, 1.4)
  [0.7, 1.05, 1.4].forEach(dt => pop(TL.s5[0] + dt, 0.55));
  chime(TL.s5[0] + 3.05, 0.9);             // synced
  whoosh(TL.s6[0], 0.8);                   // devices scene
  pop(TL.s6[0] + 0.45, 0.7); pop(TL.s6[0] + 0.57, 0.7); pop(TL.s6[0] + 0.69, 0.7);
  sparkle(TL.s6[0] + 1.05, 0.7);
  impact(TL.s7[0], 1.0);                   // CTA hit
  crash(TL.s7[0] + 0.02, 0.9);
  sparkle(TL.s7[0] + 0.55, 0.9);
  pad(TL.s7[0] + 0.05, [220, 261.63, 329.63, 392], 2.6, 0.1);
  // final flourish
  [0.9, 1.15, 1.4].forEach((dt, i) => pluck(TL.s7[0] + dt, [523.25, 659.25, 783.99][i], 0.5, 0.18, (i % 2 ? 0.3 : -0.3)));
}

// ---------- master ----------
function master() {
  // gentle soft clip + fade in/out
  const fadeIn = Math.floor(0.05 * SR), fadeOutStart = Math.floor((DUR - 0.55) * SR);
  for (let i = 0; i < N; i++) {
    let l = L[i], r = R[i];
    l = Math.tanh(l * 1.1) * 0.92; r = Math.tanh(r * 1.1) * 0.92;
    if (i < fadeIn) { const g = i / fadeIn; l *= g; r *= g; }
    if (i > fadeOutStart) { const g = Math.max(0, 1 - (i - fadeOutStart) / (N - fadeOutStart)); l *= g; r *= g; }
    L[i] = l; R[i] = r;
  }
  // peak normalize to -1.5 dBFS
  let peak = 0;
  for (let i = 0; i < N; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
  const g = peak > 0 ? 0.84 / peak : 1;
  for (let i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }
}

function writeWav(path, l, r, sr = SR) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(l[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(r[i] * 32767))), 44 + i * 4 + 2);
  }
  fs.writeFileSync(path, buf);
}

if (require.main === module) {
  arrange();
  master();
  writeWav('/home/user/tools/video/audio/mix.wav', L, R);
  console.log('music+sfx written:', (N / SR).toFixed(2) + 's', (fs.statSync('/home/user/tools/video/audio/mix.wav').size / 1048576).toFixed(1) + 'MB');
}

module.exports = { L, R, SR, N, DUR, writeWav, arrange, master };
