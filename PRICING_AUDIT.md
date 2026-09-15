# Water OnCall pricing audit

## Current source of truth target
`src/pricing_engine.ts` is the authoritative pricing calculation for new work.

Customer total = hauler base price + distance surcharge + hose surcharge + Water OnCall service fee.

Hauler payout = hauler base price + distance surcharge + hose surcharge.

Every accepted/priced order should eventually receive an immutable `order_pricing_snapshots` row.

## Existing legacy settings
`src/ops.ts` currently stores:
- `base_price_cents`
- `included_km` (default 10 km)
- `extra_5km_cents` (default $5 per additional 5 km)
- `included_hose_ft` (legacy default 50 ft)
- `extra_50ft_cents` (legacy name/default $5)

The newer Water OnCall design uses 25 ft included hose and $5 per additional 25 ft. Do not reinterpret old `extra_50ft_cents` values as 25-ft pricing without an explicit migration, because that could silently change existing hauler economics.

## Safe migration plan
1. Add new canonical settings columns: `included_hose_ft_v2` and `extra_25ft_cents`.
2. For existing haulers, require confirmation of hose pricing before live quoting uses v2. Do not silently halve/double old values.
3. New haulers default to 25 ft included and $5/additional 25 ft.
4. Distance remains 10 km included and $5/additional 5 km unless the hauler sets different values.
5. Service fee remains controlled by `platform_settings.service_fee_cents`.
6. Once an order is accepted, freeze all pricing inputs and outputs in `order_pricing_snapshots`.
7. Stripe must charge the snapshot customer total, never recalculate from current settings at payment time.

## Before live Stripe
- confirm whether Water OnCall service fee is customer-visible as a separate line item;
- confirm platform fee/take-rate model if it will also be deducted from hauler payout;
- confirm HST/tax treatment for Water OnCall's own service fee separately from potable-water delivery;
- confirm distance source (road distance from selected fill station, not straight-line distance);
- prevent orders without a complete pricing snapshot from being charged.
