# MVP Implementation Plan R4

## Status

- Plan: `APPROVED / ACTIVE`
- Active index: `docs/MVP_TASK_INDEX_R4.json`
- Initial state: `1 READY / 9 PLANNED`
- Ready task: `WEB-STATIC-RESTORE`
- Product: local Web + existing n8n + existing PostgreSQL
- Prohibited: merge to `main`, push, cloud, production deployment, or new containers

R4 replaces the R3 execution plan. R3, G07, G04 revision 2, and the 85-task index remain readable only as historical mapping evidence. Their unfinished tasks are not eligible for dispatch.

## Two-Level Execution

The Orchestrator dispatches only the ten top-level records in the R4 index. A business Task owns one demonstrable user result and may create two or three internal work packages when their write scopes do not overlap.

Internal subagents:

- are not product Tasks and do not enter the Task state machine;
- cannot create Tasks, replan the product, or change formal database semantics;
- modify only their assigned directories;
- return changed files, tests, screenshots, and blockers to the main Task agent;
- leave integration, runtime writes, acceptance, and the final result to the main Task agent.

Ordinary bugs stay inside the original Task and allow at most one repair pass. Screenshot capture, contract updates, test additions, and ordinary acceptance are Task work, not standalone Tasks.

## Task Sequence

| Task | User result | Dependencies | Review |
|---|---|---|---|
| `WEB-STATIC-RESTORE` | Nine real routes visually restore the prototypes with static interactions | none | one integrated visual acceptance |
| `B1-CREATE-DRAFT-BOOK` | Create, view, and enter a draft book | Web static restore | in-task acceptance |
| `B2-WORLD-SETTINGS` | Generate, edit, save, and view world candidates/versions | B1 | in-task acceptance |
| `B3-CHARACTER-SETTINGS` | Generate, edit, save, and view characters/relations/memory candidates | B1 | in-task acceptance |
| `B4-FINALIZE-BOOK-DESIGN` | Generate/review/lock L1A and atomically formalize the complete design | B2 + B3 | critical SQL review |
| `B5-CHAPTER-PLAN` | Materialize one scene package, approve presentation, and save one execution plan | B4 | in-task acceptance |
| `B6-DEDUCTION` | Start, pause, resume, complete, review, and lock one deduction | B5 | FP008 isolation review |
| `B7-LITERARY-PRESENTATION` | Generate one candidate prose version from locked facts | B6 | in-task acceptance |
| `B8-AUDIT-AND-COMMIT` | Audit, decide, enhance, release, and atomically commit one formal chapter | B7 | P0 and critical SQL review |
| `MVP-GATE` | Complete the full local browser journey | B8 | independent gate runner |

`B2` and `B3` are the only initial cross-Task parallel pair. Within a large Task, the main agent may use up to three disjoint internal subagents. Database migration/application, n8n import/activation, and shared Web shell integration stay serial.

## Static Restore

`WEB-STATIC-RESTORE` owns the App Shell, router, local fonts/assets, design tokens, shared components, and all page directories until its acceptance is complete.

1. The parent agent establishes runnable `dev`, `build`, and browser-test commands, then freezes ownership of shared files.
2. At most three internal page subagents restore their assigned page groups without editing shared files.
3. The parent integrates all pages, performs one browser traversal, fixes shared layout/navigation once, and captures `1440x900` and `1280x720` screenshots.

The prototype and fixed screenshots are the visual facts. The executable page entries in the R4 index define only regions, routes, states, and interactions that screenshots cannot express. Static restore uses `static_mock`; PostgreSQL, n8n, and real model calls are explicitly outside this Task.

## Business Boundaries

- `B1` creates a draft `t_book_projects` shell only. It does not formalize world, character, relation, memory, or L1A data.
- `B2` and `B3` own editable candidate/version results.
- `B4` is the separate formal state transition. It promotes selected world, character, relation, memory, and L1A versions in one PostgreSQL transaction and freezes their lineage.
- `B5` produces and preserves one `scene_condition_package_version` through all downstream Tasks.
- `B6` is the only high-code exception. Per-particle role inputs are physically isolated and recalled memory is rechecked in PostgreSQL.
- `B7` changes expression only, never deduction facts.
- `B8` excludes FP011 and FP012-03. The third N becomes `abandoned_by_user`; only a P0-clear, fact-preserving, change-limited, nonempty-summary `released` candidate can enter the formal transaction.

The minimum FP016/FP017 support required by the chain is local operator identity, active model configuration, and budget. The remaining FP014-FP017 platform work is post-MVP.

## Default Verification

Ordinary business Tasks run only the tests needed to demonstrate their main browser journey, PostgreSQL rules, n8n path, and failure rollback. The default chain does not require generic migration tamper tests, generic contract-center checks, generic n8n security scans, or multi-round Coder/Auditor/Reviewer loops.

Deep independent review is reserved for B4, B6, B8, and the final Gate. No review may invent requirements outside the R4 acceptance or V7 anchors.
