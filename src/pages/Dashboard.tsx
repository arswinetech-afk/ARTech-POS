import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ShoppingCart, TrendingUp, Users, AlertTriangle, Download, AlertOctagon, PackagePlus, Wallet, ChevronRight, Sparkles, Share2 } from 'lucide-react'
import { format, subDays, startOfDay } from 'date-fns'
import { db } from '../lib/db'
import { useAppStore, usePermission } from '../store/app'
import { StatCard, Card, Button, Badge, Modal } from '../components/ui'
import { peso, num, fmtDate, cls } from '../lib/format'
import { toast } from '../store/ui'
import { errorMessage } from '../lib/supabase'
import type { Product, Credit } from '../lib/types'

export default function Dashboard() {
  const { store, profile } = useAppStore()
  const canSeeCost = usePermission('see_cost')
  const canManageItems = usePermission('manage_items')
  const navigate = useNavigate()
  const [listModal, setListModal] = useState<'out' | 'low' | null>(null)
  const threshold = store?.low_stock_threshold ?? 5

  const data = useLiveQuery(async () => {
    if (!store) return null
    const start = startOfDay(new Date()).toISOString()
    const weekStart = startOfDay(subDays(new Date(), 6)).toISOString()
    const [salesWeek, products, credits, customers, expensesToday, returnsWeek] = await Promise.all([
      db.sales.where('store_id').equals(store.id).and((s) => s.created_at >= weekStart).toArray(),
      db.products.where('store_id').equals(store.id).toArray(),
      db.credits.where('store_id').equals(store.id).toArray(),
      db.customers.where('store_id').equals(store.id).toArray(),
      db.expenses.where('store_id').equals(store.id).and((e) => e.expense_date === format(new Date(), 'yyyy-MM-dd')).toArray(),
      db.sale_returns.where('store_id').equals(store.id).and((r) => r.created_at >= weekStart).toArray(),
    ])
    const today = salesWeek.filter((s) => s.created_at >= start && s.status === 'active')
    // net of refunds handed back today (partial returns, 2.3)
    const refundsToday = returnsWeek.filter((r) => r.created_at >= start)
    const todaySales = today.reduce((a, s) => a + Number(s.total), 0) - refundsToday.reduce((a, r) => a + Number(r.refund_total), 0)
    const todayProfit = today.reduce((a, s) => a + Number(s.profit), 0) - refundsToday.reduce((a, r) => a + Number(r.refund_total) - Number(r.restock_cost), 0)
    const todayExpenses = expensesToday.reduce((a, e) => a + Number(e.amount), 0)
    // part of today's sales that went on utang (credit sales minus what was paid upfront)
    const todayUtang = today.filter((s) => s.payment_method === 'credit').reduce((a, s) => a + Math.max(0, Number(s.total) - Math.min(Number(s.amount_paid || 0), Number(s.total))), 0)
    const open = credits.filter((c) => !c.settled)
    const debt = open.reduce((a, c) => a + Number(c.amount) - Number(c.paid), 0)
    const debtors = new Set(open.map((c) => c.customer_id)).size
    const lim = (p: Product) => p.low_stock_at ?? threshold
    const outOfStock = products.filter((p) => Number(p.stock) <= 0).sort((a, b) => a.name.localeCompare(b.name))
    const lowStock = products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= lim(p)).sort((a, b) => Number(a.stock) - Number(b.stock))
    const custName = new Map(customers.map((c) => [c.id, c.name]))
    const pending = open.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6).map((c) => ({ ...c, name: custName.get(c.customer_id || '') || 'Unknown' }))
    // 7-day series
    const days = Array.from({ length: 7 }, (_, i) => format(subDays(new Date(), 6 - i), 'yyyy-MM-dd'))
    const series = days.map((d) => ({ d, v: salesWeek.filter((s) => s.status === 'active' && s.created_at.slice(0, 10) === d).reduce((a, s) => a + Number(s.total), 0) - returnsWeek.filter((r) => r.created_at.slice(0, 10) === d).reduce((a, r) => a + Number(r.refund_total), 0) }))
    return { todaySales, todayProfit, todayExpenses, todayUtang, txns: today.length, debt, debtors, outOfStock, lowStock, pending, products, series, inventoryValue: products.reduce((a, p) => a + Number(p.cost) * Number(p.stock), 0) }
  }, [store?.id, threshold])

  const greeting = useMemo(() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }, [])

  // Stock Replenishment & Analytics Report (PDF) — same layout as the original ARTech POS report.
  const [pdfBusy, setPdfBusy] = useState<'save' | 'share' | null>(null)
  const shareOk = useMemo(() => { try { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }) } catch { return false } }, [])
  const stockReport = async (mode: 'save' | 'share') => {
    if (!store || pdfBusy) return
    setPdfBusy(mode)
    try {
      const m = await import('../lib/stockReport')
      const r = await m.createStockReport(store)
      if (mode === 'share' && m.canSharePdf(r.blob, r.filename)) {
        try { await m.sharePdf(r.blob, r.filename, `${store.name} — Stock Report`) } catch (e) { if ((e as Error)?.name !== 'AbortError') throw e }
      } else {
        m.savePdf(r.blob, r.filename)
        toast.success('Stock report downloaded', `${r.filename} · ${r.pages} page${r.pages === 1 ? '' : 's'} · ${num(r.data.outOfStock.length)} out of stock, ${num(r.data.lowStock.length)} low`)
      }
    } catch (e) { toast.error('Could not create the report', errorMessage(e)) } finally { setPdfBusy(null) }
  }

  const max = Math.max(1, ...(data?.series.map((s) => s.v) || [1]))

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-sm text-slate-500">{format(new Date(), 'EEEE, MMMM d')}</div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <div className="text-right text-sm text-slate-500 hidden sm:block">{greeting}, {profile?.full_name?.split(' ')[0] || store?.owner_name || 'there'} 👋</div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2">
        <Button size="md" onClick={() => navigate('/pos')} icon={<ShoppingCart size={18} />}>New Sale</Button>
        <Button size="md" variant="secondary" onClick={() => navigate(canManageItems ? '/items?new=1' : '/items')} icon={<PackagePlus size={18} />}>{canManageItems ? 'Add Item' : 'Items'}</Button>
        <Button size="md" variant="secondary" onClick={() => navigate('/credits')} icon={<Wallet size={18} />}>Collect</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Today's Sales" value={peso(data?.todaySales)} hint={`${data?.txns ?? 0} transaction${data?.txns === 1 ? '' : 's'}${(data?.todayUtang || 0) > 0 ? ` · ${peso(data?.todayUtang)} on utang` : ''}`} icon={<ShoppingCart size={18} />} tone="brand" onClick={() => navigate('/reports?range=today')} />
        {canSeeCost ? <StatCard label="Today's Profit" value={peso(data?.todayProfit)} hint={`After expenses: ${peso((data?.todayProfit || 0) - (data?.todayExpenses || 0))}`} icon={<TrendingUp size={18} />} tone="green" onClick={() => navigate('/reports?range=today')} />
          : <StatCard label="Today's Expenses" value={peso(data?.todayExpenses)} hint="Recorded today" icon={<TrendingUp size={18} />} tone="green" onClick={() => navigate('/expenses')} />}
        <StatCard label="Outstanding Debt" value={peso(data?.debt)} hint={`${data?.debtors ?? 0} customer${data?.debtors === 1 ? '' : 's'} with balance`} icon={<Users size={18} />} tone="orange" onClick={() => navigate('/credits')} />
        <StatCard label="Low Stock Items" value={num((data?.lowStock.length || 0) + (data?.outOfStock.length || 0))} hint={`≤ ${threshold} units remaining`} icon={<AlertTriangle size={18} />} tone="yellow" onClick={() => setListModal('low')} />
      </div>

      {/* 7-day trend */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div><div className="font-semibold">Last 7 days</div><div className="text-xs text-slate-500">Sales per day{canSeeCost && <> · Inventory value {peso(data?.inventoryValue)}</>}</div></div>
          <button className="text-xs text-brand-700 font-medium flex items-center" onClick={() => navigate('/reports')}>Reports <ChevronRight size={14} /></button>
        </div>
        <div className="flex items-end gap-2 h-24">
          {(data?.series || []).map((s) => (
            <div key={s.d} className="flex-1 flex flex-col items-center gap-1 group">
              <div className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition tabular">{peso(s.v, { compact: true })}</div>
              <div className={cls('w-full rounded-t-md transition-all', s.d === format(new Date(), 'yyyy-MM-dd') ? 'bg-brand-600' : 'bg-brand-200')} style={{ height: `${Math.max(4, (s.v / max) * 72)}px` }} />
              <div className="text-[10px] text-slate-500">{format(new Date(s.d + 'T00:00:00'), 'EEE')}</div>
            </div>
          ))}
        </div>
      </Card>

      {canSeeCost && (
        <div className="flex gap-2">
          <Button variant="outline" block icon={<Download size={18} />} loading={pdfBusy === 'save'} disabled={!!pdfBusy} onClick={() => stockReport('save')} data-testid="stock-report">Download Stock Report</Button>
          {shareOk && <Button variant="outline" icon={<Share2 size={18} />} loading={pdfBusy === 'share'} disabled={!!pdfBusy} onClick={() => stockReport('share')} aria-label="Share stock report PDF" className="shrink-0" />}
        </div>
      )}

      {/* Out of stock */}
      {!!data?.outOfStock.length && (
        <Card className="p-4 bg-red-50/70 border-red-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 font-semibold text-red-800"><AlertOctagon size={18} /> Out of Stock ({data.outOfStock.length})</div>
            <button className="text-xs text-red-700 font-medium" onClick={() => setListModal('out')}>Tap to view all →</button>
          </div>
          <ul className="divide-y divide-red-100">
            {data.outOfStock.slice(0, 5).map((p) => (
              <li key={p.id} className="flex justify-between py-1.5 text-sm"><span className="text-red-900 truncate pr-3">{p.name}</span><span className="font-semibold text-red-700 shrink-0">0 left</span></li>
            ))}
          </ul>
        </Card>
      )}

      {/* Low stock */}
      {!!data?.lowStock.length && (
        <Card className="p-4 bg-amber-50/70 border-amber-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 font-semibold text-amber-800"><AlertTriangle size={18} /> Low Stock Alert ({data.lowStock.length})</div>
            <button className="text-xs text-amber-700 font-medium" onClick={() => setListModal('low')}>Tap to view all →</button>
          </div>
          <ul className="divide-y divide-amber-100">
            {data.lowStock.slice(0, 5).map((p) => (
              <li key={p.id} className="flex justify-between py-1.5 text-sm"><span className="text-amber-900 truncate pr-3">{p.name}</span><span className="font-semibold text-amber-700 shrink-0">{num(p.stock, 2)} left</span></li>
            ))}
          </ul>
        </Card>
      )}

      {/* Pending credits */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold bg-amber-400 px-2 py-0.5 rounded text-slate-900">Pending Credits</div>
          <button className="text-xs text-brand-700 font-medium" onClick={() => navigate('/credits')}>View all →</button>
        </div>
        {data?.pending.length ? (
          <ul className="divide-y divide-slate-100">
            {data.pending.map((c: Credit & { name: string }) => (
              <li key={c.id} className="flex justify-between items-center py-2 text-sm">
                <div><div className="font-medium text-slate-800">{c.name}</div><div className="text-[11px] text-slate-500">{fmtDate(c.created_at, 'MMM d, h:mm a')}{c.notes ? ` · ${c.notes}` : ''}</div></div>
                <span className="font-bold text-orange-600 tabular">{peso(Number(c.amount) - Number(c.paid))}</span>
              </li>
            ))}
          </ul>
        ) : <div className="text-sm text-slate-500 py-3 flex items-center gap-2"><Sparkles size={16} className="text-brand-500" /> No pending credits. Nice!</div>}
      </Card>

      <Modal open={listModal !== null} onClose={() => setListModal(null)} title={listModal === 'out' ? `Out of Stock (${data?.outOfStock.length ?? 0})` : `Low Stock (${(data?.lowStock.length ?? 0) + (data?.outOfStock.length ?? 0)})`} size="lg">
        <ul className="divide-y divide-slate-100">
          {(listModal === 'out' ? data?.outOfStock : [...(data?.lowStock || []), ...(data?.outOfStock || [])])?.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2.5 text-sm cursor-pointer" onClick={() => navigate(`/items?q=${encodeURIComponent(p.name)}`)}>
              <div className="min-w-0"><div className="font-medium truncate">{p.name}</div><div className="text-xs text-slate-500">{p.category || 'Uncategorised'} · {peso(p.price)}</div></div>
              <Badge tone={Number(p.stock) <= 0 ? 'red' : 'yellow'}>{num(p.stock, 2)} left</Badge>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  )
}
