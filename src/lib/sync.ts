import { db, getMeta, setMeta } from './db'
import { supabase, isOnline, isNetworkError, errorMessage } from './supabase'
import { SYNC_TABLES, type SyncTable, type OutboxItem } from './types'
import { useSyncStore } from '../store/sync'
import { useAppStore } from '../store/app'
import { toast } from '../store/ui'

/**
 * Offline-first sync engine.
 *
 *  PUSH  – replay the outbox (local writes) in order. Upserts are batched per
 *          table; business operations (sales, stock, payments) are RPCs that
 *          apply RELATIVE changes on the server, so multiple devices never
 *          overwrite each other's stock.
 *  PULL  – per table, fetch only rows whose (updated_at,id) is beyond the saved
 *          cursor (keyset pagination). Egress ≈ only what actually changed.
 *
 *  The sales table is pulled with a rolling window (default 180 days) on the
 *  first sync; older history stays in the cloud and is queried through
 *  server-side report RPCs only when needed.
 */

const PAGE = 500
export const SALES_WINDOW_DAYS = 180
/** Background pull cadence. Deltas are tiny, but every pull is one request per table,
 *  so we keep it modest and pull immediately only when something meaningful happens. */
const PULL_INTERVAL_MS = 5 * 60_000
const FOCUS_PULL_MIN_GAP_MS = 2 * 60_000
let lastPullAt = 0
const EPOCH_CURSOR = { u: '1970-01-01T00:00:00+00:00', id: '00000000-0000-0000-0000-000000000000' }

let running = false
let queued = false
let timer: number | null = null
let pushTimer: number | null = null
let activeStoreId: string | null = null

const cursorKey = (t: string, sid: string) => `cursor:${t}:${sid}`

async function pendingIds(table: string): Promise<Set<string>> {
  const rows = await db.outbox.where('table').equals(table).toArray()
  return new Set(rows.map((r) => r.id))
}

async function pullTable(table: SyncTable, storeId: string) {
  let cur = await getMeta(cursorKey(table, storeId), EPOCH_CURSOR)
  const initial = cur.u === EPOCH_CURSOR.u
  const windowStart = new Date(Date.now() - SALES_WINDOW_DAYS * 864e5).toISOString()
  const dexieTable = db.table(table)

  for (let guard = 0; guard < 400; guard++) {
    let q = supabase
      .from(table)
      .select('*')
      .eq('store_id', storeId)
      .or(`updated_at.gt.${cur.u},and(updated_at.eq.${cur.u},id.gt.${cur.id})`)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE)
    if (table === 'sales' && initial) q = q.gte('created_at', windowStart)

    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break

    const skip = await pendingIds(table)
    const upserts: Record<string, unknown>[] = []
    const deletes: string[] = []
    for (const row of data as Array<Record<string, unknown> & { id: string; deleted_at?: string | null }>) {
      if (skip.has(row.id)) continue
      if (row.deleted_at) deletes.push(row.id)
      else upserts.push(row)
    }
    await db.transaction('rw', dexieTable, async () => {
      if (upserts.length) await dexieTable.bulkPut(upserts)
      if (deletes.length) await dexieTable.bulkDelete(deletes)
    })
    const last = data[data.length - 1] as { updated_at: string; id: string }
    cur = { u: last.updated_at, id: last.id }
    await setMeta(cursorKey(table, storeId), cur)
    useSyncStore.getState().set({ progress: `${table} ${upserts.length + deletes.length} rows` })
    if (data.length < PAGE) break
  }
}

async function pushItem(item: OutboxItem) {
  if (item.kind === 'upsert' && item.table) {
    const { error } = await supabase.from(item.table).upsert(item.payload, { onConflict: 'id' })
    if (error) throw error
  } else if (item.kind === 'rpc' && item.rpc) {
    const { error } = await supabase.rpc(item.rpc, item.payload)
    if (error) throw error
  }
}

async function pushBatch(items: OutboxItem[]) {
  const table = items[0].table!
  const { error } = await supabase.from(table).upsert(items.map((i) => i.payload), { onConflict: 'id' })
  if (error) throw error
}

async function pushOutbox() {
  const items = await db.outbox.orderBy('seq').toArray()
  if (!items.length) return
  let i = 0
  while (i < items.length) {
    const it = items[i]
    // batch consecutive upserts to the same table (fewer requests)
    if (it.kind === 'upsert') {
      const batch: OutboxItem[] = [it]
      while (i + batch.length < items.length && batch.length < 200) {
        const nx = items[i + batch.length]
        if (nx.kind === 'upsert' && nx.table === it.table) batch.push(nx)
        else break
      }
      try {
        if (batch.length === 1) await pushItem(it)
        else await pushBatch(batch)
        await db.outbox.bulkDelete(batch.map((b) => b.seq!))
      } catch (e) {
        if (isNetworkError(e)) throw e
        // Permanent failure – record and keep for retry / manual review
        for (const b of batch) await db.outbox.update(b.seq!, { attempts: b.attempts + 1, error: errorMessage(e) })
        if (String((e as Error)?.message || '').includes('SUBSCRIPTION_REQUIRED')) throw e
      }
      i += batch.length
      continue
    }
    try {
      await pushItem(it)
      await db.outbox.delete(it.seq!)
    } catch (e) {
      if (isNetworkError(e)) throw e
      await db.outbox.update(it.seq!, { attempts: it.attempts + 1, error: errorMessage(e) })
      if (String((e as Error)?.message || '').includes('SUBSCRIPTION_REQUIRED')) throw e
    }
    i++
  }
}

