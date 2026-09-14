CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','hauler','dispatcher','driver','admin')),
  full_name TEXT,
  phone TEXT,
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','offered','accepted','assigned','en_route','delivered','completed','cancelled')),
  order_type TEXT NOT NULL CHECK (order_type IN ('cistern','pool','hot_tub','commercial','other')),
  delivery_timing TEXT NOT NULL CHECK (delivery_timing IN ('flexible','scheduled','urgent')),
  requested_date TEXT,
  gallons INTEGER NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT 'ON',
  postal_code TEXT NOT NULL,
  hose_distance_ft INTEGER,
  delivery_notes TEXT,
  total_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'CAD',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_login_codes_email_created ON login_codes(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hauler_profiles (
  user_id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  service_areas TEXT NOT NULL,
  truck_capacity_gallons INTEGER NOT NULL,
  truck_count INTEGER NOT NULL DEFAULT 1,
  license_number TEXT,
  insurance_expiry TEXT,
  application_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  rejection_reason TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hauler_profiles_status ON hauler_profiles(status, created_at DESC);
