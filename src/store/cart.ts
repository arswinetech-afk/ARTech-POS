import { create } from 'zustand'
import type { Customer, PaymentMethod, Product } from '../lib/types'
import { round2 } from '../lib/format'

export interface CartLine { product_id: string | null; name: string; qty: number; price: number; cost: number; unit: string | null; stock: number | null; list_price?: number }

/** A parked ("held") cart — e.g. the customer went back for one more item. */
export interface HeldCart { id: string; label: string; at: string; lines: CartLine[]; discount: number; discountLabel: string; customer: Customer | null; note: string }

interface CartData {
  lines: CartLine[]
  discount: number
  /** Human label for the discount, printed on the receipt (e.g. "SC/PWD 20%"). */
  discountLabel: string
  customer: Customer | null
  payment: PaymentMethod
  note: string
  held: HeldCart[]
}

interface CartState extends CartData {
  storeId: string | null
  load: (storeId: string) => void
  add: (p: Product, qty?: number) => void
  addCustom: (name: string, price: number, qty?: number) => void
  setQty: (idx: number, qty: number) => void
  setPrice: (idx: number, price: number) => void
  remove: (idx: number) => void
  setDiscount: (d: number, label?: string) => void
  setCustomer: (c: Customer | null) => void
  setPayment: (p: PaymentMethod) => void
  setNote: (n: string) => void
  hold: (label?: string) => HeldCart | null
  resume: (id: string) => void
  discardHeld: (id: string) => void
  clear: () => void
}

const EMPTY: CartData = { lines: [], discount: 0, discountLabel: '', customer: null, payment: 'cash', note: '', held: [] }
const key = (storeId: string) => `artech-pos-cart:${storeId}`

function read(storeId: string): CartData {
  try {
    const raw = localStorage.getItem(key(storeId))
    if (!raw) return { ...EMPTY }
    const d = JSON.parse(raw) as Partial<CartData>
    return { ...EMPTY, ...d, lines: Array.isArray(d.lines) ? d.lines : [], held: Array.isArray(d.held) ? d.held : [] }
  } catch { return { ...EMPTY } }
}
function write(storeId: string | null, d: CartData) {
  if (!storeId) return
  try { localStorage.setItem(key(storeId), JSON.stringify(d)) } catch { /* quota / private mode */ }
}

export const useCart = create<CartState>((set, get) => {
  /** Apply a partial update and persist the cart for the active store (survives reloads). */
  const commit = (patch: Partial<CartData>) => {
    const next = { ...get(), ...patch }
    set(patch)
    write(next.storeId, { lines: next.lines, discount: next.discount, discountLabel: next.discountLabel, customer: next.customer, payment: next.payment, note: next.note, held: next.held })
  }
  return {
    ...EMPTY,
    storeId: null,
    load: (storeId) => { if (get().storeId === storeId) return; set({ storeId, ...read(storeId) }) },
    add: (p, qty = 1) => {
      const lines = [...get().lines]
      const i = lines.findIndex((l) => l.product_id === p.id)
      if (i >= 0) lines[i] = { ...lines[i], qty: round2(lines[i].qty + qty) }
      else lines.unshift({ product_id: p.id, name: p.name, qty, price: Number(p.price), list_price: Number(p.price), cost: Number(p.cost), unit: p.unit, stock: Number(p.stock) })
      commit({ lines })
    },
    addCustom: (name, price, qty = 1) => commit({ lines: [{ product_id: null, name, qty, price, cost: 0, unit: null, stock: null }, ...get().lines] }),
    setQty: (idx, qty) => { const lines = [...get().lines]; if (qty <= 0) lines.splice(idx, 1); else lines[idx] = { ...lines[idx], qty }; commit({ lines }) },
    setPrice: (idx, price) => { const lines = [...get().lines]; lines[idx] = { ...lines[idx], price: round2(Math.max(0, price)) }; commit({ lines }) },
    remove: (idx) => { const lines = [...get().lines]; lines.splice(idx, 1); commit({ lines }) },
    setDiscount: (discount, label = '') => commit({ discount: round2(Math.max(0, discount)), discountLabel: discount > 0 ? label : '' }),
    setCustomer: (customer) => commit({ customer }),
    setPayment: (payment) => commit({ payment }),
    setNote: (note) => commit({ note }),
    hold: (label) => {
      const s = get()
      if (!s.lines.length) return null
      const h: HeldCart = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: (label || s.customer?.name || '').trim() || `Sale ${s.held.length + 1}`, at: new Date().toISOString(), lines: s.lines, discount: s.discount, discountLabel: s.discountLabel, customer: s.customer, note: s.note }
      commit({ held: [h, ...s.held].slice(0, 20), lines: [], discount: 0, discountLabel: '', customer: null, note: '' })
      return h
    },
    resume: (id) => {
      const s = get()
      const h = s.held.find((x) => x.id === id)
      if (!h) return
      let held = s.held.filter((x) => x.id !== id)
      // if something is in the cart right now, park it first so nothing is lost
      if (s.lines.length) held = [{ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: (s.customer?.name || '').trim() || `Sale ${held.length + 1}`, at: new Date().toISOString(), lines: s.lines, discount: s.discount, discountLabel: s.discountLabel, customer: s.customer, note: s.note }, ...held]
      commit({ held, lines: h.lines, discount: h.discount, discountLabel: h.discountLabel, customer: h.customer, note: h.note })
    },
    discardHeld: (id) => commit({ held: get().held.filter((x) => x.id !== id) }),
    clear: () => commit({ lines: [], discount: 0, discountLabel: '', customer: null, payment: 'cash', note: '' }),
  }
})

export const cartTotals = (s: Pick<CartState, 'lines' | 'discount'>) => {
  const subtotal = round2(s.lines.reduce((a, l) => a + l.qty * l.price, 0))
  const total = round2(Math.max(0, subtotal - (s.discount || 0)))
  const cost = round2(s.lines.reduce((a, l) => a + l.qty * l.cost, 0))
  const count = s.lines.reduce((a, l) => a + l.qty, 0)
  return { subtotal, total, cost, profit: round2(total - cost), count }
}
