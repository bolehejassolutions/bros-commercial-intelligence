# BROS Commercial Intelligence — Architecture

## 1. System identity

**Name:** BROS Commercial Intelligence (BCI)

**Classification:** Independent internal application

**Primary role:** Internal commercial intelligence and decision support.

BCI operates across the BROS ecosystem rather than belonging to any single customer-facing product.

## 2. Relationship to BROS SELL™

BROS SELL™ — Closing OS is a customer-facing operational system.

BCI is an internal intelligence layer.

| System | Primary job |
|---|---|
| BROS SELL™ | Help customers execute selling systematically |
| BROS Commercial Intelligence | Help BROS understand, diagnose, decide, act, and learn |

BROS SELL™ may provide data to BCI. BCI may produce intelligence that informs BROS SELL™ strategy and future product decisions. Neither system should be structurally collapsed into the other.

## 3. Core intelligence loop

Evidence → Signal → Case → Diagnosis → Decision → Action → Outcome → Learning

### Evidence
Observed commercial information from authorised sources.

### Signal
A meaningful pattern, change, anomaly, or opportunity identified from evidence.

### Case
A bounded commercial question or situation requiring investigation.

### Diagnosis
Structured interpretation of the evidence and competing explanations.

### Decision
A documented choice about what should happen next.

### Action
An executable intervention or follow-up.

### Outcome
Observed result of the action.

### Learning
Captured evidence about what should be retained, changed, or tested next.

## 4. Initial functional boundaries

The initial BCI scope should remain narrow:

1. **Intelligence Intake** — bring authorised evidence into a common structure.
2. **Signal Detection** — surface commercially meaningful changes and patterns.
3. **Case & Diagnosis** — investigate bounded commercial questions.
4. **Decision Support** — structure decisions, assumptions, evidence, and actions.
5. **Learning Memory** — retain outcomes and reusable commercial learning.

## 5. Explicit non-goals

BCI is not initially:

- a CRM;
- a replacement for BROS SELL™;
- a customer-facing SaaS product;
- a generic analytics dashboard;
- a social-media content engine;
- a full data warehouse;
- an autonomous decision maker;
- a reason to expand BROS SELL™ scope before product validation.

## 6. Data principles

- Evidence should retain provenance.
- Inferences should be distinguishable from observed facts.
- Decisions should retain their rationale and supporting evidence.
- Sensitive/internal information should remain within authorised boundaries.
- BCI should prefer traceable, inspectable intelligence over opaque scoring.

## 7. Architecture principle

Keep BCI independently deployable and independently evolvable.

Integrations should occur through explicit interfaces and data contracts rather than by embedding BCI logic inside customer-facing applications.

## 8. Initial implementation sequence

1. Repository and architecture foundation
2. Internal application shell
3. Evidence/intake model
4. Signal and case model
5. Diagnosis and decision workflow
6. Learning/outcome capture
7. Authorised integrations
8. Verification and operational hardening

Scope should expand only when observed usage establishes a clear need.
