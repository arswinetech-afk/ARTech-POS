import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Receipt, Trash2, Download } from 'lucide-react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { db } from '../lib/db'
import { useAppStore, usePermission } from '../store/app'
import { Button, Input, Field, Modal, MoneyInput, EmptyState, PageHeader, Select, Segmented, Confirm } from '../components/ui'
import { saveExpense, deleteExpense } from '../lib/repo'
import { peso, fmtDate, downloadText, toCSV } from '../lib/format'
import { toast } from '../store/ui'
import { EXPENSE_CATEGORIES, type Expense } from '../lib/types'

export default function Expenses() {
  const { store } = useAppStore()
  const [range, setRange] = useState<'month' | 'last' | 'all'>('month')
  const [editing, setEditing] = useState<Expense | null | 'new'>(null)
  const [del, setDel] = useState<Expense | null>(null)
  const expenses = useLiveQuery(() => store ? db.expenses.where('store_id').equals(store.id).toArray() : Promise.resolve([] as Expense[]), [store?.id], [] as Expense[])

  const list = useMemo(() => {
    const now = new Date()
    const [from, to] = range === 'month' ? [format(startOfMonth(now), 'yyyy-MM-dd'), format(endOfMonth(now), 'yyyy-MM-dd')] : range === 'last' ? [format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'), format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')] : ['0000', '9999']
    return expenses.filter((e) => e.expense_date >= from && e.expense_date <= to).sort((a, b) => b.expense_date.localeCompare(a.expense_date) || b.created_at.localeCompare(a.created_at))
  }, [expenses, range])
  const total = list.reduce((a, e) => a + Number(e.amount), 0)
  const byCat = useMemo(() => { const m = new Map<string, number>(); for (const e of list) m.set(e.category || 'Other', (m.get(e.category || 'Other') || 0) + Number(e.amount)); return [...m.entries()].sort((a, b) => b[1] - a[1]) }, [list])

  const canManage = usePermission('manage_expenses')
  if (!store) return null
  return (
    <div className="space-y-3">
      <PageHeader title="Expenses" subtitle="Operating costs (not inventory purchases)" action={<><Button variant="outline" size="sm" icon={<Download size={16} />} className="hidden sm:inline-flex" onClick={() => downloadText('expenses.csv', toCSV(list.map((e) => ({ Date: e.expense_date, Category: e.category, Description: e.description, Amount: e.amount }))))}>Export</Button>{canManage && <Button size="sm" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Add</Button>}</>} />
      <Segmented value={range} onChange={setRange} options={[{ value: 'month', label: 'This month' }, { value: 'last', label: 'Last month' }, { value: 'all', label: 'All' }]} />
      <div className="bg-white rounded-2xl border border-slate-100 shadow-card p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Total</div>
        <div className="text-3xl font-black tabular text-red-600">{peso(total)}</div>
        {byCat.length > 0 && <div className="mt-3 space-y-1.5">{byCat.slice(0, 5).map(([c, v]) => <div key={c} className="text-xs"><div className="flex justify-between text-slate-600"><span>{c}</span><span className="tabular">{peso(v)}</span></div><div className="h-1.5 bg-slate-100 rounded-full mt-0.5"><div className="h-full bg-red-400 rounded-full" style={{ width: `${(v / total) * 100}%` }} /></div></div>)}</div>}
      </div>
      {list.length === 0 ? <EmptyState icon={<Receipt />} title="No expenses recorded" message="Track rent, utilities, salaries and other costs to see your true net profit." action={canManage ? <Button onClick={() => setEditing('new')}>Add expense</Button> : undefined} /> : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-card divide-y divide-slate-100">
          {list.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-3 py-2.5">
              <button className="flex-1 text-left min-w-0" onClick={() => canManage && setEditing(e)}><div className="text-sm font-medium text-slate-800 truncate">{e.description || e.category || 'Expense'}</div><div className="text-xs text-slate-500">{fmtDate(e.expense_date)}{e.category ? ` · ${e.category}` : ''}</div></button>
              <div className="font-semibold tabular text-red-600">{peso(e.amount)}</div>
              {canManage && <button onClick={() => setDel(e)} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>}
            </div>
          ))}
        </div>
      )}
      {editing && <ExpenseModal expense={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Delete expense?" confirmText="Delete" onConfirm={async () => { if (del) { await deleteExpense(del); setDel(null); toast.success('Deleted') } }} />
    </div>
  )
}

function ExpenseModal({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const { store } = useAppStore()
  const [f, setF] = useState({ amount: expense ? String(expense.amount) : '', category: expense?.category || EXPENSE_CATEGORIES[0], description: expense?.description || '', expense_date: expense?.expense_date || format(new Date(), 'yyyy-MM-dd') })
  const save = async () => {
    if (!store) return
    const amount = parseFloat(f.amount)
    if (!amount) { toast.error('Enter an amount'); return }
    await saveExpense(store, { ...f, amount }, expense || undefined)
    toast.success(expense ? 'Expense updated' : 'Expense added')
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={expense ? 'Edit expense' : 'New expense'} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Amount" required><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} big autoFocus /></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Meralco bill" /></Field>
        <Field label="Date"><Input type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
