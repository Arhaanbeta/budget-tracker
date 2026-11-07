# Budget Tracker

A household budget app that you install on your phone (a PWA). Every entry from every phone goes into one Google Sheet.

- **The app** (this repository) is only code. It holds no money data. GitHub Pages serves it at `https://arhaanbeta.github.io/budget-tracker/`.
- **The data** lives in your Google Sheet, *Budget Tracker data*, with four tabs: `Entries`, `Balances`, `CardFix` and `Config`.
- **The bridge** is a small Google Apps Script (`apps-script/Code.gs`) inside that sheet. The app sends changes to it, and it sends back the full data.

## How sync works

1. When you save an entry, the app shows it at once and keeps it in an *outbox* on the phone.
2. The app sends the outbox to the sheet. The sheet writes the rows and replies with all the data.
3. Every 30 seconds, and whenever you open the app, it fetches the latest data, so entries from other phones appear.
4. With no internet, entries wait in the outbox ("1 change waiting to sync") and go out when the connection returns.

You can also type a row straight into the `Entries` tab: fill **Date**, **Category** (its exact name) and **Amount**. The script gives the row an ID the next time any phone syncs.

## One-time setup of the sheet back end

1. Open the *Budget Tracker data* sheet → **Extensions → Apps Script**.
2. Delete what is in `Code.gs`, paste all of [`apps-script/Code.gs`](apps-script/Code.gs) (use GitHub's copy button), and click **Save**.
3. **Deploy → New deployment → Select type: Web app**. Execute as: **Me**. Who has access: **Anyone**. Click **Deploy** and allow the permissions.
4. Open the **Web app URL** it gives you (ends in `/exec`). The script makes its own access key and shows a **one-tap phone link**. Save that link somewhere private; the page shows it only once.
5. Open the link on each phone. The app connects by itself.

"Anyone" means anyone *with the URL* can reach the script, but it refuses every request without the access key, and the key travels only inside the phone link. Treat that link like a password. To cancel it, delete the `APP_KEY` script property and open the Web app URL again for a new link.

**Updating the script later:** paste the new code, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same.

## Install on a phone

Open `https://arhaanbeta.github.io/budget-tracker/` in Chrome → **⋮ → Install app** (or **Add to Home screen**). On iPhone, use Safari → **Share → Add to Home Screen**.
