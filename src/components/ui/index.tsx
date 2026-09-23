import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Loader2, X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { createPortal } from 'react-dom'
import { cls } from '../../lib/format'
import { useUI } from '../../store/ui'

/* ------------------------------------------------------------ Button */
type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'warning'
type Size = 'xs' | 'sm' | 'md' | 'lg'
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode; block?: boolean }
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm',
  secondary: 'bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-100',
  outline: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  warning: 'bg-amber-500 text-white hover:bg-amber-600',
}
const sizes: Record<Size, string> = { xs: 'h-7 px-2.5 text-xs gap-1', sm: 'h-9 px-3 text-sm gap-1.5', md: 'h-11 px-4 text-sm gap-2', lg: 'h-12 px-5 text-base gap-2' }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading} className={cls('inline-flex items-center justify-center rounded-xl font-medium transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none select-none', variants[variant], sizes[size], block && 'w-full', className)} {...rest}>
      {loading ? <Loader2 className="animate-spin" size={size === 'xs' ? 14 : 18} /> : icon}
      {children}
    </button>
  )
})

/* ------------------------------------------------------------ Card */
export function Card({ className, children, onClick, testId }: { className?: string; children: ReactNode; onClick?: () => void; testId?: string }) {
  return <div onClick={onClick} data-testid={testId} className={cls('bg-white rounded-2xl shadow-card border border-slate-100', onClick && 'cursor-pointer hover:shadow-pop transition', className)}>{children}</div>
}
export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && <span className="text-brand-600 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900 leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function StatCard({ label, value, hint, icon, tone = 'brand', onClick, footer, testId }: { label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: 'brand' | 'green' | 'orange' | 'yellow' | 'red' | 'blue' | 'purple' | 'slate'; onClick?: () => void; footer?: ReactNode; testId?: string }) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-600', green: 'bg-emerald-50 text-emerald-600', orange: 'bg-orange-50 text-orange-600',
    yellow: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600', blue: 'bg-sky-50 text-sky-600', purple: 'bg-violet-50 text-violet-600', slate: 'bg-slate-100 text-slate-600',
  }
  return (
    <Card onClick={onClick} testId={testId} className="p-4 flex flex-col gap-2 animate-fade-in">
      <div className="flex items-start justify-between">
        <span className="text-sm text-slate-600 font-medium">{label}</span>
        <span className={cls('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', tones[tone])}>{icon}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight text-slate-900 truncate">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
      {footer ?? (onClick && <div className="text-xs text-brand-600 font-medium">Tap for details →</div>)}
    </Card>
  )
}

/* ------------------------------------------------------------ Badge */
export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: 'slate' | 'green' | 'red' | 'yellow' | 'blue' | 'orange' | 'purple' | 'brand'; className?: string }) {
  const t: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', red: 'bg-red-100 text-red-700', yellow: 'bg-amber-100 text-amber-800',
    blue: 'bg-sky-100 text-sky-800', orange: 'bg-orange-100 text-orange-800', purple: 'bg-violet-100 text-violet-800', brand: 'bg-brand-100 text-brand-800',
  }
  return <span className={cls('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide', t[tone], className)}>{children}</span>
}

/* ------------------------------------------------------------ Form controls */
/** A labelled form row. Rendered as a <div> (not <label>) on purpose: fields often contain
 *  buttons / pickers, and a <label>'s activation behaviour would forward clicks to them. */
