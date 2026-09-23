-- =====================================================================
--  ARTech POS  ·  Supabase schema  (run once in SQL Editor)
--  Project: https://ytesxqryqqecgubsipbo.supabase.co
--
--  Design goals
--    • Multi-tenant: every business row carries store_id, isolated by RLS
--    • Offline-first sync: every table has updated_at + soft delete (deleted_at)
--      so clients pull only deltas (tiny egress) with keyset pagination
--    • Stock changes are RELATIVE (rpc) so several devices never overwrite
--      each other; sale items live in one JSONB column (1 row per sale)
--    • Subscription/trial enforced server-side (can_write) + client-side
--    • System administrator = andy.b.rempillo@gmail.com (auto-flagged)
--    • Staff: owner / manager / cashier / viewer per store, joined through
--      short invitation codes (store_invites); every sale records who made it
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- PROFILES  (1 row per auth user)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  full_name   text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.profiles add column if not exists active_store_id uuid;   -- last store opened (multi-store staff)

-- ---------------------------------------------------------------------
-- PLANS (editable by the system admin from the Admin page)
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  id           text primary key,          -- monthly | quarterly | yearly
  name         text not null,
  price        numeric(10,2) not null,
  period_days  int not null,
  description  text,
  features     jsonb not null default '[]'::jsonb,
  badge        text,
  is_active    boolean not null default true,
  sort         int not null default 0
);

insert into public.plans (id, name, price, period_days, description, features, badge, sort) values
 ('monthly',   'Monthly',  149,  30, 'Full access, cancel anytime',
   '["Unlimited products & sales","Works offline + cloud sync","Credits / utang tracking","Bluetooth printer & scanner","Reports & smart insights"]', null, 1),
 ('quarterly', '3 Months', 399,  90, 'Save ₱48 vs monthly (₱133/mo)',
   '["Everything in Monthly","Priority support via Messenger","Save ₱48"]', 'Popular', 2),
 ('yearly',    '1 Year',  1299, 365, 'Only ₱108/month — save 27%',
   '["Everything in Monthly","2 months FREE","Priority support","Early access to new features"]', 'Best Value', 3)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- STORES  (tenant)  +  MEMBERS (owner / staff)
