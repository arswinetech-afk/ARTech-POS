/**
 * Stock Replenishment & Analytics Report (PDF)
 *
 * Pixel-faithful re-creation of the report produced by the original ARTech POS
 * (Base44) app: A4 portrait, green header band, four KPI cards, red "Out of Stock"
 * table, amber "Low Stock" table, subtotal boxes, restock budget box and the
 * "Product Analytics Overview" (best sellers / top revenue / most profitable /
 * slow moving), footer with page numbers. Built with jsPDF core fonts only, so the
 * file stays small (~10 pages ≈ 250 KB) and needs no network.
 *
 * This module is intentionally free of browser-only imports (Dexie etc.) so it can
 * be unit-tested in Node.
 */
import { format } from 'date-fns'
import type { jsPDF } from 'jspdf'
import type { Product, Sale, SaleReturn } from './types'

/* ------------------------------------------------------------------ data */

export interface StockLine { name: string; stock: number; sold: number; cost: number; suggested: number; estCost: number }
export interface PerfLine { name: string; qty: number; cost: number; price: number; revenue: number; profit: number }

export interface StockReportData {
  storeName: string
  generatedAt: Date
  days: number
  threshold: number
  totalProducts: number
  outOfStock: StockLine[]
  lowStock: StockLine[]
  bestSellers: PerfLine[]
  topRevenue: PerfLine[]
  mostProfitable: PerfLine[]
  slowMoving: PerfLine[]
}

/** Per-product tallies over the window. `returned` = all units taken back, `restocked` = those that went
 *  back on the shelf, `retRevenue` = their line value, `recovered` = cost of the restocked units. */
interface Agg { qty: number; revenue: number; cost: number; returned: number; restocked: number; retRevenue: number; recovered: number }
const emptyAgg = (): Agg => ({ qty: 0, revenue: 0, cost: 0, returned: 0, restocked: 0, retRevenue: 0, recovered: 0 })

/** Pure aggregation: products + sales (+ returns, 2.3) of the last `days` days → report data.
 *  Stock tables count units that actually left the shelf (sold − returned to stock; damaged returns still
 *  have to be replaced). Analytics rankings are net of all returns (a refunded item is not a sale). */
export function aggregateStockReport(
  storeName: string,
  products: Product[],
  sales: Sale[],
  opts: { threshold?: number; days?: number; now?: Date; returns?: SaleReturn[] } = {},
): StockReportData {
  const now = opts.now ?? new Date()
  const days = opts.days ?? 30
  const threshold = Math.max(1, Math.round(opts.threshold ?? 5))
  const since = new Date(now.getTime() - days * 86400000).toISOString()

  const byId = new Map<string, Agg>()
  const byName = new Map<string, Agg>()
  const bump = (m: Map<string, Agg>, k: string, f: (a: Agg) => void) => {
    const a = m.get(k) || emptyAgg()
    f(a)
    m.set(k, a)
  }
  const both = (productId: string | null | undefined, name: string | null | undefined, f: (a: Agg) => void) => {
    if (productId) bump(byId, productId, f)
    bump(byName, (name || '').trim().toLowerCase(), f)
  }
  for (const s of sales) {
    if (s.status !== 'active' || s.created_at < since) continue
    for (const it of s.items || []) {
      const qty = Number(it.qty) || 0
      if (qty <= 0) continue
      const revenue = qty * (Number(it.price) || 0)
      const cost = qty * (Number(it.cost) || 0)
      both(it.product_id, it.name, (a) => { a.qty += qty; a.revenue += revenue; a.cost += cost })
    }
  }
  for (const r of opts.returns || []) {
    if (r.deleted_at || r.created_at < since) continue
    for (const it of r.items || []) {
      const qty = Number(it.qty) || 0
      if (qty <= 0) continue
      const value = qty * (Number(it.price) || 0)
      const cost = qty * (Number(it.cost) || 0)
      const restock = it.restock !== false
      both(it.product_id, it.name, (a) => { a.returned += qty; a.retRevenue += value; if (restock) { a.restocked += qty; a.recovered += cost } })
    }
  }
  const soldOf = (p: Product): Agg => byId.get(p.id) || byName.get(p.name.trim().toLowerCase()) || emptyAgg()

  const stockLine = (p: Product): StockLine => {
    const a = soldOf(p)
    const sold = Math.max(0, round2(a.qty - a.restocked))
    const cost = Number(p.cost) || 0
    return { name: p.name, stock: Number(p.stock) || 0, sold, cost, suggested: sold, estCost: round2(sold * cost) }
  }
  const byBudget = (a: StockLine, b: StockLine) => b.estCost - a.estCost || b.sold - a.sold || a.name.localeCompare(b.name)
  const limit = (p: Product) => (p.low_stock_at != null ? Number(p.low_stock_at) : threshold)

  const outOfStock = products.filter((p) => Number(p.stock) <= 0).map(stockLine).sort(byBudget)
  const lowStock = products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= limit(p)).map(stockLine).sort(byBudget)

  // performance rankings (products that sold at least once in the window)
  const perf: PerfLine[] = []
  const seen = new Set<string>()
  for (const p of products) {
    const a = soldOf(p)
    const qty = round2(a.qty - a.returned)
    if (qty <= 0) continue
    const key = p.id
    if (seen.has(key)) continue
    seen.add(key)
    const revenue = round2(a.revenue - a.retRevenue)
    perf.push({ name: p.name, qty, cost: Number(p.cost) || 0, price: Number(p.price) || 0, revenue, profit: round2(a.revenue - a.cost - (a.retRevenue - a.recovered)) })
  }
  const top = (cmp: (a: PerfLine, b: PerfLine) => number) => [...perf].sort(cmp).slice(0, 10)
  return {
    storeName,
    generatedAt: now,
    days,
    threshold,
    totalProducts: products.length,
    outOfStock,
    lowStock,
    bestSellers: top((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.localeCompare(b.name)),
    topRevenue: top((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name)),
    mostProfitable: top((a, b) => b.profit - a.profit || b.revenue - a.revenue || a.name.localeCompare(b.name)),
    slowMoving: top((a, b) => a.qty - b.qty || a.revenue - b.revenue || a.name.localeCompare(b.name)),
  }
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0))

