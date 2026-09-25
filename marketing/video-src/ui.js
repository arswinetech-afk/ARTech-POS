// ui.js — POS screen mockup, device frames, icons, logo, receipt
const fs = require('fs');
const { PNG } = require('pngjs');
const K = require('./core');
const { R, C_, P, T, TR, GRP, C, FONT_BOLD, FONT_REG, FONT_DEJA, MEASURE, n } = K;
const esc = K.esc;

// ---------- logo ----------
const LOGO_PATH = '/home/user/ARTech-POS/public/brand/logo.png';
const LOGO_B64 = fs.readFileSync(LOGO_PATH).toString('base64');
const LOGO_HREF = `data:image/png;base64,${LOGO_B64}`;
const LOGO_AR = 720 / 394;

// Keep only the AR mark + tablet + wordmark. Drop the landscape rounded-rect
// frame and the bottom tagline (redrawn as crisp SVG inside the circle).
function stripLogoFrame(pngBuf) {
  const img = PNG.sync.read(pngBuf);
  const W = img.width, H = img.height, src = img.data;
  // interior of the original lockup (outside this is the ~16px frame + tagline)
  const x0 = 42, y0 = 56, x1 = 678, y1 = 322;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < x0 || x > x1 || y < y0 || y > y1) src[(y * W + x) * 4 + 3] = 0;
    }
  }
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (src[(y * W + x) * 4 + 3] > 12) {
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
  }
  const pad = 8;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((minY + y) * W + (minX + x)) * 4, di = (y * cw + x) * 4;
      out.data[di] = src[si]; out.data[di + 1] = src[si + 1];
      out.data[di + 2] = src[si + 2]; out.data[di + 3] = src[si + 3];
    }
  }
  stripLogoFrame._ar = cw / ch;
  stripLogoFrame._size = [cw, ch];
  return PNG.sync.write(out);
}
const LOGO_ART_BUF = stripLogoFrame(fs.readFileSync(LOGO_PATH));
const LOGO_ART_HREF = `data:image/png;base64,${LOGO_ART_BUF.toString('base64')}`;
const LOGO_ART_AR = stripLogoFrame._ar;

// Circular brand lockup: spinning groove RING + circular white label the artwork lives in.
// The logo is clipped to the circle so it adapts to the round background (no rectangular card).
function circularBadge(cx, cy, r, t, o = {}) {
  const id = o.id || 'badge';
  const spin = (o.spin == null ? 1 : o.spin);
  const rot = (t * 42 * spin) % 360;
  const rot2 = (-t * 28 * spin) % 360;
  const inner = r * 0.78;                 // white circular label
  const ringW = Math.max(7, r * 0.034);
  // artwork sized to fill the circular label (width-led, corners stay inside)
  const artW = inner * 1.62;
  const artH = artW / LOGO_ART_AR;
  const grooves = [];
  const nRings = 22;
  for (let i = 0; i < nRings; i++) {
    const p = i / (nRings - 1);
    const rr = r * (0.80 + 0.20 * p);
    const op = 0.18 + 0.55 * Math.abs(Math.sin(i * 0.9 + 0.4));
    const col = i % 3 === 0 ? '#9BE86A' : (i % 2 ? '#5EE0CC' : '#2AA79B');
    grooves.push(C_(0, 0, rr, { stroke: col, sw: i % 4 === 0 ? 2.4 : 1.15, opacity: op }));
  }
  // sweeping highlight on the groove ring
  const sweep = (t * 1.4) % 1;
  const a0 = sweep * Math.PI * 2;
  const gx = Math.cos(a0) * r * 0.92, gy = Math.sin(a0) * r * 0.92;
  const parts = [
    `<defs>
      <clipPath id="clip${id}"><circle cx="0" cy="0" r="${n(inner)}"/></clipPath>
      <mask id="mask${id}">
        <rect x="${n(-r * 1.2)}" y="${n(-r * 1.2)}" width="${n(r * 2.4)}" height="${n(r * 2.4)}" fill="black"/>
        <circle cx="0" cy="0" r="${n(r)}" fill="white"/>
        <circle cx="0" cy="0" r="${n(inner + ringW * 0.15)}" fill="black"/>
      </mask>
    </defs>`,
    // outer glow
    C_(0, 0, r * 1.28, { fill: 'url(#gGlow)', opacity: 0.55 }),
    // spinning groove disc (full) then masked to an annulus so it frames the label
    GRP([
      C_(0, 0, r, { fill: 'url(#gDisc)' }),
      GRP(grooves, { transform: `rotate(${n(rot)})` }),
      C_(gx, gy, r * 0.22, { fill: '#E8FFF6', opacity: 0.18 }),
    ], { mask: `mask${id}` }),
    // circular white label — this IS the round background the logo adapts to
    GRP([
      C_(0, 0, inner, { fill: 'url(#gBadge)' }),
      // very faint concentric texture on the label so it feels of-a-piece with the disc
      ...[0.42, 0.62, 0.82].map((k, i) => C_(0, 0, inner * k, { stroke: '#3FC8B4', sw: 1, opacity: 0.07 + i * 0.02 })),
      `<image href="${LOGO_ART_HREF}" x="${n(-artW / 2)}" y="${n(-artH / 2 - inner * 0.04)}" width="${n(artW)}" height="${n(artH)}" preserveAspectRatio="xMidYMid meet"/>`,
      T(0, artH / 2 + inner * 0.02, 'Manage. Sell. Analytics.', {
        size: Math.max(13, inner * 0.092), fill: '#1B3A4C', anchor: 'middle', font: FONT_REG, weight: 600, spacing: 0.6,
      }),
    ], { clip: `clip${id}` }),
    // brand ring between label and grooves
    C_(0, 0, inner + ringW * 0.35, { stroke: 'url(#gRing)', sw: ringW, opacity: 1 }),
    C_(0, 0, inner - 1.2, { stroke: 'rgba(255,255,255,0.7)', sw: 2.2, opacity: 0.9 }),
    C_(0, 0, r, { stroke: 'rgba(232,255,246,0.35)', sw: 1.6 }),
    // orbit ticks
    GRP([
      C_(0, -r * 1.06, 3.2, { fill: C.green }),
      C_(r * 1.06, 0, 2.4, { fill: C.teal }),
      C_(0, r * 1.06, 3.2, { fill: C.teal }),
      C_(-r * 1.06, 0, 2.4, { fill: C.green }),
    ], { transform: `rotate(${n(rot2)})` }),
  ];
  return GRP(parts, { transform: `translate(${n(cx)},${n(cy)})`, opacity: o.opacity == null ? 1 : o.opacity });
}

