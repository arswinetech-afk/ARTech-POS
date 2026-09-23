import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, UserPlus, Ticket, Copy, Ban, MoreHorizontal, LogOut, RefreshCw, KeyRound, Crown } from 'lucide-react'
import { useAppStore } from '../store/app'
import { Badge, Button, Card, CardHeader, Confirm, Modal, Select } from './ui'
import InviteModal, { copyText } from './InviteModal'
import { can, invitableRoles, ROLE_INFO, ROLE_LABEL, ROLE_TONE, formatInviteCode } from '../lib/permissions'
import { listInvites, listMembers, revokeInvite, removeMember, setMemberRole, inviteStatus } from '../lib/invites'
import { errorMessage, isOnline } from '../lib/supabase'
import { toast } from '../store/ui'
import { cls, fmtDate, fmtDateTime, timeAgo } from '../lib/format'
import type { Role, StaffMember, StoreInvite } from '../lib/types'

export default function StaffCard() {
  const { store, profile, role, isAdmin, members: cachedMembers, stores, refreshBootstrap } = useAppStore()
  const navigate = useNavigate()
  const [members, setMembers] = useState<StaffMember[] | null>(null)
  const [invites, setInvites] = useState<StoreInvite[]>([])
  const [loading, setLoading] = useState(false)
  const [invite, setInvite] = useState(false)
  const [manage, setManage] = useState<StaffMember | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void>; danger?: boolean; text?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const canStaff = can(role, 'manage_staff', isAdmin)
  const canOwners = can(role, 'manage_owners', isAdmin)
  const roles = invitableRoles(role, isAdmin)

  const load = useCallback(async () => {
    if (!store || !isOnline()) return
    setLoading(true)
    try {
      const [m, i] = await Promise.all([listMembers(store.id), canStaff ? listInvites(store.id) : Promise.resolve([])])
      setMembers(m); setInvites(i)
    } catch (e) { toast.error('Staff', errorMessage(e)) } finally { setLoading(false) }
  }, [store?.id, canStaff]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load() }, [load])

  if (!store) return null
  const list: StaffMember[] = members || cachedMembers.map((m) => ({ ...m, email: m.user_id === profile?.id ? profile?.email || '' : '', created_at: '', invited_by: null, invited_by_name: null, sales_count: 0, last_sale_at: null }))
  const owners = list.filter((m) => m.role === 'owner').length
  const activeInvites = invites.filter((i) => inviteStatus(i) === 'active')

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try { await fn(); toast.success(done); setConfirm(null); setManage(null); await load(); void refreshBootstrap() } catch (e) { toast.error('Failed', errorMessage(e)) } finally { setBusy(false) }
  }

  const changeRole = (m: StaffMember, r: Role) => {
    if (r === m.role) return
    setConfirm({ title: `Make ${m.name} ${r === 'owner' ? 'an owner' : `a ${ROLE_LABEL[r].toLowerCase()}`}?`, text: 'Change role',
      message: ROLE_INFO.find((x) => x.value === r)?.blurb || '', action: () => run(() => setMemberRole(store.id, m.user_id, r), 'Role updated') })
  }
  const remove = (m: StaffMember) => setConfirm({ title: `Remove ${m.name} from ${store.name}?`, danger: true, text: 'Remove',
    message: 'They will lose access immediately. Sales they recorded stay in your history with their name.', action: () => run(() => removeMember(store.id, m.user_id), 'Member removed') })
  const leave = () => setConfirm({ title: `Leave ${store.name}?`, danger: true, text: 'Leave store',
    message: stores.length > 1 ? 'You can be invited again later with a new code.' : 'This is your only store. After leaving you can join another store with a code or create your own.',
    action: () => run(() => removeMember(store.id, profile!.id), 'You left the store') })

  const canManage = (m: StaffMember) => {
    if (m.user_id === profile?.id) return false
    if (isAdmin || role === 'owner') return true
    return role === 'manager' && (m.role === 'cashier' || m.role === 'viewer')
  }

  return (
    <Card>
      <CardHeader title="Store Staff" icon={<Users size={18} />} subtitle={`${list.length} ${list.length === 1 ? 'person' : 'people'} · every sale and log shows who made it`}
        action={canStaff ? <Button size="sm" icon={<UserPlus size={16} />} onClick={() => setInvite(true)}>Invite</Button> : <button onClick={() => void load()} className="text-slate-400 hover:text-slate-700 p-1" aria-label="Refresh"><RefreshCw size={16} className={cls(loading && 'animate-spin')} /></button>} />

      <ul className="px-4 divide-y divide-slate-100">
        {list.map((m) => {
          const me = m.user_id === profile?.id
          return (
            <li key={m.user_id} className="py-3 flex items-center gap-3">
              <div className={cls('w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0', m.role === 'owner' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700')}>{(m.name || '?').slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">{m.name}{me && <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 rounded px-1">you</span>}{m.role === 'owner' && <Crown size={12} className="text-amber-500" />}</div>
                <div className="text-xs text-slate-500 truncate">{m.email || (m.created_at ? '' : 'offline — details sync later')}</div>
                {members && <div className="text-[11px] text-slate-400 truncate">{m.created_at && <>Joined {fmtDate(m.created_at)}</>}{m.invited_by_name && <> · invited by {m.invited_by_name}</>}{m.sales_count > 0 && <> · {m.sales_count} sale{m.sales_count === 1 ? '' : 's'}{m.last_sale_at && <>, last {timeAgo(m.last_sale_at)}</>}</>}</div>}
              </div>
              <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
              {canManage(m) && <button onClick={() => setManage(m)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Manage ${m.name}`}><MoreHorizontal size={18} /></button>}
            </li>
          )
        })}
      </ul>

      {canStaff && (
        <div className="px-4 pb-1">
          <div className="flex items-center justify-between mt-1 mb-2">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide inline-flex items-center gap-1.5"><Ticket size={13} /> Active invitation codes</div>
            {loading && <RefreshCw size={12} className="animate-spin text-slate-400" />}
          </div>
          {activeInvites.length === 0 ? (
            <div className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3">No active codes. Tap <b>Invite</b> to create one — the code is bound to this store and the role you choose, and it expires automatically.</div>
          ) : (
            <ul className="space-y-2">
              {activeInvites.map((i) => (
                <li key={i.id} className="rounded-xl border border-slate-200 p-2.5 flex items-center gap-3">
                  <div className="font-mono font-bold tracking-widest text-sm bg-slate-900 text-white rounded-lg px-2 py-1.5 select-all">{formatInviteCode(i.code)}</div>
                  <div className="min-w-0 flex-1 text-xs text-slate-600">
                    <div className="flex items-center gap-1.5"><Badge tone={ROLE_TONE[i.role]}>{ROLE_LABEL[i.role]}</Badge>{i.label && <span className="truncate text-slate-500">{i.label}</span>}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{i.max_uses === 0 ? `${i.uses} joined · unlimited` : `${i.uses}/${i.max_uses} used`} · expires {fmtDateTime(i.expires_at)}</div>
                  </div>
                  <button onClick={() => copyText(formatInviteCode(i.code)).then(() => toast.success('Code copied'))} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Copy code"><Copy size={16} /></button>
                  <button onClick={() => setConfirm({ title: 'Cancel this code?', danger: true, text: 'Cancel code', message: `${formatInviteCode(i.code)} will stop working immediately. People who already joined keep their access.`, action: () => run(() => revokeInvite(i.id), 'Code cancelled') })} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" aria-label="Cancel code"><Ban size={16} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="px-4 py-3 mt-2 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <button onClick={() => navigate('/join')} className="text-brand-700 font-medium inline-flex items-center gap-1 hover:underline"><KeyRound size={13} /> Have a code? Join another store</button>
        {profile && (role !== 'owner' || owners > 1) && <button onClick={leave} className="text-slate-500 inline-flex items-center gap-1 hover:text-red-600"><LogOut size={13} /> Leave this store</button>}
      </div>

      <InviteModal open={invite} onClose={() => { setInvite(false); void load() }} storeId={store.id} storeName={store.name} roles={roles} />

      <Modal open={!!manage} onClose={() => setManage(null)} title={manage?.name} size="sm">
        {manage && (
          <div className="space-y-4">
            <div className="text-sm text-slate-600">{manage.email}</div>
            {canOwners ? (
              <div>
                <div className="text-sm font-medium mb-1">Role in {store.name}</div>
                <Select value={manage.role} onChange={(e) => changeRole(manage, e.target.value as Role)}>
                  {ROLE_INFO.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Select>
                <div className="text-xs text-slate-500 mt-1">{ROLE_INFO.find((r) => r.value === manage.role)?.blurb}</div>
              </div>
            ) : <div className="text-sm"><Badge tone={ROLE_TONE[manage.role]}>{ROLE_LABEL[manage.role]}</Badge></div>}
            <Button block variant="outline" className="text-red-600 border-red-200" icon={<Ban size={16} />} onClick={() => remove(manage)}>Remove from store</Button>
          </div>
        )}
      </Modal>

      <Confirm open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title || ''} message={confirm?.message} confirmText={confirm?.text} danger={confirm?.danger} loading={busy} onConfirm={() => confirm?.action()} />
    </Card>
  )
}
