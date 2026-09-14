import app from "./router";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function validEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain || local.length > 64 || domain.length > 253 || domain.startsWith(".") || domain.endsWith(".")) return null;
  return email;
}

function canadianPhone(value: unknown): { e164: string; display: string } | null {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10 || digits[0] === "0" || digits[0] === "1" || digits[3] === "0" || digits[3] === "1") return null;
  return { e164: "+1" + digits, display: "+1 " + digits.slice(0,3) + "-" + digits.slice(3,6) + "-" + digits.slice(6) };
}

function validationScript(): Response {
  const js = `document.addEventListener("DOMContentLoaded",()=>{const emailInputs=[...document.querySelectorAll('input[type="email"]')];const phoneInputs=[...document.querySelectorAll('input[type="tel"]')];const emailOk=v=>/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v.trim())&&v.trim().length<=254;const phone=v=>{let d=v.replace(/\\D/g,'');if(d.length===11&&d[0]==='1')d=d.slice(1);if(d.length!==10||['0','1'].includes(d[0])||['0','1'].includes(d[3]))return null;return '+1 '+d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6)};emailInputs.forEach(i=>{i.addEventListener('blur',()=>{i.setCustomValidity(emailOk(i.value)?'':'Enter a valid email address, for example name@example.com.');if(i.value)i.reportValidity()})});phoneInputs.forEach(i=>{i.placeholder=i.placeholder||'905-555-1234';i.addEventListener('blur',()=>{const f=phone(i.value);i.setCustomValidity(f?'':'Enter a valid 10-digit Canadian mobile number.');if(f)i.value=f;else if(i.value)i.reportValidity()})})});`;
  return new Response(js, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
}

async function validatedRequest(request: Request): Promise<{ request?: Request; error?: Response }> {
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) return { request };
  let body: any;
  try { body = await request.clone().json(); } catch { return { request }; }
  if (!body || typeof body !== "object") return { request };
  for (const key of ["email","customer_email"]) {
    if (key in body && body[key]) {
      const email = validEmail(body[key]);
      if (!email) return { error: json({ error: "Enter a valid email address." }, 400) };
      body[key] = email;
    }
  }
  for (const key of ["phone","customer_phone"]) {
    if (key in body && body[key]) {
      const phone = canadianPhone(body[key]);
      if (!phone) return { error: json({ error: "Enter a valid 10-digit Canadian mobile number." }, 400) };
      body[key] = phone.e164;
    }
  }
  const headers = new Headers(request.headers);
  return { request: new Request(request, { body: JSON.stringify(body), headers }) };
}

function injectValidation(html: string): string {
  if (html.includes('/validation.js')) return html;
  return html.replace("</body>", '<script src="/validation.js" defer></script></body>');
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/validation.js" && request.method === "GET") return validationScript();
    const writeApi = request.method === "POST" || request.method === "PATCH" || request.method === "PUT";
    let forwarded = request;
    if (writeApi && url.pathname.startsWith("/api/")) {
      const checked = await validatedRequest(request);
      if (checked.error) return checked.error;
      forwarded = checked.request || request;
    }
    const response = await app.fetch(forwarded, env, ctx);
    if (request.method !== "GET" || !response.headers.get("Content-Type")?.includes("text/html")) return response;
    const html = injectValidation(await response.text());
    const headers = new Headers(response.headers); headers.delete("Content-Length"); headers.set("Cache-Control","no-store");
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  }
};
