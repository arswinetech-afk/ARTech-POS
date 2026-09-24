// scenes.js — the 20-second marketing video, frame by frame
const K = require('./core');
const U = require('./ui');
const { W, H, C, FONT_BOLD, FONT_REG, FONT_DEJA, MEASURE } = K;
const { R, C_, P, T, TR, GRP, seg, smooth, clamp, lerp, easeOutCubic, easeOutBack, easeInCubic, easeOutQuint, easeInOutSine, esc } = K;

// ---------------- timeline (cuts land on the 112.5 BPM beat grid: beat = 0.5333s) ----------------
const TL = {
  s1: [0.000, 2.667],   // hook
  s2: [2.667, 4.267],   // logo reveal
  s3: [4.267, 7.467],   // desktop POS
  s4: [7.467, 11.733],  // HOLD
  s5: [11.733, 14.933], // offline
  s6: [14.933, 17.067], // devices
  s7: [17.067, 19.733], // CTA
};
const BPS = 112 / 60; // beat seconds (~0.535s) — used for punchy pops

// ---------------- background ----------------
function circuitPattern(t, op = 0.09) {
  const o = [];
  const drift = (t * 12) % 160;
  // horizontal traces
  for (let i = 0; i < 9; i++) {
    const y = ((i * 137 + drift) % (H + 200)) - 100;
    o.push(P(`M-40 ${n(y)} H${W * 0.42} V${n(y + 60)} H${W + 40}`, { stroke: C.teal, sw: 1.4, opacity: op * (0.5 + 0.5 * Math.sin(i * 2.1 + t * 0.6)) }));
    o.push(C_(W * 0.42, y + 60, 3.4, { fill: C.teal, opacity: op * 1.6 }));
  }
  for (let i = 0; i < 7; i++) {
    const y = H - (((i * 173 + drift * 0.7) % (H + 200)) - 100);
    o.push(P(`M-40 ${n(y)} H${W * 0.58} V${n(y - 74)} H${W + 40}`, { stroke: C.green, sw: 1.4, opacity: op * (0.5 + 0.5 * Math.cos(i * 1.7 + t * 0.5)) }));
    o.push(C_(W * 0.58, y - 74, 3.4, { fill: C.green, opacity: op * 1.6 }));
  }
  return o.join('');
}
function background(t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.4);
  return [
    R(0, 0, W, H, { fill: 'url(#gBg)' }),
    C_(W * 0.16, H * 0.12, 620, { fill: 'url(#gGlow)', opacity: 0.5 + 0.18 * pulse }),
    C_(W * 0.88, H * 0.92, 700, { fill: 'url(#gGlowG)', opacity: 0.4 + 0.16 * (1 - pulse) }),
    circuitPattern(t, 0.085),
    R(0, 0, W, H, { fill: 'url(#gVig)' }),
  ].join('');
}
const n = v => Math.round(v * 100) / 100;

// ---------------- shared bits ----------------
function flash(t, t0, dur = 0.16, col = '#FFFFFF', amp = 0.85) {
  const p = seg(t, t0, t0 + dur, K.easeOutCubic);
  if (p <= 0 || p >= 1) return '';
  return R(0, 0, W, H, { fill: col, opacity: amp * (1 - p) });
}
function wipe(t, t0, dur = 0.42, col = C.teal) {
  // diagonal wipe sweep used on scene cuts
  const p = seg(t, t0, t0 + dur, K.easeInOutCubic);
  if (p <= 0 || p >= 1) return '';
  const x = lerp(-W * 0.2, W * 1.05, p);
  return GRP([P(`M${n(x)} -60 L${n(x + 340)} -60 L${n(x + 60)} ${H + 60} L${n(x - 280)} ${H + 60} Z`, { fill: col, opacity: 0.5 * (1 - Math.abs(p - 0.5) * 2) })], { opacity: 0.9 });
}
function labelChip(x, y, icon, text, o = {}) {
  const { col = C.teal, size = 21, sub = null, opacity = 1, iconSize = 24 } = o;
  const tw = MEASURE.bold(text, size, 2.5);
  const w = 30 + iconSize + 14 + tw + 26;
  const out = [
    R(x, y, w, 52, { fill: 'rgba(255,255,255,0.06)', rx: 26, stroke: 'rgba(255,255,255,0.14)', opacity }),
    U.icon(icon, x + 30, y + 26, iconSize, col, { opacity }),
    T(x + 30 + iconSize / 2 + 14, y + 33, text, { size, fill: C.ink, spacing: 2.5, opacity }),
  ];
  if (sub) out.push(T(x + 6, y + 78, sub, { size: 16.5, fill: C.muted, font: FONT_REG, weight: 500, spacing: 0.6, opacity }));
  return out.join('');
}
function bigWords(x, y, lines, o = {}) {
  // lines: [{t, size, fill, dy}] stacked, slam-in
  const { start = 0, gap = 0.42, opacity = 1 } = o;
  let out = '', yy = y;
  lines.forEach((ln, i) => {
    const t0 = start + i * gap;
    const p = seg(t, t0, t0 + 0.34, K.easeOutBack);
    const sc = 0.7 + 0.3 * clamp(p);
    out += GRP([T(0, 0, ln.t, { size: ln.size || 96, fill: ln.fill || C.ink, anchor: 'middle', spacing: ln.spacing == null ? 4 : ln.spacing })],
      { transform: `translate(${n(x)},${n(yy + (ln.dy || 0))}) scale(${n(sc)})`, opacity: opacity * clamp(p * 1.4) });
    yy += (ln.dy || 0) || (ln.size || 96) * 1.12;
  });
  return out;
}