export function Field({ label, hint, error, children, required }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; required?: boolean }) {
  return (
    <div className="block">
      {label && <span className="block text-sm font-medium text-slate-700 mb-1">{label}{required && <span className="text-red-500"> *</span>}</span>}
      {children}
      {error ? <span className="block text-xs text-red-600 mt-1">{error}</span> : hint ? <span className="block text-xs text-slate-500 mt-1">{hint}</span> : null}
    </div>
  )
}
const inputCls = 'w-full h-11 px-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 disabled:bg-slate-50 text-[15px]'
/** Drop the default `w-full` when the caller passes its own width utility, so `className="w-32"` wins. */
const baseCls = (className?: string) => (className && /(^|\s)(w-|min-w-|max-w-)/.test(className) ? inputCls.replace('w-full', 'min-w-0') : inputCls)
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { left?: ReactNode; right?: ReactNode; wrapperClassName?: string }>(function Input({ className, left, right, wrapperClassName, ...rest }, ref) {
  if (!left && !right) return <input ref={ref} className={cls(baseCls(className), className)} {...rest} />
  return (
    <div className={cls('relative w-full min-w-0', wrapperClassName)}>
      {left && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">{left}</span>}
      <input ref={ref} className={cls(baseCls(className), left ? 'pl-10' : '', right ? 'pr-11' : '', className)} {...rest} />
      {right && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{right}</span>}
    </div>
  )
})
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={cls(baseCls(className), 'appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 fill=%27%2364748b%27 viewBox=%270 0 16 16%27><path d=%27M4.4 6l3.6 3.6L11.6 6z%27/></svg>")] bg-no-repeat bg-[right_.75rem_center] pr-9', className)} {...rest}>{children}</select>
})
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cls(baseCls(className), 'h-auto py-2.5 min-h-[84px]', className)} {...rest} />
})

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center justify-between w-full py-2 text-left">
      <span><span className="block text-sm font-medium text-slate-800">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
      <span className={cls('relative inline-flex h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={cls('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode }>; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cls('inline-flex bg-slate-100 rounded-xl p-1 gap-1 max-w-full overflow-x-auto no-scrollbar', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={cls('rounded-lg font-medium whitespace-nowrap transition', size === 'sm' ? 'px-3 h-8 text-xs' : 'px-4 h-9 text-sm', value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{o.label}</button>
      ))}
    </div>
  )
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className={cls('px-3 h-8 rounded-full text-sm whitespace-nowrap border transition', active ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300')}>{children}</button>
}

/* ------------------------------------------------------------ Modal / Sheet */
export function Modal({ open, onClose, title, children, footer, size = 'md', sheet = true }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; sheet?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }
  // Portal to <body>: a `fixed` element inside an ancestor with backdrop-filter/transform
  // (e.g. the blurred mobile header) would otherwise be positioned relative to that ancestor.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className={cls('relative bg-white w-full min-w-0 max-h-[92dvh] flex flex-col shadow-pop', sheet ? 'rounded-t-3xl sm:rounded-2xl animate-slide-up sm:animate-fade-in' : 'rounded-2xl animate-fade-in', widths[size])}>
        {title !== undefined && (
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-slate-100 text-slate-500" aria-label="Close"><X size={20} /></button>
          </div>
        )}
        <div className="px-5 py-4 overflow-y-auto overflow-x-hidden flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl flex gap-2 justify-end pb-[max(.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Confirm({ open, onClose, onConfirm, title, message, confirmText = 'Confirm', danger, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message?: ReactNode; confirmText?: string; danger?: boolean; loading?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmText}</Button></>}>
      <div className="text-sm text-slate-600">{message}</div>
    </Modal>
  )
}

/* ------------------------------------------------------------ Misc */
export function EmptyState({ icon, title, message, action }: { icon: ReactNode; title: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 animate-fade-in">
      <div className="text-slate-300 mb-3 [&>svg]:w-16 [&>svg]:h-16">{icon}</div>
      <div className="text-slate-700 font-medium">{title}</div>
      {message && <div className="text-sm text-slate-500 mt-1 max-w-xs">{message}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-sm"><Loader2 className="animate-spin" size={20} />{label}</div>
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-4">
      <div>
        {subtitle && <div className="text-sm text-slate-500">{subtitle}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  )
}

export function Toaster() {
  const { toasts, dismiss } = useUI()
  const icons = { success: <CheckCircle2 className="text-emerald-500" size={20} />, error: <AlertCircle className="text-red-500" size={20} />, info: <Info className="text-sky-500" size={20} />, warning: <AlertTriangle className="text-amber-500" size={20} /> }
  return (
    <div className="fixed top-3 inset-x-3 sm:inset-x-auto sm:right-4 sm:w-96 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto bg-white rounded-xl shadow-pop border border-slate-100 px-4 py-3 flex items-start gap-3 animate-fade-in">
          {icons[t.kind]}
          <div className="flex-1 min-w-0"><div className="text-sm font-semibold text-slate-900">{t.title}</div>{t.message && <div className="text-xs text-slate-600 mt-0.5 break-words">{t.message}</div>}</div>
          <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
      ))}
    </div>
  )
}

export function MoneyInput({ value, onChange, autoFocus, placeholder = '0.00', className, big }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string; className?: string; big?: boolean }) {
  return (
    <div className="relative">
      <span className={cls('absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium', big && 'text-xl')}>₱</span>
      <input inputMode="decimal" autoFocus={autoFocus} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        className={cls(inputCls, 'pl-8 font-semibold tabular-nums', big && 'h-14 text-2xl pl-9', className)} />
    </div>
  )
}
