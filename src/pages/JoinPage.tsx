import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, KeyRound, Store as StoreIcon, CheckCircle2, AlertCircle, LogIn } from 'lucide-react'
import { useAppStore } from '../store/app'
import { Button, Spinner } from '../components/ui'
import { previewInvite, reasonText, type InvitePreview } from '../lib/invites'
import { ROLE_INFO, ROLE_LABEL, formatInviteCode, normalizeInviteCode } from '../lib/permissions'
import { errorMessage, isOnline } from '../lib/supabase'
import { toast } from '../store/ui'
import { cls } from '../lib/format'

const LOGO = '/brand/logo.png'

/** Shared code box + live preview (used here and on the sign-up form). */
export function InviteCodeInput({ value, onChange, preview, checking, autoFocus }: { value: string; onChange: (v: string) => void; preview: InvitePreview | null; checking: boolean; autoFocus?: boolean }) {
  const norm = normalizeInviteCode(value)
  return (
    <div>
      <div className="relative">
        <KeyRound size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={formatInviteCode(value)} onChange={(e) => onChange(normalizeInviteCode(e.target.value).slice(0, 8))} autoFocus={autoFocus} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          placeholder="XXXX-XXXX" inputMode="text" aria-label="Invitation code" data-testid="join-code"
          className={cls('w-full h-14 pl-11 pr-4 rounded-xl border bg-white font-mono text-2xl font-bold tracking-[.2em] uppercase outline-none transition focus:ring-4',
            preview?.valid ? 'border-brand-500 focus:ring-brand-500/15' : preview && norm.length === 8 ? 'border-red-400 focus:ring-red-500/10' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/15')} />
      </div>
      <div className="min-h-[22px] mt-1.5 text-xs">
        {checking && <span className="text-slate-500">Checking code…</span>}
        {!checking && preview?.valid && <span className="text-brand-700 font-medium"><CheckCircle2 size={14} className="inline -mt-0.5 mr-1" />Joins <b>{preview.store_name}</b> as {ROLE_LABEL[preview.role!]}</span>}
        {!checking && preview && !preview.valid && norm.length === 8 && <span className="text-red-600"><AlertCircle size={14} className="inline -mt-0.5 mr-1" />{reasonText(preview.reason)}</span>}
        {!checking && !preview && <span className="text-slate-400">8 letters/numbers — ask the store owner for the code.</span>}
      </div>
    </div>
  )
}

export function useInvitePreview(code: string) {
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [checking, setChecking] = useState(false)
  const norm = normalizeInviteCode(code)
  useEffect(() => {
    if (norm.length !== 8) { setPreview(null); return }
    let alive = true
    setChecking(true)
    const t = setTimeout(() => {
      previewInvite(norm).then((p) => { if (alive) setPreview(p) }).catch(() => { if (alive) setPreview({ valid: false, reason: 'INVALID' }) }).finally(() => { if (alive) setChecking(false) })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [norm])
  return { preview, checking }
}

export default function JoinPage() {
  const { ready, session, store, stores, joinStore } = useAppStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [code, setCode] = useState(normalizeInviteCode(params.get('code') || '').slice(0, 8))
  const { preview, checking } = useInvitePreview(code)
  const [busy, setBusy] = useState(false)

  if (!ready) return <Spinner label="Loading…" />
  if (!session) return <Navigate to={`/auth${code ? `?code=${code}` : ''}`} replace />

  const already = !!preview?.valid && stores.some((s) => s.id === preview.store_id)
  const join = async () => {
    setBusy(true)
    try {
      const r = await joinStore(code)
      if (!r.ok) { toast.error('Cannot join', reasonText(r.reason)); return }
      toast.success(r.already_member ? `You're already in ${r.store_name}` : `Welcome to ${r.store_name}!`, `You joined as ${ROLE_LABEL[r.role || 'cashier']}. Downloading the store's data…`)
      navigate('/', { replace: true })
    } catch (e) { toast.error('Cannot join', errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-dvh bg-[#f4f7f5] flex items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6"><img src={LOGO} alt="ARTech POS" width={720} height={394} className="w-44 select-none" draggable={false} /></div>
        <div className="bg-white rounded-3xl shadow-pop ring-1 ring-slate-900/5 p-6 sm:p-7 space-y-5 animate-rise">
          <button type="button" onClick={() => { if (store && window.history.length > 1) navigate(-1); else navigate('/') }} className="text-xs text-slate-500 inline-flex items-center gap-1 hover:text-slate-800"><ArrowLeft size={14} /> Back</button>
          <div>
            <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center mb-3"><StoreIcon size={24} /></div>
            <h1 className="text-2xl font-bold tracking-tight">Join a store</h1>
            <p className="text-sm text-slate-500 mt-1">Enter the invitation code from the store owner. You'll get the role they chose and the store's data will sync to this device.</p>
          </div>

          {!isOnline() && <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">You're offline. Connect to the internet to join a store.</div>}
          <InviteCodeInput value={code} onChange={setCode} preview={preview} checking={checking} autoFocus={!code} />

          {preview?.valid && (
            <div className="rounded-xl bg-brand-50 border border-brand-100 p-3 text-sm text-brand-900">
              <div className="font-semibold">{preview.store_name}</div>
              <div className="text-xs mt-0.5">As <b>{ROLE_LABEL[preview.role!]}</b>: {ROLE_INFO.find((r) => r.value === preview.role)?.blurb}</div>
            </div>
          )}

          <Button block size="lg" icon={<LogIn size={18} />} onClick={join} loading={busy} disabled={!preview?.valid}>
            {already ? `Open ${preview?.store_name}` : preview?.valid ? `Join ${preview.store_name}` : 'Join store'}
          </Button>
          {already && <div className="text-xs text-center text-slate-500">You're already a member of this store.</div>}
          {session && <div className="text-center text-xs text-slate-500">Signed in as <b>{session.user.email}</b>{!store && <> · <button onClick={() => void useAppStore.getState().signOut()} className="text-brand-700 hover:underline">use another account</button></>}</div>}
        </div>
      </div>
    </div>
  )
}
