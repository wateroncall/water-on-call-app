import app from "./portal";

const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };

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

async function sessionUser(request: Request, env: any): Promise<any | null> {
  const token = cookieValue(request, "woc_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(`SELECT users.id,users.email,users.role,users.full_name,users.phone
    FROM sessions JOIN users ON users.id=sessions.user_id
    WHERE sessions.token_hash=? AND datetime(sessions.expires_at)>datetime('now') LIMIT 1`).bind(tokenHash).first();
}

async function approvedHaulerForUser(userId: string, env: any): Promise<any | null> {
  return env.DB.prepare(`SELECT * FROM hauler_profiles WHERE user_id=? AND status='approved' LIMIT 1`).bind(userId).first();
}

async function ensureOpsSchema(env: any): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS hauler_settings (
    hauler_id TEXT PRIMARY KEY,
    accepting_new INTEGER NOT NULL DEFAULT 1,
    base_price_cents INTEGER,
    included_km INTEGER NOT NULL DEFAULT 10,
    extra_5km_cents INTEGER NOT NULL DEFAULT 500,
    included_hose_ft INTEGER NOT NULL DEFAULT 50,
    extra_50ft_cents INTEGER NOT NULL DEFAULT 500,
    commercial_hourly_cents INTEGER,
    stations_json TEXT NOT NULL DEFAULT '[]',
    order_types_json TEXT NOT NULL DEFAULT '["cistern","pool","hot_tub","commercial","other"]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (hauler_id) REFERENCES users(id) ON DELETE CASCADE
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS hauler_team_members (
    id TEXT PRIMARY KEY,
    hauler_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('dispatcher','driver')),
    display_name TEXT NOT NULL,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(hauler_id,user_id),
    FOREIGN KEY (hauler_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS driver_assignments (
    order_id TEXT PRIMARY KEY,
    hauler_id TEXT NOT NULL,
    driver_user_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (hauler_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (driver_user_id) REFERENCES users(id) ON DELETE CASCADE
  )`).run();
}

async function teamContext(userId: string, env: any): Promise<any | null> {
  await ensureOpsSchema(env);
  return env.DB.prepare(`SELECT htm.*,hp.business_name,hp.status FROM hauler_team_members htm
    JOIN hauler_profiles hp ON hp.user_id=htm.hauler_id
    WHERE htm.user_id=? AND htm.active=1 AND hp.status='approved' LIMIT 1`).bind(userId).first();
}

async function readJson(request: Request): Promise<any> {
  try { return await request.json(); } catch { return {}; }
}

async function haulerSettings(request: Request, env: any): Promise<Response> {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const profile = await approvedHaulerForUser(user.id, env);
  if (!profile) return json({ error: "Approved hauler access required." }, 403);
  await ensureOpsSchema(env);
  if (request.method === "GET") {
    let settings = await env.DB.prepare("SELECT * FROM hauler_settings WHERE hauler_id=?").bind(user.id).first();
    if (!settings) {
      await env.DB.prepare("INSERT INTO hauler_settings (hauler_id) VALUES (?)").bind(user.id).run();
      settings = await env.DB.prepare("SELECT * FROM hauler_settings WHERE hauler_id=?").bind(user.id).first();
    }
    return json({ ok: true, profile, settings });
  }
  const body = await readJson(request);
  const accepting = body.accepting_new ? 1 : 0;
  const base = body.base_price_cents === "" || body.base_price_cents == null ? null : Math.max(0, Number(body.base_price_cents));
  const includedKm = Math.max(0, Number(body.included_km || 10));
  const extraKm = Math.max(0, Number(body.extra_5km_cents || 500));
  const hose = Math.max(0, Number(body.included_hose_ft || 50));
  const extraHose = Math.max(0, Number(body.extra_50ft_cents || 500));
  const hourly = body.commercial_hourly_cents === "" || body.commercial_hourly_cents == null ? null : Math.max(0, Number(body.commercial_hourly_cents));
  const stations = Array.isArray(body.stations) ? body.stations.map(String).slice(0,20) : [];
  const types = Array.isArray(body.order_types) ? body.order_types.map(String).filter((x:string)=>['cistern','pool','hot_tub','commercial','other'].includes(x)) : [];
  await env.DB.prepare(`INSERT INTO hauler_settings
    (hauler_id,accepting_new,base_price_cents,included_km,extra_5km_cents,included_hose_ft,extra_50ft_cents,commercial_hourly_cents,stations_json,order_types_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(hauler_id) DO UPDATE SET accepting_new=excluded.accepting_new,base_price_cents=excluded.base_price_cents,included_km=excluded.included_km,extra_5km_cents=excluded.extra_5km_cents,included_hose_ft=excluded.included_hose_ft,extra_50ft_cents=excluded.extra_50ft_cents,commercial_hourly_cents=excluded.commercial_hourly_cents,stations_json=excluded.stations_json,order_types_json=excluded.order_types_json,updated_at=datetime('now')`)
    .bind(user.id,accepting,Number.isFinite(base as any)?base:null,includedKm,extraKm,hose,extraHose,Number.isFinite(hourly as any)?hourly:null,JSON.stringify(stations),JSON.stringify(types.length?types:['cistern','pool','hot_tub','commercial','other'])).run();
  return json({ ok: true });
}