-- ---------------------------------------------------------------------
create table if not exists public.stores (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references auth.users(id) on delete cascade,
  name                  text not null default 'My Store',
  address               text,
  owner_name            text,
  contact               text,
  tin                   text,
  logo_data             text,                       -- tiny compressed data-URL (<= ~20 KB)
  receipt_footer        text default 'Thank you for shopping!',
  paper_width           int  not null default 58,   -- 58 | 80 (mm)
  print_logo            boolean not null default true,
  low_stock_threshold   int  not null default 5,
  currency              text not null default 'PHP',
  settings              jsonb not null default '{}'::jsonb,
  trial_ends_at         timestamptz not null default now() + interval '15 days',
  plan_id               text references public.plans(id),
  subscription_status   text not null default 'trial',   -- trial | active | expired | suspended
  subscription_ends_at  timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.store_members (
  store_id    uuid references public.stores(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  role        text not null default 'owner',       -- owner | manager | cashier | viewer
  created_at  timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index if not exists store_members_user_idx on public.store_members(user_id);
alter table public.store_members add column if not exists invited_by uuid;    -- who created the invite that was used
alter table public.store_members add column if not exists invite_id  uuid;
alter table public.store_members drop constraint if exists store_members_role_check;
alter table public.store_members add constraint store_members_role_check check (role in ('owner','manager','cashier','viewer'));

-- Invitation codes: 8 unambiguous characters (shown as XXXX-XXXX). A code is
-- bound to ONE store and ONE role, expires, and can be single- or multi-use.
create table if not exists public.store_invites (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  code        text not null unique,
  role        text not null default 'cashier' check (role in ('owner','manager','cashier','viewer')),
  label       text,                                 -- optional note, e.g. "Jen – morning shift"
  created_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz not null default now() + interval '7 days',
  max_uses    int  not null default 1,              -- 0 = unlimited
  uses        int  not null default 0,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists store_invites_store_idx on public.store_invites(store_id, created_at desc);

-- ---------------------------------------------------------------------
-- SECURITY HELPERS  (security definer → no RLS recursion)
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.store_members where store_id = sid and user_id = auth.uid());
$$;

-- A store may WRITE while: in trial, or subscription active (2-day grace so
-- offline sales queued before expiry can still sync), or caller is admin.
create or replace function public.store_is_active(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.stores s
    where s.id = sid
      and s.subscription_status <> 'suspended'
      and ( s.trial_ends_at > now()
            or (s.subscription_status = 'active'
                and coalesce(s.subscription_ends_at, 'epoch'::timestamptz) > now() - interval '2 days') )
  );
$$;

-- Role of the caller inside a store (null when not a member)
create or replace function public.member_role(sid uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.store_members where store_id = sid and user_id = auth.uid();
$$;

create or replace function public.has_role(sid uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(public.member_role(sid) = any(roles), false);
$$;

create or replace function public.role_rank(r text) returns int
language sql immutable as $$
  select case r when 'owner' then 4 when 'manager' then 3 when 'cashier' then 2 when 'viewer' then 1 else 0 end;
$$;

-- Write permission = store active (trial/subscription) AND caller has one of the roles
create or replace function public.can_write_as(sid uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.store_is_active(sid) and public.has_role(sid, roles);
$$;

-- Generic write permission (everyone except read-only viewers)
create or replace function public.can_write(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_write_as(sid, array['owner','manager','cashier']);
$$;

-- ---------------------------------------------------------------------
-- NEW USER → profile + store (15-day trial) + owner membership
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sid   uuid;
  sname text;
  code  text := nullif(trim(new.raw_user_meta_data->>'invite_code'), '');
  res   jsonb;
begin
  insert into public.profiles (id, email, full_name, is_admin)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name',
          lower(new.email) = 'andy.b.rempillo@gmail.com')
  on conflict (id) do update set email = excluded.email;

  -- Signed up with a staff invitation code → join that store instead of
  -- creating a personal one. If the code turned out invalid the account is
  -- created without a store; the app then offers "join with a code" / "create my store".
  if code is not null then
    begin
      res := public.apply_invite(code, new.id);
    exception when others then
      res := jsonb_build_object('ok', false);
    end;
    -- whether or not it worked, do NOT create a personal store for an invited user
    return new;
  end if;

  sname := coalesce(nullif(trim(new.raw_user_meta_data->>'store_name'), ''), 'My Store');

  insert into public.stores (owner_id, name, owner_name, contact)
  values (new.id, sname, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone')
  returning id into sid;

  insert into public.store_members (store_id, user_id, role) values (sid, new.id, 'owner');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep the admin flag correct even for accounts created before this schema
update public.profiles set is_admin = true where lower(email) = 'andy.b.rempillo@gmail.com';

-- ---------------------------------------------------------------------
-- BUSINESS TABLES
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  name          text not null,
  barcode       text,
  category      text,
  cost          numeric(12,2) not null default 0,      -- purchase price
  price         numeric(12,2) not null default 0,      -- selling price
  stock         numeric(12,3) not null default 0,
  unit          text,
  description   text,
  low_stock_at  int,                                   -- null → store default
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
alter table public.products add column if not exists created_by uuid;
create index if not exists products_sync_idx    on public.products(store_id, updated_at, id);
create index if not exists products_barcode_idx on public.products(store_id, barcode);

create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  name        text not null,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
alter table public.customers add column if not exists created_by uuid;
create index if not exists customers_sync_idx on public.customers(store_id, updated_at, id);

-- one row per credit (utang) charge
create table if not exists public.credits (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete set null,
  sale_id      uuid,
  amount       numeric(12,2) not null,
  paid         numeric(12,2) not null default 0,
  settled      boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
alter table public.credits add column if not exists created_by uuid;
create index if not exists credits_sync_idx     on public.credits(store_id, updated_at, id);
create index if not exists credits_customer_idx on public.credits(store_id, customer_id);

-- payments received against a customer's balance (allocated FIFO to credits)
create table if not exists public.credit_payments (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete set null,
  amount       numeric(12,2) not null,
  method       text not null default 'cash',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
alter table public.credit_payments add column if not exists created_by uuid;
create index if not exists credit_payments_sync_idx on public.credit_payments(store_id, updated_at, id);

-- one row per sale; line items in JSONB → few rows, one request, low egress
create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores(id) on delete cascade,
  txn_no          text not null,
  items           jsonb not null default '[]'::jsonb,   -- [{product_id,name,qty,price,cost,unit}]
  subtotal        numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  total           numeric(12,2) not null,
  cost_total      numeric(12,2) not null default 0,
  profit          numeric(12,2) not null default 0,
  payment_method  text not null default 'cash',          -- cash | gcash | credit | card | other
  customer_id     uuid,
  customer_name   text,
  amount_paid     numeric(12,2),
  change_due      numeric(12,2),
  status          text not null default 'active',        -- active | void
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- who rang / voided the sale (name is denormalised so receipts keep it even if staff leave)
alter table public.sales add column if not exists cashier_name text;
alter table public.sales add column if not exists voided_by uuid;
alter table public.sales add column if not exists voided_at timestamptz;
create index if not exists sales_sync_idx  on public.sales(store_id, updated_at, id);
create index if not exists sales_date_idx  on public.sales(store_id, created_at desc);
create index if not exists sales_txn_idx  on public.sales(store_id, txn_no);

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

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  category      text,
  description   text,
  amount        numeric(12,2) not null,
  expense_date  date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
alter table public.expenses add column if not exists created_by uuid;
create index if not exists expenses_sync_idx on public.expenses(store_id, updated_at, id);

-- stock-in / adjustments (sales are NOT logged here → keeps the table small)
create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  product_id  uuid references public.products(id) on delete cascade,
  qty         numeric(12,3) not null,                 -- + in / − out
  type        text not null default 'purchase',      -- purchase | adjustment | return | import
  unit_cost   numeric(12,2),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
alter table public.stock_movements add column if not exists created_by uuid;
create index if not exists stock_movements_sync_idx on public.stock_movements(store_id, updated_at, id);

create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  title       text not null,
  note        text,
  due_at      timestamptz,
  repeat      text not null default 'none',          -- none | daily | weekly | monthly
  is_done     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
alter table public.reminders add column if not exists created_by uuid;
create index if not exists reminders_sync_idx on public.reminders(store_id, updated_at, id);

-- GCash payment submissions for subscriptions
create table if not exists public.payment_requests (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  plan_id        text references public.plans(id),
  amount         numeric(10,2),
  reference_no   text not null,
  sender_name    text,
  sender_number  text,
  status         text not null default 'pending',   -- pending | approved | rejected
  admin_note     text,
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid
);
create index if not exists payment_requests_store_idx on public.payment_requests(store_id, created_at desc);

-- ---------------------------------------------------------------------
-- updated_at is ALWAYS server time (the sync cursor depends on it)
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
declare j jsonb;
begin
  new.updated_at = now();
  -- audit: remember who created the row (tables that have a created_by column)
  if tg_op = 'INSERT' and auth.uid() is not null then
    j := to_jsonb(new);
    if (j ? 'created_by') and (j->>'created_by') is null then
      new := jsonb_populate_record(new, jsonb_build_object('created_by', auth.uid()));
    end if;
  end if;
  return new;
end $$;

-- Role matrix (who may write what). Reads: every member of the store.
--   owner    everything (+ staff, billing)
--   manager  everything except billing / owner management
--   cashier  sell, customers, credits & payments, expenses, reminders (no items/cost edits, no voids)
--   viewer   read-only
do $$
declare r record;
begin
  for r in select * from (values
      ('products',        array['owner','manager'],           array['owner','manager'],           array['owner','manager']),
      ('customers',       array['owner','manager','cashier'], array['owner','manager','cashier'], array['owner','manager']),
      ('credits',         array['owner','manager','cashier'], array['owner','manager','cashier'], array['owner','manager']),
      ('credit_payments', array['owner','manager','cashier'], array['owner','manager'],           array['owner','manager']),
      ('sales',           array['owner','manager'],           array['owner','manager'],           array['owner','manager']),
      ('expenses',        array['owner','manager','cashier'], array['owner','manager','cashier'], array['owner','manager']),
      ('stock_movements', array['owner','manager'],           array['owner','manager'],           array['owner','manager']),
      ('sale_returns',    array['owner','manager'],           array['owner','manager'],           array['owner','manager']),
      ('reminders',       array['owner','manager','cashier'], array['owner','manager','cashier'], array['owner','manager','cashier'])
    ) as v(t, ins, upd, del)
  loop
    execute format('alter table public.%I enable row level security', r.t);
    execute format('drop policy if exists %1$s_select on public.%1$I', r.t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', r.t);
    execute format('drop policy if exists %1$s_update on public.%1$I', r.t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', r.t);
    execute format('create policy %1$s_select on public.%1$I for select using (public.is_member(store_id) or public.is_admin())', r.t);
    execute format('create policy %1$s_insert on public.%1$I for insert with check (public.can_write_as(store_id, %2$L::text[]))', r.t, r.ins);
    execute format('create policy %1$s_update on public.%1$I for update using (public.is_member(store_id) or public.is_admin()) with check (public.can_write_as(store_id, %2$L::text[]))', r.t, r.upd);
    execute format('create policy %1$s_delete on public.%1$I for delete using (public.can_write_as(store_id, %2$L::text[]))', r.t, r.del);
    execute format('drop trigger if exists %1$s_touch on public.%1$I', r.t);
    execute format('create trigger %1$s_touch before insert or update on public.%1$I for each row execute function public.set_updated_at()', r.t);
  end loop;
end $$;

-- stores / members / profiles / plans / payment_requests policies
alter table public.stores           enable row level security;
alter table public.store_members    enable row level security;
alter table public.profiles         enable row level security;
alter table public.plans            enable row level security;
alter table public.payment_requests enable row level security;

drop policy if exists stores_select on public.stores;
drop policy if exists stores_update on public.stores;
create policy stores_select on public.stores for select using (public.is_member(id) or public.is_admin());
create policy stores_update on public.stores for update using (public.is_member(id) or public.is_admin()) with check (public.is_member(id) or public.is_admin());

drop policy if exists members_select on public.store_members;
create policy members_select on public.store_members for select using (user_id = auth.uid() or public.is_member(store_id) or public.is_admin());

-- invites: owners/managers can list their store's codes; all writes go through RPCs
alter table public.store_invites enable row level security;
drop policy if exists invites_select on public.store_invites;
create policy invites_select on public.store_invites for select using (public.has_role(store_id, array['owner','manager']));

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists plans_select on public.plans;
drop policy if exists plans_admin  on public.plans;
create policy plans_select on public.plans for select using (auth.role() = 'authenticated');
create policy plans_admin  on public.plans for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists pay_select on public.payment_requests;
drop policy if exists pay_insert on public.payment_requests;
drop policy if exists pay_update on public.payment_requests;
create policy pay_select on public.payment_requests for select using (public.is_member(store_id) or public.is_admin());
-- expired stores must still be able to submit a payment → is_member (NOT can_write)
create policy pay_insert on public.payment_requests for insert with check (public.is_member(store_id) and user_id = auth.uid());
create policy pay_update on public.payment_requests for update using (public.is_admin()) with check (public.is_admin());

-- store owners can edit their store settings but never their own subscription
create or replace function public.protect_store() returns trigger
language plpgsql as $$
declare r text;
begin
  -- API users (anon/authenticated) may not touch subscription fields unless admin.
  -- Dashboard / service_role sessions are always allowed.
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    new.trial_ends_at        := old.trial_ends_at;
    new.plan_id              := old.plan_id;
    new.subscription_status  := old.subscription_status;
    new.subscription_ends_at := old.subscription_ends_at;
    new.owner_id             := old.owner_id;
    r := public.member_role(old.id);
    if r is null or r = 'viewer' then
      raise exception 'NOT_ALLOWED' using hint = 'Viewers cannot change store settings.';
    elsif r = 'cashier' then
      -- cashiers may only change printer / device preferences
      new.name                := old.name;
      new.address             := old.address;
      new.owner_name          := old.owner_name;
      new.contact             := old.contact;
      new.tin                 := old.tin;
      new.logo_data           := old.logo_data;
      new.receipt_footer      := old.receipt_footer;
      new.low_stock_threshold := old.low_stock_threshold;
      new.currency            := old.currency;
    end if;
  end if;
  if new.logo_data is not null and length(new.logo_data) > 40000 then
    raise exception 'Logo too large. Please use a smaller image.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists stores_protect on public.stores;
create trigger stores_protect before update on public.stores for each row execute function public.protect_store();

create or replace function public.protect_profile() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    new.is_admin := old.is_admin;
    new.email    := old.email;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles for each row execute function public.protect_profile();

-- ---------------------------------------------------------------------
-- RPC: bootstrap (one round-trip on app start)
-- ---------------------------------------------------------------------
-- Returns the profile, the ACTIVE store (+ caller's role in it), the list of all
-- stores the caller belongs to (for the store switcher) and the plans.
create or replace function public.my_bootstrap() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); active uuid; memberships jsonb;
begin
  select active_store_id into active from public.profiles where id = uid;
  if active is null or not exists (select 1 from public.store_members where store_id = active and user_id = uid) then
    select store_id into active from public.store_members
     where user_id = uid order by (role = 'owner') desc, created_at limit 1;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role, 'owner_name', s.owner_name, 'joined_at', m.created_at)
                            order by (m.role = 'owner') desc, m.created_at), '[]'::jsonb)
    into memberships
    from public.store_members m join public.stores s on s.id = m.store_id
   where m.user_id = uid;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = uid),
    'store',   (select to_jsonb(s) from public.stores s where s.id = active),
    'role',    (select m.role from public.store_members m where m.store_id = active and m.user_id = uid),
    'stores',  memberships,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role,
                                            'name', coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)))
                                          order by public.role_rank(m.role) desc, m.created_at), '[]'::jsonb)
                  from public.store_members m join public.profiles p on p.id = m.user_id where m.store_id = active),
    'plans',   (select coalesce(jsonb_agg(to_jsonb(pl) order by pl.sort), '[]'::jsonb) from public.plans pl where pl.is_active),
    'server_time', now()
  );
