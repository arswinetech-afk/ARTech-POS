// vo.js — desilence + time-compress the voiceover lines, place them on the timeline, mix with music
const fs = require('fs');
const { execFileSync } = require('child_process');
const { TL } = require('./scenes');
const A = require('./audio');

const SR = 44100;
const FF = '/home/user/tools/ffmpeg-dist/bin/ffmpeg';
const TEMPO = 1.34;          // energetic ad read
const GAP_MAX = 0.26;        // silences longer than this get squeezed
const GAP_KEEP = 0.17;

// ---------- wav helpers ----------
function readWav(path) {
  const b = fs.readFileSync(path);
  let pos = 12, rate = SR, ch = 1, bits = 16, dstart = 0, dsize = 0;
  while (pos < b.length - 8) {
    const id = b.toString('ascii', pos, pos + 4), sz = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(pos + 10); rate = b.readUInt32LE(pos + 12); bits = b.readUInt16LE(pos + 22); }
    if (id === 'data') { dstart = pos + 8; dsize = sz; break; }
    pos += 8 + sz + (sz % 2);
  }
  const n = Math.floor(dsize / (ch * (bits / 8)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(dstart + i * 2) / 32768;
  return { data: out, rate, ch };
}
function writeWavMono(path, data) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path, buf);
}

// squeeze long internal silences (TTS inserts big pauses at punctuation)
function desilence(data, rate) {
  const win = Math.floor(rate * 0.02), rms = [];
  for (let i = 0; i < data.length; i += win) {
    let s = 0; const e = Math.min(i + win, data.length);
    for (let j = i; j < e; j++) s += data[j] * data[j];
    rms.push(Math.sqrt(s / (e - i)));
  }
  const thr = 0.012;
  // speech spans
  const spans = [];
  let s = -1;
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] > thr) { if (s < 0) s = i; }
    else if (s >= 0) { spans.push([s * win, Math.min(i * win, data.length)]); s = -1; }
  }
  if (s >= 0) spans.push([s * win, data.length]);
  if (!spans.length) return new Float32Array(0);
  // rebuild: speech spans joined by short breaths of the original silence
  const out = [];
  const gapKeep = Math.floor(GAP_KEEP * rate);
  spans.forEach((sp, k) => {
    for (let j = sp[0]; j < sp[1]; j++) out.push(data[j]);
    if (k < spans.length - 1) {
      const from = sp[1];
      const take = Math.min(gapKeep, Math.max(0, spans[k + 1][0] - from));
      for (let j = 0; j < take; j++) {
        const g = Math.min(1, j / (rate * 0.02), (take - j) / (rate * 0.02));
        out.push(data[from + j] * g);
      }
    }
  });
  const trimmed = out;
  // 15ms fades
  const f = Math.floor(0.015 * rate);
  for (let k = 0; k < f && k < trimmed.length; k++) { trimmed[k] *= k / f; trimmed[trimmed.length - 1 - k] *= k / f; }
  return new Float32Array(trimmed);
}

// ---------- process each line ----------
const PLACEMENT = [ // [scene key, offset in scene, label, pre-trim seconds]
  ['s1', 0.15, 'hook', 0],
  ['s2', 0.13, 'intro', 0],
  ['s3', 0.18, 'desktop', 0],
  ['s4', 0.08, 'hold', 0],
  ['s5', 0.12, 'offline', 0],
  ['s6', -0.63, 'devices', 0],   // leads the devices scene slightly
  ['s7', 0.55, 'cta', 1.70],     // drop the spoken "ARTech POS." — the logo is on screen
];

const lines = [];
PLACEMENT.forEach(([key, off, label, pre], i) => {
  const src = `/home/user/tools/video/vo/vo${i + 1}.wav`;
  let { data, rate } = readWav(src);
  if (pre) data = data.slice(Math.floor(pre * rate));
  const squeezed = desilence(data, rate);
  const tmp = `/tmp/vo${i + 1}_ds.wav`;
  writeWavMono(tmp, squeezed);
  const out = `/tmp/vo${i + 1}_fast.wav`;
  execFileSync(FF, ['-y', '-v', 'error', '-i', tmp, '-filter:a', `atempo=${TEMPO}`, '-ar', String(SR), '-ac', '1', out]);
  const fast = readWav(out).data;
  const start = TL[key][0] + off;
  lines.push({ label, start, dur: fast.length / SR, data: fast });
  console.log(`${label.padEnd(8)} start ${start.toFixed(2)}s  dur ${(fast.length / SR).toFixed(2)}s  ends ${(start + fast.length / SR).toFixed(2)}s`);
});

// ---------- mix VO over the music bed ----------
A.arrange();
A.master();
const voL = new Float32Array(A.N), voR = new Float32Array(A.N);
lines.forEach(ln => {
  const n0 = Math.floor(ln.start * SR);
  for (let i = 0; i < ln.data.length; i++) {
    if (n0 + i >= A.N) break;
    // slight ducking under music handled by level; VO centered
    voL[n0 + i] += ln.data[i] * 0.95;
    voR[n0 + i] += ln.data[i] * 0.95;
  }
});
// music bed sits under the VO: reduce where VO is active (sidechain-ish)
const mixL = new Float32Array(A.N), mixR = new Float32Array(A.N);
for (let i = 0; i < A.N; i++) {
  const voEnv = Math.min(1, Math.abs(voL[i]) * 3.2);
  const duck = 1 - 0.45 * voEnv;
  mixL[i] = voL[i] * 0.98 + A.L[i] * 0.62 * duck;
  mixR[i] = voR[i] * 0.98 + A.R[i] * 0.62 * duck;
}
// final normalize
let peak = 0;
for (let i = 0; i < A.N; i++) peak = Math.max(peak, Math.abs(mixL[i]), Math.abs(mixR[i]));
const g = peak > 0 ? 0.92 / peak : 1;
for (let i = 0; i < A.N; i++) { mixL[i] *= g; mixR[i] *= g; }
A.writeWav('/home/user/tools/video/audio/final_audio.wav', mixL, mixR);
console.log('final audio written:', (A.N / SR).toFixed(2) + 's', (fs.statSync('/home/user/tools/video/audio/final_audio.wav').size / 1048576).toFixed(1) + 'MB');
