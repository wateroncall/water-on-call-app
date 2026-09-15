# app.wateroncall.ca — Owner review walkthrough

Keep platform in TESTING during this review. Do not enable payments, dispatch or automatic payouts.

## Customer
1. Sign in and confirm email-code login still works.
2. Verify mobile and confirm text-code flow where available.
3. Open Customer Portal and Choose Water Haulers.
4. Test Preferred, Backup, Exclude and Select All behaviour.
5. Review Request Water flow and wording. Real submission must remain blocked in TESTING.
6. Review existing orders, expandable details, Order Again and cancellation UI.
7. Note any confusing wording, missing fields or mobile-layout issues.

## Hauler
1. Sign in as an approved hauler.
2. Open Delivery Setup & Pricing.
3. Add each truck capacity and review base price, fuel surcharge, distance and 25-ft hose settings.
4. Review water-station selection/add-station workflow.
5. Review marketplace presentation. Real acceptance must remain blocked in TESTING.
6. Review active deliveries/status workflow.

## Dispatcher / Driver
1. Confirm multi-truck team setup and driver assignment remain understandable.
2. Confirm a driver sees only assigned deliveries.
3. Review En Route / Delivered / Completed actions and terminology.

## Admin
1. Review hauler applications and approval flow.
2. Open Pilot Controls. Confirm $5.99 fee and 3-day payout hold.
3. Keep TESTING, payments OFF, dispatch OFF and automatic payouts OFF.
4. Review Notification History and Order Activity pages.
5. Review whether emergency override capabilities/wording are sufficient.

## Expected incomplete integrations
- Stripe / Stripe Connect is not yet connected for real card/payment/payout actions.
- Google Maps driving distance is not yet connected.
- Production Twilio notification workflow is not yet complete.
- Resend launch-list customer confirmation remains isolated for later repair.

## Feedback format
For each change, note: role/page, what you clicked, what happened, and what you want instead. Screenshots are useful for visual/layout changes.
