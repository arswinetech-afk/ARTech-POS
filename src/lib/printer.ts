import { create } from 'zustand'
import type { Sale, SaleReturn, Store } from './types'
import { fmtDateTime } from './format'

/* ============================================================================
 *  ESC/POS receipt builder + Web Bluetooth (BLE) transport
 *  Works with the common generic 58mm / 80mm Bluetooth thermal printers
 *  (Goojprt, Xprinter, Zjiang, MUNBYN, POS-5805, etc.) on Chrome for Android
 *  and desktop Chrome/Edge.
 * ==========================================================================*/

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

export const PAPER = {
  58: { cols: 32, dots: 384 },
  80: { cols: 48, dots: 576 },
} as const

export type PaperWidth = keyof typeof PAPER

const enc = new TextEncoder()
/** Printers speak CP437-ish ASCII – swap the peso sign and strip other non-ASCII. */
const ascii = (s: string) => s.replace(/₱/g, 'P').normalize('NFKD').replace(/[^\x20-\x7e]/g, '')

export class Receipt {
  private parts: Uint8Array[] = []
  constructor(public cols: number) { this.raw([ESC, 0x40]) } // initialise

  raw(bytes: number[] | Uint8Array) { this.parts.push(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)); return this }
  align(a: 'left' | 'center' | 'right') { return this.raw([ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2]) }
  bold(on: boolean) { return this.raw([ESC, 0x45, on ? 1 : 0]) }
  size(w: 1 | 2, h: 1 | 2) { return this.raw([GS, 0x21, ((w - 1) << 4) | (h - 1)]) }
  feed(n = 1) { return this.raw([ESC, 0x64, n]) }
  cut() { return this.raw([GS, 0x56, 0x42, 0x00]) }
  text(s: string, opts: { align?: 'left' | 'center' | 'right'; bold?: boolean; size?: 1 | 2 } = {}) {
    if (opts.align) this.align(opts.align)
    if (opts.bold) this.bold(true)
    if (opts.size === 2) this.size(2, 2)
    const width = opts.size === 2 ? Math.floor(this.cols / 2) : this.cols
    for (const line of wrap(ascii(s), width)) this.raw(enc.encode(line)).raw([LF])
    if (opts.size === 2) this.size(1, 1)
    if (opts.bold) this.bold(false)
    if (opts.align && opts.align !== 'left') this.align('left')
    return this
  }
  line(ch = '-') { return this.text(ch.repeat(this.cols)) }
  /** Two columns – left text wraps, right column is right-aligned on the last line. */
  row(left: string, right: string, opts: { bold?: boolean } = {}) {
    const r = ascii(right)
    const leftWidth = this.cols - r.length - 1
    const lines = wrap(ascii(left), Math.max(1, leftWidth))
    if (opts.bold) this.bold(true)
    lines.forEach((l, i) => {
      const last = i === lines.length - 1
      const s = last ? l.padEnd(leftWidth) + ' ' + r : l
      this.raw(enc.encode(s)).raw([LF])
    })
    if (opts.bold) this.bold(false)
    return this
  }
  /** 3-column item line: name | qty x price | amount */
  item(name: string, qty: number, price: number, amount: string) {
    const right = amount
    const mid = `${fmtQty(qty)} x ${price.toFixed(2)}`
    const first = wrap(ascii(name), this.cols)
    first.forEach((l) => this.raw(enc.encode(l)).raw([LF]))
    const pad = this.cols - mid.length - right.length
    this.raw(enc.encode('  ' + mid + ' '.repeat(Math.max(1, pad - 2)) + right)).raw([LF])
    return this
  }
  /** Monochrome raster image (GS v 0). `mono` is packed 1bpp rows. */
  image(mono: { width: number; height: number; data: Uint8Array }) {
    const bytesPerRow = Math.ceil(mono.width / 8)
    this.align('center')
    this.raw([GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, mono.height & 0xff, mono.height >> 8])
    this.raw(mono.data)
    this.align('left')
    return this
  }
  bytes(): Uint8Array {
    const len = this.parts.reduce((s, p) => s + p.length, 0)
    const out = new Uint8Array(len)
    let o = 0
    for (const p of this.parts) { out.set(p, o); o += p.length }
    return out
  }
}

function wrap(s: string, width: number): string[] {
  if (!s) return ['']
  const out: string[] = []
  for (const para of s.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      if (word.length > width) {
        if (line) { out.push(line); line = '' }
        for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width))
        continue
      }
      if ((line + (line ? ' ' : '') + word).length > width) { out.push(line); line = word }
      else line = line ? line + ' ' + word : word
    }
    out.push(line)
  }
  return out
}
const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(2))
const money = (n: number) => n.toFixed(2)
/** "Discount (SC/PWD 20%)" when the sale note carries a discount label, else "Discount". */
export const parseDiscountLabel = (note: string | null | undefined) => { const m = /^Discount: ([^·\n]+)/.exec(note || ''); return m ? m[1].trim() : '' }
const discountLabel = (sale: Sale) => { const l = parseDiscountLabel(sale.note); return l ? `Discount (${l.slice(0, 14)})` : 'Discount' }

