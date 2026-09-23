import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Mail, Lock, Store as StoreIcon, User, Phone, Eye, EyeOff, WifiOff, ShieldCheck, CloudOff, Printer, ScanLine, ArrowRight, ArrowLeft, Sparkles, KeyRound, Ticket, Users } from 'lucide-react'
import { useAppStore } from '../store/app'
import { Button, Field, Input, Segmented } from '../components/ui'
import { errorMessage, supabase } from '../lib/supabase'
import { toast } from '../store/ui'
import { cls } from '../lib/format'
import { InviteCodeInput, useInvitePreview } from './JoinPage'
import { ROLE_LABEL, normalizeInviteCode } from '../lib/permissions'

const LOGO = '/brand/logo.png'

const FEATURES = [
  { icon: <CloudOff size={18} />, title: 'Works fully offline', text: 'Keep selling with no signal – everything syncs the moment you\'re back online.' },
  { icon: <ScanLine size={18} />, title: 'Camera & Bluetooth scanners', text: 'Barcode / QR scanning with the phone camera or any HID scanner.' },
  { icon: <Printer size={18} />, title: 'Thermal receipt printing', text: 'Bluetooth ESC/POS printers, 58 mm and 80 mm paper.' },
  { icon: <ShieldCheck size={18} />, title: 'Credits, expenses & reports', text: 'Utang tracking, smart insights and daily / monthly analytics.' },
]

