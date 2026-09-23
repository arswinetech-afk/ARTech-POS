// Browser E2E for the redesigned POS: layout at "phone in desktop mode" width (980px), laptop width and mobile;
// cart flow (discount preset, hold/resume, customer, note, checkout), persistence across reload, recent sales + void.
// Run: bash e2e/setup-playwright.sh ; export LD_LIBRARY_PATH=...; (cd /tmp/pw && node /home/user/artech-pos/e2e/pos.e2e.mjs)
import { chromium, devices } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:5173'
const OUT = process.env.OUT || '/tmp/postest'
mkdirSync(OUT, { recursive: true })
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (uid, email) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`
const OWNER = { id: '00000000-0000-4000-8000-000000000001', email: 'bella@example.com', full_name: 'Bella Cruz' }
const S1 = { id: '10000000-0000-4000-8000-000000000001', name: "Bella & Ty's Consumer Goods Trading", owner_name: 'Bella Cruz' }
const PLANS = [{ id: 'monthly', name: 'Monthly', price: 149, period_days: 30, features: [], badge: null, is_active: true, sort: 1 }]
const storeRow = (s) => ({ ...s, owner_id: OWNER.id, address: 'Zone 3 Hanawan', contact: '0917', tin: null, logo_data: null, receipt_footer: 'Thank you!', paper_width: 58, print_logo: true, low_stock_threshold: 5, currency: 'PHP', settings: {}, trial_ends_at: new Date(Date.now() + 10 * 864e5).toISOString(), plan_id: null, subscription_status: 'trial', subscription_ends_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })
const session = (u) => ({ access_token: jwt(u.id, u.email), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'r', user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: { full_name: u.full_name }, created_at: '2026-01-01T00:00:00Z' } })

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
const customers = ['Aling Nena', 'Mang Tonyo', 'Ate Marie'].map((name, i) => ({ id: `c-${i}`, store_id: S1.id, name, phone: null, notes: null, created_at: now, updated_at: now, deleted_at: null }))

const errors = []
const rpcCalls = []
async function newPage(browser, ctxOpts) {
  // serviceWorkers:'block' → page.route() mocks also apply to the production build (the SW's NetworkOnly
  // pass-through for supabase.co would otherwise bypass Playwright's request interception)
  const ctx = await browser.newContext({ locale: 'en-PH', timezoneId: 'Asia/Manila', serviceWorkers: 'block', ...ctxOpts })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.request().url().includes('/user') ? session(OWNER).user : session(OWNER)) }))
  await page.route('**/rest/v1/**', (r) => {
    const p = new URL(r.request().url()).pathname.split('/rest/v1/')[1]
    const j = (b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
    if (p.startsWith('rpc/')) rpcCalls.push(p)
    if (p === 'rpc/my_bootstrap') return j({ profile: { id: OWNER.id, email: OWNER.email, full_name: OWNER.full_name, is_admin: false }, store: storeRow(S1), role: 'owner', stores: [{ id: S1.id, name: S1.name, role: 'owner' }], members: [], plans: PLANS })
    return j([])
  })
  await page.goto(BASE + '/auth'); await page.fill('input[type=email]', OWNER.email); await page.fill('input[type=password]', 'secret123'); await page.click('button[type=submit]')
  await page.waitForSelector('h1:has-text("Dashboard")')
  await page.evaluate(async ({ products, sales, customers }) => {
    const db = await new Promise((res, rej) => { const rq = indexedDB.open('artech-pos'); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error) })
    await new Promise((res, rej) => {
      const tx = db.transaction(['products', 'sales', 'customers'], 'readwrite')
      for (const p of products) tx.objectStore('products').put(p)
      for (const s of sales) tx.objectStore('sales').put(s)
      for (const c of customers) tx.objectStore('customers').put(c)
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
    })
  }, { products, sales, customers })
  return { ctx, page }
}
const assert = (cond, msg) => { if (!cond) { console.error('ASSERT FAILED:', msg); process.exitCode = 1; throw new Error(msg) } console.log('  ✓', msg) }
const fmt = (n) => new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 }).format(n)
const money = (n) => '₱' + new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const overflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))

const browser = await chromium.launch()

// ---------------------------------------------------------------- 1. phone in "desktop site" mode (980px wide)
console.log('▶ 980px desktop-mode')
{
  const { ctx, page } = await newPage(browser, { viewport: { width: 980, height: 1600 }, deviceScaleFactor: 1 })
  await page.goto(BASE + '/pos'); await page.waitForSelector('h1:has-text("Point of Sale")'); await page.waitForSelector('[data-testid=product-card]')
  let o = await overflow(page); assert(o.sw <= o.cw, `no horizontal overflow at 980 (scrollWidth ${o.sw} / client ${o.cw})`)
  assert((await page.getAttribute('[data-testid=sidebar]', 'data-collapsed')) === '1', 'sidebar auto-collapsed to icon rail on POS')
  const cols = await page.$$eval('[data-testid=product-card]', (els) => new Set(els.slice(0, 20).map((e) => e.getBoundingClientRect().left)).size)
  console.log('  product columns:', cols)
  assert(cols >= 3, 'at least 3 product columns at 980px')
  await page.screenshot({ path: `${OUT}/pos-980-empty.png` })

  // add products via card taps + F2 search
  const cards = page.locator('[data-testid=product-card]')
  const n1 = await cards.nth(0).locator('div').first().innerText()
  await cards.nth(0).click(); await cards.nth(0).click(); await cards.nth(1).click()
  assert((await page.locator('[data-testid=cart-line]').count()) === 2, `two cart lines after taps (${n1} ×2 + 1)`)
  await page.keyboard.press('F2')
  assert(await page.evaluate(() => document.activeElement?.placeholder?.includes('Search')), 'F2 focuses the search box')
  const withBarcode = products.find((p) => p.barcode && p.stock > 0 && p.name !== n1 && p.name !== products[1].name)
  await page.keyboard.type(withBarcode.barcode); await page.keyboard.press('Enter')
  assert((await page.locator('[data-testid=cart-line]').count()) === 3, 'barcode + Enter adds a third line')

  // discount preset
  await page.click('[data-testid=act-discount]')
  await page.click('button:has-text("SC/PWD 20%")')
  const subtotal = await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid=cart-panel] .flex.justify-between')]; const r = rows.find((x) => x.textContent.startsWith('Subtotal')); return parseFloat(r.lastChild.textContent.replace(/[₱,]/g, '')) })
  await page.click('[data-testid=apply-discount]')
  const discText = await page.locator('[data-testid=cart-panel] :text("Discount · SC/PWD")').first().innerText()
  assert(discText.includes('SC/PWD'), 'discount row shows the SC/PWD label')
  const discAmt = await page.locator('[data-testid=act-discount]').innerText()
  assert(Math.abs(parseFloat(discAmt.replace(/[^\d.]/g, '')) - Math.round(subtotal * 20) / 100) < 0.011, `discount = 20% of subtotal (${discAmt} of ${subtotal})`)

  // customer + note
  await page.click('[data-testid=act-customer]')
  await page.fill('input[placeholder*="Search name"]', 'Mang')
  await page.click('button:has-text("Mang Tonyo")')
  assert((await page.locator('[data-testid=cart-panel] :text("Mang Tonyo")').count()) >= 1, 'customer attached from the cart')
  await page.click('[data-testid=act-note]'); await page.fill('textarea', 'Deliver after 5 PM'); await page.click('button:has-text("Done")')
  await page.screenshot({ path: `${OUT}/pos-980-cart.png` })

  // hold → resume
  await page.click('[data-testid=act-hold]')
  assert((await page.locator('[data-testid=cart-line]').count()) === 0, 'hold parks the cart (cart empty)')
  assert((await page.locator('[data-testid=act-hold]').innerText()).includes('Held (1)'), 'hold button shows Held (1)')
  await page.click('[data-testid=act-hold]'); await page.waitForSelector('text=Sales on hold')
  await page.screenshot({ path: `${OUT}/pos-980-held.png` })
  await page.click('[data-testid=resume-held]')
  assert((await page.locator('[data-testid=cart-line]').count()) === 3, 'resume restores 3 lines')
  assert((await page.locator('[data-testid=cart-panel] :text("Discount · SC/PWD")').count()) === 1, 'resume restores the discount')

  // persistence across reload
  await page.reload(); await page.waitForSelector('[data-testid=cart-line]')
  assert((await page.locator('[data-testid=cart-line]').count()) === 3, 'cart survives a page reload')

  // line editor: tap the qty → set 5
  await page.locator('[data-testid=cart-line]').nth(2).locator('button').nth(2).click()
  await page.waitForSelector('text=Quantity'); await page.click('[role=dialog] button:text-is("5")'); await page.click('[role=dialog] button:has-text("Apply")')
  assert((await page.locator('[data-testid=cart-line]').nth(2).innerText()).includes('5'), 'line editor sets qty 5')

  // sidebar toggle expands without overflow
  await page.click('[data-testid=sidebar-toggle]')
  assert((await page.getAttribute('[data-testid=sidebar]', 'data-collapsed')) === '0', 'toggle expands the sidebar')
  o = await overflow(page); assert(o.sw <= o.cw, `still no horizontal overflow with sidebar expanded (${o.sw}/${o.cw})`)
  await page.screenshot({ path: `${OUT}/pos-980-expanded.png` })
  await page.click('[data-testid=sidebar-toggle]')

  // F9 → checkout → cash exact → complete
  await page.keyboard.press('F9'); await page.waitForSelector('text=Amount due')
  assert((await page.locator('text=(SC/PWD)').count()) >= 1, 'checkout shows discount label')
  await page.screenshot({ path: `${OUT}/pos-980-checkout.png` })
  await page.click('button:has-text("Exact")'); await page.click('[data-testid=complete-sale]')
  await page.waitForSelector('text=Sale completed', { timeout: 10000 }).catch(() => {})
  const receipt = await page.locator('pre').first().innerText()
  assert(receipt.includes('Discount (SC/PWD)'), 'receipt prints "Discount (SC/PWD)"')
  assert(receipt.includes('Customer: Mang Tonyo'), 'receipt prints customer')
  await page.screenshot({ path: `${OUT}/pos-980-receipt.png` })
  const saleNote = await page.evaluate(async () => { const db = await new Promise((res) => { const rq = indexedDB.open('artech-pos'); rq.onsuccess = () => res(rq.result) }); return new Promise((res) => { const rq = db.transaction('sales').objectStore('sales').getAll(); rq.onsuccess = () => { const s = rq.result.filter((x) => x.note).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]; res(s && { note: s.note, discount: s.discount, customer_name: s.customer_name }) } }) })
  console.log('  saved sale:', saleNote)
  assert(saleNote.note === 'Discount: SC/PWD · Deliver after 5 PM', 'sale.note carries discount label + note')
  await page.keyboard.press('Escape')
  assert((await page.locator('[data-testid=cart-line]').count()) === 0, 'cart cleared after sale')

  // ---- partial return of 1 unit from the sale we just made (2.3)
  const stockOf = (id) => page.evaluate(async (id) => { const db = await new Promise((res) => { const rq = indexedDB.open('artech-pos'); rq.onsuccess = () => res(rq.result) }); return new Promise((res) => { const rq = db.transaction('products').objectStore('products').get(id); rq.onsuccess = () => res(rq.result.stock) }) }, id)
  const firstProduct = products.find((p) => p.name === n1)
  const stockBefore = await stockOf(firstProduct.id)
  await page.click('[data-testid=recent-sales]'); await page.waitForSelector('text=Recent sales')
  const saleRow = page.locator('li').filter({ hasText: 'Mang Tonyo' }).first()
  await saleRow.locator('button[aria-label^="Return items"]').click()
  await page.waitForSelector('text=Return items ·')
  const lines = page.locator('[data-testid=return-line]')
  assert((await lines.count()) === 3, 'return sheet lists the 3 sale lines')
  const line0 = lines.filter({ hasText: n1 }).first()
  await line0.locator('button[aria-label=More]').click()
  // refund = unit price minus the same share of the sale-level discount (discount / subtotal)
  const soldSale = await page.evaluate(async () => { const db = await new Promise((res) => { const rq = indexedDB.open('artech-pos'); rq.onsuccess = () => res(rq.result) }); return new Promise((res) => { const rq = db.transaction('sales').objectStore('sales').getAll(); rq.onsuccess = () => { const s = rq.result.filter((x) => x.customer_name === 'Mang Tonyo').sort((a, b) => b.created_at.localeCompare(a.created_at))[0]; res({ subtotal: s.subtotal, discount: s.discount }) } }) })
  const share = Math.round(firstProduct.price * soldSale.discount / soldSale.subtotal * 100) / 100
  const expectedRefund = Math.round((firstProduct.price - share) * 100) / 100
  const btn = page.locator('[data-testid=confirm-return]')
  assert((await btn.innerText()).replace(/[^\d.]/g, '') === expectedRefund.toFixed(2), `refund button = ${await btn.innerText()} (price ${firstProduct.price} − discount share ${share} of ₱${soldSale.discount} on ₱${soldSale.subtotal})`)
  assert((await page.locator('text=Less discount share').count()) === 1, 'discount share row shown')
  await page.click('button:has-text("Damaged / expired")')
  assert((await page.locator('text=stock stays as is').count()) === 1, '"Damaged" reason switches restock off')
  await page.click('text=Put the items back in stock')
  assert((await page.locator('text=Stock is restored').count()) === 1, 'restock toggled back on')
  await page.screenshot({ path: `${OUT}/pos-980-return.png` })
  await btn.click()
  await page.waitForSelector('text=Return recorded')
  const slipText = await page.locator('[data-testid=refund-slip]').innerText()
  assert(slipText.includes('REFUND SLIP') && slipText.includes('Less discount share') && slipText.includes(`REFUND`) && slipText.includes(expectedRefund.toFixed(2)), 'refund slip printed with discount share and total')
  assert(slipText.includes('Customer: Mang Tonyo') && slipText.includes('Reason: Damaged / expired'), 'slip carries customer and reason')
  await page.screenshot({ path: `${OUT}/pos-980-refund-slip.png` })
  await page.click('[role=dialog] button:has-text("Close")')
  const stockAfter = await stockOf(firstProduct.id)
  assert(Math.abs(stockAfter - (stockBefore + 1)) < 0.0005, `stock restored by the returned unit (${stockBefore} → ${stockAfter})`)
  await saleRow.locator(':text("refunded")').waitFor({ timeout: 5000 })
  assert((await saleRow.innerText()).includes(`−₱${expectedRefund.toFixed(2)} refunded`), 'recent list shows the refunded amount')
  assert((await saleRow.locator('button[aria-label^="Void"]').count()) === 0, 'void hidden once the sale has returns')
  const ret = await page.evaluate(async () => { const db = await new Promise((res) => { const rq = indexedDB.open('artech-pos'); rq.onsuccess = () => res(rq.result) }); return new Promise((res) => { const rq = db.transaction('sale_returns').objectStore('sale_returns').getAll(); rq.onsuccess = () => res(rq.result) }) })
  console.log('  local return row:', JSON.stringify({ ret_no: ret[0]?.ret_no, gross: ret[0]?.gross, share: ret[0]?.discount_share, refund: ret[0]?.refund_total, method: ret[0]?.refund_method, restock: ret[0]?.items?.[0]?.restock }))
  assert(ret.length === 1 && ret[0].refund_total === expectedRefund && ret[0].items[0].restock === true && ret[0].refund_method === 'cash', 'sale_returns row stored locally with the right maths')
  const outbox = await page.evaluate(async () => { const db = await new Promise((res) => { const rq = indexedDB.open('artech-pos'); rq.onsuccess = () => res(rq.result) }); return new Promise((res) => { const rq = db.transaction('outbox').objectStore('outbox').getAll(); rq.onsuccess = () => res(rq.result.map((o) => o.rpc || o.table)) }) })
  console.log('  outbox:', outbox.join(', ') || '(flushed)')
  // receipt of that sale shows the refund + still offers "Return items" for the remaining units
  await saleRow.locator('button').first().click(); await page.waitForSelector('text=Receipt ')
  assert((await page.locator('[data-testid=receipt-returns]').count()) === 1, 'receipt shows the returns box')
  assert((await page.locator('pre').first().innerText()).includes('Refunded (returns)'), 'receipt text has a Refunded line')
  assert((await page.locator('[data-testid=return-items]').count()) === 1, 'Return items still offered (units remain)')
  await page.keyboard.press('Escape'); await page.waitForTimeout(150); await page.keyboard.press('Escape')

  // ---- void a fresh 1-item sale from Recent (full refund path)
  await page.locator('[data-testid=product-card]').nth(3).click()
  await page.keyboard.press('F9'); await page.waitForSelector('text=Amount due'); await page.click('button:has-text("Exact")'); await page.click('[data-testid=complete-sale]')
  await page.waitForSelector('text=Sale completed'); await page.keyboard.press('Escape')
  await page.click('[data-testid=recent-sales]'); await page.waitForSelector('text=Recent sales')
  const first = page.locator('[role=dialog] li').first()
  await first.locator('button[aria-label^="Void"]').click()
  await page.waitForSelector('text=Void & refund')
  await page.click('button:has-text("Void & refund")')
  await page.waitForSelector('text=Transaction voided')
  await first.locator(':text-is("Void")').waitFor({ timeout: 5000 })
  assert(/void/i.test(await first.innerText()), 'sale shows Void after voiding from Recent')
  await page.screenshot({ path: `${OUT}/pos-980-voided.png` })
  await page.keyboard.press('Escape')

  // ---- credit (utang) sale with a partial payment: the whole amount is a sale, the unpaid part is utang,
  //      and only the money actually handed over counts as cash collected
  const creditProduct = products.find((p) => p.stock > 0 && p.price >= 50 && p.price <= 500 && p.name !== n1 && p.name !== withBarcode.name && !products.some((o) => o !== p && o.name.toLowerCase().includes(p.name.toLowerCase())))
  const partial = Math.floor(creditProduct.price / 3)
  const utang = r2(creditProduct.price - partial)
  await page.keyboard.press('F2'); await page.keyboard.type(creditProduct.name)
  await page.locator('[data-testid=product-card]').filter({ hasText: creditProduct.name }).first().click()
  assert((await page.locator('[data-testid=cart-line]').count()) === 1, `credit sale: ${creditProduct.name} (₱${creditProduct.price}) in the cart`)
  await page.keyboard.press('F9'); await page.waitForSelector('text=Amount due')
  await page.click('[role=dialog] button:has-text("Credit / Utang")')
  await page.fill('[role=dialog] input[placeholder*="Search name"]', 'Aling'); await page.click('[role=dialog] button:has-text("Aling Nena")')
  await page.fill('[role=dialog] input[inputmode=decimal]', String(partial))
  const newBal = await page.locator('[role=dialog] :text("New balance after this sale")').locator('..').innerText()
  assert(newBal.includes(money(utang)), `payment sheet: new balance ${money(utang)} = ₱${creditProduct.price} − ₱${partial} paid now ("${newBal.replace(/\s+/g, ' ')}")`)
  await page.click('[data-testid=complete-sale]')
  await page.waitForSelector('pre')
  const creditReceipt = await page.locator('pre').first().innerText()
  assert(creditReceipt.includes('CREDIT (UTANG)') && creditReceipt.includes(`Partial paid`) && creditReceipt.includes(partial.toFixed(2)) && creditReceipt.includes('Added to balance') && creditReceipt.includes(utang.toFixed(2)), 'receipt prints Partial paid + Added to balance')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  // independent expectation straight from IndexedDB (today, local time)
  const expectCash = await page.evaluate(async () => {
    const db = await new Promise((res) => { const rq = indexedDB.open('artech-pos'); rq.onsuccess = () => res(rq.result) })
    const all = (store) => new Promise((res) => { const rq = db.transaction(store).objectStore(store).getAll(); rq.onsuccess = () => res(rq.result) })
    const start = new Date(); start.setHours(0, 0, 0, 0); const from = start.toISOString()
    const end = new Date(); end.setHours(23, 59, 59, 999); const to = end.toISOString()
    const sales = (await all('sales')).filter((s) => s.status === 'active' && s.created_at >= from && s.created_at <= to)
    const up = (s) => Math.min(Number(s.amount_paid || 0), Number(s.total))
    const credit = sales.filter((s) => s.payment_method === 'credit')
    const cashCheckout = sales.filter((s) => s.payment_method !== 'credit').reduce((a, s) => a + Number(s.total), 0) + credit.reduce((a, s) => a + up(s), 0)
    const collections = (await all('credit_payments')).filter((p) => !p.deleted_at && p.created_at >= from).reduce((a, p) => a + Number(p.amount), 0)
    const refundCash = (await all('sale_returns')).filter((r) => r.created_at >= from).reduce((a, r) => a + Number(r.refund_cash), 0)
    const gross = sales.reduce((a, s) => a + Number(s.total), 0)
    return { gross, cashCheckout, collections, refundCash, cash: cashCheckout + collections - refundCash, utangAdded: credit.reduce((a, s) => a + Number(s.total) - up(s), 0), upfront: credit.reduce((a, s) => a + up(s), 0), creditCount: credit.length }
  })
  console.log('  expected today:', JSON.stringify(expectCash))
  assert(expectCash.upfront === partial && expectCash.cash < expectCash.gross, `today's cash (${money(expectCash.cash)}) is less than net sales (${money(expectCash.gross)}) by the utang + refunds`)
  // dashboard says how much of today's sales went on utang
  await page.goto(BASE + '/'); await page.waitForSelector('h1:has-text("Dashboard")')
  await page.waitForSelector(`text=${money(expectCash.utangAdded)} on utang`, { timeout: 10000 }).catch(() => {})  // live query settles
  const todayCard = await page.locator(':text-is("Today\'s Sales")').first().locator('..').locator('..').innerText()
  assert(todayCard.includes(`${money(expectCash.utangAdded)} on utang`), `dashboard Today's Sales hint shows "${money(expectCash.utangAdded)} on utang" ("${todayCard.replace(/\s+/g, ' ')}")`)

  // ---- reports reflect the refund
  await page.goto(BASE + '/reports?range=today'); await page.waitForSelector('h1:has-text("Reports")')
  await page.waitForSelector(`text=after ₱${expectedRefund.toFixed(2)} refunds`, { timeout: 20000 })
  const refundsCard = await page.locator('text=Returns / Refunds').locator('..').locator('..').innerText().catch(() => '')
  console.log('  refunds card:', refundsCard.replace(/\s+/g, ' ').trim())
  assert(refundsCard.includes(`₱${expectedRefund.toFixed(2)}`) && refundsCard.includes('1 return'), 'Returns / Refunds card shows the amount and count')
  const cashCard = (await page.locator('[data-testid=cash-collected]').innerText()).replace(/\s+/g, ' ')
  assert(cashCard.includes(money(expectCash.cash)) && cashCard.includes(`${money(expectCash.cashCheckout)} at checkout`) && cashCard.includes(`${money(expectCash.collections)} utang payments`) && cashCard.includes(`−${money(expectCash.refundCash)} refunds`), `Cash Collected = ${money(expectCash.cash)} with breakdown ("${cashCard}")`)
  const creditCard = (await page.locator(':text-is("Credit / Utang")').first().locator('..').locator('..').innerText()).replace(/\s+/g, ' ')
  assert(creditCard.includes(`${fmt(expectCash.creditCount)}`) && creditCard.includes(`${money(expectCash.utangAdded)} added to utang`) && creditCard.includes(`${money(partial)} paid upfront`), `Credit / Utang card: ${expectCash.creditCount} sales, ${money(expectCash.utangAdded)} added to utang, ${money(partial)} paid upfront ("${creditCard}")`)
  const netCard = (await page.locator(':text-is("Net Sales")').first().locator('..').locator('..').innerText()).replace(/\s+/g, ' ')
  assert(netCard.includes(money(expectCash.gross - expectedRefund)) && netCard.includes(`${money(expectCash.utangAdded)} on utang`), `Net Sales stays accrual (${money(expectCash.gross - expectedRefund)}) and says how much is on utang`)
  await page.setViewportSize({ width: 412, height: 915 }); await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/reports-cash-mobile.png`, fullPage: true })
  await page.setViewportSize({ width: 980, height: 1600 }); await page.waitForTimeout(300)
  await page.click('button:has-text("Transactions")')
  const creditRow = page.locator('button').filter({ hasText: 'Aling Nena' }).first()
  assert((await creditRow.innerText()).includes(`${money(partial)} paid · ${money(utang)} utang`), 'transaction row shows the paid / utang split of the credit sale')
  await page.click('button:has-text("Returns (1)")')
  await page.waitForSelector(`text=${ret[0].ret_no}`)
  assert((await page.locator('text=Damaged / expired').count()) >= 1, 'Returns tab lists the return with its reason')
  await page.screenshot({ path: `${OUT}/reports-returns.png` })
  // Top Products is net of the return: recompute today's ranking straight from IndexedDB (sales − returns) and
  // compare it with the rendered rows; the returned product must show one unit less than it sold
  await page.click('button:has-text("Top Products")'); await page.waitForSelector('[data-testid=top-row]')
  const expectedTop = await page.evaluate(async (pid) => {
    const db = await new Promise((res) => { const rq = indexedDB.open('artech-pos'); rq.onsuccess = () => res(rq.result) })
    const all = (store) => new Promise((res) => { const rq = db.transaction(store).objectStore(store).getAll(); rq.onsuccess = () => res(rq.result) })
    const start = new Date(); start.setHours(0, 0, 0, 0); const from = start.toISOString()
    const m = new Map(); let grossQty = 0
    for (const s of await all('sales')) if (s.status === 'active' && s.created_at >= from) for (const it of s.items) { const k = it.product_id || it.name; const e = m.get(k) || { name: it.name, qty: 0, revenue: 0 }; e.qty += it.qty; e.revenue += it.qty * it.price; m.set(k, e); if (it.product_id === pid) grossQty += it.qty }
    for (const r of await all('sale_returns')) if (r.created_at >= from) for (const it of r.items) { const k = it.product_id || it.name; const e = m.get(k); if (e) { e.qty -= it.qty; e.revenue -= it.qty * it.price } }
    const list = [...m.values()].filter((e) => e.qty > 0).sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name))
    return { list, grossQty, netQty: m.get(pid)?.qty }
  }, firstProduct.id)
  const rows = page.locator('[data-testid=top-row]')
  const rendered = []
  for (let i = 0; i < await rows.count(); i++) rendered.push((await rows.nth(i).innerText()).replace(/\s+/g, ' '))
  assert(expectedTop.netQty === expectedTop.grossQty - 1, `${n1}: sold ${expectedTop.grossQty} today, 1 returned → net ${expectedTop.netQty}`)
  const mine = rendered.find((t) => t.includes(n1))
  assert(mine && mine.includes(`${fmt(expectedTop.netQty)} sold`) && mine.includes(money(expectedTop.list.find((e) => e.name === n1).revenue)), `Top Products row shows the net figures: "${mine}"`)
  assert(rendered.length === Math.min(expectedTop.list.length, 100) && rendered.every((t, i) => t.includes(expectedTop.list[i].name) && t.includes(`${fmt(expectedTop.list[i].qty)} sold`)), `all ${rendered.length} Top Products rows match the independent net ranking`)
  await page.screenshot({ path: `${OUT}/reports-top-net.png` })
  await ctx.close()
}

// ---------------------------------------------------------------- 2. laptop 1366px
console.log('▶ 1366px laptop')
{
  const { ctx, page } = await newPage(browser, { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })
  await page.goto(BASE + '/pos'); await page.waitForSelector('[data-testid=product-card]')
  const o = await overflow(page); assert(o.sw <= o.cw, `no horizontal overflow at 1366 (${o.sw}/${o.cw})`)
  const cards = page.locator('[data-testid=product-card]')
  for (let i = 0; i < 4; i++) await cards.nth(i).click()
  await page.click('text=★ Top'); await page.waitForTimeout(200)
  assert((await cards.count()) > 0, '★ Top chip lists best sellers')
  await page.screenshot({ path: `${OUT}/pos-1366.png` })
  await page.click('[data-testid=sidebar-toggle]'); await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/pos-1366-expanded.png` })
  await ctx.close()
}

