import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, DollarSign, TrendingUp, Wallet, ShoppingBag, Users, Receipt, Ban, Trophy, Lightbulb, AlertCircle, CheckCircle2, MinusCircle, Search, Package, Cloud, Undo2 } from 'lucide-react'
import { format, startOfDay, endOfDay, subDays, startOfMonth, startOfYear, differenceInDays, subMonths, endOfMonth, parseISO } from 'date-fns'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend } from 'recharts'
import { db } from '../lib/db'
import { useAppStore, usePermission, memberName } from '../store/app'
import { supabase, isOnline } from '../lib/supabase'
import { SALES_WINDOW_DAYS } from '../lib/sync'
import { Card, Chip, Segmented, Input, Button, Badge, EmptyState, StatCard, Confirm } from '../components/ui'
import ReceiptModal from '../components/ReceiptModal'
import { ReturnSlipModal } from '../components/ReturnModal'
import { voidSale } from '../lib/repo'
import { peso, num, cls, fmtRelative, downloadText, toCSV, round2 } from '../lib/format'
import { toast } from '../store/ui'
import type { Sale, SaleReturn, CreditPayment } from '../lib/types'

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom'

function rangeDates(key: RangeKey, custom: { from: string; to: string }) {
  const now = new Date()
  switch (key) {
    case 'today': return [startOfDay(now), endOfDay(now)]
    case '7d': return [startOfDay(subDays(now, 6)), endOfDay(now)]
    case '30d': return [startOfDay(subDays(now, 29)), endOfDay(now)]
    case 'month': return [startOfMonth(now), endOfDay(now)]
    case 'year': return [startOfYear(now), endOfDay(now)]
    default: return [startOfDay(parseISO(custom.from)), endOfDay(parseISO(custom.to))]
  }
}

/** Figures are NET of returns recorded in the period: gross/profit/cash already have refunds taken out
 *  (refunds = amount handed back; refundProfit = refunds minus the cost of items that went back to stock). */
/**
 * Period figures. Sales are recognised when made (accrual): Net Sales counts the full amount of a
 * credit sale on the day it happens and the unpaid part shows up under Receivables. Cash Collected
 * is the cash-basis view: money that actually came in during the period — cash/GCash sales, the
 * amount paid upfront on credit sales and utang payments collected — minus cash handed back for
 * returns. creditSales = the amount added to utang (total − paid upfront), not the sale totals.
 */
interface Summary { gross: number; cost: number; profit: number; discount: number; txns: number; voids: number; creditSales: number; creditCount: number; creditUpfront: number; cashCheckout: number; collections: number; cash: number; expenses: number; refunds: number; refundCount: number; refundProfit: number; refundCash: number }
const emptySummary: Summary = { gross: 0, cost: 0, profit: 0, discount: 0, txns: 0, voids: 0, creditSales: 0, creditCount: 0, creditUpfront: 0, cashCheckout: 0, collections: 0, cash: 0, expenses: 0, refunds: 0, refundCount: 0, refundProfit: 0, refundCash: 0 }

/** Paid upfront on a credit sale (never more than the total). */
const upfront = (s: Sale) => Math.min(Number(s.amount_paid || 0), Number(s.total))

