import type { Store } from './types'

export type AccessState = 'admin' | 'active' | 'trial' | 'expired' | 'suspended'

export interface Access {
  state: AccessState
  locked: boolean
  endsAt: Date | null
  daysLeft: number
  label: string
}

export function getAccess(store: Store | null, isAdmin: boolean, now = Date.now()): Access {
  if (isAdmin) return { state: 'admin', locked: false, endsAt: null, daysLeft: Infinity, label: 'System Administrator' }
  if (!store) return { state: 'expired', locked: true, endsAt: null, daysLeft: 0, label: 'No store' }
  if (store.subscription_status === 'suspended') {
    return { state: 'suspended', locked: true, endsAt: null, daysLeft: 0, label: 'Account suspended' }
  }
  const subEnd = store.subscription_ends_at ? Date.parse(store.subscription_ends_at) : 0
  if (store.subscription_status === 'active' && subEnd > now) {
    const days = Math.ceil((subEnd - now) / 864e5)
    return { state: 'active', locked: false, endsAt: new Date(subEnd), daysLeft: days, label: `Active · ${days} day${days === 1 ? '' : 's'} left` }
  }
  const trialEnd = Date.parse(store.trial_ends_at)
  if (trialEnd > now) {
    const days = Math.ceil((trialEnd - now) / 864e5)
    return { state: 'trial', locked: false, endsAt: new Date(trialEnd), daysLeft: days, label: `Free trial · ${days} day${days === 1 ? '' : 's'} left` }
  }
  return { state: 'expired', locked: true, endsAt: new Date(Math.max(trialEnd, subEnd)), daysLeft: 0, label: 'Subscription required' }
}
