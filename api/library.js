import { readFile } from "node:fs/promises";
import path from "node:path";
import { crawlLibrary, driveFolderId } from "./_lib/drive.mjs";
import { feedKey, readSession, safeEqual, signingKey } from "./_lib/auth.mjs";

/* GET /api/library — the list behind the page, for signed-in
   @melsoftacademy.com addresses only (sign-in: api/auth.js). Anyone else
   gets 401 and the page shows its sign-in screen.

   Reading Drive takes a few seconds (about 100 folder pages), so the list
   itself lives at a second address, ?feed=<key>, which Vercel's CDN caches
   for 10 minutes and then serves stale for up to a day while it refreshes
   in the background. Drive is read at most once per 10 minutes and new
   uploads appear within about 10 minutes. The key is derived from the
   signing secret, so only this function knows the feed's address; a
   signed-in request checks the cookie, then reads the feed through the
   CDN. Answers with a cookie are never cached.

   If Drive can't be read, the copy the build saved in data/snapshot.json
   (scripts/snapshot.mjs, never committed) is served, marked `saved: true`. */

const SAVED = path.join(process.cwd(), "data", "snapshot.json");

/* The cached feed, through the CDN. undefined: couldn't reach it (a local
   run, or a protected preview deployment), so read Drive here instead.
   null: the feed tried Drive and failed, so don't try again. */
async function viaCdn(req, key) {
  const host = req.headers.host;
  if (!process.env.VERCEL || !host) return undefined;
  try {
    const r = await fetch(`https://${host}/api/library?feed=${feedKey(key)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(40000),
    });
    if (r.ok) return await r.json();
    return r.status >= 500 ? null : undefined;
  } catch (err) {
    return err?.name === "TimeoutError" ? null : undefined;
  }
}

/* Read Drive directly, at most once per 10 minutes per warm instance. */
let memo = null;
function crawlHere(rootId) {
  if (!memo || Date.now() - memo.at > 600_000) {
    const at = Date.now();
    const promise = crawlLibrary({ rootId }).catch((err) => {
      console.error("[library] Drive read failed:", err);
      if (memo?.at === at) memo = null;
      return null;
    });
    memo = { at, promise };
  }
  return memo.promise;
}

async function savedCopy() {
  try { return { ...JSON.parse(await readFile(SAVED, "utf8")), saved: true }; } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("X-Robots-Tag", "noindex");

  const key = signingKey();
  const rootId = driveFolderId();
  if (!key || !rootId) {
    console.error("[library] Not configured: set DRIVE_FOLDER_ID and SMTP_PASS (or CONTENT_LIBRARY_SECRET).");
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "not-configured" });
  }

  /* 1. The feed: CDN-cached, reachable only with the key. */
  if (req.query?.feed !== undefined) {
    if (!safeEqual(req.query.feed, feedKey(key))) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({ error: "Not found" });
    }
    try {
      const data = await crawlLibrary({ rootId });
      // Browsers always ask again; Vercel's CDN answers from its copy.
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      res.setHeader("Vercel-CDN-Cache-Control", "max-age=600, stale-while-revalidate=86400");
      return res.status(200).json(data);
    } catch (err) {
      console.error("[library] Drive read failed:", err);
      // Not cached, so the next request tries Drive again.
      res.setHeader("Cache-Control", "no-store");
      return res.status(502).json({ error: "Couldn't read the Drive folder" });
    }
  }

  /* 2. Everyone else: signed in, or nothing. */
  res.setHeader("Cache-Control", "private, no-store");
  const viewer = readSession(req, key);
  if (!viewer) return res.status(401).json({ error: "signin" });

  let data = await viaCdn(req, key);
  if (data === undefined) data = await crawlHere(rootId);
  data ||= await savedCopy();
  if (!data) return res.status(502).json({ error: "Couldn't read the Drive folder" });
  return res.status(200).json({ ...data, viewer });
}
