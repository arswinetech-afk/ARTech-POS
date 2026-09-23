export type UUID = string

export interface Profile {
  id: UUID
  email: string
  full_name: string | null
  is_admin: boolean
  active_store_id?: UUID | null
  created_at: string
}

/** Staff roles inside ONE store (a user can have different roles in different stores). */
export type Role = 'owner' | 'manager' | 'cashier' | 'viewer'

/** One row per store the signed-in user belongs to (store switcher). */
export interface Membership {
  id: UUID
  name: string
  role: Role
  owner_name: string | null
  joined_at: string
}

/** Light member record shipped with the bootstrap: resolves created_by → name offline. */
export interface MemberLite {
  user_id: UUID
  role: Role
  name: string
}

/** Full member record (Settings → Store Staff). */
export interface StaffMember extends MemberLite {
  email: string
  created_at: string
  invited_by: UUID | null
  invited_by_name: string | null
  sales_count: number
  last_sale_at: string | null
}

export interface StoreInvite {
  id: UUID
  store_id: UUID
  code: string
  role: Role
  label: string | null
  created_by: UUID | null
  expires_at: string
  max_uses: number
  uses: number
  revoked_at: string | null
  created_at: string
}

export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'suspended'

export interface Store {
  id: UUID
  owner_id: UUID
  name: string
  address: string | null
  owner_name: string | null
  contact: string | null
  tin: string | null
  logo_data: string | null
  receipt_footer: string | null
  paper_width: number
  print_logo: boolean
  low_stock_threshold: number
  currency: string
  settings: Record<string, unknown>
  trial_ends_at: string
  plan_id: string | null
  subscription_status: SubscriptionStatus
  subscription_ends_at: string | null
  created_at: string
  updated_at: string
}

export interface Plan {
  id: string
  name: string
  price: number
  period_days: number
  description: string | null
  features: string[]
  badge: string | null
  is_active: boolean
  sort: number
}

export interface Product {
  id: UUID
  store_id: UUID
  created_by?: UUID | null
  name: string
  barcode: string | null
  category: string | null
  cost: number
  price: number
  stock: number
  unit: string | null
  description: string | null
  low_stock_at: number | null
  is_active: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Customer {
  id: UUID
  store_id: UUID
  created_by?: UUID | null
  name: string
  phone: string | null
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Credit {
  id: UUID
  store_id: UUID
  created_by?: UUID | null
  customer_id: UUID | null
  sale_id: UUID | null
  amount: number
  paid: number
  settled: boolean
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CreditPayment {
  id: UUID
  store_id: UUID
  created_by?: UUID | null
  customer_id: UUID | null
  amount: number
  method: string
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface SaleItem {
  product_id: UUID | null
  name: string
  qty: number
  price: number
  cost: number
  unit?: string | null
}

export type PaymentMethod = 'cash' | 'gcash' | 'credit' | 'card' | 'other'

export interface Sale {
  id: UUID
  store_id: UUID
  txn_no: string
  items: SaleItem[]
  subtotal: number
  discount: number
  total: number
  cost_total: number
  profit: number
  payment_method: PaymentMethod
  customer_id: UUID | null
  customer_name: string | null
  amount_paid: number | null
  change_due: number | null
  status: 'active' | 'void'
  note: string | null
  created_by: UUID | null
  cashier_name?: string | null
  voided_by?: UUID | null
  voided_at?: string | null
  /** Running total of partial refunds recorded against this sale (2.3). */
  refunded_total?: number
  created_at: string
  updated_at: string
}

/** One returned line of a sale (snapshot of the sale line + how much came back). */
export interface ReturnItem {
  line: number                 // index into sale.items
  product_id: UUID | null
  name: string
  unit: string | null
  qty: number
  price: number                // sale price per unit (before the sale-level discount share)
  cost: number
  restock: boolean             // false = damaged / not resellable → stock not restored
}

export type RefundMethod = 'cash' | 'gcash' | 'credit'

/** Partial return / refund of individual items of a sale (2.3). */
export interface SaleReturn {
  id: UUID
  store_id: UUID
  sale_id: UUID
  sale_txn_no: string | null
  ret_no: string
  items: ReturnItem[]
  gross: number
  discount_share: number
  refund_total: number
  cost_total: number
  restock_cost: number
  refund_method: RefundMethod
  refund_credit: number
  refund_cash: number
  reason: string | null
  customer_id: UUID | null
  customer_name: string | null
  created_by: UUID | null
  cashier_name?: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Expense {
  id: UUID
  store_id: UUID
  created_by?: UUID | null
  category: string | null
  description: string | null
  amount: number
  expense_date: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface StockMovement {
  id: UUID
  store_id: UUID
  created_by?: UUID | null
  product_id: UUID | null
  qty: number
  type: 'purchase' | 'adjustment' | 'return' | 'import'
  unit_cost: number | null
  note: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Reminder {
  id: UUID
  store_id: UUID
  created_by?: UUID | null
  title: string
  note: string | null
  due_at: string | null
  repeat: 'none' | 'daily' | 'weekly' | 'monthly'
  is_done: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface PaymentRequest {
  id: UUID
  store_id: UUID
  user_id: UUID | null
  plan_id: string | null
  amount: number | null
  reference_no: string
  sender_name: string | null
  sender_number: string | null
  status: 'pending' | 'approved' | 'rejected'
  admin_note: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by: UUID | null
  // joined (admin view)
  store_name?: string
  email?: string
  plan_name?: string
  plan_price?: number
}

export interface OutboxItem {
  seq?: number
  kind: 'upsert' | 'rpc'
  table?: string
  rpc?: string
  id: string
  payload: Record<string, unknown>
  created_at: string
  attempts: number
  error?: string | null
}

export type SyncTable =
  | 'products' | 'customers' | 'credits' | 'credit_payments'
  | 'sales' | 'expenses' | 'stock_movements' | 'reminders' | 'sale_returns'

export const SYNC_TABLES: SyncTable[] = [
  'products', 'customers', 'credits', 'credit_payments', 'sales', 'expenses', 'stock_movements', 'reminders', 'sale_returns',
]

export const CATEGORIES = [
  'Groceries', 'Food', 'Beverages', 'Snacks', 'Medicines', 'Personal Care', 'Personal hygiene',
  'Household', 'School supplies', 'Feeds & Agri', 'Cigarettes', 'Load & E-services', 'Other',
]

export const EXPENSE_CATEGORIES = [
  'Utilities', 'Rent', 'Salaries', 'Transportation', 'Supplies', 'Repairs', 'Load & internet', 'Permits & taxes', 'Other',
]
