import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAppStore } from './store/app'
import Layout from './components/Layout'
import { Toaster, Spinner } from './components/ui'
import AuthPage from './pages/AuthPage'
import Dashboard from './pages/Dashboard'
import POS from './pages/POS'
import Items from './pages/Items'
import Credits from './pages/Credits'
import Expenses from './pages/Expenses'
import Alerts from './pages/Alerts'
import Settings from './pages/Settings'
import Subscription from './pages/Subscription'
import LockScreen from './pages/LockScreen'
import JoinPage from './pages/JoinPage'
import NoStore from './pages/NoStore'

const Reports = lazy(() => import('./pages/Reports'))
const Admin = lazy(() => import('./pages/Admin'))
const ImportPage = lazy(() => import('./pages/ImportPage'))

function Splash({ label }: { label?: string }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-[#f4f7f5]">
      <div className="w-16 h-16 rounded-2xl bg-brand-600 text-white flex items-center justify-center text-2xl font-black shadow-pop">A</div>
      <div className="text-slate-600 text-sm">{label || 'Loading ARTech POS…'}</div>
    </div>
  )
}

function Protected() {
  const { ready, session, store, access, isAdmin, bootError, noStore, refreshBootstrap } = useAppStore()
  const loc = useLocation()
  if (!ready) return <Splash />
  if (!session) return <Navigate to="/auth" replace state={{ from: loc.pathname }} />
  if (!store) {
    if (noStore) return <NoStore />
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center">
        <Spinner label="Setting up your store…" />
        {bootError && <div className="text-sm text-red-600 max-w-sm">{bootError}</div>}
        <button className="text-brand-700 text-sm underline" onClick={() => void refreshBootstrap()}>Retry</button>
        <button className="text-slate-500 text-sm underline" onClick={() => void useAppStore.getState().signOut()}>Sign out</button>
      </div>
    )
  }
  // While locked, only the subscription page (and plain settings, for exports / sign-out) stay reachable.
  const allowedWhenLocked = loc.pathname.startsWith('/subscription') || loc.pathname === '/settings'
  if (access.locked && !isAdmin && !allowedWhenLocked) return <LockScreen />
  return <Layout />
}

export default function App() {
  const init = useAppStore((s) => s.init)
  useEffect(() => { void init() }, [init])
  return (
    <BrowserRouter>
      <Toaster />
      <Suspense fallback={<Spinner label="Loading…" />}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route element={<Protected />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pos" element={<POS />} />
            <Route path="/items" element={<Items />} />
            <Route path="/credits" element={<Credits />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/import" element={<ImportPage />} />
            <Route path="/subscription" element={<Subscription />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
