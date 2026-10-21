/* ==========================================================================
   Sickboiss Shoe Log — demo.js
   Builds an example rack (11 pairs, ~8 months of wears, care and values) so
   testers can see every screen filled in. Deterministic: same data each time,
   anchored to today's date. No photos — the app shows placeholders.
   ========================================================================== */
window.SB = window.SB || {};

SB.demo = (() => {
  async function seed() {
    const S = SB.stats; const DB = SB.db;
    const today = S.today(); const ago = (n) => S.addDays(today, -n);
    let s = 20261021;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pick = (a) => a[Math.floor(rnd() * a.length)];

    const pairs = [
      { key: 'aj1', brand: 'Jordan', model: 'Air Jordan 1 High OG', colorway: 'Chicago Lost & Found', styleCode: 'DZ5485-612', size: 'EU 42.5',
        purchaseDate: '2022-11-19', price: 2999000, store: 'Raffle · official store', condition: '8/10', boxCondition: 'OG box, aged on purpose',
        accessories: 'Extra laces, hangtag, receipt', materials: ['leather'], careEvery: 8, priorWears: 41, weight: 6,
        story: 'Took three raffles and a 4am queue to get these. The pair that made me take collecting seriously.',
        values: [[200, 4500000], [30, 4800000]] },
      { key: 'panda', brand: 'Nike', model: 'Dunk Low Retro', colorway: 'Panda', styleCode: 'DD1391-100', size: 'EU 42.5',
        purchaseDate: '2023-02-10', price: 1549000, store: 'Nike app', condition: 'Beater', boxCondition: 'Gone',
        accessories: '', materials: ['leather'], careEvery: 12, priorWears: 120, weight: 14,
        story: 'Everyone has one. Mine has been to every office, every airport, every rainy commute.', values: [[60, 1450000]] },
      { key: '990', brand: 'New Balance', model: '990v6', colorway: 'Grey', styleCode: 'M990GL6', size: 'EU 43',
        purchaseDate: '2024-05-03', price: 3499000, store: 'NB store, Senayan', condition: '9/10', boxCondition: 'OG box',
        accessories: 'Extra laces', materials: ['suede', 'knit/mesh'], careEvery: 10, priorWears: 22, weight: 8,
        story: 'Dad shoe era. Comfiest pair in the rack.', values: [[120, 3200000]] },
      { key: 'samba', brand: 'adidas', model: 'Samba OG', colorway: 'Cloud White / Core Black', styleCode: 'B75806', size: 'EU 42',
        purchaseDate: '2024-09-14', price: 2200000, store: 'Reseller', condition: '8/10', boxCondition: 'OG box',
        accessories: '', materials: ['leather', 'suede'], careEvery: 10, priorWears: 15, weight: 9, story: '', values: [[90, 1900000]] },
      { key: 'compass', brand: 'Compass', model: 'Gazelle Low', colorway: 'Black White', styleCode: '', size: 'EU 42',
        purchaseDate: '2023-08-17', price: 498000, store: 'Drop at Bandung', condition: '8/10', boxCondition: 'OG box',
        accessories: 'Sticker pack', materials: ['canvas'], careEvery: 10, priorWears: 35, weight: 7,
        story: 'First Indonesian pair in the rack. Local pride, worn hard.', values: [[45, 650000]] },
      { key: 'kayano', brand: 'ASICS', model: 'GEL-Kayano 14', colorway: 'Cream / Black', styleCode: '1201A019-108', size: 'EU 42.5',
        purchaseDate: '2024-12-20', price: 2399000, store: 'Official store', condition: '9/10', boxCondition: 'OG box',
        accessories: '', materials: ['knit/mesh', 'synthetic'], careEvery: 10, priorWears: 6, weight: 5, story: '', values: [] },
      { key: 'xt6', brand: 'Salomon', model: 'XT-6', colorway: 'Black Phantom', styleCode: 'L41086600', size: 'EU 42 2/3',
        purchaseDate: '2025-03-08', price: 2900000, store: 'Salomon store', condition: '9/10', boxCondition: 'OG box',
        accessories: '', materials: ['synthetic'], careEvery: 10, priorWears: 4, weight: 3, story: 'Rain mode MVP.', values: [] },
      { key: 'am90', brand: 'Nike', model: 'Air Max 90', colorway: 'Infrared', styleCode: 'CT1685-100', size: 'EU 42.5',
        purchaseDate: '2020-03-26', price: 1999000, store: 'Nike store, Grand Indonesia', condition: 'VNDS', boxCondition: 'OG box',
        accessories: 'Hangtag', materials: ['leather', 'suede', 'knit/mesh'], careEvery: 10, priorWears: 9, weight: 0,
        lastWornBefore: ago(290), story: 'Bought a week before lockdown. Barely went anywhere, like the rest of us.', values: [[300, 2400000]] },
      { key: 'peg', brand: 'Nike', model: 'Pegasus 41', colorway: 'Black / White', styleCode: 'FD2722-002', size: 'EU 43',
        category: 'running', purchaseDate: ago(250), price: 1899000, store: 'Nike app', condition: '7/10', boxCondition: 'Recycled',
        accessories: '', materials: ['knit/mesh'], careEvery: 20, priorWears: 0, retireKm: 700, story: 'Daily trainer. Base miles for the half.', values: [] },
      { key: 'boston', brand: 'adidas', model: 'Adizero Boston 12', colorway: 'Lucid Lemon', styleCode: 'IF9213', size: 'EU 43',
        category: 'running', purchaseDate: ago(210), price: 2600000, store: 'Running store', condition: '9/10', boxCondition: 'OG box',
        accessories: '', materials: ['knit/mesh'], careEvery: 20, priorWears: 0, retireKm: 650, story: 'Tempo days only.', values: [] },
      { key: 'aj4', brand: 'Jordan', model: 'Air Jordan 4 Retro', colorway: 'Bred Reimagined', styleCode: 'FV5029-006', size: 'EU 42.5',
        purchaseDate: '2024-02-17', price: 3099000, store: 'Raffle', condition: '9/10', boxCondition: 'OG box',
        accessories: 'Extra laces', materials: ['leather'], careEvery: 10, priorWears: 6, weight: 0, status: 'sold', statusDate: '2025-09-20', soldPrice: 4200000,
        story: 'Flipped it to fund the 990s. No regrets. Mostly.', values: [] }
    ];

    const ids = {};
    for (const p of pairs) {
      ids[p.key] = DB.uid();
      const { key, weight, values, ...rest } = p;
      await DB.put('pairs', { category: 'lifestyle', status: 'active', retireKm: 700, priorKm: 0, rainSafe: null,
        createdAt: Date.now(), ...rest, id: ids[key] });
      for (const [d, v] of values) await DB.put('values', { id: DB.uid(), pairId: ids[key], date: ago(d), value: v, source: 'manual' });
    }

    const MEMORIES = [
      'Sickboiss meetup at Blok M. Three people asked about these.',
      'Wedding reception, changed into these after the ceremony.',
      'Rained the whole walk home. Survived.',
      'Client pitch day. We won it.',
      'Sunday market run with the whole family.',
      'Gig at Kemang. Stepped on twice, still clean.',
      'Airport run to Bali.',
      'First 20 km long run without stopping.',
      'Coffee crawl around Braga.'
    ];
    const OCC = ['Daily', 'Daily', 'Work', 'Work', 'Night out', 'Event', 'Travel', 'Gig', null, null];
    const wearsBy = {};
    const put = async (pairId, date, extra) => {
      const w = { id: DB.uid(), pairId, date, km: null, occasion: null, memory: '', source: 'manual',
                  createdAt: S.parse(date).getTime() + 9 * 3600000, ...extra };
      if (rnd() < 0.06 && MEMORIES.length) w.memory = MEMORIES.splice(Math.floor(rnd() * MEMORIES.length), 1)[0];
      (wearsBy[pairId] = wearsBy[pairId] || []).push(w);
      await DB.put('wears', w);
    };

    const life = pairs.filter((p) => p.category !== 'running' && p.weight > 0);
    for (let d = 239; d >= 0; d--) {
      const day = ago(d);
      if (rnd() < 0.8) {
        const pool = life.filter((p) => p.purchaseDate <= day);
        const total = pool.reduce((t, p) => t + p.weight, 0);
        let r = rnd() * total; let chosen = pool[0];
        for (const p of pool) { r -= p.weight; if (r <= 0) { chosen = p; break; } }
        await put(ids[chosen.key], day, { occasion: pick(OCC), source: chosen.key === 'aj1' && rnd() < 0.5 ? 'nfc' : (rnd() < 0.3 ? 'quick' : 'manual') });
      }
      const dow = S.parse(day).getDay();
      if ([2, 4, 0].includes(dow) && rnd() < 0.6) {
        const bostonOwned = pairs.find((p) => p.key === 'boston').purchaseDate <= day;
        const isLong = dow === 0;
        const useBoston = bostonOwned && !isLong && rnd() < 0.55;
        const km = Math.round((isLong ? 16 + rnd() * 8 : useBoston ? 8 + rnd() * 6 : 6 + rnd() * 5) * 10) / 10;
        await put(ids[useBoston ? 'boston' : 'peg'], day, { occasion: 'Run', km });
      }
    }

    // Care: a clean roughly every careEvery wears, some by a shop.
    for (const p of pairs) {
      let n = 0;
      for (const w of wearsBy[ids[p.key]] || []) {
        if (++n >= p.careEvery && rnd() < 0.75) {
          n = 0;
          const shop = rnd() < 0.35;
          await DB.put('care', { id: DB.uid(), pairId: ids[p.key], date: S.addDays(w.date, 1) > today ? w.date : S.addDays(w.date, 1),
            type: rnd() < 0.2 ? 'Washing' : 'Cleaning', detail: shop ? 'Deep clean' : 'Wipe down + midsole', cost: shop ? 65000 : 0,
            by: shop ? 'Local sneaker laundry' : 'Me' });
        }
      }
    }
    await DB.put('care', { id: DB.uid(), pairId: ids.aj1, date: ago(150), type: 'Retooling', detail: 'Toe box reglue + sole stitch', cost: 150000, by: 'Local cobbler' });

    await DB.put('tags', { serial: 'SB-00421', pairId: ids.aj1, claimedAt: ago(200) });
    await DB.put('tags', { serial: 'SB-00422', pairId: ids.peg, claimedAt: ago(200) });
  }
  return { seed };
})();