// ============================================================
// SCENE 1 — HOOK
// ============================================================
function scene1(t) {
  const [a, b] = TL.s1, d = t - a;
  const o = [];
  // queue of customers
  const nPeople = 6;
  for (let i = 0; i < nPeople; i++) {
    const pop = seg(d, 0.05 + i * 0.07, 0.05 + i * 0.07 + 0.3, K.easeOutBack);
    const bob = Math.sin(d * 3 + i) * 3;
    const px = 190 + i * 132, py = 800 + bob;
    o.push(GRP([U.person(0, 0, 40, U.PEOPLE_COLORS[i % U.PEOPLE_COLORS.length])], {
      transform: `translate(${n(px)},${n(py)}) scale(${n(0.6 + 0.4 * pop)})`, opacity: clamp(pop * 1.5),
    }));
  }
  // cashier counter
  const cPop = seg(d, 0.45, 0.85, K.easeOutBack);
  o.push(GRP([
    R(0, 60, 320, 26, { fill: '#16394E', rx: 8 }),
    R(-10, 86, 340, 130, { fill: '#102E42', rx: 10 }),
    R(24, 104, 90, 60, { fill: 'rgba(63,200,180,0.18)', rx: 8 }),
    U.icon('card', 69, 134, 30, C.teal),
    R(150, 104, 150, 14, { fill: 'rgba(255,255,255,0.10)', rx: 7 }),
    R(150, 128, 110, 14, { fill: 'rgba(255,255,255,0.07)', rx: 7 }),
    U.person(262, 40, 34, U.PEOPLE_COLORS[2]),
  ], { transform: `translate(${n(1050)},${n(700)}) scale(${n(0.7 + 0.3 * cPop)})`, opacity: clamp(cPop * 1.5) }));

  // wifi icon stuttering
  const wf = Math.sin(d * 22) > -0.2 ? 1 : 0.15;
  o.push(GRP([U.icon(d > 0.85 ? 'wifioff' : 'wifi', 0, 0, 74, d > 0.85 ? C.red : C.teal, { opacity: wf })],
    { transform: `translate(${n(1600)},${n(300)})` }));

  // words
  const show = d < 0.85 ? 0 : d < 1.6 ? 1 : 2;
  if (show === 0) {
    const p = seg(d, 0.02, 0.36, K.easeOutBack);
    o.push(GRP([T(0, 0, 'LONG LINES?', { size: 104, fill: C.ink, anchor: 'middle', spacing: 6 })],
      { transform: `translate(${n(W / 2)},${n(360)}) scale(${n(0.72 + 0.28 * p)})`, opacity: clamp(p * 1.4) }));
  } else if (show === 1) {
    const p = seg(d, 0.85, 1.2, K.easeOutBack);
    o.push(GRP([T(0, 0, 'NO INTERNET?', { size: 104, fill: C.ink, anchor: 'middle', spacing: 6 })],
      { transform: `translate(${n(W / 2)},${n(360)}) scale(${n(0.72 + 0.28 * p)})`, opacity: clamp(p * 1.4) }));
  } else {
    const p = seg(d, 1.6, 1.95, K.easeOutBack);
    // green pulse ring
    const ring = seg(d, 1.6, 2.3, K.easeOutCubic);
    o.push(C_(W / 2, 360, 120 + ring * 460, { stroke: C.green, sw: 5, opacity: 0.55 * (1 - ring) }));
    o.push(GRP([
      T(0, 0, 'NO PROBLEM.', { size: 118, fill: 'url(#gAccent)', anchor: 'middle', spacing: 6 }),
    ], { transform: `translate(${n(W / 2)},${n(360)}) scale(${n(0.7 + 0.3 * p)})`, opacity: clamp(p * 1.4) }));
    // smile dots on the queue
    for (let i = 0; i < nPeople; i++) o.push(C_(190 + i * 132, 800 - 6, 3.2, { fill: '#06251F', opacity: clamp((d - 1.9) * 2) }));
  }
  // exit
  const ex = seg(d, b - a - 0.18, b - a, K.easeInCubic);
  return GRP(o, { transform: ex > 0 ? `translate(${n(-ex * 90)},0)` : null, opacity: 1 - ex * 0.4 }) + flash(t, a + 2.42, 0.16, '#FFFFFF', 0.8);
}

