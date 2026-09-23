import Papa from 'papaparse'
import { db } from './db'
import { uuid, nowISO } from './ids'
import { round2 } from './format'
import { supabase, isOnline } from './supabase'
import { requestPush } from './sync'
import type { Credit, Customer, Product, Sale, SaleItem, Store, PaymentMethod } from './types'

export type ImportType = 'products' | 'credits' | 'sales' | 'unknown'

export interface ParsedCSV { type: ImportType; headers: string[]; rows: Record<string, string>[]; fileName: string }

export interface ImportPlan {
  type: ImportType
  products: Product[]
  customers: Customer[]
  credits: Credit[]
  sales: Sale[]
  skipped: number
  warnings: string[]
  stats: Record<string, number | string>
}

const norm = (s: string | undefined | null) => (s ?? '').toString().trim()
const key = (s: string | undefined | null) => norm(s).toLowerCase()
const numOr0 = (s: string | undefined | null) => { const n = parseFloat(norm(s).replace(/[₱,]/g, '')); return Number.isFinite(n) ? n : 0 }
const isoUTC = (s: string) => {
  const t = norm(s)
  if (!t) return nowISO()
  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/i.test(t)
  const d = new Date(hasTz ? t : t + 'Z')
  return Number.isNaN(d.getTime()) ? nowISO() : d.toISOString()
}

/** Detect which of the 3 export formats a file is, from its header row. */
export function detectType(headers: string[]): ImportType {
  const h = headers.map(key)
  if (h.includes('selling price') || (h.includes('name') && h.includes('stock'))) return 'products'
  if (h.includes('total debt') || (h.includes('customer') && h.includes('settled'))) return 'credits'
  if (h.includes('transaction #') || (h.includes('items') && h.includes('total amount'))) return 'sales'
  return 'unknown'
}

export function parseCSVText(text: string, fileName: string): ParsedCSV {
  const res = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), {
    header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.replace(/^\ufeff/, '').trim(),
  })
  const headers = res.meta.fields || []
  return { type: detectType(headers), headers, rows: res.data, fileName }
}

export async function parseCSV(file: File): Promise<ParsedCSV> {
  const text = await file.text()
  return parseCSVText(text, file.name)
}

interface BuildOpts { skipExisting: boolean; mergeDuplicateNames: boolean }

