// qa.js — extract frames from the encoded mp4 and save as PNGs (via raw pipe + pngjs)
const { spawn } = require('child_process');
const fs = require('fs');
const { PNG } = require('pngjs');
const FF = '/home/user/tools/ffmpeg-dist/bin/ffmpeg';
const video = process.argv[2] || '/home/user/ARTech-POS/marketing/artech-pos-promo.mp4';
const times = process.argv.slice(3).map(Number);
const outDir = '/tmp/qa';
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  for (const t of times) {
    const ff = spawn(FF, ['-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const chunks = [];
    ff.stdout.on('data', c => chunks.push(c));
    await new Promise(r => ff.on('exit', r));
    const buf = Buffer.concat(chunks);
    const png = PNG.sync.write({ width: 1920, height: 1080, data: buf });
    const file = `${outDir}/f${t}.png`;
    fs.writeFileSync(file, png);
    console.log(`t=${t}s -> ${file} (${(png.length / 1024).toFixed(0)}KB, ${buf.length} raw bytes)`);
  }
})();
