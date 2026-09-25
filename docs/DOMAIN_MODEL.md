# BROS Commercial Intelligence — Domain Model

## Design objective

Keep the domain model small enough to support the first intelligence loop without prematurely committing BCI to a general BI platform.

## Core entities

### Evidence
A traceable observation or source-derived input.

Minimum conceptual fields:
- id
- source
- captured_at
- subject
- content/value
- provenance
- confidence/context

### Signal
A meaningful pattern or change derived from one or more evidence items.

Relationships:
- one signal may reference many evidence items
- signal status
- significance/rationale

### Case
A bounded commercial question requiring investigation.

Relationships:
- case may originate from one or more signals
- case references relevant evidence
- case has a current status and owner

### Diagnosis
A structured interpretation of a case.

A diagnosis should distinguish:
- observed facts
- hypotheses
- supporting evidence
- contradicting evidence
- unresolved uncertainty

### Decision
A documented choice made in response to a diagnosis.

Minimum conceptual fields:
- decision
- rationale
- evidence
- assumptions
- decision date
- decision owner

### Action
A concrete follow-through from a decision.

### Outcome
The observed result of an action.

### Learning
A reusable conclusion derived from the outcome and its supporting evidence.

## Lifecycle

Evidence
→ Signal
→ Case
→ Diagnosis
→ Decision
→ Action
→ Outcome
→ Learning

The lifecycle is not required to be strictly linear. Evidence may be added later; cases may be reopened; diagnoses may change when evidence changes; outcomes may create new signals.

## Fact/inference boundary

BCI must preserve the distinction between:

1. **Observed** — directly supported by evidence.
2. **Inferred** — interpretation derived from evidence.
3. **Decided** — an intentional choice made by an operator.
4. **Observed outcome** — what happened after action.

The system should never present an inference as if it were an observed fact.

## Initial persistence strategy

The first implementation should use a relational model with explicit provenance and timestamps.

Avoid:
- opaque composite scores;
- untraceable AI-generated conclusions;
- excessive normalization before actual usage establishes the need;
- predictive models before sufficient validated historical data exists.
