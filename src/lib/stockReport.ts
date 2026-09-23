/**
 * Stock report: collects data from the local (offline) database and produces the PDF.
 * Works fully offline — products and the last 180 days of sales are already on the device.
 */
import { subDays } from 'date-fns'
import { db } from './db'
import { aggregateStockReport, buildStockReportPdf, stockReportFilename, type StockReportData } from './stockReportPdf'
import type { Store } from './types'

export async function collectStockReport(store: Pick<Store, 'id' | 'name' | 'low_stock_threshold'>, now = new Date()): Promise<StockReportData> {
  const since = subDays(now, 30).toISOString()
  const [products, sales, returns] = await Promise.all([
    db.products.where('store_id').equals(store.id).toArray(),
    db.sales.where('store_id').equals(store.id).and((s) => s.created_at >= since && s.status === 'active').toArray(),
    db.sale_returns.where('store_id').equals(store.id).and((r) => r.created_at >= since).toArray(),
  ])
  return aggregateStockReport(store.name, products, sales, { threshold: store.low_stock_threshold ?? 5, days: 30, now, returns })
}

export interface StockReportResult { filename: string; pages: number; blob: Blob; data: StockReportData }

export async function createStockReport(store: Pick<Store, 'id' | 'name' | 'low_stock_threshold'>, now = new Date()): Promise<StockReportResult> {
  const data = await collectStockReport(store, now)
  const doc = await buildStockReportPdf(data)
  return { filename: stockReportFilename(now), pages: doc.getNumberOfPages(), blob: doc.output('blob'), data }
}

/** Save the PDF to the device (Downloads folder on Android/desktop; opens in a tab on iOS). */
export function savePdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 60_000)
}

/** True when the Web Share API can hand a PDF to other apps (Messenger, Drive, printers…). */
export function canSharePdf(blob: Blob, filename: string) {
  try {
    const file = new File([blob], filename, { type: 'application/pdf' })
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch { return false }
}

export async function sharePdf(blob: Blob, filename: string, title: string) {
  const file = new File([blob], filename, { type: 'application/pdf' })
  await navigator.share({ files: [file], title })
}