async function teamApi(request: Request, env: any): Promise<Response> {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const profile = await approvedHaulerForUser(user.id, env);
  if (!profile) return json({ error: "Approved hauler access required." }, 403);
  await ensureOpsSchema(env);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT htm.id,htm.role,htm.display_name,htm.phone,htm.active,u.id AS user_id,u.email
      FROM hauler_team_members htm JOIN users u ON u.id=htm.user_id WHERE htm.hauler_id=? ORDER BY htm.active DESC,htm.role,htm.display_name`).bind(user.id).all();
    return json({ ok: true, members: rows.results || [] });
  }
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.display_name || "").trim().slice(0,100);
  const role = body.role === "dispatcher" ? "dispatcher" : "driver";
  const phone = String(body.phone || "").trim().slice(0,30) || null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) return json({ error: "Enter a valid name and email." }, 400);
  let memberUser = await env.DB.prepare("SELECT id,email,role FROM users WHERE email=? LIMIT 1").bind(email).first();
  if (!memberUser) {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id,email,role,full_name,phone) VALUES (?,?,?,?,?)").bind(id,email,role,name,phone).run();
    memberUser = { id, email, role };
  }
  await env.DB.prepare(`INSERT INTO hauler_team_members (id,hauler_id,user_id,role,display_name,phone,active)
    VALUES (?,?,?,?,?,?,1) ON CONFLICT(hauler_id,user_id) DO UPDATE SET role=excluded.role,display_name=excluded.display_name,phone=excluded.phone,active=1,updated_at=datetime('now')`)
    .bind(crypto.randomUUID(),user.id,memberUser.id,role,name,phone).run();
  return json({ ok: true });
}

async function dispatchData(request: Request, env: any): Promise<Response> {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  await ensureOpsSchema(env);
  let haulerId = user.id;
  let owner = await approvedHaulerForUser(user.id, env);
  if (!owner) {
    const team = await teamContext(user.id, env);
    if (!team || team.role !== 'dispatcher') return json({ error: "Dispatcher access required." }, 403);
    haulerId = team.hauler_id;
  }
  const jobs = await env.DB.prepare(`SELECT o.id,o.status,o.order_type,o.delivery_timing,o.requested_date,o.gallons,o.address_line1,o.address_line2,o.city,o.province,o.postal_code,o.hose_distance_ft,o.delivery_notes,
    u.full_name AS customer_name,u.email AS customer_email,u.phone AS customer_phone,da.driver_user_id,du.full_name AS driver_name
    FROM order_assignments a JOIN orders o ON o.id=a.order_id JOIN users u ON u.id=o.customer_id
    LEFT JOIN driver_assignments da ON da.order_id=o.id LEFT JOIN users du ON du.id=da.driver_user_id
    WHERE a.hauler_id=? AND o.status NOT IN ('completed','cancelled') ORDER BY COALESCE(o.requested_date,'9999-12-31'),o.created_at`).bind(haulerId).all();
  const drivers = await env.DB.prepare(`SELECT htm.user_id,htm.display_name,htm.phone,u.email FROM hauler_team_members htm JOIN users u ON u.id=htm.user_id
    WHERE htm.hauler_id=? AND htm.role='driver' AND htm.active=1 ORDER BY htm.display_name`).bind(haulerId).all();
  return json({ ok: true, jobs: jobs.results || [], drivers: drivers.results || [] });
}

async function assignDriver(request: Request, env: any, orderId: string): Promise<Response> {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  await ensureOpsSchema(env);
  let haulerId = user.id;
  if (!(await approvedHaulerForUser(user.id, env))) {
    const team = await teamContext(user.id, env);
    if (!team || team.role !== 'dispatcher') return json({ error: "Dispatcher access required." }, 403);
    haulerId = team.hauler_id;
  }
  const body = await readJson(request);
  const driverId = String(body.driver_user_id || "");
  const driver = await env.DB.prepare("SELECT user_id FROM hauler_team_members WHERE hauler_id=? AND user_id=? AND role='driver' AND active=1 LIMIT 1").bind(haulerId,driverId).first();
  if (!driver) return json({ error: "Choose an active driver from your team." }, 400);
  const job = await env.DB.prepare("SELECT order_id FROM order_assignments WHERE order_id=? AND hauler_id=? LIMIT 1").bind(orderId,haulerId).first();
  if (!job) return json({ error: "That delivery is not assigned to your company." }, 404);
  await env.DB.prepare(`INSERT INTO driver_assignments (order_id,hauler_id,driver_user_id,assigned_at) VALUES (?,?,?,datetime('now'))
    ON CONFLICT(order_id) DO UPDATE SET driver_user_id=excluded.driver_user_id,assigned_at=datetime('now')`).bind(orderId,haulerId,driverId).run();
  await env.DB.prepare("UPDATE orders SET status=CASE WHEN status='accepted' THEN 'assigned' ELSE status END,updated_at=datetime('now') WHERE id=?").bind(orderId).run();
  return json({ ok: true });
}

async function driverJobs(request: Request, env: any): Promise<Response> {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  await ensureOpsSchema(env);
  const team = await teamContext(user.id, env);
  if (!team || team.role !== 'driver') return json({ error: "Driver access required." }, 403);
  const rows = await env.DB.prepare(`SELECT o.id,o.status,o.order_type,o.delivery_timing,o.requested_date,o.gallons,o.address_line1,o.address_line2,o.city,o.province,o.postal_code,o.hose_distance_ft,o.delivery_notes,
    u.full_name AS customer_name,u.phone AS customer_phone,u.email AS customer_email,hp.business_name
    FROM driver_assignments da JOIN orders o ON o.id=da.order_id JOIN users u ON u.id=o.customer_id JOIN hauler_profiles hp ON hp.user_id=da.hauler_id
    WHERE da.driver_user_id=? AND o.status NOT IN ('completed','cancelled') ORDER BY COALESCE(o.requested_date,'9999-12-31'),o.created_at`).bind(user.id).all();
  return json({ ok: true, jobs: rows.results || [] });
}

async function driverStatus(request: Request, env: any, orderId: string): Promise<Response> {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: "Please sign in again." }, 401);
  await ensureOpsSchema(env);
  const team = await teamContext(user.id, env);
  if (!team || team.role !== 'driver') return json({ error: "Driver access required." }, 403);
  const body = await readJson(request);
  const next = String(body.status || "");
  if (!['en_route','delivered','completed'].includes(next)) return json({ error: "Invalid status." }, 400);
  const job = await env.DB.prepare("SELECT order_id FROM driver_assignments WHERE order_id=? AND driver_user_id=? LIMIT 1").bind(orderId,user.id).first();
  if (!job) return json({ error: "That delivery is not assigned to you." }, 404);
  await env.DB.prepare("UPDATE orders SET status=?,updated_at=datetime('now') WHERE id=?").bind(next,orderId).run();
  return json({ ok: true, status: next });
}

function shell(title: string, subtitle: string, body: string, script = ""): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Water OnCall</title><style>:root{--blue:#0877f9;--navy:#06325e;--ink:#13283d;--muted:#61778d;--line:#dce8f3;--green:#08764b}*{box-sizing:border-box}body{margin:0;background:#f4f9fd;color:var(--ink);font-family:Inter,system-ui,sans-serif}header{background:#fff;border-bottom:1px solid var(--line);padding:16px max(20px,calc((100vw - 1080px)/2));display:flex;justify-content:space-between;align-items:center}.brand{font-weight:900;color:var(--navy);font-size:21px}.brand span{color:var(--blue)}a{color:var(--navy);font-weight:750}main{max-width:1080px;margin:auto;padding:38px 20px 70px}h1{font-size:clamp(34px,5vw,50px);color:var(--navy);margin:5px 0}.lead{color:var(--muted);margin:0 0 24px}.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin:0 0 18px;box-shadow:0 10px 30px #06325e0d}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field{margin-bottom:12px}label{font-size:13px;font-weight:800;display:block;margin-bottom:6px}input,select{width:100%;height:44px;border:1px solid #bdd0e1;border-radius:10px;padding:0 11px;font:inherit}button{border:0;border-radius:10px;background:var(--blue);color:#fff;padding:11px 14px;font-weight:850;cursor:pointer}.secondary{background:#eaf4ff;color:var(--navy)}.message{padding:12px;border-radius:10px;background:#e4f8ef;color:var(--green);margin-bottom:15px}.job{border:1px solid var(--line);border-radius:13px;padding:15px;margin-top:12px}.job h3{margin:0 0 6px;color:var(--navy)}.meta{color:var(--muted);font-size:13px;line-height:1.5}.actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head><body><header><div class="brand"><span>Water</span> OnCall</div><a href="/">Portals</a></header><main><h1>${title}</h1><p class="lead">${subtitle}</p>${body}</main>${script}</body></html>`;
  return new Response(html,{headers});
}

