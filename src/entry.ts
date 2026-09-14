import app from "./index";

const PHONE_SCRIPT = `document.addEventListener("DOMContentLoaded", () => {
  const start = document.getElementById("hauler-phone-verify-start");
  const form = document.getElementById("hauler-phone-verify-form");
  const code = document.getElementById("hauler-phone-code");
  const message = document.getElementById("hauler-phone-message");
  if (!start || !form || !code || !message) return;

  const show = (text, error = false) => {
    message.textContent = text;
    message.hidden = false;
    message.className = error ? "message error" : "message success";
  };

  start.addEventListener("click", async () => {
    start.disabled = true;
    const label = start.textContent;
    start.textContent = "Sending…";
    try {
      const response = await fetch("/api/phone/request", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send the text.");
      form.hidden = false;
      code.focus();
      show("We sent a 6-digit verification code to your saved mobile number.");
    } catch (error) {
      show(error.message || "Unable to send the text.", true);
    } finally {
      start.disabled = false;
      start.textContent = label;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    const label = button.textContent;
    button.textContent = "Verifying…";
    try {
      const response = await fetch("/api/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.value })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to verify the code.");
      form.hidden = true;
      start.textContent = "Mobile verified for text sign-in";
      show("Mobile number verified. You can now use Text me a code when signing in.");
    } catch (error) {
      show(error.message || "Unable to verify the code.", true);
      button.disabled = false;
      button.textContent = label;
    }
  });
});`;

const MARKETPLACE_SCRIPT = `document.addEventListener("DOMContentLoaded", () => {
  const section = document.getElementById("hauler-marketplace");
  const status = document.getElementById("marketplace-status");
  const available = document.getElementById("available-offers");
  const active = document.getElementById("active-deliveries");
  const availableEmpty = document.getElementById("available-empty");
  const activeEmpty = document.getElementById("active-empty");
  if (!section || !status || !available || !active) return;

  const showStatus = (text, error = false) => {
    status.textContent = text;
    status.hidden = !text;
    status.className = error ? "message error" : "message success";
  };
  const fmtDate = (value) => value ? new Date(value + (value.includes("T") ? "" : "T12:00:00")).toLocaleDateString() : "Flexible";
  const field = (label, value) => {
    const row = document.createElement("div");
    row.className = "offer-field";
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    strong.textContent = label;
    span.textContent = value || "—";
    row.append(strong, span);
    return row;
  };
  const card = (order, mode) => {
    const el = document.createElement("article");
    el.className = "offer-card";
    const head = document.createElement("div");
    head.className = "offer-head";
    const title = document.createElement("div");
    const h3 = document.createElement("h3");
    h3.textContent = (order.order_type || "delivery").replaceAll("_", " ") + " · " + Number(order.gallons || 0).toLocaleString() + " gal";
    const badge = document.createElement("span");
    badge.className = "offer-badge " + (mode === "active" ? "accepted" : "");
    badge.textContent = mode === "active" ? String(order.status || "accepted").replaceAll("_", " ").toUpperCase() : "AVAILABLE";
    title.append(h3, badge);
    head.append(title);
    el.append(head);
    const details = document.createElement("div");
    details.className = "offer-details";
    details.append(
      field("Area", [order.city, order.province].filter(Boolean).join(", ")),
      field("Requested", order.delivery_timing === "scheduled" ? fmtDate(order.requested_date) : (order.delivery_timing || "Flexible")),
      field("Hose", order.hose_distance_ft ? order.hose_distance_ft + " ft" : "Not specified"),
      field("Notes", order.delivery_notes || "No special notes")
    );
    if (mode === "active") {
      details.append(field("Address", [order.address_line1, order.address_line2, order.city, order.province, order.postal_code].filter(Boolean).join(", ")));
      if (order.customer_name) details.append(field("Customer", order.customer_name));
      if (order.customer_phone) details.append(field("Phone", order.customer_phone));
      if (order.customer_email) details.append(field("Email", order.customer_email));
    }
    el.append(details);

    if (mode === "available") {
      const actions = document.createElement("div");
      actions.className = "offer-actions";
      const accept = document.createElement("button");
      accept.textContent = "Accept delivery";
      const pass = document.createElement("button");
      pass.textContent = "Pass";
      pass.className = "secondary";
      accept.addEventListener("click", () => decide(order.id, "accept", accept, pass));
      pass.addEventListener("click", () => decide(order.id, "decline", pass, accept));
      actions.append(accept, pass);
      el.append(actions);
    }
    return el;
  };

  async function decide(id, action, primary, other) {
    primary.disabled = true;
    other.disabled = true;
    const old = primary.textContent;
    primary.textContent = action === "accept" ? "Accepting…" : "Passing…";
    try {
      const response = await fetch("/api/hauler/offers/" + encodeURIComponent(id) + "/" + action, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update this delivery.");
      showStatus(action === "accept" ? "Delivery accepted. Customer details are now available below." : "Delivery passed.");
      await load();
    } catch (error) {
      showStatus(error.message || "Unable to update this delivery.", true);
      primary.disabled = false;
      other.disabled = false;
      primary.textContent = old;
    }
  }

  async function load() {
    try {
      const response = await fetch("/api/hauler/offers", { credentials: "same-origin" });
      const data = await response.json();
      if (response.status === 403 && data.status === "pending") {
        section.classList.add("locked");
        available.textContent = "";
        active.textContent = "";
        availableEmpty.hidden = false;
        availableEmpty.textContent = "Delivery requests will appear here as soon as Water OnCall approves your hauler profile.";
        activeEmpty.hidden = false;
        activeEmpty.textContent = "No active deliveries yet.";
        return;
      }
      if (!response.ok) throw new Error(data.error || "Unable to load delivery requests.");
      section.classList.remove("locked");
      available.textContent = "";
      active.textContent = "";
      for (const order of data.available || []) available.append(card(order, "available"));
      for (const order of data.active || []) active.append(card(order, "active"));
      availableEmpty.hidden = (data.available || []).length > 0;
      activeEmpty.hidden = (data.active || []).length > 0;
    } catch (error) {
      showStatus(error.message || "Unable to load delivery requests.", true);
    }
  }
  load();
});`;

