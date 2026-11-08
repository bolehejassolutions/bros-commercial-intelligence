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