function operationsPage(): Response {
  const body = `<div id="msg" hidden class="message"></div><section class="card"><h2>Service & pricing settings</h2><form id="settings"><div class="grid"><div class="field"><label>Accepting new deliveries</label><select name="accepting_new"><option value="1">Yes</option><option value="0">Paused</option></select></div><div class="field"><label>Base delivery price (CAD)</label><input name="base_price" type="number" step="0.01"></div><div class="field"><label>Included distance (km)</label><input name="included_km" type="number" value="10"></div><div class="field"><label>Extra per 5 km (CAD)</label><input name="extra_5km" type="number" step="0.01" value="5"></div><div class="field"><label>Included hose (ft)</label><input name="included_hose_ft" type="number" value="50"></div><div class="field"><label>Extra per 50 ft hose (CAD)</label><input name="extra_50ft" type="number" step="0.01" value="5"></div><div class="field"><label>Commercial hourly rate (CAD)</label><input name="commercial_hourly" type="number" step="0.01"></div><div class="field"><label>Water stations</label><input name="stations" placeholder="Smithville, Pelham, Port Colborne Elm St..."></div></div><button type="submit">Save settings</button></form></section><section class="card"><h2>Team</h2><p class="meta">Add dispatchers and drivers. They sign in with their own email address.</p><form id="team"><div class="grid"><div class="field"><label>Name</label><input name="display_name" required></div><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="field"><label>Phone</label><input name="phone"></div><div class="field"><label>Role</label><select name="role"><option value="driver">Driver</option><option value="dispatcher">Dispatcher</option></select></div></div><button type="submit">Add team member</button></form><div id="members"></div></section><section class="card"><h2>Dispatch</h2><p class="meta">Assign accepted deliveries to drivers.</p><a href="/dispatcher">Open dispatcher board →</a></section>`;
  const script = `<script>const money=n=>n==null?'':(Number(n)/100).toFixed(2);async function load(){const s=await fetch('/api/hauler/settings').then(r=>r.json());if(s.settings){const f=document.querySelector('#settings');f.accepting_new.value=s.settings.accepting_new?'1':'0';f.base_price.value=money(s.settings.base_price_cents);f.included_km.value=s.settings.included_km;f.extra_5km.value=money(s.settings.extra_5km_cents);f.included_hose_ft.value=s.settings.included_hose_ft;f.extra_50ft.value=money(s.settings.extra_50ft_cents);f.commercial_hourly.value=money(s.settings.commercial_hourly_cents);try{f.stations.value=JSON.parse(s.settings.stations_json).join(', ')}catch{}}const t=await fetch('/api/hauler/team').then(r=>r.json());const box=document.querySelector('#members');box.innerHTML='';(t.members||[]).forEach(m=>{const d=document.createElement('div');d.className='job';d.innerHTML='<strong>'+m.display_name+'</strong><div class="meta">'+m.role+' · '+m.email+(m.phone?' · '+m.phone:'')+'</div>';box.append(d)})}document.querySelector('#settings').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;const body={accepting_new:f.accepting_new.value==='1',base_price_cents:f.base_price.value?Math.round(Number(f.base_price.value)*100):null,included_km:Number(f.included_km.value),extra_5km_cents:Math.round(Number(f.extra_5km.value||0)*100),included_hose_ft:Number(f.included_hose_ft.value),extra_50ft_cents:Math.round(Number(f.extra_50ft.value||0)*100),commercial_hourly_cents:f.commercial_hourly.value?Math.round(Number(f.commercial_hourly.value)*100):null,stations:f.stations.value.split(',').map(x=>x.trim()).filter(Boolean),order_types:['cistern','pool','hot_tub','commercial','other']};const r=await fetch('/api/hauler/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();alert(r.ok?'Settings saved':d.error)};document.querySelector('#team').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));const r=await fetch('/api/hauler/team',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)return alert(d.error);e.currentTarget.reset();load()};load();</script>`;
  return shell("Hauler operations","Pricing, team, stations and dispatch settings.",body,script);
}