/* ------------------------------------------------------------------ drawing */

type RGB = [number, number, number]
const GREEN: RGB = [28, 114, 73]
const RED: RGB = [185, 28, 28]
const AMBER: RGB = [146, 111, 0]
const PINK: RGB = [252, 229, 232]
const CREAM: RGB = [255, 247, 226]
const MINT: RGB = [229, 242, 237]
const ZEBRA: RGB = [242, 244, 244]
const LINE: RGB = [209, 214, 219]
const INK: RGB = [40, 40, 40]
const MUTED: RGB = [90, 95, 105]
const WHITE: RGB = [255, 255, 255]

// A4 geometry (mm) — measured from the original report
const PAGE_W = 210
const ML = 15
const MR = 195
const CW = MR - ML
const TOP = 20
const BOTTOM = 277
const HEAD_H = 8
const ROW_H = 7
const BAR_H = 9

type Align = 'left' | 'center' | 'right'
interface Col { label: string; x: number; align: Align; maxW?: number; bold?: boolean }

const STOCK_COLS: Col[] = [
  { label: 'Product', x: 17, align: 'left', maxW: 54 },
  { label: 'Current', x: 77, align: 'center' },
  { label: 'Sold (30d)', x: 96, align: 'center' },
  { label: 'Unit Cost', x: 133, align: 'right' },
  { label: 'Suggested Qty', x: 147, align: 'center' },
  { label: 'Est. Cost', x: 193, align: 'right', bold: true },
]
const perfCols = (last: string): Col[] => [
  { label: 'Product', x: 17, align: 'left', maxW: 64 },
  { label: 'Qty Sold', x: 88, align: 'center' },
  { label: 'Unit Cost', x: 129, align: 'right' },
  { label: 'Selling Price', x: 161, align: 'right' },
  { label: last, x: 193, align: 'right', bold: true },
]

export const money = (n: number) => 'PHP ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }))

