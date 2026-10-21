/* ==========================================================================
   Sickboiss Shoe Log — exports.js
   Formatting helpers + the two hero exports, drawn on <canvas>:
     • Pair Passport  — one pair
     • Sneaker Report — one period (month / quarter / year)
   Each renders in two formats from the same layout code:
     story → 1080 × 1920 PNG for Instagram Stories
     a4    → 1240 × 1754 canvas placed on an A4 PDF page (jsPDF)
   ========================================================================== */
window.SB = window.SB || {};

/* ---------- formatting (Rupiah, dates) ---------- */
SB.fmt = (() => {
  const dec = (n, d) => n.toFixed(d).replace(/\.?0+$/, '').replace('.', ',');
  const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
  function rpShort(n) {
    const v = Math.abs(Number(n) || 0); const s = n < 0 ? '−' : '';
    if (v >= 1e9) return `${s}Rp ${dec(v / 1e9, 2)} M`;
    if (v >= 1e6) return `${s}Rp ${dec(v / 1e6, 2)} jt`;
    if (v >= 1e3) return `${s}Rp ${Math.round(v / 1e3)} rb`;
    return `${s}Rp ${Math.round(v)}`;
  }
  const signed = (n) => (n > 0 ? '+' : '') + rpShort(n);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function date(s) {
    if (!s) return '—';
    const [y, m, d] = s.split('-').map(Number);
    return `${d} ${MON[m - 1]} ${y}`;
  }
  function ago(days) {
    if (days == null) return 'never';
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 45) return `${days}d ago`;
    if (days < 365) return `${Math.round(days / 30)}mo ago`;
    return `${dec(days / 365, 1)}y ago`;
  }
  const km = (n) => `${dec(Number(n) || 0, 1)} km`;
  return { rp, rpShort, signed, date, ago, km, MON };
})();

