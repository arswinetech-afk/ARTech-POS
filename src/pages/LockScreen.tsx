import { useNavigate } from 'react-router-dom'
import { Lock, Crown, LogOut, ArrowRight } from 'lucide-react'
import { useAppStore, usePermission } from '../store/app'
import { Button } from '../components/ui'
import { fmtDate } from '../lib/format'

export default function LockScreen() {
  const { access, store, signOut, role } = useAppStore()
  const navigate = useNavigate()
  const canBilling = usePermission('billing')
  const staff = !canBilling && role !== 'owner'
  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-gradient-to-b from-[#f4f7f5] to-brand-50">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-pop p-8 text-center animate-fade-in">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center"><Lock size={30} /></div>
        <h1 className="text-2xl font-bold mt-4">{access.state === 'suspended' ? 'Account suspended' : staff ? 'Store subscription ended' : 'Your free trial has ended'}</h1>
        <p className="text-slate-600 text-sm mt-2">
          {access.state === 'suspended' ? 'Please contact support to restore access to your store.'
            : staff ? <>The subscription of <b>{store?.name}</b>{access.endsAt ? ` ended on ${fmtDate(access.endsAt.toISOString())}` : ' has ended'}. Please ask the store owner{store?.owner_name ? ` (${store.owner_name})` : ''} to renew — your access comes back automatically. Nothing is lost.</>
            : <>Thanks for trying ARTech POS with <b>{store?.name}</b>{access.endsAt ? ` — your access ended on ${fmtDate(access.endsAt.toISOString())}` : ''}. Choose a plan to continue selling. All your products, sales and credits are safely kept.</>}
        </p>
        <div className="mt-6 space-y-2">
          {access.state !== 'suspended' && !staff && <Button block size="lg" icon={<Crown size={18} />} onClick={() => navigate('/subscription')}>Select a subscription <ArrowRight size={16} /></Button>}
          {staff && <Button block variant="outline" onClick={() => navigate('/settings')}>Open settings</Button>}
          <Button block variant="ghost" icon={<LogOut size={16} />} onClick={() => signOut()}>Sign out</Button>
        </div>
        <p className="text-[11px] text-slate-400 mt-6">Plans start at ₱149/month · Pay via GCash · Activated by the administrator after verification</p>
      </div>
    </div>
  )
}
