# Changelog

## Unreleased

- **Railbed Trigger** keeps its endpoint when n8n's address is written differently from how Railbed stores it (capital letters, `:443`, an international domain name), instead of replacing it on every start.
- **Railbed Trigger** recovers when its address is already subscribed but its saved ID and secret are gone (for example while listening for a test event): it removes that endpoint and subscribes again.
- **Railbed Trigger** replaces its endpoint on start while a secret rolled in the Railbed dashboard is in its 24-hour overlap, so deliveries don't start failing when the overlap ends.
- **Railbed Trigger** shows "Railbed can't send events to this n8n address" only when Railbed refused the address itself (`invalid_url`), not for every refusal of a local address.
- **Railbed**: a simplified payment now has `livemode`, `metadata` and `hold_reason` (and no longer `description`, `customer_email` or `created`).
- **Railbed**: a mapped amount with more than two decimals is refused instead of rounded.
- **Railbed**: Payment → Get Many reads a date picked without a time zone in the workflow's time zone.
- **Railbed**: Get Many waits out Railbed's rate limit (up to three times) while following pages, and refuses a limit below 1.
- **Railbed**: with On Error set to continue, failed items carry Railbed's error `code`, `httpCode` and `description`.
- **Railbed**: Checkout Session → Create can send the customer's date of birth and marketing consent.
- **Railbed**: an empty ID, `.` or `..` is refused instead of reaching another route.
- **Railbed API** credential: the connection test ignores a path after the address (such as `/v1`) and won't send the key over plain http to anything but localhost.
- The `commerce_paused` error now says to contact support.
- Example workflows: skip Send test event's sample payment, print currency codes, total yesterday's paid payments per currency, require header auth on the deal webhook, give the AI agent's tools filters it can fill in, and carry no fixed webhook IDs.

## 0.1.0 (2026-10-12)

First release.

- **Railbed** node: Checkout Session (Create, with what to ask the buyer for; Get; Start), Payment (Get, Get Many, Simulate), Order (Get, Get Many, Update Fulfillment, Record Cancellation or Refund), Customer (Get, Get Many) and Webhook Endpoint (Create, Get, Get Many, Delete). Usable as an AI Agent tool.
- **Railbed Trigger** node: subscribes through Railbed's webhook endpoints API when the workflow is published and unsubscribes when it isn't, verifies every `Railbed-Signature` and can add the current payment (repeats are handled with n8n's Remove Duplicates).
- **Railbed API** credential: one secret key, tested by reading one payment.
