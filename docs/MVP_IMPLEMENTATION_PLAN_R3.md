# MVP Implementation Plan R3

## 1. Candidate status

- Plan revision: 3
- Base commit: 5e7e4caa2d4bf20d098bc44f80c9678cf1715a89
- Plan status: CANDIDATE_PAUSED
- Execution status: PAUSED_BY_CREATOR
- Task state: 0 READY, 19 PLANNED
- Selected task: none
- Approval effect: this document does not approve G04 or G07 and does not authorize product execution.
- Historical sources: G04 revision 2, G07 R2/V11, and the 85-task IMPLEMENTATION_CONTROL index remain historical evidence only. They are not an active execution index after R3 is adopted.

The creator explicitly requested that the Task plan be simplified and then paused. Therefore every R3 Task remains PLANNED after this candidate is produced. A later creator decision and governance activation are required before F0-05-PG-RUNTIME-GUARDS or F0-06-N8N-PRODUCTION-BASE can become READY.

## 2. Creator decision translated into delivery rules

The MVP is one browser-based Web product. Native mobile applications and native desktop applications are outside product scope and are never acceptance dependencies.

The production path is deliberately small:

1. apps/web provides the operator-facing business interface.
2. n8n owns workflow sequencing, model calls, retries that are explicitly required by V7, and calls to PostgreSQL functions.
3. PostgreSQL owns transactions, authoritative facts, locks, idempotency, and formal writeback.
4. apps/api is optional thin security glue only when a browser cannot safely hold a secret, CORS cannot be handled by the deployed edge, or streaming requires a server hop. It may not contain a business state machine.
5. Internal workflow payloads remain simple JSON. Generic gateways, event platforms, orchestration DSLs, broad recovery frameworks, and general-purpose governance are not prerequisites for MVP.
6. FP008-02 deduction runtime is the only high-code exception. Every other vertical is a minimal Web + n8n + PostgreSQL stitch.

The MVP proves the V7 single-chapter business journey through the operating interface. Code optimization, generalized frameworks, unreachable edge hardening, and features not required by V7 are not release blockers; they are recorded in FEATURE_CANDIDATES.md.

## 3. Baseline capabilities, not R3 Tasks

The base commit already contains local candidate implementations that R3 may depend on:

| Capability ID | Local capability | R3 meaning |
|---|---|---|
| BASELINE::REPOSITORY | repeatable repository scripts and build shell | input capability, not an R3 VERIFIED claim |
| BASELINE::CONTRACTS | shared contract registry | extend only within the owning vertical |
| BASELINE::PG_FOUNDATION | PostgreSQL migration foundation | migration substrate, not completed business schema |
| BASELINE::LOCAL_OPERATOR | local operator bootstrap and scope | local-only MVP identity boundary |
| BASELINE::N8N_LINT | reference workflow lint | baseline checker, not proof of production workflow behavior |
| BASELINE::WEB_SHELL | browser operational shell and visible states | Web entry capability; no native client implication |
| BASELINE::INTERACTION_CONTRACTS | interaction contract checks | baseline checker, not a separate platform project |

These capabilities are intentionally not represented as completed R3 Tasks. Their source commits and local evidence remain independent of this paused plan.

## 4. Shortest dependency path

After explicit activation, F0-05-PG-RUNTIME-GUARDS and F0-06-N8N-PRODUCTION-BASE may run concurrently because their write scopes do not overlap. F0-07-RUNTIME-SEEDS waits for both. The remaining path is:

F0-07-RUNTIME-SEEDS -> S1-CONFIG -> S1-OPEN-BOOK -> (S2-WORLD in parallel with S2-CHARACTERS) -> S2-L1A -> S3-PRODUCTION-START -> S3-CHAPTER-PLAN -> S3-EXECUTION-PLAN -> S4-INFO-PACKAGE -> S4-DEDUCTION-RUNTIME -> S4-DEDUCTION-REVIEW -> S5-PROSE -> S5-OBJECTIVE-AUDIT -> S5-EDITOR-REVISION -> S5-FORMAL-WRITEBACK -> MVP-GATE