export default function AuthPage() {
  const { session, ready, signIn, signUp } = useAppStore()
  const loc = useLocation()
  const [params] = useSearchParams()
  const codeParam = normalizeInviteCode(params.get('code') || '').slice(0, 8)
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(codeParam && params.get('mode') !== 'signin' ? 'signup' : 'signin')
  const [code, setCode] = useState(codeParam)
  const [showCode, setShowCode] = useState(!!codeParam)
  const { preview, checking } = useInvitePreview(code)
  const invited = mode === 'signup' && !!preview?.valid
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [capsOn, setCapsOn] = useState(false)
  const [fullName, setFullName] = useState('')
  const [storeName, setStoreName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmSent, setConfirmSent] = useState(false)

  if (ready && session) {
    // Signed in while holding a code → finish joining on the Join screen. (Sign-ups redeem the code server-side.)
    const target = mode === 'signin' && normalizeInviteCode(code).length === 8 ? `/join?code=${normalizeInviteCode(code)}` : (loc.state as { from?: string })?.from || '/'
    return <Navigate to={target} replace />
  }

  const switchMode = (m: 'signin' | 'signup' | 'forgot') => { setMode(m); setError(null) }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!navigator.onLine) { setError('You are offline. Connect to the internet to sign in the first time.'); return }
    setBusy(true)
    try {
      if (mode === 'signin') await signIn(email, password)
      else if (mode === 'signup') {
        if (password.length < 6) throw new Error('Password must be at least 6 characters.')
        const norm = normalizeInviteCode(code)
        if (norm.length > 0 && norm.length < 8) throw new Error('The invitation code has 8 characters. Check it or clear the field.')
        if (norm.length === 8 && !preview?.valid) throw new Error('That invitation code is not valid. Ask the store owner for a new one, or clear the field to create your own store.')
        if (!invited && !storeName.trim()) throw new Error('Please enter your store / business name.')
        if (invited && !fullName.trim()) throw new Error('Please enter your name — it will appear on the receipts you make.')
        const r = await signUp({ email, password, full_name: fullName.trim(), store_name: invited ? '' : storeName.trim(), phone: phone.trim() || undefined, invite_code: invited ? norm : null })
        if (r.needsConfirm) setConfirmSent(true)
        else toast.success(invited ? `Welcome to ${preview?.store_name}!` : 'Welcome!', invited ? `You joined as ${ROLE_LABEL[preview!.role!]}.` : 'Your 15-day free trial has started.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/settings' })
        if (error) throw error
        toast.success('Email sent', 'Check your inbox for the reset link.')
        switchMode('signin')
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally { setBusy(false) }
  }

  const onPwKey = (e: KeyboardEvent<HTMLInputElement>) => setCapsOn(e.getModifierState?.('CapsLock') ?? false)

  const heading = mode === 'signin' ? 'Welcome' : mode === 'signup' ? (invited ? `Join ${preview?.store_name}` : 'Create your store') : 'Reset password'
  const sub = mode === 'signin' ? 'Sign in to continue to your store.' : mode === 'signup' ? (invited ? `You've been invited as ${ROLE_LABEL[preview!.role!]}. Create your account to get started.` : 'Start your 15-day free trial – full access, no card needed.') : "Enter your email and we'll send you a reset link."

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.05fr_1fr] bg-[#f4f7f5] relative overflow-hidden">
      {/* Soft brand-coloured glows (match the logo's green → blue gradient) */}
      <div aria-hidden className="pointer-events-none absolute -top-28 -left-24 w-80 h-80 rounded-full bg-emerald-300/35 blur-3xl motion-safe:animate-drift" />
      <div aria-hidden className="pointer-events-none absolute top-1/3 -right-28 w-96 h-96 rounded-full bg-sky-300/30 blur-3xl motion-safe:animate-drift [animation-delay:-7s]" />

      {/* ------------------------------------------------ Brand panel (desktop) */}
      <aside className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden text-white bg-[#0f2340]">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_50%_at_0%_100%,rgba(52,199,89,.35),transparent_60%),radial-gradient(50%_40%_at_100%_0%,rgba(37,124,214,.45),transparent_60%)]" />
        <div aria-hidden className="absolute inset-0 opacity-[.07] bg-[linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] bg-[size:36px_36px]" />

        <div className="relative animate-rise">
          <div className="inline-block bg-white rounded-3xl px-8 py-6 shadow-pop transition-transform duration-500 hover:scale-[1.02] hover:-rotate-1">
            <img src={LOGO} alt="ARTech POS — Manage. Sell. Analytics." width={720} height={394} className="w-72 select-none" draggable={false} />
          </div>
        </div>

        <div className="relative space-y-8 max-w-lg">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide uppercase text-emerald-300"><Sparkles size={14} /> Manage. Sell. Analytics.</div>
            <h1 className="text-4xl xl:text-5xl font-bold leading-[1.1] mt-3">Sell anywhere.<br />Even without internet.</h1>
          </div>
          <ul className="space-y-4">
            {FEATURES.map((f, i) => (
              <li key={f.title} className="flex gap-4 group animate-rise" style={{ animationDelay: `${120 + i * 90}ms` }}>
                <span className="shrink-0 w-10 h-10 rounded-xl bg-white/10 ring-1 ring-white/15 flex items-center justify-center text-emerald-300 transition group-hover:bg-emerald-400 group-hover:text-[#0f2340] group-hover:scale-105">{f.icon}</span>
                <div><div className="font-semibold">{f.title}</div><div className="text-sm text-white/65">{f.text}</div></div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-4 text-xs text-white/60">
          <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> 15-day free trial</span>
          <span>No credit card</span>
          <span>Pay via GCash</span>
        </div>
      </aside>

      {/* ------------------------------------------------ Form side */}
      <main className="relative flex items-center justify-center px-5 py-8 sm:p-10 min-h-dvh lg:min-h-0">
        <div className="w-full max-w-md">
          {/* Logo (phones / tablets) */}
          <div className="lg:hidden flex flex-col items-center mb-7 animate-rise">
            <img src={LOGO} alt="ARTech POS — Manage. Sell. Analytics." width={720} height={394} draggable={false}
              className="w-[min(72vw,300px)] select-none motion-safe:animate-float transition-transform duration-300 active:scale-95 [filter:drop-shadow(0_10px_18px_rgba(16,24,40,.12))]" />
            <ul className="mt-5 flex flex-wrap justify-center gap-2">
              {[[<CloudOff size={13} key="o" />, 'Works offline'], [<Printer size={13} key="p" />, 'Bluetooth printing'], [<ScanLine size={13} key="s" />, 'Barcode scanner']].map(([icon, label]) => (
                <li key={String(label)} className="inline-flex items-center gap-1.5 rounded-full bg-white/80 backdrop-blur border border-slate-200/80 px-3 h-7 text-[11px] font-medium text-slate-600 shadow-card transition hover:border-brand-300 hover:text-brand-800">{icon}{label}</li>
              ))}
            </ul>
          </div>

          {!navigator.onLine && <div className="mb-4 flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm"><WifiOff size={16} /> You're offline. Sign in once online to use this device.</div>}

          {confirmSent ? (
            <div className="bg-white/90 backdrop-blur rounded-3xl shadow-pop ring-1 ring-slate-900/5 p-7 text-center space-y-3 animate-rise">
              <span className="mx-auto w-16 h-16 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center"><Mail size={32} /></span>
              <h2 className="text-xl font-bold">Confirm your email</h2>
              <p className="text-sm text-slate-600">We sent a confirmation link to <b>{email}</b>. Open it, then come back and sign in. {invited ? <>You'll land straight in <b>{preview?.store_name}</b>.</> : 'Your 15-day free trial starts immediately.'}</p>
              <Button block onClick={() => { setConfirmSent(false); switchMode('signin') }}>Back to sign in</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="bg-white/90 backdrop-blur rounded-3xl shadow-pop ring-1 ring-slate-900/5 p-6 sm:p-7 space-y-4 animate-rise [animation-delay:80ms]">
              {mode !== 'forgot' && (
                <Segmented value={mode} onChange={(v) => switchMode(v)} className="w-full [&>button]:flex-1" options={[{ value: 'signin', label: 'Sign in' }, { value: 'signup', label: 'Create account' }]} />
              )}

              <div key={mode} className="animate-fade-in">
                {mode === 'forgot' && <button type="button" onClick={() => switchMode('signin')} className="text-xs text-slate-500 inline-flex items-center gap-1 mb-2 hover:text-slate-800"><ArrowLeft size={14} /> Back to sign in</button>}
                <h2 className="text-[26px] leading-tight font-bold tracking-tight text-slate-900">{heading}</h2>
                <p className="text-sm text-slate-500 mt-1">{sub}</p>
              </div>

              {mode !== 'forgot' && (showCode || codeParam) && (
                <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-3 animate-fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-brand-800 inline-flex items-center gap-1.5"><Users size={14} /> Invitation code {mode === 'signin' && <span className="font-normal text-brand-700">· you'll join after signing in</span>}</div>
                    {!codeParam && <button type="button" onClick={() => { setShowCode(false); setCode('') }} className="text-[11px] text-slate-500 hover:text-slate-800">Remove</button>}
                  </div>
                  <InviteCodeInput value={code} onChange={setCode} preview={preview} checking={checking} />
                </div>
              )}

              {mode === 'signup' && (<>
                {!invited && <Field label="Store / business name" required><Input left={<StoreIcon size={18} />} value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="e.g. Bella & Ty's Consumer Goods Trading" required={!invited} /></Field>}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Your name" required={invited} hint={invited ? 'Shown on receipts you make' : undefined}><Input left={<User size={18} />} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Juan dela Cruz" autoComplete="name" required={invited} /></Field>
                  <Field label="Mobile no."><Input left={<Phone size={18} />} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxxx" inputMode="tel" autoComplete="tel" /></Field>
                </div>
                {!showCode && !codeParam && <button type="button" onClick={() => setShowCode(true)} className="text-xs text-brand-700 font-medium inline-flex items-center gap-1 hover:underline -mt-1"><Ticket size={13} /> Joining an existing store? Enter your invitation code</button>}
              </>)}

              <Field label="Email" required><Input left={<Mail size={18} />} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></Field>

              {mode !== 'forgot' && (
                <Field label="Password" required hint={capsOn ? <span className="text-amber-700 inline-flex items-center gap-1"><KeyRound size={12} /> Caps Lock is on</span> : undefined}>
                  <Input left={<Lock size={18} />} type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={onPwKey} onKeyDown={onPwKey}
                    placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6}
                    right={<button type="button" onClick={() => setShowPw(!showPw)} className="p-2 text-slate-400 hover:text-slate-700 transition" aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? <EyeOff size={18} /> : <Eye size={18} />}</button>} />
                </Field>
              )}

              {mode === 'signin' && <div className="text-right -mt-2"><button type="button" onClick={() => switchMode('forgot')} className="text-xs text-brand-700 font-medium hover:underline">Forgot password?</button></div>}

              {error && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2 animate-fade-in">{error}</div>}

              <button type="submit" disabled={busy}
                className={cls('group relative w-full h-12 rounded-xl font-semibold text-white overflow-hidden transition active:scale-[.985] disabled:opacity-70',
                  'bg-gradient-to-r from-brand-700 via-brand-600 to-emerald-500 shadow-[0_10px_24px_-10px_rgba(15,122,63,.7)] hover:shadow-[0_14px_28px_-10px_rgba(15,122,63,.8)]')}>
                <span aria-hidden className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                <span className="relative inline-flex items-center justify-center gap-2">
                  {busy ? <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : null}
                  {mode === 'signin' ? 'Sign in' : mode === 'signup' ? (invited ? `Create account & join` : 'Start my free trial') : 'Send reset link'}
                  {!busy && <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />}
                </span>
              </button>

              <div className="text-center text-sm text-slate-600">
                {mode === 'signin' ? (<>New here? <button type="button" className="text-brand-700 font-semibold hover:underline" onClick={() => switchMode('signup')}>Create an account</button></>)
                  : mode === 'signup' ? (<>Already registered? <button type="button" className="text-brand-700 font-semibold hover:underline" onClick={() => switchMode('signin')}>Sign in</button></>)
                  : null}
              </div>
            </form>
          )}

          <p className="text-center text-[11px] text-slate-400 mt-6">By continuing you agree to fair use of ARTech POS. Your data is stored securely in the cloud and on this device.</p>
        </div>
      </main>
    </div>
  )
}
