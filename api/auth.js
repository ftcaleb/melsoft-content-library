import nodemailer from "nodemailer";
import {
  LINK_MINUTES, SESSION_DAYS, clearedCookie, onVercel, safeNext, sessionCookie, sign, signingKey, teamEmail, verify,
} from "./_lib/auth.mjs";

/* /api/auth — signing in to the content library.

     POST { action: "send", email, next }  emails a sign-in link to a
                                           @melsoftacademy.com address
     GET  ?token=…                         the link itself: sets the session
                                           cookie, then back to the library
     POST { action: "signout" }            clears the cookie

   See api/_lib/auth.mjs for how links and sessions are signed.            */

const HOME = "/";

/* Where the emailed link points: SITE_URL when set, else the domain the
   request came in on (on Vercel, only this project's own domains reach
   it). Never the Origin header in production: a forged one would put
   someone else's domain behind a genuine Melsoft email. */
function siteOrigin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  if (onVercel()) return `https://${req.headers.host}`;
  const origin = String(req.headers.origin || "");
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : "http://localhost:5174";
}

function redirect(res, to) {
  res.setHeader("Location", to);
  return res.status(302).send("");
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function emailBody(url) {
  const text = [
    "Hi,",
    "",
    "Here's your sign-in link for the Melsoft content library:",
    url,
    "",
    `It works for the next ${LINK_MINUTES} minutes. Once you're in, that browser stays signed in for ${SESSION_DAYS} days.`,
    "",
    "Didn't ask for this? You can ignore it: nobody gets in without the link.",
    "",
    "Melsoft Academy",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f7f8fb;font-family:Arial,Helvetica,sans-serif;color:#0a1733">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e8f0;border-radius:16px">
      <tr><td style="padding:36px 32px 32px">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#5e0743">Content library</p>
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#0a1733">Your sign-in link</h1>
        <p style="margin:0 0 26px;font-size:15px;line-height:1.6;color:#5b6478">Open the Melsoft content library with the button below. It works for the next ${LINK_MINUTES} minutes, and that browser then stays signed in for ${SESSION_DAYS} days.</p>
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#5e0743;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">Open the content library</a>
        <p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#646c85">Didn&rsquo;t ask for this? You can ignore it: nobody gets in without the link.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { text, html };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  const key = signingKey();
  if (!key) {
    console.error("[auth] Not configured: set CONTENT_LIBRARY_SECRET or SMTP_PASS.");
    return res.status(503).json({ error: "not-configured" });
  }

  /* The link from the email. HEAD too: some mail scanners check links
     first, and a cookie handed to a scanner is harmless. */
  if (req.method === "GET" || req.method === "HEAD") {
    if (!req.query?.token) return redirect(res, HOME);
    const link = verify(key, "link", req.query.token);
    const email = link && teamEmail(link.e);
    if (!email) return redirect(res, "/?signin=expired");
    res.setHeader("Set-Cookie", sessionCookie(key, email));
    return redirect(res, safeNext(link.n));
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, HEAD, POST");
    return res.status(405).json({ error: "method" });
  }

  const body = readBody(req);

  if (body.action === "signout") {
    res.setHeader("Set-Cookie", clearedCookie());
    return res.status(200).json({ ok: true });
  }

  if (body.action !== "send") return res.status(400).json({ error: "action" });

  const email = teamEmail(body.email);
  if (!email) return res.status(400).json({ error: "domain" });

  const token = sign(key, "link", { e: email, n: safeNext(body.next) }, LINK_MINUTES * 60);
  const url = `${siteOrigin(req)}/api/auth?token=${token}`;

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    if (onVercel()) {
      console.error("[auth] SMTP_USER and SMTP_PASS must be set to send sign-in links.");
      return res.status(503).json({ error: "not-configured" });
    }
    // Local `npm run api` without SMTP: no email, the link goes to the terminal.
    console.log(`[auth] Sign-in link for ${email}:\n  ${url}`);
    return res.status(200).json({ ok: true });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true, auth: { user: smtpUser, pass: smtpPass },
    });
    const { text, html } = emailBody(url);
    await transporter.sendMail({
      from: `"Melsoft Content Library" <${smtpUser}>`,
      to: email,
      subject: "Your sign-in link for the Melsoft content library",
      text,
      html,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[auth] Sending the link failed:", err);
    return res.status(502).json({ error: "send" });
  }
}