// ---------- icons (drawn centered at cx,cy, sized to fit `s` box) ----------
function icon(name, cx, cy, s, color = C.ink, o = {}) {
  const sw = o.sw || Math.max(1.6, s * 0.11);
  const k = s / 24; // icons authored on a 24x24 grid
  const tr = `translate(${n(cx - 12 * k)},${n(cy - 12 * k)}) scale(${n(k)})`;
  const st = { stroke: color, 'stroke-width': sw / k, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const A = Object.entries(st).map(([a, b]) => `${a}="${b}"`).join(' ');
  let d = '';
  switch (name) {
    case 'search': d = 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35'; break;
    case 'wifi': d = 'M2.5 9.2a15 15 0 0 1 19 0M5.5 12.7a10.5 10.5 0 0 1 13 0M8.6 16.2a6 6 0 0 1 6.8 0'; break;
    case 'wifioff': d = 'M2.5 9.2a15 15 0 0 1 6-3.4M15.5 5.8a15 15 0 0 1 6 3.4M5.5 12.7a10.5 10.5 0 0 1 4-2.4M18.5 10.3a10.5 10.5 0 0 1 0 2.4M8.6 16.2a6 6 0 0 1 6.8 0M12 20h.01M3 3l18 18'; break;
    case 'pause': d = 'M9 5v14M15 5v14'; break;
    case 'play': d = 'M8 5.5v13l11-6.5z'; break;
    case 'check': d = 'M4.5 12.5l5 5 10-11'; break;
    case 'sync': d = 'M20.5 12a8.5 8.5 0 1 1-2.6-6.1M20.5 4v5h-5'; break;
    case 'bag': d = 'M6 8h12l1 12H5L6 8ZM9 8V6a3 3 0 0 1 6 0v2'; break;
    case 'clock': d = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2'; break;
    case 'users': d = 'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1.5a4 4 0 0 0-3-3.87M15.5 3.6a3.5 3.5 0 0 1 0 6.8'; break;
    case 'monitor': d = 'M3 5h18v11H3zM9 20h6M12 16v4'; break;
    case 'laptop': d = 'M4 6h16v10H4zM2 19h20l-1.5-2h-17L2 19Z'; break;
    case 'phone': d = 'M7 3h10v18H7zM11 18h2'; break;
    case 'printer': d = 'M7 8V4h10v4M7 17H5V9h14v8h-2M7 13h10v7H7z'; break;
    case 'sparkle': d = 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z'; break;
    case 'bolt': d = 'M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z'; break;
    case 'scan': d = 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16'; break;
    case 'card': d = 'M3 7h18v10H3zM3 10h18M7 14h4'; break;
    case 'tag': d = 'M3 11V4h7l11 11-7 7L3 11ZM7.5 7.5h.01'; break;
    case 'cart': d = 'M3 4h2.5l2.5 12h11l2-8H7'; break;
    case 'arrow': d = 'M4 12h15M13 6l6 6-6 6'; break;
    case 'lock': d = 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5z'; break;
    case 'signal': d = 'M4 21V14M9 21V11M14 21V8M19 21V5'; break;
    default: d = '';
  }
  return P(d, { stroke: color, sw: sw, opacity: o.opacity == null ? 1 : o.opacity, transform: tr });
}

// ---------- product glyphs (authored in a 46x46 box at x,y) ----------
function productGlyph(kind, x, y, s, col = C.teal) {
  const g = (d, o = {}) => P(d, { stroke: col, sw: o.sw || 2.2, opacity: o.opacity == null ? 1 : o.opacity, transform: `translate(${n(x)},${n(y)}) scale(${n(s / 46)})` });
  switch (kind) {
    case 'bottle': return g('M17 6c0-2-2-3-4-3h-4c-2 0-4 1-4 3v30c0 2 1 3 3 3h6c2 0 3-1 3-3V6ZM13 6v6') + g('M13 20h4', { sw: 2.2 });
    case 'noodle': return g('M6 20h34M8 14h30l-3 6H11l-3-6ZM14 14V9a9 9 0 0 1 18 0v5') + g('M20 9V6M26 9V6');
    case 'can': return g('M13 8h20v28a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4V8ZM13 8l3-4h14l3 4M17 18h12') ;
    case 'pack': return g('M8 10h30v26a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V10ZM8 10l4-6h22l4 6M23 17v14M17 24h12');
    case 'soap': return R(x + s * 0.12, y + s * 0.34, s * 0.76, s * 0.36, { fill: 'none', stroke: col, sw: 2.2, rx: s * 0.16 }) + R(x + s * 0.2, y + s * 0.18, s * 0.6, s * 0.2, { fill: 'none', stroke: col, sw: 2.2, rx: s * 0.09, opacity: 0.7 });
    case 'load': return g('M14 6h18v30a4 4 0 0 1-4 4h-10a4 4 0 0 1-4-4V6ZM14 6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4M19 16h8M19 22h8M23 12v20');
    default: return g('M23 8v30M8 23h30');
  }
}

// ---------- people ----------
function person(cx, cy, r, color, o = {}) {
  const head = r * 0.42;
  return GRP([
    C_(cx, cy - r * 0.28, head, { fill: color, opacity: 0.95 }),
    P(`M${n(cx - r * 0.72)} ${n(cy + r * 0.95)} a ${n(r * 0.72)} ${n(r * 0.78)} 0 0 1 ${n(r * 1.44)} 0`, { fill: color, opacity: 0.95 }),
  ], { opacity: o.opacity == null ? 1 : o.opacity });
}
const PEOPLE_COLORS = ['#3FC8B4', '#7BD65A', '#F5A623', '#8AB4F8', '#E879B9', '#9BA8FF'];

// ---------- pill / chip ----------
function pill(x, y, w, h, o = {}) {
  const { fill = 'rgba(255,255,255,0.08)', stroke = null, sw = 1, opacity = 1 } = o;
  return R(x, y, w, h, { fill, rx: h / 2, stroke, sw, opacity });
}

// ---------- POS screen (native 1000 x 624) ----------
const PRODUCTS = [
  { name: 'Coke 1.5L', sku: 'BEV-014', price: 75, stock: 24, kind: 'bottle' },
  { name: 'Pancit Canton', sku: 'NOO-002', price: 15, stock: 6, kind: 'noodle', low: true },
  { name: 'C2 Apple 500ml', sku: 'BEV-031', price: 28, stock: 40, kind: 'can' },
  { name: 'Rebisco Crackers', sku: 'SNK-007', price: 12, stock: 18, kind: 'pack' },
  { name: 'Safeguard 135g', sku:'HOM-021', price: 45, stock: 9, kind: 'soap' },
  { name: 'Load ₱50', sku: 'TEL-050', price: 50, stock: 99, kind: 'load' },
];
const peso = v => '₱' + v.toFixed(2);

function drawPOS(st = {}) {
  const {
    query = '', cart = [], subtotal = 0, discount = 0, total = 0, held = 0,
    online = true, syncing = false, checkout = 0, cash = 0, change = 0,
    hot = null, // 'search' | 'charge' | 'hold' | 'resume'
    addPop = -1, // index of cart line to pop
    typing = 0, scan = 0,
  } = st;
  const o = [];
  o.push(R(0, 0, 1000, 624, { fill: 'url(#gScreen)' }));

  // ---- header ----
  o.push(R(0, 0, 1000, 58, { fill: 'rgba(255,255,255,0.035)' }));
  o.push(R(14, 13, 32, 32, { fill: C.grad, rx: 10 }));
  o.push(T(30, 35, 'A', { size: 17, fill: '#06251F', anchor: 'middle' }));
  o.push(T(56, 26, "Aling Nena's Sari-Sari", { size: 15.5, fill: C.ink, font: FONT_REG, weight: 700 }));
  o.push(T(56, 43, 'Cashier · Joy', { size: 11, fill: C.muted, font: FONT_REG, weight: 500 }));
  // sync pill
  const syncCol = online ? C.green : C.amber;
  o.push(pill(806, 15, 96, 28, { fill: online ? 'rgba(123,214,90,0.14)' : 'rgba(245,166,35,0.16)', stroke: online ? 'rgba(123,214,90,0.35)' : 'rgba(245,166,35,0.45)' }));
  if (online) o.push(C_(826, 29, 4, { fill: syncing ? C.teal : C.green }));
  else o.push(icon('wifioff', 826, 29, 13, C.amber));
  o.push(T(838, 34, online ? (syncing ? 'Syncing' : 'Synced') : 'Offline', { size: 11.5, fill: syncCol, font: FONT_REG, weight: 700 }));
  // staff chip
  o.push(pill(912, 15, 74, 28, { fill: 'rgba(255,255,255,0.06)' }));
  o.push(person(928, 29, 9, PEOPLE_COLORS[3]));
  o.push(T(940, 33, 'Joy', { size: 11.5, fill: C.ink2, font: FONT_REG, weight: 600 }));
  o.push(R(0, 58, 1000, 1, { fill: 'rgba(255,255,255,0.08)' }));

  // ---- left: search + grid ----
  o.push(R(0, 58, 620, 566, {}));
  o.push(R(14, 72, 592, 40, { fill: 'rgba(255,255,255,0.05)', rx: 10, stroke: hot === 'search' ? C.teal : 'rgba(255,255,255,0.10)', sw: hot === 'search' ? 2 : 1 }));
  o.push(icon('search', 36, 92, 16, C.muted));
  if (query) o.push(T(54, 97, query, { size: 13.5, fill: C.ink, font: FONT_REG, weight: 600 }));
  else o.push(T(54, 97, 'Search product or barcode', { size: 13.5, fill: C.faint, font: FONT_REG, weight: 500 }));
  if (typing > 0) o.push(R(54 + MEASURE.reg(query, 13.5) + 3, 84, 2, 17, { fill: C.teal, opacity: typing }));
  if (scan > 0) {
    const sy = 72 + (1 - scan) * 40;
    o.push(R(16, sy, 588, 2, { fill: C.teal, opacity: 0.9 }));
    o.push(R(16, sy, 588, 14, { fill: 'url(#gAccentSoft)', opacity: 0.5 }));
  }
  // product grid
  const gx = 14, gy = 124, cw = 291, chh = 84, gap = 10;
  PRODUCTS.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = gx + col * (cw + gap), y = gy + row * (chh + gap);
    const match = !query || p.name.toLowerCase().includes(query.toLowerCase());
    const op = match ? 1 : 0.28;
    o.push(R(x, y, cw, chh, { fill: 'rgba(255,255,255,0.045)', rx: 12, stroke: 'rgba(255,255,255,0.07)', opacity: op }));
    o.push(R(x + 12, y + 16, 52, 52, { fill: 'rgba(63,200,180,0.12)', rx: 12, opacity: op }));
    o.push(productGlyph(p.kind, x + 17, y + 21, 42, C.teal, { opacity: op }));
    o.push(T(x + 76, y + 34, p.name, { size: 14, fill: C.ink, font: FONT_REG, weight: 700, opacity: op }));
    o.push(T(x + 76, y + 52, p.sku + ' · ' + p.stock + ' in stock', { size: 10.5, fill: C.muted, font: FONT_REG, weight: 500, opacity: op }));
    o.push(T(x + 76, y + 74, peso(p.price), { size: 15.5, fill: C.teal, opacity: op }));
    if (p.low) o.push(R(x + cw - 46, y + 10, 36, 18, { fill: 'rgba(245,166,35,0.18)', rx: 9, opacity: op })) +
      o.push(T(x + cw - 28, y + 23, 'LOW', { size: 9.5, fill: C.amber, anchor: 'middle', font: FONT_REG, weight: 700, opacity: op }));
  });
  // footer hints
  o.push(R(14, 560, 592, 40, { fill: 'rgba(255,255,255,0.03)', rx: 10 }));
  const hints = [['F2', 'search'], ['F9', 'charge'], ['F8', 'hold']];
  let hx = 40;
  hints.forEach(([k, lbl], i) => {
    o.push(R(hx, 571, 30, 19, { fill: 'rgba(255,255,255,0.10)', rx: 5, stroke: 'rgba(255,255,255,0.14)' }));
    o.push(T(hx + 15, 585, k, { size: 10.5, fill: C.ink2, anchor: 'middle', font: FONT_REG, weight: 700 }));
    o.push(T(hx + 38, 585, lbl, { size: 11, fill: C.muted, font: FONT_REG, weight: 500 }));
    hx += 38 + MEASURE.reg(lbl, 11) + 34;
  });
  o.push(icon('scan', hx + 8, 580, 14, C.muted));
  o.push(T(hx + 24, 585, 'scanner ready', { size: 11, fill: C.muted, font: FONT_REG, weight: 500 }));

  // ---- right: cart ----
  o.push(R(620, 58, 380, 566, { fill: 'rgba(255,255,255,0.025)' }));
  o.push(R(620, 58, 1, 566, { fill: 'rgba(255,255,255,0.08)' }));
  o.push(T(640, 90, 'Current sale', { size: 15, fill: C.ink, font: FONT_REG, weight: 700 }));
  o.push(pill(872, 74, 106, 26, { fill: 'rgba(63,200,180,0.14)' }));
  o.push(T(925, 92, cart.length + ' item' + (cart.length === 1 ? '' : 's'), { size: 11, fill: C.teal, anchor: 'middle', font: FONT_REG, weight: 700 }));

  if (cart.length === 0) {
    o.push(icon('cart', 810, 240, 46, C.faint, { opacity: 0.8 }));
    o.push(T(810, 296, 'Cart is empty', { size: 13.5, fill: C.muted, anchor: 'middle', font: FONT_REG, weight: 600 }));
    o.push(T(810, 318, 'Scan or tap a product', { size: 11.5, fill: C.faint, anchor: 'middle', font: FONT_REG, weight: 500 }));
  }
  let ly = 116;
  cart.forEach((it, i) => {
    const pop = i === addPop;
    const sc = pop ? 1 + 0.06 * Math.sin(performance_now_safe() * 0) : 1;
    o.push(GRP([
      R(636, ly, 348, 46, { fill: 'rgba(255,255,255,0.05)', rx: 10 }),
      R(646, ly + 9, 28, 28, { fill: 'rgba(63,200,180,0.14)', rx: 8 }),
      T(660, ly + 29, String(it.qty), { size: 13, fill: C.teal, anchor: 'middle' }),
      T(684, ly + 21, it.name, { size: 13, fill: C.ink, font: FONT_REG, weight: 600 }),
      T(684, ly + 37, it.qty + ' × ' + peso(it.price), { size: 10.5, fill: C.muted, font: FONT_REG, weight: 500 }),
      T(972, ly + 29, peso(it.qty * it.price), { size: 13.5, fill: C.ink, anchor: 'end', font: FONT_DEJA }),
    ], { opacity: pop ? 1 : 1 }));
    ly += 54;
  });

  // totals
  const ty = Math.max(ly + 8, 396);
  o.push(R(636, ty, 348, 1, { fill: 'rgba(255,255,255,0.10)' }));
  o.push(T(640, ty + 26, 'Subtotal', { size: 12, fill: C.muted, font: FONT_REG, weight: 500 }));
  o.push(T(976, ty + 26, peso(subtotal), { size: 12.5, fill: C.ink2, anchor: 'end', font: FONT_DEJA }));
  if (discount > 0) {
    o.push(T(640, ty + 48, 'Discount', { size: 12, fill: C.muted, font: FONT_REG, weight: 500 }));
    o.push(T(976, ty + 48, '-' + peso(discount), { size: 12.5, fill: C.amber, anchor: 'end', font: FONT_DEJA }));
  }
  o.push(T(640, ty + 82, 'Total', { size: 14, fill: C.ink, font: FONT_REG, weight: 700 }));
  o.push(T(976, ty + 86, peso(total), { size: 27, fill: C.grad, anchor: 'end', font: FONT_DEJA }));

  // buttons
  const by = 508;
  o.push(R(636, by, 166, 52, { fill: hot === 'hold' ? 'rgba(245,166,35,0.30)' : 'rgba(245,166,35,0.12)', rx: 14, stroke: 'rgba(245,166,35,0.55)', sw: hot === 'hold' ? 2.4 : 1.4 }));
  o.push(icon('pause', 662, by + 26, 20, C.amber));
  o.push(T(680, by + 32, 'Hold', { size: 15, fill: C.amber, font: FONT_REG, weight: 700 }));
  if (held > 0) o.push(R(790, by + 12, 26, 26, { fill: C.amber, rx: 13 })) +
    o.push(T(803, by + 30, String(held), { size: 13, fill: '#3A2400', anchor: 'middle', font: FONT_REG, weight: 700 }));
  o.push(R(818, by, 166, 52, { fill: hot === 'charge' ? C.grad : 'url(#gAccent)', rx: 14 }));
  o.push(T(901, by + 33, 'Charge', { size: 16, fill: '#06251F', anchor: 'middle', font: FONT_REG, weight: 800 }));
  o.push(icon('arrow', 962, by + 26, 17, '#06251F'));

  // checkout overlay
  if (checkout > 0) {
    o.push(R(0, 0, 1000, 624, { fill: 'rgba(4,16,26,0.72)', opacity: checkout, rx: 10 }));
    const cw2 = 460, chh2 = 300, cx2 = (1000 - cw2) / 2, cy2 = (624 - chh2) / 2 - 10;
    const pop = 0.6 + 0.4 * Math.min(1, checkout * 1.4);
    o.push(GRP([
      R(cx2, cy2, cw2, chh2, { fill: '#0E2A3C', rx: 22, stroke: 'rgba(255,255,255,0.12)' }),
      T(cx2 + cw2 / 2, cy2 + 52, 'Charge', { size: 16, fill: C.muted, anchor: 'middle', font: FONT_REG, weight: 700 }),
      T(cx2 + cw2 / 2, cy2 + 100, peso(total), { size: 52, fill: C.ink, anchor: 'middle', font: FONT_DEJA }),
      R(cx2 + 40, cy2 + 124, cw2 - 80, 1, { fill: 'rgba(255,255,255,0.10)' }),
      T(cx2 + 40, cy2 + 158, 'Cash received', { size: 13, fill: C.muted, font: FONT_REG, weight: 500 }),
      T(cx2 + cw2 - 40, cy2 + 158, peso(cash), { size: 14, fill: C.ink, anchor: 'end', font: FONT_DEJA }),
      T(cx2 + 40, cy2 + 186, 'Change', { size: 13, fill: C.muted, font: FONT_REG, weight: 500 }),
      T(cx2 + cw2 - 40, cy2 + 186, peso(change), { size: 20, fill: C.green, anchor: 'end', font: FONT_DEJA }),
      R(cx2 + 40, cy2 + 212, cw2 - 80, 56, { fill: C.grad, rx: 16 }),
      icon('check', cx2 + 74, cy2 + 240, 22, '#06251F'),
      T(cx2 + 100, cy2 + 248, 'Complete sale', { size: 17, fill: '#06251F', font: FONT_REG, weight: 800 }),
    ], { transform: `translate(${n(cx2 + cw2 / 2)},${n(cy2 + chh2 / 2)}) scale(${n(pop)}) translate(${n(-(cx2 + cw2 / 2))},${n(-(cy2 + chh2 / 2))})`, opacity: checkout }));
  }
  return o.join('');
}
function performance_now_safe() { return 0; }

