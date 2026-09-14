const APP_NAME = "Water OnCall";
const ADMIN_EMAIL = "admin@wateroncall.ca";

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
  '      window.location.href = data.user.role === "admin" ? "/admin" : "/account";',
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


interface AccountUserRow extends UserRow {
  phone: string | null;
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
  '      const toggle = () => { const open = expanded.hidden; expanded.hidden = !open; item.setAttribute("aria-expanded", String(open)); hint.textContent = open ? "Hide request details" : "View request details"; };',
  '      item.addEventListener("click", toggle); item.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } });',
  '      top.append(title, status); item.append(top, summary, hint, expanded); orderList.append(item);',
  '    });',
  '  }',
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

function accountPage(user: AccountUserRow): Response {
  const html = [
    '<!doctype html><html lang="en"><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0877f9">',
    '<title>My Account — Water OnCall</title>',
    '<style>',
    ':root{color-scheme:light;--blue:#0877f9;--navy:#06325e;--ink:#13283d;--muted:#61778d;--line:#dce8f3;--wash:#f3f9ff;--green:#08764b;--red:#a32121}',
    '*{box-sizing:border-box}body{margin:0;background:#f4f9fd;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    'header{background:#fff;border-bottom:1px solid var(--line);padding:16px max(20px,calc((100vw - 1120px)/2));display:flex;justify-content:space-between;align-items:center;gap:18px;position:sticky;top:0;z-index:2}',
    '.brand{font-size:21px;font-weight:850;color:var(--navy)}.brand span{color:var(--blue)}.account{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:13px}.link-button{width:auto;height:auto;margin:0;padding:9px 13px;background:#eaf4ff;color:var(--navy);font-size:13px}',
    'main{max-width:1120px;margin:auto;padding:38px 20px 70px}.welcome{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:28px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--blue);font-size:12px;font-weight:850}h1{font-size:clamp(32px,5vw,52px);letter-spacing:-.04em;color:var(--navy);margin:8px 0 4px}p{color:var(--muted);line-height:1.5;margin:0}',
    '.message{padding:14px 16px;border-radius:12px;margin:0 0 22px;font-weight:650}.message.success{background:#e4f8ef;color:var(--green)}.message.error{background:#ffebeb;color:var(--red)}',
    '.grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:22px;align-items:start}.stack{display:grid;gap:22px}.card{background:#fff;border:1px solid var(--line);border-radius:19px;padding:25px;box-shadow:0 12px 35px #06325e0d}.card h2{margin:0 0 6px;color:var(--navy);font-size:22px}.intro{margin-bottom:21px;font-size:14px}',
    '.fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field.full{grid-column:1/-1}label{display:block;font-size:13px;font-weight:750;margin-bottom:7px}input,select,textarea{width:100%;border:1px solid #bdd0e1;border-radius:11px;background:#fff;color:var(--ink);font:inherit;padding:12px}input,select{height:48px}textarea{min-height:94px;resize:vertical}input:focus,select:focus,textarea:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px #0877f91a}',
    'button{height:49px;width:100%;border:0;border-radius:11px;background:var(--blue);color:#fff;font-size:15px;font-weight:800;cursor:pointer;margin-top:17px}button:disabled{opacity:.6;cursor:not-allowed}.fine{font-size:12px;margin-top:10px}.order-list{display:grid;gap:11px}.order-item{border:1px solid var(--line);border-radius:12px;padding:14px;cursor:pointer}.order-item:hover,.order-item:focus{border-color:var(--blue);outline:none;box-shadow:0 0 0 3px #0877f914}.order-top{display:flex;justify-content:space-between;gap:10px}.order-item p{font-size:13px;margin-top:5px}.view-hint{display:inline-block;margin-top:8px;color:var(--blue);font-size:12px;font-weight:750}.order-details{border-top:1px solid var(--line);margin-top:12px;padding-top:12px;cursor:default}.order-details div{display:grid;grid-template-columns:125px 1fr;gap:10px;padding:6px 0;font-size:13px}.order-details strong{color:var(--navy)}.order-details span{color:var(--muted);overflow-wrap:anywhere}.repeat-button{width:auto;height:42px;margin-top:12px;padding:0 18px;background:#eaf4ff;color:var(--navy)}.repeat-button:hover{background:#dbeeff}.status{background:#eaf4ff;color:var(--navy);border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;white-space:nowrap}.empty{padding:18px;border:1px dashed #bdd0e1;border-radius:12px;text-align:center;font-size:14px}',
    '@media(max-width:800px){.grid{grid-template-columns:1fr}.welcome{align-items:start}.account span{display:none}}@media(max-width:560px){header{padding:14px 16px}main{padding:28px 15px 55px}.fields{grid-template-columns:1fr}.field.full{grid-column:auto}.card{padding:20px}.order-top{align-items:start;flex-direction:column}}',
    '</style></head><body>',
    '<header><div class="brand"><span>Water</span> OnCall</div><div class="account"><span>' + escapeHtml(user.email) + '</span><button id="logout" class="link-button" type="button">Sign out</button></div></header>',
    '<main><div class="welcome"><div><div class="eyebrow">Customer portal</div><h1>My Water OnCall</h1><p>Request water and follow every delivery in one place.</p></div></div>',
    '<div id="message" class="message" aria-live="polite" hidden></div>',
    '<div class="grid"><div class="stack">',
    '<section class="card"><h2>Contact details</h2><p class="intro">We use this information to coordinate your delivery.</p>',
    '<form id="profile-form"><div class="fields"><div class="field full"><label for="full_name">Full name</label><input id="full_name" name="full_name" autocomplete="name" maxlength="100" value="' + escapeHtml(user.full_name) + '" required></div>',
    '<div class="field"><label for="phone">Mobile phone</label><input id="phone" name="phone" type="tel" autocomplete="tel" maxlength="30" value="' + escapeHtml(user.phone) + '" required></div>',
    '<div class="field"><label>Email address</label><input value="' + escapeHtml(user.email) + '" disabled></div></div><button type="submit" data-label="Save contact details">Save contact details</button></form></section>',
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
  '      select.addEventListener("change", async () => { const previous = select.dataset.previous; select.disabled = true; try { const response = await fetch("/api/admin/orders/" + encodeURIComponent(order.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: select.value }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); select.dataset.previous = select.value; show("Order status updated to " + label(select.value) + "."); } catch (error) { select.value = previous; show(error.message || "Unable to update status.", true); } finally { select.disabled = false; } });',
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
    '<header><div class="brand"><span>Water</span> OnCall Admin</div><div class="account"><span>' + escapeHtml(user.email) + '</span><button id="admin-logout" type="button">Sign out</button></div></header>',
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
  const result = await env.DB.prepare(
    "UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(status, orderId).run();
  if (!result.meta.changes) return json({ error: "Order not found." }, 404);
  return json({ ok: true, order: { id: orderId, status } });
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
  const phone = textField(body?.phone, 30);
  if (!fullName || !phone || phone.replace(/\D/g, "").length < 7) {
    return json({ error: "Enter your full name and a valid phone number." }, 400);
  }
  await env.DB.prepare(
    "UPDATE users SET full_name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(fullName, phone, user.id).run();
  return json({ ok: true });
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

async function sendOrderEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
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
  } catch (error) {
    console.error("Unable to send order email", error);
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

  await sendOrderEmails(env, user, {
    id,
    orderType,
    deliveryTiming,
    requestedDate,
    gallons,
    address1,
    address2,
    city,
    postalCode,
    hoseDistance,
    notes,
  });

  return json({ ok: true, order: { id, status: "requested" } }, 201);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "water-on-call-app", database: Boolean(env.DB), email: Boolean(env.RESEND_API_KEY) });
    }
    if (url.pathname === "/app.js" && request.method === "GET") return javascript();
    if (url.pathname === "/account.js" && request.method === "GET") return accountJavascript();
    if (url.pathname === "/admin.js" && request.method === "GET") return adminJavascript();
    if (url.pathname === "/api/auth/request" && request.method === "POST") return requestLoginCode(request, env);
    if (url.pathname === "/api/auth/verify" && request.method === "POST") return verifyLoginCode(request, env);
    if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
    if (url.pathname === "/api/me" && request.method === "GET") return currentUser(request, env);
    if (url.pathname === "/api/profile" && request.method === "POST") return saveProfile(request, env);
    if (url.pathname === "/api/orders" && request.method === "GET") return listOrders(request, env);
    if (url.pathname === "/api/orders" && request.method === "POST") return createOrder(request, env);
    if (url.pathname === "/api/admin/orders" && request.method === "GET") return listAdminOrders(request, env);
    if (url.pathname.startsWith("/api/admin/orders/") && request.method === "PATCH") return updateAdminOrder(request, env, decodeURIComponent(url.pathname.slice("/api/admin/orders/".length)));

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/admin") {
      const user = await sessionUser(request, env);
      if (!user) return Response.redirect(url.origin + "/login", 302);
      return user.role === "admin" ? adminPage(user) : json({ error: "Administrator access required." }, 403);
    }

    if (url.pathname === "/account") {
      const user = await sessionUser(request, env);
      return user ? accountPage(user) : Response.redirect(url.origin + "/login", 302);
    }

    if (url.pathname === "/" || url.pathname === "/login") {
      const user = await sessionUser(request, env);
      if (!user) return page();
      return Response.redirect(url.origin + (user.role === "admin" ? "/admin" : "/account"), 302);
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
