import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ShieldCheck, Users, Clock, CheckCircle2, XCircle, Search, RefreshCw, Crown, Pencil, Wallet, TimerReset, Save, UserPlus } from 'lucide-react'
import { addDays, format } from 'date-fns'
import { useAppStore } from '../store/app'
import { supabase, errorMessage } from '../lib/supabase'
import { Button, Card, Input, Modal, Badge, Field, Select, Segmented, StatCard, Spinner, Textarea } from '../components/ui'
import { getAccess } from '../lib/subscription'
import { peso, num, fmtDate, fmtDateTime, cls, fmtRelative } from '../lib/format'
import { toast } from '../store/ui'
import type { PaymentRequest, Plan, Store } from '../lib/types'
import InviteModal from '../components/InviteModal'

interface AdminStore { id: string; name: string; owner_name: string | null; contact: string | null; created_at: string; trial_ends_at: string; plan_id: string | null; subscription_status: Store['subscription_status']; subscription_ends_at: string | null; email: string; full_name: string | null; is_admin: boolean; products: number; sales: number; last_sale_at: string | null; pending_requests: number; members?: number }

export default function Admin() {
  const { isAdmin, plans: bootPlans } = useAppStore()
  const [stores, setStores] = useState<AdminStore[] | null>(null)
  const [payments, setPayments] = useState<PaymentRequest[]>([])
  const [plans, setPlans] = useState<Plan[]>(bootPlans)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'users' | 'payments' | 'plans'>('users')
  const [filter, setFilter] = useState<'all' | 'trial' | 'active' | 'expired'>('all')
  const [edit, setEdit] = useState<AdminStore | null>(null)
  const [review, setReview] = useState<PaymentRequest | null>(null)
  const [inviteFor, setInviteFor] = useState<AdminStore | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [s, p, pl] = await Promise.all([supabase.rpc('admin_list_stores'), supabase.rpc('admin_list_payments'), supabase.from('plans').select('*').order('sort')])
    if (s.error) toast.error('Admin', errorMessage(s.error))
    setStores((s.data as AdminStore[]) || [])
    setPayments((p.data as PaymentRequest[]) || [])
    if (pl.data) setPlans(pl.data as Plan[])
  }
  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  const rows = useMemo(() => {
    if (!stores) return []
    const now = Date.now()
    return stores.map((s) => ({ ...s, access: getAccess({ ...(s as unknown as Store) }, false, now) }))
      .filter((s) => filter === 'all' || (filter === 'trial' && s.access.state === 'trial') || (filter === 'active' && s.access.state === 'active') || (filter === 'expired' && s.access.locked))
      .filter((s) => !q || s.email.toLowerCase().includes(q.toLowerCase()) || s.name.toLowerCase().includes(q.toLowerCase()) || (s.owner_name || '').toLowerCase().includes(q.toLowerCase()))
  }, [stores, q, filter])

  const stats = useMemo(() => {
    const all = (stores || []).map((s) => getAccess(s as unknown as Store, false))
    return { users: stores?.length || 0, trial: all.filter((a) => a.state === 'trial').length, active: all.filter((a) => a.state === 'active').length, expired: all.filter((a) => a.locked).length, pending: payments.filter((p) => p.status === 'pending').length, revenue: payments.filter((p) => p.status === 'approved').reduce((a, p) => a + Number(p.amount || 0), 0) }
  }, [stores, payments])

  if (!isAdmin) return <Navigate to="/" replace />

  const decide = async (approve: boolean, note: string) => {
    if (!review) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('admin_review_payment', { p_request: review.id, p_approve: approve, p_note: note || null })
      if (error) throw error
      toast.success(approve ? 'Payment approved – subscription activated' : 'Payment rejected')
      setReview(null); await load()
    } catch (e) { toast.error('Failed', errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div><div className="inline-flex items-center gap-1.5 text-violet-700 text-xs font-semibold bg-violet-50 rounded-full px-2.5 py-1"><ShieldCheck size={14} /> System Administrator</div><h1 className="text-2xl font-bold tracking-tight mt-2">Admin Console</h1><p className="text-sm text-slate-500">Registered users, subscriptions & GCash verifications</p></div>
        <Button variant="outline" size="sm" icon={<RefreshCw size={16} />} onClick={load}>Refresh</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Registered users" value={num(stats.users)} icon={<Users size={18} />} tone="slate" />
        <StatCard label="On free trial" value={num(stats.trial)} icon={<Clock size={18} />} tone="blue" />
        <StatCard label="Active subscribers" value={num(stats.active)} icon={<Crown size={18} />} tone="green" />
        <StatCard label="Expired / locked" value={num(stats.expired)} icon={<XCircle size={18} />} tone="red" />
        <StatCard label="Pending payments" value={num(stats.pending)} hint={`Collected ${peso(stats.revenue)}`} icon={<Wallet size={18} />} tone="yellow" onClick={() => setTab('payments')} />
      </div>

      <Segmented value={tab} onChange={setTab} options={[{ value: 'users', label: `Users (${stats.users})` }, { value: 'payments', label: `Payments${stats.pending ? ` (${stats.pending})` : ''}` }, { value: 'plans', label: 'Plans & pricing' }]} />

      {tab === 'users' && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex gap-2"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email, store or owner" left={<Search size={18} />} /><Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-36 shrink-0"><option value="all">All</option><option value="trial">Trial</option><option value="active">Active</option><option value="expired">Expired</option></Select></div>
          {!stores ? <Spinner label="Loading users…" /> : (
            <Card className="divide-y divide-slate-100">
              {rows.map((s) => (
                <div key={s.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-sm truncate">{s.name}</span>{s.is_admin && <Badge tone="purple">admin</Badge>}<Badge tone={s.access.state === 'active' ? 'green' : s.access.state === 'trial' ? 'blue' : 'red'}>{s.access.state}</Badge>{s.pending_requests > 0 && <Badge tone="yellow">{s.pending_requests} pending</Badge>}</div>
                    <div className="text-xs text-slate-600 truncate">{s.email}{s.owner_name ? ` · ${s.owner_name}` : ''}{s.contact ? ` · ${s.contact}` : ''}</div>
                    <div className="text-[11px] text-slate-500">Joined {fmtDate(s.created_at)} · {s.plan_id ? `${s.plan_id} until ${fmtDate(s.subscription_ends_at)}` : `trial until ${fmtDate(s.trial_ends_at)}`} · {num(s.products)} items · {s.members != null && <>{num(s.members)} staff · </>}{num(s.sales)} sales{s.last_sale_at ? ` · last ${fmtRelative(s.last_sale_at)}` : ''}</div>
                  </div>
                  <Button size="sm" variant="ghost" icon={<UserPlus size={14} />} onClick={() => setInviteFor(s)} title="Create a staff invitation code for this store"><span className="hidden sm:inline">Invite</span></Button>
                  <Button size="sm" variant="outline" icon={<Pencil size={14} />} onClick={() => setEdit(s)}>Subscription</Button>
                </div>
              ))}
              {rows.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No users match.</div>}
            </Card>
          )}
        </div>
      )}

      {tab === 'payments' && (
        <Card className="divide-y divide-slate-100 animate-fade-in">
          {payments.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No payment submissions yet.</div>}
          {[...payments].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending')).map((p) => (
            <div key={p.id} className="px-4 py-3 flex items-center gap-3">
              {p.status === 'approved' ? <CheckCircle2 className="text-brand-600 shrink-0" /> : p.status === 'rejected' ? <XCircle className="text-red-500 shrink-0" /> : <Clock className="text-amber-500 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{p.store_name} <span className="text-slate-400 font-normal">· {p.email}</span></div>
                <div className="text-xs text-slate-600">{p.plan_name || p.plan_id} · <b>{peso(p.amount)}</b> · ref <span className="font-mono bg-slate-100 px-1 rounded">{p.reference_no}</span>{p.sender_name ? ` · from ${p.sender_name}` : ''}{p.sender_number ? ` (${p.sender_number})` : ''}</div>
                <div className="text-[11px] text-slate-500">{fmtDateTime(p.created_at)}{p.reviewed_at ? ` · reviewed ${fmtDateTime(p.reviewed_at)}` : ''}{p.admin_note ? ` · ${p.admin_note}` : ''}</div>
              </div>
              {p.status === 'pending' ? <Button size="sm" onClick={() => setReview(p)}>Review</Button> : <Badge tone={p.status === 'approved' ? 'green' : 'red'}>{p.status}</Badge>}
            </div>
          ))}
        </Card>
      )}

      {tab === 'plans' && <PlansEditor plans={plans} onSaved={load} />}

      {edit && <EditSubscription store={edit} plans={plans} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
      {inviteFor && <InviteModal open onClose={() => { setInviteFor(null); void load() }} storeId={inviteFor.id} storeName={inviteFor.name} roles={['cashier', 'manager', 'viewer', 'owner']} />}

      <Modal open={!!review} onClose={() => setReview(null)} title="Verify GCash payment" size="sm" footer={<><Button variant="outline" className="text-red-600 border-red-200" loading={busy} onClick={() => decide(false, (document.getElementById('admin-note') as HTMLTextAreaElement)?.value)}>Reject</Button><Button variant="success" loading={busy} onClick={() => decide(true, (document.getElementById('admin-note') as HTMLTextAreaElement)?.value)}>Approve & activate</Button></>}>
        {review && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3 space-y-1"><div className="flex justify-between"><span className="text-slate-500">Store</span><b>{review.store_name}</b></div><div className="flex justify-between"><span className="text-slate-500">User</span><span>{review.email}</span></div><div className="flex justify-between"><span className="text-slate-500">Plan</span><b>{review.plan_name || review.plan_id}</b></div><div className="flex justify-between"><span className="text-slate-500">Amount</span><b>{peso(review.amount)}</b></div><div className="flex justify-between"><span className="text-slate-500">Reference</span><span className="font-mono">{review.reference_no}</span></div><div className="flex justify-between"><span className="text-slate-500">Sender</span><span>{review.sender_name || '—'} {review.sender_number || ''}</span></div></div>
            <p className="text-xs text-slate-500">Check your GCash app for a received payment with this reference number. Approving extends the store's subscription by the plan period (from today or from the current end date, whichever is later).</p>
            <Field label="Note to user (optional)"><Textarea id="admin-note" placeholder="e.g. Verified, thank you!" className="min-h-[56px]" /></Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

function EditSubscription({ store, plans, onClose, onSaved }: { store: AdminStore; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState(store.plan_id || plans[0]?.id || '')
  const [status, setStatus] = useState<string>(store.subscription_status)
  const [ends, setEnds] = useState(store.subscription_ends_at ? format(new Date(store.subscription_ends_at), 'yyyy-MM-dd') : '')
  const [trial, setTrial] = useState(format(new Date(store.trial_ends_at), 'yyyy-MM-dd'))
  const [busy, setBusy] = useState(false)
  const extend = (days: number) => { const base = ends && new Date(ends) > new Date() ? new Date(ends) : new Date(); setEnds(format(addDays(base, days), 'yyyy-MM-dd')); setStatus('active') }
  const save = async () => {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('admin_set_subscription', { p_store: store.id, p_plan: plan || null, p_status: status, p_ends_at: ends ? new Date(ends + 'T23:59:59').toISOString() : null, p_trial_ends_at: trial ? new Date(trial + 'T23:59:59').toISOString() : null })
      if (error) throw error
      toast.success('Subscription updated', store.name); onSaved()
    } catch (e) { toast.error('Failed', errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Change subscription" size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} icon={<Save size={16} />}>Save</Button></>}>
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 p-3 text-sm"><b>{store.name}</b><div className="text-xs text-slate-500">{store.email}</div></div>
        <Field label="Plan"><Select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">— none —</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {peso(p.price)} / {p.period_days}d</option>)}</Select></Field>
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="trial">Trial</option><option value="active">Active</option><option value="expired">Expired</option><option value="suspended">Suspended (blocked)</option></Select></Field>
        <Field label="Subscription ends"><Input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} /></Field>
        <div className="flex gap-2 flex-wrap">{plans.map((p) => <Button key={p.id} size="xs" variant="secondary" icon={<TimerReset size={12} />} onClick={() => extend(p.period_days)}>+{p.period_days}d ({p.name})</Button>)}</div>
        <Field label="Trial ends" hint="Extend to give more free days"><Input type="date" value={trial} onChange={(e) => setTrial(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function PlansEditor({ plans, onSaved }: { plans: Plan[]; onSaved: () => void }) {
  const [rows, setRows] = useState(plans)
  const [busy, setBusy] = useState(false)
  useEffect(() => setRows(plans), [plans])
  const upd = (i: number, patch: Partial<Plan>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const save = async () => {
    setBusy(true)
    try {
      for (const r of rows) { const { error } = await supabase.from('plans').update({ name: r.name, price: r.price, period_days: r.period_days, description: r.description, badge: r.badge || null, is_active: r.is_active, features: r.features }).eq('id', r.id); if (error) throw error }
      toast.success('Plans saved'); onSaved()
    } catch (e) { toast.error('Failed', errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3 animate-fade-in">
      <p className="text-sm text-slate-600">Prices shown to customers on the Subscription page. Changes apply immediately to new payments.</p>
      {rows.map((p, i) => (
        <Card key={p.id} className={cls('p-4 space-y-3', !p.is_active && 'opacity-60')}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Name"><Input value={p.name} onChange={(e) => upd(i, { name: e.target.value })} /></Field>
            <Field label="Price (₱)"><Input type="number" inputMode="decimal" value={p.price} onChange={(e) => upd(i, { price: parseFloat(e.target.value) || 0 })} /></Field>
            <Field label="Days"><Input type="number" inputMode="numeric" value={p.period_days} onChange={(e) => upd(i, { period_days: parseInt(e.target.value) || 30 })} /></Field>
            <Field label="Badge"><Input value={p.badge || ''} onChange={(e) => upd(i, { badge: e.target.value })} placeholder="Popular / Best Value" /></Field>
          </div>
          <Field label="Description"><Input value={p.description || ''} onChange={(e) => upd(i, { description: e.target.value })} /></Field>
          <Field label="Features (one per line)"><Textarea value={(p.features || []).join('\n')} onChange={(e) => upd(i, { features: e.target.value.split('\n').filter(Boolean) })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.is_active} onChange={(e) => upd(i, { is_active: e.target.checked })} className="accent-brand-600" /> Visible to customers</label>
        </Card>
      ))}
      <Button onClick={save} loading={busy} icon={<Save size={16} />}>Save plans</Button>
    </div>
  )
}
