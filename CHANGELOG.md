# Changelog

## 0.1.0 (2026-10-13)

First release.

- **Railbed** node: Checkout Session (Create, with customer details and what to ask the buyer for; Get; Start), Payment (Get, Get Many, Simulate), Order (Get, Get Many, Update Fulfillment, Record Cancellation or Refund), Customer (Get, Get Many) and Webhook Endpoint (Create, Get, Get Many, Delete). Usable as an AI Agent tool.
- Every record field (payment, checkout session, order, customer, webhook endpoint, and Order → Get Many's customer filter) is a picker with **From List**, **By ID** and **By URL**. From List shows records as the Railbed dashboard does (`$49.00 · nathan@example.com · Paid · Oct 12, 3:04 PM`), in the workflow's time zone and the key's mode, pages as you scroll, searches by ID, pasted link, reference, email or order number, and links each record to the dashboard. By URL takes a dashboard or checkout link. A value that isn't the right kind of ID is refused before Railbed is asked, with how to find the record.
- Words match the dashboard: a held payment "needs your decision" (the trigger's **Payment Needs Your Decision**, the **Needs Your Decision** status filter), fulfilment is **Fulfilled**, **Not Fulfilled** or **No Shipping**, and operation descriptions follow n8n's "Retrieve…" wording.
- **Simplify** (on by default) returns ten fields; a simplified payment keeps `id`, `status`, `livemode`, `amount`, `currency`, `reference`, `metadata`, `order_id`, `paid_at` and `hold_reason`.
- Amounts go as decimal text; a mapped number with more than two decimals is refused, not rounded. A date picked without a time zone is read in the workflow's time zone.
- Get Many follows Railbed's pages and waits out its rate limit (up to three times).
- Railbed's refusals become errors with what to do next and Railbed's error code; with On Error set to continue, the failed item carries `error`, `code`, `httpCode` and `description`.
- **Railbed Trigger** node: subscribes through Railbed's webhook endpoints API when the workflow is published and unsubscribes when it isn't, keeps its endpoint across restarts and different spellings of n8n's address, replaces it when the events or address change or its secret was rolled, recovers an address whose secret was lost, verifies every `Railbed-Signature`, skips pings and the other mode's events, marks Send test event's sample payment (`sample`), and can add the current payment. Repeats are handled with n8n's Remove Duplicates node.
- **Railbed API** credential: one secret key; the connection test reads one payment, ignores a path after the address and never sends the key over plain http to anything but localhost.
- Example workflows in `workflows/`: paid order → fulfil (and a Slack variant), won deal → checkout link, payment needs your decision → alert the owner, yesterday's paid payments per currency, and an AI agent with payments, orders and customers as tools.