/* ---------- exports ---------- */
SB.exports = (() => {
  const C = {
    ink: '#0E0E0E', panel: '#181818', line: '#2E2E2E', bone: '#F2EFE8', mute: '#9A958C',
    orange: '#FF5A1F', mint: '#3DDC97', red: '#FF4D4D', blue: '#4DA3FF'
  };
  const DISPLAY = 'Anton, Impact, "Arial Narrow", sans-serif';
  const BODY = '-apple-system, "Helvetica Neue", Arial, sans-serif';
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const SIZES = { story: [1080, 1920], a4: [1240, 1754] };
  const F = SB.fmt;

  async function fontsReady() {
    try { await document.fonts.load(`80px Anton`); await document.fonts.ready; } catch (e) { /* fallback faces */ }
  }

  const loadImg = (src) => new Promise((res) => {
    if (!src) return res(null);
    const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
  });

  function makeCanvas(format) {
    const [W, H] = SIZES[format];
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const k = Math.min(W / 1080, H / 1920);       // type/height scale
    const M = Math.round(W * 0.065);               // side margin
    ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
    grain(ctx, W, H);
    return { cv, ctx, W, H, k, M };
  }

  /** Very faint print grain so the export feels like paper stock, not a screen. */
  function grain(ctx, W, H) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.fillStyle = 'rgba(242,239,232,0.035)';
    for (let i = 0; i < (W * H) / 900; i++) ctx.fillRect(rnd() * W, rnd() * H, 1.4, 1.4);
  }

  function font(ctx, size, family = BODY, weight = '400', style = '') {
    ctx.font = `${style} ${weight} ${Math.round(size)}px ${family}`.trim();
  }

  function text(ctx, s, x, y, { size, family = BODY, color = C.bone, weight = '400', align = 'left', style = '', spacing = 0 }) {
    font(ctx, size, family, weight, style);
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(s, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  /** Word-wrap into at most maxLines lines; last line gets an ellipsis if cut. */
  function wrap(ctx, s, maxW, maxLines) {
    const words = String(s || '').split(/\s+/).filter(Boolean);
    const lines = []; let cur = '';
    for (let i = 0; i < words.length; i++) {
      const test = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW || !cur) { cur = test; continue; }
      lines.push(cur); cur = words[i];
      if (lines.length === maxLines) { cur = null; break; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) lines.length = maxLines;
    const used = lines.join(' ').split(/\s+/).length;
    if (used < words.length && lines.length) {
      let last = lines[lines.length - 1];
      while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[lines.length - 1] = last.trim() + '…';
    }
    return lines;
  }

  /** Largest display size (≤ max) that fits the text in maxLines. */
  function fitDisplay(ctx, s, maxW, max, min, maxLines) {
    for (let size = max; size >= min; size -= 4) {
      font(ctx, size, DISPLAY);
      const lines = wrap(ctx, s, maxW, maxLines);
      if (!lines.some((l) => l.endsWith('…'))) return { size, lines };
    }
    font(ctx, min, DISPLAY);
    return { size: min, lines: wrap(ctx, s, maxW, maxLines) };
  }

  function rule(ctx, x1, y, x2, color = C.line, w = 2) {
    ctx.fillStyle = color; ctx.fillRect(x1, y, x2 - x1, w);
  }

  /** Object-fit: cover into a rectangle. */
  function cover(ctx, img, x, y, w, h) {
    const r = Math.max(w / img.width, h / img.height);
    const sw = w / r; const sh = h / r;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }

  /** Placeholder when a pair has no photo: hazard stripes + brand initials. */
  function placeholder(ctx, x, y, w, h, label, k) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = C.panel; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(242,239,232,0.05)'; ctx.lineWidth = 18 * k;
    for (let i = -h; i < w; i += 60 * k) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.stroke(); }
    const ini = String(label || 'SB').split(/\s+/).map((s) => s[0]).join('').slice(0, 3).toUpperCase();
    text(ctx, ini, x + w / 2, y + h / 2 + h * 0.12, { size: h * 0.34, family: DISPLAY, color: 'rgba(242,239,232,0.16)', align: 'center' });
    ctx.restore();
  }

  /** Deterministic barcode from a string — box-label detail. */
  function barcode(ctx, s, x, y, w, h, color = C.bone) {
    let hsh = 2166136261;
    for (const ch of String(s)) { hsh ^= ch.charCodeAt(0); hsh = Math.imul(hsh, 16777619) >>> 0; }
    const bars = []; let total = 0;
    for (let i = 0; i < 46; i++) { hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177) >>> 0; const bw = 1 + (hsh % 4); bars.push(bw); total += bw; }
    const unit = w / total; let cx = x;
    ctx.fillStyle = color;
    bars.forEach((bw, i) => { if (i % 2 === 0) ctx.fillRect(cx, y, bw * unit, h); cx += bw * unit; });
  }

  function header(ctx, W, M, k, right) {
    const y = M + 44 * k;
    text(ctx, 'SICKBOISS', M, y, { size: 52 * k, family: DISPLAY, spacing: 2 * k });
    text(ctx, right, W - M, y - 8 * k, { size: 22 * k, family: MONO, color: C.mute, align: 'right', spacing: 3 * k });
    rule(ctx, M, y + 22 * k, W - M, C.bone, 3 * k);
    return y + 22 * k;
  }

  function footer(ctx, W, H, M, k, line1, line2, code) {
    const y = H - M;
    rule(ctx, M, y - 96 * k, W - M, C.line, 2);
    barcode(ctx, code, M, y - 72 * k, 230 * k, 56 * k);
    text(ctx, line1, W - M, y - 44 * k, { size: 22 * k, family: MONO, color: C.bone, align: 'right', spacing: 1 * k });
    text(ctx, line2, W - M, y - 14 * k, { size: 20 * k, family: MONO, color: C.mute, align: 'right', spacing: 1 * k });
    return y - 96 * k;   // usable bottom edge
  }

  /** A grid of label/value stat cells with hairline dividers. */
  function statGrid(ctx, cells, x, y, w, cols, cellH, k) {
    const cw = w / cols;
    cells.forEach((c, i) => {
      const cx = x + (i % cols) * cw; const cy = y + Math.floor(i / cols) * cellH;
      if (i % cols) { ctx.fillStyle = C.line; ctx.fillRect(cx, cy + 10 * k, 2, cellH - 20 * k); }
      text(ctx, c.label, cx + (i % cols ? 22 * k : 0), cy + 34 * k, { size: 20 * k, family: MONO, color: C.mute, spacing: 2 * k });
      font(ctx, 56 * k, DISPLAY);
      let size = 56 * k;
      while (ctx.measureText(c.value).width > cw - 34 * k && size > 26 * k) { size -= 2; font(ctx, size, DISPLAY); }
      text(ctx, c.value, cx + (i % cols ? 22 * k : 0), cy + 34 * k + size + 8 * k, { size, family: DISPLAY, color: c.color || C.bone });
    });
    const rows = Math.ceil(cells.length / cols);
    for (let r = 1; r < rows; r++) rule(ctx, x, y + r * cellH, x + w, C.line, 2);
    return y + rows * cellH;
  }

  // ======================================================================
  // PAIR PASSPORT
  // ======================================================================
  /**
   * @param {object} d { pair, s (SB.stats.pair), photo (dataURL|null), memories: [{date,memory}], displayName }
   */
  async function passport(d, format = 'story') {
    await fontsReady();
    const { cv, ctx, W, H, k, M } = makeCanvas(format);
    const { pair: p, s } = d;
    const no = s.tag || ('P-' + String(p.id).replace(/-/g, '').slice(0, 6).toUpperCase());

    let y = header(ctx, W, M, k, `PAIR PASSPORT · No. ${no}`);
    const bottom = footer(ctx, W, H, M, k,
      s.tag ? `VERIFIED WITH SICKBOISS TAG ${s.tag}` : 'LOGGED WITH SICKBOISS SHOE LOG',
      `ISSUED ${F.date(SB.stats.today()).toUpperCase()}${d.displayName ? ' · ' + d.displayName.toUpperCase() : ''}`, no);

    // Photo
    y += 30 * k;
    const photoH = format === 'story' ? 760 * k : 640 * k;
    const img = await loadImg(d.photo);
    if (img) cover(ctx, img, M, y, W - 2 * M, photoH); else placeholder(ctx, M, y, W - 2 * M, photoH, `${p.brand} ${p.model}`, k);
    // Condition badge
    if (p.condition) {
      font(ctx, 28 * k, DISPLAY); const bw = ctx.measureText(p.condition).width + 36 * k;
      ctx.fillStyle = C.orange; ctx.fillRect(M, y, bw, 52 * k);
      text(ctx, p.condition, M + 18 * k, y + 38 * k, { size: 28 * k, family: DISPLAY, color: C.ink });
    }
    if (s.running) {
      ctx.fillStyle = C.blue; font(ctx, 24 * k, DISPLAY);
      const lw = ctx.measureText('RUNNING').width + 32 * k;
      ctx.fillRect(W - M - lw, y, lw, 52 * k);
      text(ctx, 'RUNNING', W - M - lw / 2, y + 37 * k, { size: 24 * k, family: DISPLAY, color: C.ink, align: 'center' });
    }
    y += photoH + 54 * k;

    // Identity
    text(ctx, String(p.brand || '').toUpperCase(), M, y, { size: 26 * k, family: MONO, color: C.orange, spacing: 4 * k });
    y += 12 * k;
    const t = fitDisplay(ctx, String(p.model || 'Untitled pair').toUpperCase(), W - 2 * M, 108 * k, 60 * k, 2);
    for (const line of t.lines) { y += t.size * 1.02; text(ctx, line, M, y, { size: t.size, family: DISPLAY }); }
    y += 46 * k;
    const meta = [p.colorway, p.size && `Size ${p.size}`, p.styleCode].filter(Boolean).join('  ·  ');
    if (meta) { text(ctx, meta, M, y, { size: 28 * k, family: BODY, color: C.mute }); y += 24 * k; }
    y += 22 * k; rule(ctx, M, y, W - M, C.bone, 2);

    // Stats
    const gainColor = s.gain == null ? C.bone : s.gain >= 0 ? C.mint : C.red;
    const cells = [
      { label: 'WEARS', value: String(s.wearCount) },
      { label: 'COST / WEAR', value: s.cpw == null ? '—' : F.rpShort(s.cpw) },
      s.running ? { label: 'DISTANCE', value: F.km(s.km), color: C.blue }
                : { label: 'DAYS OWNED', value: s.daysOwned == null ? '—' : String(s.daysOwned) },
      { label: 'PAID', value: F.rpShort(p.price) },
      { label: 'VALUE', value: F.rpShort(s.value) },
      { label: 'GAIN', value: s.gain == null ? '—' : F.signed(s.gain), color: gainColor }
    ];
    y = statGrid(ctx, cells, M, y + 4 * k, W - 2 * M, 3, 128 * k, k);
    rule(ctx, M, y, W - M, C.bone, 2);

    // Running retirement bar
    if (s.running && y + 70 * k < bottom) {
      y += 46 * k;
      text(ctx, `RETIREMENT  ${Math.round(s.kmPct * 100)}% OF ${s.retireKm} KM`, M, y, { size: 20 * k, family: MONO, color: C.mute, spacing: 2 * k });
      y += 18 * k;
      ctx.fillStyle = C.panel; ctx.fillRect(M, y, W - 2 * M, 14 * k);
      ctx.fillStyle = s.kmPct >= 0.9 ? C.red : C.blue; ctx.fillRect(M, y, (W - 2 * M) * Math.min(1, s.kmPct), 14 * k);
      y += 14 * k;
    }

    // Care line
    if (y + 60 * k < bottom) {
      y += 50 * k;
      const care = s.lastCare ? `LAST CARE  ${s.lastCare.type.toUpperCase()} · ${F.date(s.lastCare.date).toUpperCase()}` : 'LAST CARE  NONE LOGGED';
      text(ctx, care, M, y, { size: 20 * k, family: MONO, color: C.mute, spacing: 2 * k });
    }

    // Story
    if (p.story && y + 150 * k < bottom) {
      y += 70 * k;
      text(ctx, '“', M - 6 * k, y + 52 * k, { size: 130 * k, family: DISPLAY, color: C.orange });
      font(ctx, 34 * k, BODY, '400', 'italic');
      const room = Math.max(1, Math.min(4, Math.floor((bottom - y - 60 * k) / (46 * k))));
      const lines = wrap(ctx, p.story, W - 2 * M - 80 * k, room);
      lines.forEach((l, i) => text(ctx, l, M + 80 * k, y + i * 46 * k, { size: 34 * k, style: 'italic' }));
      y += (lines.length - 1) * 46 * k;
    }

    // Memories
    const mems = (d.memories || []).slice(0, 3);
    if (mems.length && y + 120 * k < bottom) {
      y += 64 * k;
      text(ctx, 'WEAR MEMORIES', M, y, { size: 20 * k, family: MONO, color: C.orange, spacing: 3 * k });
      for (const m of mems) {
        if (y + 56 * k > bottom - 10 * k) break;
        y += 46 * k;
        text(ctx, F.date(m.date).toUpperCase(), M, y, { size: 20 * k, family: MONO, color: C.mute });
        font(ctx, 28 * k, BODY);
        const l = wrap(ctx, m.memory, W - 2 * M - 230 * k, 1)[0] || '';
        text(ctx, l, M + 230 * k, y, { size: 28 * k });
      }
    }
    return cv;
  }

  // ======================================================================
  // SNEAKER REPORT
  // ======================================================================
  /**
   * @param {object} r      SB.stats.report(...)
   * @param {object} photos { pairId: dataURL }
   */
  async function report(r, photos, displayName, format = 'story') {
    await fontsReady();
    const { cv, ctx, W, H, k, M } = makeCanvas(format);
    const per = r.period;
    let y = header(ctx, W, M, k, 'SNEAKER REPORT');
    const bottom = footer(ctx, W, H, M, k, 'LOGGED WITH SICKBOISS SHOE LOG',
      `${F.date(per.start).toUpperCase()} – ${F.date(per.end).toUpperCase()}`, per.label + (displayName || ''));

    // Period + name
    y += 118 * k;
    const pl = fitDisplay(ctx, per.label, W - 2 * M, 128 * k, 70 * k, 1);
    text(ctx, pl.lines[0], M, y, { size: pl.size, family: DISPLAY });
    y += 46 * k;
    text(ctx, (displayName ? `${displayName.toUpperCase()}'S RACK` : 'YOUR RACK') + `  ·  ${r.ownedCount} PAIRS`, M, y, { size: 22 * k, family: MONO, color: C.mute, spacing: 3 * k });

    // Persona block
    y += 34 * k;
    const pH = 286 * k; const pc = r.persona.color;
    ctx.fillStyle = pc; ctx.fillRect(M, y, W - 2 * M, pH);
    text(ctx, 'THIS PERIOD YOU WERE', M + 36 * k, y + 56 * k, { size: 22 * k, family: MONO, color: C.ink, spacing: 3 * k });
    const pn = fitDisplay(ctx, r.persona.name, W - 2 * M - 72 * k, 104 * k, 56 * k, 1);
    text(ctx, pn.lines[0], M + 36 * k, y + 70 * k + pn.size, { size: pn.size, family: DISPLAY, color: C.ink });
    text(ctx, r.persona.line, M + 36 * k, y + pH - 40 * k, { size: 32 * k, family: BODY, color: C.ink, style: 'italic' });
    y += pH;

    // Big numbers
    y += 28 * k;
    const big = [
      { label: 'WEARS', value: String(r.totalWears) },
      { label: 'PAIRS WORN', value: `${r.pairsWorn}/${r.ownedCount}` },
      r.km > 0 ? { label: 'KM RUN', value: String(Math.round(r.km)), color: C.blue }
               : { label: 'BUSIEST DAY', value: r.busiest ? r.busiest.slice(0, 3) : '—' }
    ];
    y = statGrid(ctx, big, M, y, W - 2 * M, 3, 128 * k, k);
    rule(ctx, M, y, W - M, C.bone, 2);

    if (!r.totalWears) {
      y += 120 * k;
      text(ctx, 'NO WEARS LOGGED', W / 2, y, { size: 72 * k, family: DISPLAY, color: C.mute, align: 'center' });
      y += 56 * k;
      text(ctx, 'Tap your tag or hit Log wear. The rack is waiting.', W / 2, y, { size: 30 * k, color: C.mute, align: 'center' });
      return cv;
    }

    // Most worn card
    y += 34 * k;
    const th = 250 * k;
    if (r.top) {
      const img = await loadImg(photos[r.top.p.id]);
      if (img) cover(ctx, img, M, y, th, th); else placeholder(ctx, M, y, th, th, `${r.top.p.brand} ${r.top.p.model}`, k);
      const tx = M + th + 34 * k; const tw = W - M - tx;
      text(ctx, 'MOST WORN', tx, y + 28 * k, { size: 20 * k, family: MONO, color: C.orange, spacing: 3 * k });
      text(ctx, String(r.top.p.brand || '').toUpperCase(), tx, y + 66 * k, { size: 22 * k, family: MONO, color: C.mute, spacing: 2 * k });
      const mt = fitDisplay(ctx, String(r.top.p.model).toUpperCase(), tw, 60 * k, 38 * k, 2);
      mt.lines.forEach((l, i) => text(ctx, l, tx, y + 76 * k + (i + 1) * mt.size, { size: mt.size, family: DISPLAY }));
      text(ctx, `×${r.top.n}`, tx, y + th - 4 * k, { size: 72 * k, family: DISPLAY, color: C.orange });
      text(ctx, 'WEARS', tx + (() => { font(ctx, 72 * k, DISPLAY); return ctx.measureText(`×${r.top.n}`).width; })() + 14 * k, y + th - 12 * k, { size: 22 * k, family: MONO, color: C.mute, spacing: 2 * k });
    }
    y += th + 30 * k;

    // Champion / dust
    rule(ctx, M, y, W - M, C.line, 2);
    const half = (W - 2 * M) / 2;
    const cell = (x, label, color, title, sub) => {
      text(ctx, label, x, y + 40 * k, { size: 20 * k, family: MONO, color, spacing: 3 * k });
      font(ctx, 40 * k, DISPLAY);
      text(ctx, wrap(ctx, title, half - 30 * k, 1)[0] || '—', x, y + 92 * k, { size: 40 * k, family: DISPLAY });
      text(ctx, sub, x, y + 128 * k, { size: 24 * k, family: BODY, color: C.mute });
    };
    cell(M, 'CPW CHAMPION', C.mint, r.champ ? String(r.champ.p.model).toUpperCase() : '—',
      r.champ ? `${F.rpShort(r.champ.s.cpw)} per wear` : 'Needs 3+ wears');
    ctx.fillStyle = C.line; ctx.fillRect(M + half, y + 14 * k, 2, 124 * k);
    cell(M + half + 26 * k, 'GATHERING DUST', C.red, r.neglected ? String(r.neglected.p.model).toUpperCase() : 'NOTHING',
      r.neglected ? `Last worn ${F.ago(r.neglected.s.daysSinceWorn)}` : 'Every pair got worn');
    y += 154 * k;
    rule(ctx, M, y, W - M, C.line, 2);

    // Heatmap (weeks as columns, weekdays as rows)
    if (y + 200 * k < bottom) {
      y += 42 * k;
      text(ctx, 'WEAR CALENDAR', M, y, { size: 20 * k, family: MONO, color: C.mute, spacing: 3 * k });
      if (r.busiest) text(ctx, `BUSIEST: ${r.busiest}`, W - M, y, { size: 20 * k, family: MONO, color: C.bone, align: 'right', spacing: 2 * k });
      y += 20 * k;
      const S = SB.stats; const start = S.parse(per.start);
      const lead = start.getDay(); const days = S.daysBetween(per.start, per.end) + 1;
      const weeks = Math.ceil((lead + days) / 7);
      const gap = Math.max(2, 4 * k);
      const max = Math.max(1, ...Object.values(r.perDay));
      // Short periods (a month) read best as a calendar: weekdays across, weeks down.
      // Longer periods use GitHub-style columns: weeks across, weekdays down.
      const calendar = weeks <= 6;
      const cols = calendar ? 7 : weeks; const rows = calendar ? weeks : 7;
      const cw = ((W - 2 * M) - gap * (cols - 1)) / cols;
      const ch = calendar ? Math.min(cw, 44 * k) : Math.min(cw, 56 * k);
      for (let i = 0; i < days; i++) {
        const day = S.addDays(per.start, i); const slot = lead + i;
        const col = calendar ? slot % 7 : Math.floor(slot / 7);
        const row = calendar ? Math.floor(slot / 7) : slot % 7;
        const cx = M + col * (cw + gap); const cy = y + row * (ch + gap);
        const n = r.perDay[day] || 0;
        ctx.fillStyle = n ? `rgba(255,90,31,${0.35 + 0.65 * (n / max)})` : C.panel;
        ctx.fillRect(cx, cy, calendar ? cw : Math.min(cw, ch), ch);
      }
      y += rows * (ch + gap) + 4 * k;
    }

    // Money row
    if (y + 150 * k < bottom) {
      y += 18 * k; rule(ctx, M, y, W - M, C.line, 2);
      const vc = r.valueChange;
      y = statGrid(ctx, [
        { label: 'NEW PAIRS', value: r.purchases.length ? F.rpShort(r.spentNew) : 'Rp 0' },
        { label: 'CARE SPEND', value: F.rpShort(r.spentCare) },
        { label: 'RACK VALUE', value: vc === 0 ? '±0' : F.signed(vc), color: vc > 0 ? C.mint : vc < 0 ? C.red : C.bone }
      ], M, y + 4 * k, W - 2 * M, 3, 118 * k, k);
    }

    // Brand split
    if (r.brandSplit.length && y + 120 * k < bottom) {
      rule(ctx, M, y, W - M, C.line, 2);
      y += 42 * k;
      text(ctx, 'BRAND SPLIT', M, y, { size: 20 * k, family: MONO, color: C.mute, spacing: 3 * k });
      y += 14 * k;
      const total = r.totalWears; let x = M; const bw = W - 2 * M;
      const shades = [C.orange, C.bone, C.mute, '#5A5650', '#3A3733'];
      const parts = r.brandSplit.slice(0, 4);
      const rest = total - parts.reduce((t, b) => t + b[1], 0);
      if (rest > 0) parts.push(['Other', rest]);
      parts.forEach(([, n], i) => { const w = bw * (n / total); ctx.fillStyle = shades[i]; ctx.fillRect(x, y, w - 3, 26 * k); x += w; });
      y += 58 * k;
      font(ctx, 22 * k, MONO);
      let lx = M;
      parts.forEach(([b, n], i) => {
        const label = `${String(b).toUpperCase()} ${Math.round((n / total) * 100)}%`;
        const lw = ctx.measureText(label).width + 50 * k;
        if (lx + lw > W - M) return;
        ctx.fillStyle = shades[i]; ctx.fillRect(lx, y - 18 * k, 18 * k, 18 * k);
        text(ctx, label, lx + 28 * k, y, { size: 22 * k, family: MONO, color: C.bone });
        lx += lw;
      });
    }

    // Pair of the period quote
    if (r.feature && r.feature.memory && y + 130 * k < bottom) {
      y += 64 * k;
      text(ctx, '“', M - 6 * k, y + 46 * k, { size: 120 * k, family: DISPLAY, color: r.persona.color });
      font(ctx, 32 * k, BODY, '400', 'italic');
      const room = Math.max(1, Math.min(3, Math.floor((bottom - y - 50 * k) / (44 * k))));
      const lines = wrap(ctx, r.feature.memory, W - 2 * M - 80 * k, room);
      lines.forEach((l, i) => text(ctx, l, M + 80 * k, y + i * 44 * k, { size: 32 * k, style: 'italic' }));
      y += lines.length * 44 * k;
      text(ctx, `— ${String(r.feature.p.model).toUpperCase()}`, M + 80 * k, y + 4 * k, { size: 20 * k, family: MONO, color: C.mute, spacing: 2 * k });
    }
    return cv;
  }

  // ---- output ---------------------------------------------------------------
  const toBlob = (cv, type = 'image/png', q) => new Promise((res) => cv.toBlob(res, type, q));

  function toPdfBlob(cv) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    return pdf.output('blob');
  }

  /** Share sheet on phones (save to Photos / Files / IG), download link elsewhere. */
  async function deliver(blob, filename, title) {
    const file = new File([blob], filename, { type: blob.type });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  }

  return { passport, report, toBlob, toPdfBlob, deliver, COLORS: C };
})();
