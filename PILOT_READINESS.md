# Water OnCall — Pre-pilot readiness

## Built / structurally in place
- Central notification service and notification audit log.
- Admin notification history.
- Central order lifecycle and order activity log.
- Driver/hauler status transition hardening.
- Admin order activity history.
- Central pricing engine with hidden Water OnCall fee deducted from hauler payout.
- Immutable pricing snapshot structure.
- Water station directory and hauler-station relationships.
- Truck-capacity-specific pricing and fuel surcharge.
- 25 ft hose pricing model.
- Customer preferred / backup / excluded hauler preferences.
- Preferred-hauler 24-hour offer structure.
- Three-day payout hold foundation and payout ledger.
- Audited Admin status/payout overrides.
- Customer order readiness model: verified email + verified mobile + payment method.
- TESTING/LIVE platform mode with payment and dispatch safety interlocks.
- Admin Pilot Control Center.
- Hauler Delivery Setup page.
- Customer Choose Haulers page.

## External integrations still required before LIVE
1. Stripe / Stripe Connect: save payment method, charge on hauler acceptance, refund/cancellation handling, connected hauler accounts, payout batching/hold/release.
2. Google Maps Platform: address autocomplete/Place IDs and road-driving distance from eligible water stations to customer address; closest station calculation and operational override.
3. Twilio: complete production compliance/number setup if required, then mandatory Accepted/Delivered/Cancelled SMS and optional En Route SMS.
4. Resend: finish migrating legacy email paths into centralized notifications and resolve launch-list customer confirmation separately.

## Business rules intentionally left open
- Same-day customer cancellation charge/hauler compensation.
- Hauler daily capacity / overcommit rules.

## Before owner review
- Link new management screens from existing portals.
- Audit wrapper/entrypoint chain for accidental bypasses.
- Confirm all TESTING safeguards are active.
- Verify role authorization on new endpoints.
- Confirm old legacy pricing cannot be used accidentally for new pricing snapshots.
- Do not enable payments, dispatch or automatic payouts.

## Before LIVE
- Complete owner walkthrough for customer, hauler, dispatcher, driver and admin.
- Complete Stripe and Maps integrations in test/sandbox mode first.
- Test full order lifecycle end-to-end including declined/expired preferred offer, backup acceptance, charge, delivery, cancellation, complaint hold and payout.
- Verify mandatory notifications and failure visibility.
- Confirm legal/terms/privacy/hauler agreement and tax/accounting treatment with appropriate professional advice.