/* ---------------------------------------------------------------- logo → 1bpp */
export async function logoToMono(dataUrl: string, maxDots: number): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl })
    const width = Math.min(maxDots, 200)
    const height = Math.max(1, Math.round((img.height / img.width) * width))
    const c = document.createElement('canvas'); c.width = width; c.height = height
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const { data } = ctx.getImageData(0, 0, width, height)
    // grayscale + Floyd–Steinberg dithering
    const gray = new Float32Array(width * height)
    for (let i = 0; i < width * height; i++) {
      const a = data[i * 4 + 3] / 255
      const l = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * a + 255 * (1 - a)
      gray[i] = l
    }
    const bpr = Math.ceil(width / 8)
    const out = new Uint8Array(bpr * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x
      const old = gray[i]
      const nw = old < 128 ? 0 : 255
      const err = old - nw
      if (nw === 0) out[y * bpr + (x >> 3)] |= 0x80 >> (x & 7)
      if (x + 1 < width) gray[i + 1] += (err * 7) / 16
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += (err * 3) / 16
        gray[i + width] += (err * 5) / 16
        if (x + 1 < width) gray[i + width + 1] += (err * 1) / 16
      }
    }
    return { width: bpr * 8, height, data: out }
  } catch { return null }
}

/* ------------------------------------------------------------- build receipt */
export async function buildReceipt(store: Store, sale: Sale, opts: { paper?: PaperWidth; cols?: number; logo?: boolean; balance?: number | null; cashier?: string | null; reprint?: boolean } = {}) {
  const paper = (opts.paper ?? (store.paper_width as PaperWidth)) in PAPER ? (opts.paper ?? (store.paper_width as PaperWidth)) : 58
  const cols = opts.cols ?? PAPER[paper].cols
  const r = new Receipt(cols)

  if ((opts.logo ?? store.print_logo) && store.logo_data) {
    const mono = await logoToMono(store.logo_data, PAPER[paper].dots)
    if (mono) r.image(mono).feed(1)
  }
  r.text(store.name, { align: 'center', bold: true, size: cols >= 48 ? 2 : 1 })
  if (store.address) r.text(store.address, { align: 'center' })
  if (store.owner_name) r.text(store.owner_name, { align: 'center' })
  if (store.contact) r.text(store.contact, { align: 'center' })
  if (store.tin) r.text(`TIN: ${store.tin}`, { align: 'center' })
  r.text('powered by ARTech POS', { align: 'center' })
  r.line()
  r.row(`Txn # ${sale.txn_no}`, sale.status === 'void' ? '*VOID*' : opts.reprint ? 'REPRINT' : '')
  r.text(fmtDateTime(sale.created_at))
  if (opts.cashier) r.text(`Cashier: ${opts.cashier}`)
  if (sale.customer_name) r.text(`Customer: ${sale.customer_name}`)
  r.line()
  for (const it of sale.items) r.item(it.name, it.qty, it.price, money(it.qty * it.price))
  r.line()
  const qty = sale.items.reduce((s, i) => s + i.qty, 0)
  r.row(`Items: ${fmtQty(qty)}`, '')
  r.row('Subtotal', money(sale.subtotal))
  if (sale.discount > 0) r.row(discountLabel(sale), '-' + money(sale.discount))
  r.size(1, 2).row('TOTAL', money(sale.total), { bold: true }).size(1, 1)
  const method = sale.payment_method.toUpperCase()
  if (sale.payment_method === 'credit') {
    r.row('Payment', 'CREDIT (UTANG)')
    if (sale.amount_paid) r.row('Partial paid', money(sale.amount_paid))
    r.row('Added to balance', money(sale.total - (sale.amount_paid || 0)))
    if (opts.balance != null) r.row('Total balance', money(opts.balance), { bold: true })
  } else {
    r.row(method, money(sale.amount_paid ?? sale.total))
    r.row('Change', money(sale.change_due ?? 0))
  }
  if (Number(sale.refunded_total || 0) > 0) r.row('Refunded (returns)', '-' + money(Number(sale.refunded_total)))
  r.line()
  if (store.receipt_footer) r.text(store.receipt_footer, { align: 'center' })
  r.text('This serves as your receipt.', { align: 'center' })
  r.feed(3).cut()
  return r.bytes()
}

/* ---------------------------------------------------------- BLE transport */
const KNOWN_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb', '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb', '38eb4a80-c570-11e3-9507-0002a5d5c51b',
]

