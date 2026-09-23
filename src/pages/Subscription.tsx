import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Crown, Check, Smartphone, Copy, Send, Clock, CheckCircle2, XCircle, ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react'
import { useAppStore, usePermission } from '../store/app'
import { Button, Card, Field, Input, Modal, Badge } from '../components/ui'
import { supabase, GCASH_NUMBER, GCASH_NAME, errorMessage, isOnline } from '../lib/supabase'
import { peso, fmtDate, fmtDateTime, cls } from '../lib/format'
import { toast } from '../store/ui'
import type { Plan, PaymentRequest } from '../lib/types'

export default function Subscription() {
  const { store, plans, access, profile, refreshBootstrap } = useAppStore()
  const canBilling = usePermission('billing')
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Plan | null>(null)
  const [requests, setRequests] = useState<PaymentRequest[]>([])
  const [ref, setRef] = useState('')
  const [sender, setSender] = useState(profile?.full_name || '')
  const [senderNo, setSenderNo] = useState(store?.contact || '')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)

  const loadRequests = async () => {
    if (!store || !isOnline()) return
    const { data } = await supabase.from('payment_requests').select('*').eq('store_id', store.id).order('created_at', { ascending: false }).limit(10)
    if (data) setRequests(data as PaymentRequest[])
  }
  useEffect(() => { loadRequests(); refreshBootstrap() }, [store?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => { try { await navigator.clipboard.writeText(GCASH_NUMBER); toast.success('GCash number copied') } catch { /* ignore */ } }

  const submit = async () => {
    if (!store || !selected || !profile) return
    if (ref.trim().length < 6) { toast.error('Enter the GCash reference number', 'It is the 13-digit number on your GCash receipt.'); return }
    setBusy(true)
    try {
      const { error } = await supabase.from('payment_requests').insert({ store_id: store.id, user_id: profile.id, plan_id: selected.id, amount: selected.price, reference_no: ref.trim(), sender_name: sender.trim() || null, sender_number: senderNo.trim() || null })
      if (error) throw error
      toast.success('Payment submitted', 'The administrator will verify it and activate your plan shortly.')
      setSelected(null); setRef(''); setStep(1)
      await loadRequests()
    } catch (e) { toast.error('Could not submit', errorMessage(e)) } finally { setBusy(false) }
  }

  const monthly = plans.find((p) => p.period_days <= 31)?.price
  const perMonth = (p: Plan) => (p.price / (p.period_days / 30))
  const pending = requests.find((r) => r.status === 'pending')

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {access.locked ? <button onClick={() => navigate('/settings')} className="text-sm text-slate-500 flex items-center gap-1"><ArrowLeft size={16} /> Settings</button> : <button onClick={() => navigate(-1)} className="text-sm text-slate-500 flex items-center gap-1"><ArrowLeft size={16} /> Back</button>}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 bg-brand-50 text-brand-700 rounded-full px-3 py-1 text-xs font-semibold"><Sparkles size={14} /> Simple, affordable pricing</div>
        <h1 className="text-3xl font-black tracking-tight mt-3">Choose your plan</h1>
        <p className="text-slate-600 text-sm mt-1">Every plan includes <b>everything</b>: unlimited products & sales, offline mode, cloud backup, printer & scanner support, credits and reports.</p>
      </div>

      <Card className={cls('p-4 flex items-center gap-3', access.locked ? 'bg-red-50 border-red-100' : 'bg-white')}>
        <span className={cls('w-10 h-10 rounded-xl flex items-center justify-center', access.state === 'admin' ? 'bg-violet-100 text-violet-700' : access.locked ? 'bg-red-100 text-red-600' : 'bg-brand-100 text-brand-700')}>{access.state === 'admin' ? <ShieldCheck /> : <Crown />}</span>
        <div className="flex-1"><div className="font-semibold text-sm">{access.label}</div><div className="text-xs text-slate-600">{access.state === 'admin' ? 'You are the system administrator — no subscription needed.' : access.state === 'active' ? `Plan: ${store?.plan_id} · renews/ends ${fmtDate(access.endsAt?.toISOString())}. Paying again extends your end date.` : access.state === 'trial' ? `Full access until ${fmtDate(access.endsAt?.toISOString())}. Subscribe anytime — paid time is added after your trial.` : 'Pick a plan below to continue using ARTech POS.'}</div></div>
      </Card>

      {!canBilling && access.state !== 'admin' && <Card className="p-4 bg-sky-50 border-sky-100 text-sm text-sky-900">Subscriptions are managed by the <b>store owner</b>{store?.owner_name ? ` (${store.owner_name})` : ''}. If the store is locked, ask them to renew — your access returns automatically.</Card>}
      {pending && <Card className="p-4 bg-amber-50 border-amber-100 flex items-center gap-3"><Clock className="text-amber-600" /><div className="text-sm"><b>Payment under review</b> — ref. {pending.reference_no} for the {pending.plan_id} plan ({peso(pending.amount)}). You'll be activated as soon as the administrator confirms it.</div></Card>}

      <div className="grid sm:grid-cols-3 gap-3">
        {plans.map((p) => {
          const save = monthly && p.period_days > 31 ? Math.round((1 - perMonth(p) / monthly) * 100) : 0
          const best = p.badge === 'Best Value'
          return (
            <Card key={p.id} className={cls('p-5 flex flex-col relative overflow-hidden', best && 'ring-2 ring-brand-500')}>
              {p.badge && <span className={cls('absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full', best ? 'bg-brand-600 text-white' : 'bg-amber-100 text-amber-800')}>{p.badge}</span>}
              <div className="text-sm font-semibold text-slate-600">{p.name}</div>
              <div className="mt-2 flex items-baseline gap-1"><span className="text-3xl font-black tabular">{peso(p.price).replace('.00', '')}</span><span className="text-xs text-slate-500">/ {p.period_days === 30 ? 'month' : p.period_days === 90 ? '3 months' : p.period_days === 365 ? 'year' : `${p.period_days} days`}</span></div>
              <div className="text-xs text-slate-500 mt-1">{p.period_days > 31 ? `≈ ${peso(perMonth(p)).replace('.00', '')}/month` : 'Cancel anytime'}{save > 0 ? ` · save ${save}%` : ''}</div>
              <ul className="mt-4 space-y-1.5 text-sm text-slate-700 flex-1">{(p.features || []).map((f) => <li key={f} className="flex gap-2"><Check size={16} className="text-brand-600 shrink-0 mt-0.5" /> {f}</li>)}</ul>
              <Button className="mt-5" variant={best ? 'primary' : 'outline'} block onClick={() => { setSelected(p); setStep(1) }} disabled={access.state === 'admin' || !canBilling}>{canBilling ? `Select ${p.name}` : 'Owner only'}</Button>
            </Card>
          )
        })}
        {plans.length === 0 && <Card className="p-6 sm:col-span-3 text-center text-sm text-slate-500">Plans are loading… connect to the internet to view subscription options.</Card>}
      </div>

      {requests.length > 0 && (
        <Card>
          <div className="px-4 pt-4 pb-2 font-semibold text-sm">Your payment submissions</div>
          <div className="divide-y divide-slate-100">{requests.map((r) => (
            <div key={r.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              {r.status === 'approved' ? <CheckCircle2 className="text-brand-600" size={18} /> : r.status === 'rejected' ? <XCircle className="text-red-500" size={18} /> : <Clock className="text-amber-500" size={18} />}
              <div className="flex-1 min-w-0"><div className="font-medium">{r.plan_id} · {peso(r.amount)} · ref <span className="font-mono">{r.reference_no}</span></div><div className="text-xs text-slate-500">{fmtDateTime(r.created_at)}{r.admin_note ? ` · ${r.admin_note}` : ''}</div></div>
              <Badge tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'yellow'}>{r.status}</Badge>
            </div>
          ))}</div>
        </Card>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title={step === 1 ? 'Pay with GCash' : 'Send your reference number'} size="sm"
        footer={step === 1 ? <><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button onClick={() => setStep(2)}>I've sent the payment <Send size={16} /></Button></> : <><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button onClick={submit} loading={busy}>Submit for verification</Button></>}>
        {selected && step === 1 && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-to-br from-sky-600 to-blue-700 text-white p-5 text-center">
              <Smartphone className="mx-auto mb-1" />
              <div className="text-xs uppercase tracking-wide text-white/80">Send exactly</div>
              <div className="text-4xl font-black tabular">{peso(selected.price).replace('.00', '')}</div>
              <div className="text-xs text-white/80 mt-1">{selected.name} plan · {selected.period_days} days</div>
              <div className="mt-4 bg-white/15 rounded-xl p-3">
                <div className="text-xs text-white/80">GCash number</div>
                <div className="text-2xl font-bold tracking-widest tabular">{GCASH_NUMBER}</div>
                {GCASH_NAME && <div className="text-xs text-white/80">{GCASH_NAME}</div>}
                <button onClick={copy} className="mt-2 inline-flex items-center gap-1 text-xs bg-white text-blue-700 font-semibold rounded-lg px-3 py-1.5"><Copy size={14} /> Copy number</button>
              </div>
            </div>
            <ol className="text-sm text-slate-700 space-y-1.5 list-decimal pl-5">
              <li>Open GCash → <b>Send Money</b> → enter <b>{GCASH_NUMBER}</b>.</li>
              <li>Send <b>{peso(selected.price)}</b>. In the message, put your store name: <b>{store?.name}</b>.</li>
              <li>Tap <b>“I've sent the payment”</b> and enter the <b>Reference No.</b> from the GCash receipt.</li>
            </ol>
            <p className="text-xs text-slate-500">Your plan is activated by the administrator after the payment is verified (usually within a few hours). You'll see the status on this page.</p>
          </div>
        )}
        {selected && step === 2 && (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 p-3 text-sm flex justify-between"><span>{selected.name} plan</span><b>{peso(selected.price)}</b></div>
            <Field label="GCash reference number" required hint="13 digits, shown on the GCash receipt / SMS"><Input value={ref} onChange={(e) => setRef(e.target.value.replace(/[^0-9A-Za-z]/g, ''))} inputMode="numeric" placeholder="e.g. 1023456789012" className="font-mono text-lg tracking-wider" autoFocus /></Field>
            <Field label="Sender name"><Input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="Name on the GCash account" /></Field>
            <Field label="Sender GCash number"><Input value={senderNo} onChange={(e) => setSenderNo(e.target.value)} inputMode="tel" placeholder="09xx xxx xxxx" /></Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
