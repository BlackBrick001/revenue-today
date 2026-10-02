// Minimal Mews Connector API client (read-only use).
// Docs: https://docs.mews.com/connector-api
// Every call is a POST with ClientToken + AccessToken + Client in the JSON body.

const PUBLIC_DEMO = {
  // Public demo credentials published by Mews ("Gross pricing" demo enterprise).
  clientToken: 'E0D439EE522F44368DC78E1BFB03710C-D24FB11DBE31D4621C4817E028D9E1D',
  accessToken: 'C66EF7B239D24632943D115EDE9CB810-EA00F8FD8294692C940F6B5A8F9453D',
};

const ENV = (process.env.MEWS_ENV || 'demo').toLowerCase();
const BASE = process.env.MEWS_BASE_URL || (ENV === 'production' ? 'https://api.mews.com' : 'https://api.mews-demo.com');
const CLIENT_TOKEN = process.env.MEWS_CLIENT_TOKEN || (ENV === 'demo' ? PUBLIC_DEMO.clientToken : '');
const DEFAULT_ACCESS_TOKEN = process.env.MEWS_ACCESS_TOKEN || (ENV === 'demo' ? PUBLIC_DEMO.accessToken : '');
const CLIENT_NAME = process.env.MEWS_CLIENT_NAME || 'BlackBrick Reporting 1.0.0';

if (!CLIENT_TOKEN) console.error('Missing MEWS_CLIENT_TOKEN. Add it in Vercel > Settings > Environment Variables.');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createClient(accessToken = DEFAULT_ACCESS_TOKEN) {
  async function call(path, body = {}, attempt = 1) {
    const res = await fetch(`${BASE}/api/connector/v1/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ClientToken: CLIENT_TOKEN, AccessToken: accessToken, Client: CLIENT_NAME, ...body }),
    });

    // Rate limit: 200 requests per AccessToken per 30s (sliding window). 408 = too much data.
    if ((res.status === 429 || res.status === 408) && attempt <= 5) {
      const wait = Number(res.headers.get('Retry-After')) * 1000 || 2000 * attempt;
      await sleep(wait);
      return call(path, body, attempt + 1);
    }

    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { Message: text }; }
    if (!res.ok) {
      const err = new Error(`Mews ${path} failed (${res.status}): ${data.Message || text}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Follows Limitation.Cursor until all pages are fetched (capped for safety).
  async function getAll(path, body, listKey, { pageSize = 1000, maxPages = 100 } = {}) {
    const items = [];
    let cursor;
    for (let page = 0; page < maxPages; page++) {
      const data = await call(path, {
        ...body,
        Limitation: { Count: pageSize, ...(cursor ? { Cursor: cursor } : {}) },
      });
      const batch = data[listKey] || [];
      items.push(...batch);
      if (!data.Cursor || batch.length < pageSize) break;
      cursor = data.Cursor;
    }
    return items;
  }

  return { call, getAll };
}

// ---------- Date / time zone helpers (dates are 'YYYY-MM-DD' strings in property local time) ----------
function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - date.getTime();
}

// Local midnight of a date, as a UTC ISO string (what Mews expects for daily time units).
function localMidnightUtc(ymd, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const t = guess - tzOffsetMs(new Date(guess - tzOffsetMs(new Date(guess), tz)), tz);
  return new Date(t).toISOString();
}

const fmtCache = {};
function localYmd(dateOrIso, tz) {
  fmtCache[tz] = fmtCache[tz] || new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmtCache[tz].format(new Date(dateOrIso));
}

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

const defaultClient = createClient();

module.exports = {
  createClient,
  call: defaultClient.call,
  getAll: defaultClient.getAll,
  localMidnightUtc, localYmd, addDays, addMonths, daysInMonth,
  ENV, BASE, DEFAULT_ACCESS_TOKEN,
};