// ============================================================
// SCENE 2 — LOGO REVEAL
// ============================================================
function scene2(t) {
  const [a, b] = TL.s2, d = t - a;
  const o = [];
  // circuit traces converging
  const traces = [
    `M0 0 C 300 0 420 240 700 300`, `M1920 0 C 1620 0 1500 240 1220 300`,
    `M0 1080 C 300 1080 420 840 700 740`, `M1920 1080 C 1620 1080 1500 840 1220 740`,
  ];
  traces.forEach((dpath, i) => {
    const p = seg(d, 0.02 + i * 0.05, 0.5 + i * 0.05, K.easeOutCubic);
    const len = 1500;
    o.push(P(dpath, { stroke: i % 2 ? C.green : C.teal, sw: 3, dash: `${n(len * p)} ${n(len)}`, opacity: 0.8 }));
    const end = pathPoint(dpath, p);
    if (end) o.push(C_(end[0], end[1], 6, { fill: i % 2 ? C.green : C.teal, opacity: 0.9 * p }));
  });
  // glow
  o.push(C_(W / 2, 470, 380, { fill: 'url(#gGlow)', opacity: 0.55 * seg(d, 0.1, 0.7, K.easeOutCubic) }));
  // logo card
  const lp = seg(d, 0.18, 0.72, K.easeOutBack);
  const lw = 620, lh = lw / U.LOGO_AR;
  o.push(GRP([
    R(0, 0, lw + 56, lh + 56, { fill: '#F7FBFC', rx: 34 }),
    R(28, 28, lw, lh, { fill: 'none', rx: 20, stroke: 'rgba(11,34,51,0.08)' }),
    `<image href="${U.LOGO_HREF}" x="28" y="28" width="${n(lw)}" height="${n(lh)}" preserveAspectRatio="xMidYMid meet"/>`,
  ], {
    transform: `translate(${n(W / 2 - (lw + 56) / 2)},${n(452 - (lh + 56) / 2)}) scale(${n(0.55 + 0.45 * lp)})`,
    opacity: clamp(lp * 1.6),
  }));
  // kicker + tagline
  const kp = seg(d, 0.75, 1.1, K.easeOutCubic);
  o.push(T(W / 2, 700, 'OFFLINE-FIRST POINT OF SALE', { size: 25, fill: C.teal, anchor: 'middle', spacing: 7, opacity: kp }));
  const words = ['Manage.', 'Sell.', 'Analytics.'];
  const cols = [C.teal, C.green, C.ink];
  let wx = W / 2 - (MEASURE.bold('Manage. Sell. Analytics.', 40, 5) + 2 * 26) / 2;
  words.forEach((wd, i) => {
    const wp = seg(d, 0.9 + i * 0.12, 1.3 + i * 0.12, K.easeOutBack);
    o.push(GRP([T(0, 0, wd, { size: 40, fill: cols[i], spacing: 5 })],
      { transform: `translate(${n(wx)},${n(756)}) scale(${n(0.6 + 0.4 * wp)})`, opacity: clamp(wp * 1.5) }));
    wx += MEASURE.bold(wd, 40, 5) + 26;
  });
  // sparkles
  for (let i = 0; i < 7; i++) {
    const sp = ((d * 1.4 + i * 0.19) % 1);
    const ang = i * 2.399 + d * 0.4;
    const rad = 200 + sp * 260;
    o.push(GRP([U.icon('sparkle', 0, 0, 20 + 16 * (1 - sp), i % 2 ? C.green : C.teal, { opacity: (1 - sp) * 0.9 })],
      { transform: `translate(${n(W / 2 + Math.cos(ang) * rad * 1.5)},${n(452 + Math.sin(ang) * rad * 0.7)})` }));
  }
  const ex = seg(d, b - a - 0.15, b - a, K.easeInCubic);
  return GRP(o, { opacity: 1 - ex * 0.5 }) + flash(t, a + 1.62, 0.15, '#FFFFFF', 0.7);
}

