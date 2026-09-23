import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase, SYSTEM_ADMIN_EMAIL, isOnline, isNetworkError, errorMessage } from '../lib/supabase'
import { db, getMeta, setMeta, clearLocalData } from '../lib/db'
import type { MemberLite, Membership, Plan, Profile, Role, Store } from '../lib/types'
import { getAccess, type Access } from '../lib/subscription'
import { can, type Permission } from '../lib/permissions'
import { startSync, stopSync } from '../lib/sync'
import { useCart } from './cart'

interface Bootstrap {
  profile: Profile | null
  store: Store | null
  role?: Role | null
  stores?: Membership[]
  members?: MemberLite[]
  plans: Plan[]
  server_time?: string
}

export interface JoinResult { ok: boolean; reason?: 'INVALID' | 'EXPIRED' | 'REVOKED' | 'USED_UP'; store_id?: string; store_name?: string; role?: Role; already_member?: boolean }

interface AppState {
  ready: boolean
  session: Session | null
  profile: Profile | null
  store: Store | null
  /** Caller's role in the ACTIVE store */
  role: Role | null
  /** Every store the user belongs to (store switcher) */
  stores: Membership[]
  /** Members of the active store (resolves created_by → name, offline) */
  members: MemberLite[]
  plans: Plan[]
  isAdmin: boolean
  access: Access
  bootError: string | null
  /** true once we know the account has NO store at all (removed staff / invite failed) */
  noStore: boolean
  init: () => Promise<void>
  refreshBootstrap: (silent?: boolean) => Promise<void>
  updateStore: (patch: Partial<Store>) => Promise<void>
  switchStore: (storeId: string) => Promise<void>
  joinStore: (code: string) => Promise<JoinResult>
  createOwnStore: (name?: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (p: { email: string; password: string; full_name: string; store_name: string; phone?: string; invite_code?: string | null }) => Promise<{ needsConfirm: boolean }>
  signOut: () => Promise<void>
  tick: () => void
}

let bootInflight: Promise<void> | null = null
let bootFetchedAt = 0
const BOOT_MIN_GAP_MS = 60_000
let initialized = false
let clock: number | null = null

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  session: null,
  profile: null,
  store: null,
  role: null,
  stores: [],
  members: [],
  plans: [],
  isAdmin: false,
  access: getAccess(null, false),
  bootError: null,
  noStore: false,

  init: async () => {
    if (initialized) return
    initialized = true
    const { data } = await supabase.auth.getSession()
    set({ session: data.session })
    supabase.auth.onAuthStateChange((_evt, session) => {
      const prev = get().session
      set({ session })
      if (session && !prev) void get().refreshBootstrap()
      if (!session && prev) { stopSync(); set({ profile: null, store: null, role: null, stores: [], members: [], isAdmin: false, noStore: false, access: getAccess(null, false) }) }
    })
    if (data.session) await get().refreshBootstrap()
    set({ ready: true })
    if (!clock) clock = window.setInterval(() => get().tick(), 60_000)
  },

  /** Load profile + active store + memberships + plans. Uses the local cache when offline. */
  refreshBootstrap: async (silent = false) => {
    const session = get().session
    if (!session) return
    if (bootInflight) return bootInflight // de-duplicate concurrent callers
    if (silent && Date.now() - bootFetchedAt < BOOT_MIN_GAP_MS) return
    bootInflight = (async () => {
    const cached = await getMeta<Bootstrap | null>('bootstrap', null)
    const apply = (b: Bootstrap) => {
      const isAdmin = !!b.profile?.is_admin || (b.profile?.email || session.user.email || '').toLowerCase() === SYSTEM_ADMIN_EMAIL
      const prevStoreId = get().store?.id
      if (prevStoreId && b.store && prevStoreId !== b.store.id) useCart.getState().clear()
      set({
        profile: b.profile, store: b.store, role: b.role ?? (b.store ? 'owner' : null), stores: b.stores || (b.store ? [{ id: b.store.id, name: b.store.name, role: 'owner', owner_name: b.store.owner_name, joined_at: b.store.created_at }] : []),
        members: b.members || [], plans: b.plans || [], isAdmin, access: getAccess(b.store, isAdmin), bootError: null, noStore: !b.store,
      })
      if (b.store) startSync(b.store.id)
    }
    if (cached && cached.profile?.id === session.user.id && !silent) apply(cached)
    if (!isOnline()) { if (!cached) set({ bootError: 'You are offline and no local data was found. Connect once to set up this device.' }); return }
    try {
      const { data, error } = await supabase.rpc('my_bootstrap')
      if (error) throw error
      const b = data as Bootstrap
      await setMeta('bootstrap', b)
      bootFetchedAt = Date.now()
      apply(b)
    } catch (e) {
      if (isNetworkError(e)) { if (cached) apply(cached); return }
      set({ bootError: errorMessage(e) })
    }
    })().finally(() => { bootInflight = null })
    return bootInflight
  },

