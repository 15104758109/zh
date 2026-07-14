# R4 Execution Handoff

Use this handoff only with `docs/MVP_TASK_INDEX_R4.json`. R3, G07, G04 revision 2, and the 85-task index are historical/frozen and cannot select work.

## Objective

In `D:\zhreplan` on `autonomy/integration`, complete the local Web single-chapter MVP against the existing n8n and PostgreSQL. Stop only for `CREATOR_REQUIRED`, `ENVIRONMENT_APPROVAL_REQUIRED`, a hard budget stop, or a critical-path technical blocker. Do not merge `main`, push, use cloud services, deploy production, or create containers.

## Dispatch Rules

1. Dispatch only a `READY` top-level R4 Task.
2. Create the business Task as an independent Codex task with `gpt-5.6-terra` and the indexed reasoning effort. Record `actual_model` only from platform metadata.
3. The main Task agent may use up to four distinct internal subagent sessions across implementation and acceptance, with no more than three active concurrently. They are work packages, not product Tasks.
4. Internal subagents cannot create Tasks, replan, edit the Task Index, or change formal database semantics. The main Task agent integrates the result, but it cannot override a required non-author acceptance verdict.
5. Ordinary defects remain in the same business Task. Do not create repair, screenshot, contract, lint, or ordinary audit Tasks.
6. Only B4, B6, B8, and MVP-GATE receive independent deep review.
7. Database changes and n8n runtime imports are serialized by the Orchestrator.
8. `WEB-STATIC-RESTORE` uses exactly one dedicated `VISUAL_ACCEPTANCE_AUDITOR` after all builders are idle. It edited none of the nine pages, opens every source and target directly, owns the complete eighteen-pair matrix, and fails closed on missing or invalid evidence.
9. For `B1` through `B8`, use distinct `N8N_WORKFLOW_IMPLEMENTER`, `DATA_INTEGRATION_IMPLEMENTER`, `BUSINESS_ACCEPTANCE_AUDITOR`, and `USER_OPERATION_AUDITOR` sessions. The parent owns Web integration; the two implementers may run beside it, then the two auditors run after integration. Do not let an implementer self-audit or promote these roles into top-level Tasks.

## First Task

Start `WEB-STATIC-RESTORE` as one parent Task. The parent owns routes, App Shell, shared CSS/tokens/components, local assets, and integration. After foundation is stable it may create the three page-group work packages registered in the index. When all builders are idle, start exactly one dedicated read-only visual auditor for all nine pages at `1440x900` and `1280x720`; do not split the audit by page group. A route/state/console pass or the parent's own screenshot review is insufficient. Any non-`PASS` stays inside the same Task for the single integrated repair and same-auditor recheck.

After static restore, execute `B1`, then `B2` and `B3` in parallel, then `B4` through `B8` by dependency, followed by `MVP-GATE`.