There is no FP011 dependency after prose. Reader-experience and commercial suggestions are post-MVP candidates.

## 5. Vertical delivery shape

Every ordinary business vertical must deliver all of the following in its own exact name scope:

- apps/web/src/features/<name>/** for the real browser operation.
- orchestration/workflows/<name>/** for an importable production n8n workflow.
- db/migrations/*__<name>__*.sql and/or db/functions/<name>/** for authoritative data and transactions.
- packages/contracts/src/<name>/** for the minimum request, result, state, and error JSON contracts.
- tests/vertical/<name>/** for contract-level operation from the Web-visible business path.

Only S4-DEDUCTION-RUNTIME may additionally use apps/api/src/glue/deduction-runtime/**, and only for secrets, CORS, or streaming transport. Business states and transitions remain in PostgreSQL and n8n.

The MVP must not create physical world_binding or world_knowledge_entry tables. Their V7 second-phase semantics remain deferred. FP008-02 may use the minimum pgvector memory index needed for character memory retrieval, but every recalled row must be rechecked against PostgreSQL is_valid authority before model input. This does not authorize an S7 general vector platform.

## 6. Business corrections fixed in R3

- S1-OPEN-BOOK excludes FP001-05 commercial scoring.
- S2-L1A excludes FP004-05 variants and health recommendations.
- S4-INFO-PACKAGE emits only lightweight whole-chapter grains. It does not pre-build char_tasks.
- S4-DEDUCTION-RUNTIME implements FP008-02 F1 by generating char_tasks per grain at runtime.
- S5 excludes FP011 reader-experience and commercial advice.
- S5-EDITOR-REVISION follows V7 directly: the third N ends as abandoned_by_user. There is no manual_required state and no human-recovery feature in MVP.
- S5-FORMAL-WRITEBACK is the only formal chapter writeback path and preserves PostgreSQL atomicity.

## 7. Concurrency and integration

- At most two Coders may edit concurrently, and only with closed dependencies and disjoint write scopes.
- Integration merges are serial.
- DB_WRITE capacity is one.
- N8N_RUNTIME_WRITE capacity is one.
- A normal MVP Task needs one fresh independent business Auditor. The Auditor accepts the contracted interface behavior, not optional code optimization.
- A separate Reviewer is added only for critical SQL, FP008-02, or a control-contract change.
- Any new business function discovered during implementation is not silently added. It is recorded as a candidate unless V7 cannot be implemented from the contract; in that case the contract issue returns for global R3 consideration.

## 8. Acceptance boundary

Task acceptance is the contracted business operation visible through the Web interface, including its required success, rejection, retry, and persisted state. It does not require native viewport products, generalized infrastructure, speculative APIs, or refactoring that does not change the MVP business result.

MVP-GATE runs one browser journey from local configuration and book creation through one atomic formal chapter writeback. It confirms PostgreSQL truth, the associated n8n execution, failure rollback, and visible state. Passing the gate creates only a local MVP candidate. Main merge, push, cloud deployment, production deployment, and R0 release remain CREATOR_REQUIRED.

## 9. Model and budget record

The R3 planning task records profile MODEL::REASON_HIGH. The actual model is inherited from the root session and is unverified. Reasoning effort is high. Fallback selection belongs only to the Orchestrator. Budget is UNCONFIGURED. No claim is made that the subagent model changed.

For future implementation routing, S4-DEDUCTION-RUNTIME alone requests MODEL::CODE_HIGH. Other implementation Tasks request MODEL::CODE_MEDIUM. Model selection cannot change V7 anchors, Task schema, acceptance, or business contracts.

## 10. Pause and next governance action

The read-only command node tools/mvp-plan.mjs check validates this candidate. status and dry-run must both report PAUSED_BY_CREATOR, zero READY Tasks, and selected_task null. The tool has no start, lease, transition, or state-write operation.

After this R3 candidate is reviewed, the creator may approve, reject, or revise it. Until an explicit activation is recorded in a new governance Gate, no product Task may start.