// ---------- medium POS layout (laptop / small windows) — native 620 x 400 ----------
function drawPOSMedium(st = {}) {
  const { cart = [], total = 0, online = true } = st;
  const o = [];
  o.push(R(0, 0, 620, 400, { fill: 'url(#gScreen)' }));
  // header
  o.push(R(0, 0, 620, 44, { fill: 'rgba(255,255,255,0.04)' }));
  o.push(R(12, 10, 24, 24, { fill: C.grad, rx: 8 }));
  o.push(T(24, 28, 'A', { size: 13, fill: '#06251F', anchor: 'middle' }));
  o.push(T(44, 22, "Aling Nena's Sari-Sari", { size: 13, fill: C.ink, font: FONT_REG, weight: 700 }));
  o.push(T(44, 36, 'Cashier · Joy', { size: 9.5, fill: C.muted, font: FONT_REG, weight: 500 }));
  o.push(C_(594, 22, 4, { fill: online ? C.green : C.amber }));
  o.push(R(0, 44, 620, 1, { fill: 'rgba(255,255,255,0.08)' }));
  // search
  o.push(R(12, 54, 596, 30, { fill: 'rgba(255,255,255,0.05)', rx: 9 }));
  o.push(icon('search', 30, 69, 14, C.muted));
  o.push(T(44, 74, 'Search product or barcode', { size: 11.5, fill: C.faint, font: FONT_REG, weight: 500 }));
  // grid 2x2
  const cw = 293, chh = 74;
  PRODUCTS.slice(0, 4).forEach((p, i) => {
    const x = 12 + (i % 2) * (cw + 10), y = 94 + Math.floor(i / 2) * (chh + 10);
    o.push(R(x, y, cw, chh, { fill: 'rgba(255,255,255,0.045)', rx: 10 }));
    o.push(R(x + 10, y + 12, 50, 50, { fill: 'rgba(63,200,180,0.12)', rx: 10 }));
    o.push(productGlyph(p.kind, x + 15, y + 17, 40, C.teal));
    o.push(T(x + 72, y + 32, p.name, { size: 13, fill: C.ink, font: FONT_REG, weight: 700 }));
    o.push(T(x + 72, y + 50, p.sku, { size: 9.5, fill: C.muted, font: FONT_REG, weight: 500 }));
    o.push(T(x + 72, y + 68, peso(p.price), { size: 14, fill: C.teal, font: FONT_DEJA }));
  });
  // cart bar
  o.push(R(12, 336, 596, 52, { fill: 'rgba(255,255,255,0.05)', rx: 12 }));
  o.push(icon('cart', 40, 362, 22, C.teal));
  o.push(T(62, 357, (cart.length || 1) + ' item' + (cart.length === 1 ? '' : 's'), { size: 12, fill: C.muted, font: FONT_REG, weight: 600 }));
  o.push(T(62, 376, 'Total', { size: 11, fill: C.muted, font: FONT_REG, weight: 500 }));
  o.push(T(330, 372, peso(total || 75), { size: 21, fill: C.ink, font: FONT_DEJA }));
  o.push(R(400, 348, 196, 28, { fill: C.grad, rx: 9 }));
  o.push(T(498, 367, 'Charge', { size: 13, fill: '#06251F', anchor: 'middle', font: FONT_REG, weight: 800 }));
  return o.join('');
}

