import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Printer, Share2, Bluetooth, CheckCircle2, RotateCcw, Ban, Undo2 } from 'lucide-react'
import { Modal, Button } from './ui'
import { db } from '../lib/db'
import { useAppStore, memberName, usePermission } from '../store/app'
import { usePrinter, buildReceipt, receiptText, PAPER, type PaperWidth } from '../lib/printer'
import { customerBalance } from '../lib/repo'
import ReturnModal, { ReturnSlipModal } from './ReturnModal'
import { toast } from '../store/ui'
import { errorMessage } from '../lib/supabase'
import { peso, num, fmtTime } from '../lib/format'
import type { Sale, SaleReturn } from '../lib/types'

interface Props { sale: Sale | null; onClose: () => void; onNewSale?: () => void; onVoid?: (sale: Sale) => void; justCompleted?: boolean }

export default function ReceiptModal({ sale: saleProp, onClose, onNewSale, onVoid, justCompleted }: Props) {
  const { store, profile } = useAppStore()
  const canVoid = usePermission('void_sale')
  const canReturn = usePermission('return_items')
  const printer = usePrinter()
  const [balance, setBalance] = useState<number | null>(null)
  const [printing, setPrinting] = useState(false)
  const [returning, setReturning] = useState(false)
  const [slip, setSlip] = useState<{ ret: SaleReturn; fresh: boolean } | null>(null)
  // keep the receipt live: refunds recorded while it is open show up immediately
  const liveSale = useLiveQuery(async () => (saleProp ? (await db.sales.get(saleProp.id)) ?? null : null), [saleProp?.id], null as Sale | null)
  const sale: Sale | null = liveSale ?? saleProp
  const returns = useLiveQuery(() => saleProp ? db.sale_returns.where('sale_id').equals(saleProp.id).toArray() : Promise.resolve([] as SaleReturn[]), [saleProp?.id], [] as SaleReturn[])
  const returnedQty = returns.reduce((a, r) => a + r.items.reduce((b, i) => b + Number(i.qty), 0), 0)
  const soldQty = sale ? sale.items.reduce((a, i) => a + Number(i.qty), 0) : 0
  const canStillReturn = !!sale && sale.status === 'active' && returnedQty < soldQty - 0.0005
  const paper = ((store?.paper_width || 58) as PaperWidth) in PAPER ? ((store?.paper_width || 58) as PaperWidth) : 58
  const cols = (store?.settings?.receipt_cols as number | undefined) || PAPER[paper].cols

  useEffect(() => {
    if (sale?.customer_id) customerBalance(sale.customer_id).then(setBalance)
    else setBalance(null)
  }, [sale?.id, sale?.customer_id])

  // auto-print right after checkout when a printer is connected and auto-print is on
  useEffect(() => {
    if (justCompleted && sale && printer.connected && store?.settings?.auto_print) void doPrint()
  }, [sale?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sale || !store) return null

  const doPrint = async () => {
    setPrinting(true)
    try {
      if (!printer.connected) await printer.connect()
      const bytes = await buildReceipt(store, sale, { paper, cols, balance, cashier: sale.cashier_name || memberName(sale.created_by, '') || profile?.full_name || null, reprint: !justCompleted })
      await printer.print(bytes)
      toast.success('Receipt sent to printer')
    } catch (e) { toast.error('Print failed', errorMessage(e)) } finally { setPrinting(false) }
  }

  const share = async () => {
    const text = receiptText(store, sale, cols, { balance })
    try {
      if (navigator.share) await navigator.share({ title: `Receipt ${sale.txn_no}`, text })
      else { await navigator.clipboard.writeText(text); toast.success('Receipt copied to clipboard') }
    } catch { /* cancelled */ }
  }

  const systemPrint = () => {
    const w = window.open('', '_blank', 'width=420,height=640')
    if (!w) return
    w.document.write(`<pre style="font:12px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;margin:16px">${receiptText(store, sale, cols, { balance }).replace(/</g, '&lt;')}</pre>`)
    w.document.close(); w.focus(); w.print()
  }

  return (
    <Modal open={!!sale} onClose={onClose} title={justCompleted ? undefined : `Receipt ${sale.txn_no}`} size="sm">
      {justCompleted && (
        <div className="text-center mb-4 animate-fade-in">
          <CheckCircle2 className="mx-auto text-brand-600" size={48} />
          <div className="text-xl font-bold mt-2">Sale completed</div>
          <div className="text-slate-500 text-sm">Txn # {sale.txn_no}</div>
          {sale.payment_method !== 'credit' && Number(sale.change_due) > 0 && (
            <div className="mt-3 inline-block bg-brand-50 text-brand-800 rounded-xl px-4 py-2"><div className="text-xs uppercase tracking-wide">Change</div><div className="text-3xl font-black tabular">{peso(sale.change_due)}</div></div>
          )}
          {sale.payment_method === 'credit' && balance != null && (
            <div className="mt-3 inline-block bg-orange-50 text-orange-800 rounded-xl px-4 py-2"><div className="text-xs uppercase tracking-wide">{sale.customer_name} · new balance</div><div className="text-2xl font-black tabular">{peso(balance)}</div></div>
          )}
        </div>
      )}
      <pre className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] leading-snug font-mono overflow-x-auto whitespace-pre">{receiptText(store, sale, cols, { balance })}</pre>
      {sale.status === 'void' && <div className="mt-2 text-center text-red-600 font-bold text-sm">VOIDED TRANSACTION</div>}
      {returns.length > 0 && (
        <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50 p-2.5 text-xs" data-testid="receipt-returns">
          <div className="font-semibold text-orange-900 flex items-center gap-1"><Undo2 size={14} /> Refunded {peso(returns.reduce((a, r) => a + Number(r.refund_total), 0))} · {returns.length} return{returns.length === 1 ? '' : 's'}</div>
          <ul className="mt-1 space-y-0.5">
            {[...returns].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => (
              <li key={r.id}><button onClick={() => setSlip({ ret: r, fresh: false })} className="w-full text-left flex items-center gap-2 text-orange-900 hover:underline"><span className="font-mono">{r.ret_no}</span><span className="text-orange-700 truncate flex-1">{fmtTime(r.created_at)} · {r.items.map((i) => `${i.name} ×${num(i.qty, 2)}`).join(', ')}</span><span className="tabular font-semibold">{peso(r.refund_total)}</span></button></li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mt-4">
        <Button onClick={doPrint} loading={printing} icon={printer.connected ? <Printer size={18} /> : <Bluetooth size={18} />}>{printer.connected ? 'Print' : 'Connect & Print'}</Button>
        <Button variant="outline" onClick={share} icon={<Share2 size={18} />}>Share</Button>
        <Button variant="ghost" size="sm" onClick={systemPrint} className="col-span-2 text-slate-500">Print via system dialog (no Bluetooth)</Button>
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        {onVoid && sale.status === 'active' && canVoid && returns.length === 0 && <Button variant="outline" className="text-red-600 border-red-200" size="sm" icon={<Ban size={16} />} onClick={() => onVoid(sale)}>Void</Button>}
        {canReturn && canStillReturn && <Button variant="outline" className="text-orange-700 border-orange-200" size="sm" icon={<Undo2 size={16} />} onClick={() => setReturning(true)} data-testid="return-items">Return items</Button>}
        <div className="flex-1" />
        {onNewSale ? <Button size="sm" onClick={onNewSale} icon={<RotateCcw size={16} />}>New sale</Button> : <Button size="sm" variant="outline" onClick={onClose}>Close</Button>}
      </div>
      {returning && <ReturnModal sale={sale} onClose={() => setReturning(false)} onDone={(ret) => { setReturning(false); setSlip({ ret, fresh: true }) }} />}
      {slip && <ReturnSlipModal ret={slip.ret} justCreated={slip.fresh} onClose={() => setSlip(null)} />}
    </Modal>
  )
}
