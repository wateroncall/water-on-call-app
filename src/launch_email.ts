import app from "./launch";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM = "Water OnCall <info@wateroncall.ca>";
const NOTIFY = "info@wateroncall.ca";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendEmail(env: any, payload: Record<string, unknown>): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.error("Launch email skipped: RESEND_API_KEY is missing");
    return;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error("Launch email failed", response.status, await response.text());
  }
}

async function sendLaunchEmails(env: any, body: any): Promise<void> {
  const name = String(body?.full_name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!email) return;

  const firstName = name.split(/\s+/)[0] || "there";
  const safeFirstName = esc(firstName);
  const safeName = esc(name);
  const safeEmail = esc(email);
  const safePhone = esc(body?.phone || "Not provided");
  const safePostal = esc(body?.postal_code || "Not provided");
  const safeNeed = esc(String(body?.water_need || "Not provided").replace(/_/g, " "));

  await Promise.allSettled([
    sendEmail(env, {
      from: FROM,
      to: [email],
      subject: "You’re on the Water OnCall launch list",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#13283d;line-height:1.6">
          <h1 style="color:#06325e">Welcome to Water OnCall, ${safeFirstName}!</h1>
          <p>Thanks for joining the Water OnCall launch list.</p>
          <p>We’re building a simpler way to request bulk water delivery from approved local water haulers.</p>
          <p>We’ll email you when Water OnCall ordering becomes available in your area.</p>
          <p style="margin-top:28px"><strong>Water OnCall</strong><br>Bulk water delivery. A simpler way.</p>
        </div>`,
    }),
    sendEmail(env, {
      from: FROM,
      to: [NOTIFY],
      subject: `New Water OnCall launch-list signup — ${name || email}`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#13283d;line-height:1.6">
          <h2>New customer joined the launch list</h2>
          <p><strong>Name:</strong> ${safeName}</p>
          <p><strong>Email:</strong> ${safeEmail}</p>
          <p><strong>Phone:</strong> ${safePhone}</p>
          <p><strong>Postal code / community:</strong> ${safePostal}</p>
          <p><strong>Water need:</strong> ${safeNeed}</p>
          <p><strong>Currently uses a water hauler:</strong> ${body?.current_hauler ? "Yes" : "No"}</p>
        </div>`,
    }),
  ]);
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/launch/waitlist") {
      let body: any = null;
      try {
        body = await request.clone().json();
      } catch {
        // Let the existing launch handler return its normal validation response.
      }

      const response = await app.fetch(request, env, ctx);
      if (response.ok && body) {
        ctx.waitUntil(sendLaunchEmails(env, body));
      }
      return response;
    }

    return app.fetch(request, env, ctx);
  },
};
