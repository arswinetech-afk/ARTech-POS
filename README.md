# ARTech POS 2.3 — Cloudflare Pages + Supabase

Offline‑first point‑of‑sale for sari‑sari / consumer‑goods stores.
Rebuilt from the Base44 "ARTech POS" app with the same screens (Home, POS, Items,
Credits, Reports, Expenses, Alerts, Settings) plus multi‑tenant accounts,
**staff accounts with roles (owner / manager / cashier / viewer) joined by invitation
code**, subscriptions with GCash verification, and a System Administrator console.

| Layer | Tech |
| --- | --- |
| Hosting | Cloudflare Pages (static PWA, `dist/`) |
| Auth + Database | Supabase (Postgres, RLS, RPC functions) — project `ytesxqryqqecgubsipbo` |
| Front‑end | Vite · React 18 · TypeScript · Tailwind · Dexie (IndexedDB) · Workbox PWA |
| Printing | Web Bluetooth ESC/POS (58 mm / 80 mm) + system print dialog fallback |
| Scanning | Camera (ZXing) + Bluetooth/USB HID "keyboard‑wedge" scanners (cLabel, Netum, …) |

---

## 1. One‑time Supabase setup (≈ 5 minutes)

1. Open the Supabase dashboard → your project → **SQL Editor** → *New query*.
2. Paste the whole content of **`supabase/schema.sql`** and click **Run**.
   It creates every table, Row‑Level‑Security policy, trigger and RPC. It is
   idempotent — running it again later is safe.
   **Upgrading from 2.0?** Run the same file again: it adds the `store_invites` table,
   the `role` column on `store_members`, `created_by` / `cashier_name` columns and the
   invitation RPCs without touching your data (existing members become *owner*).
3. **Authentication → Providers → Email**
   * Keep *Enable email provider* on.
   * Recommended for a POS: turn **Confirm email → OFF** so new stores can sign in
     immediately. (If you leave it on, the app shows a "check your email" screen
     and the user signs in after clicking the link — both flows are supported.)
4. **Authentication → URL Configuration**
   * *Site URL*: your Pages URL, e.g. `https://artech-pos.pages.dev`
   * *Redirect URLs*: add `https://artech-pos.pages.dev/**` (and your custom domain if any).

That's all — no Edge Functions, no storage buckets, no cron jobs.

### What the schema gives you

* **Multi‑tenant isolation**: every row carries `store_id`; RLS lets a user read/write
  only stores they are a member of. Verified with cross‑tenant tests.
* **15‑day free trial** on sign‑up (`stores.trial_ends_at = now() + 15 days`).
  When it ends (`store_is_active()` = false) all writes are rejected server‑side
  (`SUBSCRIPTION_REQUIRED`) and the app shows the lock screen → Subscription page.
  Paid subscriptions get a 2‑day grace period; trials end exactly on time.
* **System Administrator**: `andy.b.rempillo@gmail.com` is flagged `is_admin`
  automatically on first sign‑up (trigger `handle_new_user`, also `ensure_my_store`).
  Admin RPCs: `admin_list_stores`, `admin_list_payments`, `admin_set_subscription`,
  `admin_review_payment`. Non‑admins get `ADMIN_ONLY` errors.
* **Business RPCs** are atomic and idempotent (safe to replay from the offline
  queue): `create_sale`, `void_sale`, `return_items` (partial refunds, 2.3), `adjust_stock`,
  `record_credit_payment`, `import_rows`, `report_summary/daily/top_products`, `my_bootstrap`.
* **Plans** live in the `plans` table (editable from the Admin console):
  Monthly ₱149 · 3 Months ₱399 (*Popular*) · 1 Year ₱1,299 (*Best Value*).
* **Staff & roles** (`store_members.role`, `store_invites`): `create_invite`,
  `invite_preview`, `redeem_invite`, `revoke_invite`, `list_store_members`,
  `set_member_role`, `remove_member`, `set_active_store`. Permissions are enforced by
  RLS + triggers, not just hidden in the UI (a cashier's API call to edit a product or
  void a sale fails with `NOT_ALLOWED`). Every sale/expense/payment records
  `created_by` (and `cashier_name` on the receipt).

---

## 2. Deploy to Cloudflare Pages

1. Push this folder to a Git repository (GitHub/GitLab).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings:

   | Setting | Value |
   | --- | --- |
   | Framework preset | Vite |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Node version | 20 (add env var `NODE_VERSION = 20` if needed) |