// ---------------------------------------------------------------- 3. mobile (Pixel 7)
console.log('▶ mobile')
{
  const { ctx, page } = await newPage(browser, { ...devices['Pixel 7'] })
  await page.goto(BASE + '/pos'); await page.waitForSelector('[data-testid=product-card]')
  const o = await overflow(page); assert(o.sw <= o.cw, `no horizontal overflow on mobile (${o.sw}/${o.cw})`)
  const cards = page.locator('[data-testid=product-card]')
  await cards.nth(0).click(); await cards.nth(1).click()
  await page.screenshot({ path: `${OUT}/pos-mobile.png` })
  await page.click('text=tap to review'); await page.waitForSelector('[role=dialog] [data-testid=act-discount]')
  await page.click('[role=dialog] [data-testid=act-discount]'); await page.click('[role=dialog]:has-text("Discount") button:text-is("10%")'); await page.click('[data-testid=apply-discount]')
  assert((await page.locator('[role=dialog] :text("Discount · 10%")').count()) === 1, 'mobile sheet: 10% discount applied with auto label')
  await page.screenshot({ path: `${OUT}/pos-mobile-cart.png` })
  await ctx.close()
}

// ---------------------------------------------------------------- 4. cloud DB without the 2.3 migration → sync keeps working, one warning
console.log('▶ missing sale_returns table')
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'en-PH', timezoneId: 'Asia/Manila', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.request().url().includes('/user') ? session(OWNER).user : session(OWNER)) }))
  await page.route('**/rest/v1/**', (r) => {
    const p = new URL(r.request().url()).pathname.split('/rest/v1/')[1]
    const j = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    if (p === 'rpc/my_bootstrap') return j({ profile: { id: OWNER.id, email: OWNER.email, full_name: OWNER.full_name, is_admin: false }, store: storeRow(S1), role: 'owner', stores: [{ id: S1.id, name: S1.name, role: 'owner' }], members: [], plans: PLANS })
    if (p.startsWith('sale_returns')) return j({ code: 'PGRST205', details: null, hint: null, message: "Could not find the table 'public.sale_returns' in the schema cache" }, 404)
    return j([])
  })
  await page.goto(BASE + '/auth'); await page.fill('input[type=email]', OWNER.email); await page.fill('input[type=password]', 'secret123'); await page.click('button[type=submit]')
  await page.waitForSelector('h1:has-text("Dashboard")')
  await page.waitForSelector('text=Database update needed', { timeout: 15000 })
  assert(true, 'one-time warning shown when the cloud DB lacks sale_returns')
  await page.waitForSelector('[data-testid=sidebar] button[title^="Synced"]', { timeout: 15000 })
  assert(true, 'sync still completes for the other tables (indicator = Synced)')
  await ctx.close()
}

await browser.close()
if (errors.length) { console.log('PAGE ERRORS', errors); process.exit(1) }
console.log('ALL GOOD')
