import { clearedCookie, sessionCookie, signingKey, teamEmail } from "./_lib/auth.mjs";

/* /api/auth — signing in to the content library.

     POST { action: "signin", email }  a @melsoftacademy.com address sets
                                       the 30-day session cookie
     POST { action: "signout" }        clears it

   No email is sent: entering an address on the team's domain is enough.
   See api/_lib/auth.mjs for how sessions are signed.                       */

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method" });
  }

  const key = signingKey();
  if (!key) {
    console.error("[auth] Not configured: set CONTENT_LIBRARY_SECRET.");
    return res.status(503).json({ error: "not-configured" });
  }

  const body = readBody(req);

  if (body.action === "signout") {
    res.setHeader("Set-Cookie", clearedCookie());
    return res.status(200).json({ ok: true });
  }

  if (body.action !== "signin") return res.status(400).json({ error: "action" });

  const email = teamEmail(body.email);
  if (!email) return res.status(400).json({ error: "domain" });

  res.setHeader("Set-Cookie", sessionCookie(key, email));
  return res.status(200).json({ ok: true, email });
}