// ============================================================
// SCENE 3 — DESKTOP POS (hero)
// ============================================================
function scene3(t) {
  const [a, b] = TL.s3, d = t - a;
  const o = [];
  // monitor entrance
  const en = seg(d, 0, 0.5, K.easeOutCubic);
  const monW = 1180, monX = (W - monW) / 2 + 40, monY = 250 + (1 - en) * 160;
  // ---- animated POS state ----
  const typeStart = 0.55, typeEnd = 1.25;
  const query = d < typeStart ? '' : d > typeEnd ? 'Coke' : 'Coke'.slice(0, Math.max(1, Math.ceil((d - typeStart) / (typeEnd - typeStart) * 4)));
  // items pop into cart
  const cartItems = [];
  const popTimes = [1.35, 1.65, 1.95];
  const ITEMS = [
    { name: 'Coke 1.5L', qty: 2, price: 75 },
    { name: 'Pancit Canton', qty: 3, price: 15 },
    { name: 'C2 Apple 500ml', qty: 2, price: 28 },
  ];
  ITEMS.forEach((it, i) => { if (d > popTimes[i]) cartItems.push(it); });
  const shownTotal = cartItems.reduce((s, it) => s + it.qty * it.price, 0);
  const totalRoll = d > popTimes[2] ? lerp(ITEMS[0].qty * ITEMS[0].price + ITEMS[1].qty * ITEMS[1].price, shownTotal, seg(d, popTimes[2], popTimes[2] + 0.4, K.easeOutCubic)) : shownTotal;
  const chargeAt = 2.55;
  const checkout = d > chargeAt ? seg(d, chargeAt, chargeAt + 0.3, K.easeOutBack) : 0;
  const hot = d > 2.2 && d < chargeAt ? 'charge' : (d > typeStart - 0.25 && d < typeEnd ? 'search' : null);
  const cash = 500, change = cash - (cartItems.length ? shownTotal : 0);

  o.push(GRP([U.drawMonitor(monX, monY, monW, {
    query, cart: cartItems, subtotal: totalRoll, total: totalRoll, online: true,
    checkout, cash, change, hot, addPop: -1,
    typing: d > typeStart && d < typeEnd + 0.4 ? (Math.sin(d * 14) > 0 ? 1 : 0.15) : 0,
    scan: d > typeStart && d < typeEnd ? ((d - typeStart) / (typeEnd - typeStart)) : 0,
  })], { opacity: clamp(en * 1.6) }));

  // label
  const lp = seg(d, 0.25, 0.7, K.easeOutBack);
  o.push(GRP([labelChip(0, 0, 'monitor', 'THE DESKTOP POS', { sub: 'Every feature. Full speed. Keyboard-ready.' })], {
    transform: `translate(${n(96)},${n(96)}) scale(${n(0.8 + 0.2 * lp)})`, opacity: clamp(lp * 1.5),
  }));

  // +price chips floating up as items are added
  ITEMS.forEach((it, i) => {
    const pt = d - popTimes[i];
    if (pt <= 0 || pt > 0.55) return;
    const p = seg(pt, 0, 0.55, K.easeOutCubic);
    o.push(GRP([T(0, 0, '+' + U.peso(it.qty * it.price), { size: 34, fill: C.green })],
      { transform: `translate(${n(monX + 420 + p * 60)},${n(monY + 300 - p * 130)})`, opacity: 1 - p }));
  });

  // cursor
  const cur = cursorPath(d, [
    [0.45, monX + 250, monY + 92], [1.0, monX + 300, monY + 92], [1.3, monX + 300, monY + 96],
    [2.2, monX + 800, monY + 560], [chargeAt + 0.1, monX + 800, monY + 560],
    [chargeAt + 0.5, monX + 900, monY + 300],
  ]);
  o.push(cursor(cur.x, cur.y, cur.click));

  // receipt slides out after charge
  if (d > chargeAt + 0.35) {
    const rp = seg(d, chargeAt + 0.35, chargeAt + 1.1, K.easeOutCubic);
    o.push(U.drawReceipt(monX + monW - 260, monY + monW * 0.624 + 60 - rp * 40, 220, { cart: ITEMS, total: shownTotal, opacity: clamp(rp * 1.5) }));
  }
  // keyboard hint chips
  if (d > 2.9) {
    const kp = seg(d, 2.9, 3.3, K.easeOutBack);
    const keys = [['F2', 'search'], ['F9', 'charge'], ['F8', 'hold']];
    keys.forEach(([k, lbl], i) => {
      const kpp = seg(d, 2.9 + i * 0.1, 3.25 + i * 0.1, K.easeOutBack);
      o.push(GRP([
        R(0, 0, 44, 34, { fill: 'rgba(255,255,255,0.10)', rx: 8, stroke: 'rgba(255,255,255,0.18)' }),
        T(22, 23, k, { size: 15, fill: C.ink, anchor: 'middle' }),
        T(56, 23, lbl, { size: 19, fill: C.ink2, font: FONT_REG, weight: 600 }),
      ], { transform: `translate(${n(960 + i * 200)},${n(940)}) scale(${n(0.7 + 0.3 * kpp)})`, opacity: clamp(kpp * 1.5) }));
    });
  }
  // cha-ching burst
  if (d > chargeAt + 0.15 && d < chargeAt + 0.9) {
    const bp = seg(d, chargeAt + 0.15, chargeAt + 0.9, K.easeOutCubic);
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + d * 2;
      const dist = bp * 320;
      o.push(C_(monX + 900 + Math.cos(ang) * dist, monY + 380 + Math.sin(ang) * dist, 7 * (1 - bp) + 2, { fill: i % 2 ? C.green : C.teal, opacity: (1 - bp) * 0.9 }));
    }
    o.push(GRP([T(0, 0, 'CHA-CHING!', { size: 54, fill: C.grad, spacing: 3 })],
      { transform: `translate(${n(monX + 900)},${n(monY + 200 - bp * 90)}) scale(${n(1 + 0.25 * (1 - bp))})`, opacity: (1 - bp * 0.6) }));
  }
  const ex = seg(d, b - a - 0.16, b - a, K.easeInCubic);
  return GRP(o, { transform: ex > 0 ? `translate(${n(ex * 110)},0)` : null }) + flash(t, a + 3.52, 0.15, '#FFFFFF', 0.75);
}