end $$;

-- RPC: ensure_my_store — safety net for accounts created before the trigger
create or replace function public.ensure_my_store(p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; u record;
begin
  select store_id into sid from public.store_members where user_id = auth.uid() order by created_at limit 1;
  if sid is not null then return sid; end if;
  select id, email, raw_user_meta_data into u from auth.users where id = auth.uid();
  insert into public.profiles (id, email, full_name, is_admin)
  values (u.id, u.email, u.raw_user_meta_data->>'full_name', lower(u.email) = 'andy.b.rempillo@gmail.com')
  on conflict (id) do nothing;
  insert into public.stores (owner_id, name, owner_name)
  values (u.id, coalesce(nullif(trim(p_name),''), nullif(u.raw_user_meta_data->>'store_name',''), 'My Store'), u.raw_user_meta_data->>'full_name')
  returning id into sid;
  insert into public.store_members (store_id, user_id, role) values (sid, u.id, 'owner');
  return sid;
end $$;

-- ---------------------------------------------------------------------
-- STAFF & INVITATION CODES
-- ---------------------------------------------------------------------
create or replace function public.normalize_invite_code(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- 8 chars from an alphabet without 0/O/1/I  (32^8 ≈ 1.1 trillion combinations).
-- Randomness comes from the fully random bytes of a v4 UUID (no extension needed).
create or replace function public.gen_invite_code() returns text
language plpgsql volatile as $$
declare alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        hex text := replace(gen_random_uuid()::text, '-', '');
        pos int[] := array[0,1,2,3,4,5,7,9];   -- skip the version/variant bytes (6 and 8)
        o text := ''; i int; v int;
begin
  foreach i in array pos loop
    v := ('x' || substr(hex, i * 2 + 1, 2))::bit(8)::int;
    o := o || substr(alphabet, (v % 32) + 1, 1);
  end loop;
  return o;
end $$;

-- Internal: validate a code and add p_user to the store. Used by redeem_invite
-- (p_user = caller) and by the sign-up trigger (no JWT → auth.uid() is null).
create or replace function public.apply_invite(p_code text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.store_invites%rowtype; sname text; existing text; final_role text;
begin
  if auth.uid() is not null and auth.uid() <> p_user then raise exception 'NOT_ALLOWED'; end if;
  select * into inv from public.store_invites where code = public.normalize_invite_code(p_code) for update;
  if inv.id is null            then return jsonb_build_object('ok', false, 'reason', 'INVALID'); end if;
  if inv.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'REVOKED'); end if;
  if inv.expires_at < now()     then return jsonb_build_object('ok', false, 'reason', 'EXPIRED'); end if;
  if inv.max_uses > 0 and inv.uses >= inv.max_uses then return jsonb_build_object('ok', false, 'reason', 'USED_UP'); end if;
  select name into sname from public.stores where id = inv.store_id;

  select role into existing from public.store_members where store_id = inv.store_id and user_id = p_user;
  if existing is not null then
    -- already a member: an invite can only raise the role, never lower it
    final_role := case when public.role_rank(inv.role) > public.role_rank(existing) then inv.role else existing end;
    update public.store_members set role = final_role where store_id = inv.store_id and user_id = p_user and role <> final_role;
    update public.profiles set active_store_id = inv.store_id where id = p_user;
    return jsonb_build_object('ok', true, 'already_member', true, 'store_id', inv.store_id, 'store_name', sname, 'role', final_role);
  end if;

  insert into public.store_members (store_id, user_id, role, invited_by, invite_id)
  values (inv.store_id, p_user, inv.role, inv.created_by, inv.id);
  update public.store_invites set uses = uses + 1 where id = inv.id;
  update public.profiles set active_store_id = inv.store_id where id = p_user;
  return jsonb_build_object('ok', true, 'store_id', inv.store_id, 'store_name', sname, 'role', inv.role);
end $$;
revoke execute on function public.apply_invite(text, uuid) from public, anon;

-- Owner / admin: any role. Manager: cashier or viewer only.
create or replace function public.create_invite(p_store uuid, p_role text default 'cashier', p_expires_hours int default 168,
                                                p_max_uses int default 1, p_label text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare my_role text := coalesce(public.member_role(p_store), 'none'); inv public.store_invites%rowtype; c text; i int;
begin
  if p_role not in ('owner','manager','cashier','viewer') then raise exception 'Invalid role'; end if;
  if p_store is null or not (public.is_admin() or my_role = 'owner' or (my_role = 'manager' and p_role in ('cashier','viewer'))) then
    raise exception 'NOT_ALLOWED' using hint = 'Only the store owner (or a manager, for cashier/viewer codes) can invite staff.';
  end if;
  for i in 1..8 loop
    c := public.gen_invite_code();
    exit when not exists (select 1 from public.store_invites where code = c);
  end loop;
  insert into public.store_invites (store_id, code, role, label, created_by, expires_at, max_uses)
  values (p_store, c, p_role, nullif(trim(p_label), ''), auth.uid(),
          now() + make_interval(hours => greatest(1, least(coalesce(p_expires_hours, 168), 24 * 90))),
          greatest(0, least(coalesce(p_max_uses, 1), 100)))
  returning * into inv;
  return to_jsonb(inv);
end $$;

create or replace function public.revoke_invite(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select store_id into sid from public.store_invites where id = p_id;
  if sid is null then raise exception 'Invite not found'; end if;
  if not public.has_role(sid, array['owner','manager']) then raise exception 'NOT_ALLOWED'; end if;
  update public.store_invites set revoked_at = now() where id = p_id and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- Anyone (even before signing up) can preview what a code gives: store name + role.
create or replace function public.invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'valid', i.revoked_at is null and i.expires_at >= now() and (i.max_uses = 0 or i.uses < i.max_uses),
      'reason', case when i.revoked_at is not null then 'REVOKED' when i.expires_at < now() then 'EXPIRED'
                     when i.max_uses > 0 and i.uses >= i.max_uses then 'USED_UP' else null end,
      'store_id', s.id, 'store_name', s.name, 'role', i.role, 'expires_at', i.expires_at)
    from public.store_invites i join public.stores s on s.id = i.store_id
    where i.code = public.normalize_invite_code(p_code)
  ), jsonb_build_object('valid', false, 'reason', 'INVALID'));
$$;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- Signed-in user joins a store with a code
create or replace function public.redeem_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return public.apply_invite(p_code, auth.uid());
end $$;

create or replace function public.set_active_store(p_store uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_store) then raise exception 'NOT_ALLOWED'; end if;
  update public.profiles set active_store_id = p_store where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- Members of a store (names + roles). E-mails are only revealed to owners/managers/admin.
create or replace function public.list_store_members(p_store uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_member(p_store) or public.is_admin() then coalesce(jsonb_agg(row_to_json(x) order by x.rank desc, x.created_at), '[]'::jsonb) else '[]'::jsonb end
  from (
    select m.user_id, m.role, m.created_at, m.invited_by, public.role_rank(m.role) as rank,
           coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)) as full_name,
           case when public.has_role(p_store, array['owner','manager']) or m.user_id = auth.uid() then p.email
                else left(p.email, 2) || '***@' || split_part(p.email, '@', 2) end as email,
           (select coalesce(nullif(q.full_name,''), split_part(q.email,'@',1)) from public.profiles q where q.id = m.invited_by) as invited_by_name,
           (select count(*) from public.sales sa where sa.store_id = p_store and sa.created_by = m.user_id and sa.status = 'active') as sales_count,
           (select max(sa.created_at) from public.sales sa where sa.store_id = p_store and sa.created_by = m.user_id) as last_sale_at
    from public.store_members m
    join public.profiles p on p.id = m.user_id
    where m.store_id = p_store
  ) x;
