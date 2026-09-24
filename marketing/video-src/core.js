// core.js — SVG helpers, easing, colors, fonts, text measurement
const fs = require('fs');

// ---------- canvas ----------
const W = 1920, H = 1080, FPS = 30;

// ---------- brand palette (sampled from the ARTech POS logo) ----------
const C = {
  bg0: '#06141F', bg1: '#0A2130', bg2: '#0E2C3E',
  ink: '#F3F8FB', ink2: '#CBDDE9', muted: '#7FA3B8', faint: '#4E6E82',
  navy: '#0B2233', panel: '#102E42', panel2: '#0D2736', line: 'rgba(255,255,255,0.10)',
  teal: '#3FC8B4', teal2: '#2AA79B', green: '#7BD65A', green2: '#5CB84A',
  amber: '#F5A623', amber2: '#D98A0B', red: '#F2614C',
  grad: 'url(#gAccent)', gradSoft: 'url(#gAccentSoft)',
};

const FONT_BOLD = 'Open Sans', FONT_REG = 'Open Sans', FONT_DEJA = 'DejaVu Sans';
const FONT_FILES = [
  '/home/user/tools/chromium/fonts/fonts/Open_Sans/OpenSans-Bold.ttf',
  '/home/user/tools/chromium/fonts/fonts/Open_Sans/OpenSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];

// ---------- easing ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
// segment progress: 0 before a, 1 after b, eased
function seg(t, a, b, ease = easeOutCubic) { return ease(clamp((t - a) / (b - a))); }
function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
function easeInCubic(x) { return x * x * x; }
function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
function easeOutQuint(x) { return 1 - Math.pow(1 - x, 5); }
function easeOutBack(x) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
function easeOutElastic(x) { const c4 = (2 * Math.PI) / 3; return x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1; }
function easeInOutSine(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }
const smooth = (a, b, t) => easeInOutCubic(clamp((t - a) / (b - a)));

// ---------- svg builders ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = v => (Math.round(v * 100) / 100);

function R(x, y, w, h, o = {}) {
  const { fill = 'none', stroke = null, sw = 1, rx = 0, opacity = 1, transform = null, extra = '' } = o;
  let s = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx ? ` rx="${n(rx)}"` : ''} fill="${fill}"`;
  if (stroke) s += ` stroke="${stroke}" stroke-width="${n(sw)}"`;
  if (opacity !== 1) s += ` opacity="${n(opacity)}"`;
  if (transform) s += ` transform="${transform}"`;
  s += "/>";
  return `<g ${extra}>${s}</g>`;
}
function C_(cx, cy, r, o = {}) {
  const { fill = 'none', stroke = null, sw = 1, opacity = 1, transform = null } = o;
  let s = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"`;
  if (stroke) s += ` stroke="${stroke}" stroke-width="${n(sw)}"`;
  if (opacity !== 1) s += ` opacity="${n(opacity)}"`;
  if (transform) s += ` transform="${transform}"`;
  s += "/>";
  return `<g>${s}</g>`;
}
function P(d, o = {}) {
  const { fill = 'none', stroke = null, sw = 1, opacity = 1, cap = 'round', join = 'round', transform = null, dash = null, extra = '' } = o;
  let s = `<path d="${d}" fill="${fill}"`;
  if (stroke) s += ` stroke="${stroke}" stroke-width="${n(sw)}" stroke-linecap="${cap}" stroke-linejoin="${join}"`;
  if (dash) s += ` stroke-dasharray="${dash}"`;
  if (opacity !== 1) s += ` opacity="${n(opacity)}"`;
  if (transform) s += ` transform="${transform}"`;
  s += "/>";
  return `<g ${extra}>${s}</g>`;
}
// text: y is the BASELINE
function T(x, y, str, o = {}) {
  const { size = 32, fill = C.ink, anchor = 'start', font = FONT_BOLD, weight = 700, spacing = null, opacity = 1, transform = null, italic = false } = o;
  let s = `<text x="${n(x)}" y="${n(y)}" font-family="${font}" font-size="${n(size)}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"`;
  if (italic) s += ' font-style="italic"';
  if (spacing) s += ` letter-spacing="${n(spacing)}"`;
  if (opacity !== 1) s += ` opacity="${n(opacity)}"`;
  if (transform) s += ` transform="${transform}"`;
  s += `>${esc(str)}</text>`;
  return s;
}
// multi-run text (different fonts per run), anchored
function TR(x, y, runs, o = {}) {
  const { anchor = 'start', opacity = 1, transform = null } = o;
  let s = `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}"`;
  if (opacity !== 1) s += ` opacity="${n(opacity)}"`;
  if (transform) s += ` transform="${transform}"`;
  s += '>';
  for (const r of runs) {
    s += `<tspan font-family="${r.font || FONT_BOLD}" font-weight="${r.weight == null ? 700 : r.weight}" font-size="${n(r.size)}" fill="${r.fill || C.ink}"${r.spacing ? ` letter-spacing="${n(r.spacing)}"` : ''}>${esc(r.t)}</tspan>`;
  }
  return s + '</text>';
}
function GRP(children, o = {}) {
  const { transform = null, opacity = 1, clip = null } = o;
  let s = '<g';
  if (transform) s += ` transform="${transform}"`;
  if (opacity !== 1) s += ` opacity="${n(opacity)}"`;
  if (clip) s += ` clip-path="url(#${clip})"`;
  return s + '>' + children.join('') + '</g>';
}

