import type { Role } from './types'

/**
 * Client-side mirror of the role matrix enforced by RLS / RPCs in
 * supabase/schema.sql. The UI hides what a role cannot do; the server is the
 * real gatekeeper.
 *
 *   owner    everything (+ staff, billing)
 *   manager  everything except billing / owner management
 *   cashier  sell, customers, credits & payments, expenses, reminders
 *   viewer   read-only
 */
export type Permission =
  | 'sell'             // POS checkout
  | 'void_sale'
  | 'return_items'     // partial returns / refunds of individual items
  | 'manage_items'     // add / edit / delete products, adjust stock
  | 'see_cost'         // purchase prices, margins, profit
  | 'manage_customers'
  | 'record_payment'   // credit payments / manual charges
  | 'manage_expenses'
  | 'manage_reminders'
  | 'import_data'
  | 'store_settings'   // name, address, logo, receipt, thresholds
  | 'device_settings'  // printer / scanner preferences
  | 'manage_staff'     // invite / remove cashiers & viewers
  | 'manage_owners'    // change roles, invite owners/managers
  | 'billing'          // subscription & payments
  | 'view_reports'

const MATRIX: Record<Permission, Role[]> = {
  sell:             ['owner', 'manager', 'cashier'],
  void_sale:        ['owner', 'manager'],
  return_items:     ['owner', 'manager'],
  manage_items:     ['owner', 'manager'],
  see_cost:         ['owner', 'manager', 'viewer'],
  manage_customers: ['owner', 'manager', 'cashier'],
  record_payment:   ['owner', 'manager', 'cashier'],
  manage_expenses:  ['owner', 'manager', 'cashier'],
  manage_reminders: ['owner', 'manager', 'cashier'],
  import_data:      ['owner', 'manager'],
  store_settings:   ['owner', 'manager'],
  device_settings:  ['owner', 'manager', 'cashier'],
  manage_staff:     ['owner', 'manager'],
  manage_owners:    ['owner'],
  billing:          ['owner'],
  view_reports:     ['owner', 'manager', 'viewer'],
}

export function can(role: Role | null | undefined, perm: Permission, isAdmin = false): boolean {
  if (isAdmin) return true
  if (!role) return false
  return MATRIX[perm].includes(role)
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', viewer: 'Viewer' }

export const ROLE_INFO: Array<{ value: Role; label: string; blurb: string }> = [
  { value: 'cashier', label: 'Cashier', blurb: 'Sell, record credit payments, add customers & expenses. Cannot edit items, see costs, void sales or process returns.' },
  { value: 'manager', label: 'Manager', blurb: 'Everything a cashier can, plus items & stock, voids & returns, reports, imports and inviting cashiers.' },
  { value: 'viewer', label: 'Viewer', blurb: 'Read-only access to sales, items, credits and reports. Good for an accountant or partner.' },
  { value: 'owner', label: 'Owner', blurb: 'Full control including subscription, staff roles and store settings.' },
]

export const ROLE_TONE: Record<Role, 'brand' | 'blue' | 'orange' | 'slate' | 'purple'> = { owner: 'brand', manager: 'blue', cashier: 'orange', viewer: 'slate' }

/** Roles a given caller may hand out through an invitation code. */
export function invitableRoles(role: Role | null | undefined, isAdmin = false): Role[] {
  if (isAdmin || role === 'owner') return ['cashier', 'manager', 'viewer', 'owner']
  if (role === 'manager') return ['cashier', 'viewer']
  return []
}

/** Pretty XXXX-XXXX form of an invite code. */
export function formatInviteCode(code: string) {
  const c = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4, 8)}` : c
}
export function normalizeInviteCode(code: string) {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}
/** Join link that opens the app straight on the join screen. */
export function inviteLink(code: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://artech-pos.pages.dev'
  return `${origin}/join?code=${formatInviteCode(code)}`
}
