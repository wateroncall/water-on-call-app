const APP_NAME = "Water OnCall";
const ADMIN_EMAIL = "admin@wateroncall.ca";

interface Env {
  DB: D1Database;
  RESEND_API_KEY: string;
  TWILIO_VERIFY_SERVICE_SID: string;
  TWILIO_API_KEY_SID: string;
  TWILIO_API_KEY_SECRET: string;
}

interface LoginCodeRow {
  id: string;
  code_hash: string;
  attempts: number;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
}

const APP_SCRIPT = [
  'document.addEventListener("DOMContentLoaded", () => {',
  '  const emailForm = document.getElementById("email-form");',
  '  const codeForm = document.getElementById("code-form");',
  '  const emailInput = document.getElementById("email");',
  '  const codeInput = document.getElementById("code");',
  '  const codeLabel = document.getElementById("code-label");',
  '  const emailButton = document.getElementById("email-request");',
  '  const smsButton = document.getElementById("sms-request");',
  '  const status = document.getElementById("status");',
  '  const requestedNext = new URLSearchParams(window.location.search).get("next");',
  '  let channel = "email";',
  '  const show = (message, isError = false) => { status.textContent = message; status.hidden = false; status.style.color = isError ? "#a32121" : "#08764b"; };',
  '  const requestBusy = (busy, selected) => { emailButton.disabled = busy; smsButton.disabled = busy; if (!busy) { emailButton.textContent = emailButton.dataset.label; smsButton.textContent = smsButton.dataset.label; } else { selected.textContent = "Please wait…"; } };',
  '  const verifyBusy = (busy) => { const button = codeForm.querySelector("button"); button.disabled = busy; button.textContent = busy ? "Please wait…" : button.dataset.label; };',
  '  async function requestCode(nextChannel) {',
  '    channel = nextChannel; requestBusy(true, nextChannel === "sms" ? smsButton : emailButton); status.hidden = true;',
  '    try {',
  '      const endpoint = nextChannel === "sms" ? "/api/auth/sms/request" : "/api/auth/request";',
  '      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: emailInput.value }) });',
  '      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to send the code.");',
  '      codeForm.hidden = false; codeInput.value = ""; codeInput.focus();',
  '      codeLabel.textContent = nextChannel === "sms" ? "6-digit text-message code" : "6-digit email code";',
  '      show(nextChannel === "sms" ? "If this account has a verified mobile number, a sign-in code was sent by text. It expires in 10 minutes." : "We sent a 6-digit sign-in code to " + emailInput.value.trim() + ". It expires in 10 minutes.");',
  '    } catch (error) { show(error.message || "Unable to send the code.", true); } finally { requestBusy(false, nextChannel === "sms" ? smsButton : emailButton); }',
  '  }',
  '  emailForm.addEventListener("submit", (event) => { event.preventDefault(); requestCode("email"); });',
  '  smsButton.addEventListener("click", () => requestCode("sms"));',
  '  codeForm.addEventListener("submit", async (event) => {',
  '    event.preventDefault(); verifyBusy(true);',
  '    try {',
  '      const endpoint = channel === "sms" ? "/api/auth/sms/verify" : "/api/auth/verify";',
  '      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ email: emailInput.value, code: codeInput.value }) });',
  '      const data = await response.json(); if (!response.ok) throw new Error(data.error || "That code could not be verified.");',
  '      emailForm.hidden = true; codeForm.hidden = true;',
  '      window.location.href = data.user.role === "admin" ? "/admin" : data.user.role === "hauler" ? "/hauler" : requestedNext === "/hauler" ? "/hauler" : "/account";',
  '    } catch (error) { show(error.message || "That code could not be verified.", true); } finally { verifyBusy(false); }',
  '  });',
  '});'
].join("\n");

function javascript(): Response {
  return new Response(APP_SCRIPT, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

const LARAVEL_API = "https://wateroncall-backend-production-cov9zr.laravel.cloud/api/v1";
const PROFILE_INTAKE_API = LARAVEL_API + "/profile-intake";

async function syncLaravelProfile(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(PROFILE_INTAKE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) console.error("Laravel profile intake failed", response.status, await response.text());
    return response.ok;
  } catch (error) {
    console.error("Laravel profile intake failed", error);
    return false;
  }
}

async function syncLaravelOrder(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(LARAVEL_API + "/order-intake", {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(payload),
    });
    if (!response.ok) console.error("Laravel order intake failed", response.status, await response.text());
    return response.ok;
  } catch (error) {
    console.error("Laravel order intake failed", error);
    return false;
  }
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

function normalizeCanadianPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

async function ensurePhoneSchema(env: Env): Promise<void> {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS verified_phones (user_id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, verified_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS sms_rate_limits (phone TEXT PRIMARY KEY, last_sent_at TEXT NOT NULL)"
  ).run();
}

async function twilioVerifyRequest(env: Env, path: string, fields: Record<string, string>): Promise<{ ok: boolean; status?: string }> {
  try {
    const body = new URLSearchParams(fields);
    const response = await fetch(
      "https://verify.twilio.com/v2/Services/" + encodeURIComponent(env.TWILIO_VERIFY_SERVICE_SID) + path,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(env.TWILIO_API_KEY_SID + ":" + env.TWILIO_API_KEY_SECRET),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );
    const data = await response.json() as { status?: string; message?: string };
    if (!response.ok) console.error("Twilio Verify rejected request", response.status, data.message || "");
    return { ok: response.ok, status: data.status };
  } catch (error) {
    console.error("Twilio Verify request failed", error);
    return { ok: false };
  }
}

async function sendSmsCode(env: Env, phone: string): Promise<"sent" | "limited" | "failed"> {
  await ensurePhoneSchema(env);
  const recent = await env.DB.prepare(
    "SELECT phone FROM sms_rate_limits WHERE phone = ? AND datetime(last_sent_at) > datetime('now', '-30 seconds')"
  ).bind(phone).first();
  if (recent) return "limited";
  const result = await twilioVerifyRequest(env, "/Verifications", { To: phone, Channel: "sms" });
  if (!result.ok) return "failed";
  await env.DB.prepare(
    "INSERT INTO sms_rate_limits (phone, last_sent_at) VALUES (?, datetime('now')) ON CONFLICT(phone) DO UPDATE SET last_sent_at=datetime('now')"
  ).bind(phone).run();
  return "sent";
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) return null;
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secureCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor((value / 4294967296) * 1000000).toString().padStart(6, "0");
}

function secureToken(): string {
  const values = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function sendLoginEmail(env: Env, email: string, code: string): Promise<boolean> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Water OnCall <login@notify.wateroncall.ca>",
      to: [email],
      subject: code + " is your Water OnCall sign-in code",
      text: "Your Water OnCall sign-in code is " + code + ". It expires in 10 minutes. If you did not request this code, you can ignore this email.",
      html: "<div style=\"font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#13283d\"><h1 style=\"color:#06325e\">Water <span style=\"color:#0877f9\">OnCall</span></h1><p>Your secure sign-in code is:</p><p style=\"font-size:34px;font-weight:800;letter-spacing:8px;color:#0877f9\">" + code + "</p><p>This code expires in 10 minutes. If you did not request it, you can safely ignore this email.</p></div>",
    }),
  });
  if (!response.ok) console.error("Resend rejected login email", response.status);
  return response.ok;
}

async function requestLoginCode(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const body = await readBody(request);
  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: "Enter a valid email address." }, 400);

  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM login_codes WHERE email = ? AND created_at > datetime('now', '-10 minutes')"
  ).bind(email).first<{ count: number }>();
  if (Number(recent?.count ?? 0) >= 3) {
    return json({ error: "Too many codes were requested. Please wait 10 minutes and try again." }, 429);
  }

  const id = crypto.randomUUID();
  const code = secureCode();
  const codeHash = await sha256(id + ":" + code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await env.DB.prepare(
    "INSERT INTO login_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(id, email, codeHash, expiresAt).run();

  const sent = await sendLoginEmail(env, email, code);
  if (!sent) {
    await env.DB.prepare("DELETE FROM login_codes WHERE id = ?").bind(id).run();
    return json({ error: "We could not send the email right now. Please try again shortly." }, 503);
  }

  return json({ ok: true });
}

async function verifyLoginCode(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const body = await readBody(request);
  const email = normalizeEmail(body?.email);
  const code = String(body?.code ?? "").replace(/\D/g, "");
  if (!email || code.length !== 6) return json({ error: "Enter the 6-digit code from your email." }, 400);

  const loginCode = await env.DB.prepare(
    "SELECT id, code_hash, attempts FROM login_codes WHERE email = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now') ORDER BY created_at DESC LIMIT 1"
  ).bind(email).first<LoginCodeRow>();

  if (!loginCode || loginCode.attempts >= 5) {
    return json({ error: "That code is invalid or has expired. Request a new code." }, 401);
  }

  const suppliedHash = await sha256(loginCode.id + ":" + code);
  if (!safeEqual(suppliedHash, loginCode.code_hash)) {
    const attempts = loginCode.attempts + 1;
    await env.DB.prepare(
      "UPDATE login_codes SET attempts = ?, used_at = CASE WHEN ? >= 5 THEN datetime('now') ELSE used_at END WHERE id = ?"
    ).bind(attempts, attempts, loginCode.id).run();
    return json({ error: "That code is incorrect. Please try again." }, 401);
  }

  await env.DB.prepare("UPDATE login_codes SET used_at = datetime('now') WHERE id = ?").bind(loginCode.id).run();
  let user = await env.DB.prepare(
    "SELECT id, email, role, full_name FROM users WHERE email = ?"
  ).bind(email).first<UserRow>();

  if (!user) {
    const userId = crypto.randomUUID();
    const role = email === ADMIN_EMAIL ? "admin" : "customer";
    await env.DB.prepare(
      "INSERT INTO users (id, email, role, email_verified_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(userId, email, role).run();
    user = { id: userId, email, role, full_name: null };
  } else {
    const role = email === ADMIN_EMAIL ? "admin" : user.role;
    await env.DB.prepare(
      "UPDATE users SET role = ?, email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).bind(role, user.id).run();
    user = { ...user, role };
  }

  const token = secureToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), user.id, tokenHash, expiresAt).run();

  return json(
    { ok: true, user: { email: user.email, role: user.role, fullName: user.full_name } },
    200,
    { "Set-Cookie": "woc_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000" }
  );
}

async function requestSmsLoginCode(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const body = await readBody(request);
  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: "Enter a valid email address." }, 400);
  await ensurePhoneSchema(env);
  const row = await env.DB.prepare(
    "SELECT verified_phones.phone FROM verified_phones JOIN users ON users.id=verified_phones.user_id WHERE users.email=? LIMIT 1"
  ).bind(email).first<{ phone: string }>();
  if (!row) return json({ ok: true });
  const sent = await sendSmsCode(env, row.phone);
  if (sent === "limited") return json({ error: "Please wait 30 seconds before requesting another text." }, 429);
  if (sent === "failed") return json({ error: "We could not send the text right now. Use email or try again shortly." }, 503);
  return json({ ok: true });
}

