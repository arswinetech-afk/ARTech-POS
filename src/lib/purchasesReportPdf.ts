/**
 * Inventory Purchases Report — "Purchases Journal" (PDF)
 *
 * Professional A4 report for the accounting / procurement department, in the same
 * visual language as the Stock Replenishment report: green header band, KPI cards,
 * period summary (daily / weekly / monthly / quarterly), top items by spend, the
 * detailed purchases journal (date, item, qty, unit cost, amount), grand-total box
 * and a certification block (Prepared / Checked / Approved by) with signature lines.
 *
 * Built with jsPDF core fonts only, no network needed. This module is intentionally
 * free of browser-only imports (Dexie etc.) so it can be unit-tested in Node.
 */
import { format, parseISO, startOfDay, startOfWeek, addDays, startOfMonth, startOfQuarter } from 'date-fns'
import type { jsPDF } from 'jspdf'

/* ------------------------------------------------------------------ data */

/** One stock-in receipt (a `stock_movements` row of type 'purchase'). */
export interface PurchaseLine {
  at: string               // ISO timestamp
  item: string
  qty: number
  unitCost: number | null  // null = not recorded at stock-in time
  total: number            // qty × unitCost (0 when unknown)
  note: string | null      // supplier / reference
  by: string | null        // who recorded it
}

export type PurchaseGroup = 'day' | 'week' | 'month' | 'quarter'
export const GROUP_LABEL: Record<PurchaseGroup, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly' }

export interface PeriodLine { key: string; label: string; receipts: number; units: number; total: number }
export interface TopSpendLine { name: string; receipts: number; units: number; total: number }
/** Supplier cost fluctuation for one item within the period (a.k.a. purchase price variance). */
export interface PriceChangeLine { name: string; firstCost: number; lastCost: number; change: number; pct: number; moves: number; lastAt: string }

