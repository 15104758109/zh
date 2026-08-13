# B1 Create Draft Book Evidence

Run deterministic contract checks:

```powershell
node --test tests/business/b1-create-draft-book/b1-create-draft-book.test.mjs
```

The suite verifies the canonical V7 FP001-07 PostgreSQL package in `db/install/v7-data-rpc-contract.sql`: `book_project`, formal world/character baselines, initial memory, candidate/unconfirmed L1A, writeback, and `product_request_log` must commit atomically. Invalid input and a forced final write failure must leave no package or ledger rows; duplicate title and idempotent replay must not duplicate rows.

Live evidence is opt-in because it writes to real local services. Each run is self-cleaning by its process-specific idempotency-key prefix.

```powershell
$env:B1_RUN_N8N = '1'
$env:B1_N8N_WEBHOOK_URL = 'http://127.0.0.1:5678/webhook/create_book'
node --test tests/business/b1-create-draft-book/b1-create-draft-book.test.mjs

$env:B1_RUN_CANONICAL_DATABASE = '1'
$env:B1_OPERATOR_ID = '<initialized-local-operator-uuid>'
node --test tests/business/b1-create-draft-book/b1-create-draft-book.test.mjs

$env:B1_RUN_BROWSER = '1'
$env:B1_BROWSER_BASE_URL = 'http://127.0.0.1:4173'
node --test tests/business/b1-create-draft-book/b1-create-draft-book.test.mjs
```

The browser path uses a real Playwright browser only when that dependency is installed; it does not intercept requests or simulate successful backend responses.
