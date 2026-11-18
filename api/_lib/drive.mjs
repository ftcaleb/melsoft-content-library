/* ── Read the Melsoft Content Drive folder ─────────────────────────────
   Shared by the live feed (api/library.js) and the snapshot script
   (scripts/snapshot.mjs, which writes the server-side fallback copy).

   The underscore keeps Vercel from turning this file into a function.

   No API key and no sign-in: Drive’s public folder view
   (drive.google.com/embeddedfolderview), so the folder MUST be shared
   "Anyone with the link — Viewer". Its ID comes from DRIVE_FOLDER_ID and
   is never committed: this repo is public, and the ID is the folder’s
   link. Each top-level folder becomes a folder on the page; every
   subfolder under it, at any depth, an album inside it. Photos and videos
   are listed; documents, PDFs and audio are counted.                    */

export const driveFolderId = () => folderIdFrom(process.env.DRIVE_FOLDER_ID || "") || null;

const MAX_DEPTH = 8;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|svg)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i;
// Operating-system clutter, not content: macOS "._" resource forks (copied
// alongside every file from a Mac to a shared drive), .DS_Store, Thumbs.db,
// desktop.ini. Drive can't preview them; they're skipped entirely.
const SYSTEM_FILE = /^(\._|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

export const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;
export const folderIdFrom = (s) => String(s).trim().replace(/^.*\/folders\//, "").replace(/[?#].*$/, "");

const decode = (s) => s
  .replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/* Natural order ("Episode 2" before "Episode 10"), ignoring the stray
   spaces and dots in names like "EP. 4-" and "EP.10 -". */
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const sortKey = (s) => s.replace(/[\s._-]+/g, " ").trim();
const byName = (a, b) => collator.compare(sortKey(a.name), sortKey(b.name));

const slugify = (s) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "folder";

/* Drive's folder view prints "5:54 PM" for today, "Sep 30" for earlier this
   year and "Dec 3, 2025" for other years. Returns YYYY-MM-DD or null. */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const iso = (d) => d.toISOString().slice(0, 10);
function parseDriveDate(raw, now) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(s)) return iso(now);
  const m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2})(?:, (\d{4}))?$/);
  if (!m || MONTHS[m[1].toLowerCase()] == null) return null;
  const year = m[3] ? Number(m[3]) : now.getUTCFullYear();
  let d = new Date(Date.UTC(year, MONTHS[m[1].toLowerCase()], Number(m[2])));
  if (!m[3] && d > now) d = new Date(Date.UTC(year - 1, d.getUTCMonth(), d.getUTCDate()));
  return iso(d);
}
const latest = (...dates) => dates.filter(Boolean).sort().pop() || null;

export class FolderError extends Error {}

async function fetchFolderHtml(id) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MelsoftContentLibrary/1.0)", "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401 || res.status === 403 || res.url.includes("accounts.google.com")) {
        throw new FolderError(
          `The Drive folder ${id} is private. In Google Drive: Share → General access → ` +
          `"Anyone with the link" → Viewer.`,
        );
      }
      if (res.ok) return await res.text();
      lastErr = new FolderError(`Drive returned HTTP ${res.status} for folder ${id}.`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      if (err instanceof FolderError) throw err;
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw lastErr;
}

async function listFolder(id, now) {
  const html = await fetchFolderHtml(id);
  const entries = [];
  for (const part of html.split('<div class="flip-entry" id="entry-').slice(1)) {
    const entryId = part.slice(0, part.indexOf('"'));
    const href = (part.match(/href="([^"]+)"/) || [])[1] || "";
    const name = decode((part.match(/class="flip-entry-title">([^<]*)</) || [])[1] || "");
    const mime = (part.match(/\/type\/([a-z]+\/[a-z0-9.+-]+)/i) || [])[1] || "";
    const modified = parseDriveDate((part.match(/class="flip-entry-last-modified"><div>([^<]*)</) || [])[1], now);
    if (!entryId || SYSTEM_FILE.test(name)) continue;
    let kind = "other";
    if (href.includes("/drive/folders/") || /aria-label="Folder"/.test(part)) kind = "folder";
    else if (mime.startsWith("image/") || IMAGE_EXT.test(name)) kind = "image";
    else if (mime.startsWith("video/") || VIDEO_EXT.test(name)) kind = "video";
    entries.push({ id: entryId, name, kind, modified });
  }
  return entries;
}

/* A small pool so ~100 folder requests take seconds, not a minute. */
function pool(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

/**
 * Reads the whole tree. Resolves to
 *   { folderId, folderUrl, syncedAt, folders: [{ id, name, slug, updated,
 *     otherFiles, albums: [{ id, path, updated, items: [{ id, name, kind }] }] }] }
 * Rejects if any folder can't be read, or if the result is empty (which
 * means Drive changed its page, not that the library emptied overnight).
 */
export async function crawlLibrary({ rootId, concurrency = 12 } = {}) {
  if (!rootId) throw new FolderError("No Drive folder: set DRIVE_FOLDER_ID.");
  const now = new Date();
  const run = pool(concurrency);

  async function crawl(id, trail, depth, stats) {
    const entries = await run(() => listFolder(id, now));
    const items = entries
      .filter((e) => e.kind === "image" || e.kind === "video")
      .sort(byName)
      .map(({ id: fileId, name, kind }) => ({ id: fileId, name, kind }));
    stats.other += entries.filter((e) => e.kind === "other").length;

    const subfolders = depth >= MAX_DEPTH ? [] : entries.filter((e) => e.kind === "folder").sort(byName);
    const children = await Promise.all(subfolders.map((f) => crawl(f.id, [...trail, f.name], depth + 1, stats)));

    const updated = latest(...entries.map((e) => e.modified), ...children.map((c) => c.updated));
    const own = items.length
      ? [{ id, path: trail, updated: latest(...entries.filter((e) => e.kind !== "folder").map((e) => e.modified)), items }]
      : [];
    return { albums: [...own, ...children.flatMap((c) => c.albums)], updated };
  }

  const top = await run(() => listFolder(rootId, now));
  const crawled = await Promise.all(top
    .filter((e) => e.kind === "folder")
    .sort(byName)
    .map(async (f) => {
      const stats = { other: 0 };
      const { albums, updated } = await crawl(f.id, [], 1, stats);
      return { f, albums, updated: latest(updated, f.modified), other: stats.other };
    }));

  const slugs = new Set();
  const folders = crawled.map(({ f, albums, updated, other }) => {
    let slug = slugify(f.name);
    for (let n = 2; slugs.has(slug); n++) slug = `${slugify(f.name)}-${n}`;
    slugs.add(slug);
    return { id: f.id, name: f.name, slug, updated, otherFiles: other, albums };
  });

  if (!folders.some((f) => f.albums.length)) {
    throw new FolderError("Drive returned no photos or videos. Its folder page may have changed.");
  }
  return { folderId: rootId, folderUrl: folderUrl(rootId), syncedAt: now.toISOString(), folders };
}

export const countKind = (data, kind) => data.folders.reduce(
  (n, f) => n + f.albums.reduce((m, a) => m + a.items.filter((i) => i.kind === kind).length, 0), 0);
