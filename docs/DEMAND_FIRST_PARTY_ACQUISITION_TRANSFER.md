# DEMAND first-party acquisition transfer, V1

Status: internal Preview contract implementation. No landing endpoint, payment creation, webhook replacement, database migration or production integration is activated. All four INTERNAL V1 acceptance gates remain OPEN.

Implementation: `lib/demand/first-party-acquisition.ts` exports `issueDemandAcquisitionTransfer`, `prepareDemandHitPayAcquisitionReference` and `bindDemandHitPayAcquisitionRequest`. Node crypto supplies the random ID and HMAC; there are no added dependencies. Scope is pinned to DEMAND / BROS SELL / Preview / the existing PR #17 branch. Canonical UTC timestamps include milliseconds; ticket lifetime is 1–900 seconds and expiry is exclusive.

## Provider boundary verified on 1 November 2026

HitPay's [Create Payment Request API](https://docs.hitpayapp.com/apis/payment-request/create-request) accepts a merchant `reference_number` of up to 255 characters. The create response and [Get Payment Status API](https://docs.hitpayapp.com/apis/payment-request/get-payment-status) document that reference. The [Online Payments guide](https://docs.hitpayapp.com/apis/guide/online-payments) also documents it in `payment_request.completed` alongside the provider request ID and payment records. This supports an explicit Payment Request adapter contract; it does not establish that the existing storefront preserves arbitrary URL parameters.

The redirect query's `reference` is the provider payment-request ID. Its `status` is browser input and cannot verify payment. Metadata is accepted by the create API, but its return through the consulted status/webhook schemas is not established. V1 uses only `reference_number` as the proposed carrier.

Read-only provider order #1007 remains a historical completed/paid MYR50.00 storefront order. The bounded order-list response exposes no acquisition, UTM, click, payment-request or charge mapping fields. This is absence from that response, not a claim about every provider record. Historical MYR50 evidence does not change the current RM100 offer.

The BROS SELL capture route at source blob `a3bdd990fb59d008dc36fd9f1821bb792ce4a663` handles signed `charge.created`, logs normalized private evidence and does not persist an acquisition join. It is a different event path from the documented Payment Request completion event. This change does not modify either BROS SELL file.

A live public GET of [the landing](https://bros.bolehejas.com/) returned HTTP 200. Its JavaScript already copies allowlisted UTM and campaign/ad labels into session storage and appends those labels to the five purchase links. A read-only HEAD of `https://hitpay.link/kv4egp` returned HTTP 302 to the BROS SELL product on `hitpay.shop`; that redirect was not followed. The inspected script did not contain an acquisition ID, `fbclid` or `reference_number` carrier. The precise gap is provider-preserved transaction linkage, not an absence of all landing UTM handling. Neither this public source check nor appended query parameters prove provider retention.

## Contract and privacy

The server creates a random opaque acquisition ID only after purpose-bound consent. A minimal landing record binds it to the server-authorized tenant, DEMAND product, internal BROS SELL pilot, Preview environment and event time. Optional allowlisted campaign/source/ad labels remain in that private record. They are untrusted source observations, never proof of Meta delivery or click ownership. Raw click IDs, buyer details, full landing/referrer URLs, cookies, JWTs and provider credentials are excluded from this contract.

A short-lived HMAC ticket binds the immutable landing record to scope and expiry. It is a temporary transfer credential. Keep it out of URLs, analytics, logs, provider requests, PR comments and persisted evidence; it is not a BCI receipt. The key is supplied by a trusted server adapter and must be independent of provider credentials. This library creates or configures no runtime secret. No public route imports it.

Checkout preparation validates the signature, exact trusted record, current scope, chronology and expiry, and requires an explicit empty existing merchant reference. It also requires the trusted server adapter to explicitly identify the channel as `api_payment_request`; `store_checkout`, POS, generic payment links and missing channel are rejected. This is a fail-closed contract check, NOT provider authentication: BCI/SELL must independently verify the actual checkout channel. HitPay order #1007 was returned as `store_checkout` and cannot be backfilled or treated as proof of Payment Request reference support. Its provider projection contains only the opaque `reference_number`. Do not overwrite an order/invoice reference or merge the entire ticket into an API payload. A provider echo can form only an unverified request-binding candidate. It cannot attest payment, settlement, entitlement, attribution or a business outcome.

## Ownership and integration handoff

| Owner | Responsibility before activation |
| --- | --- |
| DEMAND | This product contract, source classification, expiry/scope validation and privacy-minimized candidate projection. |
| BCI / Neon core | Existing authenticated membership, tenant/product isolation, durable landing/request mapping, atomic consumption/idempotency, conflict rejection, signed provider evidence, retention/deletion and independent replay. No parallel database or new evidence writer is introduced. |
| BROS SELL checkout owner | Separately reviewed landing and checkout adapter, CSRF/origin controls, trusted server clock, consent capture/revocation, reference compatibility and approved provider environment. Preserve pricing, fulfilment and entitlement rules. |
| CONTENT | Publishing, assets and content workflow remain CONTENT-owned. No publisher dependency or change is required by this contract. |

BCI must atomically claim the acquisition/checkout intent before any provider creation. Retrying must return the same stored request or a conflict; a pure function cannot consume a ticket or prevent replay. Bind the exact provider request ID and echoed reference to the immutable landing record. Never match an order by amount, date, UTM label or email. Current consent must be rechecked before each use and any future attribution read; revocation must disable reuse and follow the existing retention/deletion policy. Ticket expiry is not a data-retention policy.

Until BCI defines and enforces an approved retention period, do not persist real acquisition records through this new contract. Use synthetic records in tests. No new SQL tables, migrations, grants, credentials, environment variables or provider permissions are part of this change.

## Required provider-backed acceptance

1. Review the adapter with the BCI and SELL owners and choose an approved non-production provider surface. Confirm compatibility with any existing merchant order reference. No payment creation is authorized by this library.
2. Verify authenticated tenant/product access, purpose-bound consent and revocation, CSRF/origin controls, atomic one-time mapping and cross-tenant/conflict negatives through the existing BCI services.
3. Independently observe the opaque reference echoed by a real approved provider create/status operation and a valid signed `payment_request.completed` event. Bind exact request/payment identities, amount, currency, live/test environment and product using trusted server evidence. Browser redirects and a caller-supplied `verified` flag are insufficient.
4. Read the durable BCI evidence back independently, replay safely, and separately verify paid/refund state, payout allocation, entitlement and the controlled experiment outcome before any acceptance or verified CPA/CAC/ROAS claim.

Do not backfill an acquisition ID onto historical #1007 and infer attribution. HYPD/Supermetrics retirement still requires provider-backed equivalence. Local tests and CI verify contract behavior only. No manual Preview deployment is needed for this unexposed library; any Git-triggered Preview build remains build evidence only.
