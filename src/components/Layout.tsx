import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutGrid, ShoppingCart, Package, Users, BarChart3, Receipt, Bell, Settings, Cloud, CloudOff, RefreshCw, AlertTriangle, ShieldCheck, Crown, Wifi, ChevronsUpDown, Check, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useAppStore } from '../store/app'
import { useSyncStore } from '../store/sync'
import { useUI } from '../store/ui'
import { syncNow } from '../lib/sync'
import { cls, timeAgo } from '../lib/format'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { can, ROLE_LABEL, ROLE_TONE, type Permission } from '../lib/permissions'
import { Badge, Modal } from './ui'
import { toast } from '../store/ui'
import { errorMessage } from '../lib/supabase'

const NAV: Array<{ to: string; label: string; icon: typeof LayoutGrid; end?: boolean; perm?: Permission }> = [
  { to: '/', label: 'Home', icon: LayoutGrid, end: true },
  { to: '/pos', label: 'POS', icon: ShoppingCart },
  { to: '/items', label: 'Items', icon: Package },
  { to: '/credits', label: 'Credits', icon: Users },
  { to: '/reports', label: 'Reports', icon: BarChart3, perm: 'view_reports' },
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function SyncIndicator({ compact = false, iconOnly = false }: { compact?: boolean; iconOnly?: boolean }) {
  const { status, pending, failed, lastSyncAt } = useSyncStore()
  const icon = status === 'offline' ? <CloudOff size={16} /> : status === 'syncing' ? <RefreshCw size={16} className="animate-spin" /> : status === 'error' ? <AlertTriangle size={16} /> : <Cloud size={16} />
  const tone = status === 'offline' ? 'text-slate-500 bg-slate-100' : status === 'error' || failed ? 'text-amber-700 bg-amber-50' : status === 'syncing' ? 'text-sky-700 bg-sky-50' : 'text-brand-700 bg-brand-50'
  const label = status === 'offline' ? 'Offline' : status === 'syncing' ? 'Syncing' : failed ? `${failed} failed` : pending ? `${pending} pending` : 'Synced'
  return (
    <button onClick={() => void syncNow('manual')} title={`${label} · last sync ${timeAgo(lastSyncAt)}`} className={cls('inline-flex items-center gap-1.5 rounded-full text-xs font-medium transition', tone, iconOnly ? 'w-9 h-9 justify-center' : compact ? 'px-2 h-7' : 'px-2.5 h-8')}>
      {icon}{!iconOnly && <span className={compact ? 'hidden sm:inline' : ''}>{label}</span>}
      {pending > 0 && status !== 'syncing' && <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center">{pending}</span>}
    </button>
  )
}

export default function Layout() {
  const { store, access, isAdmin, profile, role } = useAppStore()
  const nav = NAV.filter((n) => !n.perm || can(role, n.perm, isAdmin))
  const { pathname } = useLocation()
  const { sidebarCollapsed, setSidebarCollapsed, posFocus, setPosFocus } = useUI()
  const onPOS = pathname.startsWith('/pos')
  // POS gets "focus mode": the sidebar shrinks to an icon rail so items + cart get the width.
  const collapsed = onPOS ? posFocus : sidebarCollapsed
  const toggleSidebar = () => (onPOS ? setPosFocus(!posFocus) : setSidebarCollapsed(!sidebarCollapsed))
  const pendingReminders = useLiveQuery(async () => {
    if (!store) return 0
    const now = new Date().toISOString()
    return (await db.reminders.where('store_id').equals(store.id).toArray()).filter((r) => !r.is_done && r.due_at && r.due_at <= now).length
  }, [store?.id], 0)

  return (
    <div className="min-h-dvh flex bg-[#f4f7f5]">
      {/* Sidebar (desktop) — collapses to an icon rail (POS focus mode or by choice) */}
      <aside data-testid="sidebar" data-collapsed={collapsed ? '1' : '0'} className={cls('hidden md:flex flex-col bg-white border-r border-slate-200 sticky top-0 h-dvh transition-[width] duration-200 ease-out shrink-0', collapsed ? 'w-[68px]' : 'md:w-60 lg:w-64')}>
        <div className={cls('border-b border-slate-100 flex items-center', collapsed ? 'px-3 py-3 justify-center' : 'px-4 py-4')}>
          {collapsed ? <StoreLogo size={36} /> : <StoreSwitcher />}
        </div>
        <nav className={cls('flex-1 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden', collapsed ? 'px-2' : 'px-2')}>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined} className={({ isActive }) => cls('group relative flex items-center rounded-xl text-sm font-medium transition', collapsed ? 'justify-center h-11 w-[52px] mx-auto' : 'gap-3 px-3 h-11', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50')}>
              <n.icon size={20} className="shrink-0" />
              {!collapsed && n.label}
              {collapsed && <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-slate-900 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition z-50">{n.label}</span>}
              {n.to === '/alerts' && pendingReminders > 0 && <span className={cls('text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5', collapsed ? 'absolute top-1 right-1' : 'ml-auto')}>{pendingReminders}</span>}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink to="/admin" title={collapsed ? 'Admin Console' : undefined} className={({ isActive }) => cls('group relative flex items-center rounded-xl text-sm font-medium transition', collapsed ? 'justify-center h-11 w-[52px] mx-auto' : 'gap-3 px-3 h-11', isActive ? 'bg-violet-50 text-violet-700' : 'text-violet-700 hover:bg-violet-50')}>
              <ShieldCheck size={20} className="shrink-0" /> {!collapsed && 'Admin Console'}
              {collapsed && <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-slate-900 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition z-50">Admin Console</span>}
            </NavLink>
          )}
        </nav>
        <div className={cls('border-t border-slate-100', collapsed ? 'p-2 space-y-2 flex flex-col items-center' : 'p-3 space-y-2')}>
          {collapsed ? <SyncIndicator compact iconOnly /> : <AccessPill />}
          {!collapsed && (
            <div className="flex items-center justify-between">
              <SyncIndicator />
              <span className="text-[11px] text-slate-400 truncate max-w-[110px]" title={profile?.email || ''}>{profile?.email}</span>
            </div>
          )}
          <button type="button" onClick={toggleSidebar} data-testid="sidebar-toggle" title={collapsed ? 'Expand menu' : (onPOS ? 'Focus mode: hide menu labels while selling' : 'Collapse menu')}
            className={cls('flex items-center gap-2 rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition', collapsed ? 'justify-center w-[52px] h-10' : 'w-full h-9 px-3')}>
            {collapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={18} /> {onPOS ? 'Focus mode' : 'Collapse'}</>}
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar (mobile) */}
        <header className="md:hidden sticky top-0 z-40 bg-[#e8f0eb]/95 backdrop-blur border-b border-slate-200/70 pt-[env(safe-area-inset-top)]">
          <div className="px-4 py-2.5 flex items-center gap-3">
            <div className="min-w-0 flex-1"><StoreSwitcher /></div>
            <SyncIndicator compact />
          </div>
        </header>

        <TrialBanner />

        <main className={cls('flex-1 px-4 py-4 md:px-6 md:py-6 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-8 w-full mx-auto', onPOS ? 'max-w-none md:py-4 md:pb-4' : 'max-w-6xl')}>
          <Outlet />
        </main>

        {/* Bottom nav (mobile) */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cls('flex flex-col items-center justify-center gap-0.5 h-16 text-[10px] font-medium relative', isActive ? 'text-brand-700' : 'text-slate-500')}>
                {({ isActive }) => (<>
                  <span className={cls('w-9 h-7 rounded-lg flex items-center justify-center transition', isActive && 'bg-brand-50')}><n.icon size={20} /></span>
                  {n.label}
                  {n.to === '/alerts' && pendingReminders > 0 && <span className="absolute top-2 right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center">{pendingReminders}</span>}
                </>)}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}

/** Store name + logo; becomes a switcher when the user belongs to several stores. */
function StoreSwitcher() {
  const { store, stores, role, isAdmin, switchStore } = useAppStore()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const multi = stores.length > 1
  const pick = async (id: string) => {
    if (id === store?.id) { setOpen(false); return }
    setBusy(id)
    try { await switchStore(id); setOpen(false); toast.success('Store switched', stores.find((s) => s.id === id)?.name) } catch (e) { toast.error('Cannot switch', errorMessage(e)) } finally { setBusy(null) }
  }
  return (
    <>
      <button type="button" onClick={() => multi && setOpen(true)} className={cls('flex items-center gap-3 text-left w-full min-w-0 rounded-xl -mx-1 px-1 py-0.5', multi && 'hover:bg-slate-100/70 active:bg-slate-100')} aria-haspopup={multi ? 'dialog' : undefined} data-testid="store-switcher">
        <StoreLogo />
        <div className="min-w-0 flex-1">
          <div className="font-bold text-slate-900 truncate leading-tight flex items-center gap-1.5">{store?.name || 'ARTech POS'}{multi && <ChevronsUpDown size={14} className="text-slate-400 shrink-0" />}</div>
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            {role && role !== 'owner' && !isAdmin && <span className="font-semibold text-slate-600">{ROLE_LABEL[role]} ·</span>}
            <span className="truncate">powered by ARTech POS</span>
          </div>
        </div>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Switch store" size="sm">
        <ul className="space-y-1.5">
          {stores.map((s) => (
            <li key={s.id}>
              <button onClick={() => void pick(s.id)} disabled={!!busy} className={cls('w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition', s.id === store?.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300')}>
                <span className="w-9 h-9 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold shrink-0">{s.name.slice(0, 1).toUpperCase()}</span>
                <span className="flex-1 min-w-0"><span className="block text-sm font-semibold truncate">{s.name}</span><span className="block text-[11px] text-slate-500 truncate">{s.owner_name ? `Owner: ${s.owner_name}` : ''}</span></span>
                <Badge tone={ROLE_TONE[s.role]}>{ROLE_LABEL[s.role]}</Badge>
                {s.id === store?.id ? <Check size={16} className="text-brand-700" /> : busy === s.id ? <RefreshCw size={16} className="animate-spin text-slate-400" /> : null}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-slate-500 mt-3">Switching downloads the other store's data to this device. Pending changes must finish syncing first.</p>
      </Modal>
    </>
  )
}

export function StoreLogo({ size = 40 }: { size?: number }) {
  const store = useAppStore((s) => s.store)
  if (store?.logo_data) return <img src={store.logo_data} alt="logo" style={{ width: size, height: size }} className="rounded-full object-cover bg-white ring-1 ring-slate-200 shrink-0" />
  return <div style={{ width: size, height: size }} className="rounded-full bg-brand-600 text-white flex items-center justify-center font-bold shrink-0">{(store?.name || 'A').slice(0, 1).toUpperCase()}</div>
}

function AccessPill() {
  const { access } = useAppStore()
  const navigate = useNavigate()
  const tone = access.state === 'admin' ? 'bg-violet-50 text-violet-700' : access.state === 'active' ? 'bg-brand-50 text-brand-700' : access.state === 'trial' ? (access.daysLeft <= 5 ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700') : 'bg-red-50 text-red-700'
  return (
    <button onClick={() => navigate('/subscription')} className={cls('w-full flex items-center gap-2 px-3 h-9 rounded-xl text-xs font-medium', tone)}>
      {access.state === 'admin' ? <ShieldCheck size={14} /> : access.state === 'active' ? <Crown size={14} /> : <Wifi size={14} />}
      <span className="truncate">{access.label}</span>
    </button>
  )
}

function TrialBanner() {
  const { access } = useAppStore()
  const navigate = useNavigate()
  if (access.state === 'trial' && access.daysLeft <= 5) {
    return (
      <button onClick={() => navigate('/subscription')} className="w-full bg-amber-500 text-white text-xs font-medium px-4 py-2 text-center">
        Your free trial ends in {access.daysLeft} day{access.daysLeft === 1 ? '' : 's'} · Choose a plan to keep selling →
      </button>
    )
  }
  if (access.state === 'active' && access.daysLeft <= 3) {
    return (
      <button onClick={() => navigate('/subscription')} className="w-full bg-amber-500 text-white text-xs font-medium px-4 py-2 text-center">
        Your subscription expires in {access.daysLeft} day{access.daysLeft === 1 ? '' : 's'} · Renew now →
      </button>
    )
  }
  return null
}