$$;

-- Owner (or admin) changes a member's role. The last owner can never be demoted.
create or replace function public.set_member_role(p_store uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur text; owners int;
begin
  if p_role not in ('owner','manager','cashier','viewer') then raise exception 'Invalid role'; end if;
  if not public.has_role(p_store, array['owner']) then raise exception 'NOT_ALLOWED' using hint = 'Only the store owner can change roles.'; end if;
  select role into cur from public.store_members where store_id = p_store and user_id = p_user;
  if cur is null then raise exception 'Not a member'; end if;
  if cur = 'owner' and p_role <> 'owner' then
    select count(*) into owners from public.store_members where store_id = p_store and role = 'owner';
    if owners <= 1 then raise exception 'LAST_OWNER' using hint = 'A store must keep at least one owner.'; end if;
  end if;
  update public.store_members set role = p_role where store_id = p_store and user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

-- Remove a member (owner/admin: anyone; manager: cashiers & viewers; anyone: themselves).
create or replace function public.remove_member(p_store uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := coalesce(public.member_role(p_store), 'none'); target text; owners int;
begin
  select role into target from public.store_members where store_id = p_store and user_id = p_user;
  if target is null then return jsonb_build_object('ok', true, 'noop', true); end if;
  if not (public.is_admin() or me = 'owner' or (p_user = auth.uid() and me <> 'none') or (me = 'manager' and target in ('cashier','viewer'))) then
    raise exception 'NOT_ALLOWED' using hint = 'You cannot remove this member.';
  end if;
  if target = 'owner' then
    select count(*) into owners from public.store_members where store_id = p_store and role = 'owner';
    if owners <= 1 then raise exception 'LAST_OWNER' using hint = 'A store must keep at least one owner. Make someone else an owner first.'; end if;
  end if;
  delete from public.store_members where store_id = p_store and user_id = p_user;
  update public.profiles set active_store_id = null where id = p_user and active_store_id = p_store;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- RPC: create_sale — atomic insert + RELATIVE stock decrement + credit row
-- Idempotent on sale id (safe to retry from the offline outbox).
-- ---------------------------------------------------------------------
create or replace function public.create_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  sid     uuid := (p->>'store_id')::uuid;
  new_id  uuid := (p->>'id')::uuid;
  it      jsonb;
  cust    uuid := nullif(p->>'customer_id','')::uuid;
  created timestamptz := coalesce((p->>'created_at')::timestamptz, now());
  who     text;
begin
  if not public.has_role(sid, array['owner','manager','cashier']) then
    raise exception 'NOT_ALLOWED' using hint = 'Your role in this store cannot record sales.';
  end if;
  if not public.can_write(sid) then
    raise exception 'SUBSCRIPTION_REQUIRED' using hint = 'Your trial or subscription has ended.';
  end if;
  if exists (select 1 from public.sales where id = new_id) then
    return jsonb_build_object('id', new_id, 'duplicate', true);
  end if;
  -- who rang the sale: name sent by the device, else the profile of the caller
  select coalesce(nullif(p->>'cashier_name',''), nullif(pr.full_name,''), split_part(pr.email,'@',1)) into who
    from public.profiles pr where pr.id = auth.uid();

  insert into public.sales (id, store_id, txn_no, items, subtotal, discount, total, cost_total, profit,
                            payment_method, customer_id, customer_name, amount_paid, change_due, status, note, created_by, cashier_name, created_at)
  values (new_id, sid, p->>'txn_no', coalesce(p->'items','[]'::jsonb),
          coalesce((p->>'subtotal')::numeric, (p->>'total')::numeric), coalesce((p->>'discount')::numeric,0),
          (p->>'total')::numeric, coalesce((p->>'cost_total')::numeric,0), coalesce((p->>'profit')::numeric,0),
          coalesce(p->>'payment_method','cash'), cust, p->>'customer_name',
          (p->>'amount_paid')::numeric, (p->>'change_due')::numeric,
          coalesce(p->>'status','active'), p->>'note', auth.uid(), who, created);

  if coalesce((p->>'adjust_stock')::boolean, true) then
    for it in select * from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
      if nullif(it->>'product_id','') is not null then
        update public.products
           set stock = stock - coalesce((it->>'qty')::numeric, 0)
         where id = (it->>'product_id')::uuid and store_id = sid;
      end if;
    end loop;
  end if;

  if p->>'payment_method' = 'credit' and nullif(p->>'credit_id','') is not null then
    insert into public.credits (id, store_id, customer_id, sale_id, amount, notes, created_at)
    values ((p->>'credit_id')::uuid, sid, cust, new_id,
            (p->>'total')::numeric - coalesce((p->>'amount_paid')::numeric, 0),
            'Sale ' || (p->>'txn_no'), created)
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object('id', new_id);
end $$;

-- ---------------------------------------------------------------------
-- RPC: void_sale — restore stock, cancel unpaid credit
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- RPC: adjust_stock — relative change + movement log (stock-in, corrections)
-- ---------------------------------------------------------------------
create or replace function public.adjust_stock(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid := (p->>'store_id')::uuid; pid uuid := (p->>'product_id')::uuid; d numeric := (p->>'qty')::numeric;
begin
  if not public.has_role(sid, array['owner','manager']) then raise exception 'NOT_ALLOWED' using hint = 'Only owners and managers can adjust stock.'; end if;
  if not public.can_write(sid) then raise exception 'SUBSCRIPTION_REQUIRED'; end if;
  if exists (select 1 from public.stock_movements where id = (p->>'id')::uuid) then
    return jsonb_build_object('duplicate', true);
  end if;
  update public.products set stock = stock + d,
         cost = case when coalesce((p->>'update_cost')::boolean,false) and (p->>'unit_cost') is not null then (p->>'unit_cost')::numeric else cost end
   where id = pid and store_id = sid;
  insert into public.stock_movements (id, store_id, product_id, qty, type, unit_cost, note, created_by, created_at)
  values ((p->>'id')::uuid, sid, pid, d, coalesce(p->>'type','adjustment'), (p->>'unit_cost')::numeric, p->>'note', auth.uid(),
          coalesce((p->>'created_at')::timestamptz, now()));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- RPC: record_credit_payment — FIFO allocation across unpaid credits
-- ---------------------------------------------------------------------
create or replace function public.record_credit_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid := (p->>'store_id')::uuid; cid uuid := (p->>'customer_id')::uuid;
        remaining numeric := (p->>'amount')::numeric; c record; pay numeric;
begin
  if not public.can_write(sid) then raise exception 'SUBSCRIPTION_REQUIRED'; end if;
  if exists (select 1 from public.credit_payments where id = (p->>'id')::uuid) then
    return jsonb_build_object('duplicate', true);
  end if;
  insert into public.credit_payments (id, store_id, customer_id, amount, method, notes, created_by, created_at)
  values ((p->>'id')::uuid, sid, cid, remaining, coalesce(p->>'method','cash'), p->>'notes', auth.uid(),
          coalesce((p->>'created_at')::timestamptz, now()));
  for c in select * from public.credits
            where store_id = sid and customer_id = cid and deleted_at is null and settled = false
            order by created_at loop
    exit when remaining <= 0;
    pay := least(remaining, c.amount - c.paid);
    update public.credits set paid = paid + pay, settled = (paid + pay >= amount) where id = c.id;
    remaining := remaining - pay;
  end loop;
  return jsonb_build_object('ok', true, 'unallocated', remaining);
end $$;

-- ---------------------------------------------------------------------
-- RPC: bulk import (one round-trip per batch; egress ≈ 0)
-- ---------------------------------------------------------------------
create or replace function public.import_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; sid uuid;
begin
  sid := (p_rows->0->>'store_id')::uuid;
  if sid is null or not public.has_role(sid, array['owner','manager']) then raise exception 'NOT_ALLOWED' using hint = 'Only owners and managers can import data.'; end if;
  if not public.can_write(sid) then raise exception 'SUBSCRIPTION_REQUIRED'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where (r->>'store_id')::uuid <> sid) then
    raise exception 'Mixed store ids';
  end if;
  if p_table = 'products' then
    insert into public.products (id, store_id, name, barcode, category, cost, price, stock, unit, description, low_stock_at, is_active, created_at)
    select coalesce(r.id, gen_random_uuid()), r.store_id, r.name, nullif(r.barcode,''), nullif(r.category,''), coalesce(r.cost,0), coalesce(r.price,0),
           coalesce(r.stock,0), nullif(r.unit,''), nullif(r.description,''), r.low_stock_at, coalesce(r.is_active,true), coalesce(r.created_at, now())
    from jsonb_populate_recordset(null::public.products, p_rows) r
    on conflict (id) do nothing;
  elsif p_table = 'customers' then
    insert into public.customers (id, store_id, name, phone, notes, created_at)
    select coalesce(r.id, gen_random_uuid()), r.store_id, r.name, nullif(r.phone,''), nullif(r.notes,''), coalesce(r.created_at, now())
    from jsonb_populate_recordset(null::public.customers, p_rows) r
    on conflict (id) do nothing;
  elsif p_table = 'credits' then
    insert into public.credits (id, store_id, customer_id, sale_id, amount, paid, settled, notes, created_at)
    select coalesce(r.id, gen_random_uuid()), r.store_id, r.customer_id, r.sale_id, coalesce(r.amount,0), coalesce(r.paid,0),
           coalesce(r.settled,false), nullif(r.notes,''), coalesce(r.created_at, now())
    from jsonb_populate_recordset(null::public.credits, p_rows) r
    on conflict (id) do nothing;
  elsif p_table = 'sales' then
    insert into public.sales (id, store_id, txn_no, items, subtotal, discount, total, cost_total, profit, payment_method,
                              customer_id, customer_name, amount_paid, change_due, status, note, created_by, created_at)
    select coalesce(r.id, gen_random_uuid()), r.store_id, r.txn_no, coalesce(r.items,'[]'::jsonb), coalesce(r.subtotal, r.total, 0),
           coalesce(r.discount,0), coalesce(r.total,0), coalesce(r.cost_total,0), coalesce(r.profit,0), coalesce(r.payment_method,'cash'),
           r.customer_id, nullif(r.customer_name,''), r.amount_paid, r.change_due, coalesce(r.status,'active'), r.note, auth.uid(),
           coalesce(r.created_at, now())
    from jsonb_populate_recordset(null::public.sales, p_rows) r
    on conflict (id) do nothing;
  else
    raise exception 'Unsupported table %', p_table;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- RPC: server-side reports (used for ranges older than the local cache)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- ADMIN RPCs
-- ---------------------------------------------------------------------
create or replace function public.admin_list_stores() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) else '[]'::jsonb end
  from (
    select s.id, s.name, s.owner_name, s.contact, s.created_at, s.trial_ends_at, s.plan_id,
           s.subscription_status, s.subscription_ends_at,
           p.email, p.full_name, p.is_admin,
           (select count(*) from public.products pr where pr.store_id = s.id and pr.deleted_at is null) as products,
           (select count(*) from public.sales sa where sa.store_id = s.id) as sales,
           (select max(created_at) from public.sales sa where sa.store_id = s.id) as last_sale_at,
           (select count(*) from public.payment_requests q where q.store_id = s.id and q.status = 'pending') as pending_requests,
           (select count(*) from public.store_members m where m.store_id = s.id) as members
    from public.stores s
    join public.profiles p on p.id = s.owner_id
  ) x;
$$;

create or replace function public.admin_list_payments(p_status text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) else '[]'::jsonb end
  from (
    select q.*, s.name as store_name, p.email, pl.name as plan_name, pl.price as plan_price
    from public.payment_requests q
    join public.stores s on s.id = q.store_id
    join public.profiles p on p.id = s.owner_id
    left join public.plans pl on pl.id = q.plan_id
    where p_status is null or q.status = p_status
    limit 500
  ) x;
$$;

create or replace function public.admin_set_subscription(p_store uuid, p_plan text, p_status text, p_ends_at timestamptz, p_trial_ends_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  update public.stores
     set plan_id = p_plan, subscription_status = p_status, subscription_ends_at = p_ends_at,
         trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at)
   where id = p_store;
  return jsonb_build_object('ok', true);
end $$;

-- Approve = extend from max(now, current end) by the plan period.
create or replace function public.admin_review_payment(p_request uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q public.payment_requests%rowtype; pl public.plans%rowtype; base timestamptz; new_end timestamptz;
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  select * into q from public.payment_requests where id = p_request;
  if q.id is null then raise exception 'Request not found'; end if;
  if q.status <> 'pending' then raise exception 'Already reviewed'; end if;
  if p_approve then
    select * into pl from public.plans where id = q.plan_id;
    select greatest(now(), coalesce(subscription_ends_at, now())) into base from public.stores where id = q.store_id;
    new_end := base + make_interval(days => coalesce(pl.period_days, 30));
    update public.stores set plan_id = q.plan_id, subscription_status = 'active', subscription_ends_at = new_end where id = q.store_id;
  end if;
  update public.payment_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         admin_note = p_note, reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_request;
  return jsonb_build_object('ok', true, 'subscription_ends_at', new_end);
end $$;

-- ---------------------------------------------------------------------
-- grants (RLS still applies)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- Done. Next: Authentication → Providers → Email → (optional) turn OFF "Confirm email"
-- so new stores can start selling immediately.