async function refreshPending() {
  const count = await db.outbox.count()
  const failed = await db.outbox.filter((o) => !!o.error).count()
  useSyncStore.getState().set({ pending: count, failed })
}

export type SyncReason = 'startup' | 'interval' | 'online' | 'focus' | 'manual' | 'full' | 'retry' | 'auto' | 'queued'

/** Local writes ('auto'/'queued') only PUSH; everything else also PULLs deltas. */
function shouldPull(reason: SyncReason) {
  if (reason === 'auto' || reason === 'queued') return false
  if (reason === 'focus') return Date.now() - lastPullAt > FOCUS_PULL_MIN_GAP_MS
  return true
}

export async function syncNow(reason: SyncReason = 'manual'): Promise<void> {
  const storeId = activeStoreId
  if (!storeId) return
  const sync = useSyncStore.getState()
  if (!isOnline()) { sync.set({ status: 'offline' }); await refreshPending(); return }
  if (running) { queued = true; return }
  running = true
  const pull = shouldPull(reason)
  sync.set({ status: 'syncing', error: null, progress: reason })
  try {
    await pushOutbox()
    if (pull) {
      for (const t of SYNC_TABLES) {
        try { await pullTable(t, storeId) } catch (e) {
          // Tables added by a newer app version (e.g. sale_returns in 2.3) may not exist yet on a
          // database that never got the migration → keep the rest of the sync working and say so once.
          if (isMissingTable(e)) { warnMissingTable(t); continue }
          throw e
        }
      }
      lastPullAt = Date.now()
      await useAppStore.getState().refreshBootstrap(true) // picks up subscription changes (throttled inside)
      await setMeta('lastSyncAt', new Date().toISOString())
      sync.set({ status: 'idle', lastSyncAt: new Date().toISOString(), error: null, progress: null })
    } else {
      sync.set({ status: 'idle', error: null, progress: null })
    }
  } catch (e) {
    if (isNetworkError(e)) sync.set({ status: 'offline', progress: null })
    else sync.set({ status: 'error', error: errorMessage(e), progress: null })
  } finally {
    running = false
    await refreshPending()
    if (queued) { queued = false; void syncNow('queued') }
  }
}

const isMissingTable = (e: unknown) => {
  const x = e as { code?: string; status?: number; message?: string } | null
  return !!x && (x.code === 'PGRST205' || x.code === '42P01' || /relation .* does not exist|Could not find the table/i.test(x.message || ''))
}
const warnedTables = new Set<string>()
function warnMissingTable(table: string) {
  if (warnedTables.has(table)) return
  warnedTables.add(table)
  useSyncStore.getState().set({ schemaOutdated: true })
  toast.warning('Database update needed', `Your Supabase project is missing the "${table}" table. Run supabase/migrations/2026-09-20_returns.sql (or re-run schema.sql) — returns will not sync until then.`)
}

/** Debounced push right after a local write (feels instant, still batched). */
export function requestPush(delay = 1200) {
  void refreshPending()
  if (!isOnline() || !activeStoreId) return
  if (pushTimer) window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => { pushTimer = null; void syncNow('auto') }, delay)
}

export function startSync(storeId: string) {
  if (activeStoreId === storeId && timer) return
  stopSync()
  activeStoreId = storeId
  getMeta<string | null>('lastSyncAt', null).then((v) => useSyncStore.getState().set({ lastSyncAt: v }))
  void syncNow('startup')
  timer = window.setInterval(() => { if (document.visibilityState === 'visible') void syncNow('interval') }, PULL_INTERVAL_MS)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
}

export function stopSync() {
  if (timer) window.clearInterval(timer)
  timer = null
  activeStoreId = null
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  document.removeEventListener('visibilitychange', onVisible)
}

function onOnline() { useSyncStore.getState().set({ status: 'idle' }); void syncNow('online') }
function onOffline() { useSyncStore.getState().set({ status: 'offline' }) }
function onVisible() { if (document.visibilityState === 'visible') void syncNow('focus') }

/** Forget cursors so the next sync re-downloads everything (Settings → Data). */
export async function resetCursors(storeId: string) {
  for (const t of SYNC_TABLES) await db.meta.delete(cursorKey(t, storeId))
}

export async function retryFailed() {
  await db.outbox.filter((o) => !!o.error).modify({ error: null })
  await syncNow('retry')
}

export async function discardFailed() {
  await db.outbox.filter((o) => !!o.error).delete()
  await refreshPending()
}