// ============================================================
// SCENE 4 — HOLD (queue management)
// ============================================================
function scene4(t) {
  const [a, b] = TL.s4, d = t - a;
  const o = [];
  const monW = 1080, monX = (W - monW) / 2 - 130, monY = 250;
  const HELD = { name: 'Coke 1.5L', qty: 2, price: 75 }, HELD2 = { name: 'Pancit Canton', qty: 3, price: 15 }, HELD3 = { name: 'C2 Apple 500ml', qty: 2, price: 28 };
  const heldTotal = 195;

  // phase timings
  const tHold = 1.15;        // hold pressed
  const tToast = 1.3;
  const tNext = 2.1;         // next customer served
  const tChargeB = 3.0;      // customer B charged
  const tResume = 3.7;       // resume held sale
  const held = d > tHold && d < tResume + 0.5;
  const resumed = d > tResume + 0.5;

  const cartB = [];
  if (d > tNext + 0.2) cartB.push({ name: 'Rebisco Crackers', qty: 2, price: 12 });
  if (d > tNext + 0.5) cartB.push({ name: 'Safeguard 135g', qty: 1, price: 45 });
  const totalB = cartB.reduce((s, it) => s + it.qty * it.price, 0);
  const checkoutB = d > tChargeB ? seg(d, tChargeB, tChargeB + 0.28, K.easeOutBack) : 0;
  const hot = (d > tHold - 0.35 && d < tHold + 0.2) ? 'hold' : (d > tChargeB - 0.4 && d < tChargeB + 0.15 ? 'charge' : null);

  // current cart = held sale (A) before hold, empty between, customer B, then resumed held sale
  let cart, total, heldN = 0, hot2 = hot;
  if (d < tHold) { cart = [HELD, HELD2, HELD3]; total = heldTotal; }
  else if (d < tResume + 0.5) { cart = cartB; total = totalB; heldN = 1; }
  else { cart = [HELD, HELD2, HELD3]; total = heldTotal; heldN = 0; }

  o.push(U.drawMonitor(monX, monY, monW, {
    cart, total, subtotal: total, held: heldN, online: true,
    checkout: d > tChargeB && d < tChargeB + 0.9 ? checkoutB : 0, cash: 200, change: 200 - totalB,
    hot: hot2, addPop: -1,
  }));

  // toasts
  if (d > tToast && d < tToast + 1.0) {
    const p = seg(d, tToast, tToast + 0.25, K.easeOutBack);
    o.push(toast(monX + 120, monY - 70, 'pause', 'Sale on hold', 'Ate Marie · ' + U.peso(heldTotal), C.amber, p));
  }
  if (d > tResume + 0.5 && d < tResume + 1.5) {
    const p = seg(d, tResume + 0.5, tResume + 0.75, K.easeOutBack);
    o.push(toast(monX + 120, monY - 70, 'play', 'Sale resumed', 'Ate Marie · ' + U.peso(heldTotal), C.teal, p));
  }
  if (d > tChargeB + 0.1 && d < tChargeB + 0.9) {
    const p = seg(d, tChargeB + 0.1, tChargeB + 0.35, K.easeOutBack);
    o.push(toast(monX + 120, monY - 70, 'check', 'Sale complete', U.peso(totalB) + ' · change ' + U.peso(200 - totalB), C.green, p));
  }

  // held tray (right of monitor)
  if (held) {
    const p = seg(d, tHold + 0.05, tHold + 0.5, K.easeOutBack);
    o.push(GRP([
      R(0, 0, 330, 128, { fill: 'rgba(245,166,35,0.12)', rx: 18, stroke: 'rgba(245,166,35,0.5)', sw: 1.6 }),
      U.icon('pause', 34, 34, 24, C.amber),
      T(52, 40, 'ON HOLD', { size: 15, fill: C.amber, spacing: 2.5 }),
      R(20, 58, 290, 1, { fill: 'rgba(245,166,35,0.25)' }),
      T(20, 86, 'Ate Marie', { size: 17, fill: C.ink, font: FONT_REG, weight: 700 }),
      T(20, 108, '3 items · ' + U.peso(heldTotal), { size: 13, fill: C.muted, font: FONT_REG, weight: 500 }),
      R(238, 74, 72, 34, { fill: 'rgba(245,166,35,0.22)', rx: 10 }),
      U.icon('play', 274, 91, 18, C.amber),
    ], { transform: `translate(${n(monX + monW + 60)},${n(monY + 40)}) scale(${n(0.7 + 0.3 * p)})`, opacity: clamp(p * 1.5) }));
  }

  // queue row of customers at the bottom + arriving customer B
  const qx = 200, qy = 900;
  for (let i = 0; i < 3; i++) {
    const shift = d > tNext ? -70 : 0;
    o.push(U.person(qx + i * 96 + shift, qy, 34, U.PEOPLE_COLORS[(i + 1) % U.PEOPLE_COLORS.length], { opacity: 0.9 }));
  }
  // customer B walks in from the right
  if (d > 0.55 && d < tNext + 0.6) {
    const bp = seg(d, 0.55, 1.1, K.easeOutCubic);
    const bx = lerp(1780, 1330, bp);
    o.push(U.person(bx, 830, 40, U.PEOPLE_COLORS[1]));
    if (d < tNext) o.push(GRP([R(0, 0, 46, 30, { fill: C.green, rx: 15 }), T(23, 21, '+1', { size: 16, fill: '#06251F', anchor: 'middle' })],
      { transform: `translate(${n(bx + 20)},${n(770)})` }));
  }
  // big label
  const lp = seg(d, 0.75, 1.15, K.easeOutBack);
  o.push(GRP([
    R(0, 0, 900, 76, { fill: 'rgba(255,255,255,0.06)', rx: 38, stroke: 'rgba(245,166,35,0.45)', sw: 1.6 }),
    U.icon('pause', 48, 38, 26, C.amber),
    T(84, 48, 'HOLD', { size: 30, fill: C.amber, spacing: 3 }),
    T(84 + MEASURE.bold('HOLD', 30, 3) + 26, 48, '· SERVE THE NEXT ·', { size: 30, fill: C.ink, spacing: 3 }),
    U.icon('play', 84 + MEASURE.bold('HOLD', 30, 3) + 26 + MEASURE.bold('· SERVE THE NEXT ·', 30, 3) + 30, 38, 24, C.green),
    T(84 + MEASURE.bold('HOLD', 30, 3) + 26 + MEASURE.bold('· SERVE THE NEXT ·', 30, 3) + 60, 48, 'RESUME', { size: 30, fill: C.green, spacing: 3 }),
  ], { transform: `translate(${n((W - 900) / 2)},${n(70)}) scale(${n(0.8 + 0.2 * lp)})`, opacity: clamp(lp * 1.5) }));

  // receipt for customer B
  if (d > tChargeB + 0.25) {
    const rp = seg(d, tChargeB + 0.25, tChargeB + 0.9, K.easeOutCubic);
    o.push(U.drawReceipt(monX + monW - 250, monY + monW * 0.624 + 40 - rp * 30, 200, { cart: cartB, total: totalB, opacity: clamp(rp * 1.4) }));
  }
  const ex = seg(d, b - a - 0.16, b - a, K.easeInCubic);
  return GRP(o, { transform: ex > 0 ? `translate(${n(-ex * 100)},0)` : null }) + flash(t, a + 4.28, 0.15, '#FFFFFF', 0.7);
}

