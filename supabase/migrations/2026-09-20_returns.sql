-- ARTech POS 2.3 — partial returns / refunds of individual items
-- Run this ONCE in the Supabase SQL editor if your database was created with an
-- older schema.sql (re-running the full schema.sql is equivalent — it is idempotent).
-- Safe to run again after upgrading to 2.3.1: it also (re)defines report_summary,
-- report_daily and report_top_products so all report figures are net of returns.

-- partial returns / refunds of individual items (2.3). One row per return; the sale row keeps
-- a running refunded_total so lists can show it without a join.
alter table public.sales add column if not exists refunded_total numeric(12,2) not null default 0;
create table if not exists public.sale_returns (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores(id) on delete cascade,
  sale_id         uuid not null references public.sales(id) on delete cascade,
  sale_txn_no     text,
  ret_no          text not null,                          -- printed on the refund slip
  items           jsonb not null default '[]'::jsonb,     -- [{line,product_id,name,qty,price,cost,unit,restock}]
  gross           numeric(12,2) not null default 0,       -- Σ qty × sale price
  discount_share  numeric(12,2) not null default 0,       -- prorated part of the sale-level discount
  refund_total    numeric(12,2) not null default 0,       -- gross − discount_share (what the customer gets back)
  cost_total      numeric(12,2) not null default 0,       -- Σ qty × cost
  restock_cost    numeric(12,2) not null default 0,       -- cost of the items that went back to stock
  refund_method   text not null default 'cash',           -- cash | gcash | credit (deducted from utang)
  refund_credit   numeric(12,2) not null default 0,       -- part applied to the customer's unpaid credit
  refund_cash     numeric(12,2) not null default 0,       -- part handed back in cash / GCash
  reason          text,
  customer_id     uuid,
  customer_name   text,
  created_by      uuid,
  cashier_name    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists sale_returns_sync_idx on public.sale_returns(store_id, updated_at, id);
create index if not exists sale_returns_sale_idx on public.sale_returns(store_id, sale_id);

-- row-level security + updated_at/created_by trigger, same rules as sales (owner/manager write, members read)
alter table public.sale_returns enable row level security;
drop policy if exists sale_returns_select on public.sale_returns;
drop policy if exists sale_returns_insert on public.sale_returns;
drop policy if exists sale_returns_update on public.sale_returns;
drop policy if exists sale_returns_delete on public.sale_returns;
create policy sale_returns_select on public.sale_returns for select using (public.is_member(store_id) or public.is_admin());
create policy sale_returns_insert on public.sale_returns for insert with check (public.can_write_as(store_id, array['owner','manager']::text[]));
create policy sale_returns_update on public.sale_returns for update using (public.is_member(store_id) or public.is_admin()) with check (public.can_write_as(store_id, array['owner','manager']::text[]));
create policy sale_returns_delete on public.sale_returns for delete using (public.can_write_as(store_id, array['owner','manager']::text[]));
drop trigger if exists sale_returns_touch on public.sale_returns;
create trigger sale_returns_touch before insert or update on public.sale_returns for each row execute function public.set_updated_at();
grant select, insert, update, delete on public.sale_returns to authenticated;

create or replace function public.void_sale(p_sale_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sales%rowtype; it jsonb;
begin
  select * into s from public.sales where id = p_sale_id;
  if s.id is null then raise exception 'Sale not found'; end if;
  if not public.has_role(s.store_id, array['owner','manager']) then
    raise exception 'NOT_ALLOWED' using hint = 'Only owners and managers can void sales.';
  end if;
  if not public.can_write(s.store_id) then raise exception 'SUBSCRIPTION_REQUIRED'; end if;
  if s.status = 'void' then return jsonb_build_object('id', s.id, 'already', true); end if;
  if coalesce(s.refunded_total, 0) > 0 or exists (select 1 from public.sale_returns r where r.sale_id = s.id and r.deleted_at is null) then
    raise exception 'HAS_RETURNS' using hint = 'Items of this sale were already returned. Return the remaining items instead of voiding.';
  end if;

  update public.sales set status = 'void', voided_by = auth.uid(), voided_at = now(), note = coalesce(p_reason, note) where id = p_sale_id;
  for it in select * from jsonb_array_elements(s.items) loop
    if nullif(it->>'product_id','') is not null then
      update public.products set stock = stock + coalesce((it->>'qty')::numeric,0)
       where id = (it->>'product_id')::uuid and store_id = s.store_id;
    end if;
  end loop;
  update public.credits set deleted_at = now() where sale_id = p_sale_id and paid = 0;
  return jsonb_build_object('id', s.id);
end $$;

-- ---------------------------------------------------------------------
-- RPC: return_items — partial return / refund of individual items (2.3)
--   p = { id, store_id, sale_id, ret_no, items:[{line, qty, restock}], reason,
--         refund_method (cash|gcash|credit), created_at, cashier_name }
--   Amounts are recomputed here from the sale (never trusted from the device):
--   refund = Σ qty × sale price − the same share of the sale-level discount.
--   'credit' first reduces the unpaid credit of this sale, then the customer's
--   other open credits (oldest first); whatever is left is handed back as cash.
-- ---------------------------------------------------------------------
create or replace function public.return_items(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s        public.sales%rowtype;
  new_id   uuid := (p->>'id')::uuid;
  it       jsonb; sold jsonb; done numeric; q numeric; li int; pr numeric; co numeric; restock boolean;
  out_items jsonb := '[]'::jsonb;
  gross    numeric := 0; cost_t numeric := 0; restock_c numeric := 0; share numeric := 0; refund numeric := 0;
  method   text := coalesce(p->>'refund_method','cash');
  to_credit numeric := 0; remaining numeric; c record; pay numeric;
  who      text;
  created  timestamptz := coalesce((p->>'created_at')::timestamptz, now());
  rid      uuid;
begin
  select * into s from public.sales where id = (p->>'sale_id')::uuid;
  if s.id is null then raise exception 'Sale not found'; end if;
  if s.store_id <> (p->>'store_id')::uuid then raise exception 'Store mismatch'; end if;
  if not public.has_role(s.store_id, array['owner','manager']) then
    raise exception 'NOT_ALLOWED' using hint = 'Only owners and managers can process returns.';
  end if;
  if not public.can_write(s.store_id) then raise exception 'SUBSCRIPTION_REQUIRED' using hint = 'Your trial or subscription has ended.'; end if;
  if exists (select 1 from public.sale_returns where id = new_id) then
    return jsonb_build_object('id', new_id, 'duplicate', true);
  end if;
  if s.status <> 'active' then raise exception 'SALE_VOID' using hint = 'This sale was voided; nothing to return.'; end if;

  for it in select * from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    li := (it->>'line')::int;
    q  := round(coalesce((it->>'qty')::numeric, 0), 3);
    if q <= 0 then continue; end if;
    sold := s.items -> li;
    if sold is null then raise exception 'Unknown sale line %', li; end if;
    -- already returned on earlier returns of this sale
    select coalesce(sum((ri->>'qty')::numeric), 0) into done
      from public.sale_returns r, jsonb_array_elements(r.items) ri
     where r.sale_id = s.id and r.deleted_at is null and (ri->>'line')::int = li;
    if q > coalesce((sold->>'qty')::numeric, 0) - done + 0.0005 then
      raise exception 'RETURN_EXCEEDS' using hint = format('Only %s of %s can still be returned.', (sold->>'qty')::numeric - done, sold->>'name');
    end if;
    pr := coalesce((sold->>'price')::numeric, 0);
    co := coalesce((sold->>'cost')::numeric, 0);
    restock := coalesce((it->>'restock')::boolean, true) and nullif(sold->>'product_id','') is not null;
    gross  := gross + q * pr;
    cost_t := cost_t + q * co;
    if restock then
      restock_c := restock_c + q * co;
      update public.products set stock = stock + q where id = (sold->>'product_id')::uuid and store_id = s.store_id;
      rid := coalesce(nullif(it->>'movement_id','')::uuid, gen_random_uuid());
      insert into public.stock_movements (id, store_id, product_id, qty, type, unit_cost, note, created_by, created_at)
      values (rid, s.store_id, (sold->>'product_id')::uuid, q, 'return', co, 'Return ' || (p->>'ret_no') || ' of sale ' || s.txn_no, auth.uid(), created)
      on conflict (id) do nothing;
    end if;
    out_items := out_items || jsonb_build_object('line', li, 'product_id', nullif(sold->>'product_id',''), 'name', sold->>'name', 'unit', sold->>'unit',
                                                 'qty', q, 'price', pr, 'cost', co, 'restock', restock);
  end loop;
  if jsonb_array_length(out_items) = 0 then raise exception 'Nothing to return'; end if;

  gross := round(gross, 2);
  if s.subtotal > 0 and s.discount > 0 then share := least(gross, round(gross * s.discount / s.subtotal, 2)); end if;
  refund := round(gross - share, 2);

  -- deduct from utang first when asked (sale's own credit, then other open credits, oldest first)
  if method = 'credit' and s.customer_id is not null then
    remaining := refund;
    for c in select * from public.credits
              where store_id = s.store_id and customer_id = s.customer_id and deleted_at is null and settled = false
              order by (sale_id = s.id) desc, created_at loop
      exit when remaining <= 0;
      pay := least(remaining, c.amount - c.paid);
      if pay > 0 then
        update public.credits set amount = amount - pay, settled = (paid >= amount - pay) where id = c.id;
        remaining := remaining - pay;
      end if;
    end loop;
    to_credit := round(refund - remaining, 2);
  end if;

  select coalesce(nullif(p->>'cashier_name',''), nullif(pr2.full_name,''), split_part(pr2.email,'@',1)) into who
    from public.profiles pr2 where pr2.id = auth.uid();

  insert into public.sale_returns (id, store_id, sale_id, sale_txn_no, ret_no, items, gross, discount_share, refund_total, cost_total, restock_cost,
                                   refund_method, refund_credit, refund_cash, reason, customer_id, customer_name, created_by, cashier_name, created_at)
  values (new_id, s.store_id, s.id, s.txn_no, coalesce(p->>'ret_no', 'R-' || upper(substr(new_id::text, 1, 6))), out_items, gross, share, refund,
          round(cost_t, 2), round(restock_c, 2), method, to_credit, round(refund - to_credit, 2), nullif(p->>'reason',''),
          s.customer_id, s.customer_name, auth.uid(), who, created);
  update public.sales set refunded_total = refunded_total + refund where id = s.id;
  return jsonb_build_object('id', new_id, 'refund_total', refund, 'refund_credit', to_credit, 'refund_cash', refund - to_credit);
end $$;

-- The report RPCs are recreated from scratch: "create or replace" cannot change a
-- function's result columns, so upgrading from an older schema would otherwise fail.
-- They have no dependents, and Supabase's default privileges make them callable again.
do $$
declare r record;
begin
  for r in select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('report_summary', 'report_daily', 'report_top_products')
  loop
    execute format('drop function if exists %I.%I(%s)', r.nspname, r.proname, r.args);
  end loop;
end $$;

create or replace function public.report_summary(p_store uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gross_sales',  coalesce(sum(total)  filter (where status = 'active'), 0),
    'cost_total',   coalesce(sum(cost_total) filter (where status = 'active'), 0),
    'gross_profit', coalesce(sum(profit) filter (where status = 'active'), 0),
    'discount',     coalesce(sum(discount) filter (where status = 'active'), 0),
    'txn_count',    count(*) filter (where status = 'active'),
    'void_count',   count(*) filter (where status = 'void'),
    -- credit / utang: what was added to customers' balances (total − paid upfront) and what they paid at the counter
    'credit_sales',   coalesce(sum(total - least(coalesce(amount_paid, 0), total)) filter (where status = 'active' and payment_method = 'credit'), 0),
    'credit_count',   count(*) filter (where status = 'active' and payment_method = 'credit'),
    'credit_upfront', coalesce(sum(least(coalesce(amount_paid, 0), total)) filter (where status = 'active' and payment_method = 'credit'), 0),
    -- cash basis: money received at checkout (cash/GCash sale totals — tendered minus change — plus
    -- upfront payments on credit sales) and utang payments collected in the period
    'cash_checkout',  coalesce(sum(case when payment_method = 'credit' then least(coalesce(amount_paid, 0), total) else total end) filter (where status = 'active'), 0),
    'collections',    (select coalesce(sum(amount),0) from public.credit_payments cp where cp.store_id = p_store and cp.deleted_at is null and cp.created_at >= p_from and cp.created_at < p_to),
    'cash_collected', coalesce(sum(case when payment_method = 'credit' then least(coalesce(amount_paid, 0), total) else total end) filter (where status = 'active'), 0)
                      + (select coalesce(sum(amount),0) from public.credit_payments cp where cp.store_id = p_store and cp.deleted_at is null and cp.created_at >= p_from and cp.created_at < p_to),
    'expenses', (select coalesce(sum(amount),0) from public.expenses e
                  where e.store_id = p_store and e.deleted_at is null
                    and e.expense_date between p_from::date and p_to::date),
    -- returns / refunds recorded in the period (2.3)
    'refunds',       (select coalesce(sum(refund_total),0) from public.sale_returns r where r.store_id = p_store and r.deleted_at is null and r.created_at >= p_from and r.created_at < p_to),
    'refund_count',  (select count(*) from public.sale_returns r where r.store_id = p_store and r.deleted_at is null and r.created_at >= p_from and r.created_at < p_to),
    'refund_profit', (select coalesce(sum(refund_total - restock_cost),0) from public.sale_returns r where r.store_id = p_store and r.deleted_at is null and r.created_at >= p_from and r.created_at < p_to),
    'refund_cash',   (select coalesce(sum(refund_cash),0) from public.sale_returns r where r.store_id = p_store and r.deleted_at is null and r.created_at >= p_from and r.created_at < p_to)
  )
  from public.sales
  where store_id = p_store and (public.is_member(p_store) or public.is_admin())
    and created_at >= p_from and created_at < p_to;
$$;

create or replace function public.report_daily(p_store uuid, p_from timestamptz, p_to timestamptz, p_tz text default 'Asia/Manila')
returns table(day date, revenue numeric, profit numeric, txns bigint)
language sql stable security definer set search_path = public as $$
  -- sales minus the refunds recorded that day (2.3)
  select x.day, sum(x.revenue), sum(x.profit), sum(x.txns)::bigint
  from (
    select (created_at at time zone p_tz)::date as day, total as revenue, profit, 1 as txns
      from public.sales
     where store_id = p_store and (public.is_member(p_store) or public.is_admin())
       and status = 'active' and created_at >= p_from and created_at < p_to
    union all
    select (created_at at time zone p_tz)::date, -refund_total, -(refund_total - restock_cost), 0
      from public.sale_returns
     where store_id = p_store and (public.is_member(p_store) or public.is_admin())
       and deleted_at is null and created_at >= p_from and created_at < p_to
  ) x
  group by 1 order by 1;
$$;

create or replace function public.report_top_products(p_store uuid, p_from timestamptz, p_to timestamptz, p_limit int default 20)
returns table(name text, qty numeric, revenue numeric, profit numeric)
language sql stable security definer set search_path = public as $$
  -- net of returns recorded in the period (2.3): a returned unit takes back its qty and
  -- line revenue; its cost is recovered only when it went back to stock.
  select x.name, sum(x.qty), sum(x.revenue), sum(x.profit)
  from (
    select i->>'name' as name,
           (i->>'qty')::numeric as qty,
           (i->>'qty')::numeric * coalesce((i->>'price')::numeric,0) as revenue,
           (i->>'qty')::numeric * (coalesce((i->>'price')::numeric,0) - coalesce((i->>'cost')::numeric,0)) as profit
      from public.sales s, jsonb_array_elements(s.items) i
     where s.store_id = p_store and (public.is_member(p_store) or public.is_admin())
       and s.status = 'active' and s.created_at >= p_from and s.created_at < p_to
    union all
    select ri->>'name',
           -(ri->>'qty')::numeric,
           -(ri->>'qty')::numeric * coalesce((ri->>'price')::numeric,0),
           -((ri->>'qty')::numeric * coalesce((ri->>'price')::numeric,0)
             - case when coalesce((ri->>'restock')::boolean, true)
                    then (ri->>'qty')::numeric * coalesce((ri->>'cost')::numeric,0) else 0 end)
      from public.sale_returns r, jsonb_array_elements(r.items) ri
     where r.store_id = p_store and (public.is_member(p_store) or public.is_admin())
       and r.deleted_at is null and r.created_at >= p_from and r.created_at < p_to
  ) x
  group by 1
  having sum(x.qty) > 0
  order by 3 desc, 2 desc, 1 limit p_limit;
$$;

grant execute on function public.return_items(jsonb) to authenticated;
grant execute on function public.report_summary(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.report_daily(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.report_top_products(uuid, timestamptz, timestamptz, int) to authenticated;

-- make the API layer (PostgREST) pick up the new table / functions right away
notify pgrst, 'reload schema';
