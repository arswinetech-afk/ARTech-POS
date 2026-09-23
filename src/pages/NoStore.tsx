import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Store as StoreIcon, LogOut, ArrowRight } from 'lucide-react'
import { useAppStore } from '../store/app'
import { Button, Input } from '../components/ui'
import { errorMessage } from '../lib/supabase'
import { toast } from '../store/ui'

const LOGO = '/brand/logo.png'

/** Shown to signed-in accounts that belong to no store (removed staff, or an invite that failed). */
export default function NoStore() {
  const { session, createOwnStore, signOut, bootError, refreshBootstrap } = useAppStore()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState(String(session?.user.user_metadata?.store_name || ''))
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!name.trim()) { toast.error('Please enter a store name'); return }
    setBusy(true)
    try { await createOwnStore(name.trim()); toast.success('Store created', 'Your 15-day free trial has started.') } catch (e) { toast.error('Could not create store', errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-dvh bg-[#f4f7f5] flex items-center justify-center p-5">
      <div className="w-full max-w-md space-y-4">
        <div className="flex flex-col items-center"><img src={LOGO} alt="ARTech POS" width={720} height={394} className="w-44 select-none" draggable={false} /></div>
        <div className="bg-white rounded-3xl shadow-pop ring-1 ring-slate-900/5 p-6 sm:p-7 space-y-4 animate-rise">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">You're not in a store yet</h1>
            <p className="text-sm text-slate-500 mt-1">Signed in as <b>{session?.user.email}</b>. Join the store you work at with an invitation code, or start your own.</p>
            {bootError && <p className="text-sm text-red-600 mt-2">{bootError} <button className="underline" onClick={() => void refreshBootstrap()}>Retry</button></p>}
          </div>

          <button onClick={() => navigate('/join')} className="w-full text-left rounded-2xl border border-brand-200 bg-brand-50/60 p-4 flex items-center gap-3 hover:border-brand-400 transition group">
            <span className="w-11 h-11 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0"><KeyRound size={22} /></span>
            <span className="flex-1 min-w-0"><span className="block font-semibold">Join with an invitation code</span><span className="block text-xs text-slate-500">Ask the store owner for their 8-character code or link.</span></span>
            <ArrowRight size={18} className="text-brand-700 transition group-hover:translate-x-0.5" />
          </button>

          {!creating ? (
            <button onClick={() => setCreating(true)} className="w-full text-left rounded-2xl border border-slate-200 p-4 flex items-center gap-3 hover:border-slate-400 transition group">
              <span className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0"><StoreIcon size={22} /></span>
              <span className="flex-1 min-w-0"><span className="block font-semibold">Create my own store</span><span className="block text-xs text-slate-500">Free for 15 days, full access, no card needed.</span></span>
              <ArrowRight size={18} className="text-slate-500 transition group-hover:translate-x-0.5" />
            </button>
          ) : (
            <div className="rounded-2xl border border-slate-200 p-4 space-y-3 animate-fade-in">
              <div className="font-semibold text-sm">Name your store</div>
              <Input left={<StoreIcon size={18} />} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bella & Ty's Consumer Goods Trading" autoFocus />
              <div className="flex gap-2"><Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button block onClick={create} loading={busy}>Create store & start trial</Button></div>
            </div>
          )}

          <div className="text-center"><button onClick={() => void signOut()} className="text-xs text-slate-500 inline-flex items-center gap-1 hover:text-red-600"><LogOut size={13} /> Sign out</button></div>
        </div>
      </div>
    </div>
  )
}
