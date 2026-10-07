# AIB Recruiting Workspace

Ezra's workspace for booking freshman class visits for the UMN Carlson **AI in Business Club**.

Plain HTML/CSS/JS with no build step, plus one serverless function (`api/data.js`) that syncs your data across devices.

## Turn on sync (one time, in the Vercel dashboard)

1. Open the project → **Storage** → **Create Database** → **Upstash for Redis** (free tier) → connect it to this project.
   This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
2. Open **Settings → Environment Variables** and add `APP_PASSCODE` = a passcode only you know.
3. Redeploy. Open the site, enter the passcode, and your data now syncs between your laptop and phone.

Until you do this, the site still works and saves in your browser. Use **Settings → Download backup** now and then.

## Files

- `index.html`: the page shell and icons
- `styles.css`: all styling (light and dark)
- `app.js`: the app
- `seed.js`: the starter class list (AI-generated and **unverified**, so check each class before you email)
- `api/data.js`: sync endpoint (GET/PUT, passcode-protected)
