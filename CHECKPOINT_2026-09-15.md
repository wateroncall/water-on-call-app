# Water OnCall checkpoint — Sept 15, 2026

## STOP POINT
Do not continue development from the current visible QA screen without first restoring the established polished role interfaces. Owner feedback: development went significantly backwards today because testing/auth changes replaced the designed pages with a crude generic QA page.

## Non-negotiable direction for next session
- Preserve the existing polished/mobile-friendly Customer, Water Hauler, Dispatcher, Driver and Admin interfaces. Do not replace them with generic QA pages.
- In TESTING only, put one persistent dropdown at the top of the real application: Customer / Water Hauler / Dispatcher / Driver / Admin.
- Ignore sign-in/authentication while owner is testing. Authentication remains in code and will be tested separately later.
- Dropdown changes effective TEST role without email/SMS codes or separate accounts.
- Same TEST delivery must follow across all real role interfaces: Customer request -> Hauler offer/accept -> Dispatcher assignment -> Driver En Route/Delivered -> Admin review/payout.
- TEST records must never trigger real payment, payout, dispatch, email or SMS.
- Real payments/dispatch/automatic payouts remain OFF.
- Keep TESTING / COMING SOON status obvious.
- Mobile friendliness is required throughout.

## Immediate correction required
Current `src/qa_app.ts` intercepts `/`, `/login`, `/account`, `/hauler`, `/dispatcher`, `/driver`, `/admin` and replaces the established pages. This was the wrong approach. Back it out as the visible UI. Its isolated `qa_orders` concept may be reused behind the real interfaces if useful.

## Architecture lesson
Too many wrapper entrypoints accumulated. Consolidate toward one clear router/entrypoint rather than adding more wrappers. Audit the full existing repository before changing visible interfaces. Preserve existing functionality and styling first; layer TEST role context behind it.

## Confirmed issues found today
- Admin Testing Toolkit initially broke because inline JS was blocked by CSP; fixed by external script.
- Customer Submit Delivery Request did nothing in Admin test context.
- Customer UI still showed legacy 50-ft hose wording in at least one path; intended current standard is 25 ft.
- Existing Google Maps customer-address integration exists in `src/customer_maps.ts` but was bypassed by newer entrypoint chains.
- Existing operations tuning in `src/finalize.ts` already changes hose defaults/wording to 25 ft.
- Older hauler marketplace/status code contains direct order status updates and direct Resend calls that can bypass newer centralized lifecycle/notification architecture.
- Legacy Dispatcher/Driver routing relies on actual database identities and conflicted with Admin role simulation.

## Business rules confirmed
- Water OnCall fee starts at $5.99, editable in Admin, invisible to customer, deducted from hauler price.
- Customer must ultimately verify email/mobile and have card entered before a real order is processed; card charges when hauler accepts.
- Hauler payout intended automatically after configurable hold, initially 3 days after delivery; daily batching is desired.
- Cancellation: before 24h no charge; within 24h $5.99; same-day rule intentionally open.
- Hose: 25 ft increments; hauler controls extra hose pricing.
- Distance: road-driving distance from water station; hauler controls included distance and extra-distance pricing.
- Water stations have addresses; system calculates closest usable station but operational alternatives are possible.
- Truck capacities have separate base pricing and fuel surcharge.
- Customer sees delivery price, extra hose, extra km and fuel surcharge; never Water OnCall fee.
- Preferred hauler has 24 hours; backup eligible haulers first-to-accept after that. No preferred means customer-selected approved haulers; Select All and exclusions supported.
- Acceptance is binding and should eventually charge card atomically before assignment/customer details are released.
- Single-truck operator can act as driver; multi-truck company may use dispatcher/driver workflow.
- Accepted/Delivered/Cancelled notifications mandatory; En Route optional.
- Admin approval required for haulers for now; hauler attests required documents are available.
- Admin needs audited emergency override ability.
- Same-day cancellation and hauler overcommit/capacity rules intentionally remain open.

## Structural work added today (retain where useful, but audit before activation)
- centralized pricing engine + immutable pricing snapshot concept
- hidden platform-fee model
- water station + hauler station schema
- truck-capacity pricing schema
- payout ledger/3-day hold foundation
- customer hauler preferences/exclusions
- preferred marketplace offer structure
- Admin pilot controls
- audited Admin overrides
- cancellation policy/guard
- TESTING/LIVE interlocks and live-readiness blockers
- financial acceptance guard
- hauler setup/pricing page
- customer hauler preference page
- security headers/cross-origin API guard
- owner review/readiness docs

## External integrations still incomplete
- Stripe / Stripe Connect
- Google Maps road-distance/closest-station integration (some browser address code already exists)
- Twilio production SMS
- Resend cleanup, especially launch-list customer confirmation

## Current deployed entrypoint at stop
`wrangler.jsonc` points to `src/qa_app.ts`. This should NOT be treated as the desired final UI. First task next session is to restore the real polished pages and then implement TEST role switching behind them.
