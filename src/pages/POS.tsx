import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, ScanLine, Bluetooth, BluetoothConnected, X, Plus, Minus, Trash2, ShoppingCart, Banknote, Smartphone, HandCoins, UserPlus, Percent, Tag, Keyboard, History, PauseCircle, StickyNote, User, Ban, Star, PlayCircle, Receipt, ChevronRight, BadgePercent, Undo2 } from 'lucide-react'
import { db } from '../lib/db'
import { useAppStore, usePermission, memberName } from '../store/app'
import { useCart, cartTotals } from '../store/cart'
import { Button, Modal, Input, Field, MoneyInput, Badge, EmptyState, Chip, Segmented, Textarea, Confirm } from '../components/ui'
import CameraScanner from '../components/CameraScanner'
import ReceiptModal from '../components/ReceiptModal'
import ReturnModal, { ReturnSlipModal } from '../components/ReturnModal'
import { useBarcode, beep } from '../lib/scanner'
import { usePrinter } from '../lib/printer'
import { createSale, createCustomer, customerBalance, voidSale } from '../lib/repo'
import { peso, num, cls, round2, fmtTime, timeAgo } from '../lib/format'
import { toast } from '../store/ui'
import { errorMessage } from '../lib/supabase'
import type { Product, Sale, Customer, PaymentMethod, SaleReturn } from '../lib/types'

const TOP = '★ Top'

