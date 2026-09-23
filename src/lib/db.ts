import Dexie, { type Table } from 'dexie'
import type {
  Credit, CreditPayment, Customer, Expense, OutboxItem, Product, Reminder, Sale, SaleReturn, StockMovement,
} from './types'

/**
 * Local-first database (IndexedDB). Everything the POS needs to operate is here,
 * so the app is fully usable with no network. The sync engine (lib/sync.ts)
 * mirrors these tables with Supabase using delta pulls + an outbox.
 */
export class PosDB extends Dexie {
  products!: Table<Product, string>
  customers!: Table<Customer, string>
  credits!: Table<Credit, string>
  credit_payments!: Table<CreditPayment, string>
  sales!: Table<Sale, string>
  expenses!: Table<Expense, string>
  stock_movements!: Table<StockMovement, string>
  reminders!: Table<Reminder, string>
  sale_returns!: Table<SaleReturn, string>
  outbox!: Table<OutboxItem, number>
  meta!: Table<{ key: string; value: unknown }, string>

  constructor() {
    super('artech-pos')
    this.version(1).stores({
      products: 'id, store_id, name, barcode, category, updated_at',
      customers: 'id, store_id, name, updated_at',
      credits: 'id, store_id, customer_id, sale_id, settled, created_at, updated_at',
      credit_payments: 'id, store_id, customer_id, created_at, updated_at',
      sales: 'id, store_id, txn_no, created_at, updated_at, status, customer_id, payment_method',
      expenses: 'id, store_id, expense_date, updated_at',
      stock_movements: 'id, store_id, product_id, created_at, updated_at',
      reminders: 'id, store_id, due_at, updated_at',
      outbox: '++seq, kind, table, id, created_at',
      meta: 'key',
    })
    // 2.3 — partial returns / refunds (existing tables are carried over by Dexie)
    this.version(2).stores({
      sale_returns: 'id, store_id, sale_id, created_at, updated_at',
    })
  }
}

export const db = new PosDB()

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return (row?.value as T) ?? fallback
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

/** Wipe all local data (used on sign-out / switching accounts). */
export async function clearLocalData() {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear()
  })
}
