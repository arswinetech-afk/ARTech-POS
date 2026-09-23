// SQL test for the 2.3 returns feature: runs supabase/schema.sql in an embedded Postgres (PGlite)
// with a mocked auth schema, then exercises return_items / void_sale / report RPCs.
// Run:  (cd /tmp/pg && npm i @electric-sql/pglite@0.2.17 && node /home/user/artech-pos/e2e/returns.sql.test.mjs)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const schema = readFileSync(ROOT + 'supabase/schema.sql', 'utf8').replace(/create extension if not exists pgcrypto;/g, '')
const migration = readFileSync(ROOT + 'supabase/migrations/2026-09-20_returns.sql', 'utf8')
const pg = new PGlite()
let failed = 0
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failed++; console.log('  ✗', msg) } }
const q = async (sql, params) => (await pg.query(sql, params)).rows
const expectError = async (fn, code, msg) => { try { await fn(); ok(false, msg + ' (no error thrown)') } catch (e) { ok(String(e.message).includes(code), `${msg} → ${String(e.message).split('\n')[0]}`) } }

// --- mock Supabase auth
await pg.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
           if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; end $$;
`)
console.log('▶ schema.sql (fresh)'); await pg.exec(schema); ok(true, 'schema.sql applied')
console.log('▶ schema.sql again (idempotent) + migration on top'); await pg.exec(schema); await pg.exec(migration); ok(true, 're-run + migration applied')

// --- users → trigger makes profile + store + owner membership
const OWNER = '00000000-0000-4000-8000-000000000001', CASHIER = '00000000-0000-4000-8000-000000000002'
await pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${OWNER}', 'bella@example.com', '{"full_name":"Bella Cruz","store_name":"Bella Store"}')`)
const [{ id: STORE }] = await q(`select id from public.stores where owner_id = $1`, [OWNER])
await pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${CASHIER}', 'cash@example.com', '{"full_name":"Cash Ier"}')`)
await pg.exec(`delete from public.store_members where user_id = '${CASHIER}'; insert into public.store_members (store_id, user_id, role) values ('${STORE}', '${CASHIER}', 'cashier')`)
const as = async (uid) => { await pg.exec(`select set_config('request.jwt.claim.sub', '${uid}', false), set_config('request.jwt.claim.role', 'authenticated', false)`) }
await as(OWNER)

const P1 = '20000000-0000-4000-8000-000000000001', P2 = '20000000-0000-4000-8000-000000000002', CUST = '30000000-0000-4000-8000-000000000001'
await pg.exec(`insert into public.products (id, store_id, name, cost, price, stock, unit) values ('${P1}', '${STORE}', 'Sardines', 20, 31, 10, 'pcs'), ('${P2}', '${STORE}', 'Coffee 3in1', 5, 8, 50, 'pcs')`)
await pg.exec(`insert into public.customers (id, store_id, name) values ('${CUST}', '${STORE}', 'Mang Tonyo')`)

// --- sale 1: cash, 20% discount  (2×31 + 5×8 = 102, discount 20.40 → total 81.60)
const S1 = '40000000-0000-4000-8000-000000000001'
await q(`select public.create_sale($1::jsonb)`, [JSON.stringify({ id: S1, store_id: STORE, txn_no: 'T1', items: [{ product_id: P1, name: 'Sardines', qty: 2, price: 31, cost: 20, unit: 'pcs' }, { product_id: P2, name: 'Coffee 3in1', qty: 5, price: 8, cost: 5, unit: 'pcs' }, { product_id: null, name: 'Load 50', qty: 1, price: 0, cost: 0 }], subtotal: 102, discount: 20.4, total: 81.6, cost_total: 65, profit: 16.6, payment_method: 'cash', amount_paid: 100, change_due: 18.4 })])
let [p1] = await q(`select stock from public.products where id = $1`, [P1]); ok(+p1.stock === 8, `sale 1 deducted stock (Sardines 10 → ${p1.stock})`)

console.log('▶ return 1 Sardines from sale 1 (cash)')
const R1 = '50000000-0000-4000-8000-000000000001'
const [{ return_items: r1 }] = await q(`select public.return_items($1::jsonb)`, [JSON.stringify({ id: R1, store_id: STORE, sale_id: S1, ret_no: 'R-0001', items: [{ line: 0, qty: 1, restock: true }], reason: 'Changed mind', refund_method: 'cash', created_at: new Date().toISOString() })])
ok(+r1.refund_total === 24.8, `refund = 31 − 20% share = ${r1.refund_total} (expected 24.80)`)
;[p1] = await q(`select stock from public.products where id = $1`, [P1]); ok(+p1.stock === 9, `restocked (Sardines → ${p1.stock})`)
const mv = await q(`select qty, type, note from public.stock_movements where product_id = $1`, [P1]); ok(mv.length === 1 && mv[0].type === 'return' && +mv[0].qty === 1, `stock movement logged: ${JSON.stringify(mv[0])}`)
let [s1] = await q(`select refunded_total, status from public.sales where id = $1`, [S1]); ok(+s1.refunded_total === 24.8, `sales.refunded_total = ${s1.refunded_total}`)
const [row1] = await q(`select gross, discount_share, refund_total, cost_total, restock_cost, refund_cash, refund_credit, refund_method, cashier_name, sale_txn_no, items from public.sale_returns where id = $1`, [R1])
ok(+row1.gross === 31 && +row1.discount_share === 6.2 && +row1.cost_total === 20 && +row1.restock_cost === 20 && +row1.refund_cash === 24.8 && +row1.refund_credit === 0, `row amounts ${JSON.stringify({ gross: row1.gross, share: row1.discount_share, cost: row1.cost_total, restock: row1.restock_cost, cash: row1.refund_cash })}`)
ok(row1.cashier_name === 'Bella Cruz' && row1.sale_txn_no === 'T1' && row1.items[0].name === 'Sardines' && row1.items[0].price === 31, `row carries cashier, txn, item snapshot`)

