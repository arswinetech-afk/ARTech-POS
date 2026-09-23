import { createClient } from '@supabase/supabase-js'

// Env vars win; the project's public URL / publishable key are safe defaults so a
// Pages deploy without env vars still works (all protection is RLS on the server).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ytesxqryqqecgubsipbo.supabase.co'
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_muxvHlqJFvVQj8BggyEGYA_1aTCiItE'
export const SYSTEM_ADMIN_EMAIL = (import.meta.env.VITE_SYSTEM_ADMIN_EMAIL || 'andy.b.rempillo@gmail.com').toLowerCase()
export const GCASH_NUMBER = import.meta.env.VITE_GCASH_NUMBER || '09302392076'
export const GCASH_NAME = (import.meta.env.VITE_GCASH_NAME || '').trim() // registered GCash account name (optional)

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder', {
  auth: {
    persistSession: true,          // session survives reloads → app opens offline
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'artech-pos-auth',
  },
  global: { headers: { 'x-client-info': 'artech-pos/2.0' } },
  // Realtime is intentionally NOT used: pull-based delta sync keeps egress tiny.
})

/** True when the browser believes it has a network connection. */
export const isOnline = () => typeof navigator === 'undefined' ? true : navigator.onLine

export function errorMessage(e: unknown): string {
  if (!e) return 'Unknown error'
  if (typeof e === 'string') return e
  const anyE = e as { message?: string; error_description?: string; hint?: string; details?: string }
  const msg = anyE.message || anyE.error_description || String(e)
  if (msg.includes('SUBSCRIPTION_REQUIRED')) return 'Your free trial or subscription has ended. Please choose a plan to continue.'
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) return 'No internet connection.'
  return msg
}

export const isNetworkError = (e: unknown) => {
  const m = (e as { message?: string })?.message || ''
  return /Failed to fetch|NetworkError|Load failed|fetch failed|network|timeout|ECONN/i.test(m)
}
