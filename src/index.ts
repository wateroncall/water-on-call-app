const APP_NAME = "Water OnCall";

interface Env {
  DB: D1Database;
  RESEND_API_KEY: string;
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
  '  const status = document.getElementById("status");',
  '  const show = (message, isError = false) => { status.textContent = message; status.hidden = false; status.style.color = isError ? "#a32121" : "#08764b"; };',
  '  const setBusy = (form, busy) => { const button = form.querySelector("button"); button.disabled = busy; button.textContent = busy ? "Please wait…" : button.dataset.label; };',
  '  emailForm.addEventListener("submit", async (event) => {',
  '    event.preventDefault();',
  '    setBusy(emailForm, true);',
  '    status.hidden = true;',
  '    try {',
  '      const response = await fetch("/api/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: emailInput.value }) });',
  '      const data = await response.json();',
  '      if (!response.ok) throw new Error(data.error || "Unable to send the code.");',
  '      codeForm.hidden = false;',
  '      codeInput.focus();',
  '      show("We sent a 6-digit sign-in code to " + emailInput.value.trim() + ". It expires in 10 minutes.");',
  '    } catch (error) { show(error.message || "Unable to send the code.", true); }',
  '    finally { setBusy(emailForm, false); }',
  '  });',
  '  codeForm.addEventListener("submit", async (event) => {',
  '    event.preventDefault();',
  '    setBusy(codeForm, true);',
  '    try {',
  '      const response = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ email: emailInput.value, code: codeInput.value }) });',
  '      const data = await response.json();',
  '      if (!response.ok) throw new Error(data.error || "That code could not be verified.");',
  '      emailForm.hidden = true;',
  '      codeForm.hidden = true;',
  '      show("Signed in successfully. Your Water OnCall customer account is ready.");',
  '    } catch (error) { show(error.message || "That code could not be verified.", true); }',
  '    finally { setBusy(codeForm, false); }',
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

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
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
    await env.DB.prepare(
      "INSERT INTO users (id, email, email_verified_at) VALUES (?, ?, datetime('now'))"
    ).bind(userId, email).run();
    user = { id: userId, email, role: "customer", full_name: null };
  } else {
    await env.DB.prepare(
      "UPDATE users SET email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).bind(user.id).run();
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
    button{width:100%;height:52px;margin-top:14px;border:0;border-radius:12px;background:var(--blue);color:#fff;font-size:16px;font-weight:800;cursor:pointer}button:disabled{cursor:not-allowed;opacity:.65}.notice{margin-top:16px;padding:13px 14px;border-radius:11px;background:var(--wash);font-size:13px;color:var(--muted);line-height:1.45}.links{display:flex;justify-content:center;gap:18px;margin-top:21px;font-size:13px}.links a{color:var(--navy)}
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
      <p class="small">Enter your email to receive a secure one-time sign-in code. No password required.</p>
      <form id="email-form">
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
        <button type="submit" data-label="Send secure code">Send secure code</button>
      </form>
      <form id="code-form" hidden>
        <label for="code">6-digit sign-in code</label>
        <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required>
        <button type="submit" data-label="Verify and sign in">Verify and sign in</button>
      </form>
      <div id="status" class="notice" aria-live="polite" hidden></div>
      <div class="links"><a href="https://wateroncall.ca">Main website</a><a href="https://wateroncall.ca/privacy">Privacy</a></div>
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "water-on-call-app", database: Boolean(env.DB), email: Boolean(env.RESEND_API_KEY) });
    }
    if (url.pathname === "/app.js" && request.method === "GET") return javascript();
    if (url.pathname === "/api/auth/request" && request.method === "POST") return requestLoginCode(request, env);
    if (url.pathname === "/api/auth/verify" && request.method === "POST") return verifyLoginCode(request, env);
    if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
    if (url.pathname === "/api/me" && request.method === "GET") return currentUser(request, env);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405);
    }
    if (url.pathname === "/" || url.pathname === "/login") return page();
    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