export async function buildPlan(store: Store, parsed: ParsedCSV, opts: BuildOpts): Promise<ImportPlan> {
  const plan: ImportPlan = { type: parsed.type, products: [], customers: [], credits: [], sales: [], skipped: 0, warnings: [], stats: {} }
  const now = nowISO()
  const existingProducts = await db.products.where('store_id').equals(store.id).toArray()
  const existingCustomers = await db.customers.where('store_id').equals(store.id).toArray()

  if (parsed.type === 'products') {
    const byName = new Map(existingProducts.map((p) => [key(p.name), p]))
    const seen = new Map<string, Product>()
    let dupBarcode = 0
    const barcodes = new Set<string>()
    for (const r of parsed.rows) {
      const name = norm(r['Name'] ?? r['name'])
      if (!name) { plan.skipped++; continue }
      if (opts.skipExisting && byName.has(key(name))) { plan.skipped++; continue }
      const barcode = norm(r['Barcode'] ?? r['barcode']) || null
      if (barcode) { if (barcodes.has(barcode)) dupBarcode++; barcodes.add(barcode) }
      const row: Product = {
        id: uuid(), store_id: store.id, name, barcode, category: norm(r['Category'] ?? r['category']) || null,
        cost: round2(numOr0(r['Purchase Price'] ?? r['cost'])), price: round2(numOr0(r['Selling Price'] ?? r['price'])),
        stock: numOr0(r['Stock'] ?? r['stock']), unit: norm(r['Unit'] ?? r['unit']) || null,
        description: norm(r['Description'] ?? r['description']) || null, low_stock_at: null, is_active: true,
        created_at: now, updated_at: now, deleted_at: null,
      }
      if (opts.mergeDuplicateNames && seen.has(key(name))) {
        const prev = seen.get(key(name))!
        prev.stock += row.stock
        if (!prev.barcode && row.barcode) prev.barcode = row.barcode
        if (!prev.cost && row.cost) prev.cost = row.cost
        plan.skipped++
        continue
      }
      seen.set(key(name), row)
      plan.products.push(row)
    }
    plan.stats = {
      products: plan.products.length, 'with barcode': plan.products.filter((p) => p.barcode).length,
      'out of stock': plan.products.filter((p) => p.stock <= 0).length,
      'inventory value': round2(plan.products.reduce((s, p) => s + p.cost * p.stock, 0)),
    }
    if (dupBarcode) plan.warnings.push(`${dupBarcode} barcode(s) appear more than once – the scanner will ask you to pick the right item.`)
    return plan
  }

  if (parsed.type === 'credits') {
    const custMap = new Map(existingCustomers.map((c) => [key(c.name), c]))
    const existingCredits = await db.credits.where('store_id').equals(store.id).toArray()
    const dupKey = new Set(existingCredits.map((c) => `${c.customer_id}|${c.amount}|${c.created_at}`))
    for (const r of parsed.rows) {
      const name = norm(r['Customer'] ?? r['customer'])
      if (!name) { plan.skipped++; continue }
      let cust = custMap.get(key(name))
      if (!cust) {
        cust = { id: uuid(), store_id: store.id, name, phone: norm(r['Phone']) || null, notes: null, created_at: now, updated_at: now, deleted_at: null }
        custMap.set(key(name), cust)
        plan.customers.push(cust)
      } else if (!cust.phone && norm(r['Phone'])) {
        cust.phone = norm(r['Phone'])
      }
      const amount = round2(numOr0(r['Total Debt'] ?? r['amount']))
      const paid = round2(numOr0(r['Amount Paid'] ?? r['paid']))
      const settled = key(r['Settled']) === 'true' || (paid >= amount && amount > 0)
      const created_at = isoUTC(r['Created'] ?? r['created_at'])
      if (opts.skipExisting && dupKey.has(`${cust.id}|${amount}|${created_at}`)) { plan.skipped++; continue }
      plan.credits.push({
        id: uuid(), store_id: store.id, customer_id: cust.id, sale_id: null, amount, paid, settled,
        notes: norm(r['Notes']) || null, created_at, updated_at: now, deleted_at: null,
      })
    }
    const open = plan.credits.filter((c) => !c.settled)
    plan.stats = {
      customers: plan.customers.length, 'credit records': plan.credits.length, unpaid: open.length,
      'outstanding balance': round2(open.reduce((s, c) => s + c.amount - c.paid, 0)),
    }
    return plan
  }

  if (parsed.type === 'sales') {
    const prodByName = new Map<string, Product>()
    for (const p of existingProducts) if (!prodByName.has(key(p.name))) prodByName.set(key(p.name), p)
    const custMap = new Map(existingCustomers.map((c) => [key(c.name), c]))
    const existingTxn = new Set((await db.sales.where('store_id').equals(store.id).toArray()).map((s) => s.txn_no))
    let unmatched = 0
    const itemRe = /^(.*?)\s+x(\d+(?:\.\d+)?)$/i
    for (const r of parsed.rows) {
      const txn = norm(r['Transaction #'] ?? r['txn_no'])
      if (!txn) { plan.skipped++; continue }
      if (opts.skipExisting && existingTxn.has(txn)) { plan.skipped++; continue }
      const total = round2(numOr0(r['Total Amount'] ?? r['total']))
      const discount = round2(numOr0(r['Discount']))
      const subtotal = round2(total + discount)
      const rawItems = norm(r['Items']).split(/;\s*/).filter(Boolean)
      const items: SaleItem[] = rawItems.map((s) => {
        const m = s.match(itemRe)
        const name = m ? m[1].trim() : s.trim()
        const qty = m ? parseFloat(m[2]) : 1
        const p = prodByName.get(key(name))
        if (!p) unmatched++
        return { product_id: p?.id ?? null, name: p?.name ?? name, qty, price: p ? Number(p.price) : NaN, cost: p ? Number(p.cost) : 0, unit: p?.unit ?? null }
      })
      // Reconcile line prices with the transaction total (prices may have changed since).
      const known = items.filter((i) => Number.isFinite(i.price))
      const unknown = items.filter((i) => !Number.isFinite(i.price))
      const knownSum = known.reduce((s, i) => s + i.qty * i.price, 0)
      if (unknown.length) {
        const rem = Math.max(0, subtotal - knownSum)
        const q = unknown.reduce((s, i) => s + i.qty, 0) || 1
        for (const i of unknown) i.price = round2(rem / q)
      }
      const sum = items.reduce((s, i) => s + i.qty * i.price, 0)
      if (sum > 0 && Math.abs(sum - subtotal) > 0.01) {
        const f = subtotal / sum
        for (const i of items) i.price = round2(i.price * f)
      }
      const cost_total = round2(items.reduce((s, i) => s + i.qty * (i.cost || 0), 0))
      const profitRaw = norm(r['Profit'])
      const statusRaw = key(r['Status'])
      const status: Sale['status'] = /void|cancel|delete/.test(statusRaw) ? 'void' : 'active'
      const pmRaw = key(r['Payment'] ?? r['payment_method']) || 'cash'
      const payment_method = (['cash', 'gcash', 'credit', 'card', 'other'].includes(pmRaw) ? pmRaw : pmRaw.includes('credit') || pmRaw.includes('utang') ? 'credit' : 'other') as PaymentMethod
      const custName = norm(r['Customer']) || null
      const cust = custName ? custMap.get(key(custName)) : undefined
      plan.sales.push({
        id: uuid(), store_id: store.id, txn_no: txn, items, subtotal, discount, total, cost_total,
        profit: profitRaw ? round2(numOr0(profitRaw)) : round2(total - cost_total),
        payment_method, customer_id: cust?.id ?? null, customer_name: cust?.name ?? custName,
        amount_paid: payment_method === 'credit' ? 0 : total, change_due: 0, status,
        note: statusRaw && statusRaw !== 'active' ? `Imported (${statusRaw})` : 'Imported',
        created_by: null, created_at: isoUTC(r['Date'] ?? r['created_at']), updated_at: now,
      })
    }
    const active = plan.sales.filter((s) => s.status === 'active')
    plan.stats = {
      transactions: plan.sales.length, 'gross sales': round2(active.reduce((s, x) => s + x.total, 0)),
      'credit sales': active.filter((s) => s.payment_method === 'credit').length,
      'line items': plan.sales.reduce((s, x) => s + x.items.length, 0),
      'date range': plan.sales.length ? `${plan.sales.reduce((a, s) => (s.created_at < a ? s.created_at : a), plan.sales[0].created_at).slice(0, 10)} → ${plan.sales.reduce((a, s) => (s.created_at > a ? s.created_at : a), plan.sales[0].created_at).slice(0, 10)}` : '—',
    }
    if (unmatched) plan.warnings.push(`${unmatched} line item(s) did not match a product name – they are kept as text only. Import products first for best results.`)
    plan.warnings.push('Imported sales never change your stock levels (your product file already holds current stock).')
    return plan
  }
  plan.warnings.push('Unrecognised file. Expected columns from ARTech POS exports: products, credits or sales.')
  return plan
}

