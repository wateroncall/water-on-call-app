import app from "./entry";

function portalHome(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0877f9"><title>Water OnCall Portals</title><style>:root{color-scheme:light;--blue:#0877f9;--navy:#06325e;--ink:#13283d;--muted:#61778d;--line:#dce8f3}*{box-sizing:border-box}body{margin:0;background:#f4f9fd;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{min-height:100vh;display:grid;place-items:center;padding:28px}.wrap{width:min(940px,100%)}.brand{font-size:26px;font-weight:900;color:var(--navy);margin-bottom:8px}.brand span{color:var(--blue)}h1{font-size:clamp(36px,6vw,58px);line-height:1;letter-spacing:-.045em;color:var(--navy);margin:10px 0}.lead{color:var(--muted);font-size:18px;line-height:1.55;max-width:680px;margin:0 0 30px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{display:block;text-decoration:none;background:#fff;border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 14px 35px #06325e10;transition:transform .15s ease,box-shadow .15s ease}.card:hover{transform:translateY(-2px);box-shadow:0 18px 42px #06325e18}.eyebrow{font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--blue)}h2{margin:8px 0 8px;color:var(--navy);font-size:28px}.card p{color:var(--muted);line-height:1.5;margin:0 0 20px}.go{display:inline-flex;align-items:center;justify-content:center;background:var(--blue);color:#fff;border-radius:11px;padding:12px 16px;font-weight:850}.footer{color:var(--muted);font-size:13px;margin-top:24px;text-align:center}@media(max-width:700px){.grid{grid-template-columns:1fr}.card{padding:22px}}</style></head><body><main><div class="wrap"><div class="brand"><span>Water</span> OnCall</div><h1>Choose your portal</h1><p class="lead">Customers and water haulers each have their own secure area. Choose the portal that matches what you need to do.</p><div class="grid"><a class="card" href="/customer"><div class="eyebrow">For customers</div><h2>Customer Portal</h2><p>Request bulk water, review delivery status, open delivery details, cancel eligible requests and order again.</p><span class="go">Open Customer Portal</span></a><a class="card" href="/water-hauler"><div class="eyebrow">For delivery partners</div><h2>Water Hauler Portal</h2><p>Manage your hauler profile, review available delivery requests, accept work and track active deliveries.</p><span class="go">Open Water Hauler Portal</span></a></div><div class="footer">Secure sign-in is required for both portals.</div></div></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" } });
}

function redirect(request: Request, path: string): Response {
  return Response.redirect(new URL(path, request.url).toString(), 302);
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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function signedInHauler(request: Request, env: any): Promise<any | null> {
  const token = cookieValue(request, "woc_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(`SELECT u.id,u.email,u.full_name,h.business_name,h.status
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN hauler_profiles h ON h.user_id=u.id
    WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') LIMIT 1`).bind(tokenHash).first();
}

async function updateDeliveryStatus(request: Request, env: any, orderId: string): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Request not allowed." }, 403);
  const hauler = await signedInHauler(request, env);
  if (!hauler) return json({ error: "Please sign in again." }, 401);
  if (hauler.status !== "approved") return json({ error: "Hauler approval is required." }, 403);
  let body: any = null;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const nextStatus = String(body?.status || "");
  const assignment = await env.DB.prepare(`SELECT o.id,o.status,o.customer_id,u.email AS customer_email,u.full_name AS customer_name,o.gallons,o.city
    FROM order_assignments a JOIN orders o ON o.id=a.order_id JOIN users u ON u.id=o.customer_id
    WHERE a.order_id=? AND a.hauler_id=? LIMIT 1`).bind(orderId, hauler.id).first();
  if (!assignment) return json({ error: "That delivery is not assigned to this hauler." }, 404);

  const allowed: Record<string, string[]> = {
    accepted: ["en_route"],
    assigned: ["en_route"],
    en_route: ["delivered"],
    delivered: ["completed"]
  };
  if (!(allowed[String(assignment.status)] || []).includes(nextStatus)) {
    return json({ error: "That status change is not allowed from the current delivery state." }, 409);
  }

  const changed = await env.DB.prepare("UPDATE orders SET status=?,updated_at=datetime('now') WHERE id=? AND status=?")
    .bind(nextStatus, orderId, assignment.status).run();
  if (!changed.meta || Number(changed.meta.changes || 0) !== 1) return json({ error: "The delivery changed before this update. Refresh and try again." }, 409);

  const labels: Record<string,string> = { en_route: "En Route", delivered: "Delivered", completed: "Completed" };
  if (env.RESEND_API_KEY && assignment.customer_email) {
    const text = [
      "Your Water OnCall delivery status was updated.",
      "",
      "Status: " + (labels[nextStatus] || nextStatus),
      "Delivery: " + Number(assignment.gallons || 0).toLocaleString() + " gallons",
      "Area: " + (assignment.city || ""),
      "Hauler: " + (hauler.business_name || "Water OnCall hauler"),
      "",
      "Sign in to your Customer Portal to review the latest delivery status."
    ].join("\n");
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Water OnCall <updates@notify.wateroncall.ca>", to: [assignment.customer_email], subject: "Water OnCall delivery update — " + (labels[nextStatus] || nextStatus), text })
      });
    } catch {}
  }
  return json({ ok: true, status: nextStatus });
}