export default function POS() {
  const { store } = useAppStore()
  const cart = useCart()
  const totals = cartTotals(cart)
  const printer = usePrinter()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('All')
  const [scanner, setScanner] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [recent, setRecent] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const canSell = usePermission('sell')
  const startCheckout = () => {
    if (!canSell) { toast.info('View only', 'Your role in this store cannot record sales.'); return }
    if (!cart.lines.length) { toast.info('Cart is empty', 'Tap an item or scan a barcode first.'); return }
    setCheckout(true)
  }
  const [pick, setPick] = useState<Product[] | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [limit, setLimit] = useState(60)
  const [flash, setFlash] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // the cart is kept per store and survives reloads / accidental navigation
  useEffect(() => { if (store) cart.load(store.id) }, [store?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const products = useLiveQuery(() => store ? db.products.where('store_id').equals(store.id).toArray() : Promise.resolve([] as Product[]), [store?.id], [] as Product[])

  // best sellers of the last 30 days → "★ Top" quick chip
  const topIds = useLiveQuery(async () => {
    if (!store) return [] as string[]
    const since = new Date(Date.now() - 30 * 864e5).toISOString()
    const [sales, returns] = await Promise.all([
      db.sales.where('store_id').equals(store.id).and((s) => s.created_at >= since && s.status === 'active').toArray(),
      db.sale_returns.where('store_id').equals(store.id).and((r) => r.created_at >= since).toArray(),
    ])
    const m = new Map<string, number>()
    for (const s of sales) for (const it of s.items) if (it.product_id) m.set(it.product_id, (m.get(it.product_id) || 0) + Number(it.qty))
    for (const r of returns) for (const it of r.items) if (it.product_id && m.has(it.product_id)) m.set(it.product_id, m.get(it.product_id)! - Number(it.qty)) // net of returns
    return [...m.entries()].filter(([, qty]) => qty > 0).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => id)
  }, [store?.id], [] as string[])

  const categories = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products) { const c = p.category || 'Other'; m.set(c, (m.get(c) || 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [products])

  const results = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    let list = products
    if (cat === TOP) { const rank = new Map(topIds.map((id, i) => [id, i])); list = list.filter((p) => rank.has(p.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!) }
    else if (cat !== 'All') list = list.filter((p) => (p.category || 'Other') === cat)
    if (tokens.length) {
      list = list.filter((p) => {
        const name = p.name.toLowerCase()
        return tokens.every((t) => name.includes(t)) || (p.barcode || '').startsWith(q.trim())
      })
      list = [...list].sort((a, b) => Number((b.barcode || '') === q.trim()) - Number((a.barcode || '') === q.trim()) || Number(b.stock > 0) - Number(a.stock > 0))
    } else if (cat !== TOP) {
      list = [...list].sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.name.localeCompare(b.name))
    }
    return list
  }, [products, q, cat, topIds])

  const addProduct = (p: Product, qty = 1) => {
    cart.add(p, qty)
    setFlash(p.id); window.setTimeout(() => setFlash((f) => (f === p.id ? null : f)), 300)
    if (Number(p.stock) <= 0) toast.warning('Out of stock', `${p.name} has no recorded stock – sold anyway.`)
  }

  const handleCode = (code: string) => {
    const c = code.trim()
    const matches = products.filter((p) => p.barcode === c)
    if (matches.length === 1) { addProduct(matches[0]); return true }
    if (matches.length > 1) { setPick(matches); return true }
    beep(false)
    toast.error('Barcode not found', c)
    setQ(c)
    return false
  }
  useBarcode((code) => { handleCode(code) }, !scanner && !checkout && !receipt && !recent)

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setQ(''); return }
    if (e.key !== 'Enter') return
    const exact = products.filter((p) => p.barcode === q.trim())
    if (exact.length === 1) { addProduct(exact[0]); setQ(''); return }
    if (results.length === 1) { addProduct(results[0]); setQ('') }
  }

  // desktop shortcuts: F2 search · F9 charge · F8 hold
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
      else if (e.key === 'F9') { e.preventDefault(); if (!checkout && !receipt) startCheckout() }
      else if (e.key === 'F8') { e.preventDefault(); if (cart.lines.length && !checkout) { const h = cart.hold(); if (h) toast.info('Sale on hold', `${h.label} · ${peso(cartTotals(h).total)}`) } else setHeldOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const onCompleted = (s: Sale) => { setCheckout(false); setCartOpen(false); setReceipt(s); cart.clear() }

  useEffect(() => { setLimit(60) }, [q, cat])

  if (!store) return null

  return (
    <div className="md:grid md:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_400px] md:gap-4 md:h-[calc(100dvh-2rem)]">
      {/* ------------------------------------------------ Products */}
      <div className="flex flex-col min-h-0 min-w-0">
        <div className="flex items-center gap-2 mb-3">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-black tracking-tight leading-tight">Point of Sale</h1>
            <div className="hidden md:block text-[11px] text-slate-400">F2 search · F9 charge · F8 hold · scanner ready</div>
          </div>
          <div className="flex-1" />
          <button onClick={() => setRecent(true)} data-testid="recent-sales" className="h-9 px-3 rounded-full text-xs font-medium inline-flex items-center gap-1.5 border bg-white text-slate-700 border-slate-200 hover:border-slate-300 transition"><History size={16} /><span className="hidden sm:inline">Recent</span></button>
          <button onClick={() => printer.connected ? printer.disconnect() : printer.connect().then(() => toast.success('Printer connected', printer.name || '')).catch((e) => toast.error('Printer', errorMessage(e)))}
            className={cls('h-9 px-3 rounded-full text-xs font-medium inline-flex items-center gap-1.5 border transition', printer.connected ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-slate-100 text-slate-600 border-slate-200')}>
            {printer.connected ? <BluetoothConnected size={16} /> : <Bluetooth size={16} />}<span className="max-w-[90px] truncate hidden sm:inline">{printer.connected ? (printer.name || 'Printer') : 'Printer'}</span>
          </button>
        </div>
        <div className="flex gap-2 mb-3">
          <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder="Search product or barcode" left={<Search size={18} />} data-keep-scan
            right={q ? <button onClick={() => setQ('')} className="p-2 text-slate-400"><X size={16} /></button> : undefined} />
          <Button onClick={() => setScanner(true)} icon={<ScanLine size={18} />} className="shrink-0">Scan</Button>
          <button onClick={() => searchRef.current?.focus()} title="Bluetooth/USB scanner ready – just scan" className="shrink-0 w-11 h-11 rounded-xl bg-sky-50 text-sky-700 border border-sky-100 flex items-center justify-center"><Keyboard size={18} /></button>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 -mx-4 px-4 md:mx-0 md:px-0">
          <Chip active={cat === 'All'} onClick={() => setCat('All')}>All</Chip>
          {topIds.length > 0 && <Chip active={cat === TOP} onClick={() => setCat(TOP)}>{TOP}</Chip>}
          {categories.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{c}</Chip>)}
        </div>

        <div className="flex-1 md:overflow-y-auto md:pr-1 mt-1">
          {products.length === 0 ? (
            <EmptyState icon={<ShoppingCart />} title="No products yet" message="Add items or import your product list to start selling." action={<div className="flex gap-2"><Button onClick={() => navigate('/items?new=1')}>Add item</Button><Button variant="outline" onClick={() => navigate('/settings/import')}>Import CSV</Button></div>} />
          ) : results.length === 0 ? (
            <EmptyState icon={<Search />} title="No matches" message={`Nothing matches “${q}”.`} action={<div className="flex gap-2"><Button variant="outline" onClick={() => setCustomOpen(true)} icon={<Tag size={16} />}>Add custom item</Button><Button onClick={() => navigate(`/items?new=1&barcode=${encodeURIComponent(q)}`)}>Create product</Button></div>} />
          ) : (
            <div className="grid gap-2 pb-40 md:pb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
              {results.slice(0, limit).map((p) => {
                const inCart = cart.lines.find((l) => l.product_id === p.id)
                const low = Number(p.stock) <= (p.low_stock_at ?? store.low_stock_threshold)
                return (
                  <button key={p.id} onClick={() => addProduct(p)} data-testid="product-card" className={cls('text-left bg-white rounded-2xl border p-3 shadow-card active:scale-[.97] transition relative overflow-hidden', inCart ? 'border-brand-400 ring-2 ring-brand-100' : 'border-slate-100 hover:border-brand-200', flash === p.id && 'animate-pop')}>
                    {inCart && <span className="absolute top-2 right-2 bg-brand-600 text-white text-[11px] font-bold rounded-full min-w-[22px] h-[22px] px-1.5 flex items-center justify-center">{num(inCart.qty, 2)}</span>}
                    {cat === TOP && <Star size={12} className="absolute top-2.5 left-2.5 text-amber-400 fill-amber-400" />}
                    <div className={cls('text-[13px] font-medium text-slate-800 leading-snug line-clamp-2 min-h-[2.4em] pr-5', cat === TOP && 'pl-4')}>{p.name}</div>
                    <div className="mt-2 flex items-end justify-between">
                      <div className="text-base font-bold text-brand-700 tabular">{peso(p.price)}</div>
                      <span className={cls('text-[10px] font-semibold px-1.5 py-0.5 rounded-md', Number(p.stock) <= 0 ? 'bg-red-100 text-red-700' : low ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600')}>{num(p.stock, 2)} {p.unit || ''}</span>
                    </div>
                  </button>
                )
              })}
              {results.length > limit && <button onClick={() => setLimit(limit + 60)} className="col-span-full h-11 rounded-xl border border-dashed border-slate-300 text-sm text-slate-600">Show more ({results.length - limit} more)</button>}
              <button onClick={() => setCustomOpen(true)} className="col-span-full h-11 rounded-xl border border-dashed border-brand-300 text-sm text-brand-700 flex items-center justify-center gap-1"><Tag size={16} /> Add custom / unlisted item</button>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ Cart (desktop panel) */}
      <aside className="hidden md:flex flex-col bg-white rounded-2xl border border-slate-100 shadow-card min-h-0 min-w-0" data-testid="cart-panel">
        <CartPanel onCheckout={startCheckout} heldOpen={heldOpen} setHeldOpen={setHeldOpen} />
      </aside>

      {/* ------------------------------------------------ Cart bar (mobile) */}
      {cart.lines.length > 0 && (
        <div className="md:hidden fixed left-3 right-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 animate-slide-up">
          <div className="bg-slate-900 text-white rounded-2xl shadow-pop p-2 pl-4 flex items-center gap-3">
            <button className="flex-1 text-left" onClick={() => setCartOpen(true)}>
              <div className="text-[11px] text-white/70">{num(totals.count, 2)} item{totals.count === 1 ? '' : 's'}{cart.discount ? ` · −${peso(cart.discount)}` : ''} · tap to review</div>
              <div className="text-xl font-black tabular">{peso(totals.total)}</div>
            </button>
            <Button size="lg" variant="success" onClick={startCheckout} className="px-6">Charge</Button>
          </div>
        </div>
      )}
      {cart.lines.length === 0 && cart.held.length > 0 && (
        <button onClick={() => setHeldOpen(true)} className="md:hidden fixed left-3 right-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 bg-amber-500 text-white rounded-2xl shadow-pop px-4 py-2.5 flex items-center gap-2 text-sm font-semibold animate-slide-up"><PauseCircle size={18} /> {cart.held.length} sale{cart.held.length === 1 ? '' : 's'} on hold <ChevronRight size={16} className="ml-auto" /></button>
      )}

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title={`Cart (${num(totals.count, 2)})`}>
        <CartPanel embedded onCheckout={() => { setCartOpen(false); startCheckout() }} heldOpen={heldOpen} setHeldOpen={setHeldOpen} />
      </Modal>
      {/* held carts sheet is shared by the desktop panel, the mobile sheet and the F8 key */}
      {!cartOpen && <HeldSheet open={heldOpen} onClose={() => setHeldOpen(false)} />}

      {scanner && <CameraScanner continuous onScan={(c) => handleCode(c)} onClose={() => setScanner(false)} title="Scan items – continuous" />}

      {/* barcode shared by several products */}
      <Modal open={!!pick} onClose={() => setPick(null)} title="Which item?" size="sm">
        <div className="space-y-2">{pick?.map((p) => <button key={p.id} onClick={() => { addProduct(p); setPick(null) }} className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-brand-400"><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{peso(p.price)} · {num(p.stock, 2)} in stock</div></button>)}</div>
      </Modal>

      <CustomItemModal open={customOpen} onClose={() => setCustomOpen(false)} initialName={q} />

      {checkout && <CheckoutModal onClose={() => setCheckout(false)} onCompleted={onCompleted} />}

      <RecentSales open={recent} onClose={() => setRecent(false)} />

      <ReceiptModal sale={receipt} justCompleted onClose={() => setReceipt(null)} onNewSale={() => { setReceipt(null); searchRef.current?.focus() }} />

    </div>
  )
}

/* ------------------------------------------------------------------ Cart panel */
function CartPanel({ onCheckout, embedded, heldOpen, setHeldOpen }: { onCheckout: () => void; embedded?: boolean; heldOpen: boolean; setHeldOpen: (v: boolean) => void }) {
  const cart = useCart()
  const totals = cartTotals(cart)
  const canOverridePrice = usePermission('manage_items')
  const [discOpen, setDiscOpen] = useState(false)
  const [custOpen, setCustOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [editLine, setEditLine] = useState<number | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  useEffect(() => { if (cart.customer) customerBalance(cart.customer.id).then(setBalance); else setBalance(null) }, [cart.customer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const hold = () => { const h = cart.hold(); if (h) toast.info('Sale on hold', `${h.label} · ${peso(cartTotals(h).total)} — resume it from Hold`) }

  return (
    <>
      {!embedded ? (
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <div className="font-semibold flex items-center gap-2"><ShoppingCart size={18} /> Cart{cart.lines.length > 0 && <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 tabular">{num(totals.count, 2)}</span>}</div>
          <div className="flex-1" />
          {cart.lines.length > 0 && <button onClick={() => setClearOpen(true)} data-testid="cart-clear" className="text-xs text-red-600 font-medium inline-flex items-center gap-1 h-8 px-2 rounded-lg hover:bg-red-50"><Trash2 size={14} /> Clear</button>}
        </div>
      ) : cart.lines.length > 0 && (
        <div className="flex justify-end -mt-2"><button onClick={() => setClearOpen(true)} data-testid="cart-clear" className="text-xs text-red-600 font-medium inline-flex items-center gap-1 h-8 px-2 rounded-lg hover:bg-red-50"><Trash2 size={14} /> Clear cart</button></div>
      )}
      <div className={cls('flex-1 overflow-y-auto', embedded ? '' : 'px-3')}>
        {cart.lines.length === 0 ? (
          <div className="py-10 text-center text-slate-500">
            <ShoppingCart className="mx-auto mb-2 text-slate-300" size={40} />
            <div className="font-medium text-slate-700">Cart is empty</div>
            <div className="text-xs">Tap an item, scan a barcode or press F2 to search</div>
            {cart.held.length > 0 && <button onClick={() => setHeldOpen(true)} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-3 h-8"><PauseCircle size={14} /> {cart.held.length} sale{cart.held.length === 1 ? '' : 's'} on hold</button>}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {cart.lines.map((l, i) => (
              <li key={(l.product_id || 'custom') + i} className="py-2 animate-flash-in" data-testid="cart-line">
                <div className="flex items-start gap-2">
                  <button className="flex-1 min-w-0 text-left text-sm font-medium text-slate-800 leading-snug line-clamp-2" onClick={() => setEditLine(i)} title="Edit quantity / price">{l.name}</button>
                  <div className="font-semibold tabular text-sm whitespace-nowrap pt-px">{peso(l.qty * l.price)}</div>
                  <button onClick={() => cart.remove(i)} className="p-1 -mr-1 -mt-0.5 text-slate-400 hover:text-red-600" aria-label="Remove"><Trash2 size={15} /></button>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <button className="flex-1 min-w-0 text-left text-xs text-slate-500 tabular truncate" onClick={() => setEditLine(i)}>
                    {peso(l.price)}{l.list_price != null && l.list_price !== l.price && <span className="line-through text-slate-400 ml-1">{peso(l.list_price)}</span>}{l.unit ? ` / ${l.unit}` : ''}{l.stock != null && l.stock < l.qty ? <span className="text-red-600 ml-1">· exceeds stock ({num(l.stock, 2)})</span> : null}
                  </button>
                  <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                    <button onClick={() => cart.setQty(i, round2(l.qty - 1))} className="w-8 h-7 rounded-md bg-white shadow-sm flex items-center justify-center" aria-label="Less"><Minus size={14} /></button>
                    <button onClick={() => setEditLine(i)} className="min-w-[40px] px-1 text-center text-sm font-semibold tabular" title="Type a quantity">{num(l.qty, 3)}</button>
                    <button onClick={() => cart.setQty(i, round2(l.qty + 1))} className="w-8 h-7 rounded-md bg-white shadow-sm flex items-center justify-center" aria-label="More"><Plus size={14} /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={cls('border-t border-slate-100 p-3 space-y-2.5', embedded && 'sticky bottom-0 bg-white -mx-5 px-5 -mb-4 pb-4')}>
        {/* quick actions */}
        <div className="grid grid-cols-4 gap-1.5">
          <Action testId="act-discount" icon={<BadgePercent size={18} />} label="Discount" value={cart.discount ? `−${peso(cart.discount)}` : null} active={cart.discount > 0} onClick={() => { if (!cart.lines.length) { toast.info('Add items first'); return } setDiscOpen(true) }} />
          <Action testId="act-customer" icon={<User size={18} />} label="Customer" value={cart.customer?.name.split(' ')[0]} active={!!cart.customer} onClick={() => setCustOpen(true)} />
          <Action testId="act-hold" icon={<PauseCircle size={18} />} label="Hold" value={cart.held.length ? `Held (${cart.held.length})` : null} active={cart.held.length > 0} onClick={() => (cart.lines.length ? hold() : setHeldOpen(true))} />
          <Action testId="act-note" icon={<StickyNote size={18} />} label="Note" value={cart.note ? 'Note ✓' : null} active={!!cart.note} onClick={() => setNoteOpen(true)} />
        </div>
        {cart.customer && (
          <div className="flex items-center gap-2 rounded-xl bg-brand-50 border border-brand-100 px-3 py-1.5 text-xs">
            <span className="w-6 h-6 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold text-[11px]">{cart.customer.name.slice(0, 1).toUpperCase()}</span>
            <span className="font-semibold text-brand-900 truncate">{cart.customer.name}</span>
            {balance != null && balance > 0 && <span className="text-orange-700">· owes {peso(balance)}</span>}
            <button onClick={() => cart.setCustomer(null)} className="ml-auto text-slate-500 p-1" aria-label="Remove customer"><X size={14} /></button>
          </div>
        )}
        <div className="flex justify-between text-sm text-slate-600"><span>Subtotal</span><span className="tabular">{peso(totals.subtotal)}</span></div>
        {cart.discount > 0 && (
          <div className="flex justify-between text-sm items-center text-brand-800">
            <span className="flex items-center gap-1"><Percent size={14} /> Discount{cart.discountLabel ? ` · ${cart.discountLabel}` : ''}<button onClick={() => cart.setDiscount(0)} className="text-slate-400 hover:text-red-600 p-0.5" aria-label="Remove discount"><X size={12} /></button></span>
            <span className="tabular">−{peso(cart.discount)}</span>
          </div>
        )}
        <div className="flex justify-between items-baseline"><span className="text-lg font-black">Total</span><span className="text-2xl font-black tabular">{peso(totals.total)}</span></div>
        <Button block size="lg" variant="success" disabled={!cart.lines.length} onClick={onCheckout} data-testid="charge" className="text-base">Charge {peso(totals.total)}<span className="hidden md:inline text-white/60 text-xs font-normal ml-2">F9</span></Button>
      </div>

      <DiscountSheet open={discOpen} onClose={() => setDiscOpen(false)} subtotal={totals.subtotal} />
      <CustomerSheet open={custOpen} onClose={() => setCustOpen(false)} />
      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title="Note for this sale" size="sm" footer={<><Button variant="outline" onClick={() => { cart.setNote(''); setNoteOpen(false) }}>Clear</Button><Button onClick={() => setNoteOpen(false)}>Done</Button></>}>
        <Textarea value={cart.note} onChange={(e) => cart.setNote(e.target.value)} autoFocus placeholder="e.g. Deliver after 5 PM, pay on Friday…" className="min-h-[90px]" />
        <p className="text-xs text-slate-500 mt-2">Saved with the transaction and printed on the receipt.</p>
      </Modal>
      <Confirm open={clearOpen} onClose={() => setClearOpen(false)} danger title="Clear the cart?" message={`${num(totals.count, 2)} item${totals.count === 1 ? '' : 's'} worth ${peso(totals.total)} will be removed. Use Hold instead if the customer is coming back.`} confirmText="Clear cart" onConfirm={() => { cart.clear(); setClearOpen(false) }} />
      {embedded && <HeldSheet open={heldOpen} onClose={() => setHeldOpen(false)} />}
      <LineSheet index={editLine} onClose={() => setEditLine(null)} canOverridePrice={canOverridePrice} />
    </>
  )
}

/** Compact icon button used in the cart action bar. */
function Action({ icon, label, value, onClick, active, testId }: { icon: React.ReactNode; label: string; value?: string | number | null; onClick: () => void; active?: boolean; testId?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className={cls('h-14 rounded-xl border flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition active:scale-[.97] min-w-0 px-1', active ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>
      {icon}<span className="truncate max-w-full">{value != null && value !== '' ? value : label}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ Line editor (qty / price) */
function LineSheet({ index, onClose, canOverridePrice }: { index: number | null; onClose: () => void; canOverridePrice: boolean }) {
  const cart = useCart()
  const line = index != null ? cart.lines[index] : null
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  useEffect(() => { if (line) { setQty(String(line.qty)); setPrice(String(line.price)) } }, [index]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!line || index == null) return null
  const apply = () => {
    const q = parseFloat(qty) || 0
    const p = parseFloat(price)
    if (canOverridePrice && !Number.isNaN(p) && p !== line.price) cart.setPrice(index, p)
    cart.setQty(index, q)
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={line.name} size="sm" footer={<><Button variant="outline" className="text-red-600 border-red-200" onClick={() => { cart.remove(index); onClose() }} icon={<Trash2 size={16} />}>Remove</Button><div className="flex-1" /><Button onClick={apply}>Apply</Button></>}>
      <div className="space-y-3">
        <Field label="Quantity">
          <div className="flex items-center gap-2">
            <button onClick={() => setQty(String(Math.max(0, round2((parseFloat(qty) || 0) - 1))))} className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center"><Minus size={18} /></button>
            <Input inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && apply()} className="text-2xl h-12 font-bold text-center" />
            <button onClick={() => setQty(String(round2((parseFloat(qty) || 0) + 1)))} className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center"><Plus size={18} /></button>
          </div>
        </Field>
        <div className="flex gap-2 flex-wrap">{[1, 2, 3, 5, 6, 10, 12, 24].map((v) => <Chip key={v} active={parseFloat(qty) === v} onClick={() => setQty(String(v))}>{v}</Chip>)}</div>
        {canOverridePrice ? (
          <Field label="Unit price" hint={line.list_price != null && line.list_price !== parseFloat(price) ? `List price ${peso(line.list_price)}` : 'Change only for this sale (e.g. suki price, damaged pack).'}>
            <MoneyInput value={price} onChange={setPrice} />
          </Field>
        ) : <p className="text-xs text-slate-500">Unit price {peso(line.price)} · only owners and managers can change prices.</p>}
        <p className="text-xs text-slate-500">Decimals allowed for items sold by weight (e.g. 1.5 kg).</p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ Discount */
function DiscountSheet({ open, onClose, subtotal }: { open: boolean; onClose: () => void; subtotal: number }) {
  const cart = useCart()
  const [mode, setMode] = useState<'percent' | 'amount'>('percent')
  const [val, setVal] = useState('')
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!open) return
    setLabel(cart.discountLabel || '')
    if (cart.discount > 0) { const pct = subtotal ? round2(cart.discount / subtotal * 100) : 0; if (Number.isInteger(pct) && pct > 0) { setMode('percent'); setVal(String(pct)) } else { setMode('amount'); setVal(String(cart.discount)) } }
    else { setMode('percent'); setVal('') }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = parseFloat(val) || 0
  const amount = Math.min(subtotal, mode === 'percent' ? round2(subtotal * Math.min(100, n) / 100) : round2(n))
  const presets = [
    { label: 'SC/PWD 20%', pct: 20, tag: 'SC/PWD' },
    { label: 'Suki 5%', pct: 5, tag: 'Suki' },
    { label: 'Promo 10%', pct: 10, tag: 'Promo' },
  ]
  return (
    <Modal open={open} onClose={onClose} title="Discount" size="sm" footer={<><Button variant="outline" onClick={() => { cart.setDiscount(0); onClose() }} disabled={!cart.discount}>Remove</Button><Button onClick={() => { cart.setDiscount(amount, label.trim() || (mode === 'percent' && n ? `${num(n, 2)}%` : '')); onClose() }} disabled={amount <= 0} data-testid="apply-discount">Apply −{peso(amount)}</Button></>}>
      <div className="space-y-3">
        <Segmented value={mode} onChange={(m) => { setMode(m); setVal('') }} options={[{ value: 'percent', label: 'Percent %' }, { value: 'amount', label: 'Amount ₱' }]} />
        {mode === 'percent'
          ? <div className="relative"><Input inputMode="decimal" autoFocus value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, ''))} className="text-3xl h-16 font-black text-center pr-10" placeholder="0" /><span className="absolute right-4 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-400">%</span></div>
          : <MoneyInput value={val} onChange={setVal} autoFocus big />}
        <div className="flex gap-2 flex-wrap">
          {mode === 'percent' ? [5, 10, 15, 20, 25, 50].map((v) => <Chip key={v} active={n === v} onClick={() => setVal(String(v))}>{v}%</Chip>) : [5, 10, 20, 50, 100].map((v) => <Chip key={v} active={n === v} onClick={() => setVal(String(v))}>₱{v}</Chip>)}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Presets</div>
          <div className="grid grid-cols-3 gap-1.5">{presets.map((p) => <button key={p.tag} onClick={() => { setMode('percent'); setVal(String(p.pct)); setLabel(p.tag) }} className={cls('h-10 rounded-xl border text-xs font-semibold transition', label === p.tag && n === p.pct && mode === 'percent' ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-700 hover:border-slate-300')}>{p.label}</button>)}</div>
        </div>
        <Field label="Reason (printed on receipt)"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. SC/PWD, Suki, Damaged pack" maxLength={40} /></Field>
        <div className="rounded-xl bg-slate-50 p-3 text-sm flex items-center justify-between"><span className="text-slate-600">New total</span><span className="font-black tabular text-lg">{peso(Math.max(0, subtotal - amount))}</span></div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ Customer picker (cart + checkout) */
export function CustomerPicker({ value, onChange, autoFocus }: { value: Customer | null; onChange: (c: Customer | null) => void; autoFocus?: boolean }) {
  const { store } = useAppStore()
  const canManage = usePermission('manage_customers')
  const [q, setQ] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const customers = useLiveQuery(() => store ? db.customers.where('store_id').equals(store.id).toArray() : Promise.resolve([] as Customer[]), [store?.id], [] as Customer[])
  const results = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? customers.filter((c) => c.name.toLowerCase().includes(t) || (c.phone || '').includes(t)) : [...customers].sort((a, b) => b.updated_at.localeCompare(a.updated_at))).slice(0, 8) }, [customers, q])
  useEffect(() => { if (value) customerBalance(value.id).then(setBalance); else setBalance(null) }, [value?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    if (!store || !q.trim()) return
    const c = await createCustomer(store, q.trim())
    onChange(c); setQ('')
    toast.success('Customer added', c.name)
  }
  if (value) return (
    <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-3 h-12"><div><div className="font-medium text-sm">{value.name}</div>{balance != null && balance > 0 && <div className="text-[11px] text-orange-700">Current balance {peso(balance)}</div>}</div><button onClick={() => onChange(null)} className="text-slate-500 p-1" aria-label="Remove customer"><X size={16} /></button></div>
  )
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone, or type a new name" left={<Search size={18} />} autoFocus={autoFocus} />
      <div className="mt-1 border border-slate-200 rounded-xl overflow-hidden bg-white max-h-64 overflow-y-auto">
        {results.map((c) => <button key={c.id} onClick={() => { onChange(c); setQ('') }} className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0 flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold">{c.name.slice(0, 1).toUpperCase()}</span><span className="flex-1 truncate">{c.name}</span>{c.phone && <span className="text-slate-400 text-xs">{c.phone}</span>}</button>)}
        {q.trim() && canManage && !results.some((c) => c.name.toLowerCase() === q.trim().toLowerCase()) && <button onClick={add} className="w-full text-left px-3 py-2.5 text-sm text-brand-700 font-medium flex items-center gap-2 hover:bg-brand-50"><UserPlus size={16} /> Add “{q.trim()}” as new customer</button>}
        {results.length === 0 && !q.trim() && <div className="px-3 py-4 text-xs text-slate-500 text-center">No customers yet — type a name to add one.</div>}
      </div>
    </div>
  )
}

function CustomerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCart()
  return (
    <Modal open={open} onClose={onClose} title="Customer" size="sm" footer={<Button onClick={onClose}>Done</Button>}>
      <CustomerPicker value={cart.customer} onChange={(c) => { cart.setCustomer(c); if (c) onClose() }} autoFocus />
      <p className="text-xs text-slate-500 mt-3">Attach a customer to print their name on the receipt or to record the sale as credit (utang) at checkout.</p>
    </Modal>
  )
}

/* ------------------------------------------------------------------ Held (parked) sales */
function HeldSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCart()
  const [label, setLabel] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null)
  return (
    <Modal open={open} onClose={onClose} title="Sales on hold" size="sm">
      {cart.lines.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-3">
          <div className="text-sm font-semibold text-amber-900">Put the current cart on hold</div>
          <div className="text-xs text-amber-800 mb-2">{num(cartTotals(cart).count, 2)} items · {peso(cartTotals(cart).total)}</div>
          <div className="flex gap-2"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={cart.customer?.name || 'Label, e.g. Ate Marie / blue shirt'} /><Button onClick={() => { const h = cart.hold(label); setLabel(''); if (h) { toast.info('Sale on hold', h.label); onClose() } }} icon={<PauseCircle size={16} />}>Hold</Button></div>
        </div>
      )}
      {cart.held.length === 0 ? (
        <div className="py-8 text-center text-slate-500 text-sm"><PauseCircle className="mx-auto mb-2 text-slate-300" size={36} />Nothing on hold.<div className="text-xs mt-1">Use <b>Hold</b> when a customer steps away — serve the next one, then resume.</div></div>
      ) : (
        <ul className="space-y-2">
          {cart.held.map((h) => {
            const t = cartTotals(h)
            return (
              <li key={h.id} className="rounded-xl border border-slate-200 p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{h.label}</div>
                  <div className="text-xs text-slate-500 truncate">{timeAgo(h.at)} · {num(t.count, 2)} items · {h.lines.slice(0, 3).map((l) => l.name).join(', ')}{h.lines.length > 3 ? '…' : ''}</div>
                </div>
                <div className="font-bold tabular text-sm">{peso(t.total)}</div>
                <Button size="sm" onClick={() => { cart.resume(h.id); onClose(); toast.success('Sale resumed', h.label) }} icon={<PlayCircle size={16} />} data-testid="resume-held">Resume</Button>
                <button onClick={() => setConfirmDiscard(h.id)} className="p-1.5 text-slate-400 hover:text-red-600" aria-label="Discard"><Trash2 size={16} /></button>
              </li>
            )
          })}
        </ul>
      )}
      <Confirm open={!!confirmDiscard} onClose={() => setConfirmDiscard(null)} danger title="Discard this held sale?" confirmText="Discard" onConfirm={() => { if (confirmDiscard) cart.discardHeld(confirmDiscard); setConfirmDiscard(null) }} />
    </Modal>
  )
}

/* ------------------------------------------------------------------ Recent sales: reprint / void */
function RecentSales({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { store } = useAppStore()
  const canVoid = usePermission('void_sale')
  const canReturn = usePermission('return_items')
  const [view, setView] = useState<Sale | null>(null)
  const [toVoid, setToVoid] = useState<Sale | null>(null)
  const [toReturn, setToReturn] = useState<Sale | null>(null)
  const [slip, setSlip] = useState<SaleReturn | null>(null)
  const [busy, setBusy] = useState(false)
  const sales = useLiveQuery(async () => {
    if (!store || !open) return [] as Sale[]
    return db.sales.where('store_id').equals(store.id).reverse().sortBy('created_at').then((s) => s.slice(0, 25))
  }, [store?.id, open])
  const todayTotal = useMemo(() => { const d = new Date().toISOString().slice(0, 10); return (sales || []).filter((s) => s.status === 'active' && s.created_at.slice(0, 10) === d).reduce((a, s) => a + Number(s.total), 0) }, [sales])
  const doVoid = async () => {
    if (!toVoid) return
    setBusy(true)
    try { await voidSale(toVoid, 'Voided at POS'); toast.success('Transaction voided', `${toVoid.txn_no} · stock restored`); setToVoid(null); setView(null) } catch (e) { toast.error('Could not void', errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <>
      <Modal open={open && !view} onClose={onClose} title={<span className="flex items-center gap-2"><History size={18} /> Recent sales</span>} size="md">
        {!sales ? <div className="py-10 text-center text-sm text-slate-400">Loading…</div> : sales.length === 0 ? <EmptyState icon={<Receipt />} title="No sales yet" message="Completed sales appear here for reprinting or voiding." /> : (
          <ul className="divide-y divide-slate-100 -mx-1">
            {sales.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-1 py-2.5">
                <button className="flex-1 min-w-0 text-left" onClick={() => setView(s)}>
                  <div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-700">{s.txn_no}</span><Badge tone={s.status === 'void' ? 'red' : s.payment_method === 'credit' ? 'orange' : s.payment_method === 'gcash' ? 'blue' : 'green'}>{s.status === 'void' ? 'Void' : s.payment_method}</Badge></div>
                  <div className="text-xs text-slate-500 truncate">{fmtTime(s.created_at)}{s.cashier_name || memberName(s.created_by, '') ? ` · ${s.cashier_name || memberName(s.created_by, '')}` : ''}{s.customer_name ? ` · ${s.customer_name}` : ''} · {s.items.map((i) => `${i.name} ×${num(i.qty, 2)}`).join(', ')}</div>
                </button>
                <div className="text-right">
                  <div className={cls('font-bold tabular text-sm', s.status === 'void' ? 'text-slate-400 line-through' : 'text-slate-900')}>{peso(s.total)}</div>
                  {Number(s.refunded_total || 0) > 0 && <div className="text-[10px] font-semibold text-orange-700 tabular">−{peso(s.refunded_total)} refunded</div>}
                </div>
                {canReturn && s.status === 'active' && <button onClick={() => setToReturn(s)} title="Return items / partial refund" className="p-1.5 rounded-lg text-orange-700 hover:bg-orange-50" aria-label={`Return items of ${s.txn_no}`}><Undo2 size={16} /></button>}
                {canVoid && s.status === 'active' && !Number(s.refunded_total || 0) && <button onClick={() => setToVoid(s)} title="Void the whole sale" className="p-1.5 rounded-lg text-red-600 hover:bg-red-50" aria-label={`Void ${s.txn_no}`}><Ban size={16} /></button>}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>Today so far</span><span className="font-semibold text-slate-800 tabular">{peso(todayTotal)}</span></div>
        {!canVoid && <p className="text-[11px] text-slate-400 mt-1">Voids and returns need an owner or manager.</p>}
      </Modal>
      <ReceiptModal sale={view} onClose={() => setView(null)} onVoid={(s) => setToVoid(s)} />
      {toReturn && <ReturnModal sale={toReturn} onClose={() => setToReturn(null)} onDone={(r) => { setToReturn(null); setSlip(r) }} />}
      {slip && <ReturnSlipModal ret={slip} justCreated onClose={() => setSlip(null)} />}
      <Confirm open={!!toVoid} onClose={() => setToVoid(null)} danger loading={busy} title={`Void ${toVoid?.txn_no}?`} message={<>The sale of <b>{peso(toVoid?.total)}</b> is cancelled and every item goes back to stock{toVoid?.payment_method === 'credit' ? '; the unpaid credit is removed' : ''}. Hand the money back to the customer for a refund. This cannot be undone.</>} confirmText="Void & refund" onConfirm={doVoid} />
    </>
  )
}

/* ------------------------------------------------------------------ Custom item */
function CustomItemModal({ open, onClose, initialName }: { open: boolean; onClose: () => void; initialName: string }) {
  const cart = useCart()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  useEffect(() => { if (open) { setName(initialName); setPrice('') } }, [open, initialName])
  return (
    <Modal open={open} onClose={onClose} title="Custom item" size="sm" footer={<Button disabled={!name.trim() || !parseFloat(price)} onClick={() => { cart.addCustom(name.trim(), parseFloat(price)); onClose() }}>Add to cart</Button>}>
      <div className="space-y-3">
        <Field label="Item name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Load ₱50" /></Field>
        <Field label="Price"><MoneyInput value={price} onChange={setPrice} /></Field>
        <p className="text-xs text-slate-500">Custom items are not tracked in inventory.</p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ Checkout */
function CheckoutModal({ onClose, onCompleted }: { onClose: () => void; onCompleted: (s: Sale) => void }) {
  const { store, profile } = useAppStore()
  const cart = useCart()
  const totals = cartTotals(cart)
  const [method, setMethod] = useState<PaymentMethod>(cart.customer && cart.payment === 'credit' ? 'credit' : cart.payment === 'credit' ? 'cash' : cart.payment)
  const [tendered, setTendered] = useState('')
  const [partial, setPartial] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(cart.customer)
  const [busy, setBusy] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [showCust, setShowCust] = useState(false)
  const tender = parseFloat(tendered) || 0
  const change = round2(tender - totals.total)
  const quick = useMemo(() => {
    const t = totals.total
    const set = new Set<number>([Math.ceil(t)])
    for (const b of [20, 50, 100, 200, 500, 1000]) { const v = Math.ceil(t / b) * b; if (v >= t) set.add(v) }
    return [...set].filter((v) => v > 0).sort((a, b) => a - b).slice(0, 5)
  }, [totals.total])

  useEffect(() => { if (customer) customerBalance(customer.id).then(setBalance); else setBalance(null) }, [customer])

  const canPay = method === 'credit' ? !!customer : method === 'cash' ? tender >= totals.total || tendered === '' : true

  const complete = async () => {
    if (!store) return
    setBusy(true)
    try {
      const amount_paid = method === 'credit' ? (parseFloat(partial) || 0) : method === 'cash' ? (tendered === '' ? totals.total : tender) : totals.total
      const note = [cart.discountLabel ? `Discount: ${cart.discountLabel}` : '', cart.note.trim()].filter(Boolean).join(' · ') || null
      const sale = await createSale(store, {
        items: cart.lines.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, price: l.price, cost: l.cost, unit: l.unit })),
        discount: cart.discount, payment_method: method, amount_paid, customer: method === 'credit' ? customer : (customer || null), note,
      }, profile?.id ?? null)
      beep(true)
      cart.setPayment(method === 'credit' ? 'cash' : method)
      onCompleted(sale)
    } catch (e) { toast.error('Could not complete sale', errorMessage(e)) } finally { setBusy(false) }
  }

  const methods: Array<{ v: PaymentMethod; label: string; icon: JSX.Element }> = [
    { v: 'cash', label: 'Cash', icon: <Banknote size={20} /> },
    { v: 'gcash', label: 'GCash', icon: <Smartphone size={20} /> },
    { v: 'credit', label: 'Credit / Utang', icon: <HandCoins size={20} /> },
  ]

  return (
    <Modal open onClose={onClose} title="Payment" footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button variant="success" size="lg" loading={busy} disabled={!canPay || !cart.lines.length} onClick={complete} data-testid="complete-sale">{method === 'credit' ? 'Record utang' : 'Complete sale'}</Button></>}>
      <div className="text-center mb-4"><div className="text-xs uppercase tracking-wide text-slate-500">Amount due</div><div className="text-4xl font-black tabular text-slate-900">{peso(totals.total)}</div><div className="text-xs text-slate-500">{num(totals.count, 2)} items{cart.discount ? ` · ${peso(cart.discount)} discount${cart.discountLabel ? ` (${cart.discountLabel})` : ''}` : ''}</div></div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {methods.map((m) => <button key={m.v} onClick={() => setMethod(m.v)} className={cls('h-16 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-medium transition', method === m.v ? 'border-brand-600 bg-brand-50 text-brand-800 ring-2 ring-brand-100' : 'border-slate-200 text-slate-600')}>{m.icon}{m.label}</button>)}
      </div>

      {method === 'cash' && (
        <div className="space-y-3">
          <Field label="Cash received"><MoneyInput value={tendered} onChange={setTendered} big autoFocus placeholder={totals.total.toFixed(2)} /></Field>
          <div className="flex gap-2 flex-wrap">{quick.map((v) => <Chip key={v} active={tender === v} onClick={() => setTendered(String(v))}>₱{num(v)}</Chip>)}<Chip onClick={() => setTendered(String(totals.total))}>Exact</Chip></div>
          <div className={cls('rounded-xl p-3 flex justify-between items-center', change >= 0 && tendered !== '' ? 'bg-brand-50 text-brand-800' : 'bg-slate-50 text-slate-500')}><span className="text-sm font-medium">Change</span><span className="text-2xl font-black tabular">{tendered === '' ? '₱0.00' : change >= 0 ? peso(change) : 'Short ' + peso(-change)}</span></div>
        </div>
      )}
      {method === 'gcash' && <div className="rounded-xl bg-sky-50 text-sky-900 p-3 text-sm">Confirm the GCash payment of <b>{peso(totals.total)}</b> on your phone before completing.</div>}

      {method !== 'credit' && !customer && !showCust && <button onClick={() => setShowCust(true)} className="mt-4 text-xs text-brand-700 font-medium flex items-center gap-1"><UserPlus size={14} /> Attach customer (optional)</button>}
      {(method === 'credit' || customer || showCust) && (
        <div className="mt-4 space-y-3">
          <Field label={method === 'credit' ? 'Customer (required)' : 'Customer (optional)'}>
            <CustomerPicker value={customer} onChange={setCustomer} autoFocus={method === 'credit'} />
          </Field>
          {method === 'credit' && <Field label="Partial payment now (optional)"><MoneyInput value={partial} onChange={setPartial} /></Field>}
          {method === 'credit' && customer && <div className="rounded-xl bg-orange-50 text-orange-900 p-3 text-sm flex justify-between"><span>New balance after this sale</span><b className="tabular">{peso((balance || 0) + totals.total - (parseFloat(partial) || 0))}</b></div>}
        </div>
      )}
    </Modal>
  )
}
