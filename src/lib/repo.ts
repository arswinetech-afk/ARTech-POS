import { db } from './db'
import { uuid, nowISO, txnNo } from './ids'
import { round2 } from './format'
import { requestPush } from './sync'
import { useAppStore } from '../store/app'
import type {
  Credit, CreditPayment, Customer, Expense, PaymentMethod, Product, RefundMethod, Reminder, ReturnItem, Sale, SaleItem, SaleReturn, StockMovement, Store,
} from './types'

/**
 * Every write goes to IndexedDB first (instant, works offline) and is queued in
 * the outbox. The sync engine replays the outbox to Supabase in order.
 */

async function queueUpsert(table: string, id: string, payload: Record<string, unknown>) {
  await db.outbox.add({ kind: 'upsert', table, id, payload, created_at: nowISO(), attempts: 0, error: null })
  requestPush()
}
async function queueRpc(rpc: string, id: string, payload: Record<string, unknown>) {
  await db.outbox.add({ kind: 'rpc', rpc, id, payload, created_at: nowISO(), attempts: 0, error: null })
  requestPush()
}

/** Who is using this device right now (recorded on every row we create). */
const currentUserId = () => useAppStore.getState().profile?.id ?? null
const currentUserName = () => { const p = useAppStore.getState().profile; return p ? (p.full_name?.trim() || p.email.split('@')[0]) : null }
const stamp = () => { const t = nowISO(); return { created_at: t, updated_at: t, deleted_at: null, created_by: currentUserId() } }
const strip = <T extends object>(row: T, keys: string[]) => {
  const c: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  for (const k of keys) delete c[k]
  return c
}

/* ------------------------------------------------------------------ */
/* PRODUCTS                                                            */
/* ------------------------------------------------------------------ */
export type ProductInput = Pick<Product, 'name'> & Partial<Omit<Product, 'id' | 'store_id' | 'created_at' | 'updated_at' | 'deleted_at'>>

export async function createProduct(store: Store, input: ProductInput): Promise<Product> {
  const row: Product = {
    id: uuid(), store_id: store.id, name: input.name.trim(), barcode: input.barcode?.trim() || null,
    category: input.category || null, cost: round2(Number(input.cost || 0)), price: round2(Number(input.price || 0)),
    stock: Number(input.stock || 0), unit: input.unit || null, description: input.description || null,
    low_stock_at: input.low_stock_at ?? null, is_active: input.is_active ?? true, ...stamp(),
  }
  await db.products.put(row)
  await queueUpsert('products', row.id, row as unknown as Record<string, unknown>)
  return row
}

/** Edits never send `stock` – stock only changes through relative adjustments. */
export async function updateProduct(existing: Product, patch: Partial<Product>): Promise<Product> {
  const row: Product = { ...existing, ...patch, updated_at: nowISO() }
  delete (patch as Partial<Product>).stock
  await db.products.put(row)
  await queueUpsert('products', row.id, strip(row, ['stock']))
  return row
}

export async function deleteProduct(p: Product) {
  const row = { ...p, deleted_at: nowISO(), updated_at: nowISO() }
  await db.products.delete(p.id)
  await queueUpsert('products', p.id, strip(row, ['stock']))
}

export async function adjustStock(store: Store, p: Product, delta: number, opts: { type?: StockMovement['type']; unit_cost?: number | null; note?: string; update_cost?: boolean } = {}) {
  if (!delta) return
  const mv: StockMovement = {
    id: uuid(), store_id: store.id, product_id: p.id, qty: delta, type: opts.type || 'adjustment',
    unit_cost: opts.unit_cost ?? null, note: opts.note || null, ...stamp(),
  }
  const next: Product = { ...p, stock: Number(p.stock) + delta, updated_at: nowISO() }
  if (opts.update_cost && opts.unit_cost != null) next.cost = round2(opts.unit_cost)
  await db.transaction('rw', db.products, db.stock_movements, async () => {
    await db.products.put(next)
    await db.stock_movements.put(mv)
  })
  await queueRpc('adjust_stock', mv.id, {
    p: { id: mv.id, store_id: store.id, product_id: p.id, qty: delta, type: mv.type, unit_cost: mv.unit_cost, note: mv.note, update_cost: !!opts.update_cost, created_at: mv.created_at },
  })
  return next
}