async function verifySmsLoginCode(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const body = await readBody(request);
  const email = normalizeEmail(body?.email);
  const code = String(body?.code ?? "").replace(/\D/g, "");
  if (!email || code.length !== 6) return json({ error: "Enter the 6-digit code from the text message." }, 400);
  await ensurePhoneSchema(env);
  const user = await env.DB.prepare(
    "SELECT users.id, users.email, users.role, users.full_name, verified_phones.phone FROM users JOIN verified_phones ON verified_phones.user_id=users.id WHERE users.email=? LIMIT 1"
  ).bind(email).first<UserRow & { phone: string }>();
  if (!user) return json({ error: "That code is invalid or has expired. Use email sign-in or request a new text." }, 401);
  const checked = await twilioVerifyRequest(env, "/VerificationCheck", { To: user.phone, Code: code });
  if (!checked.ok || checked.status !== "approved") return json({ error: "That code is incorrect or has expired. Please try again." }, 401);

  const role = user.email === ADMIN_EMAIL ? "admin" : user.role;
  if (role !== user.role) await env.DB.prepare("UPDATE users SET role=?, updated_at=datetime('now') WHERE id=?").bind(role, user.id).run();
  const token = secureToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), user.id, tokenHash, expiresAt).run();
  return json(
    { ok: true, user: { email: user.email, role, fullName: user.full_name } },
    200,
    { "Set-Cookie": "woc_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000" }
  );
}

async function requestPhoneVerification(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const phone = normalizeCanadianPhone(user.phone);
  if (!phone) return json({ error: "Save a valid Canadian mobile number first." }, 400);
  const sent = await sendSmsCode(env, phone);
  if (sent === "limited") return json({ error: "Please wait 30 seconds before requesting another text." }, 429);
  if (sent === "failed") return json({ error: "We could not send the text right now. Please try again shortly." }, 503);
  return json({ ok: true });
}

async function confirmPhoneVerification(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const body = await readBody(request);
  const code = String(body?.code ?? "").replace(/\D/g, "");
  const phone = normalizeCanadianPhone(user.phone);
  if (!phone || code.length !== 6) return json({ error: "Enter the 6-digit code from the text message." }, 400);
  const checked = await twilioVerifyRequest(env, "/VerificationCheck", { To: phone, Code: code });
  if (!checked.ok || checked.status !== "approved") return json({ error: "That code is incorrect or has expired. Please try again." }, 401);
  await ensurePhoneSchema(env);
  try {
    await env.DB.prepare(
      "INSERT INTO verified_phones (user_id, phone, verified_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone, verified_at=datetime('now')"
    ).bind(user.id, phone).run();
    await env.DB.prepare("UPDATE users SET phone=?, updated_at=datetime('now') WHERE id=?").bind(phone, user.id).run();
  } catch {
    return json({ error: "That mobile number is already connected to another account." }, 409);
  }
  return json({ ok: true });
}