// ---------- devices ----------
function drawMonitor(x, y, w, st = {}) {
  // w = full monitor width; screen 16:10-ish
  const scrW = w, scrH = w * 0.60;
  const bez = w * 0.018;
  const o = [];
  o.push(R(x - bez, y - bez, scrW + bez * 2, scrH + bez * 2, { fill: '#13293A', rx: 16 }));
  o.push(R(x - bez - 6, y - bez - 6, scrW + bez * 2 + 12, scrH + bez * 2 + 12, { fill: '#0D1F2C', rx: 20 }));
  o.push(GRP([GRP([drawPOS(st)], { clip: 'clipScreen' })], { transform: `translate(${n(x)},${n(y)}) scale(${n(scrW / 1000)},${n(scrH / 624)})` }));
  // stand
  const cx = x + scrW / 2;
  o.push(P(`M${n(cx - 60)} ${n(y + scrH + bez + 2)} h120 v34 h-120 Z`, { fill: '#13293A' }));
  o.push(R(cx - 150, y + scrH + bez + 36, 300, 12, { fill: '#13293A', rx: 6 }));
  o.push(R(cx - 150, y + scrH + bez + 40, 300, 5, { fill: '#0A1B27', rx: 3 }));
  return o.join('');
}
function drawLaptop(x, y, w, st = {}) {
  const scrW = w, scrH = w * 0.62;
  const o = [];
  o.push(R(x, y, scrW, scrH, { fill: '#13293A', rx: 10 }));
  o.push(GRP([GRP([drawPOSMedium(st)], { clip: 'clipMed' })], { transform: `translate(${n(x + 6)},${n(y + 6)}) scale(${n((scrW - 12) / 620)},${n((scrH - 12) / 400)})` }));
  o.push(P(`M${n(x - 26)} ${n(y + scrH)} h${n(scrW + 52)} l10 16 h${n(-scrW - 72)} Z`, { fill: '#1B3A4F' }));
  o.push(R(x - 26, y + scrH + 14, scrW + 52, 4, { fill: '#0A1B27', rx: 2, opacity: 0.6 }));
  return o.join('');
}
function drawPhone(x, y, w, st = {}) {
  const h = w * 2.02;
  const o = [];
  o.push(R(x, y, w, h, { fill: '#13293A', rx: w * 0.14 }));
  o.push(R(x + 5, y + 5, w - 10, h - 10, { fill: '#0A1E2C', rx: w * 0.115 }));
  // notch
  o.push(R(x + w * 0.36, y + 12, w * 0.28, 8, { fill: '#13293A', rx: 4 }));
  // compact POS: header
  const px = x + 5, py = y + 30, pw = w - 10;
  o.push(R(px, py, pw, 34, { fill: 'rgba(255,255,255,0.04)' }));
  o.push(C_(px + 18, py + 17, 10, { fill: C.grad }));
  o.push(T(px + 34, py + 22, 'Aling Nena\u2019s', { size: 11, fill: C.ink, font: FONT_REG, weight: 700 }));
  o.push(C_(px + pw - 16, py + 17, 4, { fill: st.online === false ? C.amber : C.green }));
  // search
  o.push(R(px + 8, py + 42, pw - 16, 26, { fill: 'rgba(255,255,255,0.06)', rx: 8 }));
  o.push(icon('search', px + 22, py + 55, 12, C.muted));
  o.push(T(px + 34, py + 59, 'Scan or search', { size: 9.5, fill: C.faint, font: FONT_REG, weight: 500 }));
  // grid 2x2
  const cw = (pw - 24) / 2;
  PRODUCTS.slice(0, 4).forEach((p, i) => {
    const gx = px + 8 + (i % 2) * (cw + 8), gy = py + 76 + Math.floor(i / 2) * 58;
    o.push(R(gx, gy, cw, 52, { fill: 'rgba(255,255,255,0.05)', rx: 9 }));
    o.push(productGlyph(p.kind, gx + 7, gy + 9, 34, C.teal));
    o.push(T(gx + 48, gy + 24, p.name.split(' ')[0], { size: 9.5, fill: C.ink, font: FONT_REG, weight: 700 }));
    o.push(T(gx + 48, gy + 40, peso(p.price), { size: 10.5, fill: C.teal, font: FONT_DEJA }));
  });
  // cart summary + FAB
  o.push(R(px + 8, y + h - 96, pw - 16, 40, { fill: 'rgba(255,255,255,0.05)', rx: 10 }));
  o.push(T(px + 20, y + h - 78, (st.cart || []).length + ' items', { size: 10.5, fill: C.muted, font: FONT_REG, weight: 600 }));
  o.push(T(px + pw - 20, y + h - 72, peso(st.total || 0), { size: 15, fill: C.ink, anchor: 'end', font: FONT_DEJA }));
  o.push(R(px + 8, y + h - 48, pw - 16, 36, { fill: C.grad, rx: 12 }));
  o.push(T(px + pw / 2, y + h - 23, 'Charge', { size: 12.5, fill: '#06251F', anchor: 'middle', font: FONT_REG, weight: 800 }));
  // home bar
  o.push(R(x + w * 0.36, y + h - 8, w * 0.28, 3, { fill: 'rgba(255,255,255,0.25)', rx: 2 }));
  return o.join('');
}

