# WEB-STATIC-RESTORE Final Visual Audit 2

Overall: PASS

Evidence was collected in a fresh browser session against the current local source and target servers. No previous PASS/FAIL result or screenshot was used as acceptance evidence.

## Screenshot Format Correction

The browser screenshot API emitted JPEG/JFIF bytes, not PNG. The 36 captures were renamed from `.png` to `.jpg` without re-encoding. `jpeg-dimensions.json` decodes every file with a JPEG-aware decoder and verifies the requested exact dimensions.

## Normal-State Matrix

| Page | 1440x900 | 1280x720 | Observed result |
| --- | --- | --- | --- |
| WORKBENCH | PASS | PASS | Side navigation, header, project summary, flow canvas, and editor panel retain geometry and density. |
| NEW_BOOK | PASS | PASS | Sidebar, authoring form, assistant content, preview/step panel, and command bar match. |
| WORLD | PASS | PASS | Sidebar/topbar, board summary, skeleton, canvas, drag pool, and editor controls match. |
| CHARACTERS | PASS | PASS | Sidebar/topbar, character cards, editor form, psychological matrix, and relation content match. |
| L1A | PASS | PASS | Sidebar/topbar, candidate cards, constraint detail, sorting action, and side panel match. |
| PRODUCTION | PASS | PASS | Sidebar/topbar, plan canvas, summary cards, progression and action controls match. |
| DEDUCTION | PASS | PASS | Sidebar/topbar, progress layer, timeline/work cards, agent status and controls match. |
| AUDIT_REVIEW | PASS | PASS | Sidebar/topbar, path list, proof/review content, gate and decision controls match. |
| AUDIT_STAGE | PASS | PASS | Sidebar/topbar, manuscript, evidence/audit panels, tabs and release controls match. |

The matrix represents 18 independent source/target pairs. All target documents were top-level application DOM, nonempty, frame-free, directly refreshed from their target routes, console-clean, and had `scrollWidth == innerWidth` at both required viewports.

PASS | WORKBENCH | 1440x900
PASS | WORKBENCH | 1280x720
PASS | NEW_BOOK | 1440x900
PASS | NEW_BOOK | 1280x720
PASS | WORLD | 1440x900
PASS | WORLD | 1280x720
PASS | CHARACTERS | 1440x900
PASS | CHARACTERS | 1280x720
PASS | L1A | 1440x900
PASS | L1A | 1280x720
PASS | PRODUCTION | 1440x900
PASS | PRODUCTION | 1280x720
PASS | DEDUCTION | 1440x900
PASS | DEDUCTION | 1280x720
PASS | AUDIT_REVIEW | 1440x900
PASS | AUDIT_REVIEW | 1280x720
PASS | AUDIT_STAGE | 1440x900
PASS | AUDIT_STAGE | 1280x720

## State And Retry Matrix

| Page | empty | loading | error | error retry to normal |
| --- | --- | --- | --- | --- |
| WORKBENCH | PASS | PASS | PASS | PASS |
| NEW_BOOK | PASS | PASS | PASS | PASS |
| WORLD | PASS | PASS | PASS | PASS |
| CHARACTERS | PASS | PASS | PASS | PASS |
| L1A | PASS | PASS | PASS | PASS |
| PRODUCTION | PASS | PASS | PASS | PASS |
| DEDUCTION | PASS | PASS | PASS | PASS |
| AUDIT_REVIEW | PASS | PASS | PASS | PASS |
| AUDIT_STAGE | PASS | PASS | PASS | PASS |

Each state was tested at 1280x720. Empty and loading used distinct `status` text; error used a distinct `alert` and exactly one visible retry control. The contained state panel remained in the application main region and did not create page overflow. Every error retry restored its route's normal page.

## Runtime And Canonical Evidence

`runtime-canonical.json` contains the hard-gate result. The focused route test (`node --test apps/web/test/routes.test.mjs`) passed all 3 tests. WORLD's unique character navigation was clicked only after its exact locator count was confirmed as one, and reached `/books/book-context-42/characters`.

## Occlusion Recheck

The reported possible black rectangles for WORLD and CHARACTERS at 1280x720 were directly re-inspected in the original evidence and did not appear. Fresh target-only captures in new tabs are `world-target-1280x720-fresh.jpg` and `characters-target-1280x720-fresh.jpg`; both are complete 1280x720 JPEG renders with the same nonoverflowing DOM geometry. `black-occlusion-recheck.json` records this recheck. No raster-level occlusion, clipping, overlap, or whole-page overflow was observed.
