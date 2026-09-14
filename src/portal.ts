import app from "./entry";

function portalHome(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0877f9"><title>Water OnCall Portals</title><style>:root{color-scheme:light;--blue:#0877f9;--navy:#06325e;--ink:#13283d;--muted:#61778d;--line:#dce8f3}*{box-sizing:border-box}body{margin:0;background:#f4f9fd;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{min-height:100vh;display:grid;place-items:center;padding:28px}.wrap{width:min(940px,100%)}.brand{font-size:26px;font-weight:900;color:var(--navy);margin-bottom:8px}.brand span{color:var(--blue)}h1{font-size:clamp(36px,6vw,58px);line-height:1;letter-spacing:-.045em;color:var(--navy);margin:10px 0}.lead{color:var(--muted);font-size:18px;line-height:1.55;max-width:680px;margin:0 0 30px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{display:block;text-decoration:none;background:#fff;border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 14px 35px #06325e10;transition:transform .15s ease,box-shadow .15s ease}.card:hover{transform:translateY(-2px);box-shadow:0 18px 42px #06325e18}.eyebrow{font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--blue)}h2{margin:8px 0 8px;color:var(--navy);font-size:28px}.card p{color:var(--muted);line-height:1.5;margin:0 0 20px}.go{display:inline-flex;align-items:center;justify-content:center;background:var(--blue);color:#fff;border-radius:11px;padding:12px 16px;font-weight:850}.footer{color:var(--muted);font-size:13px;margin-top:24px;text-align:center}@media(max-width:700px){.grid{grid-template-columns:1fr}.card{padding:22px}}</style></head><body><main><div class="wrap"><div class="brand"><span>Water</span> OnCall</div><h1>Choose your portal</h1><p class="lead">Customers and water haulers each have their own secure area. Choose the portal that matches what you need to do.</p><div class="grid"><a class="card" href="/customer"><div class="eyebrow">For customers</div><h2>Customer Portal</h2><p>Request bulk water, review delivery status, open delivery details, cancel eligible requests and order again.</p><span class="go">Open Customer Portal</span></a><a class="card" href="/water-hauler"><div class="eyebrow">For delivery partners</div><h2>Water Hauler Portal</h2><p>Manage your hauler profile, review available delivery requests, accept work and track active deliveries.</p><span class="go">Open Water Hauler Portal</span></a></div><div class="footer">Secure sign-in is required for both portals.</div></div></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" } });
}

function redirect(request: Request, path: string): Response {
  return Response.redirect(new URL(path, request.url).toString(), 302);
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return portalHome();
    if (request.method === "GET" && (url.pathname === "/customer" || url.pathname === "/customer-portal")) {
      return redirect(request, "/login?next=/account");
    }
    if (request.method === "GET" && (url.pathname === "/water-hauler" || url.pathname === "/hauler-portal")) {
      return redirect(request, "/login?next=/hauler");
    }
    return app.fetch(request, env, ctx);
  }
};
