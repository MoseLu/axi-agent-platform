# CONSOLIDATE-001: Small Backend Merge Criteria

**Status:** Accepted on 2026-09-20
**Decision driver:** PHASE-5 BFF-MERGE-004 / GATEWAY-VERIFY-005 work
**Related ADRs:** ADR-005 (Agent BFF ownership), ADR-006 (gateway taxonomy)

## Context

After merging the Agent BFF into the FastAPI backend per ADR-005, we need clear
criteria for when a small backend (BFF, proxy, aggregator) should be merged
versus retained as a separate service.

## Policy

A small backend SHOULD be merged into a parent FastAPI service when ALL of the
following conditions are met:

### Merge Criteria (all must be true)

1. **Same bounded context.** The backend and the target FastAPI service share
   the same data owner, auth boundary, and release cadence.

2. **Single consumer or single ownership chain.** The backend serves exactly
   one frontend/client, or all consumers are owned by the same team.

3. **No independent data store.** The backend does not maintain its own
   database, cache, or persistent state that would survive the merge.

4. **No independent auth boundary.** The backend does not perform its own
   authentication/authorization that would be lost on merge.

5. **No separate deployment requirement.** The backend does not need independent
   scaling, canary releases, or runtime isolation for safety reasons.

6. **DTO contract preservable.** The merge can preserve the existing API
   contract without breaking consumers.

7. **Cost of two services exceeds benefit.** The operational overhead (two
   ports, two health endpoints, two failure domains) is not justified by
   the independence.

### Merge is NOT appropriate when (any one is true)

- A second consumer (CLI, mobile, third-party) needs the backend independently
- The backend has its own data store or persistent state
- The backend performs independent auth/tenant isolation
- Independent scaling or canary deployment is required
- The backend and FastAPI have divergent release cadences
- Rollback cost is acceptable and independence provides value

## Decision

Merge small backends into parent FastAPI services when all 7 merge criteria are
met. Reject merge proposals when any "NOT appropriate" condition is true.

### Merge procedure

1. Verify all 7 merge criteria are satisfied
2. Preserve the existing API DTO contract field-for-field
3. Add route-level integration tests before deleting the old backend
4. Archive the old backend directory (do not delete - retain for Git history)
5. Update any consumer references to point to the merged endpoint
6. Mark the old project as deprecated in workspace.graph.json
7. Verify end-to-end with browser smoke test or integration test

## Consequences

- Smaller operational surface (fewer services to monitor, deploy, debug)
- Single failure domain for the bounded context
- Easier cross-cutting changes (auth, logging, monitoring)
- Risk: coupling within the bounded context (mitigated by contract preservation)

## Completion evidence

- [x] CONSOLIDATE-001 policy written
- [x] ADR-005 BFF merge completed as first application
- [ ] Policy applied to identify next consolidation candidate
