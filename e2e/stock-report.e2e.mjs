// Browser E2E: seed local DB with the real CSV data, click "Download Stock Report", capture the PDF.
import { chromium, devices } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = 'http://localhost:5173'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (uid, email) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`
const OWNER = { id: '00000000-0000-4000-8000-000000000001', email: 'bella@example.com', full_name: 'Bella Cruz' }
const S1 = { id: '10000000-0000-4000-8000-000000000001', name: "Bella & Ty's Consumer Goods Trading", owner_name: 'Bella Cruz' }
const PLANS = [{ id: 'monthly', name: 'Monthly', price: 149, period_days: 30, features: [], badge: null, is_active: true, sort: 1 }]
const storeRow = (s) => ({ ...s, owner_id: OWNER.id, address: 'Zone 3 Hanawan', contact: '0917', tin: null, logo_data: null, receipt_footer: 'Thank you!', paper_width: 58, print_logo: true, low_stock_threshold: 5, currency: 'PHP', settings: {}, trial_ends_at: new Date(Date.now() + 10 * 864e5).toISOString(), plan_id: null, subscription_status: 'trial', subscription_ends_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })
const session = (u) => ({ access_token: jwt(u.id, u.email), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'r', user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: { full_name: u.full_name }, created_at: '2026-01-01T00:00:00Z' } })

// --- CSV → rows
function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.length > 1)
}
const now = new Date().toISOString()
const [, ...prows] = parseCSV(readFileSync('/home/user/uploads/inventory-products.csv', 'utf8'))
const products = prows.map((r, i) => ({ id: `p-${i}`, store_id: S1.id, name: r[0], barcode: r[1] || null, category: r[2] || null, cost: +r[3] || 0, price: +r[4] || 0, stock: +r[5] || 0, unit: r[6] || null, description: r[7] || null, low_stock_at: null, is_active: true, created_at: now, updated_at: now, deleted_at: null }))
const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]))
const [, ...srows] = parseCSV(readFileSync('/home/user/uploads/sales-transactions.csv', 'utf8'))
// shift sale dates so the CSV's newest day (2026-09-18) lands on "today"
const shift = Date.now() - new Date('2026-09-18T12:00:00Z').getTime()
const sales = srows.map((r, i) => {
  const items = (r[8] || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(.*) x([\d.]+)$/); const name = m ? m[1].trim() : s; const qty = m ? +m[2] : 1
    const p = byName.get(name.toLowerCase())
    return { product_id: p?.id || null, name, qty, price: p?.price || 0, cost: p?.cost || 0 }
  })
  const at = new Date(new Date(r[1]).getTime() + shift).toISOString()
  return { id: `s-${i}`, store_id: S1.id, txn_no: r[0], items, subtotal: +r[4] || 0, discount: +r[6] || 0, total: +r[4] || 0, cost_total: 0, profit: 0, payment_method: r[2], customer_id: null, customer_name: r[3] || null, amount_paid: null, change_due: null, status: r[7] === 'VOID' ? 'void' : 'active', note: null, created_by: OWNER.id, created_at: at, updated_at: at }
})

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'en-PH', timezoneId: 'Asia/Manila', acceptDownloads: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.request().url().includes('/user') ? session(OWNER).user : session(OWNER)) }))
await page.route('**/rest/v1/**', (r) => {
  const p = new URL(r.request().url()).pathname.split('/rest/v1/')[1]
  const j = (b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
  if (p === 'rpc/my_bootstrap') return j({ profile: { id: OWNER.id, email: OWNER.email, full_name: OWNER.full_name, is_admin: false }, store: storeRow(S1), role: 'owner', stores: [{ id: S1.id, name: S1.name, role: 'owner' }], members: [], plans: PLANS })
  return j([])
})
await page.goto(BASE + '/auth'); await page.fill('input[type=email]', OWNER.email); await page.fill('input[type=password]', 'secret123'); await page.click('button[type=submit]')
await page.waitForSelector('h1:has-text("Dashboard")')

// seed IndexedDB (same DB the app uses)
const seeded = await page.evaluate(async ({ products, sales }) => {
  const db = await new Promise((res, rej) => { const rq = indexedDB.open('artech-pos'); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error) })
  await new Promise((res, rej) => {
    const tx = db.transaction(['products', 'sales'], 'readwrite')
    const ps = tx.objectStore('products'); const ss = tx.objectStore('sales')
    for (const p of products) ps.put(p)
    for (const s of sales) ss.put(s)
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
  })
  return { products: products.length, sales: sales.length }
}, { products, sales })
console.log('seeded', seeded)
await page.reload(); await page.waitForSelector('h1:has-text("Dashboard")')
await page.waitForSelector('text=Out of Stock (')
const t0 = Date.now()
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('[data-testid=stock-report]')])
const file = '/tmp/pdftest/browser.pdf'
await download.saveAs(file)
console.log('download', download.suggestedFilename(), 'in', Date.now() - t0, 'ms', readFileSync(file).length, 'bytes')
await page.waitForSelector('text=Stock report downloaded')
console.log('toast ok')
await page.screenshot({ path: '/tmp/pdftest/dash.png' })
await browser.close()
if (errors.length) { console.log('PAGE ERRORS', errors); process.exit(1) }