// ============================================================
// SCENE 5 — OFFLINE
// ============================================================
function scene5(t) {
  const [a, b] = TL.s5, d = t - a;
  const o = [];
  const monW = 1120, monX = (W - monW) / 2 + 30, monY = 250;
  const tOff = 0.15, tSales = [0.7, 1.05, 1.4], tBack = 2.15, tSync = 2.5, tDone = 3.05;
  const offline = d > tOff && d < tBack + 0.35;
  const syncing = d > tSync && d < tDone;
  const ITEMS = [
    { name: 'Coke 1.5L', qty: 1, price: 75 },
    { name: 'Lucky Me', qty: 4, price: 15 },
    { name: 'Load ₱50', qty: 1, price: 50 },
  ];
  const cart = [];
  ITEMS.forEach((it, i) => { if (d > tSales[i]) cart.push(it); });
  const total = cart.reduce((s, it) => s + it.qty * it.price, 0);
  const queued = d > tSales[0] && d < tDone ? 3 - Math.min(3, Math.floor(seg(d, tSync, tDone, K.easeInOutCubic) * 3.4)) : 0;

  o.push(U.drawMonitor(monX, monY, monW, {
    cart, total, subtotal: total, online: !offline, syncing, held: 0,
    checkout: 0, addPop: -1, hot: null,
  }));

  // wifi status overlay near header
  if (offline) {
    o.push(GRP([
      R(0, 0, 210, 46, { fill: 'rgba(245,166,35,0.16)', rx: 23, stroke: 'rgba(245,166,35,0.55)', sw: 1.6 }),
      U.icon('wifioff', 32, 23, 22, C.amber),
      T(56, 30, 'NO INTERNET', { size: 17, fill: C.amber, spacing: 1.5 }),
    ], { transform: `translate(${n(monX + monW - 240)},${n(monY + 12)})`, opacity: seg(d, tOff, tOff + 0.2, K.easeOutCubic) }));
  }
  // sales keep ringing
  ITEMS.forEach((it, i) => {
    const pt = d - tSales[i];
    if (pt <= 0 || pt > 0.7) return;
    const p = seg(pt, 0, 0.7, K.easeOutCubic);
    o.push(GRP([T(0, 0, '+' + U.peso(it.qty * it.price), { size: 32, fill: C.green })],
      { transform: `translate(${n(monX + 380 + p * 70)},${n(monY + 330 - p * 140)})`, opacity: 1 - p }));
  });
  // queued chip
  if (queued > 0) {
    o.push(GRP([
      R(0, 0, 300, 52, { fill: 'rgba(245,166,35,0.14)', rx: 26, stroke: 'rgba(245,166,35,0.4)' }),
      U.icon('sync', 36, 26, 22, C.amber),
      T(60, 33, queued + ' sale' + (queued > 1 ? 's' : '') + ' queued locally', { size: 16.5, fill: C.amber, font: FONT_REG, weight: 700 }),
    ], { transform: `translate(${n(monX + monW - 320)},${n(monY + monW * 0.624 - 40)})`, opacity: 0.95 }));
  }
  // synced confirmation
  if (d > tDone) {
    const p = seg(d, tDone, tDone + 0.3, K.easeOutBack);
    o.push(GRP([
      R(0, 0, 320, 52, { fill: 'rgba(123,214,90,0.14)', rx: 26, stroke: 'rgba(123,214,90,0.45)' }),
      U.icon('check', 36, 26, 22, C.green),
      T(60, 33, 'All synced to the cloud', { size: 16.5, fill: C.green, font: FONT_REG, weight: 700 }),
    ], { transform: `translate(${n(monX + monW - 340)},${n(monY + monW * 0.624 - 40)}) scale(${n(0.8 + 0.2 * p)})`, opacity: clamp(p * 1.5) }));
  }
  // label
  const lp = seg(d, 0.2, 0.6, K.easeOutBack);
  o.push(GRP([labelChip(0, 0, 'bolt', 'WORKS OFFLINE', { sub: 'Keep selling — syncs when you\u2019re back online' })], {
    transform: `translate(${n(96)},${n(96)}) scale(${n(0.8 + 0.2 * lp)})`, opacity: clamp(lp * 1.5),
  }));
  // sync pulse ring when back online
  if (d > tBack && d < tBack + 1.6) {
    const rp = seg(d, tBack, tBack + 1.6, K.easeOutCubic);
    o.push(C_(monX + monW / 2, monY + 200, 60 + rp * 700, { stroke: C.teal, sw: 4, opacity: 0.5 * (1 - rp) }));
  }
  const ex = seg(d, b - a - 0.16, b - a, K.easeInCubic);
  return GRP(o, { transform: ex > 0 ? `translate(${n(ex * 100)},0)` : null }) + flash(t, a + 3.1, 0.15, '#FFFFFF', 0.7);
}

