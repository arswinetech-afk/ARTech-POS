import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, Save, Printer, Bluetooth, BluetoothConnected, ScanLine, Database, LogOut, ShieldCheck, Crown, RefreshCw, Trash2, RotateCcw, FileDown, Info, Store as StoreIcon } from 'lucide-react'
import { useAppStore, usePermission } from '../store/app'
import StaffCard from '../components/StaffCard'
import { ROLE_LABEL } from '../lib/permissions'
import { useSyncStore } from '../store/sync'
import { Button, Card, CardHeader, Field, Input, Segmented, Toggle, Textarea, Confirm } from '../components/ui'
import { usePrinter, buildReceipt, PAPER, type PaperWidth } from '../lib/printer'
import { syncNow, resetCursors, retryFailed, discardFailed } from '../lib/sync'
import { db } from '../lib/db'
import { toast } from '../store/ui'
import { errorMessage } from '../lib/supabase'
import { downloadText, toCSV, fmtDate, timeAgo } from '../lib/format'
import type { Sale } from '../lib/types'

async function compressLogo(file: File, size = 192): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file) })
  const c = document.createElement('canvas'); c.width = size; c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size)
  const s = Math.min(size / img.width, size / img.height)
  ctx.drawImage(img, (size - img.width * s) / 2, (size - img.height * s) / 2, img.width * s, img.height * s)
  let q = 0.8, out = c.toDataURL('image/jpeg', q)
  while (out.length > 24000 && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q) }
  return out
}

