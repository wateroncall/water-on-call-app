const APP_NAME = "Water OnCall";

const securityHeaders: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...securityHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
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
    button{width:100%;height:52px;margin-top:14px;border:0;border-radius:12px;background:var(--blue);color:#fff;font-size:16px;font-weight:800;cursor:not-allowed;opacity:.72}.notice{margin-top:16px;padding:13px 14px;border-radius:11px;background:var(--wash);font-size:13px;color:var(--muted);line-height:1.45}.links{display:flex;justify-content:center;gap:18px;margin-top:21px;font-size:13px}.links a{color:var(--navy)}
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
      <form>
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" disabled>
        <button type="button" disabled>Send secure code</button>
      </form>
      <div class="notice">The app foundation is online. Secure email sign-in is the next activation step; the button remains safely disabled until it is connected.</div>
      <div class="links"><a href="https://wateroncall.ca">Main website</a><a href="https://wateroncall.ca/privacy">Privacy</a></div>
    </section>
  </main>
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
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "water-on-call-app" });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/" || url.pathname === "/login") {
      return page();
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler;
