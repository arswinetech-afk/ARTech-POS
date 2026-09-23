import { create } from 'zustand'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

interface SyncState {
  status: SyncStatus
  lastSyncAt: string | null
  pending: number
  failed: number
  error: string | null
  progress: string | null
  /** true when the cloud database lacks a table this app version syncs (migration not run yet) */
  schemaOutdated: boolean
  set: (p: Partial<SyncState>) => void
}

export const useSyncStore = create<SyncState>((set) => ({
  status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'idle',
  lastSyncAt: null,
  pending: 0,
  failed: 0,
  error: null,
  progress: null,
  schemaOutdated: false,
  set: (p) => set(p),
}))
