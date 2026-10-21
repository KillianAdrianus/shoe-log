# Sickboiss Shoe Log: prototype

A phone-first sneaker log for the Sickboiss community. It's an installable web app (PWA) that works offline. Every user's collection lives in their own phone's database (IndexedDB), with no login and no server costs.

## What's in it

- **Rack**: up to 100 active pairs with brand, model, colorway, style code, size, lifestyle/running, price, store, condition, box, accessories, materials, up to 3 photos plus dated progress photos, and "what this pair means".
- **Wear log**: one-tap quick log, a full log (occasion, memory, km for running pairs), and NFC tap-to-log.
- **Care log**: Cleaning / Washing / Retooling, with cost and who did it. A "clean every N wears" reminder.
- **Value**: manual market value history. Each entry stores `source: manual`, so auto-scraping can add rows later without changing anything else.
- **Dashboard**: rack value vs. paid, wears, average cost-per-wear, km, Today's pick with Rain mode (hides suede/nubuck), quick-log strip, alerts (care due, hydrolysis risk, running retirement, backup reminder), 26-week heatmap, most worn, gathering dust, and brands.
- **Pair Passport**: share as a 9:16 image for IG Stories, or save as an A4 PDF.
- **Sneaker Report**: month, quarter or year, with a personality label, image + PDF.
- **NFC**: tags carry `https://<your-site>/?tag=SB-00421`. A new tag asks which pair it belongs to; after that, every tap logs a wear with an undo option. A second tap within 5 minutes is caught as a duplicate.
- **Backup / restore** to a JSON file, **demo rack**, **erase**.

## Files (all in one folder, no build step)

| File | What it does |
|---|---|
| `index.html` | App shell, tab bar |
| `styles.css` | All styling. Colors are tokens at the top, so the final Claude Design look can be applied there |
| `db.js` | Local database (IndexedDB) |
| `stats.js` | Cost-per-wear, alerts, report numbers, personality labels |
| `exports.js` | Pair Passport + Sneaker Report drawing, PDF and share |
| `demo.js` | Example rack for testing |
| `app.js` | Screens, forms, NFC flow |
| `sw.js` | Offline cache. **Bump `VERSION` whenever you upload changed files** |
| `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png` | Home-screen install |
| `jspdf.umd.min.js`, `anton.woff2` | PDF library and display font, bundled so it works offline |

## Put it online (free, from an iPhone): GitHub Pages

The app needs to be on HTTPS so phones can install it and NFC links can open it.

1. On github.com, create a new **public** repository, e.g. `shoe-log`.
2. **Add file → Upload files**, and upload all 14 files from this folder (everything except this README is required). They all sit at the top level, so it's one batch.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/shoe-log/`.
5. Open it in Safari → Share → **Add to Home Screen**.

On a computer, you can also run it locally with `python3 -m http.server 8000` inside this folder and open `http://localhost:8000`.

## NFC tags (MaMa accessory)

- Each tag's URL is `https://<your-username>.github.io/shoe-log/?tag=SB-00001` (change the serial per tag). The **More → Sickboiss NFC tags** screen builds and copies the link for any serial.
- **Android (Chrome):** More → enter serial → **Write to tag**.
- **iPhone:** write tags with an app like *NFC Tools* (record type: URL). iPhones read URL tags natively, so tapping works with no app open.
- NTAG213 tags are enough (144 bytes; the URL is about 50).

## Known limits of this prototype

- Data is per phone and per browser. If someone deletes Safari website data, their rack is gone unless they backed up. The app reminds people every 14 days.
- On iPhone, an NFC tap opens the link in Safari, which is a separate store from the home-screen app. **For tags, testers should use the app from Safari, not the home-screen icon**, or keep to one of the two. Fixing this properly needs accounts and sync (planned v2).
- Market values are manual for now.