function summarize(sales: Sale[], expenses: number, returns: SaleReturn[] = [], payments: CreditPayment[] = []): Summary {
  const active = sales.filter((s) => s.status === 'active')
  const credit = active.filter((s) => s.payment_method === 'credit')
  const rets = returns.filter((r) => !r.deleted_at)
  const refunds = rets.reduce((a, r) => a + Number(r.refund_total), 0)
  const refundProfit = rets.reduce((a, r) => a + Number(r.refund_total) - Number(r.restock_cost), 0)
  const refundCash = rets.reduce((a, r) => a + Number(r.refund_cash), 0)
  // cash/GCash sales bring in their total (what was tendered minus change) + what credit customers paid upfront
  const cashCheckout = active.filter((s) => s.payment_method !== 'credit').reduce((a, s) => a + Number(s.total), 0) + credit.reduce((a, s) => a + upfront(s), 0)
  const collections = payments.filter((p) => !p.deleted_at).reduce((a, p) => a + Number(p.amount), 0)
  return {
    gross: active.reduce((a, s) => a + Number(s.total), 0) - refunds, cost: active.reduce((a, s) => a + Number(s.cost_total), 0) - rets.reduce((a, r) => a + Number(r.restock_cost), 0),
    profit: active.reduce((a, s) => a + Number(s.profit), 0) - refundProfit, discount: active.reduce((a, s) => a + Number(s.discount), 0),
    txns: active.length, voids: sales.length - active.length,
    creditSales: round2(credit.reduce((a, s) => a + Number(s.total) - upfront(s), 0)),
    creditCount: credit.length, creditUpfront: round2(credit.reduce((a, s) => a + upfront(s), 0)),
    cashCheckout: round2(cashCheckout), collections: round2(collections), cash: round2(cashCheckout + collections - refundCash), expenses,
    refunds, refundCount: rets.length, refundProfit, refundCash,
  }
}

