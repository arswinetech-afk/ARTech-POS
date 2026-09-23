// Unit test for the pure stock-report aggregation (src/lib/stockReportPdf.ts → aggregateStockReport),
// focused on the 2.3 rule set: stock tables count units that left the shelf (sold − returned to stock),
// analytics rankings are net of ALL returns. Run from the project root:  node e2e/stock-report.unit.test.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('..', import.meta.url).pathname
const out = join(mkdtempSync(join(tmpdir(), 'stockrep-')), 'stockReportPdf.mjs')
execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [join(ROOT, 'src/lib/stockReportPdf.ts'), '--bundle', '--format=esm', '--platform=node', '--external:jspdf', `--outfile=${out}`], { stdio: 'pipe' })
const { aggregateStockReport } = await import(pathToFileURL(out).href)

let failed = 0
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failed++; console.log('  ✗', msg) } }

const now = new Date('2026-09-20T12:00:00Z')
const ts = (daysAgo) => new Date(now.getTime() - daysAgo * 864e5).toISOString()
const P = (id, name, cost, price, stock) => ({ id, store_id: 's', name, barcode: null, category: null, cost, price, stock, unit: 'pcs', description: null, low_stock_at: null, is_active: true, created_at: ts(90), updated_at: ts(90), deleted_at: null })
const products = [
  P('sard', 'Sardines', 20, 31, 0),      // out of stock
  P('coff', 'Coffee 3in1', 5, 8, 3),     // low stock
  P('soap', 'Bath Soap', 30, 45, 40),    // healthy
  P('load', 'Load 50', 45, 50, 100),
]
const sale = (id, daysAgo, items, status = 'active') => ({ id, store_id: 's', txn_no: id, items, subtotal: 0, discount: 0, total: 0, cost_total: 0, profit: 0, payment_method: 'cash', status, created_at: ts(daysAgo), updated_at: ts(daysAgo) })
const line = (product_id, name, qty, price, cost) => ({ product_id, name, qty, price, cost })
const sales = [
  sale('T1', 1, [line('sard', 'Sardines', 10, 31, 20), line('coff', 'Coffee 3in1', 6, 8, 5)]),
  sale('T2', 3, [line('soap', 'Bath Soap', 4, 45, 30), line('load', 'Load 50', 2, 50, 45)]),
  sale('T3', 5, [line('sard', 'Sardines', 2, 31, 20)], 'void'),        // void → ignored
  sale('T4', 40, [line('sard', 'Sardines', 50, 31, 20)]),               // outside the 30-day window → ignored
]
const ret = (id, daysAgo, items, extra = {}) => ({ id, store_id: 's', sale_id: 'T1', sale_txn_no: 'T1', ret_no: id, items, gross: 0, discount_share: 0, refund_total: 0, cost_total: 0, restock_cost: 0, refund_method: 'cash', refund_credit: 0, refund_cash: 0, reason: null, customer_id: null, customer_name: null, created_by: null, created_at: ts(daysAgo), updated_at: ts(daysAgo), deleted_at: null, ...extra })
const rline = (product_id, name, qty, price, cost, restock) => ({ line: 0, product_id, name, unit: 'pcs', qty, price, cost, restock })
const returns = [
  ret('R1', 0, [rline('sard', 'Sardines', 3, 31, 20, true)]),                 // 3 back on the shelf
  ret('R2', 0, [rline('sard', 'Sardines', 1, 31, 20, false)]),                // 1 damaged (gone)
  ret('R3', 0, [rline('coff', 'Coffee 3in1', 2, 8, 5, false)]),               // 2 damaged
  ret('R4', 0, [rline('load', 'Load 50', 2, 50, 45, true)]),                  // everything returned
  ret('R5', 0, [rline('soap', 'Bath Soap', 4, 45, 30, true)], { deleted_at: ts(0) }), // soft-deleted → ignored
  ret('R6', 45, [rline('soap', 'Bath Soap', 4, 45, 30, true)]),               // outside the window → ignored
]

