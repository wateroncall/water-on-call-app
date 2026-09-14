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

function phoneScriptResponse(): Response {
  return new Response(PHONE_SCRIPT, {
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

function addHaulerPhoneVerification(html: string): string {
  if (html.includes('id="hauler-phone-verify-start"')) return html;

  const section = [
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

  return html.replace("</main>", section + "</main>");
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/hauler-phone.js" && request.method === "GET") return phoneScriptResponse();

    const response = await app.fetch(request, env);
    if (url.pathname !== "/hauler" || request.method !== "GET" || !response.headers.get("Content-Type")?.includes("text/html")) {
      return response;
    }

    const html = addHaulerPhoneVerification(await response.text());
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.set("Cache-Control", "no-store");
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  }
};