export default function Settings() {
  const { store, profile, isAdmin, access, role, updateStore, signOut } = useAppStore()
  const canEdit = usePermission('store_settings')
  const canDevice = usePermission('device_settings')
  const canImport = usePermission('import_data')
  const canBilling = usePermission('billing')
  const sync = useSyncStore()
  const printer = usePrinter()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState({ name: '', address: '', owner_name: '', contact: '', tin: '', receipt_footer: '' })
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [outboxCount, setOutboxCount] = useState(0)
  const [failedItems, setFailedItems] = useState<Array<{ seq?: number; error?: string | null; table?: string; rpc?: string }>>([])

  useEffect(() => { if (store) setF({ name: store.name, address: store.address || '', owner_name: store.owner_name || '', contact: store.contact || '', tin: store.tin || '', receipt_footer: store.receipt_footer || '' }) }, [store?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { db.outbox.count().then(setOutboxCount); db.outbox.filter((o) => !!o.error).toArray().then(setFailedItems) }, [sync.pending, sync.failed])

  if (!store) return null
  const settings = (store.settings || {}) as Record<string, unknown>
  const paper = ((store.paper_width || 58) as PaperWidth) in PAPER ? (store.paper_width as PaperWidth) : 58

  const save = async () => {
    setSaving(true)
    try { await updateStore({ ...f, name: f.name.trim() || store.name }); toast.success('Settings saved') } catch (e) { toast.error('Save failed', errorMessage(e)) } finally { setSaving(false) }
  }
  const patchSettings = (p: Record<string, unknown>) => updateStore({ settings: { ...settings, ...p } }).catch((e) => toast.error('Failed', errorMessage(e)))

  const onLogo = async (file?: File) => {
    if (!file) return
    try { const data = await compressLogo(file); await updateStore({ logo_data: data }); toast.success('Logo updated') } catch (e) { toast.error('Logo failed', errorMessage(e)) }
  }

  const testPrint = async () => {
    try {
      if (!printer.connected) await printer.connect()
      const sample: Sale = { id: 'test', store_id: store.id, txn_no: 'TEST01', items: [{ product_id: null, name: 'Sample item', qty: 2, price: 25, cost: 20 }, { product_id: null, name: 'Another product with a long name', qty: 1, price: 120.5, cost: 100 }], subtotal: 170.5, discount: 0, total: 170.5, cost_total: 140, profit: 30.5, payment_method: 'cash', customer_id: null, customer_name: null, amount_paid: 200, change_due: 29.5, status: 'active', note: null, created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      await printer.print(await buildReceipt(store, sample, { paper, cols: (settings.receipt_cols as number) || undefined }))
      toast.success('Test receipt sent')
    } catch (e) { toast.error('Print failed', errorMessage(e)) }
  }

  const exportAll = async () => {
    const sid = store.id
    const [products, sales, credits, customers, expenses] = await Promise.all([db.products.where('store_id').equals(sid).toArray(), db.sales.where('store_id').equals(sid).toArray(), db.credits.where('store_id').equals(sid).toArray(), db.customers.where('store_id').equals(sid).toArray(), db.expenses.where('store_id').equals(sid).toArray()])
    const nm = new Map(customers.map((c) => [c.id, c]))
    const d = new Date().toISOString().slice(0, 10)
    downloadText(`inventory-products-${d}.csv`, toCSV(products.map((p) => ({ Name: p.name, Barcode: p.barcode || '', Category: p.category || '', 'Purchase Price': p.cost, 'Selling Price': p.price, Stock: p.stock, Unit: p.unit || '', Description: p.description || '' }))))
    setTimeout(() => downloadText(`sales-transactions-${d}.csv`, toCSV(sales.map((s) => ({ 'Transaction #': s.txn_no, Date: s.created_at, Payment: s.payment_method, Customer: s.customer_name || '', 'Total Amount': s.total, Profit: s.profit, Discount: s.discount, Status: s.status.toUpperCase(), Items: s.items.map((i) => `${i.name} x${i.qty}`).join('; ') })))), 400)
    setTimeout(() => downloadText(`credits-${d}.csv`, toCSV(credits.map((c) => ({ Customer: nm.get(c.customer_id || '')?.name || '', Phone: nm.get(c.customer_id || '')?.phone || '', 'Total Debt': c.amount, 'Amount Paid': c.paid, Settled: c.settled, Notes: c.notes || '', Created: c.created_at })))), 800)
    setTimeout(() => downloadText(`expenses-${d}.csv`, toCSV(expenses.map((e) => ({ Date: e.expense_date, Category: e.category, Description: e.description, Amount: e.amount })))), 1200)
    toast.success('Exporting 4 CSV files')
  }

  const fullResync = async () => {
    await resetCursors(store.id)
    await db.transaction('rw', [db.products, db.customers, db.credits, db.credit_payments, db.sales, db.expenses, db.stock_movements, db.reminders], async () => { for (const t of [db.products, db.customers, db.credits, db.credit_payments, db.sales, db.expenses, db.stock_movements, db.reminders]) await t.clear() })
    await syncNow('full')
    toast.success('Re-downloaded data from the cloud')
    setConfirmReset(false)
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div><h1 className="text-2xl font-bold tracking-tight">Store Settings</h1><p className="text-sm text-slate-500">{canEdit ? 'Customize your store information' : `You are a ${ROLE_LABEL[role || 'viewer'].toLowerCase()} in this store — store details are managed by the owner.`}</p></div>

      {/* Subscription (admins see the console card instead) */}
      {!isAdmin && <Card className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${access.locked ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700'}`}><Crown /></span>
          <div><div className="font-semibold text-sm">{access.label}</div><div className="text-xs text-slate-500">{access.endsAt ? `${access.locked ? 'Ended' : 'Until'} ${fmtDate(access.endsAt.toISOString())}` : ''}{store.plan_id ? ` · ${store.plan_id} plan` : ''}</div></div>
        </div>
        <Button size="sm" variant={access.locked ? 'primary' : 'outline'} onClick={() => navigate('/subscription')}>{canBilling ? (access.state === 'trial' ? 'Choose plan' : access.locked ? 'Subscribe' : 'Manage') : 'Details'}</Button>
      </Card>}
      {isAdmin && <Card className="p-4 flex items-center justify-between bg-violet-50 border-violet-100"><div className="flex items-center gap-3"><ShieldCheck className="text-violet-700" /><div><div className="font-semibold text-sm text-violet-900">System Administrator</div><div className="text-xs text-violet-700">Unlimited access · manage users, subscriptions and GCash payments.</div></div></div><Button size="sm" onClick={() => navigate('/admin')} className="bg-violet-700 hover:bg-violet-800">Open Console</Button></Card>}

      {/* Logo */}
      <Card>
        <CardHeader title="Store Logo" icon={<StoreIcon size={18} />} />
        <div className="px-4 pb-4 flex items-center gap-4">
          {store.logo_data ? <img src={store.logo_data} className="w-20 h-20 rounded-2xl object-cover ring-1 ring-slate-200 bg-white" alt="logo" /> : <div className="w-20 h-20 rounded-2xl bg-brand-600 text-white flex items-center justify-center text-3xl font-black">{store.name.slice(0, 1)}</div>}
          <div className="space-y-2">
            <div className="text-sm font-medium">Upload Logo</div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
            {canEdit ? <>
              <div className="flex gap-2"><Button variant="outline" size="sm" icon={<Upload size={16} />} onClick={() => fileRef.current?.click()}>Choose Image</Button>{store.logo_data && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => updateStore({ logo_data: null })}>Remove logo</Button>}</div>
              <div className="text-[11px] text-slate-500">Compressed to a tiny 192px image so it syncs instantly and prints crisp on receipts.</div>
            </> : <div className="text-[11px] text-slate-500">Only owners and managers can change the logo.</div>}
          </div>
        </div>
      </Card>

      {/* Store info */}
      <Card>
        <CardHeader title="Store Information" />
        <fieldset disabled={!canEdit} className="px-4 pb-4 space-y-3 disabled:opacity-80">
          <Field label="Display Name" hint={<>Appears on receipts as: <b>“{f.name || store.name} powered by ARTech POS”</b></>}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Zone 3 Hanawan, Ocampo, Camarines Sur" /></Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Owner"><Input value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} /></Field>
            <Field label="Contact Number"><Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} inputMode="tel" /></Field>
          </div>
          <Field label="VAT Reg TIN #"><Input value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value })} placeholder="000-000-000-00000" /></Field>
          <Field label="Receipt footer"><Textarea value={f.receipt_footer} onChange={(e) => setF({ ...f, receipt_footer: e.target.value })} className="min-h-[56px]" placeholder="Thank you for shopping!" /></Field>
          <Field label="Low-stock threshold (units)"><Input type="number" inputMode="numeric" value={store.low_stock_threshold} onChange={(e) => updateStore({ low_stock_threshold: Math.max(0, parseInt(e.target.value) || 0) })} className="w-32" /></Field>
        </fieldset>
      </Card>

      {/* Staff & invitation codes */}
      <StaffCard />

      {/* Printer */}
      <Card>
        <CardHeader title="Printer Settings" icon={<Printer size={18} />} action={<button onClick={() => (printer.connected ? printer.disconnect() : printer.connect().then(() => toast.success('Connected', printer.name || '')).catch((e) => toast.error('Bluetooth', errorMessage(e))))} className={`h-8 px-3 rounded-full text-xs font-medium inline-flex items-center gap-1.5 ${printer.connected ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>{printer.connected ? <BluetoothConnected size={14} /> : <Bluetooth size={14} />}{printer.connected ? printer.name : 'Connect'}</button>} />
        <fieldset disabled={!canDevice} className="px-4 pb-4 space-y-3">
          <div><div className="text-sm font-medium mb-1">Thermal Paper Width</div>
            <Segmented value={String(paper) as '58' | '80'} onChange={(v) => updateStore({ paper_width: Number(v) })} options={[{ value: '58', label: '58mm (32 cols)' }, { value: '80', label: '80mm (48 cols)' }]} />
            <div className="text-xs text-slate-500 mt-1">Select the paper width your Bluetooth thermal printer uses. Small 48mm/57mm printers use the 58mm setting.</div></div>
          <Toggle checked={store.print_logo} onChange={(v) => updateStore({ print_logo: v })} label="Print logo on receipts" hint="Sends the logo as a small bitmap (slightly slower)" />
          <Toggle checked={!!settings.auto_print} onChange={(v) => patchSettings({ auto_print: v })} label="Auto-print after each sale" hint="When a printer is connected" />
          <Field label="Characters per line (advanced)" hint="Leave blank for the default. Try 30 or 42 if text wraps badly."><Input inputMode="numeric" className="w-32" placeholder={String(PAPER[paper].cols)} value={(settings.receipt_cols as number | undefined) ?? ''} onChange={(e) => patchSettings({ receipt_cols: e.target.value ? parseInt(e.target.value) : null })} /></Field>
          <Button variant="outline" size="sm" icon={<Printer size={16} />} onClick={testPrint}>Print test receipt</Button>
          {!printer.supported && <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 flex gap-2"><Info size={14} className="shrink-0 mt-0.5" /> Web Bluetooth is not available in this browser. Use Chrome on Android/Windows/macOS, or use the “Print via system dialog” option on receipts.</div>}
        </fieldset>
      </Card>

      {/* Scanner */}
      <Card>
        <CardHeader title="Barcode & QR Scanners" icon={<ScanLine size={18} />} />
        <div className="px-4 pb-4 text-sm text-slate-600 space-y-2">
          <p><b>Camera:</b> tap <em>Scan</em> in the POS. Continuous mode adds each item as you scan.</p>
          <p><b>Bluetooth / USB scanners</b> (cLabel, Netum, Eyoyo, etc.): pair in your phone's Bluetooth settings in <em>HID / keyboard</em> mode. They work on every screen automatically — no setup here.</p>
          <Toggle checked={!!settings.beep} onChange={(v) => patchSettings({ beep: v })} label="Beep on successful scan" />
        </div>
      </Card>

      {/* Receipt preview */}
      <Card>
        <CardHeader title="Receipt Header Preview" />
        <div className="px-4 pb-4"><div className="bg-white border border-slate-200 rounded-xl p-4 text-center font-mono text-xs text-slate-800 max-w-xs mx-auto">
          {store.logo_data && <img src={store.logo_data} className="w-14 h-14 mx-auto mb-2 object-contain" alt="" />}
          <div className="font-bold text-sm">{f.name || store.name}</div>{f.address && <div>{f.address}</div>}{f.owner_name && <div>{f.owner_name}</div>}{f.contact && <div>{f.contact}</div>}{f.tin && <div>TIN: {f.tin}</div>}<div className="text-slate-400">powered by ARTech POS</div>
        </div></div>
      </Card>

      {canEdit && <Button block size="lg" icon={<Save size={18} />} onClick={save} loading={saving}>Save Settings</Button>}

      {/* Data */}
      <Card>
        <CardHeader title="Data & Sync" icon={<Database size={18} />} subtitle={`Last sync ${timeAgo(sync.lastSyncAt)} · ${outboxCount} change(s) waiting`} />
        <div className="px-4 pb-4 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            {canImport && <Button variant="outline" icon={<Upload size={16} />} onClick={() => navigate('/settings/import')}>Import CSV (products, credits, sales)</Button>}
            <Button variant="outline" icon={<FileDown size={16} />} onClick={exportAll}>Export all data (CSV)</Button>
            <Button variant="outline" icon={<RefreshCw size={16} />} onClick={() => syncNow('manual')}>Sync now</Button>
            <Button variant="outline" icon={<RotateCcw size={16} />} onClick={() => setConfirmReset(true)}>Re-download from cloud</Button>
          </div>
          {failedItems.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-900 space-y-2">
              <div className="font-semibold">{failedItems.length} change(s) could not be uploaded</div>
              <ul className="list-disc pl-4 space-y-0.5">{failedItems.slice(0, 5).map((i) => <li key={i.seq}>{i.table || i.rpc}: {i.error}</li>)}</ul>
              <div className="flex gap-2"><Button size="xs" onClick={() => retryFailed()}>Retry</Button><Button size="xs" variant="ghost" className="text-red-700" icon={<Trash2 size={12} />} onClick={() => discardFailed().then(() => toast.info('Discarded failed changes'))}>Discard</Button></div>
            </div>
          )}
          <p className="text-[11px] text-slate-500">Your data lives on this device and in the cloud. Only changes are transferred, keeping data usage minimal. Sales history on this device covers the last 180 days; older reports are computed in the cloud.</p>
        </div>
      </Card>

      <Card className="p-4 flex items-center justify-between">
        <div><div className="text-sm font-medium">{profile?.full_name || profile?.email}</div><div className="text-xs text-slate-500">{profile?.email} · {isAdmin ? 'System Administrator' : ROLE_LABEL[role || 'owner']} · v2.1</div></div>
        <Button variant="outline" icon={<LogOut size={16} />} onClick={() => signOut()} className="text-red-600 border-red-200">Sign out</Button>
      </Card>

      <Confirm open={confirmReset} onClose={() => setConfirmReset(false)} title="Re-download all data?" message="Local copies will be replaced with the cloud data. Make sure pending changes are synced first." confirmText="Re-download" onConfirm={fullResync} />
    </div>
  )
}