// ============================================================
// SCENE 6 — DEVICES
// ============================================================
function scene6(t) {
  const [a, b] = TL.s6, d = t - a;
  const o = [];
  const st = { cart: [{ name: 'Coke 1.5L', qty: 1, price: 75 }], total: 75, subtotal: 75, online: true };
  // entrances
  const eM = seg(d, 0.02, 0.45, K.easeOutCubic), eL = seg(d, 0.14, 0.55, K.easeOutCubic), eP = seg(d, 0.26, 0.65, K.easeOutCubic);
  const monW = 760, monX = 150, monY = 330 + (1 - eM) * 130;
  const lapW = 480, lapX = 990, lapY = 430 + (1 - eL) * 130;
  const phW = 210, phX = 1520, phY = 330 + (1 - eP) * 130;

  // sync pulse travelling across
  const pulse = seg(d, 0.75, 1.5, K.easeInOutCubic);
  const px = lerp(monX, phX + phW, pulse);

  o.push(GRP([U.drawMonitor(monX, monY, monW, st)], { opacity: clamp(eM * 1.6) }));
  o.push(GRP([U.drawLaptop(lapX, lapY, lapW, st)], { opacity: clamp(eL * 1.6) }));
  o.push(GRP([U.drawPhone(phX, phY, phW, st)], { opacity: clamp(eP * 1.6) }));

  // pulse beam
  if (d > 0.7 && d < 1.6) {
    o.push(R(px - 3, 300, 6, 420, { fill: 'url(#gAccent)', opacity: 0.85 }));
    o.push(R(px - 26, 300, 52, 420, { fill: 'url(#gAccentSoft)', opacity: 0.5 }));
  }
  // device labels
  const labs = [['DESKTOP', 'monitor', monX + monW / 2, monY + monW * 0.624 + 70], ['PC', 'laptop', lapX + lapW / 2, lapY + lapW * 0.62 + 60], ['MOBILE', 'phone', phX + phW / 2, phY + phW * 2.02 + 40]];
  labs.forEach(([txt, ic, cx, cy], i) => {
    const p = seg(d, 1.0 + i * 0.12, 1.4 + i * 0.12, K.easeOutBack);
    const tw = MEASURE.bold(txt, 22, 3);
    o.push(GRP([
      R(0, 0, tw + 66, 44, { fill: 'rgba(255,255,255,0.07)', rx: 22, stroke: 'rgba(255,255,255,0.16)' }),
      U.icon(ic, 30, 22, 21, C.teal),
      T(56, 29, txt, { size: 22, fill: C.ink, spacing: 3 }),
    ], { transform: `translate(${n(cx - (tw + 66) / 2)},${n(cy)}) scale(${n(0.7 + 0.3 * p)})`, opacity: clamp(p * 1.5) }));
  });
  // headline
  const hp = seg(d, 1.15, 1.55, K.easeOutBack);
  o.push(GRP([T(0, 0, 'ONE POS. EVERY DEVICE.', { size: 62, fill: C.ink, anchor: 'middle', spacing: 4 })],
    { transform: `translate(${n(W / 2)},${n(150)}) scale(${n(0.75 + 0.25 * hp)})`, opacity: clamp(hp * 1.5) }));
  o.push(T(W / 2, 196, 'Adaptable for desktop, mobile and PC', { size: 22, fill: C.muted, anchor: 'middle', font: FONT_REG, weight: 500, opacity: seg(d, 1.35, 1.7, K.easeOutCubic) }));
  const ex = seg(d, b - a - 0.14, b - a, K.easeInCubic);
  return GRP(o, { transform: ex > 0 ? `scale(${n(1 + ex * 0.06)})` : null, opacity: 1 - ex * 0.6 }) + flash(t, a + 2.68, 0.16, '#FFFFFF', 0.9);
}

