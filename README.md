# @railbed/n8n-nodes-railbed

The official [Railbed](https://railbed.com) nodes for [n8n](https://n8n.io). Railbed is card checkout for merchants: buyers pay by card on a Railbed checkout page, and you follow each payment, order and customer in the Railbed dashboard.

With this package you can start workflows from signed Railbed events, create checkout sessions, look up payments, orders and customers, and mark orders fulfilled, in ordinary workflows or as tools for n8n's AI Agent.

Full guide with example workflows: [railbed.com/docs/guides/n8n](https://railbed.com/docs/guides/n8n/).

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Trigger](#trigger)
- [Compatibility](#compatibility)
- [Usage](#usage)
- [Resources](#resources)
- [Development](#development)

## Installation

Follow n8n's [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/). On self-hosted n8n, an owner or admin opens **Settings → Community Nodes**, chooses **Install** and enters:

```text
@railbed/n8n-nodes-railbed
```

n8n Cloud lists community nodes once n8n has verified them; until this package is verified, use it on self-hosted n8n.

## Credentials

One credential, **Railbed API**:

| Field | What to enter |
|---|---|
| Secret Key | A secret key from **Developers** in the Railbed dashboard. `rb_test_…` keys work only with Test data and `rb_live_…` keys only with Live data, so make one credential per mode |
| Base URL | Leave it as `https://pay.railbed.io` |

Use a **Full access** key for the trigger, for creating checkout sessions and for updating orders. A **Read only** key can look up payments, orders and customers. n8n tests the credential by reading one payment. Step by step: [Connect your Railbed account](https://railbed.com/docs/guides/n8n/#connect-your-railbed-account).

## Operations

The **Railbed** node:

| Resource | Operation | What it does |
|---|---|---|
| Checkout Session | Create | Creates a session and returns the `url` to send the buyer. Optional idempotency key, customer details (name, phone, date of birth, marketing consent), what to ask the buyer for, reference, metadata, order details, success and cancel URLs |
| | Get | Gets a session by ID |
| | Start | Starts a session and returns its card providers, for a checkout page you build yourself |
| Payment | Get | Gets a payment's current status and details |
| | Get Many | Lists payments, newest first; filter by status, reference and creation time (a time without a zone is read in the workflow's time zone) |
| | Simulate | Ends a Test payment as paid, underpaid, declined or failed. Test mode only; moves no money |
| Order | Get | Gets an order with its items, addresses and payment attempts |
| | Get Many | Lists orders; filter by customer, store ID or your store's order ID |
| | Update Fulfillment | Marks an order fulfilled, unfulfilled or as having nothing to fulfil |
| | Record Cancellation or Refund | Notes on the order's timeline that your store canceled or refunded it. Moves no money |
| Customer | Get | Gets a customer's contact details, addresses and totals |
| | Get Many | Lists customers, or finds one by email |
| Webhook Endpoint | Create, Get, Get Many, Delete | Manages the addresses that receive Railbed events. The signing secret is returned once, on Create |

**Simplify** (on by default) returns ten fields instead of the full record on Checkout Session Create and Get, on Get and Get Many for payments, orders and customers, and on Update Fulfillment; turn it off for everything. A simplified payment keeps what you check before fulfilling: `id`, `status`, `livemode`, `amount`, `currency`, `reference`, `metadata`, `order_id`, `paid_at` and `hold_reason`. Get Many offers **Return All** or a **Limit** and follows Railbed's pages for you, waiting out Railbed's rate limit if a long list meets it. The node can be connected to an AI Agent as a tool.

Amounts go to Railbed as decimal text such as `49.00`. A number mapped from an earlier node is sent with two decimals; one with more (such as `49.999`) is refused rather than rounded.

When Railbed refuses a request, the error gives Railbed's message, what to do next, and Railbed's error code and the field at fault. With the node's **On Error** setting on **Continue**, the failed item carries `error`, `code` (Railbed's error code), `httpCode` and `description`, so a later node can branch on `code`.

## Trigger

**Railbed Trigger** starts a workflow on the events you choose: Payment Started, Payment Paid, Payment Held, Payment Updated, Payment Expired, Payment Canceled and Payment Failed. Fulfil orders on **Payment Paid** only.

- **Subscribes itself.** Publishing (activating) the workflow adds a webhook endpoint for n8n's address in the credential's mode, described as `n8n: <workflow name>`. Unpublishing removes it. The endpoint is replaced when the chosen events or n8n's address change, and recreated if someone removed it in the dashboard or revoked the key that added it. If its signing secret was rolled in the dashboard, the next start within 24 hours replaces it, so deliveries keep a secret the trigger knows.
- **Checks every signature.** Each delivery's `Railbed-Signature` header is verified against the endpoint's signing secret (HMAC-SHA256 over the exact bytes received, a five-minute window, either signature during a secret roll) before anything runs. Unsigned or altered requests are refused.
- **Repeats:** Railbed delivers each event at least once. To act once per event, follow the trigger with n8n's **Remove Duplicates** node (**Remove Items Processed in Previous Executions**, on the event's `id`).
- **Include Current Payment** (optional) re-reads the payment from the API and adds it as `currentPayment`.
- Railbed sends Live events only to public `https://` addresses. If n8n runs on your computer, give it a public address and set `N8N_WEBHOOK_URL` (`WEBHOOK_URL` before n8n 2.35).
- Each Railbed mode allows 10 webhook endpoints; each published workflow with this trigger uses one.

## Compatibility

- n8n with community nodes enabled, nodes API version 1.
- Built and linted with `@n8n/node-cli` 0.51.5 in strict mode.
- No runtime dependencies: the package uses only `n8n-workflow` (provided by n8n) and Node's built-in `crypto` module for the signature check.

## Usage

Start in Test mode: create a session, start it, then use **Payment → Simulate** to send your Test trigger the same events a real payment would. When the workflow works, add a Live credential and switch the nodes to it. Example workflows (paid payments to Google Sheets and Slack, fulfilment, emailing a checkout link, AI Agent tools) are in the [guide](https://railbed.com/docs/guides/n8n/#examples).

Importable copies live in [`workflows/`](workflows/) (in n8n: **Import from File**, then pick your Railbed credential): paid order → fulfil it (and a Slack variant), won deal → checkout link (its webhook needs a Header Auth credential, so only your CRM can call it), held payment → alert, yesterday's paid payments totalled per currency, and an AI agent with Railbed's payments, orders and customers as tools. The trigger workflows skip **Send test event**'s made-up sample payment (`sample` is `true`), which isn't in your account.

## Resources

- [Railbed's n8n guide](https://railbed.com/docs/guides/n8n/)
- [Railbed API reference](https://railbed.com/docs/api/)
- [Webhook events](https://railbed.com/docs/webhooks/events/) and [signatures](https://railbed.com/docs/webhooks/signatures/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- Support: [support@railbed.com](mailto:support@railbed.com)

## Development

Requires Node.js 22.22.2 or later (24.15 or later on Node 24) and npm 11: the lock file is written by npm 11, and `npm ci` with npm 10 refuses it.

```bash
npm ci          # install
npm run lint    # n8n's linter, strict mode
npm test        # build, then the unit tests
npm run dev     # start n8n at http://localhost:5678 with these nodes loaded
```

Releases are published to npm with provenance by GitHub Actions (`.github/workflows/publish.yml`) when a version tag is pushed. Run `npm run release` on `main` to bump the version, update the changelog, tag and push; never `npm publish` from a computer.

## License

[MIT](https://opensource.org/license/mit)
