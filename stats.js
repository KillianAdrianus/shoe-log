/* ==========================================================================
   Sickboiss Shoe Log — stats.js
   Pure calculations over a data snapshot from SB.db.loadAll().
   No DOM, no database writes: everything here can be tested in isolation.
   ========================================================================== */
window.SB = window.SB || {};

SB.stats = (() => {
  const DAY = 86400000;

  // ---- dates (always local calendar days, YYYY-MM-DD) ----------------------
  const iso = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const today = () => iso(new Date());
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };

  const sum = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  /** Group the log tables by pairId so per-pair lookups are cheap. */
  function index(data) {
    const ix = { wears: {}, care: {}, values: {}, photos: {}, tag: {} };
    for (const k of ['wears', 'care', 'values', 'photos']) {
      for (const row of data[k] || []) (ix[k][row.pairId] = ix[k][row.pairId] || []).push(row);
      for (const id in ix[k]) ix[k][id].sort(byDate);
    }
    for (const t of data.tags || []) if (t.pairId) ix.tag[t.pairId] = t.serial;
    return ix;
  }

  /** Market value of a pair on a given day: latest entry on/before that day, else price paid. */
  function valueOn(pair, values, day) {
    let v = null;
    for (const row of values || []) if (row.date <= day) v = row.value;
    return v == null ? Number(pair.price) || 0 : Number(v);
  }

  /** Every derived number for one pair. */
  function pair(p, ix, now = today()) {
    const wears = ix.wears[p.id] || [];
    const care = ix.care[p.id] || [];
    const values = ix.values[p.id] || [];
    const price = Number(p.price) || 0;

    const wearCount = wears.length + (Number(p.priorWears) || 0);
    const km = sum(wears, (w) => w.km) + (Number(p.priorKm) || 0);
    const careCost = sum(care, (c) => c.cost);
    const totalCost = price + careCost;
    const cpw = wearCount > 0 ? totalCost / wearCount : null;

    const lastWorn = wears.length ? wears[wears.length - 1].date : (p.lastWornBefore || null);
    const daysSinceWorn = lastWorn ? daysBetween(lastWorn, now) : null;
    const daysOwned = p.purchaseDate ? Math.max(0, daysBetween(p.purchaseDate, now)) : null;
    const ageYears = daysOwned != null ? daysOwned / 365.25 : 0;

    const latestValue = values.length ? Number(values[values.length - 1].value) : null;
    const value = latestValue != null ? latestValue : price;
    const gain = latestValue != null ? latestValue - price : null;

    const lastCare = care.length ? care[care.length - 1] : null;
    const wearsSinceCare = lastCare ? wears.filter((w) => w.date > lastCare.date).length : wearCount;
    const careEvery = Number(p.careEvery) || 0;
    const active = (p.status || 'active') === 'active';
    const careDue = active && careEvery > 0 && wearsSinceCare >= careEvery;

    // Old midsoles (PU, older Air units) crumble when they sit unworn for years.
    const hydrolysisRisk = active && ageYears >= 3 && (daysSinceWorn == null || daysSinceWorn >= 180);

    const running = p.category === 'running';
    const retireKm = Number(p.retireKm) || 700;
    const kmPct = running ? km / retireKm : null;

    const materials = p.materials || [];
    const rainUnsafe = p.rainSafe === false ||
      (p.rainSafe == null && materials.some((m) => m === 'suede' || m === 'nubuck'));

    return {
      wearCount, km, careCost, totalCost, cpw, lastWorn, daysSinceWorn, daysOwned, ageYears,
      value, latestValue, gain, lastCare, wearsSinceCare, careEvery, careDue, hydrolysisRisk,
      running, retireKm, kmPct, rainUnsafe, active, tag: ix.tag[p.id] || null
    };
  }

  /** Whole-rack numbers for the dashboard. */
  function collection(data, now = today()) {
    const ix = index(data);
    const rows = (data.pairs || []).map((p) => ({ p, s: pair(p, ix, now) }));
    const active = rows.filter((r) => r.s.active);
    const paid = sum(active, (r) => r.p.price);
    const value = sum(active, (r) => r.s.value);
    const wears = sum(rows, (r) => r.s.wearCount);
    const worn = active.filter((r) => r.s.cpw != null);
    const avgCpw = worn.length ? sum(worn, (r) => r.s.cpw) / worn.length : null;
    const km = sum(rows.filter((r) => r.s.running), (r) => r.s.km);
    return { ix, rows, active, paid, value, gain: value - paid, wears, avgCpw, km,
             hasRunning: rows.some((r) => r.s.running) };
  }

  /** Wear counts per day for the heatmap. */
  function wearsPerDay(wears) {
    const m = {};
    for (const w of wears || []) m[w.date] = (m[w.date] || 0) + 1;
    return m;
  }

  /** Coldest-first ordering: never-worn first, then longest since worn. */
  const coldness = (s) => (s.daysSinceWorn == null ? 1e9 : s.daysSinceWorn);

  /** Suggest today's pair: the coldest active pair (rain-safe when rain mode is on). */
  function todaysPick(coll, rainMode) {
    const pool = coll.active.filter((r) => !(rainMode && r.s.rainUnsafe) && r.s.daysSinceWorn !== 0);
    pool.sort((a, b) => coldness(b.s) - coldness(a.s));
    return pool[0] || null;
  }

  // ---- periods -------------------------------------------------------------
  /** kind: month | quarter | year. offset: 0 = current, -1 = previous … */
  function period(kind, offset = 0, ref = new Date()) {
    const y = ref.getFullYear(); const m = ref.getMonth();
    let start; let end; let label;
    const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    if (kind === 'year') {
      start = new Date(y + offset, 0, 1); end = new Date(y + offset, 11, 31);
      label = String(y + offset);
    } else if (kind === 'quarter') {
      const q = Math.floor(m / 3) + offset;
      start = new Date(y, q * 3, 1); end = new Date(y, q * 3 + 3, 0);
      label = `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
    } else {
      start = new Date(y, m + offset, 1); end = new Date(y, m + offset + 1, 0);
      label = `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
    }
    return { kind, offset, start: iso(start), end: iso(end), label };
  }

  // ---- personality labels ----------------------------------------------------
  const PERSONAS = {
    mileage:  { name: 'THE MILEAGE MONSTER', line: 'Your soles have seen more road than most cars.', color: '#4DA3FF' },
    beater:   { name: 'THE BEATER KING', line: 'One pair. Every day. No apologies.', color: '#FF5A1F' },
    caretaker:{ name: 'THE CARETAKER', line: 'Fresh is a discipline.', color: '#3DDC97' },
    investor: { name: 'THE INVESTOR', line: 'Bought right. Held right. The rack is up.', color: '#F5C542' },
    hunter:   { name: 'THE FRESH HUNTER', line: 'New heat keeps landing.', color: '#FF4FA3' },
    rotator:  { name: 'THE ROTATOR', line: 'Every pair gets its day.', color: '#B48CFF' },
    archivist:{ name: 'THE ARCHIVIST', line: 'A museum, not a closet.', color: '#C9B79C' },
    hero:     { name: 'THE EVERYDAY HERO', line: 'Worn, loved, logged.', color: '#F2EFE8' }
  };

  function persona(r) {
    if (r.km >= 100) return PERSONAS.mileage;
    if (r.totalWears >= 8 && r.topShare >= 0.45) return PERSONAS.beater;
    if (r.careCount >= 3 && r.careCount >= r.totalWears * 0.25) return PERSONAS.caretaker;
    if (r.valueChangePct >= 0.15) return PERSONAS.investor;
    if (r.purchases.length >= 3) return PERSONAS.hunter;
    if (r.totalWears >= 10 && r.distinctRatio >= 0.6) return PERSONAS.rotator;
    if (r.ownedCount >= 5 && r.distinctRatio < 0.25) return PERSONAS.archivist;
    return PERSONAS.hero;
  }

  /** Everything the Sneaker Report shows for one period. */
  function report(data, per) {
    const ix = index(data);
    const inRange = (d) => d >= per.start && d <= per.end;
    const wears = (data.wears || []).filter((w) => inRange(w.date));
    const care = (data.care || []).filter((c) => inRange(c.date));
    const pairsById = Object.fromEntries((data.pairs || []).map((p) => [p.id, p]));

    // Pairs owned during the period (bought on/before end, not sold before start).
    const owned = (data.pairs || []).filter((p) => (!p.purchaseDate || p.purchaseDate <= per.end) &&
      !((p.status === 'sold' || p.status === 'retired') && p.statusDate && p.statusDate < per.start));

    const counts = {};
    let km = 0;
    for (const w of wears) { counts[w.pairId] = (counts[w.pairId] || 0) + 1; km += Number(w.km) || 0; }
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({ p: pairsById[id], n })).filter((x) => x.p);

    const totalWears = wears.length;
    const top = ranked[0] || null;
    const topShare = top ? top.n / totalWears : 0;
    const distinctRatio = owned.length ? ranked.length / owned.length : 0;

    // CPW champion: lowest lifetime cost-per-wear among pairs worn this period.
    let champ = null;
    for (const r of ranked) {
      const s = pair(r.p, ix, per.end);
      if (s.cpw != null && s.wearCount >= 3 && (!champ || s.cpw < champ.s.cpw)) champ = { p: r.p, s };
    }

    // Most neglected: owned, active, not worn this period, longest since worn.
    let neglected = null;
    for (const p of owned) {
      if ((p.status || 'active') !== 'active' || counts[p.id]) continue;
      const s = pair(p, ix, per.end);
      if (!neglected || coldness(s) > coldness(neglected.s)) neglected = { p, s };
    }

    // Busiest weekday.
    const DOW = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const dow = [0, 0, 0, 0, 0, 0, 0];
    for (const w of wears) dow[parse(w.date).getDay()]++;
    const busiest = totalWears ? DOW[dow.indexOf(Math.max(...dow))] : null;

    // Money.
    const purchases = (data.pairs || []).filter((p) => p.purchaseDate && inRange(p.purchaseDate));
    const spentNew = sum(purchases, (p) => p.price);
    const spentCare = sum(care, (c) => c.cost);
    const startDay = addDays(per.start, -1);
    const heldBoth = owned.filter((p) => !p.purchaseDate || p.purchaseDate <= startDay);
    const vStart = sum(heldBoth, (p) => valueOn(p, ix.values[p.id], startDay));
    const vEnd = sum(heldBoth, (p) => valueOn(p, ix.values[p.id], per.end));
    const valueChange = vEnd - vStart;
    const valueChangePct = vStart > 0 ? valueChange / vStart : 0;

    // Brand split of wears.
    const brands = {};
    for (const w of wears) { const b = pairsById[w.pairId]?.brand || 'Other'; brands[b] = (brands[b] || 0) + 1; }
    const brandSplit = Object.entries(brands).sort((a, b) => b[1] - a[1]);

    // Pair of the period: the most worn pair, with its latest memory from the period.
    let feature = null;
    if (top) {
      const mem = wears.filter((w) => w.pairId === top.p.id && w.memory).sort(byDate).pop();
      feature = { p: top.p, n: top.n, memory: mem ? mem.memory : top.p.story || '' , memoryDate: mem ? mem.date : null };
    }

    const r = {
      period: per, totalWears, pairsWorn: ranked.length, ownedCount: owned.length, km, ranked, top,
      topShare, distinctRatio, champ, neglected, busiest, dow, purchases, spentNew, spentCare,
      careCount: care.length, valueChange, valueChangePct, brandSplit, feature,
      perDay: wearsPerDay(wears)
    };
    r.persona = persona(r);
    return r;
  }

  return { iso, today, parse, daysBetween, addDays, index, pair, collection, wearsPerDay,
           todaysPick, coldness, period, report, persona, PERSONAS, valueOn };
})();