// ---------- defs (gradients / filters) ----------
function defs() {
  return `<defs>
<linearGradient id="gBg" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${C.bg0}"/><stop offset="0.55" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg2}"/>
</linearGradient>
<radialGradient id="gVig" cx="0.5" cy="0.5" r="0.75">
  <stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/>
</radialGradient>
<linearGradient id="gAccent" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="${C.teal}"/><stop offset="1" stop-color="${C.green}"/>
</linearGradient>
<linearGradient id="gAccentSoft" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${C.teal}" stop-opacity="0.28"/><stop offset="1" stop-color="${C.green}" stop-opacity="0.05"/>
</linearGradient>
<linearGradient id="gScreen" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#0C2536"/><stop offset="1" stop-color="#0A1E2C"/>
</linearGradient>
<linearGradient id="gAmber" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFC15E"/><stop offset="1" stop-color="#F09A0F"/>
</linearGradient>
<radialGradient id="gGlow" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0" stop-color="${C.teal}" stop-opacity="0.55"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="gGlowG" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0" stop-color="${C.green}" stop-opacity="0.5"/><stop offset="1" stop-color="${C.green}" stop-opacity="0"/>
</radialGradient>
<linearGradient id="gFade" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/>
</linearGradient>
<filter id="fBlur6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="fBlur14" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="fBlur30" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="30"/></filter>
<filter id="fShadow" x="-50%" y="-50%" width="200%" height="200%">
  <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#000" flood-opacity="0.55"/>
</filter>
<clipPath id="clipScreen"><rect x="0" y="0" width="1000" height="624" rx="10"/></clipPath>
<clipPath id="clipMed"><rect x="0" y="0" width="620" height="400" rx="8"/></clipPath>
</defs>`;
}

// ---------- TTF text measurement (for layout decisions) ----------
const _ttfCache = {};
function loadTTF(path) {
  if (_ttfCache[path]) return _ttfCache[path];
  const b = fs.readFileSync(path);
  const numTables = b.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    tables[b.toString('ascii', p, p + 4)] = { off: b.readUInt32BE(p + 8), len: b.readUInt32BE(p + 12) };
  }
  const head = tables.head.off, upem = b.readUInt16BE(head + 18);
  const numGlyphs = b.readUInt16BE(tables.maxp.off + 4);
  const hhea = tables.hhea.off, numHMetrics = b.readUInt16BE(hhea + 34);
  const hmtx = tables.hmtx.off;
  const adv = [];
  for (let i = 0; i < numHMetrics; i++) adv.push(b.readUInt16BE(hmtx + i * 4));
  // cmap format 4
  const cmap = tables.cmap.off, sub = b.readUInt16BE(cmap + 2);
  let best = null;
  for (let i = 0; i < sub; i++) {
    const p = cmap + 4 + i * 8;
    if (b.readUInt16BE(cmap + b.readUInt32BE(p + 4)) === 4) best = cmap + b.readUInt32BE(p + 4);
  }
  const segX2 = b.readUInt16BE(best + 6), segCount = segX2 / 2;
  const endO = best + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
  const map = cp => {
    for (let s = 0; s < segCount; s++) {
      const end = b.readUInt16BE(endO + s * 2), start = b.readUInt16BE(startO + s * 2);
      if (cp >= start && cp <= end) {
        const ro = b.readUInt16BE(rangeO + s * 2);
        if (ro === 0) return (cp + b.readInt16BE(deltaO + s * 2)) & 0xFFFF;
        const gi = b.readUInt16BE(best + ro + (cp - start) * 2);
        return gi === 0 ? 0 : (gi + b.readInt16BE(deltaO + s * 2)) & 0xFFFF;
      }
    }
    return 0;
  };
  const f = { upem, adv, map, path };
  _ttfCache[path] = f;
  return f;
}
function measure(str, size, fontPath, spacing = 0) {
  const f = loadTTF(fontPath);
  let w = 0;
  for (const ch of String(str)) {
    const g = f.map(ch.codePointAt(0));
    const a = f.adv[Math.min(g, f.adv.length - 1)] || f.upem / 2;
    w += (a / f.upem) * size + spacing;
  }
  return w - (spacing || 0);
}
const MEASURE = {
  bold: (s, sz, sp) => measure(s, sz, FONT_FILES[0], sp),
  reg: (s, sz, sp) => measure(s, sz, FONT_FILES[1], sp),
  dejaBold: (s, sz, sp) => measure(s, sz, FONT_FILES[2], sp),
};

// ---------- render ----------
const { Resvg } = require('@resvg/resvg-js');
let _resvg = null;
function renderSVG(svg) {
  if (!_resvg) {
    _resvg = new Resvg(svg, {
      font: { fontFiles: FONT_FILES, loadSystemFonts: false },
      background: 'rgba(0,0,0,0)',
      fitTo: { mode: 'width', value: W },
    });
  } else {
    // resvg-js re-instantiation is safest for changing content
    _resvg = new Resvg(svg, {
      font: { fontFiles: FONT_FILES, loadSystemFonts: false },
      background: 'rgba(0,0,0,0)',
      fitTo: { mode: 'width', value: W },
    });
  }
  const r = _resvg.render();
  return r.asPng();
}

module.exports = { W, H, FPS, C, FONT_BOLD, FONT_REG, FONT_DEJA, FONT_FILES, clamp, lerp, seg, smooth, easeOutCubic, easeInCubic, easeInOutCubic, easeOutQuint, easeOutBack, easeOutElastic, easeInOutSine, R, C_, P, T, TR, GRP, defs, esc, n, MEASURE, renderSVG };
