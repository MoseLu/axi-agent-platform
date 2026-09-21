# CONSOLIDATE-002: Service-Level Modularity Checklist

**Status:** Accepted on 2026-09-20
**Decision driver:** PHASE-5 BFF-MERGE-004 / GATEWAY-VERIFY-005 work
**Related ADRs:** ADR-005 (Agent BFF ownership), ADR-006 (gateway taxonomy),
  CONSOLIDATE-001 (merge criteria)

## Context

When evaluating whether a service is properly modular (or should be merged
per CONSOLIDATE-001), use this checklist to assess the current state and
identify required work items.

## Pre-Merge Checklist (all items required for merge approval)

### Ownership & Boundaries

- [ ] Service has exactly one data owner
- [ ] Service boundary aligns with bounded context
- [ ] No cross-context data dependencies
- [ ] Auth boundary is explicit and enforced

### Operational Surface

- [ ] Health check endpoint (`/health`, `/health/live`, `/health/ready`)
- [ ] Metrics endpoint (`/metrics`)
- [ ] Request ID tracing (X-Request-ID header propagation)
- [ ] Structured request/response logging
- [ ] Graceful shutdown handling

### Testing & Verification

- [ ] Route-level integration tests (not just unit tests)
- [ ] DTO contract tests (field names preserved)
- [ ] Behavior tests for error cases
- [ ] Empty state handling verified

### Deployment & Runtime

- [ ] Docker/Compose entry exists (if containerized)
- [ ] DevSvc profile configured (if local development needed)
- [ ] No hardcoded ports (uses configuration)
- [ ] Health check verified in running container

### Documentation

- [ ] README describes service responsibility
- [ ] API endpoints documented
- [ ] Environment variables documented
- [ ] Migration path to merged state documented (if deprecated)

## Service Classification

Use this classification to determine appropriate modularity level:

| Classification | Criteria | Appropriate Action |
|---|---|---|
| **Independent service** | 2+ criteria from "NOT appropriate" list in CONSOLIDATE-001 | Retain as separate service |
| **BFF/Aggregator** | Same context, single consumer, no own state | Candidate for merge |
| **Gateway/Proxy** | Cross-context routing, auth termination | Retain as separate service |
| **Worker/Cron** | Event-driven, no HTTP surface | Sub-service within owning project |

## Enforcement

- New service proposals must pass this checklist
- Merge candidates must satisfy ALL pre-merge items
- Incomplete services block merge approval until items are addressed
- Audit check: `workspace-audit.mjs` validates health/metrics presence

## Consequences

- Clear gating for service creation and merge decisions
- Reduced operational debt from underspecified services
- Faster incident resolution with proper health/metrics

## Completion evidence

- [x] CONSOLIDATE-002 checklist written
- [x] Applied to Go BFF → FastAPI merge (ADR-005)
- [ ] Checklist itemized in project TODO for next candidate review
