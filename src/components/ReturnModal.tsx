import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Minus, Plus, Undo2, Banknote, Smartphone, HandCoins, PackageCheck, PackageX, Printer, Bluetooth, Share2, CheckCircle2 } from 'lucide-react'
import { db } from '../lib/db'
import { Modal, Button, Field, Input, Chip, Toggle } from './ui'
import { useAppStore, usePermission } from '../store/app'
import { computeRefund, customerBalance, returnItems } from '../lib/repo'
import { usePrinter, buildReturnSlip, returnSlipText, PAPER, type PaperWidth } from '../lib/printer'
import { peso, num, cls, round2 } from '../lib/format'
import { toast } from '../store/ui'
import { errorMessage } from '../lib/supabase'
import type { RefundMethod, Sale, SaleReturn } from '../lib/types'

const REASONS = ['Changed mind', 'Wrong item', 'Damaged / expired', 'Overcharged', 'Other']

/** Pick items of a completed sale to take back and refund (owners / managers). */
export default function ReturnModal({ sale, onClose, onDone }: { sale: Sale | null; onClose: () => void; onDone?: (ret: SaleReturn) => void }) {
  const { store } = useAppStore()
  const allowed = usePermission('return_items')
  const [qty, setQty] = useState<Record<number, number>>({})
  const [restock, setRestock] = useState(true)
  const [reason, setReason] = useState('Changed mind')
  const [other, setOther] = useState('')
  const [method, setMethod] = useState<RefundMethod>('cash')
  const [balance, setBalance] = useState(0)
  const [busy, setBusy] = useState(false)

  // what was already returned on earlier returns of this sale
  const previous = useLiveQuery(() => sale ? db.sale_returns.where('sale_id').equals(sale.id).toArray() : Promise.resolve([] as SaleReturn[]), [sale?.id], [] as SaleReturn[])
  const done = useMemo(() => { const m = new Map<number, number>(); for (const r of previous) if (!r.deleted_at) for (const it of r.items) m.set(it.line, round2((m.get(it.line) || 0) + Number(it.qty))); return m }, [previous])

  useEffect(() => {
    if (!sale) return
    setQty({}); setRestock(true); setReason('Changed mind'); setOther('')
    if (sale.customer_id) customerBalance(sale.customer_id).then((b) => { setBalance(b); setMethod(sale.payment_method === 'credit' && b > 0 ? 'credit' : sale.payment_method === 'gcash' ? 'gcash' : 'cash') })
    else { setBalance(0); setMethod(sale.payment_method === 'gcash' ? 'gcash' : 'cash') }
  }, [sale?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sale || !store) return null
  const remaining = (i: number) => round2(Number(sale.items[i].qty) - (done.get(i) || 0))
  const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([i, q]) => ({ line: Number(i), qty: q, restock }))
  const calc = computeRefund(sale, lines)
  const creditPart = method === 'credit' ? Math.min(calc.refund_total, balance) : 0
  const cashPart = round2(calc.refund_total - creditPart)
  const set = (i: number, v: number) => setQty((s) => ({ ...s, [i]: Math.max(0, Math.min(remaining(i), round2(v))) }))
  const pickReason = (r: string) => { setReason(r); if (r === 'Damaged / expired') setRestock(false) }

  const submit = async () => {
    if (!lines.length || busy) return
    setBusy(true)
    try {
      const ret = await returnItems(store, sale, { lines, reason: reason === 'Other' ? other.trim() || 'Other' : reason, refund_method: method })
      toast.success('Return recorded', `${ret.ret_no} · refund ${peso(ret.refund_total)}`)
      onDone?.(ret)
    } catch (e) { toast.error('Could not record the return', errorMessage(e)) } finally { setBusy(false) }
  }

  const methods: Array<{ v: RefundMethod; label: string; icon: JSX.Element; hint?: string; disabled?: boolean }> = [
    { v: 'cash', label: 'Cash', icon: <Banknote size={18} /> },
    { v: 'gcash', label: 'GCash', icon: <Smartphone size={18} /> },
    { v: 'credit', label: 'Off utang', icon: <HandCoins size={18} />, hint: balance > 0 ? `balance ${peso(balance)}` : 'no balance', disabled: balance <= 0 },
  ]

  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><Undo2 size={18} /> Return items · {sale.txn_no}</span>} size="md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={!allowed || !lines.length || calc.refund_total < 0} onClick={submit} data-testid="confirm-return">Refund {peso(calc.refund_total)}</Button></>}>
      {!allowed && <div className="mb-3 rounded-xl bg-amber-50 text-amber-900 text-sm p-3">Only owners and managers can process returns.</div>}
      <div className="text-xs text-slate-500 mb-2">Tap + for each item the customer is bringing back. {sale.discount > 0 && <>The sale had a <b>{peso(sale.discount)}</b> discount — the same share is deducted from the refund.</>}</div>
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
        {sale.items.map((it, i) => {
          const rem = remaining(i); const q = qty[i] || 0
          return (
            <li key={i} className={cls('px-3 py-2 flex items-center gap-2', rem <= 0 && 'opacity-50')} data-testid="return-line">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{it.name}</div>
                <div className="text-xs text-slate-500 tabular">{peso(it.price)} × {num(it.qty, 3)}{(done.get(i) || 0) > 0 && <span className="text-orange-700"> · {num(done.get(i)!, 3)} already returned</span>}{rem <= 0 && <span> · fully returned</span>}</div>
              </div>
              {rem > 0 && (
                <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                  <button onClick={() => set(i, q - 1)} className="w-8 h-8 rounded-md bg-white shadow-sm flex items-center justify-center disabled:opacity-40" disabled={q <= 0} aria-label="Less"><Minus size={14} /></button>
                  <input inputMode="decimal" value={q || ''} placeholder="0" onChange={(e) => set(i, parseFloat(e.target.value) || 0)} className="w-11 h-8 bg-transparent text-center text-sm font-semibold tabular outline-none" aria-label={`Return qty ${it.name}`} />
                  <button onClick={() => set(i, q + 1)} className="w-8 h-8 rounded-md bg-white shadow-sm flex items-center justify-center disabled:opacity-40" disabled={q >= rem} aria-label="More"><Plus size={14} /></button>
                </div>
              )}
              {rem > 0 && <button onClick={() => set(i, q >= rem ? 0 : rem)} className={cls('text-[11px] font-semibold px-2 h-8 rounded-lg border', q >= rem ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600')}>All</button>}
            </li>
          )
        })}
      </ul>

      <div className="mt-3 space-y-3">
        <Field label="Reason">
          <div className="flex flex-wrap gap-1.5">{REASONS.map((r) => <Chip key={r} active={reason === r} onClick={() => pickReason(r)}>{r}</Chip>)}</div>
          {reason === 'Other' && <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Describe the reason" className="mt-2" maxLength={80} />}
        </Field>
        <Toggle checked={restock} onChange={setRestock} label={<span className="flex items-center gap-2">{restock ? <PackageCheck size={16} className="text-brand-600" /> : <PackageX size={16} className="text-red-600" />} Put the items back in stock</span>} hint={restock ? 'Stock is restored so the items can be sold again.' : 'Damaged / expired: stock stays as is and the cost is lost.'} />
        <Field label="Refund via">
          <div className="grid grid-cols-3 gap-2">
            {methods.map((m) => <button key={m.v} type="button" disabled={m.disabled} onClick={() => setMethod(m.v)} className={cls('h-14 rounded-xl border flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition disabled:opacity-40', method === m.v ? 'border-brand-600 bg-brand-50 text-brand-800 ring-2 ring-brand-100' : 'border-slate-200 text-slate-600')}>{m.icon}{m.label}{m.hint && <span className="text-[10px] font-normal text-slate-500">{m.hint}</span>}</button>)}
          </div>
        </Field>
        <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-1">
          <div className="flex justify-between text-slate-600"><span>Items ({num(calc.items.reduce((a, i) => a + i.qty, 0), 3)})</span><span className="tabular">{peso(calc.gross)}</span></div>
          {calc.discount_share > 0 && <div className="flex justify-between text-slate-600"><span>Less discount share</span><span className="tabular">−{peso(calc.discount_share)}</span></div>}
          <div className="flex justify-between font-black text-base"><span>Refund</span><span className="tabular">{peso(calc.refund_total)}</span></div>
          {method === 'credit' && calc.refund_total > 0 && <div className="text-xs text-orange-800">{peso(creditPart)} deducted from {sale.customer_name || 'the customer'}'s balance{cashPart > 0 ? ` · ${peso(cashPart)} handed back in cash` : ''}</div>}
        </div>
      </div>
    </Modal>
  )
}

/** Printable refund slip for a recorded return. */
export function ReturnSlipModal({ ret, onClose, justCreated }: { ret: SaleReturn | null; onClose: () => void; justCreated?: boolean }) {
  const { store } = useAppStore()
  const printer = usePrinter()
  const [printing, setPrinting] = useState(false)
  if (!ret || !store) return null
  const paper = ((store.paper_width || 58) as PaperWidth) in PAPER ? ((store.paper_width || 58) as PaperWidth) : 58
  const cols = (store.settings?.receipt_cols as number | undefined) || PAPER[paper].cols
  const text = returnSlipText(store, ret, cols)
  const doPrint = async () => {
    setPrinting(true)
    try {
      if (!printer.connected) await printer.connect()
      await printer.print(await buildReturnSlip(store, ret, { paper, cols }))
      toast.success('Refund slip sent to printer')
    } catch (e) { toast.error('Print failed', errorMessage(e)) } finally { setPrinting(false) }
  }
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `Refund ${ret.ret_no}`, text })
      else { await navigator.clipboard.writeText(text); toast.success('Refund slip copied to clipboard') }
    } catch { /* cancelled */ }
  }
  const systemPrint = () => {
    const w = window.open('', '_blank', 'width=420,height=640')
    if (!w) return
    w.document.write(`<pre style="font:12px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;margin:16px">${text.replace(/</g, '&lt;')}</pre>`)
    w.document.close(); w.focus(); w.print()
  }
  return (
    <Modal open onClose={onClose} title={justCreated ? undefined : `Refund ${ret.ret_no}`} size="sm">
      {justCreated && (
        <div className="text-center mb-4 animate-fade-in">
          <CheckCircle2 className="mx-auto text-brand-600" size={44} />
          <div className="text-xl font-bold mt-2">Return recorded</div>
          <div className="text-slate-500 text-sm">{ret.ret_no} · for sale {ret.sale_txn_no}</div>
          <div className="mt-3 inline-block bg-red-50 text-red-800 rounded-xl px-4 py-2"><div className="text-xs uppercase tracking-wide">Hand back</div><div className="text-3xl font-black tabular">{peso(ret.refund_cash)}</div>{ret.refund_credit > 0 && <div className="text-xs">+ {peso(ret.refund_credit)} taken off the utang balance</div>}</div>
        </div>
      )}
      <pre className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] leading-snug font-mono overflow-x-auto whitespace-pre" data-testid="refund-slip">{text}</pre>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <Button onClick={doPrint} loading={printing} icon={printer.connected ? <Printer size={18} /> : <Bluetooth size={18} />}>{printer.connected ? 'Print' : 'Connect & Print'}</Button>
        <Button variant="outline" onClick={share} icon={<Share2 size={18} />}>Share</Button>
        <Button variant="ghost" size="sm" onClick={systemPrint} className="col-span-2 text-slate-500">Print via system dialog (no Bluetooth)</Button>
      </div>
      <div className="flex justify-end mt-3"><Button size="sm" variant="outline" onClick={onClose}>Close</Button></div>
    </Modal>
  )
}
