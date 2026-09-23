import { supabase } from './supabase'
import type { Role, StaffMember, StoreInvite } from './types'
import { normalizeInviteCode } from './permissions'

/* Thin wrappers around the staff / invitation RPCs (see supabase/schema.sql). */

export interface InvitePreview { valid: boolean; reason?: 'INVALID' | 'EXPIRED' | 'REVOKED' | 'USED_UP' | null; store_id?: string; store_name?: string; role?: Role; expires_at?: string }

export async function previewInvite(code: string): Promise<InvitePreview> {
  const { data, error } = await supabase.rpc('invite_preview', { p_code: normalizeInviteCode(code) })
  if (error) throw error
  return data as InvitePreview
}

export async function createInvite(storeId: string, role: Role, expiresHours: number, maxUses: number, label?: string | null): Promise<StoreInvite> {
  const { data, error } = await supabase.rpc('create_invite', { p_store: storeId, p_role: role, p_expires_hours: expiresHours, p_max_uses: maxUses, p_label: label || null })
  if (error) throw error
  return data as StoreInvite
}

export async function listInvites(storeId: string): Promise<StoreInvite[]> {
  const { data, error } = await supabase.from('store_invites').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(50)
  if (error) throw error
  return (data || []) as StoreInvite[]
}

export async function revokeInvite(id: string) {
  const { error } = await supabase.rpc('revoke_invite', { p_id: id })
  if (error) throw error
}

export async function listMembers(storeId: string): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc('list_store_members', { p_store: storeId })
  if (error) throw error
  return ((data || []) as Array<StaffMember & { full_name?: string }>).map((m) => ({ ...m, name: m.name || m.full_name || m.email }))
}

export async function setMemberRole(storeId: string, userId: string, role: Role) {
  const { error } = await supabase.rpc('set_member_role', { p_store: storeId, p_user: userId, p_role: role })
  if (error) throw error
}

export async function removeMember(storeId: string, userId: string) {
  const { error } = await supabase.rpc('remove_member', { p_store: storeId, p_user: userId })
  if (error) throw error
}

export type InviteStatus = 'active' | 'expired' | 'used' | 'revoked'
export function inviteStatus(i: StoreInvite, now = Date.now()): InviteStatus {
  if (i.revoked_at) return 'revoked'
  if (new Date(i.expires_at).getTime() < now) return 'expired'
  if (i.max_uses > 0 && i.uses >= i.max_uses) return 'used'
  return 'active'
}

export function reasonText(reason?: string | null) {
  switch (reason) {
    case 'EXPIRED': return 'This invitation code has expired. Ask the store owner for a new one.'
    case 'REVOKED': return 'This invitation code was cancelled by the store.'
    case 'USED_UP': return 'This invitation code has already been used.'
    default: return 'We could not find that invitation code. Check the letters and try again.'
  }
}
