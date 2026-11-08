# BROS Business OS — read-only evidence bridge (isolated development contract)

This is an **internal-only**, pure data-projection module under BCI's existing shared intelligence contract. It is NOT a deployed endpoint, ChatGPT MCP server, authorized API, or live provider connector. There are no credentials, production changes or provider mutations.

## Why it exists

The existing private BROS Business OS plugin v0.3.3 has four accepted advisory Skills, but **no bundled server or account-action integration**. The next safe integration milestone is to define and test exactly what a future authenticated service may disclose to those Skills, without exposing internal BCI administrative schemas or cross-tenant data.

The module at `lib/bci/assistant-evidence-bridge.ts` accepts scoped, trusted evidence rows and returns bounded, strictly allowlisted, source-stamped receipts. It never processes commands, publishes content, manipulates ads, or computes unverified ROAS.

## Critical security boundary

**This module is not an authentication mechanism.** A production caller must first authenticate the user using a reviewed provider, validate authoritative org/tenant membership and product permission **server-side**, then independently restrict the database query to the same tenant/product. Never take `identityVerifiedByServer`, `tenantMembershipVerifiedByServer`, tenant IDs or role scopes from an untrusted user input. The function's scope guard is defense in depth only. Do not bind this directly to an HTTP route, an arbitrary SQL query, a customer tool call or `service_role` admin data.

Before any endpoint/MCP integration, additionally require reviewed credential storage, token revocation, negative cross-tenant HTTP tests, permission scopes, rate limits, logs and explicit release approval. Do not connect private customer records during the contract phase.

## Contract semantics

- Every receipt contains source provider, reference, event/collection time, reporting window and completeness. Unknown numeric values remain `null`, not zero.
- Only `content` or `demand` product evidence can be projected. BROS SELL is a separate operating product; its DEMAND experiments can use appropriately scoped DEMAND receipts only.
- Unknown or absent receipt rows produce `NO_ROWS_NOT_ZERO`.
- Metrics are allowlisted; arbitrary internal metadata, raw observed text, query-style secret-bearing URLs and customer payloads are excluded. Upstream server adapters must separately validate source references and secrets.
- Tracking Purchase events are never automatically treated as settled or ad-attributed orders; ROAS must be independently reconciled.

## Local tests

Run: `node --experimental-strip-types --test tests/assistant-evidence-bridge.test.mjs`

Source decisions: [Primary Drive approved BROS architecture](https://docs.google.com/document/d/1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM/edit) and [portfolio shared intelligence contract](PORTFOLIO_SHARED_INTELLIGENCE_CONTRACT.md).


## DEV-only authenticated request adapter — PR #40 follow-on

`lib/bci/assistant-evidence-authenticated-read.ts` now contains a **non-routed**, injectable HTTP request contract for a future private BROS Business OS evidence tool. This is a synthetic DEV security harness, not live authentication and not a deployed endpoint. It has no configured token verifier or database repository.

Its enforced sequence is:

1. Reject every non-`GET` method; additionally deny when `NODE_ENV=production`.
2. Parse an exact allowlisted path with **one** tenant and one `content`/`demand` product selector; reject arbitrary actor/role fields, unexpected query keys and duplicate selectors.
3. Require a bearer credential **and invoke a trusted, server-injected verifier**. An unchecked JWT claim, client-supplied `user_id`, or inferred user metadata is never accepted as authentication.
4. Check the verified subject's expiration, then require a separate **authoritative server-injected membership and product-grant decision** for that exact tenant and product.
5. Ask an independent scoped repository to read a maximum of 20 receipts for the same tenant/product. Filter the returned rows a second time with the existing safe projection.
6. Return only allowlisted evidence metadata/metrics, with `Cache-Control: private, no-store`, without broad CORS access. Return generic 401/403/503 errors without raw backend diagnostics or access tokens.

`tests/assistant-evidence-authenticated-read.test.mjs` exercises this with synthetic identities, grants and data. Cases cover missing/revoked/expired tokens, grant rejection before reads, tenant/product spoofing and wrong-scope rows, malformed selectors, method rejection, provider failures, cache controls, limited reads and secret redaction. Test success proves the injected contract's fail-closed behavior in the CI fixture, **NOT a real IdP cryptographic check, live tenant membership, actual DB RLS, authenticated HTTP endpoint or ChatGPT plugin integration**.

**Required next implementation gates (unchanged):** wire a reviewed independent session verifier and authoritative membership store, use a restricted SQL role/session and database-level tenant/product predicates, prove negative tests against the actual DEV provider and HTTP boundary, decide provider consent and token revocation, and obtain release approval. Do not publish a route, grant table permissions, expose admin SQL or connect customer data as part of this PR.

## Scoped repository result-size contract (8 Nov 2026)

The non-routed DEV handler now fails closed with generic `503 read_unavailable` if an injected repository returns more than 20 rows, rather than silently truncating the result and implying that a potentially unbounded query was valid. Exactly 20 rows remain allowed. This is defense in depth, **not** proof of a database `LIMIT`, SQL tenant/product predicates, or database RLS. The repository must still enforce all three independently using a restricted role; synthetic boundary tests cannot certify real Neon isolation. No HTTP route, grant or provider was activated.
