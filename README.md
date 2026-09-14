# Water OnCall App

Standalone Cloudflare Worker application for Water OnCall.

## Commands

- `npm install`
- `npm run check`
- `npm run dev`
- `npm run deploy`

The first deployment provides the customer app shell and a health endpoint at
`/api/health`. Passwordless authentication, D1 persistence, dispatch, Stripe,
and Twilio are added as separately verified stages.
