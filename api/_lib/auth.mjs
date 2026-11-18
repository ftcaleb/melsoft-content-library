/* ── Sign-in: @melsoftacademy.com addresses only ──────────────────────
   Someone enters an address on the team's domain and gets a 30-day
   session cookie (api/auth.js). No email is sent, so the address isn't
   verified: it keeps casual visitors out rather than proving who someone
   is. api/library.js answers only when the cookie is present and valid.

   Stateless: sessions are HMAC-signed tokens, so there's no database.
   The signing key is CONTENT_LIBRARY_SECRET. Changing it signs everyone
   out (the only way to end sessions early).

   The underscore keeps Vercel from turning this file into a function.  */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TEAM_DOMAIN = "melsoftacademy.com";
export const SESSION_DAYS = 30;
const COOKIE = "cl_session";

export const onVercel = () => !!process.env.VERCEL;

export function signingKey() {
  if (process.env.CONTENT_LIBRARY_SECRET) return process.env.CONTENT_LIBRARY_SECRET;
  // Local `npm run api` without env vars: a throwaway key. Never on Vercel.
  return onVercel() ? null : "local-dev-only";
}

/* "thandi" or "Thandi@MelsoftAcademy.com " → "thandi@melsoftacademy.com".
   Anything that isn't exactly one melsoftacademy.com address → null. */
export function teamEmail(input) {
  let e = String(input ?? "").trim().toLowerCase();
  if (e && !e.includes("@")) e += `@${TEAM_DOMAIN}`;
  return e.length <= 254 && /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@melsoftacademy\.com$/.test(e) ? e : null;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

const mac = (key, data) => createHmac("sha256", key).update(data).digest("base64url");

/* <base64url JSON>.<HMAC>, with a purpose and an expiry inside, so a
   token can't be reused for something else or outlive itself. */
export function sign(key, purpose, payload, seconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, p: purpose, x: Math.floor(Date.now() / 1000) + seconds })).toString("base64url");
  return `${body}.${mac(key, body)}`;
}

export function verify(key, purpose, token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !safeEqual(parts[1], mac(key, parts[0]))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (!data || data.p !== purpose || !(data.x > Date.now() / 1000)) return null;
  return data;
}

/* The signed-in address, or null. */
export function readSession(req, key) {
  const m = String(req.headers?.cookie ?? "").match(/(?:^|;\s*)cl_session=([^;]+)/);
  if (!m) return null;
  let raw;
  try { raw = decodeURIComponent(m[1]); } catch { return null; }
  const data = verify(key, "session", raw);
  return data ? teamEmail(data.e) : null;
}

/* Sent only to /api routes, never readable by page scripts. */
const attrs = () => `Path=/api; HttpOnly; SameSite=Lax${onVercel() ? "; Secure" : ""}`;
export const sessionCookie = (key, email) =>
  `${COOKIE}=${sign(key, "session", { e: email }, SESSION_DAYS * 86400)}; Max-Age=${SESSION_DAYS * 86400}; ${attrs()}`;
export const clearedCookie = () => `${COOKIE}=; Max-Age=0; ${attrs()}`;

/* The address of the CDN-cached Drive list (see api/library.js).
   Derived from the signing key, so only the server can work it out. */
export const feedKey = (key) => createHmac("sha256", key).update("content-library-feed").digest("hex").slice(0, 40);
