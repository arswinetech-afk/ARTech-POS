// render a few probe frames for visual QA
const fs = require('fs'), path = require('path');
const S = require('./scenes');
const K = require('./core');

const times = process.argv.slice(2).map(Number);
const outDir = '/home/user/tools/video/probe';
fs.mkdirSync(outDir, { recursive: true });
for (const t of times) {
  const svg = S.frame(t);
  fs.writeFileSync(path.join(outDir, `probe_${t.toFixed(2)}.svg`), svg);
  const t0 = Date.now();
  const png = K.renderSVG(svg);
  const file = path.join(outDir, `probe_${t.toFixed(2)}.png`);
  fs.writeFileSync(file, png);
  console.log(`t=${t.toFixed(2)}s  ${(png.length / 1024).toFixed(0)}KB  render ${Date.now() - t0}ms  svg ${(svg.length / 1024).toFixed(0)}KB`);
}
