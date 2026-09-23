import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Plus, ScanLine, Package, Upload, Download, PackagePlus, Trash2, X } from 'lucide-react'
import { db } from '../lib/db'
import { useAppStore, usePermission } from '../store/app'
import { Button, Input, Field, Select, Modal, MoneyInput, EmptyState, Chip, Confirm, Segmented, PageHeader, Textarea } from '../components/ui'
import CameraScanner from '../components/CameraScanner'
import { createProduct, updateProduct, deleteProduct, adjustStock } from '../lib/repo'
import { useBarcode } from '../lib/scanner'
import { peso, num, cls, downloadText, toCSV, round2 } from '../lib/format'
import { toast } from '../store/ui'
import { errorMessage } from '../lib/supabase'
import { CATEGORIES, type Product } from '../lib/types'

type Filter = 'all' | 'low' | 'out' | 'nobarcode'

export default function Items() {
  const { store } = useAppStore()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [cat, setCat] = useState('All')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<'name' | 'stock' | 'value' | 'recent'>('name')
  const [editing, setEditing] = useState<Product | null | 'new'>(null)
  const [stockFor, setStockFor] = useState<Product | null>(null)
  const [scan, setScan] = useState(false)
  const [limit, setLimit] = useState(80)
  const threshold = store?.low_stock_threshold ?? 5
  const canManage = usePermission('manage_items')
  const canSeeCost = usePermission('see_cost')
  const canImport = usePermission('import_data')

  const products = useLiveQuery(() => store ? db.products.where('store_id').equals(store.id).toArray() : Promise.resolve([] as Product[]), [store?.id], [] as Product[])

  useEffect(() => { if (params.get('new')) { setEditing('new') } }, [params])

  useBarcode((code) => {
    const hit = products.find((p) => p.barcode === code)
    if (hit) setEditing(hit)
    else { setQ(code); toast.info('No item with this barcode', 'Tap + to create it.') }
  }, !editing && !scan && !stockFor)

  const categories = useMemo(() => [...new Set(products.map((p) => p.category || 'Other'))].sort(), [products])
  const list = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    let l = products
    if (cat !== 'All') l = l.filter((p) => (p.category || 'Other') === cat)
    if (filter === 'low') l = l.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= (p.low_stock_at ?? threshold))
    if (filter === 'out') l = l.filter((p) => Number(p.stock) <= 0)
    if (filter === 'nobarcode') l = l.filter((p) => !p.barcode)
    if (tokens.length) l = l.filter((p) => tokens.every((t) => p.name.toLowerCase().includes(t)) || (p.barcode || '').includes(q.trim()))
    const s = [...l]
    if (sort === 'name') s.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'stock') s.sort((a, b) => Number(a.stock) - Number(b.stock))
    if (sort === 'value') s.sort((a, b) => Number(b.stock) * Number(b.cost) - Number(a.stock) * Number(a.cost))
    if (sort === 'recent') s.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return s
  }, [products, q, cat, filter, sort, threshold])

  const stats = useMemo(() => ({
    count: products.length,
    value: products.reduce((a, p) => a + Number(p.cost) * Number(p.stock), 0),
    retail: products.reduce((a, p) => a + Number(p.price) * Number(p.stock), 0),
    low: products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= (p.low_stock_at ?? threshold)).length,
    out: products.filter((p) => Number(p.stock) <= 0).length,
  }), [products, threshold])

  const exportCSV = () => downloadText(`inventory-products-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(products.map((p) => ({ Name: p.name, Barcode: p.barcode || '', Category: p.category || '', 'Purchase Price': p.cost, 'Selling Price': p.price, Stock: p.stock, Unit: p.unit || '', Description: p.description || '' }))))

  if (!store) return null
  return (
    <div className="space-y-3">
      <PageHeader title="Items" subtitle={canSeeCost ? `${num(stats.count)} products · stock value ${peso(stats.value)}` : `${num(stats.count)} products`} action={<>
        {canImport && <Button variant="outline" size="sm" icon={<Upload size={16} />} onClick={() => navigate('/settings/import')} className="hidden sm:inline-flex">Import</Button>}
        {canSeeCost && <Button variant="outline" size="sm" icon={<Download size={16} />} onClick={exportCSV} className="hidden sm:inline-flex">Export</Button>}
        {canManage && <Button size="sm" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Add</Button>}
      </>} />

      <div className="grid grid-cols-4 gap-2 text-center">
        {([['all', 'All', stats.count, 'slate'], ['low', 'Low', stats.low, 'yellow'], ['out', 'Out', stats.out, 'red'], ['nobarcode', 'No code', products.filter((p) => !p.barcode).length, 'blue']] as const).map(([k, label, v, tone]) => (
          <button key={k} onClick={() => setFilter(k)} className={cls('rounded-xl border p-2 transition', filter === k ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white')}>
            <div className={cls('text-lg font-bold', tone === 'red' ? 'text-red-600' : tone === 'yellow' ? 'text-amber-600' : tone === 'blue' ? 'text-sky-600' : 'text-slate-800')}>{num(v)}</div><div className="text-[11px] text-slate-500">{label}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <Input value={q} onChange={(e) => { setQ(e.target.value); setLimit(80) }} placeholder="Search name or barcode" left={<Search size={18} />} data-keep-scan right={q ? <button onClick={() => { setQ(''); setParams({}) }} className="p-2 text-slate-400"><X size={16} /></button> : undefined} />
        <Button variant="outline" onClick={() => setScan(true)} icon={<ScanLine size={18} />} className="shrink-0 px-3" />
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-32 shrink-0"><option value="name">A–Z</option><option value="stock">Stock ↑</option><option value="value">Value ↓</option><option value="recent">Recent</option></Select>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
        <Chip active={cat === 'All'} onClick={() => setCat('All')}>All</Chip>
        {categories.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{c}</Chip>)}
      </div>

      {products.length === 0 ? (
        <EmptyState icon={<Package />} title="No products yet" message={canManage ? 'Import your existing product list (CSV) or add items one by one.' : 'The owner has not added items yet.'} action={canManage ? <div className="flex gap-2"><Button onClick={() => navigate('/settings/import')} icon={<Upload size={16} />}>Import CSV</Button><Button variant="outline" onClick={() => setEditing('new')}>Add item</Button></div> : undefined} />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-card divide-y divide-slate-100">
          {list.slice(0, limit).map((p) => {
            const low = Number(p.stock) > 0 && Number(p.stock) <= (p.low_stock_at ?? threshold)
            const out = Number(p.stock) <= 0
            const margin = p.price ? ((Number(p.price) - Number(p.cost)) / Number(p.price)) * 100 : 0
            return (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                <button className="flex-1 min-w-0 text-left" onClick={() => canManage ? setEditing(p) : toast.info('View only', 'Only owners and managers can edit items.')}>
                  <div className="font-medium text-slate-800 text-sm truncate">{p.name}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                    <span className="tabular font-semibold text-brand-700">{peso(p.price)}</span>
                    {canSeeCost && Number(p.cost) > 0 && <span className="tabular">cost {peso(p.cost)} · {margin.toFixed(0)}%</span>}
                    {p.category && <span>· {p.category}</span>}
                    {p.barcode && <span className="font-mono text-[10px] bg-slate-100 px-1 rounded">{p.barcode}</span>}
                  </div>
                </button>
                <button onClick={() => canManage ? setStockFor(p) : undefined} className={cls('shrink-0 min-w-[64px] h-9 rounded-lg text-sm font-bold tabular flex items-center justify-center gap-1', out ? 'bg-red-100 text-red-700' : low ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700')}>{num(p.stock, 2)}<PackagePlus size={14} className="opacity-60" /></button>
              </div>
            )
          })}
          {list.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No items match.</div>}
          {list.length > limit && <button onClick={() => setLimit(limit + 100)} className="w-full h-11 text-sm text-brand-700 font-medium">Show more ({list.length - limit} remaining)</button>}
        </div>
      )}

      {editing && <ProductModal product={editing === 'new' ? null : editing} initialBarcode={params.get('barcode') || undefined} onClose={() => { setEditing(null); if (params.get('new')) setParams({}) }} />}
      {stockFor && <StockModal product={stockFor} onClose={() => setStockFor(null)} />}
      {scan && <CameraScanner onClose={() => setScan(false)} onScan={(code) => { const hit = products.find((p) => p.barcode === code); if (hit) setEditing(hit); else { setQ(code); toast.info('Not found', 'Create a product with this barcode.') } }} />}
    </div>
  )
}

/* ------------------------------------------------------------------ Product form */
export function ProductModal({ product, onClose, initialBarcode }: { product: Product | null; onClose: () => void; initialBarcode?: string }) {
  const { store } = useAppStore()
  const [f, setF] = useState({ name: product?.name || '', barcode: product?.barcode || initialBarcode || '', category: product?.category || '', cost: product ? String(product.cost) : '', price: product ? String(product.price) : '', stock: product ? String(product.stock) : '0', unit: product?.unit || '', description: product?.description || '', low_stock_at: product?.low_stock_at != null ? String(product.low_stock_at) : '' })
  const [scan, setScan] = useState(false)
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }))
  const margin = parseFloat(f.price) && parseFloat(f.cost) ? ((parseFloat(f.price) - parseFloat(f.cost)) / parseFloat(f.price)) * 100 : null
  useBarcode((code) => set('barcode', code), !scan)

  const save = async () => {
    if (!store) return
    if (!f.name.trim()) { toast.error('Name is required'); return }
    setBusy(true)
    try {
      const patch = { name: f.name.trim(), barcode: f.barcode.trim() || null, category: f.category || null, cost: round2(parseFloat(f.cost) || 0), price: round2(parseFloat(f.price) || 0), unit: f.unit.trim() || null, description: f.description.trim() || null, low_stock_at: f.low_stock_at === '' ? null : parseInt(f.low_stock_at) }
      if (product) {
        await updateProduct(product, patch)
        const newStock = parseFloat(f.stock)
        if (Number.isFinite(newStock) && newStock !== Number(product.stock)) await adjustStock(store, { ...product, ...patch }, round2(newStock - Number(product.stock)), { type: 'adjustment', note: 'Stock corrected in item form' })
        toast.success('Item updated')
      } else {
        await createProduct(store, { ...patch, stock: parseFloat(f.stock) || 0 })
        toast.success('Item added', f.name)
      }
      onClose()
    } catch (e) { toast.error('Save failed', errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={product ? 'Edit item' : 'New item'} footer={<>
      {product && <Button variant="ghost" className="text-red-600 mr-auto" icon={<Trash2 size={16} />} onClick={() => setDel(true)}>Delete</Button>}
      <Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{product ? 'Save changes' : 'Add item'}</Button>
    </>}>
      <div className="space-y-3">
        <Field label="Item name" required><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Lucky Me Pancit Canton 60g" autoFocus={!product} /></Field>
        <Field label="Barcode / QR" hint="Scan with the camera or a Bluetooth scanner, or type it.">
          <Input value={f.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="4800016xxxxxx" inputMode="numeric" className="font-mono" data-keep-scan right={<button type="button" onClick={() => setScan(true)} className="h-8 w-8 rounded-lg bg-brand-600 text-white flex items-center justify-center"><ScanLine size={16} /></button>} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><Input list="cat-list" value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Groceries" /><datalist id="cat-list">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Unit"><Input list="unit-list" value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="pcs / pack / kg" /><datalist id="unit-list">{['pcs', 'pack', 'kg', 'g', 'L', 'mL', 'sack', 'box', 'bottle', 'sachet'].map((u) => <option key={u} value={u} />)}</datalist></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase price (cost)"><MoneyInput value={f.cost} onChange={(v) => set('cost', v)} /></Field>
          <Field label="Selling price" required><MoneyInput value={f.price} onChange={(v) => set('price', v)} /></Field>
        </div>
        {margin != null && <div className={cls('text-xs rounded-lg px-3 py-2', margin < 0 ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-800')}>Margin {margin.toFixed(1)}% · profit {peso(parseFloat(f.price) - parseFloat(f.cost))} per unit</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={product ? 'Stock on hand' : 'Opening stock'} hint={product ? 'Changing this records an adjustment' : undefined}><Input inputMode="decimal" value={f.stock} onChange={(e) => set('stock', e.target.value.replace(/[^0-9.-]/g, ''))} /></Field>
          <Field label="Low-stock alert at" hint={`Blank = store default (${store?.low_stock_threshold ?? 5})`}><Input inputMode="numeric" value={f.low_stock_at} onChange={(e) => set('low_stock_at', e.target.value.replace(/[^0-9]/g, ''))} placeholder={String(store?.low_stock_threshold ?? 5)} /></Field>
        </div>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional notes" className="min-h-[60px]" /></Field>
      </div>
      {scan && <CameraScanner onClose={() => setScan(false)} onScan={(c) => { set('barcode', c) }} title="Scan item barcode" />}
      <Confirm open={del} onClose={() => setDel(false)} danger title="Delete item?" message={<>“{product?.name}” will be removed from your inventory. Past sales are kept.</>} confirmText="Delete" onConfirm={async () => { if (product) { await deleteProduct(product); toast.success('Item deleted'); onClose() } }} />
    </Modal>
  )
}

/* ------------------------------------------------------------------ Stock in / adjust */
function StockModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { store } = useAppStore()
  const [mode, setMode] = useState<'in' | 'set' | 'out'>('in')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState(String(product.cost || ''))
  const [updateCost, setUpdateCost] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const n = parseFloat(qty) || 0
  const delta = mode === 'in' ? n : mode === 'out' ? -n : round2(n - Number(product.stock))
  const apply = async () => {
    if (!store || !delta) { onClose(); return }
    setBusy(true)
    try {
      await adjustStock(store, product, delta, { type: mode === 'in' ? 'purchase' : 'adjustment', unit_cost: mode === 'in' ? parseFloat(cost) || null : null, note: note || (mode === 'in' ? 'Stock in' : mode === 'out' ? 'Stock out' : 'Stock count'), update_cost: mode === 'in' && updateCost })
      toast.success('Stock updated', `${product.name}: ${num(Number(product.stock) + delta, 2)}`)
      onClose()
    } catch (e) { toast.error('Failed', errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Adjust stock" size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={apply} loading={busy} disabled={!qty}>Apply</Button></>}>
      <div className="font-medium text-slate-800 mb-1">{product.name}</div>
      <div className="text-sm text-slate-500 mb-3">Current stock: <b className="tabular">{num(product.stock, 2)} {product.unit || ''}</b></div>
      <Segmented value={mode} onChange={setMode} className="mb-3 w-full" options={[{ value: 'in', label: 'Stock in (+)' }, { value: 'out', label: 'Stock out (−)' }, { value: 'set', label: 'Set count' }]} />
      <Field label={mode === 'set' ? 'Actual count' : 'Quantity'}><Input inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} className="text-2xl h-14 font-bold text-center" /></Field>
      {mode === 'in' && (
        <div className="mt-3 space-y-2">
          <Field label="Unit cost (optional)"><MoneyInput value={cost} onChange={setCost} /></Field>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} className="accent-brand-600" /> Update item cost to this price</label>
        </div>
      )}
      <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Supplier, reason…" className="mt-3" /></Field>
      {!!qty && <div className="mt-3 text-sm rounded-xl bg-slate-50 p-3 flex justify-between"><span>New stock</span><b className="tabular">{num(Number(product.stock) + delta, 2)}</b></div>}
    </Modal>
  )
}