function scriptResponse(content: string): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY"
    }
  });
}

function addHaulerEnhancements(html: string): string {
  let next = html;
  if (!next.includes('id="hauler-marketplace"')) {
    const marketplace = [
      '<section id="hauler-marketplace" class="card" style="margin-top:20px">',
      '<h2>Delivery marketplace</h2>',
      '<p class="intro">Approved haulers can review available delivery requests, accept the jobs that fit, or pass without penalty. Customer contact details stay private until you accept.</p>',
      '<div id="marketplace-status" class="message" aria-live="polite" hidden></div>',
      '<div class="market-block"><div class="market-heading"><h3>Available requests</h3><span>Choose what fits your route</span></div><div id="available-empty" class="market-empty">No matching requests are available right now.</div><div id="available-offers" class="offer-list"></div></div>',
      '<div class="market-block"><div class="market-heading"><h3>My active deliveries</h3><span>Customer details appear after acceptance</span></div><div id="active-empty" class="market-empty">No active deliveries yet.</div><div id="active-deliveries" class="offer-list"></div></div>',
      '<style>.market-block{margin-top:24px}.market-heading{display:flex;justify-content:space-between;gap:15px;align-items:end;border-bottom:1px solid #eef4f8;padding-bottom:10px;margin-bottom:12px}.market-heading h3{margin:0;color:#06325e}.market-heading span{font-size:12px;color:#61778d}.market-empty{padding:18px;border:1px dashed #bdd0e1;border-radius:12px;color:#61778d;text-align:center}.offer-list{display:grid;gap:14px}.offer-card{border:1px solid #dce8f3;border-radius:14px;padding:17px;background:#fbfdff}.offer-head{display:flex;justify-content:space-between;gap:12px}.offer-head h3{margin:0 0 7px;text-transform:capitalize;color:#06325e}.offer-badge{display:inline-block;border-radius:999px;padding:5px 8px;font-size:10px;font-weight:850;background:#eaf4ff;color:#06325e}.offer-badge.accepted{background:#e4f8ef;color:#08764b}.offer-details{display:grid;grid-template-columns:1fr 1fr;gap:0 18px;margin-top:10px}.offer-field{display:grid;grid-template-columns:90px 1fr;gap:8px;padding:7px 0;border-bottom:1px solid #eef4f8;font-size:13px}.offer-field span{color:#61778d;overflow-wrap:anywhere}.offer-actions{display:flex;gap:10px;margin-top:14px}.offer-actions button{width:auto;flex:1;margin:0;height:44px}.offer-actions .secondary{background:#eaf4ff;color:#06325e}.locked{opacity:.9}@media(max-width:600px){.market-heading{display:block}.market-heading span{display:block;margin-top:4px}.offer-details{grid-template-columns:1fr}.offer-field{grid-template-columns:80px 1fr}}</style>',
      '<script src="/hauler-marketplace.js" defer></script>',
      '</section>'
    ].join("");
    next = next.replace("</main>", marketplace + "</main>");
  }

  if (!next.includes('id="hauler-phone-verify-start"')) {
    const phone = [
      '<section class="card" style="margin-top:20px">',
      '<h2>Secure text-message sign-in</h2>',
      '<p class="intro">You can verify your mobile number while your hauler application is still being reviewed. Approval is still required before delivery work is unlocked.</p>',
      '<div id="hauler-phone-message" class="message" aria-live="polite" hidden></div>',
      '<button id="hauler-phone-verify-start" type="button">Verify mobile for text sign-in</button>',
      '<form id="hauler-phone-verify-form" hidden style="margin-top:14px">',
      '<label for="hauler-phone-code">6-digit text-message code</label>',
      '<input id="hauler-phone-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required>',
      '<button type="submit">Verify mobile</button>',
      '</form>',
      '</section>',
      '<script src="/hauler-phone.js" defer></script>'
    ].join("");
    next = next.replace("</main>", phone + "</main>");
  }
  return next;
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
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function sessionHauler(request: Request, env: any): Promise<any | null> {
  const token = cookieValue(request, "woc_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(
    `SELECT users.id, users.email, users.full_name, users.phone,
            hauler_profiles.business_name, hauler_profiles.service_areas,
            hauler_profiles.truck_capacity_gallons, hauler_profiles.truck_count,
            hauler_profiles.status
       FROM sessions
       JOIN users ON users.id=sessions.user_id
       JOIN hauler_profiles ON hauler_profiles.user_id=users.id
      WHERE sessions.token_hash=?
        AND datetime(sessions.expires_at)>datetime('now')
      LIMIT 1`
  ).bind(tokenHash).first();
}

async function ensureMarketplaceSchema(env: any): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS order_offers (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      hauler_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','declined','expired')),
      offered_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      UNIQUE(order_id, hauler_id),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (hauler_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS order_assignments (
      order_id TEXT PRIMARY KEY,
      hauler_id TEXT NOT NULL,
      accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (hauler_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_order_offers_hauler_status ON order_offers(hauler_id,status,offered_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_order_assignments_hauler ON order_assignments(hauler_id,accepted_at DESC)").run();
}

async function marketplaceList(request: Request, env: any): Promise<Response> {
  const hauler = await sessionHauler(request, env);
  if (!hauler) return json({ error: "Please sign in again." }, 401);
  if (hauler.status !== "approved") return json({ error: "Hauler approval is required before delivery requests are unlocked.", status: hauler.status }, 403);
  await ensureMarketplaceSchema(env);

  const rows = await env.DB.prepare(
    `SELECT o.id,o.status,o.order_type,o.delivery_timing,o.requested_date,o.gallons,
            o.city,o.province,o.hose_distance_ft,o.delivery_notes,o.created_at
       FROM orders o
      WHERE o.status IN ('requested','offered')
        AND o.customer_id<>?
        AND o.gallons<=?
        AND NOT EXISTS (
          SELECT 1 FROM order_assignments a WHERE a.order_id=o.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM order_offers f
           WHERE f.order_id=o.id AND f.hauler_id=? AND f.status='declined'
        )
      ORDER BY CASE o.delivery_timing WHEN 'urgent' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
               COALESCE(o.requested_date,'9999-12-31'), o.created_at ASC
      LIMIT 30`
  ).bind(hauler.id, Number(hauler.truck_capacity_gallons || 0), hauler.id).all();

  for (const order of rows.results || []) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO order_offers (id,order_id,hauler_id,status) VALUES (?,?,?,'offered')"
    ).bind(crypto.randomUUID(), order.id, hauler.id).run();
    await env.DB.prepare(
      "UPDATE orders SET status='offered', updated_at=datetime('now') WHERE id=? AND status='requested'"
    ).bind(order.id).run();
  }

  const active = await env.DB.prepare(
    `SELECT o.id,o.status,o.order_type,o.delivery_timing,o.requested_date,o.gallons,
            o.address_line1,o.address_line2,o.city,o.province,o.postal_code,
            o.hose_distance_ft,o.delivery_notes,o.created_at,
            u.full_name AS customer_name,u.email AS customer_email,u.phone AS customer_phone
       FROM order_assignments a
       JOIN orders o ON o.id=a.order_id
       JOIN users u ON u.id=o.customer_id
      WHERE a.hauler_id=? AND o.status NOT IN ('completed','cancelled')
      ORDER BY a.accepted_at DESC`
  ).bind(hauler.id).all();

  return json({ ok: true, available: rows.results || [], active: active.results || [] });
}

async function marketplaceDecision(request: Request, env: any, orderId: string, action: "accept" | "decline"): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Request not allowed." }, 403);
  const hauler = await sessionHauler(request, env);
  if (!hauler) return json({ error: "Please sign in again." }, 401);
  if (hauler.status !== "approved") return json({ error: "Hauler approval is required." }, 403);
  await ensureMarketplaceSchema(env);

  const order = await env.DB.prepare(
    `SELECT o.*,u.email AS customer_email,u.full_name AS customer_name,u.phone AS customer_phone
       FROM orders o JOIN users u ON u.id=o.customer_id
      WHERE o.id=? LIMIT 1`
  ).bind(orderId).first();
  if (!order) return json({ error: "That delivery request no longer exists." }, 404);
  if (Number(order.gallons) > Number(hauler.truck_capacity_gallons)) return json({ error: "This request exceeds your approved truck capacity." }, 400);

  await env.DB.prepare(
    "INSERT OR IGNORE INTO order_offers (id,order_id,hauler_id,status) VALUES (?,?,?,'offered')"
  ).bind(crypto.randomUUID(), orderId, hauler.id).run();

  if (action === "decline") {
    await env.DB.prepare(
      "UPDATE order_offers SET status='declined', responded_at=datetime('now') WHERE order_id=? AND hauler_id=?"
    ).bind(orderId, hauler.id).run();
    return json({ ok: true, status: "declined" });
  }

  const claimed = await env.DB.prepare(
    "UPDATE orders SET status='accepted', updated_at=datetime('now') WHERE id=? AND status IN ('requested','offered')"
  ).bind(orderId).run();

  if (!claimed.meta || Number(claimed.meta.changes || 0) !== 1) {
    return json({ error: "Another hauler has already accepted this delivery." }, 409);
  }

  await env.DB.prepare(
    "INSERT INTO order_assignments (order_id,hauler_id,accepted_at) VALUES (?,?,datetime('now'))"
  ).bind(orderId, hauler.id).run();
  await env.DB.prepare(
    "UPDATE order_offers SET status=CASE WHEN hauler_id=? THEN 'accepted' ELSE 'expired' END, responded_at=datetime('now') WHERE order_id=?"
  ).bind(hauler.id, orderId).run();

  if (env.RESEND_API_KEY) {
    const delivery = [order.address_line1, order.city, order.province].filter(Boolean).join(", ");
    const customerText = [
      "Your Water OnCall delivery request has been accepted.",
      "",
      "Hauler: " + (hauler.business_name || "Approved Water OnCall hauler"),
      "Delivery: " + Number(order.gallons).toLocaleString() + " gallons",
      "Location: " + delivery,
      "",
      "Sign in to Water OnCall to view the latest status."
    ].join("\n");
    const haulerText = [
      "You accepted a Water OnCall delivery.",
      "",
      "Customer: " + (order.customer_name || "Customer"),
      "Email: " + order.customer_email,
      "Phone: " + (order.customer_phone || ""),
      "Delivery: " + Number(order.gallons).toLocaleString() + " gallons",
      "Address: " + [order.address_line1, order.address_line2, order.city, order.province, order.postal_code].filter(Boolean).join(", "),
      "Notes: " + (order.delivery_notes || "None")
    ].join("\n");
    await Promise.allSettled([
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Water OnCall <updates@notify.wateroncall.ca>", to: [order.customer_email], subject: "Your Water OnCall delivery was accepted", text: customerText })
      }),
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Water OnCall <updates@notify.wateroncall.ca>", to: [hauler.email], subject: "Delivery accepted — Water OnCall", text: haulerText })
      })
    ]);
  }

  return json({ ok: true, status: "accepted" });
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/hauler-phone.js" && request.method === "GET") return scriptResponse(PHONE_SCRIPT);
    if (url.pathname === "/hauler-marketplace.js" && request.method === "GET") return scriptResponse(MARKETPLACE_SCRIPT);
    if (url.pathname === "/api/hauler/offers" && request.method === "GET") return marketplaceList(request, env);

    const offerMatch = url.pathname.match(/^\/api\/hauler\/offers\/([^/]+)\/(accept|decline)$/);
    if (offerMatch && request.method === "POST") {
      return marketplaceDecision(request, env, decodeURIComponent(offerMatch[1]), offerMatch[2] as "accept" | "decline");
    }

    const response = await app.fetch(request, env);
    if (url.pathname !== "/hauler" || request.method !== "GET" || !response.headers.get("Content-Type")?.includes("text/html")) {
      return response;
    }

    const html = addHaulerEnhancements(await response.text());
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.set("Cache-Control", "no-store");
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  }
};