interface PrinterState {
  supported: boolean
  device: BluetoothDevice | null
  characteristic: BluetoothRemoteGATTCharacteristic | null
  name: string | null
  connected: boolean
  busy: boolean
  connect: () => Promise<void>
  disconnect: () => void
  print: (bytes: Uint8Array) => Promise<void>
}

export const usePrinter = create<PrinterState>((set, get) => ({
  supported: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
  device: null, characteristic: null, name: localStorage.getItem('artech-printer-name'), connected: false, busy: false,

  connect: async () => {
    if (!get().supported) throw new Error('Bluetooth is not available in this browser. Use Chrome on Android or desktop.')
    set({ busy: true })
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: KNOWN_SERVICES })
      const server = await device.gatt!.connect()
      const services = await server.getPrimaryServices()
      let chosen: BluetoothRemoteGATTCharacteristic | null = null
      for (const s of services) {
        const chars = await s.getCharacteristics()
        const c = chars.find((x) => x.properties.writeWithoutResponse) || chars.find((x) => x.properties.write)
        if (c) { chosen = c; break }
      }
      if (!chosen) throw new Error('No writable characteristic found – is this a printer?')
      device.addEventListener('gattserverdisconnected', () => set({ connected: false, characteristic: null }))
      localStorage.setItem('artech-printer-name', device.name || 'Printer')
      set({ device, characteristic: chosen, name: device.name || 'Printer', connected: true })
    } finally { set({ busy: false }) }
  },

  disconnect: () => {
    get().device?.gatt?.disconnect()
    set({ connected: false, characteristic: null })
  },

  print: async (bytes) => {
    let ch = get().characteristic
    if (!ch || !get().connected) {
      const d = get().device
      if (d?.gatt) {
        const server = await d.gatt.connect()
        const services = await server.getPrimaryServices()
        for (const s of services) {
          const chars = await s.getCharacteristics()
          const c = chars.find((x) => x.properties.writeWithoutResponse) || chars.find((x) => x.properties.write)
          if (c) { ch = c; break }
        }
        if (ch) set({ characteristic: ch, connected: true })
      }
      if (!ch) throw new Error('Printer not connected. Tap Connect first.')
    }
    set({ busy: true })
    try {
      const CHUNK = 120
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.slice(i, i + CHUNK)
        if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(slice)
        else await ch.writeValue(slice)
        await new Promise((r) => setTimeout(r, 18))
      }
    } finally { set({ busy: false }) }
  },
}))

/** Plain-text preview of the receipt (also used for the on-screen preview / share). */
export function receiptText(store: Store, sale: Sale, cols = 32, extra: { balance?: number | null } = {}) {
  const c = (s: string) => s.length >= cols ? s : ' '.repeat(Math.floor((cols - s.length) / 2)) + s
  const row = (l: string, r: string) => l.padEnd(cols - r.length - 1) + ' ' + r
  const L: string[] = []
  L.push(c(store.name))
  if (store.address) L.push(c(store.address))
  if (store.owner_name) L.push(c(store.owner_name))
  if (store.contact) L.push(c(store.contact))
  if (store.tin) L.push(c(`TIN: ${store.tin}`))
  L.push(c('powered by ARTech POS'), '-'.repeat(cols))
  L.push(row(`Txn # ${sale.txn_no}`, sale.status === 'void' ? '*VOID*' : ''), fmtDateTime(sale.created_at))
  if (sale.cashier_name) L.push(`Cashier: ${sale.cashier_name}`)
  if (sale.customer_name) L.push(`Customer: ${sale.customer_name}`)
  L.push('-'.repeat(cols))
  for (const it of sale.items) {
    L.push(it.name.slice(0, cols))
    const mid = `${fmtQty(it.qty)} x ${it.price.toFixed(2)}`
    const amt = money(it.qty * it.price)
    L.push('  ' + mid + ' '.repeat(Math.max(1, cols - mid.length - amt.length - 2)) + amt)
  }
  L.push('-'.repeat(cols))
  L.push(row('Subtotal', money(sale.subtotal)))
  if (sale.discount > 0) L.push(row(discountLabel(sale), '-' + money(sale.discount)))
  L.push(row('TOTAL', money(sale.total)))
  if (sale.payment_method === 'credit') {
    L.push(row('Payment', 'CREDIT (UTANG)'))
    if (sale.amount_paid) L.push(row('Partial paid', money(Math.min(Number(sale.amount_paid), Number(sale.total)))))
    L.push(row('Added to balance', money(Math.max(0, Number(sale.total) - Number(sale.amount_paid || 0)))))
    if (extra.balance != null) L.push(row('Total balance', money(extra.balance)))
  } else {
    L.push(row(sale.payment_method.toUpperCase(), money(sale.amount_paid ?? sale.total)))
    L.push(row('Change', money(sale.change_due ?? 0)))
  }
  if (Number(sale.refunded_total || 0) > 0) L.push(row('Refunded (returns)', '-' + money(Number(sale.refunded_total))))
  L.push('-'.repeat(cols))
  if (store.receipt_footer) L.push(c(store.receipt_footer))
  return L.map((l) => l.replace(/₱/g, 'P')).join('\n')
}

