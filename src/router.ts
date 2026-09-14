import app from "./pricing";

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
  const hash = await sha256(token);
  return env.DB.prepare(`SELECT users.id,users.email,users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND datetime(sessions.expires_at)>datetime('now') LIMIT 1`).bind(hash).first();
}

async function teamRole(userId: string, env: any): Promise<string | null> {
  try {
    const row = await env.DB.prepare(`SELECT role FROM hauler_team_members WHERE user_id=? AND active=1 ORDER BY CASE role WHEN 'dispatcher' THEN 0 ELSE 1 END LIMIT 1`).bind(userId).first<any>();
    return row?.role || null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/account") {
      const user = await sessionUser(request, env);
      if (user) {
        const role = await teamRole(user.id, env);
        if (role === "dispatcher") return Response.redirect(new URL("/dispatcher", request.url).toString(), 302);
        if (role === "driver") return Response.redirect(new URL("/driver", request.url).toString(), 302);
      }
    }
    return app.fetch(request, env, ctx);
  }
};