console.log('▶ guards')
const [{ return_items: dup }] = await q(`select public.return_items($1::jsonb)`, [JSON.stringify({ id: R1, store_id: STORE, sale_id: S1, ret_no: 'R-0001', items: [{ line: 0, qty: 1 }] })])
ok(dup.duplicate === true, 'same id twice → duplicate:true (idempotent replay from the outbox)')
;[p1] = await q(`select stock from public.products where id = $1`, [P1]); ok(+p1.stock === 9, 'duplicate did not restock again')
await expectError(() => q(`select public.return_items($1::jsonb)`, [JSON.stringify({ id: '50000000-0000-4000-8000-000000000009', store_id: STORE, sale_id: S1, ret_no: 'R-X', items: [{ line: 0, qty: 2 }] })]), 'RETURN_EXCEEDS', 'returning 2 more Sardines (only 1 left) is rejected')
await expectError(() => q(`select public.void_sale($1::uuid)`, [S1]), 'HAS_RETURNS', 'voiding a sale that has returns is rejected')
await as(CASHIER)
await expectError(() => q(`select public.return_items($1::jsonb)`, [JSON.stringify({ id: '50000000-0000-4000-8000-000000000008', store_id: STORE, sale_id: S1, ret_no: 'R-Y', items: [{ line: 1, qty: 1 }] })]), 'NOT_ALLOWED', 'cashier cannot process returns')
await as(OWNER)

console.log('▶ return without restock (damaged) + custom line')
const R2 = '50000000-0000-4000-8000-000000000002'
const [{ return_items: r2 }] = await q(`select public.return_items($1::jsonb)`, [JSON.stringify({ id: R2, store_id: STORE, sale_id: S1, ret_no: 'R-0002', items: [{ line: 1, qty: 2, restock: false }, { line: 2, qty: 1 }], reason: 'Damaged', refund_method: 'gcash' })])
ok(+r2.refund_total === 12.8, `2 coffee (16) − 20% = ${r2.refund_total}`)
const [p2] = await q(`select stock from public.products where id = $1`, [P2]); ok(+p2.stock === 45, `damaged items NOT restocked (Coffee stays ${p2.stock})`)
const [row2] = await q(`select restock_cost, cost_total, items from public.sale_returns where id = $1`, [R2]); ok(+row2.restock_cost === 0 && +row2.cost_total === 10 && row2.items.length === 2 && row2.items[1].restock === false, `restock_cost 0, cost 10, custom line accepted`)
;[s1] = await q(`select refunded_total from public.sales where id = $1`, [S1]); ok(+s1.refunded_total === 37.6, `refunded_total accumulates: ${s1.refunded_total}`)

console.log('▶ credit sale → refund deducted from utang')
const S2 = '40000000-0000-4000-8000-000000000002', C2 = '60000000-0000-4000-8000-000000000002'
await q(`select public.create_sale($1::jsonb)`, [JSON.stringify({ id: S2, store_id: STORE, txn_no: 'T2', items: [{ product_id: P1, name: 'Sardines', qty: 3, price: 31, cost: 20, unit: 'pcs' }], subtotal: 93, discount: 0, total: 93, cost_total: 60, profit: 33, payment_method: 'credit', amount_paid: 13, customer_id: CUST, customer_name: 'Mang Tonyo', credit_id: C2 })])
let [c2] = await q(`select amount, paid, settled from public.credits where id = $1`, [C2]); ok(+c2.amount === 80, `credit created for the unpaid part (${c2.amount})`)
const R3 = '50000000-0000-4000-8000-000000000003'
const [{ return_items: r3 }] = await q(`select public.return_items($1::jsonb)`, [JSON.stringify({ id: R3, store_id: STORE, sale_id: S2, ret_no: 'R-0003', items: [{ line: 0, qty: 3 }], refund_method: 'credit' })])
ok(+r3.refund_total === 93 && +r3.refund_credit === 80 && +r3.refund_cash === 13, `93 refund → 80 off the utang + 13 cash back: ${JSON.stringify(r3)}`)
;[c2] = await q(`select amount, paid, settled from public.credits where id = $1`, [C2]); ok(+c2.amount === 0 && c2.settled === true, `credit reduced to ${c2.amount} and settled`)
;[p1] = await q(`select stock from public.products where id = $1`, [P1]); ok(+p1.stock === 9, `stock back to ${p1.stock} after full return of sale 2`)

