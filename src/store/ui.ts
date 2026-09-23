import { create } from 'zustand'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'
export interface Toast { id: number; kind: ToastKind; title: string; message?: string }

interface UIState {
  toasts: Toast[]
  toast: (kind: ToastKind, title: string, message?: string) => void
  dismiss: (id: number) => void
  /** Desktop sidebar preference for regular pages (persisted). */
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  /** POS "focus mode": the sidebar shrinks to an icon rail while selling (persisted, default on). */
  posFocus: boolean
  setPosFocus: (v: boolean) => void
}

const readPref = (key: string, fallback: boolean) => {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1' } catch { return fallback }
}
const writePref = (key: string, v: boolean) => { try { localStorage.setItem(key, v ? '1' : '0') } catch { /* private mode */ } }

let seq = 1
export const useUI = create<UIState>((set, get) => ({
  toasts: [],
  toast: (kind, title, message) => {
    const id = seq++
    set({ toasts: [...get().toasts, { id, kind, title, message }] })
    window.setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3200)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  sidebarCollapsed: readPref('artech-pos-sidebar-collapsed', false),
  setSidebarCollapsed: (v) => { writePref('artech-pos-sidebar-collapsed', v); set({ sidebarCollapsed: v }) },
  posFocus: readPref('artech-pos-pos-focus', true),
  setPosFocus: (v) => { writePref('artech-pos-pos-focus', v); set({ posFocus: v }) },
}))

export const toast = {
  success: (t: string, m?: string) => useUI.getState().toast('success', t, m),
  error: (t: string, m?: string) => useUI.getState().toast('error', t, m),
  info: (t: string, m?: string) => useUI.getState().toast('info', t, m),
  warning: (t: string, m?: string) => useUI.getState().toast('warning', t, m),
}