/* ------------------------------------------------------------------ */
/* CUSTOMERS & CREDITS                                                 */
/* ------------------------------------------------------------------ */
export async function createCustomer(store: Store, name: string, phone?: string | null, notes?: string | null): Promise<Customer> {
  const row: Customer = { id: uuid(), store_id: store.id, name: name.trim(), phone: phone?.trim() || null, notes: notes || null, ...stamp() }
  await db.customers.put(row)
  await queueUpsert('customers', row.id, row as unknown as Record<string, unknown>)
  return row
}

export async function updateCustomer(c: Customer, patch: Partial<Customer>) {
  const row = { ...c, ...patch, updated_at: nowISO() }
  await db.customers.put(row)
  await queueUpsert('customers', row.id, row as unknown as Record<string, unknown>)
  return row
}

export async function findOrCreateCustomer(store: Store, name: string): Promise<Customer> {
  const key = name.trim().toLowerCase()
  const all = await db.customers.where('store_id').equals(store.id).toArray()
  const hit = all.find((c) => c.name.trim().toLowerCase() === key)
  return hit ?? createCustomer(store, name)
}

export async function addCredit(store: Store, customer: Customer, amount: number, notes?: string): Promise<Credit> {
  const row: Credit = { id: uuid(), store_id: store.id, customer_id: customer.id, sale_id: null, amount: round2(amount), paid: 0, settled: false, notes: notes || null, ...stamp() }
  await db.credits.put(row)
  await queueUpsert('credits', row.id, row as unknown as Record<string, unknown>)
  return row
}

