# Revenue Today (Mews + Vercel + Supabase)

A website version of the Daily Dash that reads live data from the Mews API. It runs on the **Mews demo account** until you add production tokens.

- **GitHub** holds the code.
- **Vercel** hosts the website and the small server functions that call Mews (so tokens stay secret).
- **Supabase** stores the nightly on-the-books snapshot (for pick-up / loss), your targets, and a 10-minute cache.

## Setup

### 1. GitHub

1. Go to github.com → **New repository** → name it `revenue-today` → Private → Create.
2. Click **uploading an existing file**, drag in everything from this folder (keep the `api`, `lib`, `public` and `supabase` folders), and commit.

### 2. Supabase

1. Create a new project at supabase.com.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and click **Run**.
3. Open **Settings → API** and copy two values: the **Project URL** and the **service_role** key.

### 3. Vercel

1. In your new Vercel account, click **Add New → Project** and import the `revenue-today` GitHub repo. Leave the framework as "Other".
2. Before deploying, add these **Environment Variables**:

| Name | Value |
|---|---|
| `MEWS_ENV` | `demo` |
| `SUPABASE_URL` | Project URL from Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key from Supabase |
| `APP_PASSWORD` | optional for demo; a password to open the data (any username) |

3. Click **Deploy** and open the URL Vercel gives you.

The first load fetches from Mews and can take up to a minute. After that it is served from the cache, and **Refresh from Mews** forces a new fetch.

## How pick-up works

Vercel runs `/api/cron` once a night (21:00 UTC, about 23:00 in South Africa) and saves that day's on-the-books revenue to Supabase. The dashboard compares the live figure with the most recent earlier snapshot. On day one pick-up shows "—".

## Going live with BlackBrick later

Change or add these environment variables in Vercel, then redeploy:

| Name | Value |
|---|---|
| `MEWS_ENV` | `production` |
| `MEWS_CLIENT_TOKEN` | ClientToken from Mews |
| `PROPERTIES` | `[{"name":"Sandton 1","accessToken":"..."},{"name":"Sandton 2","accessToken":"..."}, ...]` |
| `APP_PASSWORD` | required, so guest and revenue data isn't public |
| `REVENUE_BASIS` | `net` (excl. VAT, default) or `gross` |

With one portfolio token, use the same `accessToken` in each entry and add `"enterpriseId":"..."`.

With five properties the fetch is heavier. If it times out on Vercel's free plan, raise `maxDuration` in `vercel.json` (needs the Pro plan above 60 seconds).

## How each number is calculated

| Dashboard line | Source in Mews |
|---|---|
| Room revenue | Order items whose accounting category is **Accommodation**, by night consumed. Excludes cancellation fees, deposits and city tax. |
| Rooms sold | Reservations with a room-night item on that night |
| AUM / OOO | Service availability: active units / out-of-order units |
| Occ% / ADR / RevPAR | Rooms sold ÷ AUM; revenue ÷ rooms sold; revenue ÷ AUM |
| F&B | Order items whose accounting category is **Food & Beverage** |
| Same Time last year | Revenue that was on the books at this moment one year ago |
| Targets | Click **Edit** on the Target row; saved per month in Supabase |

## Files

- `public/index.html`: the dashboard page
- `api/dashboard.js`, `api/targets.js`, `api/cron.js`: Vercel functions
- `lib/mews.js`: Mews API client; `lib/dashboard.js`: calculations; `lib/store.js`: Supabase storage
- `supabase/schema.sql`: the one table to create
- `vercel.json`: function timeout and the nightly schedule
