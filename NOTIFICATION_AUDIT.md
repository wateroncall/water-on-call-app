# Water OnCall notification audit

Production app: `wateroncall/water-on-call-app` → `app.wateroncall.ca`

## Confirmed notification paths

| Event | Channel | Recipient | Provider | Current owner | Migration status |
|---|---|---|---|---|---|
| Customer/hauler/admin sign-in code | Email | User email | Resend | `src/index.ts` → `sendLoginEmail()` | Keep working; migrate later |
| SMS sign-in code | SMS | Verified user phone | Twilio Verify | `src/index.ts` → `sendSmsCode()` / `twilioVerifyRequest()` | Keep working; migrate later |
| Phone verification code | SMS | Signed-in user's phone | Twilio Verify | `src/index.ts` | Keep working; migrate later |
| Delivery status: En Route | Email | Customer | Resend | `src/portal.ts` → `updateDeliveryStatus()` | Candidate for first email migration |
| Delivery status: Delivered | Email | Customer | Resend | `src/portal.ts` → `updateDeliveryStatus()` | Candidate for first email migration |
| Delivery status: Completed | Email | Customer | Resend | `src/portal.ts` → `updateDeliveryStatus()` | Candidate for first email migration |
| Launch-list customer confirmation | Email | Launch-list customer | Resend | `src/launch_email.ts` | Known issue; leave isolated until central service proven |
| Launch-list admin notification | Email | info@wateroncall.ca | Resend | `src/launch_email.ts` | Known issue/legacy behaviour; leave isolated until traced fully |

## Operational gaps identified

1. Notification sends are scattered across multiple wrapper layers.
2. Delivery-status email catches and ignores transport exceptions, so failures are invisible to Admin.
3. Existing direct Resend calls do not create an application audit record.
4. Twilio Verify and Resend use different error/reporting patterns.
5. Launch-list notification code was added late in the wrapper chain and should not be treated as the architectural model.
6. Driver status updates in `src/ops.ts` update the order directly; the hauler status endpoint in `src/portal.ts` separately owns customer status email. These need one authoritative order transition service before driver notifications are enabled.

## Migration order

1. Delivery-status customer email (`src/portal.ts`) — known, simple, transactional event.
2. Confirm Admin Notification History records sent/failed delivery-status messages.
3. Email login code — preserve current sender/domain and rate-limit behaviour.
4. Twilio Verify audit logging (do not replace Verify transport; only centralize logging/event ownership).
5. Hauler/order offer and acceptance notifications after order state machine is centralized.
6. Launch-list emails last, after the known-good paths prove the central notification service.

## Rule

No new feature should call Resend or Twilio directly. New notification events must use `src/notifications.ts`, with provider-specific transport hidden behind that service.
