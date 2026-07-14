# S1-NEW-BOOK-PAGE final business audit

Verdict: **PASS**

`local_main_merge_allowed=true`

Audit target: current uncommitted working tree at `6d1f6cb71eff047fcd24675114243891b07dfe58`.

## Scope and result

- Tested `http://127.0.0.1:4176/books/new/` in real browser viewports of 1440x900 and 1280x720.
- Normal state shows draft semantics, empty chat history, recognisable fallback icons, and no fabricated AI transcript.
- `?state=returned` preserves editable role/world controls; `?state=restored` preserves the draft; `?state=disabled` makes all 12 workspace controls natively disabled with `aria-disabled=true`.
- Final review initially renders only `尚未执行 AI 综合分析，暂无分析结果。`. Clicking AI comprehensive analysis fail-closes to `BLOCKED` and does not create conclusions.
- Sidebar was clicked by real pointer: root class and computed widths/margins were `228px -> 62px -> 228px`; toggle top is `24px`, labels/titles and icons change correctly, and its button click is actionable. It has no geometric overlap with brand, separator, or first menu boundary.
- Unit page regression: `node --test tests/pages/new-book/new-book.test.mjs` passed 5/5.

## Real creation chain

The page's real `开始创作` action posted through the current `/webhook/create_book` route and completed with:

- `book_id`: `ed9fc464-a7c0-496c-ad1f-402cad58137a`
- `idempotency_key`: `0a956eda-5405-4572-8e95-734d2c6e248d`
- PostgreSQL before cleanup: one `t_book_projects` row (`苍穹纪事`, `design`), 16 `t_world_assets`, 3 `t_character_profiles`, and 9 `t_segment_promises`.
- Browser completion state named the same book ID; `/workbench` then displayed `苍穹纪事` as both selected and header book.

Cleanup ran in one PostgreSQL transaction with the repository's controlled `SET LOCAL zh.bypass_rpc = 'true'`, scoped to that exact book ID and idempotency key. After commit, the book row and all 24 direct `book_id` foreign-key child tables were zero for the audit book.

## Screenshots

All screenshot bytes are unmodified browser output. The workbench browser reports CSS viewport 1440x900; its emitted JPEG excludes the scrollbar strip and has the recorded native dimensions below.

| File | URL/state | Actual pixels | SHA-256 |
|---|---|---:|---|
| `normal-1440x900.jpg` | `/books/new/` normal | 1440x900 | `dc428749edd5d217973090a5524a825d6aed988f94864fa888aaf5f38bacaab4` |
| `returned-1280x720.jpg` | `/books/new/?state=returned` | 1280x720 | `d94098adcce50863f242185ac2ebd7c3d8bd768aa4e0a1303411e4be76c5d4b9` |
| `restored-1280x720.jpg` | `/books/new/?state=restored` | 1280x720 | `e9cee1a0ae39ea57575cab186666ce22b8f0aeddacae91ba274c5ad0d3e84451` |
| `completed-1440x900.jpg` | `/books/new/?state=completed` | 1440x900 | `4328002e18b13c5e9c28c3488a367a0043ee5e29572858e1f8ebdbb11a39c564` |
| `workbench-context-1440x900.jpg` | `/workbench` after real creation | 1425x891 | `bbff3d1c14b4ab07beb9ea74f842f83b96f13a0aa7f83481e8bbd88df9def80f` |

## Findings

No P0, P1, or P2 findings.

