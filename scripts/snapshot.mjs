#!/usr/bin/env node
/* ── Saved copy of the library ────────────────────────────────────────
   The page reads Drive live through /api/library, so new uploads appear
   on their own within about 10 minutes. This script writes the copy that
   API falls back on when Drive can't be read:

       data/snapshot.json   (never committed: this repo is public)

   `npm run build` runs it with --soft, so every deploy carries a fresh
   copy on the server. The page never bundles it.

   Usage
     npm run snapshot                    → the folder in DRIVE_FOLDER_ID
     node scripts/snapshot.mjs <folder id or URL>
     node scripts/snapshot.mjs --soft    (never fails: on any error the
                                          build carries on without a copy) */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { countKind, crawlLibrary, driveFolderId, folderIdFrom, FolderError } from "../api/_lib/drive.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "snapshot.json");

const args = process.argv.slice(2);
const soft = args.includes("--soft");
const folderArg = args.find((a) => !a.startsWith("--"));

async function main() {
  const data = await crawlLibrary({ rootId: folderArg ? folderIdFrom(folderArg) : driveFolderId() });
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data) + "\n", "utf8");
  const withMedia = data.folders.filter((f) => f.albums.length).length;
  console.log(`Snapshot: ${countKind(data, "image")} photos and ${countKind(data, "video")} videos in ${withMedia} folder(s) → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  const msg = err instanceof FolderError ? err.message : `Snapshot failed: ${err.message}`;
  if (soft) {
    console.warn(`⚠ ${msg} (continuing without a saved copy)`);
    return;
  }
  console.error(`✖ ${msg}`);
  // exitCode rather than process.exit(): exiting while fetch's sockets are
  // still closing trips a libuv assertion on Windows.
  process.exitCode = 1;
});
