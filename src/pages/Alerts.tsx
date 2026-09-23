import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Plus, Bell, BellRing, CheckCircle2, Trash2, Download, AlertTriangle, PackageX, Crown, Repeat } from 'lucide-react'
import { addDays, addMonths, addWeeks, format } from 'date-fns'
import { db } from '../lib/db'
import { useAppStore, usePermission } from '../store/app'
import { Button, Input, Field, Modal, EmptyState, PageHeader, Select, Textarea, Segmented, Card } from '../components/ui'
import { saveReminder, deleteReminder } from '../lib/repo'
import { fmtDateTime, downloadText, toCSV, cls } from '../lib/format'
import { toast } from '../store/ui'
import type { Reminder } from '../lib/types'

export default function Alerts() {
  const { store, access } = useAppStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'active' | 'done'>('active')
  const [editing, setEditing] = useState<Reminder | null | 'new'>(null)
  const reminders = useLiveQuery(() => store ? db.reminders.where('store_id').equals(store.id).toArray() : Promise.resolve([] as Reminder[]), [store?.id], [] as Reminder[])
  const stock = useLiveQuery(async () => {
    if (!store) return { out: 0, low: 0 }
    const ps = await db.products.where('store_id').equals(store.id).toArray()
    return { out: ps.filter((p) => Number(p.stock) <= 0).length, low: ps.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= (p.low_stock_at ?? store.low_stock_threshold)).length }
  }, [store?.id], { out: 0, low: 0 })

  const canManage = usePermission('manage_reminders')
  const list = useMemo(() => reminders.filter((r) => (tab === 'active' ? !r.is_done : r.is_done)).sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9')), [reminders, tab])
  const now = new Date().toISOString()

  const complete = async (r: Reminder) => {
    if (!store) return
    if (r.repeat !== 'none' && r.due_at) {
      const d = new Date(r.due_at)
      const next = r.repeat === 'daily' ? addDays(d, 1) : r.repeat === 'weekly' ? addWeeks(d, 1) : addMonths(d, 1)
      await saveReminder(store, { due_at: next.toISOString() }, r)
      toast.success('Done – next reminder scheduled', fmtDateTime(next.toISOString()))
    } else {
      await saveReminder(store, { is_done: true }, r)
      toast.success('Reminder completed')
    }
  }

  if (!store) return null
  return (
    <div className="space-y-3">
      <PageHeader title="Reminders" subtitle={`${reminders.filter((r) => !r.is_done).length} active`} action={<><Button variant="outline" size="sm" icon={<Download size={16} />} className="hidden sm:inline-flex" onClick={() => downloadText('reminders.csv', toCSV(reminders.map((r) => ({ Title: r.title, Note: r.note, Due: r.due_at, Repeat: r.repeat, Done: r.is_done }))))}>Export</Button>{canManage && <Button size="sm" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Add</Button>}</>} />

      {/* System alerts */}
      <div className="space-y-2">
        {access.state === 'trial' && access.daysLeft <= 7 && <Card onClick={() => navigate('/subscription')} className="p-3 flex items-center gap-3 bg-amber-50 border-amber-100"><Crown className="text-amber-600" /><div className="flex-1 text-sm"><b>Free trial ends in {access.daysLeft} day{access.daysLeft === 1 ? '' : 's'}</b><div className="text-xs text-amber-800">Choose a plan to keep full access.</div></div></Card>}
        {stock.out > 0 && <Card onClick={() => navigate('/items')} className="p-3 flex items-center gap-3 bg-red-50 border-red-100"><PackageX className="text-red-600" /><div className="flex-1 text-sm"><b>{stock.out} item{stock.out === 1 ? '' : 's'} out of stock</b><div className="text-xs text-red-800">Restock to avoid lost sales.</div></div></Card>}
        {stock.low > 0 && <Card onClick={() => navigate('/items')} className="p-3 flex items-center gap-3 bg-amber-50 border-amber-100"><AlertTriangle className="text-amber-600" /><div className="flex-1 text-sm"><b>{stock.low} item{stock.low === 1 ? '' : 's'} running low</b><div className="text-xs text-amber-800">At or below the low-stock threshold.</div></div></Card>}
      </div>

      <Segmented value={tab} onChange={setTab} options={[{ value: 'active', label: 'Active' }, { value: 'done', label: 'Completed' }]} />
      {list.length === 0 ? <EmptyState icon={<Bell />} title={tab === 'active' ? 'No reminders yet' : 'Nothing completed yet'} message={tab === 'active' ? 'Tap + to create your first reminder (supplier deliveries, bills, permit renewals…).' : undefined} /> : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-card divide-y divide-slate-100">
          {list.map((r) => {
            const overdue = !r.is_done && r.due_at && r.due_at <= now
            return (
              <div key={r.id} className="flex items-start gap-3 px-3 py-3">
                <button onClick={() => !r.is_done && complete(r)} className={cls('mt-0.5 shrink-0', r.is_done ? 'text-brand-600' : overdue ? 'text-red-500' : 'text-slate-300 hover:text-brand-600')}>{r.is_done ? <CheckCircle2 size={22} /> : overdue ? <BellRing size={22} /> : <CheckCircle2 size={22} />}</button>
                <button className="flex-1 min-w-0 text-left" onClick={() => canManage && setEditing(r)}>
                  <div className={cls('text-sm font-medium', r.is_done ? 'text-slate-400 line-through' : 'text-slate-800')}>{r.title}</div>
                  {r.note && <div className="text-xs text-slate-500 truncate">{r.note}</div>}
                  <div className={cls('text-[11px] mt-0.5 flex items-center gap-1', overdue ? 'text-red-600 font-medium' : 'text-slate-500')}>{r.due_at ? fmtDateTime(r.due_at) : 'No due date'}{r.repeat !== 'none' && <><Repeat size={11} /> {r.repeat}</>}</div>
                </button>
                <button onClick={async () => { await deleteReminder(r); toast.success('Deleted') }} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            )
          })}
        </div>
      )}
      {editing && <ReminderModal reminder={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ReminderModal({ reminder, onClose }: { reminder: Reminder | null; onClose: () => void }) {
  const { store } = useAppStore()
  const [f, setF] = useState({ title: reminder?.title || '', note: reminder?.note || '', due: reminder?.due_at ? format(new Date(reminder.due_at), "yyyy-MM-dd'T'HH:mm") : format(addDays(new Date(), 1), "yyyy-MM-dd'T'09:00"), repeat: reminder?.repeat || 'none' })
  const save = async () => {
    if (!store || !f.title.trim()) return
    await saveReminder(store, { title: f.title.trim(), note: f.note || null, due_at: f.due ? new Date(f.due).toISOString() : null, repeat: f.repeat as Reminder['repeat'] }, reminder || undefined)
    toast.success(reminder ? 'Reminder updated' : 'Reminder added'); onClose()
  }
  return (
    <Modal open onClose={onClose} title={reminder ? 'Edit reminder' : 'New reminder'} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.title.trim()}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus placeholder="e.g. Pay Coca-Cola delivery" /></Field>
        <Field label="Due"><Input type="datetime-local" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        <Field label="Repeat"><Select value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value as Reminder['repeat'] })}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select></Field>
        <Field label="Note"><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className="min-h-[60px]" /></Field>
      </div>
    </Modal>
  )
}