async function currentUser(request: Request, env: Env): Promise<Response> {
  const token = cookieValue(request, "woc_session");
  if (!token) return json({ user: null }, 401);
  const tokenHash = await sha256(token);
  const user = await env.DB.prepare(
    "SELECT users.id, users.email, users.role, users.full_name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND datetime(sessions.expires_at) > datetime('now') LIMIT 1"
  ).bind(tokenHash).first<UserRow>();
  return user
    ? json({ user: { email: user.email, role: user.role, fullName: user.full_name } })
    : json({ user: null }, 401);
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = cookieValue(request, "woc_session");
  if (token) {
    const tokenHash = await sha256(token);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ ok: true }, 200, {
    "Set-Cookie": "woc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  });
}


const securityHeaders: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...securityHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function page(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0877f9">
  <title>${APP_NAME} — Customer Portal</title>
  <style>
    :root{color-scheme:light;--blue:#0877f9;--navy:#06325e;--ink:#13283d;--muted:#61778d;--line:#dce8f3;--wash:#f3f9ff}
    *{box-sizing:border-box} body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(155deg,#fff 20%,#edf7ff);color:var(--ink);min-height:100vh}
    header{height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 max(22px,calc((100vw - 1120px)/2));background:#fff;border-bottom:1px solid var(--line)}
    .brand{display:flex;align-items:center;gap:12px;font-weight:850;font-size:21px;color:var(--navy)}
    .pin{width:37px;height:43px;position:relative;background:var(--blue);border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 8px 20px #0877f933}.pin:after{content:"";position:absolute;width:14px;height:14px;background:#fff;border-radius:50%;left:11px;top:11px}.brand span{color:var(--blue)}
    .secure{font-size:13px;color:var(--muted)}
    main{max-width:1120px;margin:auto;padding:64px 22px;display:grid;grid-template-columns:1.05fr .95fr;gap:72px;align-items:center;min-height:calc(100vh - 68px)}
    h1{font-size:clamp(42px,6vw,72px);line-height:.98;letter-spacing:-.055em;margin:0 0 23px;color:var(--navy)} h1 em{font-style:normal;color:var(--blue)}
    .lead{font-size:20px;line-height:1.6;color:var(--muted);max-width:580px;margin:0 0 28px}
    .points{display:grid;gap:13px}.point{display:flex;gap:11px;align-items:center;font-weight:650}.check{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#dff8ed;color:#08764b;font-size:14px}
    .card{background:#fff;border:1px solid var(--line);border-radius:24px;padding:34px;box-shadow:0 24px 65px #06325e1a}
    .eyebrow{text-transform:uppercase;letter-spacing:.16em;color:var(--blue);font-size:12px;font-weight:850}.card h2{margin:10px 0 8px;font-size:29px;color:var(--navy)}.small{color:var(--muted);line-height:1.55;margin:0 0 24px}
    label{display:block;font-weight:750;font-size:14px;margin-bottom:8px}input{width:100%;height:52px;border:1px solid #bdd0e1;border-radius:12px;font-size:16px;padding:0 15px;outline:none}input:focus{border-color:var(--blue);box-shadow:0 0 0 4px #0877f91f}
    button{width:100%;height:52px;margin-top:14px;border:0;border-radius:12px;background:var(--blue);color:#fff;font-size:16px;font-weight:800;cursor:pointer}button.secondary{margin-top:10px;background:#eaf4ff;color:var(--navy)}button:disabled{cursor:not-allowed;opacity:.65}.notice{margin-top:16px;padding:13px 14px;border-radius:11px;background:var(--wash);font-size:13px;color:var(--muted);line-height:1.45}.links{display:flex;justify-content:center;gap:18px;margin-top:21px;font-size:13px}.links a{color:var(--navy)}
    @media(max-width:760px){header{padding:0 18px}.secure{display:none}main{grid-template-columns:1fr;gap:36px;padding:42px 18px}.lead{font-size:17px}.card{padding:25px}h1{font-size:47px}}
  </style>
</head>
<body>
  <header><div class="brand"><i class="pin"></i><div><span>Water</span> OnCall</div></div><div class="secure">Secure customer portal</div></header>
  <main>
    <section>
      <div class="eyebrow">Bulk water delivery</div>
      <h1>Water when you <em>need it.</em></h1>
      <p class="lead">Request and track dependable bulk water delivery from your phone. Built for rural homes, cisterns, pools, job sites, and urgent refills.</p>
      <div class="points">
        <div class="point"><span class="check">✓</span> Simple delivery requests</div>
        <div class="point"><span class="check">✓</span> Clear status updates</div>
        <div class="point"><span class="check">✓</span> Trusted local haulers</div>
      </div>
    </section>
    <section class="card">
      <div class="eyebrow">Customer sign in</div>
      <h2>Your Water OnCall account</h2>
      <p class="small">Enter your email, then choose to receive your secure sign-in code by email or text. Text sign-in becomes available after you verify your mobile number in your account.</p>
      <form id="email-form">
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
        <button id="email-request" type="submit" data-label="Email me a code">Email me a code</button>
        <button id="sms-request" class="secondary" type="button" data-label="Text me a code">Text me a code</button>
      </form>
      <form id="code-form" hidden>
        <label id="code-label" for="code">6-digit sign-in code</label>
        <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required>
        <button type="submit" data-label="Verify and sign in">Verify and sign in</button>
      </form>
      <div id="status" class="notice" aria-live="polite" hidden></div>
      <div class="links"><a href="https://wateroncall.ca">Main website</a><a href="/hauler">Hauler application</a><a href="https://wateroncall.ca/privacy">Privacy</a></div>
    </section>
  </main>
  <script src="/app.js" defer></script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}


interface AccountUserRow extends UserRow {
  phone: string | null;
}

interface HaulerProfileRow {
  user_id: string;
  business_name: string;
  contact_name: string;
  phone: string;
  service_areas: string;
  truck_capacity_gallons: number;
  truck_count: number;
  license_number: string | null;
  insurance_expiry: string | null;
  application_notes: string | null;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

async function ensureHaulerSchema(env: Env): Promise<void> {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS hauler_profiles (user_id TEXT PRIMARY KEY, business_name TEXT NOT NULL, contact_name TEXT NOT NULL, phone TEXT NOT NULL, service_areas TEXT NOT NULL, truck_capacity_gallons INTEGER NOT NULL, truck_count INTEGER NOT NULL DEFAULT 1, license_number TEXT, insurance_expiry TEXT, application_notes TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')), rejection_reason TEXT, reviewed_at TEXT, reviewed_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_hauler_profiles_status ON hauler_profiles(status, created_at DESC)").run();
}

function escapeHtml(value: string | null): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sessionUser(request: Request, env: Env): Promise<AccountUserRow | null> {
  const token = cookieValue(request, "woc_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(
    "SELECT users.id, users.email, users.role, users.full_name, users.phone FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND datetime(sessions.expires_at) > datetime('now') LIMIT 1"
  ).bind(tokenHash).first<AccountUserRow>();
}

const ACCOUNT_SCRIPT = [
  'document.addEventListener("DOMContentLoaded", () => {',
  '  const message = document.getElementById("message");',
  '  const orderList = document.getElementById("order-list");',
  '  const emptyOrders = document.getElementById("empty-orders");',
  '  const timing = document.getElementById("delivery_timing");',
  '  const dateWrap = document.getElementById("date-wrap");',
  '  const dateInput = document.getElementById("requested_date");',
  '  const show = (text, error = false) => { message.textContent = text; message.hidden = false; message.className = error ? "message error" : "message success"; window.scrollTo({ top: 0, behavior: "smooth" }); };',
  '  const busy = (form, state) => { const button = form.querySelector("button[type=submit]"); button.disabled = state; button.textContent = state ? "Please wait…" : button.dataset.label; };',
  '  const updateDate = () => { const scheduled = timing.value === "scheduled"; dateWrap.hidden = !scheduled; dateInput.required = scheduled; if (!scheduled) dateInput.value = ""; };',
  '  timing.addEventListener("change", updateDate); updateDate();',
  '  document.getElementById("profile-form").addEventListener("submit", async (event) => {',
  '    event.preventDefault(); const form = event.currentTarget; busy(form, true);',
  '    try { const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); show("Contact details saved."); }',
  '    catch (error) { show(error.message || "Unable to save contact details.", true); } finally { busy(form, false); }',
  '  });',
  '  document.getElementById("order-form").addEventListener("submit", async (event) => {',
  '    event.preventDefault(); const form = event.currentTarget; busy(form, true);',
  '    try { const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); show("Delivery request submitted. We will notify you when a hauler accepts it."); form.reset(); updateDate(); await loadOrders(); }',
  '    catch (error) { show(error.message || "Unable to submit the delivery request.", true); } finally { busy(form, false); }',
  '  });',
  '  document.getElementById("logout").addEventListener("click", async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; });',
  '  const label = (value) => String(value || "").replaceAll("_", " ").replace(/\\b\\w/g, (letter) => letter.toUpperCase());',
  '  async function loadOrders() {',
  '    const response = await fetch("/api/orders"); if (response.status === 401) { window.location.href = "/login"; return; }',
  '    const data = await response.json(); orderList.textContent = ""; emptyOrders.hidden = data.orders.length > 0;',
  '    data.orders.forEach((order) => {',
  '      const item = document.createElement("article"); item.className = "order-item"; item.tabIndex = 0; item.setAttribute("role", "button"); item.setAttribute("aria-expanded", "false");',
  '      const top = document.createElement("div"); top.className = "order-top";',
  '      const title = document.createElement("strong"); title.textContent = label(order.order_type) + " · " + Number(order.gallons).toLocaleString() + " gallons";',
  '      const status = document.createElement("span"); status.className = "status"; status.textContent = label(order.status);',
  '      const summary = document.createElement("p"); summary.textContent = order.address_line1 + ", " + order.city + " · Requested " + new Date(order.created_at + "Z").toLocaleDateString();',
  '      const hint = document.createElement("span"); hint.className = "view-hint"; hint.textContent = "View request details";',
  '      const expanded = document.createElement("div"); expanded.className = "order-details"; expanded.hidden = true;',
  '      const address = [order.address_line1, order.address_line2, order.city, order.province, order.postal_code].filter(Boolean).join(", ");',
  '      const fields = [["Delivery timing", label(order.delivery_timing)], ["Preferred date", order.requested_date || "Not specified"], ["Delivery address", address], ["Hose distance", Number(order.hose_distance_ft).toLocaleString() + " ft"], ["Notes", order.delivery_notes || "No notes provided."]];',
  '      fields.forEach(([name, value]) => { const row = document.createElement("div"); const heading = document.createElement("strong"); const text = document.createElement("span"); heading.textContent = name; text.textContent = String(value); row.append(heading, text); expanded.append(row); });',
  '      const repeat = document.createElement("button"); repeat.type = "button"; repeat.className = "repeat-button"; repeat.textContent = "Order again";',
  '      repeat.addEventListener("click", (event) => { event.stopPropagation(); const form = document.getElementById("order-form"); const values = { order_type: order.order_type, gallons: String(order.gallons), delivery_timing: order.delivery_timing, address_line1: order.address_line1, address_line2: order.address_line2 || "", city: order.city, postal_code: order.postal_code, hose_distance_ft: String(order.hose_distance_ft), delivery_notes: order.delivery_notes || "" }; Object.entries(values).forEach(([name, value]) => { const field = form.elements.namedItem(name); if (field) field.value = value; }); dateInput.value = ""; updateDate(); form.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => timing.focus(), 450); });',
  '      repeat.addEventListener("keydown", (event) => event.stopPropagation()); expanded.append(repeat);',
  '      if (order.status === "requested" || order.status === "offered") { const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "cancel-button"; cancel.textContent = "Cancel request"; cancel.addEventListener("keydown", (event) => event.stopPropagation()); cancel.addEventListener("click", async (event) => { event.stopPropagation(); if (!window.confirm("Cancel this delivery request? This cannot be undone.")) return; cancel.disabled = true; try { const response = await fetch("/api/orders/" + encodeURIComponent(order.id) + "/cancel", { method: "POST" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); show("Delivery request cancelled. Confirmation emails have been sent."); await loadOrders(); } catch (error) { show(error.message || "Unable to cancel this request.", true); cancel.disabled = false; } }); expanded.append(cancel); }',
  '      const toggle = () => { const open = expanded.hidden; expanded.hidden = !open; item.setAttribute("aria-expanded", String(open)); hint.textContent = open ? "Hide request details" : "View request details"; };',
  '      item.addEventListener("click", toggle); item.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } });',
  '      top.append(title, status); item.append(top, summary, hint, expanded); orderList.append(item);',
  '    });',
  '  }',
  '  const phoneStart = document.getElementById("phone-verify-start");',
  '  const phoneForm = document.getElementById("phone-verify-form");',
  '  phoneStart.addEventListener("click", async () => { phoneStart.disabled = true; const original = phoneStart.textContent; phoneStart.textContent = "Sending…"; try { const response = await fetch("/api/phone/request", { method: "POST" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); phoneForm.hidden = false; document.getElementById("phone_code").focus(); show("We sent a 6-digit verification code to your saved mobile number."); } catch (error) { show(error.message || "Unable to send the text.", true); } finally { phoneStart.disabled = false; phoneStart.textContent = original; } });',
  '  phoneForm.addEventListener("submit", async (event) => { event.preventDefault(); const button = phoneForm.querySelector("button"); button.disabled = true; button.textContent = "Verifying…"; try { const response = await fetch("/api/phone/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: document.getElementById("phone_code").value }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); show("Mobile number verified. You can now choose Text me a code when signing in."); phoneForm.hidden = true; phoneStart.textContent = "Mobile verified for text sign-in"; } catch (error) { show(error.message || "Unable to verify the code.", true); button.disabled = false; button.textContent = "Verify mobile"; } });',
  '  loadOrders();',
  '});'
].join("\n");

function accountJavascript(): Response {
  return new Response(ACCOUNT_SCRIPT, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function accountPage(user: AccountUserRow, phoneVerified: boolean): Response {
  const html = [
    '<!doctype html><html lang="en"><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0877f9">',
    '<title>My Account — Water OnCall</title>',
    '<style>',
    ':root{color-scheme:light;--blue:#0877f9;--navy:#06325e;--ink:#13283d;--muted:#61778d;--line:#dce8f3;--wash:#f3f9ff;--green:#08764b;--red:#a32121}',
    '*{box-sizing:border-box}body{margin:0;background:#f4f9fd;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    'header{background:#fff;border-bottom:1px solid var(--line);padding:16px max(20px,calc((100vw - 1120px)/2));display:flex;justify-content:space-between;align-items:center;gap:18px;position:sticky;top:0;z-index:2}',
    '.brand{font-size:21px;font-weight:850;color:var(--navy)}.brand span{color:var(--blue)}.account{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:13px}.hauler-link{color:var(--navy);font-weight:750}.link-button{width:auto;height:auto;margin:0;padding:9px 13px;background:#eaf4ff;color:var(--navy);font-size:13px}',
    'main{max-width:1120px;margin:auto;padding:38px 20px 70px}.welcome{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:28px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--blue);font-size:12px;font-weight:850}h1{font-size:clamp(32px,5vw,52px);letter-spacing:-.04em;color:var(--navy);margin:8px 0 4px}p{color:var(--muted);line-height:1.5;margin:0}',
    '.message{padding:14px 16px;border-radius:12px;margin:0 0 22px;font-weight:650}.message.success{background:#e4f8ef;color:var(--green)}.message.error{background:#ffebeb;color:var(--red)}',
    '.grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:22px;align-items:start}.stack{display:grid;gap:22px}.card{background:#fff;border:1px solid var(--line);border-radius:19px;padding:25px;box-shadow:0 12px 35px #06325e0d}.card h2{margin:0 0 6px;color:var(--navy);font-size:22px}.intro{margin-bottom:21px;font-size:14px}',
    '.fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field.full{grid-column:1/-1}label{display:block;font-size:13px;font-weight:750;margin-bottom:7px}input,select,textarea{width:100%;border:1px solid #bdd0e1;border-radius:11px;background:#fff;color:var(--ink);font:inherit;padding:12px}input,select{height:48px}textarea{min-height:94px;resize:vertical}input:focus,select:focus,textarea:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px #0877f91a}',
    'button{height:49px;width:100%;border:0;border-radius:11px;background:var(--blue);color:#fff;font-size:15px;font-weight:800;cursor:pointer;margin-top:17px}button:disabled{opacity:.6;cursor:not-allowed}.fine{font-size:12px;margin-top:10px}.order-list{display:grid;gap:11px}.order-item{border:1px solid var(--line);border-radius:12px;padding:14px;cursor:pointer}.order-item:hover,.order-item:focus{border-color:var(--blue);outline:none;box-shadow:0 0 0 3px #0877f914}.order-top{display:flex;justify-content:space-between;gap:10px}.order-item p{font-size:13px;margin-top:5px}.view-hint{display:inline-block;margin-top:8px;color:var(--blue);font-size:12px;font-weight:750}.order-details{border-top:1px solid var(--line);margin-top:12px;padding-top:12px;cursor:default}.order-details div{display:grid;grid-template-columns:125px 1fr;gap:10px;padding:6px 0;font-size:13px}.order-details strong{color:var(--navy)}.order-details span{color:var(--muted);overflow-wrap:anywhere}.repeat-button,.cancel-button{width:auto;height:42px;margin:12px 9px 0 0;padding:0 18px}.repeat-button{background:#eaf4ff;color:var(--navy)}.repeat-button:hover{background:#dbeeff}.cancel-button{background:#fff0f0;color:var(--red);border:1px solid #f2caca}.cancel-button:hover{background:#ffe4e4}.phone-verification{border-top:1px solid var(--line);margin-top:20px;padding-top:18px}.phone-verification p{font-size:13px}.phone-verification button{background:#eaf4ff;color:var(--navy);margin-top:12px}.phone-verification form{margin-top:12px}.phone-verification form button{background:var(--blue);color:#fff}.cancel-button:hover{background:#ffe4e4}.status{background:#eaf4ff;color:var(--navy);border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;white-space:nowrap}.empty{padding:18px;border:1px dashed #bdd0e1;border-radius:12px;text-align:center;font-size:14px}',
    '@media(max-width:800px){.grid{grid-template-columns:1fr}.welcome{align-items:start}.account span{display:none}}@media(max-width:560px){header{padding:14px 16px}main{padding:28px 15px 55px}.fields{grid-template-columns:1fr}.field.full{grid-column:auto}.card{padding:20px}.order-top{align-items:start;flex-direction:column}}',
    '</style></head><body>',
    '<header><div class="brand"><span>Water</span> OnCall</div><div class="account"><a href="/hauler" class="hauler-link">Hauler application</a><span>' + escapeHtml(user.email) + '</span><button id="logout" class="link-button" type="button">Sign out</button></div></header>',
    '<main><div class="welcome"><div><div class="eyebrow">Customer portal</div><h1>My Water OnCall</h1><p>Request water and follow every delivery in one place.</p></div></div>',
    '<div id="message" class="message" aria-live="polite" hidden></div>',
    '<div class="grid"><div class="stack">',
    '<section class="card"><h2>Contact details</h2><p class="intro">We use this information to coordinate your delivery.</p>',
    '<form id="profile-form"><div class="fields"><div class="field full"><label for="full_name">Full name</label><input id="full_name" name="full_name" autocomplete="name" maxlength="100" value="' + escapeHtml(user.full_name) + '" required></div>',
    '<div class="field"><label for="phone">Mobile phone</label><input id="phone" name="phone" type="tel" autocomplete="tel" maxlength="30" value="' + escapeHtml(user.phone) + '" required></div>',
    '<div class="field"><label>Email address</label><input value="' + escapeHtml(user.email) + '" disabled></div></div><button type="submit" data-label="Save contact details">Save contact details</button></form><div class="phone-verification"><p>Verify your saved mobile number once to enable faster text-message sign-in.</p><button id="phone-verify-start" type="button">' + (phoneVerified ? 'Reverify or change mobile' : 'Verify mobile for text sign-in') + '</button><form id="phone-verify-form" hidden><label for="phone_code">6-digit text-message code</label><input id="phone_code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required><button type="submit">Verify mobile</button></form></div></section>',
    '<section class="card"><h2>My requests</h2><p class="intro">Your newest delivery requests appear first.</p><div id="empty-orders" class="empty">No delivery requests yet.</div><div id="order-list" class="order-list"></div></section>',
    '</div><section class="card"><div class="eyebrow">New delivery</div><h2>Request bulk water</h2><p class="intro">Tell us what you need. Pricing and the delivery window will be confirmed before dispatch.</p>',
    '<form id="order-form"><div class="fields">',
    '<div class="field"><label for="order_type">What needs water?</label><select id="order_type" name="order_type" required><option value="cistern">Cistern</option><option value="pool">Pool</option><option value="hot_tub">Hot tub</option><option value="commercial">Commercial or job site</option><option value="other">Other</option></select></div>',
    '<div class="field"><label for="gallons">Amount required</label><select id="gallons" name="gallons" required><option value="2000">Up to 2,000 gallons</option><option value="2500">2,500 gallons</option><option value="3000">3,000 gallons</option></select></div>',
    '<div class="field"><label for="delivery_timing">When do you need it?</label><select id="delivery_timing" name="delivery_timing" required><option value="flexible">Next 1–2 days</option><option value="scheduled">Choose a date</option><option value="urgent">Urgent refill</option></select></div>',
    '<div id="date-wrap" class="field" hidden><label for="requested_date">Preferred date</label><input id="requested_date" name="requested_date" type="date"></div>',
    '<div class="field full"><label for="address_line1">Delivery address</label><input id="address_line1" name="address_line1" autocomplete="street-address" maxlength="150" required></div>',
    '<div class="field"><label for="address_line2">Unit or location details</label><input id="address_line2" name="address_line2" maxlength="100" placeholder="Optional"></div>',
    '<div class="field"><label for="city">City or town</label><input id="city" name="city" autocomplete="address-level2" maxlength="80" required></div>',
    '<div class="field"><label for="postal_code">Postal code</label><input id="postal_code" name="postal_code" autocomplete="postal-code" maxlength="7" placeholder="L0R 1B0" required></div>',
    '<div class="field"><label for="hose_distance_ft">Hose distance</label><select id="hose_distance_ft" name="hose_distance_ft"><option value="50">Up to 50 ft included</option><option value="100">Up to 100 ft</option><option value="150">Up to 150 ft</option><option value="200">Up to 200 ft</option><option value="250">More than 200 ft</option></select></div>',
    '<div class="field full"><label for="delivery_notes">Delivery notes</label><textarea id="delivery_notes" name="delivery_notes" maxlength="1000" placeholder="Cistern location, access instructions, gate or door codes, or anything the driver should know."></textarea></div>',
    '</div><button type="submit" data-label="Submit delivery request">Submit delivery request</button><p class="fine">Submitting this form requests service; it does not charge your card.</p></form></section></div></main>',
    '<script src="/account.js" defer></script></body></html>'
  ].join("");

  return new Response(html, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}



const HAULER_SCRIPT = [
  'document.addEventListener("DOMContentLoaded", () => {',
  '  const form = document.getElementById("hauler-form"); const message = document.getElementById("hauler-message");',
  '  const show = (text, error = false) => { message.textContent = text; message.hidden = false; message.className = error ? "message error" : "message success"; window.scrollTo({ top: 0, behavior: "smooth" }); };',
  '  if (form) form.addEventListener("submit", async (event) => { event.preventDefault(); const button = form.querySelector("button[type=submit]"); button.disabled = true; button.textContent = "Submitting…"; try { const response = await fetch("/api/hauler/application", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); show("Application submitted for administrator approval."); setTimeout(() => window.location.reload(), 900); } catch (error) { show(error.message || "Unable to submit the application.", true); button.disabled = false; button.textContent = button.dataset.label; } });',
  '  document.getElementById("hauler-logout").addEventListener("click", async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login?next=/hauler"; });',
  '});'
].join("\n");

function haulerJavascript(): Response {
  return new Response(HAULER_SCRIPT, { headers: { ...securityHeaders, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
}

function haulerPage(user: AccountUserRow, profile: HaulerProfileRow | null): Response {
  const status = profile?.status ?? "not_submitted";
  const statusTitle = status === "approved" ? "Approved" : status === "pending" ? "Pending administrator review" : status === "rejected" ? "Changes required" : "Start your application";
  const statusText = status === "approved"
    ? "Your company is approved. Available delivery requests will appear here when the dispatch workflow is enabled."
    : status === "pending"
      ? "Water OnCall is reviewing your application. You will receive an email when a decision is made."
      : status === "rejected"
        ? (profile?.rejection_reason || "Review the application and submit updated information.")
        : "Tell us about your delivery business. No jobs are available until Water OnCall approves the application.";
  const showForm = !profile || status === "rejected";
  const form = showForm ? [
    '<section class="card"><h2>' + (profile ? 'Update application' : 'Hauler application') + '</h2><p class="intro">All haulers must be reviewed and approved before accessing delivery requests.</p><form id="hauler-form"><div class="fields">',
    '<div class="field full"><label for="business_name">Business name</label><input id="business_name" name="business_name" maxlength="120" value="' + escapeHtml(profile?.business_name ?? "") + '" required></div>',
    '<div class="field"><label for="contact_name">Primary contact</label><input id="contact_name" name="contact_name" maxlength="100" value="' + escapeHtml(profile?.contact_name ?? user.full_name ?? "") + '" required></div>',
    '<div class="field"><label for="phone">Mobile phone</label><input id="phone" name="phone" type="tel" maxlength="30" value="' + escapeHtml(profile?.phone ?? user.phone ?? "") + '" required></div>',
    '<div class="field full"><label for="service_areas">Service areas</label><input id="service_areas" name="service_areas" maxlength="300" placeholder="Cities, towns, counties, or postal-code areas" value="' + escapeHtml(profile?.service_areas ?? "") + '" required></div>',
    '<div class="field"><label for="truck_capacity_gallons">Truck capacity</label><select id="truck_capacity_gallons" name="truck_capacity_gallons" required><option value="2000">2,000 gallons</option><option value="2500">2,500 gallons</option><option value="3000">3,000 gallons</option></select></div>',
    '<div class="field"><label for="truck_count">Number of trucks</label><input id="truck_count" name="truck_count" type="number" min="1" max="100" value="' + escapeHtml(String(profile?.truck_count ?? 1)) + '" required></div>',
    '<div class="field"><label for="license_number">Business or operating licence</label><input id="license_number" name="license_number" maxlength="100" value="' + escapeHtml(profile?.license_number ?? "") + '" placeholder="Optional during testing"></div>',
    '<div class="field"><label for="insurance_expiry">Insurance expiry</label><input id="insurance_expiry" name="insurance_expiry" type="date" value="' + escapeHtml(profile?.insurance_expiry ?? "") + '"></div>',
    '<div class="field full"><label for="application_notes">Additional information</label><textarea id="application_notes" name="application_notes" maxlength="1000" placeholder="Water source, equipment, availability, or anything Water OnCall should know.">' + escapeHtml(profile?.application_notes ?? "") + '</textarea></div>',
    '</div><button type="submit" data-label="Submit for approval">Submit for approval</button></form></section>'
  ].join("") : [
    '<section class="card"><h2>Application details</h2><div class="details">',
    '<div><strong>Business</strong><span>' + escapeHtml(profile?.business_name ?? "") + '</span></div>',
    '<div><strong>Contact</strong><span>' + escapeHtml(profile?.contact_name ?? "") + '</span></div>',
    '<div><strong>Phone</strong><span>' + escapeHtml(profile?.phone ?? "") + '</span></div>',
    '<div><strong>Service areas</strong><span>' + escapeHtml(profile?.service_areas ?? "") + '</span></div>',
    '<div><strong>Truck capacity</strong><span>' + escapeHtml(String(profile?.truck_capacity_gallons ?? "")) + ' gallons</span></div>',
    '<div><strong>Trucks</strong><span>' + escapeHtml(String(profile?.truck_count ?? "")) + '</span></div>',
    '</div></section>'
  ].join("");
  const selectedCapacityScript = showForm && profile ? '<script>document.getElementById("truck_capacity_gallons").value="' + escapeHtml(String(profile.truck_capacity_gallons)) + '";</script>' : "";
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0877f9"><title>Hauler Portal — Water OnCall</title>',
    '<style>:root{color-scheme:light;--blue:#0877f9;--navy:#06325e;--ink:#13283d;--muted:#61778d;--line:#dce8f3;--green:#08764b;--red:#a32121}*{box-sizing:border-box}body{margin:0;background:#f4f9fd;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:#fff;border-bottom:1px solid var(--line);padding:16px max(20px,calc((100vw - 920px)/2));display:flex;justify-content:space-between;align-items:center}.brand{font-size:21px;font-weight:850;color:var(--navy)}.brand span{color:var(--blue)}.account{display:flex;gap:12px;align-items:center;color:var(--muted);font-size:13px}button{border:0;border-radius:11px;background:var(--blue);color:#fff;font-weight:800;cursor:pointer}header button{background:#eaf4ff;color:var(--navy);padding:10px 14px}.account span{max-width:220px;overflow:hidden;text-overflow:ellipsis}main{max-width:920px;margin:auto;padding:38px 20px 70px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--blue);font-size:12px;font-weight:850}h1{font-size:clamp(32px,5vw,48px);letter-spacing:-.04em;color:var(--navy);margin:8px 0 5px}.lead{color:var(--muted);margin:0 0 24px}.status-card,.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px;box-shadow:0 10px 30px #06325e0d}.status-card{margin-bottom:20px;border-left:5px solid var(--blue)}.status-card h2,.card h2{margin:0 0 7px;color:var(--navy)}.status-card p,.intro{color:var(--muted);line-height:1.5;margin:0}.intro{margin-bottom:20px}.message{padding:14px 16px;border-radius:12px;margin-bottom:20px;font-weight:650}.message.success{background:#e4f8ef;color:var(--green)}.message.error{background:#ffebeb;color:var(--red)}.fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field.full{grid-column:1/-1}label{display:block;font-size:13px;font-weight:750;margin-bottom:7px}input,select,textarea{width:100%;border:1px solid #bdd0e1;border-radius:11px;background:#fff;color:var(--ink);font:inherit;padding:12px}input,select{height:48px}textarea{min-height:95px;resize:vertical}.card button{width:100%;height:49px;margin-top:18px}.details{display:grid;gap:9px}.details div{display:grid;grid-template-columns:150px 1fr;gap:10px;padding:7px 0;border-bottom:1px solid #eef4f8;font-size:14px}.details span{color:var(--muted)}@media(max-width:600px){.account span{display:none}.fields{grid-template-columns:1fr}.field.full{grid-column:auto}.details div{grid-template-columns:1fr}}</style></head><body>',
    '<header><div class="brand"><span>Water</span> OnCall Hauler</div><div class="account"><span>' + escapeHtml(user.email) + '</span><button id="hauler-logout" type="button">Sign out</button></div></header>',
    '<main><div class="eyebrow">Delivery partner portal</div><h1>Hauler account</h1><p class="lead">Apply, track approval, and manage delivery work.</p><div id="hauler-message" class="message" aria-live="polite" hidden></div>',
    '<section class="status-card"><h2>' + escapeHtml(statusTitle) + '</h2><p>' + escapeHtml(statusText) + '</p></section>',
    form,
    '</main>', selectedCapacityScript, '<script src="/hauler.js" defer></script></body></html>'
  ].join("");
  return new Response(html, { headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function submitHaulerApplication(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  if (user.role === "admin") return json({ error: "The administrator account cannot submit a hauler application." }, 400);
  const body = await readBody(request);
  const businessName = textField(body?.business_name, 120);
  const contactName = textField(body?.contact_name, 100);
  const phone = textField(body?.phone, 30);
  const serviceAreas = textField(body?.service_areas, 300);
  const capacity = Number(body?.truck_capacity_gallons);
  const truckCount = Number(body?.truck_count);
  const licenseNumber = textField(body?.license_number, 100, false) || null;
  const insuranceExpiry = textField(body?.insurance_expiry, 10, false) || null;
  const notes = textField(body?.application_notes, 1000, false) || null;
  if (!businessName || !contactName || !phone || phone.replace(/\D/g, "").length < 7 || !serviceAreas) return json({ error: "Complete the business, contact, phone, and service-area fields." }, 400);
  if (![2000, 2500, 3000].includes(capacity) || !Number.isInteger(truckCount) || truckCount < 1 || truckCount > 100) return json({ error: "Choose a valid truck capacity and truck count." }, 400);
  if (insuranceExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(insuranceExpiry)) return json({ error: "Choose a valid insurance expiry date." }, 400);
  await ensureHaulerSchema(env);
  await env.DB.prepare(
    "INSERT INTO hauler_profiles (user_id, business_name, contact_name, phone, service_areas, truck_capacity_gallons, truck_count, license_number, insurance_expiry, application_notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending') ON CONFLICT(user_id) DO UPDATE SET business_name=excluded.business_name, contact_name=excluded.contact_name, phone=excluded.phone, service_areas=excluded.service_areas, truck_capacity_gallons=excluded.truck_capacity_gallons, truck_count=excluded.truck_count, license_number=excluded.license_number, insurance_expiry=excluded.insurance_expiry, application_notes=excluded.application_notes, status='pending', rejection_reason=NULL, reviewed_at=NULL, reviewed_by=NULL, updated_at=datetime('now')"
  ).bind(user.id, businessName, contactName, phone, serviceAreas, capacity, truckCount, licenseNumber, insuranceExpiry, notes).run();
  await env.DB.prepare("UPDATE users SET role='hauler', full_name=?, phone=?, updated_at=datetime('now') WHERE id=?").bind(contactName, phone, user.id).run();
  const normalizedPhone = normalizeCanadianPhone(phone);
  const intakeCapacity = Number(body?.custom_truck_capacity_gallons || capacity);
  const adminSync = syncLaravelProfile({
    profile_type: "hauler", external_user_id: user.id, email: user.email, name: contactName, phone_e164: normalizedPhone,
    company_name: businessName, business_address: textField(body?.business_address, 500, false) || null,
    business_address_line1: textField(body?.business_address_line1, 255, false) || null,
    business_address_line2: textField(body?.business_address_line2, 255, false) || null,
    business_city: textField(body?.business_city, 120, false) || null,
    business_province: textField(body?.business_province, 64, false) || null,
    business_postal_code: textField(body?.business_postal_code, 16, false) || null,
    business_address_validation_token: textField(body?.business_address_validation_token, 10000, false) || null,
    business_address_confirmed: Boolean(body?.business_address_confirmed),
    service_areas: serviceAreas, truck_capacity_gallons: intakeCapacity, truck_count: truckCount,
    business_number: licenseNumber, insurance_policy_number: textField(body?.liability_insurance_provider, 150, false) || textField(body?.vehicle_insurance_provider, 150, false) || null,
    insurance_expires_on: textField(body?.liability_insurance_expiry, 10, false) || textField(body?.vehicle_insurance_expiry, 10, false) || insuranceExpiry,
    application_notes: notes, business_hours: textField(body?.business_hours, 1000, false) || null,
    private_fill_stations: textField(body?.private_fill_stations, 2000, false) || null,
    private_fill_station_addresses: Array.isArray(body?.private_fill_station_addresses) ? body.private_fill_station_addresses : [],
    other_services: textField(body?.other_services, 2000, false) || null,
    agreement_accepted: Boolean(body?.damage_responsibility_ack),
    order_types: ["cistern", "pool", "hot_tub", "other"],
  });
  await Promise.all([
    adminSync,
    sendOrderEmail(env, user.email, "Water OnCall hauler application received", ["Hello " + contactName + ",", "", "We received the hauler application for " + businessName + ".", "Status: Pending administrator review", "", "We will email you when a decision is made."].join("\n")),
    sendOrderEmail(env, "info@wateroncall.ca", "New hauler application — " + businessName, ["A new hauler application requires review.", "", "Business: " + businessName, "Contact: " + contactName, "Email: " + user.email, "Phone: " + phone, "Service areas: " + serviceAreas, "Truck capacity: " + capacity.toLocaleString() + " gallons", "Number of trucks: " + truckCount].join("\n")),
  ]);
  return json({ ok: true, status: "pending" }, 201);
}

const ADMIN_HAULERS_SCRIPT = [
  'document.addEventListener("DOMContentLoaded", () => {',
  '  const list = document.getElementById("hauler-list"); const empty = document.getElementById("hauler-empty"); const message = document.getElementById("decision-message");',
  '  const field = (name, value) => { const row = document.createElement("div"); const strong = document.createElement("strong"); const span = document.createElement("span"); strong.textContent = name; span.textContent = String(value || "Not provided"); row.append(strong, span); return row; };',
  '  const show = (text, error = false) => { message.textContent = text; message.hidden = false; message.className = error ? "message error" : "message success"; };',
  '  async function decide(userId, status, button) { let reason = ""; if (status === "rejected") { reason = window.prompt("What should the hauler correct before applying again?") || ""; if (!reason.trim()) return; } button.disabled = true; try { const response = await fetch("/api/admin/haulers/" + encodeURIComponent(userId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, rejection_reason: reason }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); show("Hauler application " + status + " and the applicant was notified."); await load(); } catch (error) { show(error.message || "Unable to update the application.", true); button.disabled = false; } }',
  '  async function load() { const response = await fetch("/api/admin/haulers"); if (response.status === 401 || response.status === 403) { window.location.href = "/login"; return; } const data = await response.json(); list.textContent = ""; empty.hidden = data.haulers.length > 0; data.haulers.forEach((hauler) => { const card = document.createElement("article"); card.className = "hauler-card"; const head = document.createElement("div"); head.className = "hauler-head"; const title = document.createElement("div"); const name = document.createElement("h2"); name.textContent = hauler.business_name; const status = document.createElement("span"); status.className = "status " + hauler.status; status.textContent = hauler.status.toUpperCase(); title.append(name, status); head.append(title); if (hauler.status === "pending") { const actions = document.createElement("div"); actions.className = "actions"; const approve = document.createElement("button"); approve.textContent = "Approve"; const reject = document.createElement("button"); reject.textContent = "Request changes"; reject.className = "reject"; approve.addEventListener("click", () => decide(hauler.user_id, "approved", approve)); reject.addEventListener("click", () => decide(hauler.user_id, "rejected", reject)); actions.append(approve, reject); head.append(actions); } card.append(head); const details = document.createElement("div"); details.className = "details"; [["Contact",hauler.contact_name],["Email",hauler.email],["Phone",hauler.phone],["Service areas",hauler.service_areas],["Truck capacity",Number(hauler.truck_capacity_gallons).toLocaleString()+" gallons"],["Number of trucks",hauler.truck_count],["Licence",hauler.license_number],["Insurance expiry",hauler.insurance_expiry],["Notes",hauler.application_notes],["Reason",hauler.rejection_reason]].forEach(([key,value]) => { if (value) details.append(field(key,value)); }); card.append(details); list.append(card); }); }',
  '  document.getElementById("admin-hauler-logout").addEventListener("click", async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }); load();',
  '});'
].join("\n");

function adminHaulersJavascript(): Response {
  return new Response(ADMIN_HAULERS_SCRIPT, { headers: { ...securityHeaders, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
}

function adminHaulersPage(user: AccountUserRow): Response {
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hauler Applications — Water OnCall</title>',
    '<style>:root{color-scheme:light;--blue:#0877f9;--navy:#06325e;--ink:#13283d;--muted:#61778d;--line:#dce8f3;--green:#08764b;--red:#a32121}*{box-sizing:border-box}body{margin:0;background:#f4f9fd;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:#fff;border-bottom:1px solid var(--line);padding:16px max(20px,calc((100vw - 1120px)/2));display:flex;justify-content:space-between;align-items:center}.brand{font-size:21px;font-weight:850;color:var(--navy)}.brand span{color:var(--blue)}.account{display:flex;gap:12px;align-items:center;font-size:13px;color:var(--muted)}a{color:var(--navy);font-weight:750}button{border:0;border-radius:10px;background:var(--blue);color:#fff;padding:10px 14px;font-weight:800;cursor:pointer}header button{background:#eaf4ff;color:var(--navy)}main{max-width:1120px;margin:auto;padding:38px 20px 70px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--blue);font-size:12px;font-weight:850}h1{font-size:clamp(32px,5vw,50px);letter-spacing:-.04em;color:var(--navy);margin:8px 0 4px}.lead{color:var(--muted);margin:0}.message{padding:14px 16px;border-radius:12px;margin:20px 0;font-weight:650}.message.success{background:#e4f8ef;color:var(--green)}.message.error{background:#ffebeb;color:var(--red)}.list{display:grid;gap:18px;margin-top:25px}.hauler-card{background:#fff;border:1px solid var(--line);border-radius:17px;padding:22px}.hauler-head{display:flex;justify-content:space-between;gap:16px;align-items:start}.hauler-head h2{margin:0 0 7px;color:var(--navy)}.status{display:inline-block;border-radius:999px;background:#fff3cd;color:#725400;padding:5px 9px;font-size:11px;font-weight:850}.status.approved{background:#e4f8ef;color:var(--green)}.status.rejected{background:#ffebeb;color:var(--red)}.actions{display:flex;gap:8px}.actions .reject{background:#fff0f0;color:var(--red);border:1px solid #f2caca}.details{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;border-top:1px solid var(--line);margin-top:16px;padding-top:10px}.details div{display:grid;grid-template-columns:130px 1fr;gap:10px;padding:7px 0;font-size:13px}.details span{color:var(--muted);overflow-wrap:anywhere}.empty{margin-top:25px;background:#fff;border:1px dashed #bdd0e1;border-radius:14px;padding:30px;text-align:center;color:var(--muted)}@media(max-width:700px){.account span{display:none}.hauler-head{display:grid}.actions{width:100%}.actions button{flex:1}.details{grid-template-columns:1fr}.details div{grid-template-columns:110px 1fr}}</style></head><body>',
    '<header><div class="brand"><span>Water</span> OnCall Admin</div><div class="account"><a href="/admin">Orders</a><span>' + escapeHtml(user.email) + '</span><button id="admin-hauler-logout" type="button">Sign out</button></div></header>',
    '<main><div class="eyebrow">Partner management</div><h1>Hauler applications</h1><p class="lead">Review each delivery company before granting marketplace access.</p><div id="decision-message" class="message" aria-live="polite" hidden></div><div id="hauler-empty" class="empty">No hauler applications yet.</div><div id="hauler-list" class="list"></div></main><script src="/admin-haulers.js" defer></script></body></html>'
  ].join("");
  return new Response(html, { headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function listAdminHaulers(request: Request, env: Env): Promise<Response> {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  if (user.role !== "admin") return json({ error: "Administrator access required." }, 403);
  await ensureHaulerSchema(env);
  const result = await env.DB.prepare("SELECT hauler_profiles.*, users.email FROM hauler_profiles JOIN users ON users.id=hauler_profiles.user_id ORDER BY CASE hauler_profiles.status WHEN 'pending' THEN 0 ELSE 1 END, hauler_profiles.created_at DESC").all();
  return json({ haulers: result.results });
}

async function decideHaulerApplication(request: Request, env: Env, userId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const admin = await sessionUser(request, env);
  if (!admin) return json({ error: "Please sign in again." }, 401);
  if (admin.role !== "admin") return json({ error: "Administrator access required." }, 403);
  const body = await readBody(request);
  const status = String(body?.status ?? "");
  const reason = textField(body?.rejection_reason, 500, false) || null;
  if (!["approved", "rejected"].includes(status)) return json({ error: "Choose approve or request changes." }, 400);
  if (status === "rejected" && !reason) return json({ error: "Explain what the hauler should correct." }, 400);
  await ensureHaulerSchema(env);
  const profile = await env.DB.prepare("SELECT hauler_profiles.business_name, hauler_profiles.contact_name, users.email FROM hauler_profiles JOIN users ON users.id=hauler_profiles.user_id WHERE hauler_profiles.user_id=? LIMIT 1").bind(userId).first<{ business_name: string; contact_name: string; email: string }>();
  if (!profile) return json({ error: "Hauler application not found." }, 404);
  await env.DB.prepare("UPDATE hauler_profiles SET status=?, rejection_reason=?, reviewed_at=datetime('now'), reviewed_by=?, updated_at=datetime('now') WHERE user_id=?").bind(status, status === "rejected" ? reason : null, admin.id, userId).run();
  const decisionText = status === "approved" ? "Your Water OnCall hauler application has been approved." : "Your Water OnCall hauler application needs changes before approval.\\n\\nRequested change: " + reason;
  const emailSent = await sendOrderEmail(env, profile.email, "Water OnCall hauler application — " + readable(status), ["Hello " + profile.contact_name + ",", "", decisionText, "", "Sign in to the Water OnCall hauler portal to review your status."].join("\\n"));
  return json({ ok: true, emailSent, status });
}

const ADMIN_SCRIPT = [
  'document.addEventListener("DOMContentLoaded", () => {',
  '  const list = document.getElementById("admin-orders"); const empty = document.getElementById("admin-empty"); const message = document.getElementById("admin-message");',
  '  const label = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());',
  '  const line = (name, value) => { const row = document.createElement("div"); const strong = document.createElement("strong"); const span = document.createElement("span"); strong.textContent = name; span.textContent = String(value || "Not provided"); row.append(strong, span); return row; };',
  '  const show = (text, error = false) => { message.textContent = text; message.hidden = false; message.className = error ? "message error" : "message success"; };',
  '  async function load() {',
  '    const response = await fetch("/api/admin/orders"); if (response.status === 401 || response.status === 403) { window.location.href = "/login"; return; }',
  '    const data = await response.json(); list.textContent = ""; empty.hidden = data.orders.length > 0;',
  '    data.orders.forEach((order) => {',
  '      const card = document.createElement("article"); card.className = "admin-order";',
  '      const head = document.createElement("div"); head.className = "admin-head"; const title = document.createElement("div"); const name = document.createElement("h2"); name.textContent = label(order.order_type) + " · " + Number(order.gallons).toLocaleString() + " gallons"; const meta = document.createElement("p"); meta.textContent = "Requested " + new Date(order.created_at + "Z").toLocaleString(); title.append(name, meta);',
  '      const select = document.createElement("select"); select.setAttribute("aria-label", "Order status"); ["requested","offered","accepted","assigned","en_route","delivered","cancelled"].forEach((status) => { const option = document.createElement("option"); option.value = status; option.textContent = label(status); option.selected = status === order.status; select.append(option); }); select.dataset.previous = order.status;',
  '      select.addEventListener("change", async () => { const previous = select.dataset.previous; select.disabled = true; try { const response = await fetch("/api/admin/orders/" + encodeURIComponent(order.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: select.value }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); select.dataset.previous = select.value; if (data.unchanged) show("The order was already " + label(select.value) + ". No email was sent."); else if (data.emailSent) show("Order status updated to " + label(select.value) + " and the customer was notified."); else show("Order status updated, but the customer email could not be sent.", true); } catch (error) { select.value = previous; show(error.message || "Unable to update status.", true); } finally { select.disabled = false; } });',
  '      head.append(title, select); card.append(head);',
  '      const details = document.createElement("div"); details.className = "admin-details"; const address = [order.address_line1, order.address_line2, order.city, order.province, order.postal_code].filter(Boolean).join(", "); [["Customer", order.full_name],["Email", order.email],["Phone", order.phone],["Delivery timing", label(order.delivery_timing)],["Preferred date", order.requested_date],["Address", address],["Hose distance", order.hose_distance_ft + " ft"],["Notes", order.delivery_notes || "No notes provided."],["Request ID", order.id]].forEach(([key,value]) => details.append(line(key,value))); card.append(details); list.append(card);',
  '    });',
  '  }',
  '  document.getElementById("admin-logout").addEventListener("click", async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }); load();',
  '});'
].join("\n");

function adminJavascript(): Response {
  return new Response(ADMIN_SCRIPT, {
    headers: { ...securityHeaders, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function adminPage(user: AccountUserRow): Response {
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0877f9"><title>Order Administration — Water OnCall</title>',
    '<style>:root{color-scheme:light;--blue:#0877f9;--navy:#06325e;--ink:#13283d;--muted:#61778d;--line:#dce8f3;--green:#08764b;--red:#a32121}*{box-sizing:border-box}body{margin:0;background:#f4f9fd;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:#fff;border-bottom:1px solid var(--line);padding:16px max(20px,calc((100vw - 1120px)/2));display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:2}.brand{font-size:21px;font-weight:850;color:var(--navy)}.brand span{color:var(--blue)}.account{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:13px}button{border:0;border-radius:10px;background:#eaf4ff;color:var(--navy);padding:10px 14px;font-weight:750;cursor:pointer}main{max-width:1120px;margin:auto;padding:38px 20px 70px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--blue);font-size:12px;font-weight:850}h1{font-size:clamp(32px,5vw,52px);letter-spacing:-.04em;color:var(--navy);margin:8px 0 5px}p{margin:0;color:var(--muted);line-height:1.5}.message{padding:14px 16px;border-radius:12px;margin:20px 0;font-weight:650}.message.success{background:#e4f8ef;color:var(--green)}.message.error{background:#ffebeb;color:var(--red)}.orders{display:grid;gap:18px;margin-top:26px}.admin-order{background:#fff;border:1px solid var(--line);border-radius:17px;padding:22px;box-shadow:0 10px 30px #06325e0d}.admin-head{display:flex;justify-content:space-between;gap:20px;align-items:start}.admin-head h2{margin:0 0 5px;color:var(--navy);font-size:21px}.admin-head p{font-size:13px}.admin-head select{min-width:145px;height:44px;border:1px solid #bdd0e1;border-radius:10px;background:#fff;padding:0 10px;font:inherit;font-weight:750;color:var(--navy)}.admin-details{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;border-top:1px solid var(--line);margin-top:17px;padding-top:12px}.admin-details div{display:grid;grid-template-columns:120px 1fr;gap:10px;padding:7px 0;font-size:13px}.admin-details strong{color:var(--navy)}.admin-details span{color:var(--muted);overflow-wrap:anywhere}.empty{margin-top:26px;background:#fff;border:1px dashed #bdd0e1;border-radius:14px;padding:30px;text-align:center;color:var(--muted)}@media(max-width:700px){.account span{display:none}.admin-head{display:grid}.admin-head select{width:100%}.admin-details{grid-template-columns:1fr}.admin-details div{grid-template-columns:105px 1fr}}</style></head><body>',
    '<header><div class="brand"><span>Water</span> OnCall Admin</div><div class="account"><a href="/admin/haulers" style="color:var(--navy);font-weight:750">Hauler applications</a><span>' + escapeHtml(user.email) + '</span><button id="admin-logout" type="button">Sign out</button></div></header>',
    '<main><div class="eyebrow">Operations</div><h1>Delivery requests</h1><p>Review customer details and update each request as it moves through dispatch.</p><div id="admin-message" class="message" aria-live="polite" hidden></div><div id="admin-empty" class="empty">No delivery requests yet.</div><div id="admin-orders" class="orders"></div></main><script src="/admin.js" defer></script></body></html>'
  ].join("");
  return new Response(html, { headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function listAdminOrders(request: Request, env: Env): Promise<Response> {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  if (user.role !== "admin") return json({ error: "Administrator access required." }, 403);
  const result = await env.DB.prepare(
    "SELECT orders.*, users.email, users.full_name, users.phone FROM orders JOIN users ON users.id = orders.customer_id ORDER BY orders.created_at DESC LIMIT 200"
  ).all();
  return json({ orders: result.results });
}

async function updateAdminOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  if (user.role !== "admin") return json({ error: "Administrator access required." }, 403);
  const body = await readBody(request);
  const status = String(body?.status ?? "");
  const allowed = ["requested", "offered", "accepted", "assigned", "en_route", "delivered", "cancelled"];
  if (!allowed.includes(status)) return json({ error: "Choose a valid order status." }, 400);
  const order = await env.DB.prepare(
    "SELECT orders.id, orders.status, orders.order_type, orders.gallons, orders.city, users.email, users.full_name FROM orders JOIN users ON users.id = orders.customer_id WHERE orders.id = ? LIMIT 1"
  ).bind(orderId).first<{ id: string; status: string; order_type: string; gallons: number; city: string; email: string; full_name: string | null }>();
  if (!order) return json({ error: "Order not found." }, 404);
  if (order.status === status) return json({ ok: true, unchanged: true, emailSent: false, order: { id: orderId, status } });

  await env.DB.prepare(
    "UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(status, orderId).run();

  const statusText = readable(status);
  const statusMessages: Record<string, string> = {
    requested: "Your delivery request is waiting for review.",
    offered: "A delivery option is available for your request.",
    accepted: "Your delivery request has been accepted.",
    assigned: "A hauler has been assigned to your delivery.",
    en_route: "Your water delivery is now en route.",
    delivered: "Your water delivery has been marked delivered.",
    cancelled: "Your delivery request has been cancelled.",
  };
  const emailSent = await sendOrderEmail(
    env,
    order.email,
    "Water OnCall order update — " + statusText,
    [
      "Hello " + (order.full_name || "there") + ",",
      "",
      statusMessages[status],
      "",
      "Order: " + readable(order.order_type) + " · " + Number(order.gallons).toLocaleString() + " gallons",
      "Location: " + order.city,
      "New status: " + statusText,
      "Request ID: " + order.id,
      "",
      "Sign in to your Water OnCall account to view your request.",
    ].join("\n")
  );
  return json({ ok: true, emailSent, order: { id: orderId, status } });
}

function textField(value: unknown, maximum: number, required = true): string | null {
  const text = String(value ?? "").trim();
  if ((required && !text) || text.length > maximum) return null;
  return text;
}

async function saveProfile(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const body = await readBody(request);
  const fullName = textField(body?.full_name, 100);
  const phone = normalizeCanadianPhone(body?.phone);
  if (!fullName || !phone) {
    return json({ error: "Enter your full name and a valid Canadian mobile number." }, 400);
  }
  await ensurePhoneSchema(env);
  await env.DB.prepare(
    "UPDATE users SET full_name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(fullName, phone, user.id).run();
  await env.DB.prepare("DELETE FROM verified_phones WHERE user_id=? AND phone<>?").bind(user.id, phone).run();
  const adminSynced = await syncLaravelProfile({ profile_type: "customer", external_user_id: user.id, email: user.email, name: fullName, phone_e164: phone, preferred_channel: "email" });
  return json({ ok: true, admin_synced: adminSynced });
}

async function listOrders(request: Request, env: Env): Promise<Response> {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const result = await env.DB.prepare(
    "SELECT id, status, order_type, delivery_timing, requested_date, gallons, address_line1, address_line2, city, province, postal_code, hose_distance_ft, delivery_notes, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(user.id).all();
  return json({ orders: result.results });
}

interface OrderEmailDetails {
  id: string;
  orderType: string;
  deliveryTiming: string;
  requestedDate: string | null;
  gallons: number;
  address1: string;
  address2: string | null;
  city: string;
  postalCode: string;
  hoseDistance: number;
  notes: string | null;
}

function readable(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function sendOrderEmail(env: Env, to: string, subject: string, text: string): Promise<boolean> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Water OnCall <orders@notify.wateroncall.ca>",
        to: [to],
        subject,
        text,
      }),
    });
    if (!response.ok) console.error("Resend rejected order email", response.status);
    return response.ok;
  } catch (error) {
    console.error("Unable to send order email", error);
    return false;
  }
}

async function sendOrderEmails(env: Env, user: AccountUserRow, order: OrderEmailDetails): Promise<void> {
  const address = [order.address1, order.address2, order.city, "ON", order.postalCode].filter(Boolean).join(", ");
  const preferredDate = order.requestedDate || "Not specified";
  const notes = order.notes || "No notes provided.";
  const amount = order.gallons.toLocaleString() + " gallons";
  const common = [
    "Request ID: " + order.id,
    "Water use: " + readable(order.orderType),
    "Amount: " + amount,
    "Timing: " + readable(order.deliveryTiming),
    "Preferred date: " + preferredDate,
    "Delivery address: " + address,
    "Hose distance: " + order.hoseDistance + " ft",
    "Notes: " + notes,
  ].join("\n");

  const customerText = [
    "Hello " + (user.full_name || "there") + ",",
    "",
    "We received your Water OnCall delivery request.",
    "",
    common,
    "",
    "This is a request for service and no payment has been taken. We will contact you when delivery details and pricing are confirmed.",
  ].join("\n");

  const adminText = [
    "A new Water OnCall delivery request was submitted.",
    "",
    "Customer: " + (user.full_name || "Not provided"),
    "Email: " + user.email,
    "Phone: " + (user.phone || "Not provided"),
    "",
    common,
  ].join("\n");

  await Promise.all([
    sendOrderEmail(env, user.email, "Water OnCall request received — " + amount, customerText),
    sendOrderEmail(env, "info@wateroncall.ca", "New Water OnCall request — " + amount + " in " + order.city, adminText),
  ]);
}

async function cancelCustomerOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const order = await env.DB.prepare(
    "SELECT id, status, order_type, gallons, city FROM orders WHERE id = ? AND customer_id = ? LIMIT 1"
  ).bind(orderId, user.id).first<{ id: string; status: string; order_type: string; gallons: number; city: string }>();
  if (!order) return json({ error: "Delivery request not found." }, 404);
  if (order.status === "cancelled") return json({ error: "This request is already cancelled." }, 409);
  if (!["requested", "offered"].includes(order.status)) {
    return json({ error: "This order has already been accepted. Contact Water OnCall to review cancellation terms." }, 409);
  }

  await env.DB.prepare(
    "UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND customer_id = ?"
  ).bind(orderId, user.id).run();

  const description = readable(order.order_type) + " · " + Number(order.gallons).toLocaleString() + " gallons";
  await Promise.all([
    sendOrderEmail(
      env,
      user.email,
      "Water OnCall cancellation confirmed",
      ["Hello " + (user.full_name || "there") + ",", "", "Your delivery request has been cancelled.", "", "Order: " + description, "Location: " + order.city, "Request ID: " + order.id, "", "No payment has been taken for this request."].join("\n")
    ),
    sendOrderEmail(
      env,
      "info@wateroncall.ca",
      "Water OnCall request cancelled — " + description,
      ["A customer cancelled a delivery request before acceptance.", "", "Customer: " + (user.full_name || "Not provided"), "Email: " + user.email, "Phone: " + (user.phone || "Not provided"), "Order: " + description, "Location: " + order.city, "Request ID: " + order.id].join("\n")
    ),
  ]);
  return json({ ok: true, order: { id: order.id, status: "cancelled" } });
}

async function createOrder(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  if (!user.full_name || !user.phone) {
    return json({ error: "Save your contact name and mobile phone before requesting delivery." }, 400);
  }

  const body = await readBody(request);
  if (!body) return json({ error: "The delivery request was incomplete." }, 400);
  const orderType = String(body.order_type ?? "");
  const deliveryTiming = String(body.delivery_timing ?? "");
  const gallons = Number(body.gallons);
  const requestedDate = textField(body.requested_date, 10, false) || null;
  const address1 = textField(body.address_line1, 150);
  const address2 = textField(body.address_line2, 100, false) || null;
  const city = textField(body.city, 80);
  const postalCode = String(body.postal_code ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const hoseDistance = Number(body.hose_distance_ft || 50);
  const notes = textField(body.delivery_notes, 1000, false) || null;

  if (!["cistern", "pool", "hot_tub", "commercial", "other"].includes(orderType)) {
    return json({ error: "Choose what needs water." }, 400);
  }
  if (!["flexible", "scheduled", "urgent"].includes(deliveryTiming)) {
    return json({ error: "Choose when you need delivery." }, 400);
  }
  if (![2000, 2500, 3000].includes(gallons)) {
    return json({ error: "Choose a valid water amount." }, 400);
  }
  if (deliveryTiming === "scheduled" && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? "")) {
    return json({ error: "Choose a preferred delivery date." }, 400);
  }
  if (!address1 || !city || !/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postalCode)) {
    return json({ error: "Enter a complete Ontario delivery address and valid postal code." }, 400);
  }
  if (!Number.isInteger(hoseDistance) || hoseDistance < 0 || hoseDistance > 1000) {
    return json({ error: "Choose a valid hose distance." }, 400);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO orders (id, customer_id, order_type, delivery_timing, requested_date, gallons, address_line1, address_line2, city, province, postal_code, hose_distance_ft, delivery_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ON', ?, ?, ?)"
  ).bind(id, user.id, orderType, deliveryTiming, requestedDate, gallons, address1, address2, city, postalCode, hoseDistance, notes).run();

  const preferences = await env.DB.prepare("SELECT hauler_id, preference FROM customer_hauler_preferences WHERE customer_id=? AND preference<>'excluded' ORDER BY CASE preference WHEN 'preferred' THEN 0 ELSE 1 END").bind(user.id).all<{hauler_id:string;preference:string}>();
  const preferred = (preferences.results || []).find((item) => item.preference === "preferred")?.hauler_id || null;
  const backups = (preferences.results || []).filter((item) => item.preference === "allowed").map((item) => item.hauler_id);
  let start = new Date(Date.now() + (deliveryTiming === "urgent" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000));
  let end = new Date(start.getTime() + (deliveryTiming === "flexible" ? 24 : 2) * 60 * 60 * 1000);
  if (deliveryTiming === "scheduled" && requestedDate) {
    start = new Date(requestedDate + "T12:00:00-04:00");
    end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  }
  const adminSynced = await syncLaravelOrder({
    external_order_id: id, customer_email: user.email,
    preferred_external_hauler_id: preferred, backup_external_hauler_ids: backups,
    order_type: orderType === "commercial" ? "other" : orderType,
    requested_delivery_start: start.toISOString(), requested_delivery_end: end.toISOString(),
    total_imperial_gallons: gallons, load_count: 1,
    address_line1: address1, address_line2: address2, city, province: "Ontario", postal_code: postalCode,
    latitude: Number.isFinite(Number(body.google_lat)) ? Number(body.google_lat) : null,
    longitude: Number.isFinite(Number(body.google_lng)) ? Number(body.google_lng) : null,
    address_validation_token: textField(body.address_validation_token, 10000, false) || null,
    address_confirmed: Boolean(body.address_confirmed),
    delivery_notes: notes, hose_distance_feet: hoseDistance,
  });

  await sendOrderEmails(env, user, {
    id, orderType, deliveryTiming, requestedDate, gallons, address1, address2, city, postalCode, hoseDistance, notes,
  });

  return json({ ok: true, admin_synced: adminSynced, order: { id, status: "requested" } }, 201);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "water-on-call-app", database: Boolean(env.DB), email: Boolean(env.RESEND_API_KEY), sms: Boolean(env.TWILIO_VERIFY_SERVICE_SID && env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET) });
    }
    if (url.pathname === "/app.js" && request.method === "GET") return javascript();
    if (url.pathname === "/account.js" && request.method === "GET") return accountJavascript();
    if (url.pathname === "/admin.js" && request.method === "GET") return adminJavascript();
    if (url.pathname === "/hauler.js" && request.method === "GET") return haulerJavascript();
    if (url.pathname === "/admin-haulers.js" && request.method === "GET") return adminHaulersJavascript();
    if (url.pathname === "/api/auth/request" && request.method === "POST") return requestLoginCode(request, env);
    if (url.pathname === "/api/auth/verify" && request.method === "POST") return verifyLoginCode(request, env);
    if (url.pathname === "/api/auth/sms/request" && request.method === "POST") return requestSmsLoginCode(request, env);
    if (url.pathname === "/api/auth/sms/verify" && request.method === "POST") return verifySmsLoginCode(request, env);
    if (url.pathname === "/api/phone/request" && request.method === "POST") return requestPhoneVerification(request, env);
    if (url.pathname === "/api/phone/verify" && request.method === "POST") return confirmPhoneVerification(request, env);
    if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
    if (url.pathname === "/api/me" && request.method === "GET") return currentUser(request, env);
    if (url.pathname === "/api/profile" && request.method === "POST") return saveProfile(request, env);
    if (url.pathname === "/api/orders" && request.method === "GET") return listOrders(request, env);
    if (url.pathname === "/api/orders" && request.method === "POST") return createOrder(request, env);
    if (url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/cancel") && request.method === "POST") return cancelCustomerOrder(request, env, decodeURIComponent(url.pathname.slice("/api/orders/".length, -"/cancel".length)));
    if (url.pathname === "/api/admin/orders" && request.method === "GET") return listAdminOrders(request, env);
    if (url.pathname.startsWith("/api/admin/orders/") && request.method === "PATCH") return updateAdminOrder(request, env, decodeURIComponent(url.pathname.slice("/api/admin/orders/".length)));
    if (url.pathname === "/api/hauler/application" && request.method === "POST") return submitHaulerApplication(request, env);
    if (url.pathname === "/api/admin/haulers" && request.method === "GET") return listAdminHaulers(request, env);
    if (url.pathname.startsWith("/api/admin/haulers/") && request.method === "PATCH") return decideHaulerApplication(request, env, decodeURIComponent(url.pathname.slice("/api/admin/haulers/".length)));

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/admin") {
      const user = await sessionUser(request, env);
      if (!user) return Response.redirect(url.origin + "/login", 302);
      return user.role === "admin" ? adminPage(user) : json({ error: "Administrator access required." }, 403);
    }

    if (url.pathname === "/admin/haulers") {
      const user = await sessionUser(request, env);
      if (!user) return Response.redirect(url.origin + "/login", 302);
      return user.role === "admin" ? adminHaulersPage(user) : json({ error: "Administrator access required." }, 403);
    }

    if (url.pathname === "/hauler") {
      const user = await sessionUser(request, env);
      if (!user) return Response.redirect(url.origin + "/login?next=/hauler", 302);
      await ensureHaulerSchema(env);
      const profile = await env.DB.prepare("SELECT * FROM hauler_profiles WHERE user_id=? LIMIT 1").bind(user.id).first<HaulerProfileRow>();
      return haulerPage(user, profile);
    }

    if (url.pathname === "/account") {
      const user = await sessionUser(request, env);
      if (!user) return Response.redirect(url.origin + "/login", 302);
      await ensurePhoneSchema(env);
      const verified = await env.DB.prepare("SELECT user_id FROM verified_phones WHERE user_id=? LIMIT 1").bind(user.id).first();
      return accountPage(user, Boolean(verified));
    }

    if (url.pathname === "/" || url.pathname === "/login") {
      const user = await sessionUser(request, env);
      if (!user) return page();
      return Response.redirect(url.origin + (user.role === "admin" ? "/admin" : user.role === "hauler" ? "/hauler" : "/account"), 302);
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
