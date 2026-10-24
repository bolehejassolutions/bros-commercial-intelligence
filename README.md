# BROS Commercial Intelligence (BCI)

Independent internal application for BROS.

## Purpose

BROS Commercial Intelligence is the internal intelligence and decision-support layer for the BROS ecosystem.

It is intentionally independent from customer-facing products such as BROS SELL™ — Closing OS.

## Core model

Evidence → Signal → Case → Diagnosis → Decision → Action → Outcome → Learning

## Boundary

- Internal application
- Not a customer-facing product
- Not a replacement for BROS SELL™
- Not a generic BI dashboard
- Not a CRM
- Not a premature V2 feature set for BROS SELL™

## Initial direction

BCI should help BROS understand commercial conditions, diagnose meaningful problems, support decisions, and capture learning across the ecosystem.

## Repository status

Architecture bootstrap / initial implementation.

## Portfolio boundary — BROS CONTENT and BROS DEMAND

Owner-approved 2026-10-25: BROS CONTENT™ and BROS DEMAND™ are separate products with product-specific intelligence built on reusable BROS Commercial Intelligence services. **This repository remains an internal BCI application**, not a public/customer-facing shared service. Do not expose BCI internals to tenants or infer live provider/spend activation from deployed code.

See [Portfolio shared intelligence contract](docs/PORTFOLIO_SHARED_INTELLIGENCE_CONTRACT.md) and the [Primary Drive product-architecture decision](https://docs.google.com/document/d/1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM/edit). Customer-facing extraction is gated by product independence, tenant security, verified attribution and explicit production/financial approvals.