/** Payment is allocated oldest-first across the customer's unpaid credits (same as the server RPC). */
export async function recordCreditPayment(store: Store, customer: Customer, amount: number, method = 'cash', notes?: string) {
  const pay: CreditPayment = { id: uuid(), store_id: store.id, customer_id: customer.id, amount: round2(amount), method, notes: notes || null, ...stamp() }
  let remaining = round2(amount)
  await db.transaction('rw', db.credits, db.credit_payments, async () => {
    await db.credit_payments.put(pay)
    const open = (await db.credits.where('customer_id').equals(customer.id).toArray())
      .filter((c) => !c.settled && !c.deleted_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    for (const c of open) {
      if (remaining <= 0) break
      const due = round2(Number(c.amount) - Number(c.paid))
      const p = Math.min(remaining, due)
      await db.credits.put({ ...c, paid: round2(Number(c.paid) + p), settled: Number(c.paid) + p >= Number(c.amount) - 0.001, updated_at: nowISO() })
      remaining = round2(remaining - p)
    }
  })
  await queueRpc('record_credit_payment', pay.id, {
    p: { id: pay.id, store_id: store.id, customer_id: customer.id, amount: pay.amount, method, notes: pay.notes, created_at: pay.created_at },
  })
  return pay
}

export async function customerBalance(customerId: string) {
  const credits = await db.credits.where('customer_id').equals(customerId).toArray()
  return round2(credits.filter((c) => !c.deleted_at).reduce((s, c) => s + Number(c.amount) - Number(c.paid), 0))
}

/* ------------------------------------------------------------------ */
/* SALES                                                               */
/* ------------------------------------------------------------------ */
export interface CheckoutInput {
  items: SaleItem[]
  discount: number
  payment_method: PaymentMethod
  amount_paid: number | null
  customer?: Customer | null
  note?: string | null
}

export async function createSale(store: Store, input: CheckoutInput, createdBy: string | null): Promise<Sale> {
  const subtotal = round2(input.items.reduce((s, i) => s + i.qty * i.price, 0))
  const total = round2(Math.max(0, subtotal - (input.discount || 0)))
  const cost_total = round2(input.items.reduce((s, i) => s + i.qty * (i.cost || 0), 0))
  const paid = input.payment_method === 'credit' ? round2(input.amount_paid || 0) : round2(input.amount_paid ?? total)
  const sale: Sale = {
    id: uuid(), store_id: store.id, txn_no: txnNo(), items: input.items, subtotal, discount: round2(input.discount || 0), total,
    cost_total, profit: round2(total - cost_total), payment_method: input.payment_method,
    customer_id: input.customer?.id ?? null, customer_name: input.customer?.name ?? null,
    amount_paid: paid, change_due: input.payment_method === 'credit' ? 0 : round2(Math.max(0, paid - total)),
    status: 'active', note: input.note || null, created_by: createdBy ?? currentUserId(), cashier_name: currentUserName(), created_at: nowISO(), updated_at: nowISO(),
  }
  const creditId = input.payment_method === 'credit' && total - paid > 0 ? uuid() : null

  await db.transaction('rw', db.sales, db.products, db.credits, async () => {
    await db.sales.put(sale)
    for (const it of input.items) {
      if (!it.product_id) continue
      const p = await db.products.get(it.product_id)
      if (p) await db.products.put({ ...p, stock: Number(p.stock) - it.qty })
    }
    if (creditId && input.customer) {
      await db.credits.put({
        id: creditId, store_id: store.id, customer_id: input.customer.id, sale_id: sale.id,
        amount: round2(total - paid), paid: 0, settled: false, notes: `Sale ${sale.txn_no}`, ...stamp(),
      })
    }
  })
  await queueRpc('create_sale', sale.id, { p: { ...sale, credit_id: creditId, adjust_stock: true } })
  return sale
}

/* ------------------------------------------------------------------ */
/* RETURNS / REFUNDS (partial)                                         */
/* ------------------------------------------------------------------ */
export interface ReturnInput {
  /** qty to take back per sale line index (0 or missing = not returned) */
  lines: Array<{ line: number; qty: number; restock: boolean }>
  reason?: string | null
  refund_method: RefundMethod
}

/** Quantities already returned per sale line (from local return rows). */
export async function returnedByLine(saleId: string): Promise<Map<number, number>> {
  const rows = await db.sale_returns.where('sale_id').equals(saleId).toArray()
  const m = new Map<number, number>()
  for (const r of rows) if (!r.deleted_at) for (const it of r.items) m.set(it.line, round2((m.get(it.line) || 0) + Number(it.qty)))
  return m
}

/** Same maths as the server RPC so the slip shown offline equals what the cloud records. */
export function computeRefund(sale: Sale, lines: ReturnInput['lines']) {
  const items: ReturnItem[] = []
  let gross = 0, cost = 0, restockCost = 0
  for (const l of lines) {
    const sold = sale.items[l.line]
    const qty = round2(l.qty)
    if (!sold || qty <= 0) continue
    const restock = l.restock && !!sold.product_id
    gross += qty * Number(sold.price); cost += qty * Number(sold.cost || 0)
    if (restock) restockCost += qty * Number(sold.cost || 0)
    items.push({ line: l.line, product_id: sold.product_id, name: sold.name, unit: sold.unit ?? null, qty, price: Number(sold.price), cost: Number(sold.cost || 0), restock })
  }
  gross = round2(gross)
  const share = Number(sale.subtotal) > 0 && Number(sale.discount) > 0 ? Math.min(gross, round2(gross * Number(sale.discount) / Number(sale.subtotal))) : 0
  const refund = round2(gross - share)
  return { items, gross, discount_share: share, refund_total: refund, cost_total: round2(cost), restock_cost: round2(restockCost) }
}

export async function returnItems(store: Store, sale: Sale, input: ReturnInput): Promise<SaleReturn> {
  if (sale.status !== 'active') throw new Error('This sale was voided; nothing to return.')
  const done = await returnedByLine(sale.id)
  for (const l of input.lines) {
    const sold = sale.items[l.line]
    if (!sold) throw new Error('Unknown sale line')
    if (l.qty > Number(sold.qty) - (done.get(l.line) || 0) + 0.0005) throw new Error(`Only ${round2(Number(sold.qty) - (done.get(l.line) || 0))} of ${sold.name} can still be returned.`)
  }
  const calc = computeRefund(sale, input.lines)
  if (!calc.items.length) throw new Error('Nothing to return')
  const t = nowISO()
  const ret: SaleReturn = {
    id: uuid(), store_id: store.id, sale_id: sale.id, sale_txn_no: sale.txn_no, ret_no: 'R-' + txnNo(), ...calc,
    refund_method: input.refund_method, refund_credit: 0, refund_cash: calc.refund_total, reason: input.reason?.trim() || null,
    customer_id: sale.customer_id, customer_name: sale.customer_name, created_by: currentUserId(), cashier_name: currentUserName(),
    created_at: t, updated_at: t, deleted_at: null,
  }
  const movementIds = new Map<number, string>()
  await db.transaction('rw', db.sales, db.products, db.credits, db.stock_movements, db.sale_returns, async () => {
    for (const it of ret.items) {
      if (!it.restock || !it.product_id) continue
      const p = await db.products.get(it.product_id)
      if (p) await db.products.put({ ...p, stock: round2(Number(p.stock) + it.qty) })
      const mid = uuid(); movementIds.set(it.line, mid)
      await db.stock_movements.put({ id: mid, store_id: store.id, product_id: it.product_id, qty: it.qty, type: 'return', unit_cost: it.cost, note: `Return ${ret.ret_no} of sale ${sale.txn_no}`, ...stamp() })
    }
    // deduct from utang: this sale's credit first, then the customer's other open credits (oldest first)
    if (input.refund_method === 'credit' && sale.customer_id) {
      let remaining = ret.refund_total
      const open = (await db.credits.where('customer_id').equals(sale.customer_id).toArray())
        .filter((c) => !c.settled && !c.deleted_at)
        .sort((a, b) => Number(b.sale_id === sale.id) - Number(a.sale_id === sale.id) || a.created_at.localeCompare(b.created_at))
      for (const c of open) {
        if (remaining <= 0) break
        const pay = Math.min(remaining, round2(Number(c.amount) - Number(c.paid)))
        if (pay <= 0) continue
        const amount = round2(Number(c.amount) - pay)
        await db.credits.put({ ...c, amount, settled: Number(c.paid) >= amount - 0.001, updated_at: t })
        remaining = round2(remaining - pay)
      }
      ret.refund_credit = round2(ret.refund_total - remaining)
      ret.refund_cash = round2(remaining)
    }
    await db.sale_returns.put(ret)
    await db.sales.put({ ...sale, refunded_total: round2(Number(sale.refunded_total || 0) + ret.refund_total), updated_at: t })
  })
  await queueRpc('return_items', ret.id, {
    p: {
      id: ret.id, store_id: store.id, sale_id: sale.id, ret_no: ret.ret_no, reason: ret.reason, refund_method: ret.refund_method,
      cashier_name: ret.cashier_name, created_at: ret.created_at,
      items: ret.items.map((it) => ({ line: it.line, qty: it.qty, restock: it.restock, movement_id: movementIds.get(it.line) || null })),
    },
  })
  return ret
}

export async function voidSale(sale: Sale, reason?: string) {
  if (sale.status === 'void') return
  if (Number(sale.refunded_total || 0) > 0 || (await db.sale_returns.where('sale_id').equals(sale.id).count()) > 0) {
    throw new Error('Items of this sale were already returned. Return the remaining items instead of voiding.')
  }
  await db.transaction('rw', db.sales, db.products, db.credits, async () => {
    await db.sales.put({ ...sale, status: 'void', note: reason || sale.note, updated_at: nowISO() })
    for (const it of sale.items) {
      if (!it.product_id) continue
      const p = await db.products.get(it.product_id)
      if (p) await db.products.put({ ...p, stock: Number(p.stock) + it.qty })
    }
    const credits = await db.credits.where('sale_id').equals(sale.id).toArray()
    for (const c of credits) if (Number(c.paid) === 0) await db.credits.delete(c.id)
  })
  await queueRpc('void_sale', sale.id, { p_sale_id: sale.id, p_reason: reason || null })
}

/* ------------------------------------------------------------------ */
/* EXPENSES & REMINDERS                                                */
/* ------------------------------------------------------------------ */
export async function saveExpense(store: Store, input: Partial<Expense> & { amount: number }, existing?: Expense) {
  const row: Expense = existing
    ? { ...existing, ...input, updated_at: nowISO() }
    : { id: uuid(), store_id: store.id, category: input.category || null, description: input.description || null, amount: round2(input.amount), expense_date: input.expense_date || nowISO().slice(0, 10), ...stamp() }
  await db.expenses.put(row)
  await queueUpsert('expenses', row.id, row as unknown as Record<string, unknown>)
  return row
}
export async function deleteExpense(e: Expense) {
  await db.expenses.delete(e.id)
  await queueUpsert('expenses', e.id, { ...e, deleted_at: nowISO() })
}

export async function saveReminder(store: Store, input: Partial<Reminder>, existing?: Reminder) {
  const row: Reminder = existing
    ? { ...existing, ...input, updated_at: nowISO() }
    : { id: uuid(), store_id: store.id, title: input.title || 'Reminder', note: input.note || null, due_at: input.due_at || null, repeat: input.repeat || 'none', is_done: false, ...stamp() }
  await db.reminders.put(row)
  await queueUpsert('reminders', row.id, row as unknown as Record<string, unknown>)
  return row
}
export async function deleteReminder(r: Reminder) {
  await db.reminders.delete(r.id)
  await queueUpsert('reminders', r.id, { ...r, deleted_at: nowISO() })
}
