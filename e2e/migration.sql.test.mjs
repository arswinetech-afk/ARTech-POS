// Upgrade-path test: a database created with the pre-2.3 schema (no sale_returns table, no
// sales.refunded_total, no return_items RPC, report RPCs with *older result columns*) must accept
// supabase/migrations/2026-09-20_returns.sql in one go. Simulated by applying the current schema.sql
// and then removing / downgrading the 2.3 pieces before running the migration.
// Run:  (cd /tmp/pg && npm i @electric-sql/pglite@0.2.17 && node /home/user/artech-pos/e2e/migration.sql.test.mjs)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const schema = readFileSync(ROOT + 'supabase/schema.sql', 'utf8').replace(/create extension if not exists pgcrypto;/g, '')
const migration = readFileSync(ROOT + 'supabase/migrations/2026-09-20_returns.sql', 'utf8')
const pg = new PGlite()
let failed = 0
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failed++; console.log('  ✗', msg) } }
const q = async (sql, params) => (await pg.query(sql, params)).rows

await pg.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
           if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; end $$;
`)
console.log('▶ current schema.sql, then downgrade to the pre-2.3 shape')
await pg.exec(schema)
await pg.exec(`
  drop table public.sale_returns cascade;
  alter table public.sales drop column refunded_total;
  drop function public.return_items(jsonb);
  -- older report RPCs with different result columns / parameter lists
  drop function public.report_daily(uuid, timestamptz, timestamptz, text);
  create function public.report_daily(p_store uuid, p_from timestamptz, p_to timestamptz)
  returns table(day date, revenue numeric, profit numeric) language sql stable as $$ select null::date, 0::numeric, 0::numeric where false $$;
  drop function public.report_top_products(uuid, timestamptz, timestamptz, int);
  create function public.report_top_products(p_store uuid, p_from timestamptz, p_to timestamptz, p_limit int default 20)
  returns table(name text, qty numeric, revenue numeric) language sql stable as $$ select null::text, 0::numeric, 0::numeric where false $$;
  -- old void_sale without the returns guard (same signature as today)
  create or replace function public.void_sale(p_sale_id uuid, p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$ begin return '{}'::jsonb; end $$;
`)
const before = await q(`select to_regclass('public.sale_returns') as t, (select count(*) from information_schema.columns where table_name = 'sales' and column_name = 'refunded_total') as col, to_regprocedure('public.return_items(jsonb)') as fn`)
ok(before[0].t === null && +before[0].col === 0 && before[0].fn === null, 'pre-2.3 state: no sale_returns, no refunded_total, no return_items')

console.log('▶ apply the migration')
let err = null
try { await pg.exec(migration) } catch (e) { err = e }
ok(!err, err ? `migration failed: ${err.message}` : 'migration applied without errors')

console.log('▶ verify')
const after = await q(`select to_regclass('public.sale_returns') as t, (select count(*) from information_schema.columns where table_name = 'sales' and column_name = 'refunded_total') as col, to_regprocedure('public.return_items(jsonb)') as fn`)
ok(after[0].t !== null && +after[0].col === 1 && after[0].fn !== null, 'sale_returns table, sales.refunded_total and return_items() now exist')
const fns = await q(`select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as res from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('report_summary','report_daily','report_top_products') order by 1`)
ok(fns.length === 3, `exactly one overload of each report RPC remains (${fns.map((f) => f.proname).join(', ')})`)
ok(fns.find((f) => f.proname === 'report_daily')?.res.includes('txns bigint') && fns.find((f) => f.proname === 'report_top_products')?.res.includes('profit numeric'), 'report RPCs have the 2.3 result columns')
const priv = await q(`select has_function_privilege('authenticated', 'public.report_daily(uuid,timestamptz,timestamptz,text)', 'execute') as d, has_function_privilege('authenticated', 'public.report_top_products(uuid,timestamptz,timestamptz,int)', 'execute') as t, has_function_privilege('authenticated', 'public.return_items(jsonb)', 'execute') as r`)
ok(priv[0].d && priv[0].t && priv[0].r, 'authenticated can execute the recreated RPCs')
const pol = await q(`select count(*)::int as n from pg_policies where tablename = 'sale_returns'`)
ok(pol[0].n === 4, 'RLS policies created on sale_returns')

// smoke: a sale, a return, the net reports — through the migrated objects
const OWNER = '00000000-0000-4000-8000-000000000001'
await pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${OWNER}', 'bella@example.com', '{"full_name":"Bella Cruz","store_name":"Bella Store"}')`)
const [{ id: STORE }] = await q(`select id from public.stores where owner_id = $1`, [OWNER])
await pg.exec(`select set_config('request.jwt.claim.sub', '${OWNER}', false), set_config('request.jwt.claim.role', 'authenticated', false)`)
const P1 = '20000000-0000-4000-8000-000000000001', S1 = '40000000-0000-4000-8000-000000000001'
await pg.exec(`insert into public.products (id, store_id, name, cost, price, stock, unit) values ('${P1}', '${STORE}', 'Sardines', 20, 31, 10, 'pcs')`)
await q(`select public.create_sale($1::jsonb)`, [JSON.stringify({ id: S1, store_id: STORE, txn_no: 'T1', items: [{ product_id: P1, name: 'Sardines', qty: 2, price: 31, cost: 20 }], subtotal: 62, discount: 0, total: 62, cost_total: 40, profit: 22, payment_method: 'cash', amount_paid: 62, change_due: 0 })])
const [{ return_items: r }] = await q(`select public.return_items($1::jsonb)`, [JSON.stringify({ id: '50000000-0000-4000-8000-000000000001', store_id: STORE, sale_id: S1, ret_no: 'R-1', items: [{ line: 0, qty: 1 }], refund_method: 'cash' })])
ok(+r.refund_total === 31, `return_items works after the upgrade (refund ${r.refund_total})`)
const [sum] = await q(`select public.report_summary($1::uuid, now() - interval '1 day', now() + interval '1 day') as s`, [STORE])
ok(+sum.s.refunds === 31 && +sum.s.gross_sales === 62, `report_summary carries refunds (${sum.s.refunds}) next to gross sales (${sum.s.gross_sales})`)
const daily = await q(`select * from public.report_daily($1::uuid, now() - interval '1 day', now() + interval '1 day')`, [STORE])
ok(daily.length === 1 && +daily[0].revenue === 31 && +daily[0].txns === 1, `report_daily net revenue ${daily[0]?.revenue}, txns ${daily[0]?.txns}`)
const top = await q(`select * from public.report_top_products($1::uuid, now() - interval '1 day', now() + interval '1 day', 5)`, [STORE])
ok(top.length === 1 && +top[0].qty === 1 && +top[0].revenue === 31 && +top[0].profit === 11, `report_top_products net: ${JSON.stringify(top[0])}`)
let voidErr = null
try { await q(`select public.void_sale($1::uuid)`, [S1]) } catch (e) { voidErr = e }
ok(voidErr && String(voidErr.message).includes('HAS_RETURNS'), 'void_sale now refuses a sale with returns')

console.log('▶ running the migration a second time is harmless')
err = null
try { await pg.exec(migration) } catch (e) { err = e }
ok(!err, err ? `second run failed: ${err.message}` : 'second run ok (idempotent)')

console.log(failed ? `\n${failed} FAILED` : '\nALL MIGRATION TESTS PASSED')
process.exit(failed ? 1 : 0)
