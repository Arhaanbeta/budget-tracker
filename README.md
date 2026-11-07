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

## Signing in

Tap **Continue with Google** once on each phone. The phone then stays signed in for good.

- Only Google accounts listed on the sheet's **Users** tab can sign in. The owner adds or removes people in the app under **Setup → Family access** (or straight in the tab).
- Removing someone locks them out on their next sync, and their phone stops showing the data.
- The script checks every sign-in with Google (`oauth2.googleapis.com/tokeninfo`): the token must be for this app's Client ID and for a verified email on the Users tab.

## One-time setup

1. **Google sign-in client** (Google Cloud Console → Google Auth Platform): create a *Web application* OAuth client with the authorised JavaScript origin `https://arhaanbeta.github.io`. Put its Client ID in `GOOGLE_CLIENT_ID` in `index.html` and in the sheet's **Config** tab (`google client id`).
2. **Apps Script**: in the sheet, **Extensions → Apps Script**, paste [`apps-script/Code.gs`](apps-script/Code.gs), then **Deploy → Manage deployments → Edit → Version: New version → Deploy**, and allow the new permission (it calls Google to check sign-ins).
3. Optional, after Google sign-in works: delete the `APP_KEY` script property to switch off the old set-up links.

**Updating the script later:** paste the new code, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same.

## Install on a phone

Open `https://arhaanbeta.github.io/budget-tracker/` in Chrome → **⋮ → Install app** (or **Add to Home screen**). On iPhone, use Safari → **Share → Add to Home Screen**.
