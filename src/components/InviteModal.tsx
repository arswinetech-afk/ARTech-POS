import { useEffect, useState } from 'react'
import { Copy, Link2, Share2, Check, Ticket, Sparkles } from 'lucide-react'
import { Button, Field, Input, Modal, Segmented } from './ui'
import { ROLE_INFO, formatInviteCode, inviteLink } from '../lib/permissions'
import { createInvite } from '../lib/invites'
import { errorMessage } from '../lib/supabase'
import { toast } from '../store/ui'
import { cls, fmtDateTime } from '../lib/format'
import type { Role, StoreInvite } from '../lib/types'

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { return document.execCommand('copy') } catch { return false } finally { ta.remove() }
  }
}

const EXPIRY: Array<{ value: '24' | '168' | '720'; label: string }> = [{ value: '24', label: '24 hours' }, { value: '168', label: '7 days' }, { value: '720', label: '30 days' }]
const USES: Array<{ value: '1' | '5' | '0'; label: string }> = [{ value: '1', label: 'Once' }, { value: '5', label: '5 times' }, { value: '0', label: 'Unlimited' }]

export default function InviteModal({ open, onClose, storeId, storeName, roles, onCreated }: {
  open: boolean; onClose: () => void; storeId: string; storeName: string; roles: Role[]; onCreated?: (inv: StoreInvite) => void
}) {
  const [role, setRole] = useState<Role>(roles.includes('cashier') ? 'cashier' : roles[0])
  const [expiry, setExpiry] = useState<'24' | '168' | '720'>('168')
  const [uses, setUses] = useState<'1' | '5' | '0'>('1')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [invite, setInvite] = useState<StoreInvite | null>(null)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  useEffect(() => { if (open) { setInvite(null); setCopied(null); setLabel('') } }, [open])

  const generate = async () => {
    setBusy(true)
    try {
      const inv = await createInvite(storeId, role, parseInt(expiry), parseInt(uses), label)
      setInvite(inv); onCreated?.(inv)
    } catch (e) { toast.error('Could not create the code', errorMessage(e)) } finally { setBusy(false) }
  }

  const code = invite ? formatInviteCode(invite.code) : ''
  const link = invite ? inviteLink(invite.code) : ''
  const roleInfo = ROLE_INFO.find((r) => r.value === (invite?.role || role))!
  const shareText = invite ? `You're invited to join ${storeName} on ARTech POS as ${roleInfo.label}.\n\nInvitation code: ${code}\nOpen ${link}\n\nCreate your account (or sign in) and enter the code. Code expires ${fmtDateTime(invite.expires_at)}.` : ''

  const copy = async (what: 'code' | 'link') => {
    const ok = await copyText(what === 'code' ? code : link)
    if (ok) { setCopied(what); toast.success(what === 'code' ? 'Code copied' : 'Link copied'); setTimeout(() => setCopied(null), 1800) }
    else toast.error('Copy failed', 'Long-press the code to copy it manually.')
  }
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: `Join ${storeName} on ARTech POS`, text: shareText }) } catch { /* cancelled */ } }
    else { await copyText(shareText); toast.success('Invitation copied', 'Paste it in Messenger, Viber or SMS.') }
  }

  return (
    <Modal open={open} onClose={onClose} title={invite ? 'Invitation code ready' : 'Invite staff'} size="md">
      {!invite ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Generate a code for <b>{storeName}</b>. Whoever enters it joins this store with the role you pick — all items, credits and sales history sync to their device.</p>

          <div>
            <div className="text-sm font-medium mb-1.5">Role</div>
            <div className="grid gap-2">
              {ROLE_INFO.filter((r) => roles.includes(r.value)).map((r) => (
                <button key={r.value} type="button" onClick={() => setRole(r.value)}
                  className={cls('text-left rounded-xl border px-3 py-2.5 transition', role === r.value ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300 bg-white')}>
                  <div className="flex items-center gap-2">
                    <span className={cls('w-4 h-4 rounded-full border flex items-center justify-center', role === r.value ? 'border-brand-600 bg-brand-600' : 'border-slate-300')}>{role === r.value && <Check size={11} className="text-white" />}</span>
                    <span className="text-sm font-semibold">{r.label}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 ml-6">{r.blurb}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div><div className="text-sm font-medium mb-1.5">Code expires in</div><Segmented value={expiry} onChange={setExpiry} options={EXPIRY} size="sm" className="w-full [&>button]:flex-1" /></div>
            <div><div className="text-sm font-medium mb-1.5">Can be used</div><Segmented value={uses} onChange={setUses} options={USES} size="sm" className="w-full [&>button]:flex-1" /></div>
          </div>

          <Field label="Note (optional)" hint="Only you see this — e.g. who the code is for."><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Jen – morning shift" maxLength={60} /></Field>

          <Button block size="lg" icon={<Ticket size={18} />} onClick={generate} loading={busy}>Generate code</Button>
        </div>
      ) : (
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-emerald-500 text-white p-5 text-center shadow-pop">
            <div className="text-[11px] uppercase tracking-widest text-white/75 inline-flex items-center gap-1"><Sparkles size={12} /> Invitation code</div>
            <div className="font-mono text-4xl sm:text-[44px] font-black tracking-[.18em] mt-2 select-all" data-testid="invite-code">{code}</div>
            <div className="text-xs text-white/80 mt-2">{storeName} · <b>{roleInfo.label}</b> · expires {fmtDateTime(invite.expires_at)} · {invite.max_uses === 0 ? 'unlimited uses' : invite.max_uses === 1 ? 'single use' : `${invite.max_uses} uses`}</div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={() => copy('code')} icon={copied === 'code' ? <Check size={16} /> : <Copy size={16} />}>{copied === 'code' ? 'Copied' : 'Copy code'}</Button>
            <Button variant="outline" onClick={() => copy('link')} icon={copied === 'link' ? <Check size={16} /> : <Link2 size={16} />}>{copied === 'link' ? 'Copied' : 'Copy link'}</Button>
            <Button onClick={share} icon={<Share2 size={16} />}>Share</Button>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">
            <div className="font-semibold mb-1.5">How your staff joins</div>
            <ol className="list-decimal pl-4 space-y-1 text-[13px]">
              <li>Open <span className="font-mono text-xs bg-white border border-slate-200 rounded px-1">{link.replace(/^https?:\/\//, '')}</span> (or the shared link) on their phone.</li>
              <li>Tap <b>Create account</b> and enter the code — or, if they already have an account, sign in and tap <b>Join</b>.</li>
              <li>Done. The store's items, credits and history download to their device and every sale they make shows their name.</li>
            </ol>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setInvite(null)}>Create another</Button>
            <Button block onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
