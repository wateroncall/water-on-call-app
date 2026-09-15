# Water OnCall production architecture

## Public website
- Domain: `www.wateroncall.ca` / `wateroncall.ca`
- GitHub: `wateroncall/water-on-call-website`
- Cloudflare Worker: `water-on-call-website`
- Purpose: marketing pages and demos only.

## Application
- Domain: `app.wateroncall.ca`
- GitHub: `wateroncall/water-on-call-app`
- Cloudflare Worker: `water-on-call-app`
- Purpose: customer accounts, launch list, orders, haulers, admin, authentication, pricing, notifications and operational workflows.

## Structural rules
1. Business functionality belongs in the app repository, not the marketing website.
2. Email/SMS delivery should go through `src/notifications.ts` rather than direct provider calls.
3. Every notification attempt should create a `notification_log` row with pending/sent/failed status.
4. Order status changes, pricing and payments should each have one authoritative service/module.
5. Admin should expose operational history rather than requiring Cloudflare/Resend inspection for routine troubleshooting.

## Notification event naming
Use stable event names, for example:
- `launch.customer_joined.customer_confirmation`
- `launch.customer_joined.admin_notification`
- `order.requested.customer_confirmation`
- `order.offered.hauler_notification`
- `order.accepted.customer_notification`
- `order.en_route.customer_notification`
- `order.delivered.customer_notification`
- `order.cancelled.notification`

This file is the reference for deciding which repository and module should be changed for future Water OnCall work.