4. **Environment variables** (Production *and* Preview):

   ```
   VITE_SUPABASE_URL      = https://ytesxqryqqecgubsipbo.supabase.co
   VITE_SUPABASE_ANON_KEY = sb_publishable_muxvHlqJFvVQj8BggyEGYA_1aTCiItE
   VITE_SYSTEM_ADMIN_EMAIL= andy.b.rempillo@gmail.com
   VITE_GCASH_NUMBER      = 09302392076
   VITE_GCASH_NAME        =            # optional: registered GCash name shown to payers
   ```

5. Deploy. `public/_redirects` (SPA fallback) and `public/_headers`
   (caching / security headers) are copied into `dist` automatically.

Alternative without Git: `npm run build` then `npx wrangler pages deploy dist`
(`wrangler.toml` is included).

The publishable/anon key is safe to ship in the browser — all protection is done by
RLS and the `security definer` functions in the schema.

---

## 3. First run / migrating from the old app

1. Open the site → **Create an account** (store name, your name, email, password).
   The first sign‑up with `andy.b.rempillo@gmail.com` becomes the administrator.
2. **Settings → Import data** and upload the three Base44 exports **in this order**:
   1. `inventory-products.csv` — 790 items, barcodes, cost, price, current stock.
   2. `credits.csv` — grouped into customers (case‑insensitive); unsettled rows become
      open balances (₱18,536.43 outstanding in your export).
   3. `sales-transactions.csv` — 3,557 transactions, original transaction numbers and
      dates are kept; line items are matched to products by name.
      **Imported sales never change stock** (the product file already holds current stock).
   Re‑importing a file skips records that already exist, so it's safe to repeat.
3. **Settings → Store information**: logo (compressed to a tiny 192 px image), display
   name, address, owner, contact, VAT/TIN, staff names, receipt footer, paper width,
   receipt header preview.
4. **Printer**: POS → *Connect* (Web Bluetooth, Chrome on Android/Windows/macOS).
   On iOS or without Bluetooth use *Print via system dialog*.
5. **Scanners**: pair a Bluetooth HID scanner (cLabel etc.) in the phone's Bluetooth
   settings — no in‑app setup; scans are detected on every screen. Camera scanning is
   under the *Scan* button (continuous mode).

---

## 3b. Staff accounts (invitation codes)

One store, many phones — each person signs in with **their own account**:

| Role | Can | Cannot |
| --- | --- | --- |
| **Owner** | everything: settings, subscription, staff, items, voids & returns, reports | — |
| **Manager** | sell, items & stock, voids & returns, reports, expenses, imports, invite *cashiers/viewers* | subscription, store settings, remove the owner |
| **Cashier** | sell, print, record credit payments, add customers & expenses, reminders | edit items / see costs & profit, void / return, reports, settings |
| **Viewer** | read‑only (sales, items, credits, reports) | any change |

How to add someone (Settings → **Store Staff → Invite**):

1. Pick the role, how long the code is valid (24 h / 7 d / 30 d) and how many times it
   may be used (once / 5 / unlimited) → **Generate code**. You get an 8‑character code
   like `AB7K‑Q2ZX` plus a link `https://<your‑site>/join?code=AB7K‑Q2ZX` (Copy / Share).
2. The staff member opens the link (or the app → *Create account* → *Have an invitation
   code?*) and creates an account — they land directly in your store with that role.
   Someone who already has an account signs in and taps **Join**.
3. Codes can be cancelled any time; roles can be changed or members removed from the
   same card. A person can belong to several stores and switch from the header.
4. The owner's subscription covers every staff device; when it expires, staff see a
   "ask the owner to renew" screen and nothing is lost.

Why invitation codes rather than the owner typing the staff's e‑mail: no e‑mail delivery
to depend on, works with a phone number‑only workforce, the code is store‑ and role‑bound,
expires, can be single‑use, and the staff's account stays theirs (they can be removed
without touching their login). Passwords are never shared.

---

## 3c. Stock Replenishment & Analytics Report (PDF)