console.log('▶ reports')
const [{ report_summary: sum }] = await q(`select public.report_summary($1::uuid, now() - interval '1 day', now() + interval '1 day')`, [STORE])
ok(+sum.refunds === 130.6 && +sum.refund_count === 3, `report_summary refunds ${sum.refunds} in ${sum.refund_count} returns (24.80 + 12.80 + 93)`)
ok(Math.abs(+sum.refund_profit - (130.6 - 20 - 60)) < 0.001, `refund_profit = refunds − restocked cost = ${sum.refund_profit}`)
ok(+sum.refund_cash === 24.8 + 12.8 + 13, `refund_cash = ${sum.refund_cash}`)
// cash basis (2.3.2): cash sale counts its total (81.60, not the ₱100 tendered), the credit sale its ₱13 upfront;
// utang added = 93 − 13; nothing collected on utang yet
ok(+sum.cash_checkout === 94.6 && +sum.collections === 0 && +sum.cash_collected === 94.6, `cash_checkout ${sum.cash_checkout} (81.60 + 13 upfront), collections ${sum.collections}, cash_collected ${sum.cash_collected}`)
ok(+sum.credit_sales === 80 && +sum.credit_upfront === 13 && +sum.credit_count === 1, `credit_sales = utang added ${sum.credit_sales} (93 − 13 upfront ${sum.credit_upfront})`)
const daily = await q(`select * from public.report_daily($1::uuid, now() - interval '1 day', now() + interval '1 day')`, [STORE])
ok(daily.length === 1 && Math.abs(+daily[0].revenue - (81.6 + 93 - 130.6)) < 0.001 && +daily[0].txns === 2, `report_daily net revenue ${daily[0]?.revenue} (81.60 + 93 − 130.60), txns ${daily[0]?.txns}`)

const top = await q(`select * from public.report_top_products($1::uuid, now() - interval '1 day', now() + interval '1 day', 10)`, [STORE])
ok(top.length === 2 && top[0].name === 'Sardines' && +top[0].qty === 1 && +top[0].revenue === 31 && +top[0].profit === 11, `report_top_products net: Sardines 5 sold − 4 returned → ${JSON.stringify(top[0])} (qty 1, revenue 31, profit 11)`)
ok(top[1]?.name === 'Coffee 3in1' && +top[1].qty === 3 && +top[1].revenue === 24 && +top[1].profit === -1, `Coffee 5 sold − 2 damaged (cost not recovered) → ${JSON.stringify(top[1])} (qty 3, revenue 24, profit −1)`)
ok(!top.some((t) => t.name === 'Load 50'), 'fully returned custom line (net qty 0) is not listed')

console.log('▶ utang payment collected later → Cash Collected, not Net Sales')
const S3 = '40000000-0000-4000-8000-000000000003', C3 = '60000000-0000-4000-8000-000000000003'
await q(`select public.create_sale($1::jsonb)`, [JSON.stringify({ id: S3, store_id: STORE, txn_no: 'T3', items: [{ product_id: P1, name: 'Sardines', qty: 1, price: 31, cost: 20, unit: 'pcs' }], subtotal: 31, discount: 0, total: 31, cost_total: 20, profit: 11, payment_method: 'credit', amount_paid: 0, customer_id: CUST, customer_name: 'Mang Tonyo', credit_id: C3 })])
const [{ record_credit_payment: pay }] = await q(`select public.record_credit_payment($1::jsonb)`, [JSON.stringify({ id: '70000000-0000-4000-8000-000000000001', store_id: STORE, customer_id: CUST, amount: 20, method: 'gcash' })])
ok(pay.ok === true && +pay.unallocated === 0, `₱20 utang payment applied (${JSON.stringify(pay)})`)
const [{ report_summary: sum2 }] = await q(`select public.report_summary($1::uuid, now() - interval '1 day', now() + interval '1 day')`, [STORE])
ok(+sum2.gross_sales === 81.6 + 93 + 31 && +sum2.collections === 20 && Math.abs(+sum2.cash_collected - 114.6) < 0.001, `gross_sales ${sum2.gross_sales} unchanged by the payment; collections ${sum2.collections}; cash_collected ${sum2.cash_collected} (94.60 + 20)`)
ok(+sum2.credit_sales === 111 && +sum2.credit_count === 2, `credit_sales ${sum2.credit_sales} (80 + 31 all on utang)`)

console.log('▶ sync pull shape')
const pull = await q(`select id, updated_at, deleted_at from public.sale_returns where store_id = $1 order by updated_at, id`, [STORE]); ok(pull.length === 3 && pull.every((r) => r.updated_at), 'sale_returns rows have updated_at for keyset sync')
const pol = await q(`select policyname from pg_policies where tablename = 'sale_returns' order by 1`); ok(pol.length === 4, `RLS policies on sale_returns: ${pol.map((p) => p.policyname).join(', ')}`)

console.log(failed ? `\n${failed} FAILED` : '\nALL SQL TESTS PASSED')
process.exit(failed ? 1 : 0)