const PROGRESS_SCRIPT = `document.addEventListener("DOMContentLoaded",()=>{
  const market=document.getElementById("hauler-marketplace"); if(!market)return;
  const section=document.createElement("section"); section.className="card"; section.style.marginTop="20px";
  section.innerHTML='<h2>Delivery status controls</h2><p class="intro">Update the customer as the delivery moves through the day.</p><div id="progress-message" class="message" hidden></div><div id="progress-list"></div>';
  market.insertAdjacentElement("afterend",section);
  const list=section.querySelector("#progress-list"), msg=section.querySelector("#progress-message");
  const labels={accepted:"Accepted",assigned:"Assigned",en_route:"En Route",delivered:"Delivered",completed:"Completed"};
  const next={accepted:["en_route","Mark En Route"],assigned:["en_route","Mark En Route"],en_route:["delivered","Mark Delivered"],delivered:["completed","Mark Completed"]};
  const show=(t,e=false)=>{msg.textContent=t;msg.hidden=false;msg.className=e?"message error":"message success";};
  async function advance(id,status,button){button.disabled=true;try{const r=await fetch('/api/hauler/deliveries/'+encodeURIComponent(id)+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to update delivery.');show('Delivery updated to '+labels[d.status]+'.');await load();}catch(e){show(e.message||'Unable to update delivery.',true);button.disabled=false;}}
  async function load(){const r=await fetch('/api/hauler/offers');const d=await r.json();if(!r.ok){list.innerHTML='';return;}list.innerHTML='';for(const o of d.active||[]){const card=document.createElement('div');card.style.cssText='border:1px solid #dce8f3;border-radius:14px;padding:16px;margin-top:12px;background:#fbfdff';const top=document.createElement('div');top.style.cssText='display:flex;justify-content:space-between;gap:12px;align-items:center';const name=document.createElement('strong');name.textContent=(o.order_type||'delivery').replaceAll('_',' ')+' · '+Number(o.gallons||0).toLocaleString()+' gal';const badge=document.createElement('span');badge.textContent=labels[o.status]||String(o.status).replaceAll('_',' ');badge.style.cssText='font-size:12px;font-weight:800;color:#06325e';top.append(name,badge);card.append(top);if(next[o.status]){const b=document.createElement('button');b.textContent=next[o.status][1];b.style.cssText='width:100%;height:44px;margin-top:12px';b.onclick=()=>advance(o.id,next[o.status][0],b);card.append(b);}else{const done=document.createElement('div');done.textContent='No further update required.';done.style.cssText='margin-top:10px;color:#61778d;font-size:13px';card.append(done);}list.append(card);}if(!(d.active||[]).length){list.innerHTML='<div style="padding:16px;border:1px dashed #bdd0e1;border-radius:12px;color:#61778d;text-align:center">No active deliveries yet.</div>';}}
  load();
});`;

function progressScript(): Response {
  return new Response(PROGRESS_SCRIPT, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function enhanceHauler(response: Response): Promise<Response> {
  if (!response.headers.get("Content-Type")?.includes("text/html")) return response;
  let html = await response.text();
  if (!html.includes('/hauler-progress.js')) html = html.replace("</body>", '<script src="/hauler-progress.js" defer></script></body>');
  const headers = new Headers(response.headers); headers.delete("Content-Length"); headers.set("Cache-Control","no-store");
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return portalHome();
    if (request.method === "GET" && (url.pathname === "/customer" || url.pathname === "/customer-portal")) return redirect(request, "/login?next=/account");
    if (request.method === "GET" && (url.pathname === "/water-hauler" || url.pathname === "/hauler-portal")) return redirect(request, "/login?next=/hauler");
    if (request.method === "GET" && url.pathname === "/hauler-progress.js") return progressScript();
    const match = url.pathname.match(/^\/api\/hauler\/deliveries\/([^/]+)\/status$/);
    if (match && request.method === "POST") return updateDeliveryStatus(request, env, decodeURIComponent(match[1]));
    const response = await app.fetch(request, env, ctx);
    if (request.method === "GET" && url.pathname === "/hauler") return enhanceHauler(response);
    return response;
  }
};
