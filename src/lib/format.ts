import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO } from 'date-fns'

export const peso = (n: number | null | undefined, opts: { compact?: boolean } = {}) => {
  const v = Number(n ?? 0)
  if (opts.compact && Math.abs(v) >= 1000) {
    return '₱' + new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  }
  return '₱' + new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

export const num = (n: number | null | undefined, digits = 0) =>
  new Intl.NumberFormat('en-PH', { maximumFractionDigits: digits }).format(Number(n ?? 0))

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function fmtDate(iso: string | null | undefined, pattern = 'MMM d, yyyy') {
  if (!iso) return '—'
  try { return format(typeof iso === 'string' ? parseISO(iso) : iso, pattern) } catch { return String(iso) }
}
export const fmtDateTime = (iso: string | null | undefined) => fmtDate(iso, 'MMM d, yyyy h:mm a')
export const fmtTime = (iso: string | null | undefined) => fmtDate(iso, 'h:mm a')

export function fmtRelative(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = parseISO(iso)
  if (isToday(d)) return 'Today ' + format(d, 'h:mm a')
  if (isYesterday(d)) return 'Yesterday ' + format(d, 'h:mm a')
  return format(d, 'MMM d, h:mm a')
}

export const timeAgo = (iso: string | null | undefined) => iso ? formatDistanceToNowStrict(parseISO(iso)) + ' ago' : '—'

export const todayKey = () => format(new Date(), 'yyyy-MM-dd')
export const dateKey = (d: Date) => format(d, 'yyyy-MM-dd')

export const cls = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0)

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff' + text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function toCSV(rows: Array<Record<string, unknown>>, headers?: string[]): string {
  if (!rows.length) return ''
  const cols = headers ?? Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n')
}