Dashboard → **Download Stock Report** creates the same A4 PDF the original app produced
(`Stock-Report-YYYY-MM-DD.pdf`): green header with store name and generation time, four
KPI cards (total products, out of stock, low stock, restock budget), the red **Out of
Stock** and amber **Low Stock (1–threshold units)** tables with *Current · Sold (30d) ·
Unit Cost · Suggested Qty · Est. Cost*, subtotal boxes, the **Estimated Restock Budget**
box (suggested qty = units sold in the last 30 days) and the **Product Analytics
Overview** — Best Sellers, Top Revenue Generators, Most Profitable and Slow Moving
products — with page numbers in the footer.

* Generated on the device from the local database, so it works **offline** and costs no
  egress. 16 pages take ≈ 0.6 s; files are ~50 KB (core PDF fonts, no images).
* Column headers repeat on continuation pages and long product names shrink/ellipsize
  instead of overflowing into the next column (both were glitches in the old report).
* On phones that support sharing files, a **Share** button next to it sends the PDF
  straight to Messenger, Drive, e‑mail or a printer app.
* Because the report contains unit costs and profit it is shown to owners, managers and
  viewers only (`see_cost` permission).

Sample: `docs/Stock-Report-sample.pdf`. The generator lives in `src/lib/stockReportPdf.ts`
(pure, unit‑testable) + `src/lib/stockReport.ts` (local data + download/share); jsPDF is
loaded lazily as its own chunk.

---

## 3d. The POS screen (2.2 — cashier‑friendly on any screen)

The selling screen was rebuilt around what a cashier actually does: tap / scan, adjust,
discount, take payment, fix mistakes. It works on phones, on phones in Chrome's
**Desktop site** mode (≈ 980 px), on tablets and on laptops.

| Area | What you get |
|---|---|
| **Focus mode** | On `/pos` the sidebar shrinks to a 68 px icon rail so items + cart get the full width (a 980 px "desktop mode" phone shows 3 item columns and the whole cart — previously the page overflowed to ~1700 px). The rail's bottom button expands it again; the choice is remembered per device. Other pages keep the full sidebar (also collapsible). |
| **Items** | Auto‑fitting grid (min 148 px cards), **★ Top** chip = best sellers of the last 30 days, category chips, stock badges (red = out, amber = low), tapping a card pops it and shows the in‑cart count. |
| **Cart** | Full item names (2 lines), unit price, −/qty/+ stepper, line total, remove. Tap a line to type a quantity (decimals for kg) — owners/managers can also **override the unit price** for that sale (list price shown struck through). |
| **Discount** | Button, not a link: % or ₱, quick chips (5–50 %, ₱5–100), presets **SC/PWD 20 %**, Suki 5 %, Promo 10 %, optional reason. The reason is printed on the receipt as `Discount (SC/PWD)` and saved in the sale note. |
| **Customer / Note** | Attach a customer from the cart (search / add on the spot; shows their outstanding balance); a free‑text note is stored with the sale and printed. |
| **Hold / resume** | Park the current cart (label defaults to the customer name), serve the next person, resume later. Held sales and the live cart are saved **per store in the browser**, so a reload, a phone lock or an accidental tap on another page never loses the sale. |
| **Clear** | Asks for confirmation and suggests Hold instead. |
| **Recent** (top right) | Last 25 sales with time, payment badge, cashier, items and today's running total. Tap a sale to reprint / share its receipt; owners and managers get **Void / refund** (full): the sale is marked void, every item's stock is restored and any unpaid credit is removed — offline‑safe through the sync queue. |
| **Keyboard** | `F2` search, `F9` charge, `F8` hold / show held sales, `Esc` clears search, `Enter` on a single match adds it. Bluetooth/USB scanners keep working everywhere on the page. |

---

## 3e. Partial returns & refunds (2.3)

Besides voiding a whole sale you can now take back **individual items**:

1. Open the sale — POS → **Recent** (↩ button or tap the sale → *Return items*), or
   Reports → Transactions.
