// Builds the "Revenue Today" dashboard data straight from the Mews Connector API.
//
// Sources per property:
//   orderItems/getAll            -> room revenue, room nights sold, F&B revenue per night
//   services/getAvailability     -> AUM (active units) and OOO (out-of-order) per night
//   accountingCategories/getAll  -> which order items are Accommodation vs Food & Beverage
// Pick-up / loss compares today's on-the-books revenue with the snapshot saved yesterday (in Supabase).

const { createClient, localMidnightUtc, localYmd, addDays, addMonths, daysInMonth, ENV, DEFAULT_ACCESS_TOKEN } = require('./mews');
const store = require('./store');

const BASIS = (process.env.REVENUE_BASIS || 'net').toLowerCase() === 'gross' ? 'GrossValue' : 'NetValue';
const DEFAULT_TZ = process.env.TIMEZONE || 'Africa/Johannesburg';
const CACHE_MINUTES = Number(process.env.CACHE_MINUTES || 10);
const EXCLUDED_TYPES = new Set(['CancellationFee', 'Deposit', 'CityTax', 'CityTaxDiscount']);

// PROPERTIES environment variable (JSON), e.g.
// [{"name":"Sandton 1","accessToken":"..."},{"name":"Sandton 2","accessToken":"...","serviceId":"..."}]
// With one portfolio token, give each property its "enterpriseId" instead.
function getProperties() {
  if (process.env.PROPERTIES) {
    try { return JSON.parse(process.env.PROPERTIES); } catch (e) { throw new Error('PROPERTIES secret is not valid JSON'); }
  }
  return [{ name: ENV === 'demo' ? 'Demo Hotel' : 'Property', accessToken: DEFAULT_ACCESS_TOKEN }];
}

const nameOf = (names) => (names ? Object.values(names)[0] : '') || '';
const emptyDay = () => ({ rev: 0, fnb: 0, sold: new Set(), aum: 0, ooo: 0 });

async function loadProperty(p, nowIso) {
  const { call, getAll } = createClient(p.accessToken || DEFAULT_ACCESS_TOKEN);
  const ent = p.enterpriseId ? { EnterpriseIds: [p.enterpriseId] } : {};

  // Property time zone (dates and "today" are all in local time).
  let tz = p.timeZone || DEFAULT_TZ;
  if (!p.timeZone) {
    try {
      const cfg = await call('configuration/get', p.enterpriseId ? { EnterpriseId: p.enterpriseId } : {});
      tz = cfg.Enterprise?.TimeZoneIdentifier || tz;
    } catch { /* fall back to TIMEZONE */ }
  }

  const today = localYmd(nowIso, tz);
  const yesterday = addDays(today, -1);
  const cur = today.slice(0, 7);
  const months = { prev: addMonths(cur, -1), cur, n1: addMonths(cur, 1), n2: addMonths(cur, 2), ly: addMonths(cur, -12) };

  // Accommodation service (the one holding the rooms).
  let serviceId = p.serviceId;
  if (!serviceId) {
    const services = (await getAll('services/getAll', ent, 'Services'))
      .filter((s) => s.IsActive && s.Data?.Discriminator === 'Bookable');
    const acc = services.find((s) => /accommodation|stay|room|apartment/i.test(nameOf(s.Names))) || services[0];
    if (!acc) throw new Error('No bookable service found');
    serviceId = acc.Id;
  }

  const categories = await getAll('accountingCategories/getAll', ent, 'AccountingCategories');
  const classOf = Object.fromEntries(categories.map((c) => [c.Id, c.Classification]));

  // ---- Order items, one month per request (Mews max interval = 3 months) ----
  const days = {};
  const day = (d) => (days[d] = days[d] || emptyDay());
  const stly = { rev: 0, cutoff: new Date(new Date(nowIso).getTime() - 365 * 86400000) };

  const fetchMonth = async (ym, includeCanceled) => getAll('orderItems/getAll', {
    ...ent,
    ConsumedUtc: { StartUtc: localMidnightUtc(`${ym}-01`, tz), EndUtc: localMidnightUtc(`${addMonths(ym, 1)}-01`, tz) },
    AccountingStates: includeCanceled ? ['Open', 'Closed', 'Canceled'] : ['Open', 'Closed'],
  }, 'OrderItems');

  const [lyItems, ...liveMonths] = await Promise.all([
    fetchMonth(months.ly, true),
    fetchMonth(months.prev), fetchMonth(months.cur), fetchMonth(months.n1), fetchMonth(months.n2),
  ]);

  const classify = (it) => {
    if (EXCLUDED_TYPES.has(it.Type)) return null;
    const cls = classOf[it.AccountingCategoryId];
    if (cls === 'Accommodation' || (!cls && it.Type === 'SpaceOrder' && it.ServiceId === serviceId)) return 'room';
    if (cls === 'FoodAndBeverage') return 'fnb';
    return null;
  };
  const value = (it) => Number(it.Amount?.[BASIS] || 0);

  liveMonths.flat().forEach((it) => {
    const kind = classify(it);
    if (!kind || !it.ConsumedUtc) return;
    const d = day(localYmd(it.ConsumedUtc, tz));
    if (kind === 'room') {
      d.rev += value(it);
      if (it.Type === 'SpaceOrder' && it.ServiceId === serviceId && it.ServiceOrderId) d.sold.add(it.ServiceOrderId);
    } else d.fnb += value(it);
  });

  // Last year: actuals (not canceled) + "same time last year" on-the-books as at this moment one year ago.
  lyItems.forEach((it) => {
    if (classify(it) !== 'room' || !it.ConsumedUtc) return;
    const d = day(localYmd(it.ConsumedUtc, tz));
    if (it.AccountingState !== 'Canceled') d.rev += value(it);
    const created = new Date(it.CreatedUtc);
    const canceled = it.CanceledUtc ? new Date(it.CanceledUtc) : null;
    if (created <= stly.cutoff && (!canceled || canceled > stly.cutoff)) stly.rev += value(it);
  });

  // ---- Availability: AUM and OOO per night ----
  const availFrom = `${months.prev}-01`;
  const availTo = `${months.n2}-${String(daysInMonth(months.n2)).padStart(2, '0')}`;
  const avail = await call('services/getAvailability/2024-01-22', {
    ServiceId: serviceId,
    FirstTimeUnitStartUtc: localMidnightUtc(availFrom, tz),
    LastTimeUnitStartUtc: localMidnightUtc(availTo, tz),
    Metrics: ['ActiveResources', 'OutOfOrderBlocks'],
  });
  (avail.TimeUnitStartsUtc || []).forEach((t, i) => {
    const d = day(localYmd(t, tz));
    (avail.ResourceCategoryAvailabilities || []).forEach((c) => {
      d.aum += c.Metrics?.ActiveResources?.[i] || 0;
      d.ooo += c.Metrics?.OutOfOrderBlocks?.[i] || 0;
    });
  });

  // ---- Aggregation helpers ----
  const range = (from, to) => {
    const out = { rev: 0, fnb: 0, sold: 0, aum: 0, ooo: 0 };
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const x = days[d];
      if (!x) continue;
      out.rev += x.rev; out.fnb += x.fnb; out.sold += x.sold.size; out.aum += x.aum; out.ooo += x.ooo;
    }
    return out;
  };
  const monthRange = (ym, lastDay = daysInMonth(ym)) =>
    range(`${ym}-01`, `${ym}-${String(Math.min(lastDay, daysInMonth(ym))).padStart(2, '0')}`);
  const dom = Number(today.slice(8, 10));

  const fullMonth = monthRange(cur);
  const fnbMtdYest = yesterday.slice(0, 7) === cur ? range(`${cur}-01`, yesterday).fnb : 0;

  return {
    name: p.name,
    timeZone: tz,
    dates: { today, yesterday, months },
    today: range(today, today),
    yesterday: range(yesterday, yesterday),
    mtd: {
      rev: range(`${cur}-01`, today).rev,
      lastMonth: monthRange(months.prev, dom).rev,
      lastYear: monthRange(months.ly, dom).rev,
      fnbYest: fnbMtdYest,
    },
    full: {
      ...fullMonth,
      lastMonthRev: monthRange(months.prev).rev,
      stly: stly.rev,
      lyActual: monthRange(months.ly).rev,
      fnbYesterday: range(yesterday, yesterday).fnb,
    },
    otb: {
      [months.cur]: fullMonth.rev,
      [months.n1]: monthRange(months.n1).rev,
      [months.n2]: monthRange(months.n2).rev,
    },
    fnbOtb: fullMonth.fnb,
  };
}