// ---------- receipt ----------
function drawReceipt(x, y, w, st = {}) {
  const items = st.cart || [];
  const h = 150 + items.length * 22 + 90;
  const zig = (x0, y0, w0, teeth) => {
    let d = `M${x0} ${y0}`;
    for (let i = 0; i < teeth; i++) d += ` l${w0 / teeth} ${i % 2 ? 5 : -5}`;
    return d;
  };
  const o = [];
  o.push(GRP([
    R(x, y, w, h, { fill: '#F6FAFC', rx: 3 }),
    P(zig(x, y + h, w, 16), { stroke: '#F6FAFC', sw: 6, fill: 'none' }),
    T(x + w / 2, y + 34, 'ARTECH POS', { size: 15, fill: '#0B2233', anchor: 'middle', spacing: 1.5 }),
    T(x + w / 2, y + 52, "Aling Nena's Sari-Sari", { size: 10, fill: '#5A7382', anchor: 'middle', font: FONT_REG, weight: 600 }),
    R(x + 16, y + 64, w - 32, 1, { fill: '#D5E2EA' }),
    items.forEach((it, i) => {
      const yy = y + 86 + i * 22;
      T(x + 16, yy, it.name, { size: 10, fill: '#22394A', font: FONT_REG, weight: 600 });
      T(x + w - 16, yy, peso(it.qty * it.price), { size: 10, fill: '#22394A', anchor: 'end', font: FONT_DEJA });
    }),
    R(x + 16, y + 86 + items.length * 22, w - 32, 1, { fill: '#D5E2EA' }),
    T(x + 16, y + 112 + items.length * 22, 'TOTAL', { size: 11, fill: '#0B2233', font: FONT_REG, weight: 800, spacing: 1 }),
    T(x + w - 16, y + 114 + items.length * 22, peso(st.total || 0), { size: 14, fill: '#0B2233', anchor: 'end', font: FONT_DEJA, weight: 800 }),
    T(x + w / 2, y + 142 + items.length * 22, 'Thank you! Come again.', { size: 9.5, fill: '#5A7382', anchor: 'middle', font: FONT_REG, weight: 500 }),
    // barcode
    ...Array.from({ length: 26 }, (_, i) => R(x + 18 + i * (w - 36) / 26, y + h - 34, (i % 3 === 0 ? 2.4 : 1.2), 20, { fill: '#0B2233', opacity: i % 4 === 0 ? 0.35 : 1 })),
  ], { opacity: st.opacity == null ? 1 : st.opacity, transform: st.transform || null }));
  return o.join('');
}

module.exports = { icon, productGlyph, person, PEOPLE_COLORS, pill, drawPOS, drawMonitor, drawLaptop, drawPhone, drawReceipt, circularBadge, LOGO_HREF, LOGO_ART_HREF, LOGO_AR, PRODUCTS, peso };