export default function Reports() {
  const { store } = useAppStore()
  const [params] = useSearchParams()
  const [range, setRange] = useState<RangeKey>((params.get('range') as RangeKey) || '30d')
  const [custom, setCustom] = useState({ from: format(subDays(new Date(), 29), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') })
  const [tab, setTab] = useState<'dashboard' | 'transactions' | 'returns' | 'top'>('dashboard')
  const canView = usePermission('view_reports')
  const [from, to] = useMemo(() => rangeDates(range, custom), [range, custom])
  const days = differenceInDays(to, from) + 1
  const [prevFrom, prevTo] = [subDays(from, days), subDays(from, 1)]
  const windowStart = subDays(new Date(), SALES_WINDOW_DAYS)
  const needsCloud = from < windowStart
  const [cloud, setCloud] = useState<{ summary: Summary; daily: Array<{ day: string; revenue: number; profit: number }>; top: Array<{ name: string; qty: number; revenue: number; profit: number }> } | null>(null)

  const local = useLiveQuery(async () => {
    if (!store) return null
    const fromISO = from.toISOString(), toISO = to.toISOString()
    const [sales, prevSales, expenses, prevExpenses, credits, products, purchases, allRecent, returns, prevReturns, recentReturns, payments, prevPayments] = await Promise.all([
      db.sales.where('store_id').equals(store.id).and((s) => s.created_at >= fromISO && s.created_at <= toISO).toArray(),
      db.sales.where('store_id').equals(store.id).and((s) => s.created_at >= prevFrom.toISOString() && s.created_at <= endOfDay(prevTo).toISOString()).toArray(),
      db.expenses.where('store_id').equals(store.id).and((e) => e.expense_date >= format(from, 'yyyy-MM-dd') && e.expense_date <= format(to, 'yyyy-MM-dd')).toArray(),
      db.expenses.where('store_id').equals(store.id).and((e) => e.expense_date >= format(prevFrom, 'yyyy-MM-dd') && e.expense_date <= format(prevTo, 'yyyy-MM-dd')).toArray(),
      db.credits.where('store_id').equals(store.id).toArray(),
      db.products.where('store_id').equals(store.id).toArray(),
      db.stock_movements.where('store_id').equals(store.id).and((m) => m.type === 'purchase' && m.created_at >= fromISO && m.created_at <= toISO).toArray(),
      db.sales.where('store_id').equals(store.id).and((s) => s.created_at >= startOfMonth(subMonths(new Date(), 5)).toISOString()).toArray(),
      db.sale_returns.where('store_id').equals(store.id).and((r) => r.created_at >= fromISO && r.created_at <= toISO).toArray(),
      db.sale_returns.where('store_id').equals(store.id).and((r) => r.created_at >= prevFrom.toISOString() && r.created_at <= endOfDay(prevTo).toISOString()).toArray(),
      db.sale_returns.where('store_id').equals(store.id).and((r) => r.created_at >= startOfMonth(subMonths(new Date(), 5)).toISOString()).toArray(),
      db.credit_payments.where('store_id').equals(store.id).and((p) => p.created_at >= fromISO && p.created_at <= toISO).toArray(),
      db.credit_payments.where('store_id').equals(store.id).and((p) => p.created_at >= prevFrom.toISOString() && p.created_at <= endOfDay(prevTo).toISOString()).toArray(),
    ])
    const exp = expenses.reduce((a, e) => a + Number(e.amount), 0)
    const monthly = Array.from({ length: 6 }, (_, i) => { const m = subMonths(new Date(), 5 - i); const a = startOfMonth(m).toISOString(), b = endOfMonth(m).toISOString(); const ss = allRecent.filter((s) => s.status === 'active' && s.created_at >= a && s.created_at <= b); const rr = recentReturns.filter((r) => r.created_at >= a && r.created_at <= b); return { month: format(m, 'MMM yy'), revenue: round2(ss.reduce((x, s) => x + Number(s.total), 0) - rr.reduce((x, r) => x + Number(r.refund_total), 0)), gross: round2(ss.reduce((x, s) => x + Number(s.profit), 0) - rr.reduce((x, r) => x + Number(r.refund_total) - Number(r.restock_cost), 0)) } })
    return {
      sales: sales.sort((a, b) => b.created_at.localeCompare(a.created_at)), returns: returns.sort((a, b) => b.created_at.localeCompare(a.created_at)),
      summary: summarize(sales, exp, returns, payments), prev: summarize(prevSales, prevExpenses.reduce((a, e) => a + Number(e.amount), 0), prevReturns, prevPayments),
      receivables: credits.filter((c) => !c.settled).reduce((a, c) => a + Number(c.amount) - Number(c.paid), 0),
      inventoryValue: products.reduce((a, p) => a + Number(p.cost) * Number(p.stock), 0),
      purchases: purchases.reduce((a, m) => a + Number(m.qty) * Number(m.unit_cost || 0), 0), purchaseCount: purchases.length, monthly,
    }
  }, [store?.id, from.getTime(), to.getTime()])

  // Older-than-cache ranges → ask the server (aggregates only, tiny payload)
  useEffect(() => {
    setCloud(null)
    if (!store || !needsCloud || !isOnline()) return
    let cancelled = false
    ;(async () => {
      const args = { p_store: store.id, p_from: from.toISOString(), p_to: to.toISOString() }
      const [s, d, t] = await Promise.all([supabase.rpc('report_summary', args), supabase.rpc('report_daily', args), supabase.rpc('report_top_products', { ...args, p_limit: 30 })])
      if (cancelled || s.error || d.error || t.error) return
      const x = s.data as Record<string, number>
      const refunds = +(x.refunds || 0), refundProfit = +(x.refund_profit || 0), refundCash = +(x.refund_cash || 0)
      // older RPC versions lack cash_checkout / collections / credit_upfront → fall back gracefully
      const cashCheckout = +(x.cash_checkout ?? x.cash_collected ?? 0), collections = +(x.collections || 0)
      setCloud({ summary: { gross: +x.gross_sales - refunds, cost: +x.cost_total - (refunds - refundProfit), profit: +x.gross_profit - refundProfit, discount: +x.discount, txns: +x.txn_count, voids: +x.void_count, creditSales: +x.credit_sales, creditCount: +x.credit_count, creditUpfront: +(x.credit_upfront || 0), cashCheckout, collections, cash: round2(cashCheckout + collections - refundCash), expenses: +x.expenses, refunds, refundCount: +(x.refund_count || 0), refundProfit, refundCash }, daily: (d.data as Array<{ day: string; revenue: number; profit: number }>).map((r) => ({ day: r.day, revenue: +r.revenue, profit: +r.profit })), top: (t.data as Array<{ name: string; qty: number; revenue: number; profit: number }>).map((r) => ({ ...r, qty: +r.qty, revenue: +r.revenue, profit: +r.profit })) })
    })()
    return () => { cancelled = true }
  }, [store?.id, needsCloud, from.getTime(), to.getTime()])

  const summary = cloud?.summary ?? local?.summary ?? emptySummary
  const net = summary.profit - summary.expenses
  const daily = useMemo(() => {
    if (cloud) return cloud.daily.map((d) => ({ label: format(parseISO(d.day), days > 31 ? 'MMM d' : 'EEE d'), revenue: d.revenue, profit: d.profit }))
    if (!local) return []
    const buckets = new Map<string, { revenue: number; profit: number }>()
    for (let i = 0; i < Math.min(days, 366); i++) buckets.set(format(subDays(to, days - 1 - i), 'yyyy-MM-dd'), { revenue: 0, profit: 0 })
    for (const s of local.sales) if (s.status === 'active') { const k = format(parseISO(s.created_at), 'yyyy-MM-dd'); const b = buckets.get(k); if (b) { b.revenue += Number(s.total); b.profit += Number(s.profit) } }
    for (const r of local.returns) { const k = format(parseISO(r.created_at), 'yyyy-MM-dd'); const b = buckets.get(k); if (b) { b.revenue -= Number(r.refund_total); b.profit -= Number(r.refund_total) - Number(r.restock_cost) } }
    return [...buckets.entries()].map(([k, v]) => ({ label: format(parseISO(k), days > 31 ? 'MMM d' : 'EEE d'), revenue: round2(v.revenue), profit: round2(v.profit) }))
  }, [local, cloud, days, to])
  const top = useMemo(() => {
    if (cloud) return cloud.top
    if (!local) return []
    // net of returns recorded in the period: a returned unit takes back its qty and line revenue;
    // its cost is recovered only when it went back to stock (same rule as report_top_products)
    const m = new Map<string, { name: string; qty: number; revenue: number; profit: number }>()
    for (const s of local.sales) if (s.status === 'active') for (const it of s.items) { const k = it.product_id || it.name; const e = m.get(k) || { name: it.name, qty: 0, revenue: 0, profit: 0 }; e.qty += it.qty; e.revenue += it.qty * it.price; e.profit += it.qty * (it.price - (it.cost || 0)); m.set(k, e) }
    for (const r of local.returns) for (const it of r.items) { const k = it.product_id || it.name; const e = m.get(k) || { name: it.name, qty: 0, revenue: 0, profit: 0 }; e.qty -= it.qty; e.revenue -= it.qty * it.price; e.profit -= it.qty * it.price - (it.restock !== false ? it.qty * (it.cost || 0) : 0); m.set(k, e) }
    return [...m.values()].filter((e) => e.qty > 0).map((e) => ({ ...e, qty: round2(e.qty), revenue: round2(e.revenue), profit: round2(e.profit) })).sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name)).slice(0, 100)
  }, [local, cloud])

  const exportSales = () => { if (!local) return; downloadText(`sales-${format(from, 'yyyyMMdd')}-${format(to, 'yyyyMMdd')}.csv`, toCSV(local.sales.map((s) => ({ 'Transaction #': s.txn_no, Date: s.created_at, Payment: s.payment_method, Customer: s.customer_name || '', 'Total Amount': s.total, Cost: s.cost_total, Profit: s.profit, Discount: s.discount, Refunded: s.refunded_total || 0, Status: s.status.toUpperCase(), Items: s.items.map((i) => `${i.name} x${i.qty}`).join('; ') })))) }

  const status = summary.txns === 0 && summary.expenses === 0 ? 'none' : net > 0 ? 'profit' : net < 0 ? 'loss' : 'even'
  const margin = summary.gross ? (summary.profit / summary.gross) * 100 : 0
  const netMargin = summary.gross ? (net / summary.gross) * 100 : 0
  const delta = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : 100) : ((a - b) / Math.abs(b)) * 100)

  if (!store) return null
  if (!canView) return <Navigate to="/" replace />
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div><h1 className="text-2xl font-bold tracking-tight">Reports</h1><p className="text-xs text-slate-500">Financial analytics & transaction history</p></div>
        <Button variant="outline" size="sm" icon={<Download size={16} />} onClick={exportSales}>Export Sales</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {([['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom']] as Array<[RangeKey, string]>).map(([k, l]) => <Chip key={k} active={range === k} onClick={() => setRange(k)}>{l}</Chip>)}
      </div>
      {range === 'custom' && <div className="flex gap-2 items-center"><Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /><span className="text-slate-400">→</span><Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></div>}
      {needsCloud && <div className={cls('text-xs rounded-lg px-3 py-2 flex items-center gap-2', cloud ? 'bg-sky-50 text-sky-800' : 'bg-amber-50 text-amber-800')}><Cloud size={14} /> {cloud ? 'This range includes history older than your device cache – figures loaded from the cloud.' : isOnline() ? 'Loading older history from the cloud…' : 'Part of this range is older than your device cache. Connect to the internet for complete figures.'}</div>}
      <Segmented value={tab} onChange={setTab} className="w-full" options={[{ value: 'dashboard', label: 'Dashboard' }, { value: 'transactions', label: 'Transactions' }, { value: 'returns', label: `Returns${local?.returns.length ? ` (${local.returns.length})` : ''}` }, { value: 'top', label: 'Top Products' }]} />

      {tab === 'dashboard' && (
        <div className="space-y-3 animate-fade-in">
          <Card className={cls('p-4 flex items-center justify-between border-l-4', status === 'profit' ? 'border-l-brand-500 bg-brand-50/50' : status === 'loss' ? 'border-l-red-500 bg-red-50/50' : 'border-l-amber-400 bg-amber-50/50')}>
            <div className="flex items-center gap-3">
              {status === 'profit' ? <CheckCircle2 className="text-brand-600" /> : status === 'loss' ? <AlertCircle className="text-red-600" /> : <MinusCircle className="text-amber-500" />}
              <div><div className="font-semibold text-sm">{status === 'profit' ? 'Profitable' : status === 'loss' ? 'Operating at a loss' : status === 'even' ? 'Break-even' : 'No activity yet'}</div><div className="text-xs text-slate-600">{status === 'profit' ? `Net margin ${netMargin.toFixed(1)}% for this period.` : status === 'loss' ? 'Expenses exceed gross profit for this period.' : 'Your business is neither earning nor losing.'}</div></div>
            </div>
            <div className="text-right"><div className={cls('text-xl font-black tabular', net >= 0 ? 'text-brand-700' : 'text-red-600')}>{peso(net)}</div><div className="text-[10px] text-slate-500 uppercase">Net profit</div></div>
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Net Sales" value={peso(summary.gross)} hint={`${num(summary.txns)} transaction${summary.txns === 1 ? '' : 's'}${summary.creditSales > 0 ? ` · ${peso(summary.creditSales)} on utang` : ''}${summary.refunds > 0 ? ` · after ${peso(summary.refunds)} refunds` : ''}`} icon={<DollarSign size={18} />} tone="brand" />
            <StatCard label="Gross Profit" value={peso(summary.profit)} hint={`Margin: ${margin.toFixed(1)}%`} icon={<TrendingUp size={18} />} tone="green" />
            <StatCard label="Net Profit" value={peso(net)} hint={`Margin: ${netMargin.toFixed(1)}%`} icon={<Wallet size={18} />} tone={net >= 0 ? 'green' : 'red'} />
            <StatCard label="Cash Collected" value={peso(summary.cash)} hint={summary.cash === 0 && summary.collections === 0 && summary.refundCash === 0 ? 'Money received in this period' : `${peso(summary.cashCheckout)} at checkout · ${peso(summary.collections)} utang payments${summary.refundCash > 0 ? ` · −${peso(summary.refundCash)} refunds` : ''}`} icon={<ShoppingBag size={18} />} tone="blue" testId="cash-collected" />
            <StatCard label="Receivables" value={peso(local?.receivables)} hint="Unpaid credit balances" icon={<Users size={18} />} tone="orange" />
            <StatCard label="Total Expenses" value={peso(summary.expenses)} hint={`${summary.gross ? ((summary.expenses / summary.gross) * 100).toFixed(1) : '0.0'}% of sales`} icon={<Receipt size={18} />} tone="red" />
            <StatCard label="Credit / Utang" value={num(summary.creditCount)} hint={summary.creditCount ? `${peso(summary.creditSales)} added to utang${summary.creditUpfront > 0 ? ` · ${peso(summary.creditUpfront)} paid upfront` : ''}` : 'No credit sales in this period'} icon={<Users size={18} />} tone="purple" />
            <StatCard label="Void Transactions" value={num(summary.voids)} hint="Excluded from totals" icon={<Ban size={18} />} tone="slate" />
            <StatCard label="Returns / Refunds" value={peso(summary.refunds)} hint={summary.refundCount ? `${num(summary.refundCount)} return${summary.refundCount === 1 ? '' : 's'} · deducted above` : 'No returns in this period'} icon={<Undo2 size={18} />} tone="orange" onClick={() => setTab('returns')} />
          </div>

          <Card className="p-4">
            <div className="font-semibold flex items-center gap-2 mb-2"><Lightbulb size={18} className="text-amber-500" /> Smart Financial Insights</div>
            <ul className="text-sm space-y-2 text-slate-700">
              {summary.txns === 0 && <li>No sales in this period yet. Start selling from the POS tab.</li>}
              {summary.txns > 0 && <li>Gross profit is <b>{peso(summary.profit)}</b> ({margin.toFixed(1)}% of sales) across <b>{num(summary.txns)}</b> transactions — an average basket of <b>{peso(summary.gross / summary.txns)}</b>.</li>}
              {summary.expenses > summary.profit && summary.txns > 0 && <li className="text-red-700">Operating expenses ({peso(summary.expenses)}) exceed gross profit by <b>{peso(summary.expenses - summary.profit)}</b>. Reduce expenses or increase margins to become profitable.</li>}
              {summary.txns > 0 && summary.creditSales / Math.max(1, summary.gross) > 0.2 && <li className="text-orange-700"><b>{((summary.creditSales / summary.gross) * 100).toFixed(0)}%</b> of sales went on utang (unpaid at checkout). Only <b>{peso(summary.cash)}</b> actually came in — collect receivables ({peso(local?.receivables)}) to improve cash flow.</li>}
              {summary.txns > 0 && margin < 10 && <li className="text-amber-700">Gross margin is below 10%. Check items with missing purchase prices — profit may be under-reported.</li>}
              {local && local.prev.gross > 0 && <li>Sales are <b className={delta(summary.gross, local.prev.gross) >= 0 ? 'text-brand-700' : 'text-red-700'}>{delta(summary.gross, local.prev.gross) >= 0 ? 'up' : 'down'} {Math.abs(delta(summary.gross, local.prev.gross)).toFixed(0)}%</b> versus the previous {days}-day period.</li>}
              {top[0] && <li>Best seller: <b>{top[0].name}</b> — {num(top[0].qty, 2)} sold, {peso(top[0].revenue)} revenue.</li>}
            </ul>
          </Card>

          <Card className="p-4">
            <div className="font-semibold mb-0.5">Period Comparison</div><div className="text-xs text-slate-500 mb-3">vs previous {days}-day period</div>
            {[['Sales', summary.gross, local?.prev.gross || 0], ['Gross Profit', summary.profit, local?.prev.profit || 0], ['Net Profit', net, (local?.prev.profit || 0) - (local?.prev.expenses || 0)], ['Expenses', summary.expenses, local?.prev.expenses || 0]].map(([l, a, b]) => {
              const d = delta(a as number, b as number)
              const good = l === 'Expenses' ? d <= 0 : d >= 0
              return <div key={l as string} className="flex items-center justify-between py-1.5 text-sm border-b border-slate-50 last:border-0"><span className="text-slate-600">{l}</span><div className="flex items-center gap-3"><span className="tabular text-slate-500 text-xs">{peso(b as number)} →</span><span className="tabular font-semibold">{peso(a as number)}</span><span className={cls('tabular text-xs font-semibold min-w-[52px] text-right', (a as number) === 0 && (b as number) === 0 ? 'text-slate-400' : good ? 'text-brand-700' : 'text-red-600')}>{(a as number) === 0 && (b as number) === 0 ? '—' : `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`}</span></div></div>
            })}
          </Card>

          <Card className="p-4">
            <div className="font-semibold flex items-center gap-2"><Package size={18} className="text-brand-600" /> Inventory Purchases</div>
            <div className="text-xs text-slate-500 mb-3">For cash flow & purchasing analysis only — does not affect Net Profit.</div>
            <div className="flex justify-between text-sm py-1"><span className="text-slate-600">Total Purchases (period)</span><b className="tabular">{peso(local?.purchases)}</b></div>
            <div className="flex justify-between text-sm py-1"><span className="text-slate-600">Purchase Transactions</span><b className="tabular">{num(local?.purchaseCount)}</b></div>
            <div className="flex justify-between text-sm py-1"><span className="text-slate-600">Current Inventory Value</span><b className="tabular text-brand-700">{peso(local?.inventoryValue)}</b></div>
          </Card>

          <Card className="p-4">
            <div className="font-semibold">Sales & Profit Trend</div><div className="text-xs text-slate-500 mb-3">Revenue vs gross profit</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ left: -10, right: 4, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f1" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={daily.length > 14 ? Math.ceil(daily.length / 7) - 1 : 0} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => peso(v, { compact: true })} width={56} />
                  <Tooltip formatter={(v: number) => peso(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#0f7a3f" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="profit" name="Profit" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-4">
            <div className="font-semibold">Monthly Profit Trend</div><div className="text-xs text-slate-500 mb-3">Revenue · gross profit — last 6 months</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={local?.monthly || []} margin={{ left: -10, right: 8, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f1" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => peso(v, { compact: true })} width={56} />
                  <Tooltip formatter={(v: number) => peso(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#0f7a3f" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="gross" name="Gross Profit" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Monthly trend uses the sales cached on this device (last {SALES_WINDOW_DAYS} days).</p>
          </Card>
        </div>
      )}

      {tab === 'transactions' && <Transactions sales={local?.sales || []} />}

      {tab === 'returns' && <Returns returns={local?.returns || []} />}

      {tab === 'top' && (
        <Card className="animate-fade-in">
          <div className="px-4 pt-4 pb-2 font-semibold flex items-center gap-2"><Trophy size={18} className="text-amber-500" /> Top Products <span className="text-xs text-slate-500 font-normal">by revenue, net of returns</span></div>
          {top.length === 0 ? <EmptyState icon={<Trophy />} title="No sales in this period" /> : (
            <div className="divide-y divide-slate-100">
              {top.map((t, i) => (
                <div key={t.name + i} data-testid="top-row" className="flex items-center gap-3 px-4 py-2.5">
                  <div className={cls('w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0', i < 3 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600')}>{i + 1}</div>
                  <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{t.name}</div><div className="text-xs text-slate-500">{num(t.qty, 2)} sold · profit {peso(t.profit)}</div></div>
                  <div className="font-semibold tabular text-sm">{peso(t.revenue)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function Transactions({ sales }: { sales: Sale[] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Sale | null>(null)
  const [toVoid, setToVoid] = useState<Sale | null>(null)
  const [limit, setLimit] = useState(50)
  const who = (s: Sale) => s.cashier_name || memberName(s.created_by, '')
  const list = useMemo(() => { const t = q.trim().toLowerCase(); return t ? sales.filter((s) => s.txn_no.toLowerCase().includes(t) || (s.customer_name || '').toLowerCase().includes(t) || who(s).toLowerCase().includes(t) || s.items.some((i) => i.name.toLowerCase().includes(t))) : sales }, [sales, q]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3 animate-fade-in">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search txn #, customer, cashier or item" left={<Search size={18} />} />
      {list.length === 0 ? <EmptyState icon={<Receipt />} title="No transactions" /> : (
        <Card className="divide-y divide-slate-100">
          {list.slice(0, limit).map((s) => (
            <button key={s.id} onClick={() => setOpen(s)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-700">{s.txn_no}</span><Badge tone={s.status === 'void' ? 'red' : s.payment_method === 'credit' ? 'orange' : s.payment_method === 'gcash' ? 'blue' : 'green'}>{s.status === 'void' ? 'Void' : s.payment_method}</Badge>{s.customer_name && <span className="text-xs text-slate-500 truncate">{s.customer_name}</span>}</div>
                <div className="text-xs text-slate-500 truncate">{fmtRelative(s.created_at)}{who(s) && <> · <span className="text-slate-700">by {who(s)}</span></>} · {s.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}</div>
              </div>
              <div className="text-right">
                <div className={cls('font-bold tabular', s.status === 'void' ? 'text-slate-400 line-through' : 'text-slate-900')}>{peso(s.total)}</div>
                {s.status === 'active' && s.payment_method === 'credit' && <div className="text-[10px] font-semibold text-amber-700 tabular">{Number(s.amount_paid || 0) > 0 ? `${peso(Math.min(Number(s.amount_paid), Number(s.total)))} paid · ${peso(Math.max(0, Number(s.total) - Number(s.amount_paid)))} utang` : 'all on utang'}</div>}
                {Number(s.refunded_total || 0) > 0 && <div className="text-[10px] font-semibold text-orange-700 tabular">−{peso(s.refunded_total)} refunded</div>}
              </div>
            </button>
          ))}
          {list.length > limit && <button onClick={() => setLimit(limit + 100)} className="w-full h-11 text-sm text-brand-700 font-medium">Show more ({list.length - limit} remaining)</button>}
        </Card>
      )}
      <ReceiptModal sale={open} onClose={() => setOpen(null)} onVoid={(s) => setToVoid(s)} />
      <Confirm open={!!toVoid} onClose={() => setToVoid(null)} danger title={`Void ${toVoid?.txn_no}?`} message="Stock will be restored and the sale excluded from totals. This cannot be undone." confirmText="Void sale" onConfirm={async () => { if (!toVoid) return; try { await voidSale(toVoid, 'Voided from reports'); toast.success('Transaction voided'); setToVoid(null); setOpen(null) } catch (e) { toast.error('Could not void', (e as Error).message) } }} />
    </div>
  )
}

function Returns({ returns }: { returns: SaleReturn[] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<SaleReturn | null>(null)
  const list = useMemo(() => { const t = q.trim().toLowerCase(); return t ? returns.filter((r) => r.ret_no.toLowerCase().includes(t) || (r.sale_txn_no || '').toLowerCase().includes(t) || (r.customer_name || '').toLowerCase().includes(t) || (r.reason || '').toLowerCase().includes(t) || r.items.some((i) => i.name.toLowerCase().includes(t))) : returns }, [returns, q])
  const total = list.reduce((a, r) => a + Number(r.refund_total), 0)
  return (
    <div className="space-y-3 animate-fade-in">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search return #, sale #, customer, reason or item" left={<Search size={18} />} />
      {list.length === 0 ? <EmptyState icon={<Undo2 />} title="No returns in this period" message="Open a sale from Transactions or the POS “Recent” list and tap Return items." /> : (
        <Card className="divide-y divide-slate-100">
          <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500"><span>{num(list.length)} return{list.length === 1 ? '' : 's'}</span><span>Refunded <b className="text-slate-800 tabular">{peso(total)}</b></span></div>
          {list.map((r) => (
            <button key={r.id} onClick={() => setOpen(r)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="font-mono text-xs font-semibold text-slate-700">{r.ret_no}</span><Badge tone="orange">{r.refund_credit > 0 ? (r.refund_cash > 0 ? 'utang + cash' : 'off utang') : r.refund_method}</Badge><span className="text-xs text-slate-500">for sale {r.sale_txn_no}</span>{r.customer_name && <span className="text-xs text-slate-500 truncate">· {r.customer_name}</span>}</div>
                <div className="text-xs text-slate-500 truncate">{fmtRelative(r.created_at)}{r.cashier_name && <> · <span className="text-slate-700">by {r.cashier_name}</span></>}{r.reason && <> · {r.reason}</>} · {r.items.map((i) => `${i.name} ×${num(i.qty, 2)}${i.restock ? '' : ' (not restocked)'}`).join(', ')}</div>
              </div>
              <div className="font-bold tabular text-orange-700">−{peso(r.refund_total)}</div>
            </button>
          ))}
        </Card>
      )}
      {open && <ReturnSlipModal ret={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