2. Tap **+** (or *All*) on each item coming back, pick a reason (*Changed mind, Wrong
   item, Damaged / expired, Overcharged, Other*), decide whether the items go **back to
   stock** (off by default for *Damaged / expired*), and choose how to refund:
   **Cash**, **GCash**, or **Off utang** — the refund is first taken off the customer's
   unpaid credit (this sale's credit first, then older ones); anything left is handed back
   in cash.
3. Confirm → a **refund slip** (print / share / system print) shows what was returned and
   how much to hand back. The original receipt gains a *Refunded (returns)* line and a
   list of its returns; the same items can't be returned twice.

Maths: refund = Σ qty × sale price − the same share of the sale‑level discount
(e.g. a ₱31 item sold under a 20 % SC/PWD discount refunds ₱24.80). Stock and credit
changes are recorded in `stock_movements` (type `return`) and `credits`. Reports show
**Net Sales / Gross Profit / Cash Collected net of refunds**, a *Returns / Refunds* KPI
and a **Returns** tab; the Dashboard's *Today* figures are net as well. A sale that has
returns can no longer be voided (return the remaining items instead). Returns need an
owner or manager, work **offline** (queued like every other write) and sync to the new
`sale_returns` table.

**Product rankings are net of returns too** (Reports → *Top Products*, the Dashboard
*Best seller* insight, the POS *★ Top* chip and the analytics pages of the stock report):
a returned unit takes back its quantity and line revenue, and its cost is recovered only
when it went back to stock (a damaged return still costs you the item). Products whose net
quantity in the period is zero drop out of the list. Refunds count in the period they are
*recorded*. The stock report's replenishment columns use a slightly different rule on
purpose: **Sold (30d) = units sold − units returned to stock** — damaged returns still
have to be replaced, so they keep counting towards the suggested order.

**Upgrading an existing database:** run `supabase/migrations/2026-09-20_returns.sql`
once in the Supabase SQL editor (or simply re‑run `supabase/schema.sql`, which is
idempotent). Until you do, the app keeps working and shows a one‑time
*"Database update needed"* notice — returns recorded meanwhile stay queued on the device
and sync once the table exists.

---

## 3f. How the report figures are defined (2.3.2)

Sales are recognised **when they happen** (accrual) — the standard POS / bookkeeping
treatment — and money is tracked separately on a **cash basis**. Example: a ₱25,000 sale
recorded as *Credit / Utang* with ₱7,000 paid at the counter.

| Figure | Definition | Example |
|---|---|---|
| **Net Sales** (Dashboard *Today's Sales*) | Full amount of every active sale in the period, minus refunds recorded in the period. The hint says how much of it went on utang. | ₱25,000 · *₱18,000 on utang* |
| **Gross Profit** | Net Sales − cost of the items sold (cost of returned‑to‑stock items is recovered). A product without a purchase price shows 100 % margin. | ₱25,000 − cost |
| **Cash Collected** | Money actually received in the period: cash & GCash sales (tendered − change), the amount paid upfront on credit sales, plus **utang payments collected** (even for older sales), minus cash refunds. | ₱7,000 |
| **Credit / Utang** | Number of credit sales; hint = amount **added to utang** (total − paid upfront) and the amount paid upfront. | 1 · ₱18,000 added · ₱7,000 upfront |
| **Receivables** | Total unpaid utang balance right now (all time). | ₱18,000 |
| **Top Products / Best seller** | Quantity, revenue and profit per product, net of returns. | |

When the customer later pays the ₱18,000, that payment appears in **Cash Collected** on the
day it is received — it is *not* counted as a sale again. Receipts print
`Partial paid` and `Added to balance` for credit sales; the Transactions list shows the
paid / utang split on each credit sale.

---

## 4. Subscriptions & GCash flow

* Trial banner shows the days left; after day 15 the store is locked (read‑only in
  the cloud, lock screen in the app) until a plan is active.
* User taps a plan → instructions: **send the exact amount via GCash to 09302392076**
  → *I've sent the payment* → enters the 13‑digit GCash reference number (+ sender
  name/number) → request appears as *pending*.
* Admin (Settings → *Open Console*, or `/admin`) → **Payments** tab → *Review* →
  **Approve & activate** (extends `subscription_ends_at` by the plan period from today
  or from the current end date, whichever is later) or *Reject* with a note.
  The **Users** tab lists every registered store with status, item/sales counts and a
  *Subscription* editor to set plan/status/end date manually.

---

## 5. How offline & low‑egress work

* All data lives in IndexedDB (Dexie). Screens read locally → instant, works with no
  signal. Local writes go to an **outbox** and are replayed in order when online
  (`lib/sync.ts`). Sales/stock/payments are *relative* server operations, so two
  devices never overwrite each other's stock.
* **Delta pull**: each table is fetched with a keyset cursor `(updated_at, id)` — only
  changed rows travel. Background pulls run every 5 minutes while the tab is visible,
  plus on start‑up, reconnect and after focus. Local writes only push.
* Sales cache is a rolling 180‑day window; older ranges in Reports use server‑side
  aggregate RPCs (tiny payloads). Realtime channels are not used.
* Store logo is stored as a compressed data‑URL ≤ 40 KB. No Storage bucket needed.
* Session is cached, so the app opens and sells even when offline after the first login.

---

## 6. Development

```bash
npm install
cp .env.example .env        # already filled for this project
npm run dev                 # http://localhost:5173
npm run build && npm run preview
```

Project layout:

```
supabase/schema.sql   complete database (tables, RLS, triggers, RPCs, seed plans)
src/lib/              supabase client, Dexie db, sync engine, importer, printer (ESC/POS),
                      scanner (HID + camera), subscription access rules, formatting
src/store/            zustand stores: app (auth/bootstrap/store), cart, ui (toasts), sync
src/pages/            Dashboard, POS, Items, Credits, Reports, Expenses, Alerts, Settings,
                      ImportPage, Subscription, LockScreen, Admin, AuthPage, JoinPage, NoStore
src/components/       Layout (sidebar / bottom nav / store switcher), UI kit, CameraScanner,
                      Receipt, ReturnModal (partial returns + refund slip), StaffCard, InviteModal
supabase/migrations/  incremental SQL for databases created with an older schema.sql
src/lib/permissions.ts role → permission matrix shared by the UI (server enforces the same rules)
src/lib/stockReport*.ts Stock Replenishment & Analytics PDF (jsPDF, lazy-loaded)
e2e/                  headless-Chromium scripts used to verify flows against a mocked backend
                      (setup-playwright.sh installs Chromium + missing libs without root)
public/               PWA icons, _redirects, _headers
```

### Verified

* `supabase/schema.sql` executed end‑to‑end in an embedded Postgres (PGlite) with a mocked
  `auth` schema: tenant isolation, trial expiry lock, payment request while locked,
  admin activation, idempotent sales, FIFO credit payments, stock adjust/void, imports,
  keyset sync and report RPCs all pass — plus the 2.1 role suite: invite create /
  preview / redeem (single‑use, expiry, revoke), sign‑up‑with‑code trigger, cashier
  denied item edits & voids while sales succeed, manager cannot mint owner codes,
  member removal/last‑owner protection, per‑user active store.
* Full UI flows were exercised headlessly in Chromium (login → import the three real CSV
  files → cash / credit / barcode sales → receipts → credits payment → reports →
  expenses → reminders → settings → subscription + GCash → admin review), plus an
  offline sale that syncs on reconnect and a service‑worker offline reload. Staff flows
  (owner generates & revokes codes, cashier UI restrictions, two‑store switcher, join link
  → sign‑up, join from an account without a store) run against a mocked backend.
* 2.2 POS suite (`e2e/pos.e2e.mjs`): at 980 px desktop‑mode, 1366 px and Pixel 7 — no
  horizontal overflow, auto‑collapsed rail, tap/F2/barcode adds, SC/PWD preset = 20 % of
  subtotal, customer + note, hold → resume (discount kept), cart survives reload, line
  editor, checkout shows the label, receipt prints `Discount (SC/PWD)`, sale note =
  `Discount: SC/PWD · <note>`, Recent → Void & refund restores stock.
* 2.3 returns: `e2e/returns.sql.test.mjs` runs `schema.sql` twice (idempotent) + the
  migration in embedded Postgres and checks `return_items` (discount share, restock vs
  damaged, custom lines, idempotent replay, over‑return / cashier / void‑after‑return
  guards, utang deduction with cash remainder) and the net report RPCs incl. the net
  `report_top_products` ranking; `e2e/migration.sql.test.mjs` applies the migration to a
  database downgraded to the pre‑2.3 shape (old report RPC signatures included) and re‑runs
  it; `e2e/stock-report.unit.test.mjs` checks the stock‑report
  aggregation with restocked / damaged / deleted / out‑of‑window returns; the browser suite
  covers the UI flow (return sheet → slip → stock restored → receipt/Recent/Reports, Top
  Products rows re‑checked against an independent net ranking), a credit sale with a partial
  payment (receipt lines, Dashboard "on utang" hint, Cash Collected / Credit‑Utang / Net Sales
  cards and the Transactions split checked against IndexedDB) and the graceful
  "table missing" path.