/* ------------------------------------------------------------ refund slip (2.3) */
const refundVia = (ret: SaleReturn) => {
  const parts: string[] = []
  if (ret.refund_credit > 0) parts.push(`${money(ret.refund_credit)} off utang balance`)
  if (ret.refund_cash > 0 || parts.length === 0) parts.push(`${money(ret.refund_cash)} ${ret.refund_method === 'gcash' ? 'GCash' : 'cash'}`)
  return parts.join(' + ')
}

export function returnSlipText(store: Store, ret: SaleReturn, cols = 32) {
  const c = (s: string) => s.length >= cols ? s : ' '.repeat(Math.floor((cols - s.length) / 2)) + s
  const row = (l: string, r: string) => l.padEnd(cols - r.length - 1) + ' ' + r
  const L: string[] = []
  L.push(c(store.name))
  if (store.address) L.push(c(store.address))
  if (store.contact) L.push(c(store.contact))
  L.push('-'.repeat(cols), c('*** REFUND SLIP ***'), '-'.repeat(cols))
  L.push(row(`Return # ${ret.ret_no}`, ''), row(`For sale # ${ret.sale_txn_no || ''}`, ''), fmtDateTime(ret.created_at))
  if (ret.cashier_name) L.push(`Cashier: ${ret.cashier_name}`)
  if (ret.customer_name) L.push(`Customer: ${ret.customer_name}`)
  if (ret.reason) L.push(...wrap(`Reason: ${ret.reason}`, cols))
  L.push('-'.repeat(cols))
  for (const it of ret.items) {
    L.push(it.name.slice(0, cols) + (it.restock ? '' : ' (not restocked)'))
    const mid = `${fmtQty(it.qty)} x ${it.price.toFixed(2)}`
    const amt = money(it.qty * it.price)
    L.push('  ' + mid + ' '.repeat(Math.max(1, cols - mid.length - amt.length - 2)) + amt)
  }
  L.push('-'.repeat(cols))
  L.push(row('Items', money(ret.gross)))
  if (ret.discount_share > 0) L.push(row('Less discount share', '-' + money(ret.discount_share)))
  L.push(row('REFUND', money(ret.refund_total)))
  L.push(...wrap(`Refunded: ${refundVia(ret)}`, cols))
  L.push('-'.repeat(cols), c('Thank you!'))
  return L.map((l) => l.replace(/₱/g, 'P')).join('\n')
}

export async function buildReturnSlip(store: Store, ret: SaleReturn, opts: { paper?: PaperWidth; cols?: number; logo?: boolean } = {}) {
  const paper = (opts.paper ?? (store.paper_width as PaperWidth)) in PAPER ? (opts.paper ?? (store.paper_width as PaperWidth)) : 58
  const cols = opts.cols ?? PAPER[paper].cols
  const r = new Receipt(cols)
  if ((opts.logo ?? store.print_logo) && store.logo_data) {
    const mono = await logoToMono(store.logo_data, PAPER[paper].dots)
    if (mono) r.image(mono).feed(1)
  }
  r.text(store.name, { align: 'center', bold: true, size: cols >= 48 ? 2 : 1 })
  if (store.address) r.text(store.address, { align: 'center' })
  if (store.contact) r.text(store.contact, { align: 'center' })
  r.line().text('*** REFUND SLIP ***', { align: 'center', bold: true }).line()
  r.row(`Return # ${ret.ret_no}`, '').row(`For sale # ${ret.sale_txn_no || ''}`, '').text(fmtDateTime(ret.created_at))
  if (ret.cashier_name) r.text(`Cashier: ${ret.cashier_name}`)
  if (ret.customer_name) r.text(`Customer: ${ret.customer_name}`)
  if (ret.reason) r.text(`Reason: ${ret.reason}`)
  r.line()
  for (const it of ret.items) r.item(it.name + (it.restock ? '' : ' (not restocked)'), it.qty, it.price, money(it.qty * it.price))
  r.line()
  r.row('Items', money(ret.gross))
  if (ret.discount_share > 0) r.row('Less discount share', '-' + money(ret.discount_share))
  r.size(1, 2).row('REFUND', money(ret.refund_total), { bold: true }).size(1, 1)
  r.text(`Refunded: ${refundVia(ret)}`)
  r.line().text('Thank you!', { align: 'center' })
  r.feed(3).cut()
  return r.bytes()
}
