import app from "./ops";

const securityHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function currentUser(request: Request, env: any): Promise<any | null> {
  const token = cookieValue(request, "woc_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(`SELECT users.id,users.email,users.role,users.full_name
    FROM sessions JOIN users ON users.id=sessions.user_id
    WHERE sessions.token_hash=? AND datetime(sessions.expires_at)>datetime('now') LIMIT 1`).bind(tokenHash).first();
}

async function ensurePlatformSettings(env: any): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT
  )`).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO platform_settings (key,value) VALUES ('service_fee_cents','599')`).run();
}

async function getServiceFee(env: any): Promise<number> {
  await ensurePlatformSettings(env);
  const row = await env.DB.prepare("SELECT value FROM platform_settings WHERE key='service_fee_cents' LIMIT 1").first<{value:string}>();
  const value = Number(row?.value ?? 599);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 599;
}

async function pricingApi(request: Request, env: any): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user || user.role !== "admin") return json({ error: "Administrator access required." }, 403);
  await ensurePlatformSettings(env);
  if (request.method === "GET") {
    const cents = await getServiceFee(env);
    return json({ ok: true, service_fee_cents: cents, service_fee: (cents / 100).toFixed(2) });
  }
  let body: any = {};
  try { body = await request.json(); } catch {}
  const dollars = Number(body.service_fee);
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 100) return json({ error: "Enter a fee between $0.00 and $100.00." }, 400);
  const cents = Math.round(dollars * 100);
  await env.DB.prepare(`INSERT INTO platform_settings (key,value,updated_at,updated_by) VALUES ('service_fee_cents',?,datetime('now'),?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now'),updated_by=excluded.updated_by`)
    .bind(String(cents), user.id).run();
  return json({ ok: true, service_fee_cents: cents, service_fee: (cents / 100).toFixed(2) });
}

function adminPricingPage(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Platform Pricing — Water OnCall</title><style>:root{--blue:#0877f9;--navy:#06325e;--ink:#13283d;--muted:#61778d;--line:#dce8f3;--green:#08764b;--red:#a32121}*{box-sizing:border-box}body{margin:0;background:#f4f9fd;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:760px;margin:auto;padding:48px 20px}.brand{font-size:22px;font-weight:900;color:var(--navy)}.brand span{color:var(--blue)}.eyebrow{margin-top:34px;text-transform:uppercase;letter-spacing:.14em;color:var(--blue);font-size:12px;font-weight:850}h1{font-size:44px;letter-spacing:-.04em;color:var(--navy);margin:8px 0}.lead{color:var(--muted);line-height:1.5}.card{margin-top:24px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:26px;box-shadow:0 10px 30px #06325e0d}label{display:block;font-weight:800;margin-bottom:8px}.money{display:flex;align-items:center;border:1px solid #bdd0e1;border-radius:12px;overflow:hidden;background:#fff}.money span{padding:0 14px;font-weight:850;color:var(--muted)}input{border:0;outline:0;width:100%;height:52px;font:inherit;font-size:18px;padding:0 12px}button{width:100%;height:50px;margin-top:16px;border:0;border-radius:11px;background:var(--blue);color:#fff;font-weight:850;cursor:pointer}.note{margin-top:12px;color:var(--muted);font-size:13px;line-height:1.45}.message{margin-top:16px;padding:12px 14px;border-radius:10px;background:#e4f8ef;color:var(--green);font-weight:700}.message.error{background:#ffebeb;color:var(--red)}a{display:inline-block;margin-top:20px;color:var(--navy);font-weight:750}</style></head><body><main><div class="brand"><span>Water</span> OnCall Admin</div><div class="eyebrow">Platform settings</div><h1>Service fee</h1><p class="lead">Set the Water OnCall fee charged per completed delivery. The launch default is $5.99. You can change this later without changing website code.</p><section class="card"><form id="fee-form"><label for="fee">Water OnCall service fee</label><div class="money"><span>$</span><input id="fee" type="number" min="0" max="100" step="0.01" inputmode="decimal" required></div><button type="submit">Save service fee</button></form><div class="note">This setting is stored in the Water OnCall database and is separate from the water hauler's delivery price.</div><div id="message" class="message" hidden></div></section><a href="/admin">← Back to Admin</a></main><script>const form=document.getElementById('fee-form'),fee=document.getElementById('fee'),msg=document.getElementById('message');const show=(t,e=false)=>{msg.textContent=t;msg.hidden=false;msg.className=e?'message error':'message'};async function load(){const r=await fetch('/api/admin/platform-pricing');if(r.status===403){location.href='/login';return}const d=await r.json();if(r.ok)fee.value=d.service_fee;else show(d.error||'Unable to load fee.',true)}form.addEventListener('submit',async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;b.textContent='Saving…';try{const r=await fetch('/api/admin/platform-pricing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service_fee:fee.value})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to save fee.');fee.value=d.service_fee;show('Service fee saved at $'+d.service_fee+' per completed delivery.')}catch(err){show(err.message||'Unable to save fee.',true)}finally{b.disabled=false;b.textContent='Save service fee'}});load();</script></body></html>`;
  return new Response(html, { headers: securityHeaders });
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/admin/platform-pricing" && (request.method === "GET" || request.method === "POST")) return pricingApi(request, env);
    if (url.pathname === "/admin/pricing" && request.method === "GET") {
      const user = await currentUser(request, env);
      if (!user || user.role !== "admin") return Response.redirect(new URL("/login", request.url).toString(), 302);
      return adminPricingPage();
    }
    if (url.pathname === "/api/platform/service-fee" && request.method === "GET") {
      const cents = await getServiceFee(env);
      return json({ service_fee_cents: cents, service_fee: (cents / 100).toFixed(2) });
    }
    return app.fetch(request, env, ctx);
  }
};
