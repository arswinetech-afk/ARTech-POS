/**
 * Barcode label sheet (PDF) — big, high-contrast EAN barcodes for items whose
 * factory-printed codes are too small/dense for entry-level scanners (cigarette
 * packs, sachets…). Print, laminate, keep at the counter or stick on shelves:
 * scanning the big label rings up the exact same product.
 *
 * A4, 3 × 7 grid (63.3 × 38 mm labels — Avery L7160-compatible). Each label:
 * item name, price, EAN bars at ~0.44 mm module (33% above the minimum print
 * size, reads instantly on cheap CCD/CMOS engines) and the human-readable code.
 *
 * Pure module (no browser imports) — the EAN encoder is unit-testable in Node.
 */
import { format } from 'date-fns'
import type { jsPDF } from 'jspdf'

/* ------------------------------------------------------------------ EAN encoding */

// L-codes for digits 0-9; R = bitwise complement of L; G = R reversed.
const L: Record<string, string> = {
  '0': '0001101', '1': '0011001', '2': '0010011', '3': '0111101', '4': '0100011',
  '5': '0110001', '6': '0101111', '7': '0111011', '8': '0110111', '9': '0001011',
}
const complement = (s: string) => s.replace(/[01]/g, (c) => (c === '0' ? '1' : '0'))
const R: Record<string, string> = Object.fromEntries(Object.entries(L).map(([d, v]) => [d, complement(v)]))
const G: Record<string, string> = Object.fromEntries(Object.entries(R).map(([d, v]) => [d, v.split('').reverse().join('')]))
// EAN-13 parity pattern for the left group, selected by the first digit.
const PARITY: Record<string, string> = {
  '0': 'LLLLLL', '1': 'LLGLGG', '2': 'LLGGLG', '3': 'LLGGGL', '4': 'LGLLGG',
  '5': 'LGGLLG', '6': 'LGGGLL', '7': 'LGLGLG', '8': 'LGLGGL', '9': 'LGGLGL',
}

/** EAN/UPC check digit for the full code (last digit is the check). */
function checksumOk(code: string): boolean {
  const digits = code.split('').map(Number)
  const check = digits.pop()!
  // weights from the RIGHT of the data part: 3,1,3,1…
  let sum = 0
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1) })
  return (10 - (sum % 10)) % 10 === check
}

/** Normalize to a printable EAN: EAN-8 stays, UPC-A (12) becomes EAN-13. Returns null if not encodable. */
export function normalizeEan(raw: string | null | undefined): { code: string; kind: 'ean8' | 'ean13' } | null {
  const c = (raw || '').trim()
  if (!/^\d+$/.test(c)) return null
  if (c.length === 8) return checksumOk(c) ? { code: c, kind: 'ean8' } : null
  if (c.length === 12) { const e = '0' + c; return checksumOk(e) ? { code: e, kind: 'ean13' } : null }
  if (c.length === 13) return checksumOk(c) ? { code: c, kind: 'ean13' } : null
  return null
}

/** 95-module ('0'/'1') pattern for a valid EAN-13. */
export function ean13Modules(code: string): string {
  const parity = PARITY[code[0]]
  let out = '101'
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === 'L' ? L : G)[code[i]]
  out += '01010'
  for (let i = 7; i <= 12; i++) out += R[code[i]]
  return out + '101'
}

/** 67-module pattern for a valid EAN-8. */
export function ean8Modules(code: string): string {
  let out = '101'
  for (let i = 0; i < 4; i++) out += L[code[i]]
  out += '01010'
  for (let i = 4; i < 8; i++) out += R[code[i]]
  return out + '101'
}

/* ------------------------------------------------------------------ sheet rendering */

export interface LabelItem { name: string; price: number; barcode: string }

const PAGE_W = 210
const COLS = 3
const ROWS = 7
export const LABELS_PER_PAGE = COLS * ROWS
export const MAX_LABELS = LABELS_PER_PAGE * 10 // 10 pages is plenty for one print run
const LAB_W = 63.3
const LAB_H = 38
const MARGIN_X = (PAGE_W - COLS * LAB_W) / 2
const MARGIN_Y = (297 - ROWS * LAB_H) / 2
const MODULE = 0.44 // mm per module (min spec is 0.33 — bigger prints, easier reads)
const BAR_H = 15
const money = (n: number) => 'P' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function renderBarcodeSheet(doc: jsPDF, items: LabelItem[], storeName: string): jsPDF {
  const font = (size: number, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size) }
  const fit = (s: string, maxW: number, size: number, bold: boolean) => {
    let str = (s || '').replace(/\s+/g, ' ').trim()
    let sz = size
    font(sz, bold)
    while (doc.getTextWidth(str) > maxW && sz > 6.5) { sz -= 0.5; font(sz, bold) }
    if (doc.getTextWidth(str) > maxW) {
      while (str.length > 1 && doc.getTextWidth(str + '…') > maxW) str = str.slice(0, -1)
      str = str.trimEnd() + '…'
    }
    return { str, sz }
  }

  items.slice(0, MAX_LABELS).forEach((it, idx) => {
    const i = idx % LABELS_PER_PAGE
    if (idx > 0 && i === 0) doc.addPage()
    const x = MARGIN_X + (i % COLS) * LAB_W
    const y = MARGIN_Y + Math.floor(i / COLS) * LAB_H

    // faint cut guide
    doc.setDrawColor(210, 214, 219); doc.setLineWidth(0.15)
    doc.rect(x, y, LAB_W, LAB_H, 'S')

    // name + price
    doc.setTextColor(30, 30, 30)
    const name = fit(it.name, LAB_W - 8, 9, true)
    font(name.sz, true); doc.text(name.str, x + LAB_W / 2, y + 6, { align: 'center' })
    font(9, true); doc.text(money(it.price), x + LAB_W / 2, y + 11.5, { align: 'center' })

    // bars
    const ean = normalizeEan(it.barcode)!
    const modules = ean.kind === 'ean8' ? ean8Modules(ean.code) : ean13Modules(ean.code)
    const barsW = modules.length * MODULE
    const bx = x + (LAB_W - barsW) / 2
    const by = y + 14
    doc.setFillColor(0, 0, 0)
    let run = 0
    for (let m = 0; m <= modules.length; m++) {
      if (m < modules.length && modules[m] === '1') { run++; continue }
      if (run > 0) doc.rect(bx + (m - run) * MODULE, by, run * MODULE, BAR_H, 'F')
      run = 0
    }

    // human-readable digits
    font(8.5); doc.setTextColor(30, 30, 30)
    doc.text(ean.code.split('').join(' '), x + LAB_W / 2, by + BAR_H + 4.2, { align: 'center' })
  })

  doc.setProperties({ title: `${storeName} — Barcode Labels ${format(new Date(), 'yyyy-MM-dd')}`, subject: 'Barcode label sheet', creator: 'ARTech POS' })
  return doc
}

export const barcodeSheetFilename = () => `Barcode-Labels-${format(new Date(), 'yyyy-MM-dd')}.pdf`

export async function buildBarcodeSheetPdf(items: LabelItem[], storeName: string): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  return renderBarcodeSheet(doc, items, storeName)
}