  updateStore: async (patch) => {
    const store = get().store
    if (!store) return
    const next = { ...store, ...patch, updated_at: new Date().toISOString() }
    set({ store: next, access: getAccess(next, get().isAdmin) })
    const cached = await getMeta<Bootstrap | null>('bootstrap', null)
    if (cached) await setMeta('bootstrap', { ...cached, store: next })
    // settings are small: write straight through when online, otherwise queue
    const payload: Record<string, unknown> = { id: store.id }
    for (const k of Object.keys(patch) as Array<keyof Store>) payload[k] = next[k]
    if (isOnline()) {
      const { error } = await supabase.from('stores').update(payload).eq('id', store.id)
      if (error) throw error
    } else {
      await setMeta('pendingStorePatch', { ...(await getMeta('pendingStorePatch', {})), ...payload })
    }
  },

  /** Switch the active store (staff who belong to several stores). Needs a connection. */
  switchStore: async (storeId) => {
    if (get().store?.id === storeId) return
    if (!isOnline()) throw new Error('Connect to the internet to switch stores.')
    const pending = await db.outbox.count()
    if (pending) throw new Error(`${pending} change(s) are still syncing. Please wait a moment and try again.`)
    const { error } = await supabase.rpc('set_active_store', { p_store: storeId })
    if (error) throw error
    bootFetchedAt = 0
    await get().refreshBootstrap()
  },

  /** Redeem an invitation code for the signed-in account. */
  joinStore: async (code) => {
    const { data, error } = await supabase.rpc('redeem_invite', { p_code: code })
    if (error) throw error
    const res = data as JoinResult
    if (res.ok) { bootFetchedAt = 0; await get().refreshBootstrap() }
    return res
  },

  /** Account without any store (invite failed / removed from a store): create a personal one. */
  createOwnStore: async (name) => {
    const meta = get().session?.user.user_metadata || {}
    const { error } = await supabase.rpc('ensure_my_store', { p_name: name || meta.store_name || null })
    if (error) throw error
    bootFetchedAt = 0
    await get().refreshBootstrap()
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw error
    await get().refreshBootstrap()
  },

  signUp: async ({ email, password, full_name, store_name, phone, invite_code }) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name, store_name, phone, invite_code: invite_code || null } },
    })
    if (error) throw error
    if (data.session) { await get().refreshBootstrap(); return { needsConfirm: false } }
    return { needsConfirm: true }
  },

  signOut: async () => {
    stopSync()
    const pending = await db.outbox.count()
    if (pending && !confirm(`${pending} change(s) are not yet synced and will be lost. Sign out anyway?`)) return
    await supabase.auth.signOut().catch(() => undefined)
    await clearLocalData()
    set({ session: null, profile: null, store: null, role: null, stores: [], members: [], isAdmin: false, noStore: false, access: getAccess(null, false) })
  },

  tick: () => {
    const { store, isAdmin } = get()
    set({ access: getAccess(store, isAdmin) })
  },
}))

/** React hook: may the current user do X in the active store? */
export function usePermission(perm: Permission): boolean {
  return useAppStore((s) => can(s.role, perm, s.isAdmin))
}

/** Non-hook variant for repo / helpers. */
export function hasPermission(perm: Permission): boolean {
  const s = useAppStore.getState()
  return can(s.role, perm, s.isAdmin)
}

/** Resolve a user id to a display name using the cached member list. */
export function memberName(userId: string | null | undefined, fallback = '—'): string {
  if (!userId) return fallback
  const s = useAppStore.getState()
  const m = s.members.find((x) => x.user_id === userId)
  if (m) return m.name
  if (s.profile?.id === userId) return s.profile.full_name || s.profile.email.split('@')[0]
  return fallback
}
