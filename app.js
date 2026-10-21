/* ==========================================================================
   Sickboiss Shoe Log — app.js
   Screens, routing, forms and the NFC tap flow.
   Depends on: db.js (SB.db), stats.js (SB.stats), exports.js (SB.fmt, SB.exports)

   Routes (hash based, so the app works from any static host):
     #/                 Home dashboard
     #/collection       The rack
     #/pair/<id>        Pair detail
     #/add  #/edit/<id> Add / edit form
     #/report           Sneaker Report
     #/more             Settings, backup, NFC tools
     #/claim/<serial>   Link a new NFC tag to a pair
     #/tapped/<wearId>  "Wear logged" stamp after an NFC tap
   NFC tags carry  https://<your-host>/?tag=SB-00421
   ========================================================================== */
(() => {
  'use strict';
  const S = SB.stats; const F = SB.fmt; const X = SB.exports; const DB = SB.db;

  const LIMIT = 100;
  const OCCASIONS = ['Daily', 'Work', 'Night out', 'Event', 'Travel', 'Gig', 'Run', 'Sport'];
  const CONDITIONS = ['DS', 'VNDS', '9/10', '8/10', '7/10', 'Beater'];
  const MATERIALS = ['leather', 'suede', 'nubuck', 'knit/mesh', 'canvas', 'synthetic'];
  const CARE_TYPES = ['Cleaning', 'Washing', 'Retooling'];
  const MAX_MAIN_PHOTOS = 3;
  const TAP_DEBOUNCE_MS = 5 * 60 * 1000;

  const state = {
    data: null, coll: null, rainMode: false, displayName: '', lastBackup: null,
    filter: 'all', sort: 'cold', q: '', reportKind: 'month', reportOffset: 0,
    form: null, keepScroll: false, sheetCancel: null
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const view = $('#view');

  // ------------------------------------------------------------------ data
  async function refresh() {
    state.data = await DB.loadAll();
    state.coll = S.collection(state.data);
  }
  const pairById = (id) => state.data.pairs.find((p) => p.id === id);
  const statsOf = (p) => S.pair(p, state.coll.ix);
  const photosOf = (id, kind = 'main') => (state.coll.ix.photos[id] || [])
    .filter((ph) => ph.kind === kind)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.date < b.date ? -1 : 1));
  const cover = (id) => photosOf(id)[0]?.data || null;
  const initials = (p) => `${p.brand || ''} ${p.model || ''}`.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const pairName = (p) => `${p.brand} ${p.model}`;

  function thumb(p, cls = 'thumb') {
    const src = cover(p.id);
    return src ? `<img class="${cls}" src="${src}" alt="">`
      : `<div class="${cls} ph" aria-hidden="true"><span>${esc(initials(p))}</span></div>`;
  }

  async function addWear(pairId, extra = {}) {
    const w = { id: DB.uid(), pairId, date: S.today(), km: null, occasion: null, memory: '',
                source: 'manual', createdAt: Date.now(), ...extra };
    await DB.put('wears', w);
    return w;
  }

  // ------------------------------------------------------------------ ui bits
  let toastTimer;
  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    t.hidden = false;
    if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.run(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 2600);
  }

  function openSheet(html) {
    const body = $('#sheet-body');
    body.innerHTML = `<div class="grabber" aria-hidden="true"></div>${html}`;
    $('#sheet').hidden = false;
    document.body.classList.add('locked');
    return body;
  }
  function closeSheet() {
    if ($('#sheet').hidden) return;
    $('#sheet').hidden = true;
    document.body.classList.remove('locked');
    $('#sheet-body').innerHTML = '';
    const c = state.sheetCancel; state.sheetCancel = null; if (c) c();
  }
  function confirmSheet({ title, body, ok = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const el = openSheet(`<h2 class="sheet-title">${esc(title)}</h2><p class="muted">${esc(body)}</p>
        <div class="row-btns"><button type="button" class="btn ghost" data-r="0">Cancel</button>
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`);
      state.sheetCancel = () => resolve(false);
      $$('[data-r]', el).forEach((b) => { b.onclick = () => { state.sheetCancel = null; closeSheet(); resolve(b.dataset.r === '1'); }; });
    });
  }

  /** Resize a picked photo to ≤1080px JPEG so 100 pairs stay light on the phone. */
  async function compress(file, max = 1080, q = 0.82) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/jpeg', q);
    } finally { URL.revokeObjectURL(url); }
  }

  function pickFiles({ multiple = false } = {}) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = multiple;
      inp.onchange = () => resolve([...inp.files]);
      inp.click();
    });
  }

  const sparkline = (pts, w = 120, h = 36) => {
    if (pts.length < 2) return '';
    const min = Math.min(...pts); const max = Math.max(...pts); const span = max - min || 1;
    const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)]);
    const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const [lx, ly] = xy[xy.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <path d="${d} L${w},${h} L0,${h} Z" fill="var(--accent-soft)"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <circle cx="${lx}" cy="${ly}" r="3.5" fill="var(--accent)"/></svg>`;
  };

  // ------------------------------------------------------------------ router
  const routes = { '': home, home, collection, pair: pairView, add: editPair, edit: editPair,
                   report, more, claim, tapped };
  const TAB_FOR = { '': 'home', home: 'home', collection: 'collection', pair: 'collection',
                    edit: 'collection', add: 'add', report: 'report', more: 'more' };

  function go(path) {
    const h = '#/' + path;
    if (location.hash === h || (h === '#/' && !location.hash)) render(); else location.hash = h;
  }
  function rerender() { state.keepScroll = true; return render(); }

  async function render() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [name, ...rest] = raw.split('/');
    const arg = rest.length ? decodeURIComponent(rest.join('/')) : undefined;
    const fn = routes[name] || home;
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === (TAB_FOR[name] || '')));
    document.body.dataset.route = name || 'home';
    closeSheet();
    await fn(arg);
    if (!state.keepScroll) window.scrollTo(0, 0);
    state.keepScroll = false;
  }

  // ==================================================================== HOME
  function heatmapHTML(perDay, weeks = 26) {
    const end = S.today();
    let start = S.addDays(end, -(weeks * 7 - 1));
    start = S.addDays(start, -S.parse(start).getDay());
    const days = S.daysBetween(start, end) + 1;
    let cells = '';
    for (let i = 0; i < days; i++) {
      const d = S.addDays(start, i); const n = perDay[d] || 0;
      cells += `<i class="l${Math.min(n, 3)}" title="${F.date(d)}: ${n} wear${n === 1 ? '' : 's'}"></i>`;
    }
    return `<div class="heat" style="--weeks:${Math.ceil(days / 7)}">${cells}</div>
      <div class="heat-legend"><span>${F.date(start)}</span><span class="scale">less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i> more</span></div>`;
  }

  function alertsFor(coll) {
    const out = [];
    for (const { p, s } of coll.active) {
      if (s.careDue) out.push({ kind: 'care', id: p.id, title: `Care due · ${p.model}`, sub: `${s.wearsSinceCare} wears since last ${s.lastCare ? s.lastCare.type.toLowerCase() : 'clean'}` });
      if (s.hydrolysisRisk) out.push({ kind: 'risk', id: p.id, title: `Wear them or lose them · ${p.model}`, sub: `${Math.floor(s.ageYears)}+ years old, last worn ${F.ago(s.daysSinceWorn)}. Old midsoles crumble when they sit.` });
      if (s.running && s.kmPct >= 0.8) out.push({ kind: 'run', id: p.id, title: `Near retirement · ${p.model}`, sub: `${F.km(s.km)} of ${s.retireKm} km (${Math.round(s.kmPct * 100)}%)` });
    }
    const days = state.lastBackup ? S.daysBetween(state.lastBackup.slice(0, 10), S.today()) : null;
    if (coll.rows.length && (days == null || days >= 14)) {
      out.push({ kind: 'backup', title: 'Back up your rack', sub: days == null ? 'Your collection only lives on this phone. Save a backup file.' : `Last backup ${days} days ago.` });
    }
    return out;
  }

  async function home() {
    const c = state.coll;
    if (!c.rows.length) {
      view.innerHTML = `<section class="empty">
        <p class="eyebrow">Sickboiss Shoe Log</p>
        <h1 class="display xl">Your rack<br>is empty.</h1>
        <p class="muted">Log every pair: what it cost, how often it's worn, how it's cared for, and what it means to you.</p>
        <div class="stack">
          <button type="button" class="btn primary big" data-act="go" data-to="add">Add your first pair</button>
          <button type="button" class="btn ghost" data-act="demo">Try the demo rack</button>
        </div></section>`;
      return;
    }
    const pick = S.todaysPick(c, state.rainMode);
    const alerts = alertsFor(c);
    const recent = [...c.active].sort((a, b) => S.coldness(a.s) - S.coldness(b.s)).slice(0, 14);
    const mostWorn = [...c.rows].sort((a, b) => b.s.wearCount - a.s.wearCount).slice(0, 5);
    const dusty = [...c.active].sort((a, b) => S.coldness(b.s) - S.coldness(a.s)).slice(0, 5);
    const brands = {};
    for (const { p } of c.active) brands[p.brand] = (brands[p.brand] || 0) + 1;
    const brandRows = Object.entries(brands).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const bmax = brandRows[0]?.[1] || 1;
    const gainCls = c.gain >= 0 ? 'up' : 'down';

    view.innerHTML = `
      <section class="page-head">
        <div><p class="eyebrow">Sickboiss Shoe Log</p><h1 class="display">Your rack</h1></div>
        <span class="count mono">${c.rows.filter((r) => r.s.active).length} / ${LIMIT}</span>
      </section>

      <section class="hero-stats">
        <div class="big-stat"><span class="label">Rack value</span><b class="display">${F.rpShort(c.value)}</b>
          <span class="delta ${gainCls}">${F.signed(c.gain)} vs paid</span></div>
        <div class="mini-grid ${c.hasRunning ? 'four' : ''}">
          <div><span class="label">Paid</span><b>${F.rpShort(c.paid)}</b></div>
          <div><span class="label">Wears</span><b>${c.wears}</b></div>
          <div><span class="label">Avg cost/wear</span><b>${c.avgCpw == null ? '—' : F.rpShort(c.avgCpw)}</b></div>
          ${c.hasRunning ? `<div><span class="label">Km run</span><b class="run">${Math.round(c.km)}</b></div>` : ''}
        </div>
      </section>

      <section class="card pick">
        <div class="pick-head"><h2 class="h">Today's pick</h2>
          <label class="switch"><input type="checkbox" id="rainMode" ${state.rainMode ? 'checked' : ''}><span>Rain mode</span></label></div>
        ${pick ? `<div class="pick-body" data-act="go" data-to="pair/${pick.p.id}">
            ${thumb(pick.p, 'pick-img')}
            <div><p class="brand">${esc(pick.p.brand)}</p><p class="model">${esc(pick.p.model)}</p>
            <p class="muted small">Last worn ${F.ago(pick.s.daysSinceWorn)}${pick.s.rainUnsafe ? '' : state.rainMode ? ' · rain-safe' : ''}</p></div></div>
          <button type="button" class="btn primary big" data-act="quicklog" data-id="${pick.p.id}">Wear it</button>`
          : `<p class="muted">Nothing to suggest${state.rainMode ? ' that survives the rain' : ''}. Everything's been worn today.</p>`}
      </section>

      <section>
        <h2 class="h">Quick log <span class="muted small">tap a pair to log today's wear</span></h2>
        <div class="strip">${recent.map(({ p, s }) => `<button type="button" class="strip-item" data-act="quicklog" data-id="${p.id}">
          ${thumb(p)}<span>${esc(p.model)}</span><em>${s.daysSinceWorn === 0 ? 'worn today' : F.ago(s.daysSinceWorn)}</em></button>`).join('')}</div>
      </section>

      ${alerts.length ? `<section><h2 class="h">Heads up</h2><div class="alerts">${alerts.map((a) => `
        <button type="button" class="alert ${a.kind}" data-act="go" data-to="${a.kind === 'backup' ? 'more' : 'pair/' + a.id}">
          <b>${esc(a.title)}</b><span>${esc(a.sub)}</span></button>`).join('')}</div></section>` : ''}

      <section class="card"><h2 class="h">Wear calendar <span class="muted small">last 26 weeks</span></h2>${heatmapHTML(S.wearsPerDay(state.data.wears))}</section>

      <section class="two-col">
        <div class="card"><h2 class="h">Most worn</h2><ol class="rank">${mostWorn.map(({ p, s }) => `
          <li data-act="go" data-to="pair/${p.id}"><span>${esc(p.model)}</span><b>${s.wearCount}</b></li>`).join('')}</ol></div>
        <div class="card"><h2 class="h">Gathering dust</h2><ol class="rank dust">${dusty.map(({ p, s }) => `
          <li data-act="go" data-to="pair/${p.id}"><span>${esc(p.model)}</span><b>${F.ago(s.daysSinceWorn)}</b></li>`).join('')}</ol></div>
      </section>

      <section class="card"><h2 class="h">Brands</h2><div class="bars">${brandRows.map(([b, n]) => `
        <div class="bar-row"><span>${esc(b)}</span><div class="bar"><i style="width:${(n / bmax) * 100}%"></i></div><b>${n}</b></div>`).join('')}</div></section>`;

    $('#rainMode').onchange = async (e) => {
      state.rainMode = e.target.checked; await DB.setMeta('rainMode', state.rainMode); rerender();
    };
  }

  async function quickLog(id) {
    const p = pairById(id); if (!p) return;
    const w = await addWear(id, { source: 'quick' });
    await refresh(); await rerender();
    toast(`Wear logged · ${p.model}`, { label: 'Undo', run: async () => { await DB.del('wears', w.id); await refresh(); rerender(); } });
  }

  // ============================================================== COLLECTION
  async function collection() {
    const c = state.coll;
    const q = state.q.trim().toLowerCase();
    let rows = c.rows.filter(({ p, s }) => {
      if (state.filter === 'lifestyle' && (s.running || !s.active)) return false;
      if (state.filter === 'running' && (!s.running || !s.active)) return false;
      if (state.filter === 'archive' && s.active) return false;
      if (state.filter === 'all' && !s.active) return false;
      if (q && !`${p.brand} ${p.model} ${p.colorway} ${p.styleCode}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const sorters = {
      cold: (a, b) => S.coldness(b.s) - S.coldness(a.s),
      worn: (a, b) => b.s.wearCount - a.s.wearCount,
      cpw: (a, b) => (a.s.cpw ?? 1e15) - (b.s.cpw ?? 1e15),
      value: (a, b) => b.s.value - a.s.value,
      new: (a, b) => String(b.p.purchaseDate).localeCompare(String(a.p.purchaseDate))
    };
    rows = rows.sort(sorters[state.sort]);
    const chips = [['all', 'All'], ['lifestyle', 'Lifestyle'], ['running', 'Running'], ['archive', 'Sold / Retired']];

    view.innerHTML = `
      <section class="page-head"><div><p class="eyebrow">The rack</p><h1 class="display">Collection</h1></div>
        <span class="count mono">${c.active.length} / ${LIMIT}</span></section>
      <div class="toolbar">
        <input type="search" id="q" class="field" placeholder="Search brand, model, colorway, style code" value="${esc(state.q)}" autocomplete="off">
        <div class="chips">${chips.map(([k, l]) => `<button type="button" class="chip ${state.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div>
        <label class="sort"><span class="label">Sort</span><select id="sort" class="field">
          ${[['cold', 'Coldest first'], ['worn', 'Most worn'], ['cpw', 'Best cost/wear'], ['value', 'Highest value'], ['new', 'Newest']]
            .map(([k, l]) => `<option value="${k}" ${state.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${rows.length ? `<div class="grid">${rows.map(({ p, s }) => `
        <button type="button" class="pcard" data-act="go" data-to="pair/${p.id}">
          <div class="pcard-img">${thumb(p, 'img')}
            <div class="flags">${s.careDue ? '<i class="flag care" title="Care due"></i>' : ''}${s.rainUnsafe ? '<i class="flag rain" title="Not rain-safe">☂</i>' : ''}${s.tag ? '<i class="flag tag" title="Tag linked">NFC</i>' : ''}</div>
            ${s.running ? '<span class="run-badge">RUN</span>' : ''}${!s.active ? `<span class="status-badge">${esc(p.status)}</span>` : ''}</div>
          <span class="brand">${esc(p.brand)}</span><span class="model">${esc(p.model)}</span>
          <span class="statline mono">${s.wearCount} wears · ${s.cpw == null ? '—' : F.rpShort(s.cpw) + '/wear'}${s.running ? ` · ${Math.round(s.km)} km` : ''} · ${F.ago(s.daysSinceWorn)}</span>
        </button>`).join('')}</div>`
      : `<p class="muted center pad">${c.rows.length ? 'No pairs match.' : 'No pairs yet.'}</p>`}`;

    const qi = $('#q');
    qi.oninput = () => { state.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(async () => { await rerender(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200); };
    $('#sort').onchange = (e) => { state.sort = e.target.value; rerender(); };
  }

  // ============================================================= PAIR DETAIL
  async function pairView(id) {
    const p = pairById(id);
    if (!p) { view.innerHTML = '<p class="muted pad">That pair is gone.</p>'; return; }
    const s = statsOf(p);
    const mains = photosOf(id); const progress = photosOf(id, 'progress');
    const wears = [...(state.coll.ix.wears[id] || [])].reverse();
    const care = [...(state.coll.ix.care[id] || [])].reverse();
    const values = state.coll.ix.values[id] || [];
    const gainCls = s.gain == null ? '' : s.gain >= 0 ? 'up' : 'down';

    // Wears grouped by month
    const groups = [];
    for (const w of wears) {
      const key = w.date.slice(0, 7);
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
      groups[groups.length - 1].items.push(w);
    }
    const monthLabel = (k) => { const [y, m] = k.split('-').map(Number); return `${F.MON[m - 1]} ${y}`; };
    const careTarget = s.careEvery || 0;
    const sparkPts = [Number(p.price) || 0, ...values.map((v) => Number(v.value))];

    view.innerHTML = `
      <div class="detail">
        <button type="button" class="back" data-act="back">‹ Rack</button>
        <div class="carousel">${mains.length || progress.length
          ? [...mains.map((ph) => `<figure><img src="${ph.data}" alt=""></figure>`),
             ...progress.map((ph) => `<figure><img src="${ph.data}" alt=""><figcaption>Progress · ${F.date(ph.date)}</figcaption></figure>`)].join('')
          : `<figure>${thumb(p, 'img')}</figure>`}</div>

        <section class="ident">
          <p class="brand">${esc(p.brand)}</p>
          <h1 class="display">${esc(p.model)}</h1>
          ${p.colorway ? `<p class="muted">${esc(p.colorway)}</p>` : ''}
          <div class="chips static">
            ${p.size ? `<span class="chip">Size ${esc(p.size)}</span>` : ''}
            <span class="chip ${s.running ? 'run' : ''}">${s.running ? 'Running' : 'Lifestyle'}</span>
            ${p.condition ? `<span class="chip">${esc(p.condition)}</span>` : ''}
            ${p.styleCode ? `<span class="chip mono">${esc(p.styleCode)}</span>` : ''}
            ${s.rainUnsafe ? '<span class="chip warn">Not rain-safe</span>' : ''}
            ${!s.active ? `<span class="chip warn">${esc(p.status)}${p.soldPrice ? ' · ' + F.rpShort(p.soldPrice) : ''}</span>` : ''}
          </div>
        </section>

        <section class="stat-grid">
          <div><span class="label">Wears</span><b>${s.wearCount}</b></div>
          <div><span class="label">Cost / wear</span><b>${s.cpw == null ? '—' : F.rpShort(s.cpw)}</b></div>
          <div><span class="label">Last worn</span><b>${F.ago(s.daysSinceWorn)}</b></div>
          <div><span class="label">Paid</span><b>${F.rpShort(p.price)}</b></div>
          <div><span class="label">Value</span><b>${F.rpShort(s.value)}</b></div>
          <div><span class="label">Gain</span><b class="${gainCls}">${s.gain == null ? '—' : F.signed(s.gain)}</b></div>
        </section>

        ${s.running ? `<section class="card"><div class="row-between"><h2 class="h">Mileage</h2><b class="run">${F.km(s.km)}</b></div>
          <div class="meter ${s.kmPct >= 0.9 ? 'hot' : ''}"><i style="width:${Math.min(100, s.kmPct * 100)}%"></i></div>
          <p class="muted small">${Math.round(s.kmPct * 100)}% of ${s.retireKm} km retirement mark</p></section>` : ''}

        <section class="card">
          <div class="row-between"><h2 class="h">Value</h2><button type="button" class="link" data-act="value" data-id="${id}">Update value</button></div>
          <div class="row-between"><div><b class="display md">${F.rpShort(s.value)}</b>
            <p class="small ${gainCls}">${s.gain == null ? 'No market value logged yet. Showing price paid.' : `${F.signed(s.gain)} vs ${F.rpShort(p.price)} paid`}</p></div>
            ${sparkline(sparkPts)}</div>
          ${values.length ? `<p class="muted small">Last updated ${F.date(values[values.length - 1].date)} · ${values[values.length - 1].source}</p>` : ''}
        </section>

        <section class="card">
          <div class="row-between"><h2 class="h">Care</h2><button type="button" class="link" data-act="logcare" data-id="${id}">Log care</button></div>
          <p>${s.lastCare ? `Last <b>${esc(s.lastCare.type.toLowerCase())}</b> ${F.ago(S.daysBetween(s.lastCare.date, S.today()))}` : 'No care logged yet.'}</p>
          ${careTarget ? `<div class="meter ${s.careDue ? 'hot' : ''}"><i style="width:${Math.min(100, (s.wearsSinceCare / careTarget) * 100)}%"></i></div>
            <p class="muted small">${s.wearsSinceCare} of ${careTarget} wears until the next clean${s.careDue ? ' · due now' : ''}</p>` : ''}
          ${care.length ? `<ul class="log">${care.map((c) => `<li><span class="mono small">${F.date(c.date)}</span>
            <span><b>${esc(c.type)}</b>${c.detail ? ' · ' + esc(c.detail) : ''}${c.by ? ` <em class="muted">by ${esc(c.by)}</em>` : ''}</span>
            <span class="mono small">${c.cost ? F.rpShort(c.cost) : ''}</span>
            <button type="button" class="x" data-act="delcare" data-id="${c.id}" aria-label="Delete care entry">×</button></li>`).join('')}</ul>` : ''}
          ${s.careCost ? `<p class="muted small">Care spend ${F.rp(s.careCost)} · total cost ${F.rp(s.totalCost)}</p>` : ''}
        </section>

        ${p.story ? `<section class="story"><span class="q" aria-hidden="true">“</span><p>${esc(p.story)}</p></section>` : ''}

        <section class="card">
          <div class="row-between"><h2 class="h">Wear history</h2><span class="muted small">${s.wearCount} total</span></div>
          ${groups.map((g) => `<h3 class="month">${monthLabel(g.key)}</h3><ul class="log">${g.items.map((w) => `
            <li data-act="editwear" data-id="${w.id}"><span class="mono small">${F.date(w.date)}</span>
            <span>${w.occasion ? `<b>${esc(w.occasion)}</b>` : '<b>Worn</b>'}${w.km ? ` · ${F.km(w.km)}` : ''}${w.source === 'nfc' ? ' <i class="nfc-dot">NFC</i>' : ''}
            ${w.memory ? `<em class="memory">${esc(w.memory)}</em>` : ''}</span>
            <span></span><button type="button" class="x" data-act="delwear" data-id="${w.id}" aria-label="Delete wear">×</button></li>`).join('')}</ul>`).join('')}
          ${p.priorWears ? `<p class="muted small">+ ${p.priorWears} wears before logging started${p.priorKm ? ` (${F.km(p.priorKm)})` : ''}</p>` : ''}
          ${!wears.length && !p.priorWears ? '<p class="muted">Not worn yet. Hit Log wear.</p>' : ''}
        </section>

        <section class="card">
          <div class="row-between"><h2 class="h">Sickboiss tag</h2>
          ${s.tag ? `<span class="tagchip mono">${esc(s.tag)}</span>` : '<span class="muted small">Not linked</span>'}</div>
          <p class="muted small">${s.tag ? 'Tap the tag with your phone to log a wear.' : 'Tap a new Sickboiss NFC tag with your phone. The app will ask which pair it belongs to.'}</p>
        </section>

        <section class="card details">
          <h2 class="h">Details</h2>
          <dl>
            <dt>Bought</dt><dd>${F.date(p.purchaseDate)}${p.store ? ' · ' + esc(p.store) : ''}</dd>
            <dt>Price paid</dt><dd>${F.rp(p.price)}</dd>
            <dt>Owned</dt><dd>${s.daysOwned == null ? '—' : s.daysOwned + ' days'}</dd>
            <dt>Box</dt><dd>${esc(p.boxCondition || '—')}</dd>
            <dt>Accessories</dt><dd>${esc(p.accessories || '—')}</dd>
            <dt>Materials</dt><dd>${esc((p.materials || []).join(', ') || '—')}</dd>
          </dl>
        </section>

        <section class="actions">
          <button type="button" class="btn" data-act="passport" data-id="${id}">Pair Passport</button>
          <button type="button" class="btn" data-act="progress" data-id="${id}">Add progress photo</button>
          <button type="button" class="btn" data-act="go" data-to="edit/${id}">Edit pair</button>
          <button type="button" class="btn" data-act="status" data-id="${id}">${s.active ? 'Mark sold / retired' : 'Change status'}</button>
          <button type="button" class="btn danger-ghost" data-act="delpair" data-id="${id}">Delete pair</button>
        </section>
      </div>
      ${s.active ? `<div class="sticky-cta"><button type="button" class="btn primary big" data-act="logwear" data-id="${id}">Log wear</button></div>` : ''}`;
  }

  // ------------------------------------------------------------ sheets
  function wearSheet(pairId, wear = null) {
    const p = pairById(pairId); const running = p.category === 'running';
    const w = wear || { date: S.today(), occasion: running ? 'Run' : null, km: null, memory: '' };
    const el = openSheet(`
      <h2 class="sheet-title">${wear ? 'Edit wear' : 'Log wear'}</h2><p class="muted small">${esc(pairName(p))}</p>
      <form id="wearForm" class="form">
        <label><span class="label">Date</span><input type="date" id="w-date" class="field" value="${w.date}" max="${S.today()}" required></label>
        <div><span class="label">Occasion</span><div class="chips">${OCCASIONS.map((o) => `<button type="button" class="chip ${w.occasion === o ? 'on' : ''}" data-occ="${o}">${o}</button>`).join('')}</div></div>
        ${running ? `<label><span class="label">Distance (km)</span><input type="number" id="w-km" class="field" inputmode="decimal" step="0.01" min="0" value="${w.km ?? ''}" placeholder="e.g. 10.5"></label>` : ''}
        <label><span class="label">Memory <em class="muted">optional</em></span><textarea id="w-mem" class="field" rows="2" maxlength="200" placeholder="Where did these go today?">${esc(w.memory)}</textarea></label>
        <button type="submit" class="btn primary big">${wear ? 'Save' : 'Log wear'}</button>
      </form>`);
    let occ = w.occasion;
    $$('[data-occ]', el).forEach((b) => { b.onclick = () => { occ = occ === b.dataset.occ ? null : b.dataset.occ; $$('[data-occ]', el).forEach((x) => x.classList.toggle('on', x.dataset.occ === occ)); }; });
    $('#wearForm').onsubmit = async (e) => {
      e.preventDefault();
      const fields = { date: $('#w-date').value || S.today(), occasion: occ, memory: $('#w-mem').value.trim(),
                       km: running ? (parseFloat($('#w-km').value) || null) : null };
      if (wear) await DB.put('wears', { ...wear, ...fields }); else await addWear(pairId, fields);
      closeSheet(); await refresh(); await rerender();
      toast(wear ? 'Wear updated' : `Wear logged · ${p.model}`);
    };
  }

  function careSheet(pairId) {
    const p = pairById(pairId);
    const el = openSheet(`
      <h2 class="sheet-title">Log care</h2><p class="muted small">${esc(pairName(p))}</p>
      <form id="careForm" class="form">
        <div class="seg">${CARE_TYPES.map((t, i) => `<button type="button" class="${i ? '' : 'on'}" data-type="${t}">${t}</button>`).join('')}</div>
        <label><span class="label">What was done</span><input id="c-detail" class="field" maxlength="120" placeholder="e.g. Deep clean, new laces, sole swap"></label>
        <div class="two"><label><span class="label">Cost (Rp)</span><input type="number" id="c-cost" class="field" inputmode="numeric" min="0" step="1000" placeholder="0"></label>
        <label><span class="label">Date</span><input type="date" id="c-date" class="field" value="${S.today()}" max="${S.today()}"></label></div>
        <label><span class="label">Done by</span><input id="c-by" class="field" maxlength="60" placeholder="Me, or the shop's name"></label>
        <label><span class="label">Condition after</span><select id="c-cond" class="field">${CONDITIONS.map((c) => `<option ${p.condition === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <button type="submit" class="btn primary big">Save care</button>
      </form>`);
    let type = CARE_TYPES[0];
    $$('[data-type]', el).forEach((b) => { b.onclick = () => { type = b.dataset.type; $$('[data-type]', el).forEach((x) => x.classList.toggle('on', x === b)); }; });
    $('#careForm').onsubmit = async (e) => {
      e.preventDefault();
      await DB.put('care', { id: DB.uid(), pairId, type, detail: $('#c-detail').value.trim(), cost: Number($('#c-cost').value) || 0,
        date: $('#c-date').value || S.today(), by: $('#c-by').value.trim() });
      const cond = $('#c-cond').value;
      if (cond !== p.condition) await DB.put('pairs', { ...p, condition: cond });
      closeSheet(); await refresh(); await rerender(); toast(`${type} logged`);
    };
  }

  function valueSheet(pairId) {
    const p = pairById(pairId); const s = statsOf(p);
    openSheet(`
      <h2 class="sheet-title">Update value</h2><p class="muted small">${esc(pairName(p))} · paid ${F.rp(p.price)}</p>
      <form id="valForm" class="form">
        <label><span class="label">Market value today (Rp)</span><input type="number" id="v-val" class="field" inputmode="numeric" min="0" step="1000" value="${s.latestValue ?? ''}" required></label>
        <label><span class="label">Checked on</span><input type="date" id="v-date" class="field" value="${S.today()}" max="${S.today()}"></label>
        <p class="muted small">Tip: check recent sales on Kick Avenue, StockX or Tokopedia for your size. Automatic price checks come later.</p>
        <button type="submit" class="btn primary big">Save value</button>
      </form>`);
    $('#valForm').onsubmit = async (e) => {
      e.preventDefault();
      await DB.put('values', { id: DB.uid(), pairId, value: Number($('#v-val').value) || 0, date: $('#v-date').value || S.today(), source: 'manual' });
      closeSheet(); await refresh(); await rerender(); toast('Value updated');
    };
  }

  function statusSheet(pairId) {
    const p = pairById(pairId);
    const el = openSheet(`
      <h2 class="sheet-title">Pair status</h2><p class="muted small">${esc(pairName(p))}</p>
      <form id="stForm" class="form">
        <div class="seg">${['active', 'sold', 'retired'].map((st) => `<button type="button" class="${(p.status || 'active') === st ? 'on' : ''}" data-st="${st}">${st[0].toUpperCase() + st.slice(1)}</button>`).join('')}</div>
        <label id="st-price-wrap"><span class="label">Sold for (Rp)</span><input type="number" id="st-price" class="field" inputmode="numeric" min="0" step="1000" value="${p.soldPrice ?? ''}"></label>
        <label><span class="label">Date</span><input type="date" id="st-date" class="field" value="${p.statusDate || S.today()}" max="${S.today()}"></label>
        <button type="submit" class="btn primary big">Save</button>
      </form>`);
    let st = p.status || 'active';
    const sync = () => { $('#st-price-wrap').hidden = st !== 'sold'; };
    $$('[data-st]', el).forEach((b) => { b.onclick = () => { st = b.dataset.st; $$('[data-st]', el).forEach((x) => x.classList.toggle('on', x === b)); sync(); }; });
    sync();
    $('#stForm').onsubmit = async (e) => {
      e.preventDefault();
      await DB.put('pairs', { ...p, status: st, statusDate: st === 'active' ? null : $('#st-date').value,
        soldPrice: st === 'sold' ? Number($('#st-price').value) || 0 : null });
      closeSheet(); await refresh(); await rerender(); toast(st === 'active' ? 'Back in the rotation' : `Marked ${st}`);
    };
  }

  async function passportSheet(pairId) {
    const p = pairById(pairId); const s = statsOf(p);
    const el = openSheet(`<h2 class="sheet-title">Pair Passport</h2>
      <div class="preview story"><div class="spinner">Printing passport…</div></div>
      <div class="row-btns"><button type="button" class="btn" id="pp-img" disabled>Share image</button>
      <button type="button" class="btn primary" id="pp-pdf" disabled>Save PDF</button></div>`);
    const memories = (state.coll.ix.wears[pairId] || []).filter((w) => w.memory).slice(-3).reverse();
    const input = { pair: p, s, photo: cover(pairId), memories, displayName: state.displayName };
    const cv = await X.passport(input, 'story');
    if (!el.isConnected) return;
    $('.preview', el).innerHTML = `<img src="${cv.toDataURL('image/jpeg', 0.85)}" alt="Pair Passport preview">`;
    const slug = `${p.brand}-${p.model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const imgBtn = $('#pp-img'); const pdfBtn = $('#pp-pdf');
    imgBtn.disabled = pdfBtn.disabled = false;
    imgBtn.onclick = async () => X.deliver(await X.toBlob(cv), `passport-${slug}.png`, `${pairName(p)} · Pair Passport`);
    pdfBtn.onclick = async () => {
      pdfBtn.disabled = true; pdfBtn.textContent = 'Building PDF…';
      const a4 = await X.passport(input, 'a4');
      await X.deliver(X.toPdfBlob(a4), `passport-${slug}.pdf`, `${pairName(p)} · Pair Passport`);
      pdfBtn.disabled = false; pdfBtn.textContent = 'Save PDF';
    };
  }

  // ================================================================ ADD / EDIT
  async function editPair(id) {
    const existing = id ? pairById(id) : null;
    if (!existing && state.coll.active.length >= LIMIT) {
      view.innerHTML = `<section class="empty"><h1 class="display">Rack full</h1><p class="muted">This prototype holds up to ${LIMIT} active pairs. Mark a pair sold or retired to make room.</p></section>`;
      return;
    }
    const p = existing || { category: 'lifestyle', purchaseDate: S.today(), careEvery: 10, retireKm: 700, materials: [], condition: 'DS' };
    state.form = { photos: existing ? photosOf(id).map((ph) => ({ ...ph })) : [], removed: [] };
    const field = (key, label, attrs = '') => `<label><span class="label">${label}</span><input id="f-${key}" class="field" value="${esc(p[key] ?? '')}" ${attrs}></label>`;

    view.innerHTML = `
      <section class="page-head"><div><p class="eyebrow">${existing ? 'Edit pair' : 'New pair'}</p><h1 class="display">${existing ? esc(p.model) : 'Add to the rack'}</h1></div></section>
      <form id="pairForm" class="form big-form" novalidate>
        <fieldset><legend>Photos</legend><div class="photo-row" id="photoRow"></div>
          <p class="muted small">Up to ${MAX_MAIN_PHOTOS} photos. The first is the cover.</p></fieldset>

        <fieldset><legend>Identity</legend>
          ${field('brand', 'Brand *', 'required list="brands" autocomplete="off" placeholder="Nike"')}
          <datalist id="brands">${['Nike', 'Jordan', 'adidas', 'New Balance', 'ASICS', 'Salomon', 'Converse', 'Vans', 'Puma', 'Reebok', 'On', 'Hoka', 'Compass', 'Ventela', 'Patrobas', 'Brodo']
            .map((b) => `<option value="${b}">`).join('')}</datalist>
          ${field('model', 'Model *', 'required placeholder="Air Jordan 1 High OG"')}
          ${field('colorway', 'Colorway', 'placeholder="Chicago Lost & Found"')}
          <div class="two">${field('styleCode', 'Style code', 'placeholder="DZ5485-612" autocapitalize="characters"')}${field('size', 'Size', 'placeholder="EU 42.5"')}</div>
          <div><span class="label">Category</span><div class="seg" id="catSeg">
            <button type="button" data-cat="lifestyle" class="${p.category !== 'running' ? 'on' : ''}">Lifestyle</button>
            <button type="button" data-cat="running" class="${p.category === 'running' ? 'on' : ''}">Running</button></div></div>
        </fieldset>

        <fieldset><legend>Purchase</legend>
          <div class="two"><label><span class="label">Date bought</span><input type="date" id="f-purchaseDate" class="field" value="${esc(p.purchaseDate || '')}" max="${S.today()}"></label>
          <label><span class="label">Price paid (Rp) *</span><input type="number" id="f-price" class="field" inputmode="numeric" min="0" step="1000" value="${esc(p.price ?? '')}" required></label></div>
          ${field('store', 'Store / source', 'placeholder="Official store, raffle, reseller…"')}
          ${existing ? '' : `<label><span class="label">Current market value (Rp) <em class="muted">optional</em></span><input type="number" id="f-value" class="field" inputmode="numeric" min="0" step="1000"></label>`}
        </fieldset>

        <fieldset><legend>Condition & materials</legend>
          <label><span class="label">Condition</span><select id="f-condition" class="field">${CONDITIONS.map((c) => `<option ${p.condition === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <div class="two">${field('boxCondition', 'Box', 'placeholder="OG box, damaged lid…"')}${field('accessories', 'Accessories', 'placeholder="Extra laces, hangtag, receipt"')}</div>
          <div><span class="label">Materials</span><div class="chips" id="matChips">${MATERIALS.map((m) => `<button type="button" class="chip ${(p.materials || []).includes(m) ? 'on' : ''}" data-mat="${m}">${m}</button>`).join('')}</div>
          <p class="muted small" id="rainNote"></p></div>
        </fieldset>

        <fieldset><legend>Wear, care & running</legend>
          <div class="two"><label><span class="label">Clean every N wears</span><input type="number" id="f-careEvery" class="field" inputmode="numeric" min="0" value="${esc(p.careEvery ?? 10)}"></label>
          <label><span class="label">Wears before logging</span><input type="number" id="f-priorWears" class="field" inputmode="numeric" min="0" value="${esc(p.priorWears ?? '')}" placeholder="0"></label></div>
          <div class="two run-only"><label><span class="label">Retire at (km)</span><input type="number" id="f-retireKm" class="field" inputmode="numeric" min="50" value="${esc(p.retireKm ?? 700)}"></label>
          <label><span class="label">Km before logging</span><input type="number" id="f-priorKm" class="field" inputmode="decimal" min="0" value="${esc(p.priorKm ?? '')}" placeholder="0"></label></div>
        </fieldset>

        <fieldset><legend>Story</legend>
          <label><span class="label">What this pair means to you</span><textarea id="f-story" class="field" rows="4" maxlength="600" placeholder="The raffle you finally won, the first pay cheque pair, the shoes from your wedding…">${esc(p.story || '')}</textarea></label>
        </fieldset>

        <p class="error" id="formError" hidden></p>
        <div class="form-actions"><button type="button" class="btn ghost" data-act="back">Cancel</button>
          <button type="submit" class="btn primary big">${existing ? 'Save changes' : 'Add to rack'}</button></div>
      </form>`;

    let category = p.category || 'lifestyle';
    const mats = new Set(p.materials || []);
    const syncCat = () => { $$('.run-only').forEach((el) => { el.hidden = category !== 'running'; }); };
    const syncRain = () => { $('#rainNote').textContent = (mats.has('suede') || mats.has('nubuck')) ? 'Suede/nubuck: this pair is hidden from picks in Rain mode.' : ''; };
    $$('#catSeg button').forEach((b) => { b.onclick = () => { category = b.dataset.cat; $$('#catSeg button').forEach((x) => x.classList.toggle('on', x === b)); syncCat(); }; });
    $$('#matChips .chip').forEach((b) => { b.onclick = () => { const m = b.dataset.mat; mats.has(m) ? mats.delete(m) : mats.add(m); b.classList.toggle('on', mats.has(m)); syncRain(); }; });
    syncCat(); syncRain(); drawPhotoRow();

    $('#pairForm').onsubmit = async (e) => {
      e.preventDefault();
      const v = (k) => $('#f-' + k)?.value.trim() ?? '';
      const num = (k) => { const x = v(k); return x === '' ? null : Number(x); };
      const err = $('#formError');
      if (!v('brand') || !v('model') || v('price') === '') {
        err.textContent = 'Brand, model and price paid are needed to save the pair.'; err.hidden = false;
        err.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
      }
      const pid = existing ? existing.id : DB.uid();
      const record = { ...(existing || {}), id: pid, brand: v('brand'), model: v('model'), colorway: v('colorway'),
        styleCode: v('styleCode').toUpperCase(), size: v('size'), category, purchaseDate: v('purchaseDate'),
        price: num('price') || 0, store: v('store'), condition: $('#f-condition').value, boxCondition: v('boxCondition'),
        accessories: v('accessories'), materials: [...mats], careEvery: num('careEvery') ?? 10, priorWears: num('priorWears') || 0,
        retireKm: num('retireKm') || 700, priorKm: num('priorKm') || 0, story: $('#f-story').value.trim(),
        status: existing?.status || 'active', createdAt: existing?.createdAt || Date.now() };
      await DB.put('pairs', record);
      if (!existing && num('value')) await DB.put('values', { id: DB.uid(), pairId: pid, value: num('value'), date: S.today(), source: 'manual' });
      for (const rid of state.form.removed) await DB.del('photos', rid);
      for (const [i, ph] of state.form.photos.entries()) {
        await DB.put('photos', { id: ph.id || DB.uid(), pairId: pid, kind: 'main', order: i, date: ph.date || S.today(), data: ph.data });
      }
      DB.persist();
      await refresh();
      toast(existing ? 'Saved' : 'Added to the rack');
      go('pair/' + pid);
    };
  }

  function drawPhotoRow() {
    const row = $('#photoRow'); if (!row) return;
    const ph = state.form.photos;
    row.innerHTML = ph.map((x, i) => `<div class="pthumb"><img src="${x.data}" alt="">${i === 0 ? '<span>Cover</span>' : ''}
      <button type="button" class="x" data-act="rmphoto" data-i="${i}" aria-label="Remove photo">×</button></div>`).join('')
      + (ph.length < MAX_MAIN_PHOTOS ? '<button type="button" class="padd" data-act="addphoto"><b>+</b><span>Add photo</span></button>' : '');
  }

  // ================================================================== REPORT
  async function report() {
    const per = S.period(state.reportKind, state.reportOffset);
    const r = S.report(state.data, per);
    view.innerHTML = `
      <section class="page-head"><div><p class="eyebrow">Sickboiss</p><h1 class="display">Sneaker Report</h1></div></section>
      <div class="seg wide">${['month', 'quarter', 'year'].map((k) => `<button type="button" class="${state.reportKind === k ? 'on' : ''}" data-act="rkind" data-v="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      <div class="period-nav"><button type="button" class="btn ghost sq" data-act="rprev" aria-label="Previous period">‹</button>
        <b class="display md">${per.label}</b>
        <button type="button" class="btn ghost sq" data-act="rnext" aria-label="Next period" ${state.reportOffset >= 0 ? 'disabled' : ''}>›</button></div>
      <p class="center muted small">${r.totalWears} wears · ${r.pairsWorn} pairs · you were <b style="color:${r.persona.color}">${r.persona.name}</b></p>
      <div class="preview story"><div class="spinner">Printing report…</div></div>
      <div class="row-btns"><button type="button" class="btn" id="rp-img" disabled>Share image</button>
        <button type="button" class="btn primary" id="rp-pdf" disabled>Save PDF</button></div>
      ${state.displayName ? '' : '<p class="center muted small">Add your name in More so it prints on the report.</p>'}`;

    const photos = {};
    for (const p of state.data.pairs) photos[p.id] = cover(p.id);
    const token = (state.reportToken = Symbol('r'));
    const cv = await X.report(r, photos, state.displayName, 'story');
    if (state.reportToken !== token || !$('#rp-img')) return;
    $('.preview').innerHTML = `<img src="${cv.toDataURL('image/jpeg', 0.85)}" alt="Sneaker Report preview">`;
    const name = `sneaker-report-${per.label.toLowerCase().replace(/\s+/g, '-')}`;
    $('#rp-img').disabled = $('#rp-pdf').disabled = false;
    $('#rp-img').onclick = async () => X.deliver(await X.toBlob(cv), `${name}.png`, `Sneaker Report · ${per.label}`);
    $('#rp-pdf').onclick = async () => {
      const b = $('#rp-pdf'); b.disabled = true; b.textContent = 'Building PDF…';
      const a4 = await X.report(r, photos, state.displayName, 'a4');
      await X.deliver(X.toPdfBlob(a4), `${name}.pdf`, `Sneaker Report · ${per.label}`);
      b.disabled = false; b.textContent = 'Save PDF';
    };
  }

  // ==================================================================== MORE
  async function more() {
    const tags = state.data.tags.slice().sort((a, b) => a.serial.localeCompare(b.serial));
    const base = location.origin + location.pathname;
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    const hasNfcWrite = 'NDEFReader' in window;
    view.innerHTML = `
      <section class="page-head"><div><p class="eyebrow">Settings</p><h1 class="display">More</h1></div></section>

      <section class="card"><h2 class="h">You</h2>
        <label><span class="label">Display name (printed on reports)</span><input id="m-name" class="field" maxlength="30" value="${esc(state.displayName)}" placeholder="e.g. Adrianus"></label></section>

      <section class="card"><h2 class="h">Backup</h2>
        <p class="muted small">Your rack lives only on this phone. Save a backup file to iCloud Drive, Google Drive or WhatsApp-to-self now and then.</p>
        <p class="small">Last backup: <b>${state.lastBackup ? F.date(state.lastBackup.slice(0, 10)) : 'never'}</b>${persisted ? ' · storage protected' : ''}</p>
        <div class="row-btns"><button type="button" class="btn primary" data-act="backup">Back up collection</button>
          <button type="button" class="btn" data-act="restore">Restore</button></div></section>

      <section class="card"><h2 class="h">Sickboiss NFC tags</h2>
        <p class="muted small">Each tag holds a link to this app plus its serial. Tapping a new tag asks which pair it belongs to; after that every tap logs a wear.</p>
        <label><span class="label">Tag serial</span><input id="m-serial" class="field mono" placeholder="SB-00001" autocapitalize="characters"></label>
        <div class="urlbox mono small" id="m-url">${esc(base)}?tag=SB-00001</div>
        <div class="row-btns"><button type="button" class="btn" data-act="copyurl">Copy link</button>
          ${hasNfcWrite ? '<button type="button" class="btn primary" data-act="writetag">Write to tag</button>' : ''}</div>
        ${hasNfcWrite ? '' : '<p class="muted small">Writing tags works in Chrome on Android. iPhones can read tags, so taps work fine there. To write tags on iPhone, use an app like NFC Tools with the link above.</p>'}
        ${tags.length ? `<ul class="log tags">${tags.map((t) => { const p = t.pairId ? pairById(t.pairId) : null; return `<li>
          <span class="tagchip mono">${esc(t.serial)}</span><span>${p ? esc(pairName(p)) : '<em class="muted">unlinked</em>'}</span><span></span>
          ${p ? `<button type="button" class="x" data-act="unlink" data-id="${esc(t.serial)}" aria-label="Unlink tag">×</button>` : '<span></span>'}</li>`; }).join('')}</ul>` : ''}
      </section>

      <section class="card"><h2 class="h">Demo & reset</h2>
        <div class="row-btns"><button type="button" class="btn" data-act="demo">Load demo rack</button>
          <button type="button" class="btn danger-ghost" data-act="erase">Erase everything</button></div></section>

      <section class="about"><p class="display md">SICKBOISS</p>
        <p class="muted small">Shoe Log prototype · works offline · your data stays on this phone.<br>NFC accessory by Make Matters.</p></section>`;

    $('#m-name').onchange = async (e) => { state.displayName = e.target.value.trim(); await DB.setMeta('displayName', state.displayName); toast('Name saved'); };
    const serialIn = $('#m-serial');
    serialIn.oninput = () => { $('#m-url').textContent = `${base}?tag=${encodeURIComponent(normSerial(serialIn.value) || 'SB-00001')}`; };
  }

  const normSerial = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

  async function backup() {
    const data = await DB.exportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const res = await X.deliver(blob, `sickboiss-shoelog-backup-${S.today()}.json`, 'Shoe Log backup');
    if (res !== 'cancelled') {
      state.lastBackup = new Date().toISOString(); await DB.setMeta('lastBackup', state.lastBackup);
      toast('Backup saved'); rerender();
    }
  }

  async function restore() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      let json;
      try { json = JSON.parse(await file.text()); } catch (e) { toast('That file could not be read as a backup.'); return; }
      const ok = await confirmSheet({ title: 'Restore this backup?', body: `Everything currently on this phone will be replaced with the backup from ${json.exportedAt ? F.date(json.exportedAt.slice(0, 10)) : 'that file'}.`, ok: 'Replace and restore', danger: true });
      if (!ok) return;
      try { await DB.importAll(json); } catch (e) { toast(e.message); return; }
      await loadSettings(); await refresh(); go(''); toast('Backup restored');
    };
    inp.click();
  }

  // ===================================================================== NFC
  /** Runs once on launch when the URL carries ?tag=… Returns the route to show. */
  async function handleTag(raw) {
    const serial = normSerial(raw);
    if (!serial) return '';
    const tag = await DB.get('tags', serial);
    const p = tag?.pairId ? pairById(tag.pairId) : null;
    if (!p) return 'claim/' + encodeURIComponent(serial);
    const last = (state.coll.ix.wears[p.id] || []).filter((w) => w.source === 'nfc').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).pop();
    if (last && Date.now() - (last.createdAt || 0) < TAP_DEBOUNCE_MS) return `tapped/${last.id}/dup`;
    const w = await addWear(p.id, { source: 'nfc', occasion: p.category === 'running' ? 'Run' : null });
    await refresh();
    return 'tapped/' + w.id;
  }

  async function tapped(arg) {
    const [wearId, flag] = String(arg || '').split('/');
    const w = state.data.wears.find((x) => x.id === wearId);
    if (!w) { go(''); return; }
    const p = pairById(w.pairId); const s = statsOf(p);
    const dup = flag === 'dup';
    const mins = Math.max(1, Math.round((Date.now() - (w.createdAt || Date.now())) / 60000));
    view.innerHTML = `
      <section class="stamp-screen ${dup ? 'dup' : ''}">
        <div class="stamp"><span class="tick" aria-hidden="true">${dup ? '!' : '✓'}</span>
          <p class="mono">${dup ? `ALREADY LOGGED · ${mins} MIN AGO` : `WEAR #${s.wearCount} LOGGED`}</p></div>
        ${thumb(p, 'stamp-img')}
        <p class="brand">${esc(p.brand)}</p><h1 class="display">${esc(p.model)}</h1>
        <p class="mono small">${F.date(w.date).toUpperCase()}${s.tag ? ' · TAG ' + esc(s.tag) : ''}</p>
        <div class="stat-grid three">
          <div><span class="label">Wears</span><b>${s.wearCount}</b></div>
          <div><span class="label">Cost / wear</span><b>${s.cpw == null ? '—' : F.rpShort(s.cpw)}</b></div>
          <div><span class="label">${s.running ? 'Km' : 'Owned'}</span><b>${s.running ? Math.round(s.km) : (s.daysOwned ?? '—') + 'd'}</b></div>
        </div>
        <div class="stack">
          ${dup ? `<button type="button" class="btn primary big" data-act="tapagain" data-id="${p.id}">Log another anyway</button>`
                : `<button type="button" class="btn primary big" data-act="editwear" data-id="${w.id}">${s.running ? 'Add km & memory' : 'Add a memory'}</button>`}
          <div class="row-btns">${dup ? '' : `<button type="button" class="btn" data-act="undotap" data-id="${w.id}">Undo</button>`}
            <button type="button" class="btn" data-act="go" data-to="pair/${p.id}">Done</button></div>
        </div>
      </section>`;
  }

  async function claim(serialArg) {
    const serial = normSerial(serialArg);
    const rows = [...state.coll.active].sort((a, b) => S.coldness(a.s) - S.coldness(b.s));
    view.innerHTML = `
      <section class="claim">
        <p class="eyebrow">New Sickboiss tag</p>
        <span class="tagchip big mono">${esc(serial)}</span>
        <h1 class="display">Which pair is this tag for?</h1>
        ${rows.length ? `<input type="search" id="cq" class="field" placeholder="Search your rack" autocomplete="off">
        <div class="claim-list">${rows.map(({ p, s }) => `<button type="button" class="claim-item" data-act="claimpick" data-id="${p.id}" data-serial="${esc(serial)}" data-q="${esc(`${p.brand} ${p.model} ${p.colorway}`.toLowerCase())}">
          ${thumb(p)}<span><b>${esc(p.model)}</b><em>${esc(p.brand)}${s.tag ? ' · has tag ' + esc(s.tag) : ''}</em></span></button>`).join('')}</div>`
        : `<p class="muted">Your rack is empty. Add the pair first, then tap the tag again.</p>
           <button type="button" class="btn primary big" data-act="go" data-to="add">Add a pair</button>`}
      </section>`;
    const cq = $('#cq');
    if (cq) cq.oninput = () => { const q = cq.value.toLowerCase(); $$('.claim-item').forEach((b) => { b.hidden = q && !b.dataset.q.includes(q); }); };
  }

  async function claimPick(pairId, serial) {
    const p = pairById(pairId);
    const ok = await confirmSheet({ title: `Link ${serial}?`, body: `Tag ${serial} will belong to ${pairName(p)}. Every tap after this logs a wear.`, ok: 'Link tag' });
    if (!ok) return;
    for (const t of state.data.tags) if (t.pairId === pairId && t.serial !== serial) await DB.put('tags', { ...t, pairId: null });
    await DB.put('tags', { serial, pairId, claimedAt: new Date().toISOString() });
    await refresh();
    const log = await confirmSheet({ title: 'Tag linked', body: `${serial} now opens ${p.model}. Log today's wear too?`, ok: 'Log a wear now' });
    if (log) { const w = await addWear(pairId, { source: 'nfc', occasion: p.category === 'running' ? 'Run' : null }); await refresh(); go('tapped/' + w.id); }
    else go('pair/' + pairId);
  }

  // ==================================================================== DEMO
  async function loadDemo() {
    if (state.data.pairs.length) {
      const ok = await confirmSheet({ title: 'Replace with the demo rack?', body: 'Everything on this phone will be replaced by 11 example pairs. Back up first if you want to keep your data.', ok: 'Load demo', danger: true });
      if (!ok) return;
    }
    await DB.eraseAll();
    await SB.demo.seed();
    await loadSettings(); await refresh();
    go('');
    toast('Demo rack loaded. These are example pairs.');
  }

  // ================================================================= ACTIONS
  const actions = {
    go: (el) => go(el.dataset.to),
    back: () => (history.length > 1 ? history.back() : go('collection')),
    demo: loadDemo,
    quicklog: (el) => quickLog(el.dataset.id),
    logwear: (el) => wearSheet(el.dataset.id),
    logcare: (el) => careSheet(el.dataset.id),
    value: (el) => valueSheet(el.dataset.id),
    status: (el) => statusSheet(el.dataset.id),
    passport: (el) => passportSheet(el.dataset.id),
    editwear: (el, e) => {
      if (e.target.closest('[data-act="delwear"]')) return;
      const w = state.data.wears.find((x) => x.id === el.dataset.id); if (w) wearSheet(w.pairId, w);
    },
    delwear: async (el) => {
      const w = state.data.wears.find((x) => x.id === el.dataset.id); if (!w) return;
      await DB.del('wears', w.id); await refresh(); await rerender();
      toast('Wear deleted', { label: 'Undo', run: async () => { await DB.put('wears', w); await refresh(); rerender(); } });
    },
    delcare: async (el) => {
      const c = state.data.care.find((x) => x.id === el.dataset.id); if (!c) return;
      await DB.del('care', c.id); await refresh(); await rerender();
      toast('Care entry deleted', { label: 'Undo', run: async () => { await DB.put('care', c); await refresh(); rerender(); } });
    },
    delpair: async (el) => {
      const p = pairById(el.dataset.id);
      const ok = await confirmSheet({ title: `Delete ${p.model}?`, body: 'Its wears, care log, values and photos go too. If you sold it, use Mark sold instead to keep its history.', ok: 'Delete pair', danger: true });
      if (!ok) return;
      await DB.deletePair(p.id); await refresh(); go('collection'); toast('Pair deleted');
    },
    progress: async (el) => {
      const [file] = await pickFiles(); if (!file) return;
      await DB.put('photos', { id: DB.uid(), pairId: el.dataset.id, kind: 'progress', date: S.today(), data: await compress(file) });
      await refresh(); await rerender(); toast('Progress photo added');
    },
    addphoto: async () => {
      const files = await pickFiles({ multiple: true });
      for (const f of files.slice(0, MAX_MAIN_PHOTOS - state.form.photos.length)) state.form.photos.push({ data: await compress(f), date: S.today() });
      drawPhotoRow();
    },
    rmphoto: (el) => {
      const [gone] = state.form.photos.splice(Number(el.dataset.i), 1);
      if (gone?.id) state.form.removed.push(gone.id);
      drawPhotoRow();
    },
    filter: (el) => { state.filter = el.dataset.v; rerender(); },
    rkind: (el) => { state.reportKind = el.dataset.v; state.reportOffset = 0; rerender(); },
    rprev: () => { state.reportOffset -= 1; rerender(); },
    rnext: () => { if (state.reportOffset < 0) { state.reportOffset += 1; rerender(); } },
    backup, restore,
    erase: async () => {
      const ok = await confirmSheet({ title: 'Erase everything?', body: 'Every pair, wear, photo and tag link on this phone will be deleted. This cannot be undone.', ok: 'Continue', danger: true });
      if (!ok) return;
      const sure = await confirmSheet({ title: 'Last check', body: 'Really erase the whole rack?', ok: 'Erase everything', danger: true });
      if (!sure) return;
      await DB.eraseAll(); await loadSettings(); await refresh(); go(''); toast('Rack erased');
    },
    copyurl: async () => {
      const txt = $('#m-url').textContent;
      try { await navigator.clipboard.writeText(txt); toast('Link copied'); }
      catch (e) { const r = document.createRange(); r.selectNodeContents($('#m-url')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Select and copy the link'); }
    },
    writetag: async () => {
      const serial = normSerial($('#m-serial').value);
      if (!serial) { toast('Enter the serial printed on the tag first'); return; }
      try {
        toast('Hold the tag to the back of your phone…');
        await new NDEFReader().write({ records: [{ recordType: 'url', data: $('#m-url').textContent }] });
        toast(`Written: ${serial}`);
      } catch (e) { toast(`Could not write the tag: ${e.message}`); }
    },
    unlink: async (el) => {
      const t = await DB.get('tags', el.dataset.id); if (!t) return;
      await DB.put('tags', { ...t, pairId: null }); await refresh(); await rerender(); toast(`${t.serial} unlinked`);
    },
    claimpick: (el) => claimPick(el.dataset.id, el.dataset.serial),
    undotap: async (el) => {
      const w = state.data.wears.find((x) => x.id === el.dataset.id);
      await DB.del('wears', el.dataset.id); await refresh(); toast('Tap undone'); go('pair/' + w.pairId);
    },
    tapagain: async (el) => {
      const p = pairById(el.dataset.id);
      const w = await addWear(p.id, { source: 'nfc', occasion: p.category === 'running' ? 'Run' : null });
      await refresh(); go('tapped/' + w.id);
    }
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // ==================================================================== BOOT
  async function loadSettings() {
    state.rainMode = await DB.getMeta('rainMode', false);
    state.displayName = await DB.getMeta('displayName', '');
    state.lastBackup = await DB.getMeta('lastBackup', null);
  }

  async function boot() {
    await DB.open();
    await loadSettings();
    await refresh();
    const params = new URLSearchParams(location.search);
    const tag = params.get('tag');
    if (tag) {
      const route = await handleTag(tag);
      history.replaceState(null, '', location.pathname + '#/' + route);
    }
    window.addEventListener('hashchange', render);
    await render();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  boot().catch((e) => {
    console.error(e);
    view.innerHTML = `<section class="empty"><h1 class="display">Something broke</h1><p class="muted">${esc(e.message)}</p>
      <p class="muted small">If you are in a private browsing window, the app cannot save data. Open it in a normal window.</p></section>`;
  });
})();
