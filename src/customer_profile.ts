export type NotificationPreference = "email" | "sms" | "both";

export interface CustomerProfileRow {
  user_id: string;
  notification_preference: NotificationPreference;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  province: string;
  postal_code: string | null;
}

export async function ensureCustomerProfileSchema(env: { DB: D1Database }): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS customer_profiles (
    user_id TEXT PRIMARY KEY,
    notification_preference TEXT NOT NULL DEFAULT 'email' CHECK (notification_preference IN ('email','sms','both')),
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    province TEXT NOT NULL DEFAULT 'ON',
    postal_code TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`).run();
}

export function wantsEmail(preference: unknown): boolean {
  return preference !== "sms";
}

export function wantsSms(preference: unknown): boolean {
  return preference === "sms" || preference === "both";
}
