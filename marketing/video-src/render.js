// render.js — render every frame with resvg, pipe raw RGBA into ffmpeg, encode H.264 + AAC
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const S = require('./scenes');
const K = require('./core');
const { PNG } = require('pngjs');

const FPS = 30;
const DUR = S.TL.s7[1];
const TOTAL = Math.round(DUR * FPS);
const OUT = process.argv[2] || '/home/user/ARTech-POS/marketing/artech-pos-promo.mp4';
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const args = [
  '-y', '-v', 'error', '-stats',
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `1920x1080`, '-r', String(FPS), '-i', 'pipe:0',
  '-i', '/home/user/ARTech-POS/marketing/audio/final_audio.wav',
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-tune', 'animation',
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  '-movflags', '+faststart', '-shortest',
  OUT,
];
const FF = process.env.FFMPEG || '/home/user/tools/ffmpeg-dist/bin/ffmpeg';
const ff = spawn(FF, args, { stdio: ['pipe', 'inherit', 'inherit'] });
let stopped = false;
ff.on('exit', (code) => { stopped = true; console.log('ffmpeg exited with', code); });
ff.stdin.on('error', e => { if (!stopped) console.error('stdin error', e.message); });

(async () => {
  const t0 = Date.now();
  for (let i = 0; i < TOTAL; i++) {
    const t = i / FPS;
    const png = K.renderSVG(S.frame(t));
    const img = PNG.sync.read(png);
    const ok = ff.stdin.write(img.data);
    if (!ok) await new Promise(res => ff.stdin.once('drain', res));
    if (i % 30 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`frame ${i + 1}/${TOTAL}  t=${t.toFixed(2)}s  elapsed ${el.toFixed(0)}s  eta ${Math.max(0, (el / (i + 1)) * (TOTAL - i - 1)).toFixed(0)}s`);
    }
  }
  ff.stdin.end();
  await new Promise(res => ff.on('exit', res));
  const sz = fs.statSync(OUT).size / 1048576;
  console.log(`DONE: ${OUT}  ${sz.toFixed(1)} MB  ${(Date.now() - t0) / 1000 | 0}s total`);
})().catch(e => { console.error('RENDER FAILED:', e); process.exit(1); });