export function renderStockReport(doc: jsPDF, d: StockReportData): jsPDF {
  let y = 0
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2])
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2])
  const ink = (c: RGB) => doc.setTextColor(c[0], c[1], c[2])
  const font = (size: number, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size) }
  const text = (s: string, x: number, yy: number, align: Align = 'left') => doc.text(s, x, yy, { align })
  const newPage = () => { doc.addPage(); y = TOP }
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage() }
  /** Shrink (down to 7 pt) then ellipsize so a label never runs into the next column. */
  const fit = (s: string, maxW: number, size: number, bold: boolean) => {
    let str = (s || '').replace(/\s+/g, ' ').trim()
    let sz = size
    font(sz, bold)
    while (doc.getTextWidth(str) > maxW && sz > 7) { sz -= 0.5; font(sz, bold) }
    if (doc.getTextWidth(str) > maxW) {
      while (str.length > 1 && doc.getTextWidth(str + '…') > maxW) str = str.slice(0, -1)
      str = str.trimEnd() + '…'
    }
    return { str, sz }
  }

  /* ---- header band (first page only) */
  fill(GREEN); doc.rect(0, 0, PAGE_W, 26, 'F')
  ink(WHITE)
  {
    const { str, sz } = fit(d.storeName || 'My Store', 115, 15, true)
    font(sz, true); text(str, ML, 11)
  }
  font(10); text('Stock Replenishment & Analytics Report', ML, 19)
  font(8.5); text(`Generated: ${format(d.generatedAt, 'MMM d, yyyy h:mm a')}`, MR, 11, 'right')

  /* ---- KPI cards */
  const outBudget = sum(d.outOfStock.map((l) => l.estCost))
  const lowBudget = sum(d.lowStock.map((l) => l.estCost))
  const budget = round2(outBudget + lowBudget)
  const cards: Array<{ label: string; value: string; color: RGB; size: number }> = [
    { label: 'TOTAL PRODUCTS', value: qtyText(d.totalProducts), color: GREEN, size: 13 },
    { label: 'OUT OF STOCK', value: qtyText(d.outOfStock.length), color: RED, size: 13 },
    { label: 'LOW STOCK', value: qtyText(d.lowStock.length), color: AMBER, size: 13 },
    { label: 'RESTOCK BUDGET', value: money(budget), color: GREEN, size: 10 },
  ]
  const cardW = 43.5, cardH = 16, gap = 2
  cards.forEach((c, i) => {
    const x = ML + i * (cardW + gap)
    const cy = 34
    doc.setLineWidth(0.3); stroke(LINE); fill(WHITE)
    doc.roundedRect(x, cy, cardW, cardH, 1.5, 1.5, 'FD')
    // coloured accent stripe, clipped to the rounded card
    doc.saveGraphicsState()
    doc.roundedRect(x, cy, cardW, cardH, 1.5, 1.5, null as unknown as string)
    doc.clip(); doc.discardPath()
    fill(c.color); doc.rect(x, cy, 1.5, cardH, 'F')
    doc.restoreGraphicsState()
    font(7); ink(MUTED); text(c.label, x + 4, cy + 5.5)
    font(c.size, true); ink(c.color); text(c.value, x + 4, cy + 13)
  })
  y = 56

  /* ---- helpers */
  const sectionBar = (title: string, color: RGB, right?: string) => {
    ensure(BAR_H + 3 + HEAD_H + ROW_H)
    fill(color); doc.rect(ML, y, CW, BAR_H, 'F')
    ink(WHITE); font(11, true); text(title, ML + 3, y + 6.2)
    if (right) { font(9); text(right, MR - 3, y + 6.2, 'right') }
    y += BAR_H + 3
  }
  const tableHead = (cols: Col[], color: RGB) => {
    fill(color); doc.rect(ML, y, CW, HEAD_H, 'F')
    ink(WHITE); font(8.5, true)
    for (const c of cols) text(c.label, c.x, y + 6.25, c.align)
    y += HEAD_H
  }
  const table = (cols: Col[], rows: string[][], color: RGB, tint: RGB | null, emptyText: string) => {
    ensure(HEAD_H + ROW_H)
    let segTop = y
    const closeSegment = () => { doc.setLineWidth(0.2); stroke(LINE); doc.rect(ML, segTop, CW, y - segTop, 'S') }
    tableHead(cols, color)
    if (rows.length === 0) {
      fill(tint || ZEBRA); doc.rect(ML, y, CW, ROW_H, 'F')
      font(8.5); ink(MUTED); text(emptyText, ML + CW / 2, y + 5.75, 'center')
      y += ROW_H
      closeSegment()
      return
    }
    rows.forEach((r, i) => {
      if (y + ROW_H > BOTTOM) { closeSegment(); newPage(); segTop = y; tableHead(cols, color) }
      if (tint) { fill(tint); doc.rect(ML, y, CW, ROW_H, 'F') }
      else if (i % 2 === 1) { fill(ZEBRA); doc.rect(ML, y, CW, ROW_H, 'F') }
      ink(INK)
      cols.forEach((c, ci) => {
        const v = r[ci] ?? ''
        if (c.maxW) { const f = fit(v, c.maxW, 8.5, !!c.bold); font(f.sz, !!c.bold); text(f.str, c.x, y + 5.75, c.align) }
        else { font(8.5, !!c.bold); text(v, c.x, y + 5.75, c.align) }
      })
      y += ROW_H
    })
    closeSegment()
  }
  const subtotalBox = (label: string, value: string, color: RGB) => {
    y += 3
    ensure(BAR_H)
    doc.setLineWidth(0.4); stroke(color); fill(MINT)
    doc.roundedRect(ML, y, CW, BAR_H, 1.5, 1.5, 'FD')
    ink(color); font(9, true); text(label, ML + 3, y + 5.8); text(value, MR - 3, y + 5.8, 'right')
    y += BAR_H + 3
  }
  const stockRows = (lines: StockLine[]) => lines.map((l) => [l.name, qtyText(l.stock), qtyText(l.sold), money(l.cost), qtyText(l.suggested), money(l.estCost)])
  const perfRows = (lines: PerfLine[], last: 'revenue' | 'profit') => lines.map((l) => [l.name, qtyText(l.qty), money(l.cost), money(l.price), money(l[last])])

  /* ---- out of stock */
  sectionBar('Out of Stock Items', RED, `${d.outOfStock.length} items`)
  table(STOCK_COLS, stockRows(d.outOfStock), RED, PINK, 'No out-of-stock items — great job!')
  subtotalBox('Out of Stock Subtotal', money(outBudget), RED)

  /* ---- low stock */
  sectionBar(`Low Stock Items (1-${d.threshold} units)`, AMBER, `${d.lowStock.length} items`)
  table(STOCK_COLS, stockRows(d.lowStock), AMBER, CREAM, 'No low-stock items')
  subtotalBox('Low Stock Subtotal', money(lowBudget), AMBER)

  /* ---- restock budget */
  ensure(15)
  doc.setLineWidth(0.5); stroke(GREEN); fill(MINT)
  doc.roundedRect(ML, y, CW, 15, 2, 2, 'FD')
  ink(GREEN); font(10, true); text('ESTIMATED RESTOCK BUDGET', ML + 4, y + 6)
  font(7.5); ink(MUTED); text(`Suggested order qty = units sold over the last ${d.days} days, less items returned to stock.`, ML + 4, y + 12.5)
  font(15, true); ink(GREEN); text(money(budget), MR - 4, y + 9.5, 'right')
  y += 15 + 3

  /* ---- analytics */
  const firstTable = BAR_H + 3 + HEAD_H + Math.max(1, d.bestSellers.length) * ROW_H
  if (y + 2 + BAR_H + 7 + firstTable > BOTTOM) newPage(); else y += 2
  fill(GREEN); doc.rect(ML, y, CW, BAR_H, 'F')
  ink(WHITE); font(11, true); text('Product Analytics Overview', ML + 3, y + 6.2)
  y += BAR_H
  font(8.5); ink(MUTED); text(`Performance rankings based on sales over the last ${d.days} days, net of returns. Unit cost reflects current purchase price.`, ML, y + 3)
  y += 7
  const noSales = `No sales recorded in the last ${d.days} days`
  const perfSection = (title: string, lines: PerfLine[], last: 'revenue' | 'profit', label: string) => {
    // keep these short ranking tables on one page when possible
    const needed = BAR_H + 3 + HEAD_H + Math.max(1, lines.length) * ROW_H
    if (y + needed > BOTTOM && needed <= BOTTOM - TOP) newPage()
    sectionBar(title, GREEN)
    table(perfCols(label), perfRows(lines, last), GREEN, null, noSales)
    y += 4
  }
  perfSection('Best Sellers (by quantity sold)', d.bestSellers, 'revenue', 'Revenue')
  perfSection('Top Revenue Generators', d.topRevenue, 'revenue', 'Revenue')
  perfSection('Most Profitable Products', d.mostProfitable, 'profit', 'Profit')
  perfSection('Slow Moving Products', d.slowMoving, 'revenue', 'Revenue')

  /* ---- footer on every page */
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setLineWidth(0.2); stroke(LINE); doc.line(ML, 287, MR, 287)
    font(7.5); ink(MUTED)
    text(`${d.storeName} - Stock Report`, ML, 291)
    text(`Page ${i} of ${pages}`, MR, 291, 'right')
  }
  doc.setProperties({ title: `${d.storeName} — Stock Report ${format(d.generatedAt, 'yyyy-MM-dd')}`, subject: 'Stock Replenishment & Analytics Report', creator: 'ARTech POS' })
  return doc
}

export const stockReportFilename = (when: Date) => `Stock-Report-${format(when, 'yyyy-MM-dd')}.pdf`

/** Create the document (jsPDF is loaded lazily so it never weighs on the app bundle). */
export async function buildStockReportPdf(d: StockReportData): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  return renderStockReport(doc, d)
}
