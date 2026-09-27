import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Plus, Users, HandCoins, Phone, ChevronRight, Download, Wallet, Receipt as ReceiptIcon, Pencil } from 'lucide-react'
import { db } from '../lib/db'
import { useAppStore, usePermission } from '../store/app'
import { Button, Input, Field, Modal, MoneyInput, Badge, EmptyState, Segmented, PageHeader, Select, Textarea, Chip } from '../components/ui'
import { createCustomer, updateCustomer, addCredit, recordCreditPayment } from '../lib/repo'
import { peso, cls, fmtRelative, downloadText, toCSV, initials, round2 } from '../lib/format'
import { toast } from '../store/ui'
import { errorMessage } from '../lib/supabase'
import type { Customer, Credit, CreditPayment, SaleItem } from '../lib/types'

const itemsSummary = (items: SaleItem[] | undefined) =>
  items && items.length ? items.map((i) => `${i.qty}× ${i.name}`).join(', ') : ''

interface Row { customer: Customer; balance: number; open: number; lastAt: string | null }

export default function Credits() {
  const { store } = useAppStore()
  const [q, setQ] = useState('')
  const [view, setView] = useState<'balance' | 'all'>('balance')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [newCust, setNewCust] = useState(false)
  const canManage = usePermission('manage_customers')

  const data = useLiveQuery(async () => {
    if (!store) return null
    const [customers, credits] = await Promise.all([db.customers.where('store_id').equals(store.id).toArray(), db.credits.where('store_id').equals(store.id).toArray()])
    const byCust = new Map<string, Credit[]>()
    for (const c of credits) { const k = c.customer_id || ''; byCust.set(k, [...(byCust.get(k) || []), c]) }
    const rows: Row[] = customers.map((cu) => {
      const cs = byCust.get(cu.id) || []
      const open = cs.filter((c) => !c.settled)
      return { customer: cu, balance: round2(open.reduce((a, c) => a + Number(c.amount) - Number(c.paid), 0)), open: open.length, lastAt: cs.reduce<string | null>((m, c) => (!m || c.created_at > m ? c.created_at : m), null) }
    })
    const total = rows.reduce((a, r) => a + r.balance, 0)
    return { rows, total, debtors: rows.filter((r) => r.balance > 0).length }
  }, [store?.id])

  const list = useMemo(() => {
    if (!data) return []
    let l = data.rows
    if (view === 'balance') l = l.filter((r) => r.balance > 0)
    if (q.trim()) l = l.filter((r) => r.customer.name.toLowerCase().includes(q.toLowerCase()) || (r.customer.phone || '').includes(q))
    return [...l].sort((a, b) => b.balance - a.balance || a.customer.name.localeCompare(b.customer.name))
  }, [data, q, view])

  const exportCSV = async () => {
    if (!store) return
    const [customers, credits] = await Promise.all([db.customers.where('store_id').equals(store.id).toArray(), db.credits.where('store_id').equals(store.id).toArray()])
    const nm = new Map(customers.map((c) => [c.id, c]))
    const saleIds = credits.map((c) => c.sale_id).filter((id): id is string => !!id)
    const sales = saleIds.length ? await db.sales.where('id').anyOf(saleIds).toArray() : []
    const si = new Map(sales.map((s) => [s.id, s.items]))
    downloadText(`credits-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(credits.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((c) => ({ Customer: nm.get(c.customer_id || '')?.name || '', Phone: nm.get(c.customer_id || '')?.phone || '', Items: c.sale_id ? itemsSummary(si.get(c.sale_id)) : '', 'Total Debt': c.amount, 'Amount Paid': c.paid, Settled: c.settled, Notes: c.notes || '', Created: c.created_at }))))
  }

  if (!store) return null
  return (
    <div className="space-y-3">
      <PageHeader title="Credits" subtitle="Utang / receivables" action={<><Button variant="outline" size="sm" icon={<Download size={16} />} onClick={exportCSV} className="hidden sm:inline-flex">Export</Button>{canManage && <Button size="sm" icon={<Plus size={16} />} onClick={() => setNewCust(true)}>Customer</Button>}</>} />

      <div className="bg-gradient-to-br from-orange-500 to-amber-500 text-white rounded-2xl p-4 shadow-card flex items-center justify-between">
        <div><div className="text-xs uppercase tracking-wide text-white/80">Total outstanding</div><div className="text-3xl font-black tabular">{peso(data?.total)}</div><div className="text-xs text-white/80 mt-0.5">{data?.debtors ?? 0} customer{data?.debtors === 1 ? '' : 's'} with balance</div></div>
        <Wallet size={40} className="text-white/60" />
      </div>

      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer" left={<Search size={18} />} />
        <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'balance', label: 'With balance' }, { value: 'all', label: 'All' }]} className="shrink-0" />
      </div>

      {data && data.rows.length === 0 ? (
        <EmptyState icon={<Users />} title="No customers yet" message="Customers are created automatically when you record a credit sale, or add them here." action={canManage ? <Button onClick={() => setNewCust(true)}>Add customer</Button> : undefined} />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-card divide-y divide-slate-100">
          {list.map((r) => (
            <button key={r.customer.id} onClick={() => setSelected(r.customer)} className="w-full flex items-center gap-3 px-3 py-3 text-left">
              <div className={cls('w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0', r.balance > 0 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600')}>{initials(r.customer.name)}</div>
              <div className="flex-1 min-w-0"><div className="font-medium text-slate-800 truncate">{r.customer.name}</div><div className="text-xs text-slate-500">{r.open ? `${r.open} unpaid · ` : ''}{r.lastAt ? `last ${fmtRelative(r.lastAt)}` : 'no credit yet'}{r.customer.phone ? ` · ${r.customer.phone}` : ''}</div></div>
              <div className={cls('font-bold tabular', r.balance > 0 ? 'text-orange-600' : 'text-slate-400')}>{peso(r.balance)}</div>
              <ChevronRight size={16} className="text-slate-300" />
            </button>
          ))}
          {list.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No customers match.</div>}
        </div>
      )}

      {selected && <CustomerModal customer={selected} onClose={() => setSelected(null)} />}
      <NewCustomerModal open={newCust} onClose={() => setNewCust(false)} onCreated={(c) => setSelected(c)} />
    </div>
  )
}

function NewCustomerModal({ open, onClose, onCreated, existing }: { open: boolean; onClose: () => void; onCreated?: (c: Customer) => void; existing?: Customer }) {
  const { store } = useAppStore()
  const [name, setName] = useState(existing?.name || '')
  const [phone, setPhone] = useState(existing?.phone || '')
  const [notes, setNotes] = useState(existing?.notes || '')
  const save = async () => {
    if (!store || !name.trim()) return
    try {
      if (existing) { await updateCustomer(existing, { name: name.trim(), phone: phone.trim() || null, notes: notes || null }); toast.success('Customer updated') }
      else { const c = await createCustomer(store, name, phone, notes); toast.success('Customer added'); onCreated?.(c) }
      onClose()
    } catch (e) { toast.error('Failed', errorMessage(e)) }
  }
  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit customer' : 'New customer'} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!name.trim()}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" left={<Phone size={16} />} /></Field>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" /></Field>
      </div>
    </Modal>
  )
}

function CustomerModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { store } = useAppStore()
  const canPay = usePermission('record_payment')
  const canEditCustomer = usePermission('manage_customers')
  const [action, setAction] = useState<'pay' | 'charge' | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(false)

  const data = useLiveQuery(async () => {
    const [credits, payments, cust] = await Promise.all([
      db.credits.where('customer_id').equals(customer.id).toArray(),
      db.credit_payments.where('customer_id').equals(customer.id).toArray(),
      db.customers.get(customer.id),
    ])
    const saleIds = credits.map((c) => c.sale_id).filter((id): id is string => !!id)
    const sales = saleIds.length ? await db.sales.where('id').anyOf(saleIds).toArray() : []
    const saleItems = new Map(sales.map((s) => [s.id, s.items]))
    const balance = round2(credits.filter((c) => !c.settled).reduce((a, c) => a + Number(c.amount) - Number(c.paid), 0))
    const ledger: Array<{ kind: 'charge' | 'payment'; at: string; row: Credit | CreditPayment }> = [
      ...credits.map((c) => ({ kind: 'charge' as const, at: c.created_at, row: c })),
      ...payments.map((p) => ({ kind: 'payment' as const, at: p.created_at, row: p })),
    ].sort((a, b) => b.at.localeCompare(a.at))
    return { balance, ledger, saleItems, cust: cust || customer, totalCharged: credits.reduce((a, c) => a + Number(c.amount), 0), totalPaid: payments.reduce((a, p) => a + Number(p.amount), 0) }
  }, [customer.id])

  const submit = async () => {
    if (!store || !data) return
    const n = parseFloat(amount)
    if (!n || n <= 0) return
    setBusy(true)
    try {
      if (action === 'pay') { await recordCreditPayment(store, data.cust, Math.min(n, data.balance), method, note); toast.success('Payment recorded', `${data.cust.name} paid ${peso(Math.min(n, data.balance))}`) }
      else { await addCredit(store, data.cust, n, note || 'Manual charge'); toast.success('Charge added') }
      setAction(null); setAmount(''); setNote('')
    } catch (e) { toast.error('Failed', errorMessage(e)) } finally { setBusy(false) }
  }

  const cust = data?.cust || customer
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2">{cust.name}{canEditCustomer && <button onClick={() => setEdit(true)} className="text-slate-400 hover:text-slate-600"><Pencil size={14} /></button>}</span>} size="md">
      <div className="rounded-2xl bg-slate-900 text-white p-4 flex items-center justify-between mb-3">
        <div><div className="text-xs text-white/70 uppercase tracking-wide">Balance</div><div className="text-3xl font-black tabular">{peso(data?.balance)}</div>{cust.phone && <div className="text-xs text-white/70 mt-1 flex items-center gap-1"><Phone size={12} /> {cust.phone}</div>}</div>
        <div className="text-right text-xs text-white/70"><div>Charged {peso(data?.totalCharged)}</div><div>Paid {peso(data?.totalPaid)}</div></div>
      </div>
      {canPay && <div className="grid grid-cols-2 gap-2 mb-4">
        <Button variant="success" icon={<HandCoins size={18} />} onClick={() => { setAction('pay'); setAmount(data?.balance ? String(data.balance) : '') }} disabled={!data?.balance}>Record payment</Button>
        <Button variant="outline" icon={<Plus size={18} />} onClick={() => { setAction('charge'); setAmount('') }}>Add charge</Button>
      </div>}

      {action && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-3 mb-4 space-y-3 animate-fade-in">
          <div className="font-semibold text-sm">{action === 'pay' ? 'Payment received' : 'New charge (utang)'}</div>
          <MoneyInput value={amount} onChange={setAmount} big autoFocus />
          {action === 'pay' && <div className="flex gap-2 flex-wrap"><Chip onClick={() => setAmount(String(data?.balance || 0))}>Full balance</Chip>{[20, 50, 100, 200, 500].map((v) => <Chip key={v} onClick={() => setAmount(String(v))}>₱{v}</Chip>)}</div>}
          {action === 'pay' && <Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="gcash">GCash</option><option value="other">Other</option></Select>}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
          <div className="flex gap-2 justify-end"><Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!parseFloat(amount)}>{action === 'pay' ? 'Save payment' : 'Save charge'}</Button></div>
        </div>
      )}

      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">History</div>
      <ul className="divide-y divide-slate-100">
        {data?.ledger.map((e) => e.kind === 'charge' ? (
          <li key={e.row.id} className="py-2 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center"><ReceiptIcon size={14} /></div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-800">{(e.row as Credit).notes || 'Charge'}</div>
              {(e.row as Credit).sale_id && data.saleItems.get((e.row as Credit).sale_id!) && <div className="text-xs text-slate-600 line-clamp-2">{itemsSummary(data.saleItems.get((e.row as Credit).sale_id!))}</div>}
              <div className="text-[11px] text-slate-500">{fmtRelative(e.at)}{Number((e.row as Credit).paid) > 0 && !(e.row as Credit).settled ? ` · paid ${peso((e.row as Credit).paid)}` : ''}</div>
            </div>
            <div className="text-right"><div className={cls('font-semibold tabular text-sm', (e.row as Credit).settled ? 'text-slate-400 line-through' : 'text-orange-600')}>{peso((e.row as Credit).amount)}</div>{(e.row as Credit).settled && <Badge tone="green">Paid</Badge>}</div>
          </li>
        ) : (
          <li key={e.row.id} className="py-2 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center"><HandCoins size={14} /></div>
            <div className="flex-1 min-w-0"><div className="text-sm text-slate-800">Payment · {(e.row as CreditPayment).method}</div><div className="text-[11px] text-slate-500">{fmtRelative(e.at)}{(e.row as CreditPayment).notes ? ` · ${(e.row as CreditPayment).notes}` : ''}</div></div>
            <div className="font-semibold tabular text-sm text-brand-700">-{peso((e.row as CreditPayment).amount)}</div>
          </li>
        ))}
        {data && data.ledger.length === 0 && <li className="py-6 text-center text-sm text-slate-500">No transactions yet.</li>}
      </ul>
      {edit && <NewCustomerModal open onClose={() => setEdit(false)} existing={cust} />}
    </Modal>
  )
}