function dispatcherPage(): Response {
  const body = `<div id="msg" hidden class="message"></div><section class="card"><h2>Delivery board</h2><div id="jobs">Loading…</div></section>`;
  const script = `<script>async function load(){const r=await fetch('/api/hauler/dispatch');const d=await r.json();if(!r.ok){document.querySelector('#jobs').textContent=d.error;return}const box=document.querySelector('#jobs');box.innerHTML='';if(!d.jobs.length){box.textContent='No active deliveries.';return}d.jobs.forEach(j=>{const el=document.createElement('div');el.className='job';el.innerHTML='<h3>'+j.gallons.toLocaleString()+' gal · '+j.city+'</h3><div class="meta">'+j.status.replaceAll('_',' ')+' · '+[j.address_line1,j.city,j.province,j.postal_code].filter(Boolean).join(', ')+'<br>'+ (j.customer_name||'Customer')+(j.customer_phone?' · '+j.customer_phone:'')+'</div>';const row=document.createElement('div');row.className='actions';const s=document.createElement('select');s.innerHTML='<option value="">Choose driver</option>'+d.drivers.map(x=>'<option value="'+x.user_id+'" '+(x.user_id===j.driver_user_id?'selected':'')+'>'+x.display_name+'</option>').join('');const b=document.createElement('button');b.textContent=j.driver_user_id?'Reassign':'Assign driver';b.onclick=async()=>{if(!s.value)return;const q=await fetch('/api/hauler/dispatch/'+encodeURIComponent(j.id)+'/assign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({driver_user_id:s.value})});const z=await q.json();if(!q.ok)return alert(z.error);load()};row.append(s,b);el.append(row);box.append(el)})}load();</script>`;
  return shell("Dispatcher Portal","Assign accepted deliveries to the right driver and monitor active work.",body,script);
}