console.log('▶ without returns (2.2 behaviour unchanged)')
const base = aggregateStockReport('Bella Store', products, sales, { threshold: 5, days: 30, now })
ok(base.outOfStock.length === 1 && base.outOfStock[0].sold === 10 && base.outOfStock[0].estCost === 200, `Sardines out of stock: sold 10, est. cost 200 → ${JSON.stringify(base.outOfStock[0])}`)
ok(base.lowStock.length === 1 && base.lowStock[0].sold === 6 && base.lowStock[0].estCost === 30, `Coffee low stock: sold 6, est. cost 30`)
ok(base.bestSellers.map((l) => l.name).join(',') === 'Sardines,Coffee 3in1,Bath Soap,Load 50', `best sellers by qty: ${base.bestSellers.map((l) => `${l.name} ${l.qty}`).join(', ')}`)

console.log('▶ with returns (2.3)')
const d = aggregateStockReport('Bella Store', products, sales, { threshold: 5, days: 30, now, returns })
const sard = d.outOfStock.find((l) => l.name === 'Sardines'), coff = d.lowStock.find((l) => l.name === 'Coffee 3in1')
ok(sard && sard.sold === 7 && sard.suggested === 7 && sard.estCost === 140, `Sardines: 10 sold − 3 restocked (damaged one still needs replacing) → Sold 7, est. cost 140 → ${JSON.stringify(sard)}`)
ok(coff && coff.sold === 6 && coff.estCost === 30, `Coffee: 6 sold, 2 damaged returns not restocked → Sold stays 6 → ${JSON.stringify(coff)}`)
const perf = Object.fromEntries(d.topRevenue.map((l) => [l.name, l]))
ok(perf.Sardines && perf.Sardines.qty === 6 && perf.Sardines.revenue === 186 && perf.Sardines.profit === 46, `analytics Sardines net of all returns: qty 10−4=6, revenue 310−124=186, profit 110−(124−60)=46 → ${JSON.stringify(perf.Sardines)}`)
ok(perf['Coffee 3in1'] && perf['Coffee 3in1'].qty === 4 && perf['Coffee 3in1'].revenue === 32 && perf['Coffee 3in1'].profit === 2, `Coffee: qty 6−2=4, revenue 48−16=32, profit 18−16=2 (cost of damaged units not recovered) → ${JSON.stringify(perf['Coffee 3in1'])}`)
ok(perf['Bath Soap'] && perf['Bath Soap'].qty === 4 && perf['Bath Soap'].revenue === 180, `Bath Soap untouched (deleted / out-of-window returns ignored): ${JSON.stringify(perf['Bath Soap'])}`)
ok(!perf['Load 50'] && !d.bestSellers.some((l) => l.name === 'Load 50') && !d.slowMoving.some((l) => l.name === 'Load 50'), 'fully returned product (net qty 0) drops out of every ranking')
ok(d.bestSellers.map((l) => l.name).join(',') === 'Sardines,Bath Soap,Coffee 3in1', `best sellers re-ranked on net qty (tie on 4 → higher revenue first): ${d.bestSellers.map((l) => `${l.name} ${l.qty}`).join(', ')}`)
ok(d.topRevenue[0].name === 'Sardines' && d.topRevenue[1].name === 'Bath Soap' && d.topRevenue[2].name === 'Coffee 3in1', `top revenue: ${d.topRevenue.map((l) => `${l.name} ${l.revenue}`).join(', ')}`)
ok(d.mostProfitable[0].name === 'Bath Soap' && d.mostProfitable[0].profit === 60 && d.mostProfitable[1].name === 'Sardines', `most profitable: ${d.mostProfitable.map((l) => `${l.name} ${l.profit}`).join(', ')}`)
ok(d.slowMoving[0].name === 'Coffee 3in1', `slow moving starts with the lowest net qty: ${d.slowMoving.map((l) => `${l.name} ${l.qty}`).join(', ')}`)

console.log(failed ? `\n${failed} FAILED` : '\nALL STOCK REPORT UNIT TESTS PASSED')
process.exit(failed ? 1 : 0)
