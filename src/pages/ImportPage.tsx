import { useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowLeft, Package, Users, Receipt } from 'lucide-react'
import { useAppStore, usePermission } from '../store/app'
import { Button, Card, Toggle, Badge } from '../components/ui'
import { parseCSV, buildPlan, commitPlan, type ParsedCSV, type ImportPlan } from '../lib/importer'
import { peso, num, cls } from '../lib/format'
import { toast } from '../store/ui'
import { errorMessage } from '../lib/supabase'

const LABEL = { products: { title: 'Products / Inventory', icon: <Package size={18} />, tone: 'brand' }, credits: { title: 'Credits (Utang)', icon: <Users size={18} />, tone: 'orange' }, sales: { title: 'Sales Transactions', icon: <Receipt size={18} />, tone: 'blue' }, unknown: { title: 'Unknown file', icon: <AlertTriangle size={18} />, tone: 'red' } } as const

export default function ImportPage() {
  const { store } = useAppStore()
  const navigate = useNavigate()
  const canImport = usePermission('import_data')
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedCSV | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [skipExisting, setSkipExisting] = useState(true)
  const [merge, setMerge] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [done, setDone] = useState<ImportPlan | null>(null)
  const [drag, setDrag] = useState(false)

  const load = async (file?: File | null) => {
    if (!file || !store) return
    if (busy) { toast.info('Please wait', 'The current import is still running.'); return }
    setDone(null); setBusy(true)
    try {
      const p = await parseCSV(file)
      setParsed(p)
      setPlan(await buildPlan(store, p, { skipExisting, mergeDuplicateNames: merge }))
    } catch (e) { toast.error('Could not read file', errorMessage(e)) } finally { setBusy(false) }
  }
  const rebuild = async (opts: { skipExisting: boolean; mergeDuplicateNames: boolean }) => { if (parsed && store) setPlan(await buildPlan(store, parsed, opts)) }

  const run = async () => {
    if (!plan) return
    setBusy(true)
    try {
      await commitPlan(plan, setProgress)
      setDone(plan); setPlan(null); setParsed(null)
      toast.success('Import complete', `${plan.products.length + plan.credits.length + plan.sales.length} records added`)
    } catch (e) { toast.error('Import failed', errorMessage(e)) } finally { setBusy(false); setProgress('') }
  }

  const total = plan ? plan.products.length + plan.customers.length + plan.credits.length + plan.sales.length : 0

  if (!canImport) return <Navigate to="/settings" replace />
  return (
    <div className="space-y-4 max-w-3xl">
      <button onClick={() => navigate(-1)} className="text-sm text-slate-500 flex items-center gap-1"><ArrowLeft size={16} /> Back</button>
      <div><h1 className="text-2xl font-bold tracking-tight">Import data</h1><p className="text-sm text-slate-500">Bring in your exports from the previous ARTech POS (base44): <b>inventory-products.csv</b>, <b>credits.csv</b>, <b>sales-transactions.csv</b>. Import products first, then credits, then sales.</p></div>

      <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]) }} onClick={() => { if (!busy) fileRef.current?.click() }}
        className={cls('rounded-2xl border-2 border-dashed p-8 text-center transition', busy ? 'opacity-60 cursor-wait' : 'cursor-pointer', drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white hover:border-brand-400')}>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" disabled={busy} onChange={(e) => { load(e.target.files?.[0]); e.target.value = '' }} />
        <FileSpreadsheet className="mx-auto text-brand-600 mb-2" size={36} />
        <div className="font-medium">Tap to choose a CSV file</div><div className="text-xs text-slate-500 mt-1">or drag & drop here · the file type is detected automatically</div>
      </div>

      {busy && !plan && <div className="text-sm text-slate-500">Reading file…</div>}

      {plan && parsed && (
        <Card className="animate-fade-in">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">{LABEL[plan.type].icon} {LABEL[plan.type].title}</div>
            <Badge tone={plan.type === 'unknown' ? 'red' : 'brand'}>{parsed.fileName}</Badge>
          </div>
          <div className="px-4 pb-4 space-y-3">
            <div className="text-xs text-slate-500">Detected columns: {parsed.headers.join(', ')} · {num(parsed.rows.length)} rows</div>
            {plan.type !== 'unknown' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(plan.stats).map(([k, v]) => <div key={k} className="rounded-xl bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">{k}</div><div className="font-bold text-slate-900 tabular text-sm">{typeof v === 'number' && /value|balance|sales/.test(k) ? peso(v) : typeof v === 'number' ? num(v) : v}</div></div>)}
                {plan.skipped > 0 && <div className="rounded-xl bg-amber-50 p-3"><div className="text-[11px] uppercase tracking-wide text-amber-700">skipped</div><div className="font-bold text-amber-800 tabular text-sm">{num(plan.skipped)}</div></div>}
              </div>
            )}
            {plan.warnings.map((w, i) => <div key={i} className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> {w}</div>)}
            <div className="border-t border-slate-100 pt-2">
              <Toggle checked={skipExisting} onChange={(v) => { setSkipExisting(v); rebuild({ skipExisting: v, mergeDuplicateNames: merge }) }} label="Skip records that already exist" hint={plan.type === 'products' ? 'Matches by item name' : plan.type === 'sales' ? 'Matches by transaction #' : 'Matches by customer, amount and date'} />
              {plan.type === 'products' && <Toggle checked={merge} onChange={(v) => { setMerge(v); rebuild({ skipExisting, mergeDuplicateNames: v }) }} label="Merge duplicate names inside the file" hint="Combines stock of rows with the same name (off = import all rows)" />}
            </div>
            {plan.type === 'products' && plan.products.length > 0 && <Preview rows={plan.products.slice(0, 5).map((p) => [p.name, p.barcode || '—', p.category || '—', peso(p.cost), peso(p.price), num(p.stock, 2)])} head={['Name', 'Barcode', 'Category', 'Cost', 'Price', 'Stock']} />}
            {plan.type === 'credits' && plan.credits.length > 0 && <Preview rows={plan.credits.slice(0, 5).map((c) => [plan.customers.find((x) => x.id === c.customer_id)?.name || '(existing)', peso(c.amount), peso(c.paid), c.settled ? 'yes' : 'no', c.created_at.slice(0, 10)])} head={['Customer', 'Debt', 'Paid', 'Settled', 'Date']} />}
            {plan.type === 'sales' && plan.sales.length > 0 && <Preview rows={plan.sales.slice(0, 5).map((s) => [s.txn_no, s.created_at.slice(0, 16).replace('T', ' '), s.payment_method, peso(s.total), s.items.map((i) => `${i.name} ×${i.qty}`).join(', ')])} head={['Txn #', 'Date (UTC)', 'Payment', 'Total', 'Items']} />}
            <div className="flex items-center justify-between pt-2">
              <div className="text-sm text-slate-600">{progress || (total ? <><b>{num(total)}</b> records ready to import</> : 'Nothing to import')}</div>
              <div className="flex gap-2"><Button variant="outline" onClick={() => { setPlan(null); setParsed(null) }}>Cancel</Button><Button onClick={run} loading={busy} disabled={!total} icon={<Upload size={16} />}>Import {num(total)}</Button></div>
            </div>
          </div>
        </Card>
      )}

      {done && (
        <Card className="p-5 text-center animate-fade-in">
          <CheckCircle2 className="mx-auto text-brand-600" size={40} />
          <div className="font-bold text-lg mt-2">Import complete</div>
          <div className="text-sm text-slate-600">{done.products.length ? `${num(done.products.length)} products` : ''}{done.customers.length ? ` · ${num(done.customers.length)} customers` : ''}{done.credits.length ? ` · ${num(done.credits.length)} credits` : ''}{done.sales.length ? ` · ${num(done.sales.length)} sales` : ''} added. Data is available immediately on this device and uploads in the background.</div>
          <div className="flex gap-2 justify-center mt-4"><Button variant="outline" onClick={() => fileRef.current?.click()}>Import another file</Button><Button onClick={() => navigate(done.type === 'products' ? '/items' : done.type === 'credits' ? '/credits' : '/reports')}>View {done.type}</Button></div>
        </Card>
      )}

      <Card className="p-4 text-xs text-slate-600 space-y-1">
        <div className="font-semibold text-slate-800 text-sm">Tips</div>
        <p>• Imported sales keep their original transaction numbers, dates and totals; line items are matched to products by name so Top Products still works.</p>
        <p>• Credits are grouped into customers by name (case-insensitive). Unsettled rows become open balances you can collect from the Credits tab.</p>
        <p>• Large files are uploaded in chunks of 250 rows. If you're offline the import is saved on the device and uploaded later.</p>
      </Card>
    </div>
  )
}

function Preview({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{head.map((h) => <th key={h} className="text-left px-2 py-1.5 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="px-2 py-1.5 whitespace-nowrap max-w-[200px] truncate">{c}</td>)}</tr>)}</tbody></table>
      <div className="text-[10px] text-slate-400 px-2 py-1">Preview of first rows</div>
    </div>
  )
}