function driverPage(): Response {
  const body = `<section class="card"><h2>My assigned deliveries</h2><div id="jobs">Loading…</div></section>`;
  const script = `<script>async function load(){const r=await fetch('/api/driver/jobs');const d=await r.json();const box=document.querySelector('#jobs');if(!r.ok){box.textContent=d.error;return}box.innerHTML='';if(!d.jobs.length){box.textContent='No deliveries assigned right now.';return}d.jobs.forEach(j=>{const el=document.createElement('div');el.className='job';el.innerHTML='<h3>'+j.gallons.toLocaleString()+' gal · '+j.city+'</h3><div class="meta"><strong>'+j.status.replaceAll('_',' ').toUpperCase()+'</strong><br>'+[j.address_line1,j.address_line2,j.city,j.province,j.postal_code].filter(Boolean).join(', ')+'<br>Customer: '+(j.customer_name||'Customer')+(j.customer_phone?' · '+j.customer_phone:'')+'<br>Notes: '+(j.delivery_notes||'None')+'</div>';const row=document.createElement('div');row.className='actions';[['en_route','En route'],['delivered','Delivered'],['completed','Completed']].forEach(([v,l])=>{const b=document.createElement('button');b.textContent=l;b.onclick=async()=>{const q=await fetch('/api/driver/jobs/'+encodeURIComponent(j.id)+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:v})});const z=await q.json();if(!q.ok)return alert(z.error);load()};row.append(b)});el.append(row);box.append(el)})}load();</script>`;
  return shell("Driver Portal","Only your assigned Water OnCall deliveries appear here.",body,script);
}

