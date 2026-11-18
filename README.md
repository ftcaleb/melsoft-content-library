# Melsoft content library

The marketing team's photo and video library. It shows everything in the
"Melsoft Content" Google Drive folder, grouped by folder. People can search it,
open any file full size, download the original, or copy its Drive link.

Only people with a **@melsoftacademy.com** email address can get in. They
enter their work email and get a sign-in link by email. The link works for 30
minutes, and the browser then stays signed in for 30 days.

## How it works

- **The page** (`src/`) is a small React app. The library's own code contains
  no files, folder IDs or links. Everything comes from `/api/library` after
  sign-in.
- **`/api/library`** returns the library to signed-in addresses and `401` to
  everyone else.
  - It reads Drive through its public folder view, so no Google API key is
    needed.
  - Vercel's CDN caches the result for 10 minutes. New uploads appear within
    about 10 minutes.
  - If Drive can't be read, it serves the copy saved at build time
    (`data/snapshot.json`).
- **`/api/auth`** handles sign-in:
  - It emails sign-in links through Gmail SMTP.
  - It turns a link into a session cookie (HttpOnly, sent only to `/api`).
  - It signs people out.
- **Sign-in is stateless.** Links and sessions are HMAC-signed tokens, so
  there is no database.
  - Changing `CONTENT_LIBRARY_SECRET` (or `SMTP_PASS`, if no secret is set)
    signs everyone out.
  - Changing it is also the only way to end a session before its 30 days
    are up.

## Deploying on Vercel

1. Import this repo as a new Vercel project. The settings in `vercel.json` are
   picked up automatically.
2. Set these environment variables for Production (and Preview, if you use it):

   | Name | Value |
   | --- | --- |
   | `DRIVE_FOLDER_ID` | The Melsoft Content folder's ID, or its full Drive link |
   | `SMTP_USER` | The Google Workspace address that sends sign-in links |
   | `SMTP_PASS` | An app password for that account |
   | `CONTENT_LIBRARY_SECRET` | A long random string (recommended) |
   | `SITE_URL` | Optional. The address links should point at, e.g. `https://content.melsoftacademy.com` |

3. Deploy. To use a subdomain such as `content.melsoftacademy.com`, add it
   under Project → Settings → Domains.

The Drive folder must stay shared as **"Anyone with the link — Viewer"**,
otherwise the library can't read it.

## Running it locally

```sh
npm install
cp .env.example .env.local   # fill in at least DRIVE_FOLDER_ID
npm run api                  # the api/ functions on :3101
npm run dev                  # the page on http://localhost:5174
```

Without `SMTP_USER` and `SMTP_PASS`, no email is sent. Sign-in links are
printed in the `npm run api` terminal instead.

## Keep out of this repo

This repository is public. Never commit:

- `.env*` files
- `data/`, the saved copy, which lists every file in the Drive folder
- the Drive folder ID

All of these are in `.gitignore`.