// ============================================================
// SCENE 7 — CTA
// ============================================================
function scene7(t) {
  const [a, b] = TL.s7, d = t - a;
  const o = [];
  const lp = seg(d, 0.02, 0.4, K.easeOutBack);
  const lw = 560, lh = lw / U.LOGO_AR;
  o.push(C_(W / 2, 400, 300, { fill: 'url(#gGlow)', opacity: 0.42 }));
  o.push(GRP([
    R(0, 0, lw + 52, lh + 52, { fill: '#F7FBFC', rx: 32 }),
    `<image href="${U.LOGO_HREF}" x="26" y="26" width="${n(lw)}" height="${n(lh)}" preserveAspectRatio="xMidYMid meet"/>`,
  ], { transform: `translate(${n(W / 2 - (lw + 52) / 2)},${n(430 - (lh + 52) / 2)}) scale(${n(0.6 + 0.4 * lp)})`, opacity: clamp(lp * 1.6) }));

  const words = ['Manage.', 'Sell.', 'Analytics.'];
  const cols = [C.teal, C.green, C.ink];
  const totalW = MEASURE.bold('Manage. Sell. Analytics.', 38, 5) + 2 * 26;
  let wx = W / 2 - totalW / 2;
  words.forEach((wd, i) => {
    const wp = seg(d, 0.3 + i * 0.1, 0.62 + i * 0.1, K.easeOutBack);
    o.push(GRP([T(0, 0, wd, { size: 38, fill: cols[i], spacing: 5 })],
      { transform: `translate(${n(wx)},${n(672)}) scale(${n(0.6 + 0.4 * wp)})`, opacity: clamp(wp * 1.5) }));
    wx += MEASURE.bold(wd, 38, 5) + 26;
  });
  // CTA chip
  const cp = seg(d, 0.5, 0.85, K.easeOutBack);
  o.push(GRP([
    R(0, 0, 560, 66, { fill: C.grad, rx: 33 }),
    U.icon('bolt', 46, 33, 26, '#06251F'),
    T(80, 42, 'Start free — 15-day trial', { size: 26, fill: '#06251F', spacing: 1 }),
  ], { transform: `translate(${n(W / 2 - 280)},${n(740)}) scale(${n(0.75 + 0.25 * cp)})`, opacity: clamp(cp * 1.5) }));
  // url + price
  const up = seg(d, 0.72, 1.0, K.easeOutCubic);
  o.push(T(W / 2, 862, 'artech-pos.pages.dev', { size: 24, fill: C.ink2, anchor: 'middle', spacing: 1.5, opacity: up }));
  o.push(T(W / 2, 898, 'Plans from ₱149 / month', { size: 19, fill: C.muted, anchor: 'middle', font: FONT_REG, weight: 600, opacity: up }));
  // sparkles
  for (let i = 0; i < 10; i++) {
    const sp = ((d * 1.1 + i * 0.17) % 1);
    const ang = i * 2.399 + d * 0.35;
    o.push(GRP([U.icon('sparkle', 0, 0, 16 + 18 * (1 - sp), i % 2 ? C.green : C.teal, { opacity: (1 - sp) * 0.8 })],
      { transform: `translate(${n(W / 2 + Math.cos(ang) * (330 + sp * 300))},${n(430 + Math.sin(ang) * (170 + sp * 160))})` }));
  }
  // end fade
  const fd = seg(d, b - a - 0.35, b - a, K.easeInCubic);
  return GRP(o, { opacity: 1 }) + R(0, 0, W, H, { fill: '#000', opacity: fd });
}

// ============================================================
// helpers used above
// ============================================================
function cursor(x, y, o = {}) {
  const s = o.scale || 1;
  return GRP([
    P('M0 0 L0 22 L5.2 16.6 L9 25 L13 23 L9.2 15 L16 15 Z', { fill: '#FFFFFF', stroke: '#0B2233', sw: 1.2, transform: 'scale(1.15)' }),
  ], { transform: `translate(${n(x)},${n(y)}) scale(${n(s)})`, opacity: o.opacity == null ? 1 : o.opacity });
}
function cursorPath(d, pts) {
  // pts: [time, x, y] sorted; returns interpolated position with click pulses
  let x = pts[0][1], y = pts[0][2];
  for (let i = 0; i < pts.length - 1; i++) {
    if (d >= pts[i][0] && d <= pts[i + 1][0]) {
      const p = K.easeInOutCubic((d - pts[i][0]) / (pts[i + 1][0] - pts[i][0]));
      x = lerp(pts[i][1], pts[i + 1][1], p);
      y = lerp(pts[i][2], pts[i + 1][2], p);
    }
  }
  if (d > pts[pts.length - 1][0]) { x = pts[pts.length - 1][1]; y = pts[pts.length - 1][2]; }
  return { x, y };
}
function toast(x, y, icon, title, sub, col, p) {
  const w = Math.max(360, MEASURE.reg(sub, 15) + 120);
  return GRP([
    R(0, 0, w, 74, { fill: '#0E2A3C', rx: 18, stroke: col, sw: 1.8 }),
    C_(36, 37, 22, { fill: col, opacity: 0.18 }),
    U.icon(icon, 36, 37, 22, col),
    T(70, 32, title, { size: 17, fill: C.ink, font: FONT_REG, weight: 700 }),
    T(70, 55, sub, { size: 14.5, fill: C.muted, font: FONT_REG, weight: 500 }),
  ], { transform: `translate(${n(x)},${n(y - (1 - p) * 30)}) scale(${n(0.85 + 0.15 * p)})`, opacity: clamp(p * 1.5) });
}
function pathPoint(dpath, t) {
  // crude: sample the cubic by fixed points (paths are simple 2-cubic shapes)
  const m = dpath.match(/M([\d.\-]+) ([\d.\-]+) C ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+)/);
  if (!m) return null;
  const v = m.slice(1).map(Number);
  const [x0, y0, x1, y1, x2, y2, x3, y3] = v;
  const u = 1 - t;
  return [
    u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
    u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
  ];
}

// ============================================================
// frame composer
// ============================================================
function frame(t) {
  let body = '';
  const inS = (s) => t >= TL[s][0] && t < TL[s][1];
  if (inS('s1')) body += scene1(t);
  else if (inS('s2')) body += scene2(t);
  else if (inS('s3')) body += scene3(t);
  else if (inS('s4')) body += scene4(t);
  else if (inS('s5')) body += scene5(t);
  else if (inS('s6')) body += scene6(t);
  else if (inS('s7')) body += scene7(t);
  else if (t >= TL.s7[1]) body += scene7(TL.s7[1] - 0.001);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${K.defs()}${body}</svg>`;
}

module.exports = { frame, TL };