function enhanceHauler(html: string): string {
  if (html.includes('href="/operations"')) return html;
  const add = `<section class="card" style="margin-top:20px"><h2>Operations</h2><p class="intro">Manage pricing, water stations, drivers and dispatch.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><a href="/operations" style="display:inline-block;background:#0877f9;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:800">Service & team settings</a><a href="/dispatcher" style="display:inline-block;background:#eaf4ff;color:#06325e;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:800">Dispatcher board</a></div></section>`;
  return html.replace('</main>',add+'</main>');
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/hauler/settings' && (request.method==='GET'||request.method==='POST')) return haulerSettings(request,env);
    if (url.pathname === '/api/hauler/team' && (request.method==='GET'||request.method==='POST')) return teamApi(request,env);
    if (url.pathname === '/api/hauler/dispatch' && request.method==='GET') return dispatchData(request,env);
    const am = url.pathname.match(/^\/api\/hauler\/dispatch\/([^/]+)\/assign$/);
    if (am && request.method==='POST') return assignDriver(request,env,decodeURIComponent(am[1]));
    if (url.pathname === '/api/driver/jobs' && request.method==='GET') return driverJobs(request,env);
    const dm = url.pathname.match(/^\/api\/driver\/jobs\/([^/]+)\/status$/);
    if (dm && request.method==='POST') return driverStatus(request,env,decodeURIComponent(dm[1]));

    if (url.pathname === '/operations' && request.method==='GET') {
      const user=await sessionUser(request,env); if(!user) return Response.redirect(new URL('/login?next=/hauler',request.url).toString(),302);
      if(!(await approvedHaulerForUser(user.id,env))) return Response.redirect(new URL('/hauler',request.url).toString(),302);
      return operationsPage();
    }
    if (url.pathname === '/dispatcher' && request.method==='GET') {
      const user=await sessionUser(request,env); if(!user) return Response.redirect(new URL('/login',request.url).toString(),302);
      const owner=await approvedHaulerForUser(user.id,env); const team=owner?null:await teamContext(user.id,env);
      if(!owner && (!team||team.role!=='dispatcher')) return Response.redirect(new URL('/',request.url).toString(),302);
      return dispatcherPage();
    }
    if (url.pathname === '/driver' && request.method==='GET') {
      const user=await sessionUser(request,env); if(!user) return Response.redirect(new URL('/login',request.url).toString(),302);
      const team=await teamContext(user.id,env); if(!team||team.role!=='driver') return Response.redirect(new URL('/',request.url).toString(),302);
      return driverPage();
    }

    const response = await app.fetch(request,env,ctx);
    if (url.pathname === '/hauler' && request.method==='GET' && response.headers.get('Content-Type')?.includes('text/html')) {
      const html=enhanceHauler(await response.text()); const h=new Headers(response.headers); h.delete('Content-Length'); h.set('Cache-Control','no-store'); return new Response(html,{status:response.status,headers:h});
    }
    return response;
  }
};