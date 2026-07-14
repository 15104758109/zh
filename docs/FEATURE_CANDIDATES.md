# Feature Candidates After MVP

This register prevents postponed work from leaking into the fastest V7 MVP. Inclusion here is not approval, scheduling, or a release commitment. Every entry needs a later creator decision before it can enter a Task Index.

## V7_POST_MVP

### CAND-V7-FP001-05

Commercial scoring during book creation. It is present in V7 but is not required to create and operate the first book.

### CAND-V7-FP004-05

L1A variants and mainline health recommendations. The MVP locks one usable L1A path without variant advice.

### CAND-V7-FP011

Reader-experience and commercial suggestions after prose. These suggestions cannot block the objective audit, editor route, or formal writeback in MVP.

### CAND-V7-FP012-03

Second-rejection comparative gap analysis and richer revision guidance. MVP keeps the direct V7 rejection loop and terminates the third N as abandoned_by_user.

### CAND-V7-FP014

Sample-driven optimization experiments, candidate evaluation, and configuration promotion.

### CAND-V7-FP015

User-managed skill lifecycle, preferences, cleanup, evaluation, and optimization. MVP uses seeded active built-in skills only.

### CAND-V7-S6-CONTINUITY

Cross-chapter and long-horizon continuity campaigns beyond the one-chapter MVP gate.

### CAND-V7-S6-EXPORT

Book and production export workflows beyond the first formal chapter stored in PostgreSQL.

### CAND-V7-S7-FULL-BOOK-GOVERNANCE

Multi-L1A automation, full-book fault campaigns, full-book continuity, and long-run governance.

## OUTSIDE_V7

### CAND-OUTSIDE-GENERIC-MODEL-GATEWAY

A reusable multi-provider model gateway. MVP workflows may call their configured model through minimal n8n nodes and must not first build a platform gateway.

### CAND-OUTSIDE-PROMPT-GOVERNANCE

A general prompt registry, release train, binding platform, and prompt-governance workflow. The MVP uses the approved prompt material directly through task-owned n8n workflows.

### CAND-OUTSIDE-GLOBAL-RECOVERY

A cross-workflow recovery coordinator. MVP implements only V7-required local retry/checkpoint behavior in the owning vertical.

### CAND-OUTSIDE-INTERACTION-DSL

A generalized interaction language or UI state DSL. MVP uses task-local Web interactions and the existing lightweight contract checker.

### CAND-OUTSIDE-TEST-PLATFORM

A general testkit or fixture platform. MVP Tasks keep focused vertical tests and reuse the current repository test tools.

### CAND-OUTSIDE-GENERIC-SENSITIVE-TOKEN-AUDIT

A general sensitive-action or token inspection platform. MVP keeps secrets out of the browser and uses narrow glue where required.

### CAND-OUTSIDE-ADVANCED-BUDGET-COST

Shared reservation accounting, advanced token budgets, cost analytics, and long-run cost governance. MVP retains only the V7 runtime limit needed to stop one deduction safely.

### CAND-OUTSIDE-GENERIC-VECTOR-RECONCILER

A general vector lifecycle contract, reconciler, and global asset indexing service. FP008-02 may build only its minimum pgvector memory lookup with PostgreSQL is_valid recheck.

### CAND-OUTSIDE-EXTERNAL-AUTONOMY-TRUST

External Ed25519 receipts, a monotonic event head, and autonomous platform trust infrastructure. These are governance-platform concerns and are not product MVP dependencies.

### CAND-OUTSIDE-NATIVE-CLIENTS

Native mobile and native desktop applications are not in the product scope. They are not alternative MVP deliverables and are never an acceptance dependency. A future product decision would be required even to consider them.

### CAND-CODE-F0-11-SAME-SEED-CONCURRENCY

Post-MVP code hardening for same-seed concurrent test fixtures. This is a quality candidate, not a missing V7 business function.

### CAND-CODE-WEB-COMPOSITE-KEY-HARDENING

Post-MVP code hardening for composite-key handling in the Web projection shell. This does not block the contracted single-operator MVP path.

## Candidate handling rule

Candidates may be evaluated together after the local MVP gate. They must not be pulled into a product Task because an Auditor prefers a more general architecture or because a code optimization is possible. Contract changes are reserved for cases where V7 implementation cannot reliably proceed from the documented business meaning and the correction requires a global decision.