// ---------- Build, snapshot, cache (all kept in Supabase; serverless functions have no memory) ----------
async function build(force = false) {
  if (!force) {
    const cached = await store.get('cache');
    if (cached && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_MINUTES * 60000) {
      return withTargets(cached);
    }
  }

  const nowIso = new Date().toISOString();
  const props = getProperties();
  const results = await Promise.all(props.map((p) =>
    loadProperty(p, nowIso).catch((e) => ({ name: p.name, error: e.message }))));
  const ok = results.filter((r) => !r.error);
  if (!ok.length) throw new Error(results.map((r) => `${r.name}: ${r.error}`).join(' | '));

  const { today, yesterday, months } = ok[0].dates;

  // Snapshots: keep the latest OTB per day; "yesterday OTB" = most recent snapshot before today.
  const snapshots = (await store.get('snapshots')) || {};
  const prevKey = Object.keys(snapshots).filter((k) => k < today).sort().pop();
  const prevSnap = prevKey ? snapshots[prevKey] : null;
  snapshots[today] = Object.fromEntries(ok.map((r) => [r.name, { otb: r.otb, fnbOtb: r.fnbOtb }]));
  Object.keys(snapshots).sort().slice(0, -60).forEach((k) => delete snapshots[k]); // keep ~60 days
  await store.set('snapshots', snapshots);

  ok.forEach((r) => {
    const snap = prevSnap?.[r.name];
    r.pickup = [months.cur, months.n1, months.n2].map((m) => ({
      month: m,
      yesterday: snap?.otb?.[m] ?? null,
      today: r.otb[m],
    }));
    r.fnbPickup = snap ? r.fnbOtb - (snap.fnbOtb || 0) : null;
  });

  const data = {
    generatedAt: nowIso,
    environment: ENV,
    storage: store.enabled ? 'supabase' : 'none',
    revenueBasis: BASIS === 'NetValue' ? 'net (excl. VAT)' : 'gross (incl. VAT)',
    today, yesterday, months,
    snapshotDate: prevKey || null,
    properties: results,
  };
  await store.set('cache', data);
  return withTargets(data);
}

// Targets are read fresh on every request so edits show immediately.
async function withTargets(data) {
  const targets = (await store.get('targets')) || {};
  const month = targets[data.months.cur] || {};
  data.properties.forEach((p) => { if (!p.error) p.target = month[p.name] ?? null; });
  return data;
}

async function setTargets(month, values) {
  const targets = (await store.get('targets')) || {};
  targets[month] = { ...(targets[month] || {}), ...values };
  await store.set('targets', targets);
  return targets[month];
}

module.exports = { build, setTargets };