const CHUNK = 250

async function sendRows(table: string, rows: object[], onProgress?: (done: number, total: number) => void) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    if (isOnline()) {
      const { error } = await supabase.rpc('import_rows', { p_table: table, p_rows: chunk })
      if (error) {
        if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(error.message)) {
          await db.outbox.add({ kind: 'rpc', rpc: 'import_rows', id: uuid(), payload: { p_table: table, p_rows: chunk }, created_at: nowISO(), attempts: 0, error: null })
        } else throw error
      }
    } else {
      await db.outbox.add({ kind: 'rpc', rpc: 'import_rows', id: uuid(), payload: { p_table: table, p_rows: chunk }, created_at: nowISO(), attempts: 0, error: null })
    }
    onProgress?.(Math.min(i + CHUNK, rows.length), rows.length)
  }
}

/** Write locally (instant) then upload in chunks (or queue when offline). */
export async function commitPlan(plan: ImportPlan, onProgress?: (msg: string) => void) {
  if (plan.customers.length) {
    await db.customers.bulkPut(plan.customers)
    await sendRows('customers', plan.customers, (d, t) => onProgress?.(`Customers ${d}/${t}`))
  }
  if (plan.products.length) {
    await db.products.bulkPut(plan.products)
    await sendRows('products', plan.products, (d, t) => onProgress?.(`Products ${d}/${t}`))
  }
  if (plan.credits.length) {
    await db.credits.bulkPut(plan.credits)
    await sendRows('credits', plan.credits, (d, t) => onProgress?.(`Credits ${d}/${t}`))
  }
  if (plan.sales.length) {
    await db.sales.bulkPut(plan.sales)
    await sendRows('sales', plan.sales, (d, t) => onProgress?.(`Sales ${d}/${t}`))
  }
  requestPush(300)
}