export interface PurchasesReportData {
  storeName: string
  generatedAt: Date
  from: Date
  to: Date
  group: PurchaseGroup
  lines: PurchaseLine[]        // journal order: oldest first
  periods: PeriodLine[]
  topItems: TopSpendLine[]
  priceChanges: PriceChangeLine[]
  totalCost: number
  units: number
  receipts: number
  distinctItems: number
  missingCost: number          // receipts without a recorded unit cost
  preparedBy?: string | null
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function bucket(at: string, group: PurchaseGroup): { key: string; label: string } {
  const d = parseISO(at)
  switch (group) {
    case 'day': { const s = startOfDay(d); return { key: s.toISOString(), label: format(s, 'EEE, MMM d, yyyy') } }
    case 'week': { const s = startOfWeek(d, { weekStartsOn: 1 }); return { key: s.toISOString(), label: `${format(s, 'MMM d')} – ${format(addDays(s, 6), 'MMM d, yyyy')}` } }
    case 'month': { const s = startOfMonth(d); return { key: s.toISOString(), label: format(s, 'MMMM yyyy') } }
    case 'quarter': { const s = startOfQuarter(d); return { key: s.toISOString(), label: format(s, 'QQQ yyyy') } }
  }
}

/** Group receipts into calendar buckets (chronological). */
export function summarizePurchases(lines: PurchaseLine[], group: PurchaseGroup): PeriodLine[] {
  const m = new Map<string, PeriodLine>()
  for (const l of lines) {
    const b = bucket(l.at, group)
    const e = m.get(b.key) || { key: b.key, label: b.label, receipts: 0, units: 0, total: 0 }
    e.receipts++; e.units = round2(e.units + l.qty); e.total = round2(e.total + l.total)
    m.set(b.key, e)
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Detect supplier price fluctuations: items whose recorded unit cost changed between
 *  receipts within the period. Sorted by biggest swing first. Past sales are never
 *  affected by these changes — each sale keeps the cost captured when it was made. */
export function computePriceChanges(lines: PurchaseLine[]): PriceChangeLine[] {
  const byItem = new Map<string, PurchaseLine[]>()
  for (const l of lines) if (l.unitCost != null) byItem.set(l.item, [...(byItem.get(l.item) || []), l])
  const out: PriceChangeLine[] = []
  for (const [name, ls] of byItem) {
    const s = [...ls].sort((a, b) => a.at.localeCompare(b.at))
    let moves = 0
    for (let i = 1; i < s.length; i++) if (s[i].unitCost !== s[i - 1].unitCost) moves++
    if (moves === 0) continue
    const first = s[0].unitCost as number
    const last = s[s.length - 1].unitCost as number
    out.push({ name, firstCost: first, lastCost: last, change: round2(last - first), pct: first ? ((last - first) / first) * 100 : 0, moves, lastAt: s[s.length - 1].at })
  }
  return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || a.name.localeCompare(b.name))
}

/** Pure aggregation: receipt lines → full report dataset. */
export function aggregatePurchasesReport(
  storeName: string,
  lines: PurchaseLine[],
  opts: { from: Date; to: Date; group: PurchaseGroup; now?: Date; preparedBy?: string | null },
): PurchasesReportData {
  const sorted = [...lines].sort((a, b) => a.at.localeCompare(b.at))
  const byItem = new Map<string, TopSpendLine>()
  for (const l of sorted) {
    const e = byItem.get(l.item) || { name: l.item, receipts: 0, units: 0, total: 0 }
    e.receipts++; e.units = round2(e.units + l.qty); e.total = round2(e.total + l.total)
    byItem.set(l.item, e)
  }
  return {
    storeName,
    generatedAt: opts.now ?? new Date(),
    from: opts.from, to: opts.to, group: opts.group,
    lines: sorted,
    periods: summarizePurchases(sorted, opts.group),
    topItems: [...byItem.values()].sort((a, b) => b.total - a.total || b.units - a.units || a.name.localeCompare(b.name)).slice(0, 10),
    priceChanges: computePriceChanges(sorted).slice(0, 40),
    totalCost: round2(sorted.reduce((a, l) => a + l.total, 0)),
    units: round2(sorted.reduce((a, l) => a + l.qty, 0)),
    receipts: sorted.length,
    distinctItems: byItem.size,
    missingCost: sorted.filter((l) => l.unitCost == null).length,
    preparedBy: opts.preparedBy ?? null,
  }
}

/* ------------------------------------------------------------------ drawing */

type RGB = [number, number, number]
const GREEN: RGB = [28, 114, 73]
const RED: RGB = [185, 28, 28]
const MINT: RGB = [229, 242, 237]
const ZEBRA: RGB = [242, 244, 244]
const LINE: RGB = [209, 214, 219]
const INK: RGB = [40, 40, 40]
const MUTED: RGB = [90, 95, 105]
const WHITE: RGB = [255, 255, 255]
const SLATE: RGB = [71, 85, 105]

const PAGE_W = 210
const ML = 15
const MR = 195
const CW = MR - ML
const TOP = 20
const BOTTOM = 277
const HEAD_H = 8
const ROW_H = 7
const BAR_H = 9
/** Journal safety cap — beyond this the PDF only summarises (CSV carries the full detail). */
export const MAX_JOURNAL_ROWS = 600

type Align = 'left' | 'center' | 'right'
interface Col { label: string; x: number; align: Align; maxW?: number; bold?: boolean }

const PERIOD_COLS: Col[] = [
  { label: 'Period', x: 17, align: 'left', maxW: 78 },
  { label: 'Receipts', x: 110, align: 'center' },
  { label: 'Units In', x: 135, align: 'center' },
  { label: '% of Spend', x: 165, align: 'right' },
  { label: 'Total Cost', x: 193, align: 'right', bold: true },
]
const TOP_COLS: Col[] = [
  { label: 'Item', x: 17, align: 'left', maxW: 78 },
  { label: 'Receipts', x: 110, align: 'center' },
  { label: 'Units In', x: 135, align: 'center' },
  { label: '% Share', x: 165, align: 'right' },
  { label: 'Total Cost', x: 193, align: 'right', bold: true },
]
const VARIANCE_COLS: Col[] = [
  { label: 'Item', x: 17, align: 'left', maxW: 62 },
  { label: 'First Cost', x: 112, align: 'right' },
  { label: 'Latest Cost', x: 142, align: 'right' },
  { label: 'Change', x: 170, align: 'right' },
  { label: '%', x: 193, align: 'right', bold: true },
]
const JOURNAL_COLS: Col[] = [
  { label: 'Date', x: 17, align: 'left', maxW: 23 },
  { label: 'Item / Reference', x: 43, align: 'left', maxW: 66 },
  { label: 'Qty', x: 119, align: 'center' },
  { label: 'Unit Cost', x: 155, align: 'right' },
  { label: 'Amount', x: 193, align: 'right', bold: true },
]

export const money = (n: number) => 'PHP ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }))
const pctText = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—')

export function renderPurchasesReport(doc: jsPDF, d: PurchasesReportData): jsPDF {
  let y = 0
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2])
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2])
  const ink = (c: RGB) => doc.setTextColor(c[0], c[1], c[2])
  const font = (size: number, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size) }
  const text = (s: string, x: number, yy: number, align: Align = 'left') => doc.text(s, x, yy, { align })
  const newPage = () => { doc.addPage(); y = TOP }
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage() }
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

  const periodText = `${format(d.from, 'MMM d, yyyy')} – ${format(d.to, 'MMM d, yyyy')}`

  /* ---- header band */
  fill(GREEN); doc.rect(0, 0, PAGE_W, 26, 'F')
  ink(WHITE)
  {
    const { str, sz } = fit(d.storeName || 'My Store', 110, 15, true)
    font(sz, true); text(str, ML, 11)
  }
  font(10); text('Inventory Purchases Report  ·  Purchases Journal', ML, 19)
  font(8.5); text(`Generated: ${format(d.generatedAt, 'MMM d, yyyy h:mm a')}`, MR, 11, 'right')
  font(8.5, true); text(`Period: ${periodText}`, MR, 19, 'right')

  /* ---- KPI cards */
  const cards: Array<{ label: string; value: string; size: number }> = [
    { label: 'TOTAL PURCHASES', value: money(d.totalCost), size: 10 },
    { label: 'RECEIPTS (STOCK-INS)', value: qtyText(d.receipts), size: 13 },
    { label: 'UNITS RECEIVED', value: qtyText(d.units), size: 13 },
    { label: 'ITEMS RESTOCKED', value: qtyText(d.distinctItems), size: 13 },
  ]
  const cardW = 43.5, cardH = 16, gap = 2
  cards.forEach((c, i) => {
    const x = ML + i * (cardW + gap)
    const cy = 34
    doc.setLineWidth(0.3); stroke(LINE); fill(WHITE)
    doc.roundedRect(x, cy, cardW, cardH, 1.5, 1.5, 'FD')
    doc.saveGraphicsState()
    doc.roundedRect(x, cy, cardW, cardH, 1.5, 1.5, null as unknown as string)
    doc.clip(); doc.discardPath()
    fill(GREEN); doc.rect(x, cy, 1.5, cardH, 'F')
    doc.restoreGraphicsState()
    font(7); ink(MUTED); text(c.label, x + 4, cy + 5.5)
    font(c.size, true); ink(GREEN); text(c.value, x + 4, cy + 13)
  })
  y = 56

  /* ---- table helpers (same look as the stock report) */
  const sectionBar = (title: string, right?: string) => {
    ensure(BAR_H + 3 + HEAD_H + ROW_H)
    fill(GREEN); doc.rect(ML, y, CW, BAR_H, 'F')
    ink(WHITE); font(11, true); text(title, ML + 3, y + 6.2)
    if (right) { font(9); text(right, MR - 3, y + 6.2, 'right') }
    y += BAR_H + 3
  }
  const tableHead = (cols: Col[]) => {
    fill(GREEN); doc.rect(ML, y, CW, HEAD_H, 'F')
    ink(WHITE); font(8.5, true)
    for (const c of cols) text(c.label, c.x, y + 6.25, c.align)
    y += HEAD_H
  }
  const table = (cols: Col[], rows: string[][], emptyText: string, colInk?: (ri: number, ci: number) => RGB | null) => {
    ensure(HEAD_H + ROW_H)
    let segTop = y
    const closeSegment = () => { doc.setLineWidth(0.2); stroke(LINE); doc.rect(ML, segTop, CW, y - segTop, 'S') }
    tableHead(cols)
    if (rows.length === 0) {
      fill(ZEBRA); doc.rect(ML, y, CW, ROW_H, 'F')
      font(8.5); ink(MUTED); text(emptyText, ML + CW / 2, y + 5.75, 'center')
      y += ROW_H
      closeSegment()
      return
    }
    rows.forEach((r, i) => {
      if (y + ROW_H > BOTTOM) { closeSegment(); newPage(); segTop = y; tableHead(cols) }
      if (i % 2 === 1) { fill(ZEBRA); doc.rect(ML, y, CW, ROW_H, 'F') }
      cols.forEach((c, ci) => {
        const v = r[ci] ?? ''
        ink(colInk?.(i, ci) || INK)
        if (c.maxW) { const f = fit(v, c.maxW, 8.5, !!c.bold); font(f.sz, !!c.bold); text(f.str, c.x, y + 5.75, c.align) }
        else { font(8.5, !!c.bold); text(v, c.x, y + 5.75, c.align) }
      })
      y += ROW_H
    })
    closeSegment()
  }
  const subtotalBox = (label: string, value: string) => {
    y += 3
    ensure(BAR_H)
    doc.setLineWidth(0.4); stroke(GREEN); fill(MINT)
    doc.roundedRect(ML, y, CW, BAR_H, 1.5, 1.5, 'FD')
    ink(GREEN); font(9, true); text(label, ML + 3, y + 5.8); text(value, MR - 3, y + 5.8, 'right')
    y += BAR_H + 3
  }

  /* ---- period summary */
  sectionBar(`${GROUP_LABEL[d.group]} Purchase Summary`, `${d.periods.length} period${d.periods.length === 1 ? '' : 's'}`)
  table(PERIOD_COLS, d.periods.map((p) => [p.label, qtyText(p.receipts), qtyText(p.units), pctText(p.total, d.totalCost), money(p.total)]), 'No purchases recorded in this period')
  subtotalBox('Total Inventory Purchases', money(d.totalCost))

  /* ---- top items by spend */
  sectionBar('Top Items by Purchase Spend', `top ${Math.min(10, d.topItems.length)} of ${d.distinctItems}`)
  table(TOP_COLS, d.topItems.map((t) => [t.name, qtyText(t.receipts), qtyText(t.units), pctText(t.total, d.totalCost), money(t.total)]), 'No purchases recorded in this period')
  y += 4

  /* ---- purchase price variance (supplier cost fluctuations) */
  sectionBar('Purchase Price Variance — Supplier Cost Changes', `${d.priceChanges.length} item${d.priceChanges.length === 1 ? '' : 's'}`)
  table(
    VARIANCE_COLS,
    d.priceChanges.map((p) => [
      p.moves > 1 ? `${p.name} (${p.moves} changes)` : p.name,
      money(p.firstCost),
      money(p.lastCost),
      `${p.change > 0 ? '+' : p.change < 0 ? '-' : ''}${money(Math.abs(p.change))}`,
      `${p.pct > 0 ? '+' : p.pct < 0 ? '-' : ''}${Math.abs(p.pct).toFixed(1)}%`,
    ]),
    'No supplier price changes detected in this period',
    (ri, ci) => (ci >= 3 ? (d.priceChanges[ri].change > 0 ? RED : d.priceChanges[ri].change < 0 ? GREEN : null) : null),
  )
  y += 2
  font(7.5); ink(MUTED)
  text('First vs latest unit cost recorded at stock-in within the period. Completed sales are unaffected — every sale keeps the cost captured at the time of sale.', ML, y + 3)
  y += 8

  /* ---- detailed journal */
  const journal = d.lines.slice(0, MAX_JOURNAL_ROWS)
  sectionBar('Purchases Journal — Detail', `${d.receipts} entr${d.receipts === 1 ? 'y' : 'ies'}`)
  table(
    JOURNAL_COLS,
    journal.map((l) => [
      format(parseISO(l.at), 'MM/dd/yy'),
      l.note ? `${l.item} — ${l.note}` : l.item,
      qtyText(l.qty),
      l.unitCost == null ? '—' : money(l.unitCost),
      l.unitCost == null ? '—' : money(l.total),
    ]),
    'No purchases recorded in this period',
  )
  if (d.lines.length > journal.length) {
    y += 2; font(7.5); ink(MUTED)
    text(`Showing the first ${MAX_JOURNAL_ROWS} of ${d.receipts} entries — export the CSV for the complete journal.`, ML, y + 3)
    y += 6
  }

  /* ---- grand total box */
  y += 3
  ensure(15)
  doc.setLineWidth(0.5); stroke(GREEN); fill(MINT)
  doc.roundedRect(ML, y, CW, 15, 2, 2, 'FD')
  ink(GREEN); font(10, true); text('TOTAL INVENTORY PURCHASES', ML + 4, y + 6)
  font(7.5); ink(MUTED); text(`${d.receipts} receipts · ${qtyText(d.units)} units across ${d.distinctItems} items · ${periodText}`, ML + 4, y + 12.5)
  font(15, true); ink(GREEN); text(money(d.totalCost), MR - 4, y + 9.5, 'right')
  y += 15 + 3

  if (d.missingCost > 0) {
    ensure(6)
    font(7.5); ink(MUTED)
    text(`Note: ${d.missingCost} receipt${d.missingCost === 1 ? '' : 's'} had no unit cost recorded at stock-in — their amounts are shown as “—” and excluded from cost totals.`, ML, y + 3)
    y += 7
  }

  /* ---- certification / signature block */
  const SIG_H = 34
  ensure(SIG_H + 6)
  y += 4
  font(8.5, true); ink(SLATE); text('CERTIFICATION', ML, y)
  font(7.5); ink(MUTED); text('I hereby certify that the above purchases are true and correct as recorded in the point-of-sale system.', ML, y + 4.5)
  y += 10
  const sigW = (CW - 2 * 8) / 3
  const roles = [
    { role: 'Prepared by', name: d.preparedBy || '' },
    { role: 'Checked by — Accounting', name: '' },
    { role: 'Approved by — Procurement', name: '' },
  ]
  roles.forEach((r, i) => {
    const x = ML + i * (sigW + 8)
    if (r.name) { font(9, true); ink(INK); text(r.name, x + sigW / 2, y + 10, 'center') }
    doc.setLineWidth(0.3); stroke(SLATE); doc.line(x, y + 12, x + sigW, y + 12)
    font(8, true); ink(SLATE); text(r.role, x + sigW / 2, y + 16.5, 'center')
    font(7); ink(MUTED); text('Signature over printed name / Date', x + sigW / 2, y + 20.5, 'center')
  })
  y += SIG_H

  /* ---- footer on every page */
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setLineWidth(0.2); stroke(LINE); doc.line(ML, 287, MR, 287)
    font(7.5); ink(MUTED)
    text(`${d.storeName} - Inventory Purchases Report (${periodText})`, ML, 291)
    text(`Page ${i} of ${pages}`, MR, 291, 'right')
  }
  doc.setProperties({ title: `${d.storeName} — Inventory Purchases Report ${format(d.from, 'yyyy-MM-dd')} to ${format(d.to, 'yyyy-MM-dd')}`, subject: 'Inventory Purchases Report / Purchases Journal', creator: 'ARTech POS' })
  return doc
}

export const purchasesReportFilename = (from: Date, to: Date) => `Purchases-Report-${format(from, 'yyyyMMdd')}-${format(to, 'yyyyMMdd')}.pdf`

/** Create the document (jsPDF is loaded lazily so it never weighs on the app bundle). */
export async function buildPurchasesReportPdf(d: PurchasesReportData): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  return renderPurchasesReport(doc, d)
}
