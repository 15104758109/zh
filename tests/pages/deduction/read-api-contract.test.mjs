import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mergeDeductionRuntime } from "../../../apps/web/src/app/deduction-runtime-projection.mjs";
import { deductionCommandAction, deductionDisplayRecords } from "../../../apps/web/src/pages/multi-agent-deduction/deduction-data-client.mjs";

const serverPath = new URL("../../../apps/web/src/app/server.mjs", import.meta.url);
const runtimeProjectionPath = new URL("../../../apps/web/src/app/deduction-runtime-projection.mjs", import.meta.url);

test("deduction workspace API is a scoped read model", async () => {
  const source = await readFile(serverPath, "utf8");
  const readModel = source.match(/async function readDeductionWorkspace[\s\S]*?\n}\n\nasync function readJsonBody/)?.[0] || "";

  assert.match(source, /\/api\\\/books\\\/\(\[\^\/\]\+\)\\\/deduction/);
  assert.match(source, /request\.method !== "GET"/);
  assert.match(source, /try \{\s*bookId = decodeURIComponent\(deductionApi\[1\]\)/);
  assert.match(readModel, /FROM public\.book_project/);
  assert.match(readModel, /id = \$\{book} AND local_operator_id = \$\{operator}/);
  assert.match(readModel, /FROM public\.v_chapter_progress/);
  assert.match(readModel, /JOIN public\.chapter_version AS cv ON cv\.id = p\.candidate_version_id/);
  assert.match(readModel, /active_chapter_json, current_l1a_id/);
  assert.match(readModel, /p\.l1a_unit_id = b\.current_l1a_id/);
  assert.match(readModel, /FROM public\.v_character_active/);
  assert.match(readModel, /'has_candidate_text', NULLIF\(btrim\(cv\.prose_text\), ''\) IS NOT NULL/);
  assert.match(readModel, /'objective_audit_completed', EXISTS \(\s*SELECT 1\s*FROM public\.audit_attempt_log AS a/);
  assert.match(readModel, /a\.book_id = p\.book_id/);
  assert.match(readModel, /a\.chapter_id = p\.chapter_id/);
  assert.match(readModel, /a\.chapter_version_id = cv\.id/);
  assert.match(readModel, /a\.audit_type = 'objective'/);
  assert.match(readModel, /a\.audit_status = 'completed'/);
  assert.match(readModel, /a\.candidate_text_snapshot IS NOT DISTINCT FROM cv\.prose_text/);
  assert.match(readModel, /a\.is_valid\s+AND NOT a\.is_shadow/);
  assert.doesNotMatch(readModel, /\b(?:INSERT|UPDATE|DELETE|CALL)\b/i);
  assert.match(source, /FP008_SERVICE_URL/);
  assert.match(source, /import \{ mergeDeductionRuntime \} from "\.\/deduction-runtime-projection\.mjs"/);
  const runtimeProjection = await readFile(runtimeProjectionPath, "utf8");
  assert.match(runtimeProjection, /FP008_RUNTIME_SCOPE_MISMATCH/);
  assert.match(runtimeProjection, /runtimeBlockedCode/);
  assert.match(runtimeProjection, /chapter\.runtime_blocked_code = runtimeBlockedCode/);
  assert.match(runtimeProjection, /databaseBook\.runtime_blocked_code = runtimeBlockedCode/);
  assert.doesNotMatch(runtimeProjection, /chapter\.candidate_plot_sim_json = runtimeChapter\.candidate_plot_sim_json/);
  assert.doesNotMatch(runtimeProjection, /chapter\.deduction_progress_json = runtimeChapter\.deduction_progress_json/);
  assert.doesNotMatch(runtimeProjection, /chapter\.deduction_locked = runtimeChapter/);
});

test("deduction workspace API preserves stable RPC errors as redacted errors", async () => {
  const source = await readFile(serverPath, "utf8");
  assert.match(source, /result\?\.ok === false && result\.error && !result\.redacted_error/);
  assert.match(source, /INVALID_BOOK_CONTEXT/);
  assert.match(source, /RPC_UNAVAILABLE/);
});

test("a refresh never turns an unpersisted FP008 runtime pause into a resumable checkpoint", () => {
  const chapter = {
    chapter_id: "33333333-4444-4555-8666-777777777777",
    candidate_version_id: "44444444-5555-4666-8777-888888888888",
    l1a_unit_id: "22222222-3333-4444-8555-666666666666",
    status: "plan_ready",
    run_status: "plan_ready",
    deduction_locked: false,
    deduction_progress_json: null,
    candidate_plot_sim_json: null,
    target_snapshot_json: {
      particles_json: [{ particle_id: "particle-1" }],
      scene_condition_package: { scene_location: "documented scene" },
    },
  };
  const databaseResult = {
    ok: true,
    result: {
      book: {
        id: "abcdefab-1234-4abc-8abc-abcdefabcdef",
        current_l1a_id: chapter.l1a_unit_id,
      },
      chapters: [chapter],
    },
  };
  const runtimeResult = {
    book: { id: databaseResult.result.book.id, current_l1a_id: chapter.l1a_unit_id },
    service_state: "paused",
    chapters: [{
      chapter_id: chapter.chapter_id,
      candidate_version_id: chapter.candidate_version_id,
      l1a_unit_id: chapter.l1a_unit_id,
      deduction_progress_json: { current_particle_index: 1, token_consumed: 159403 },
      candidate_plot_sim_json: { particles_records: [{ particle_id: "particle-1", particle_status: "completed" }] },
    }],
  };

  const projection = mergeDeductionRuntime(structuredClone(databaseResult), runtimeResult);
  const refreshedChapter = projection.result.chapters[0];

  assert.equal(refreshedChapter.deduction_progress_json, null);
  assert.equal(refreshedChapter.candidate_plot_sim_json, null);
  assert.equal(refreshedChapter.runtime_service_state, undefined);
  assert.equal(deductionDisplayRecords(refreshedChapter)[0].particle_status, undefined);
  assert.equal(deductionCommandAction(refreshedChapter), "start");
});

test("a running FP008 projection exposes a separate display overlay without replacing persisted data", () => {
  const chapter = {
    chapter_id: "33333333-4444-4555-8666-777777777777",
    candidate_version_id: "44444444-5555-4666-8777-888888888888",
    l1a_unit_id: "22222222-3333-4444-8555-666666666666",
    deduction_progress_json: { current_particle_index: 1, token_consumed: 100 },
    candidate_plot_sim_json: { particles_records: [{ particle_id: "particle-1", particle_status: "completed" }] },
  };
  const databaseResult = {
    ok: true,
    result: {
      book: { id: "abcdefab-1234-4abc-8abc-abcdefabcdef", current_l1a_id: chapter.l1a_unit_id },
      chapters: [chapter],
    },
  };
  const runtimeResult = {
    book: { id: databaseResult.result.book.id, current_l1a_id: chapter.l1a_unit_id },
    service_state: "running",
    token_consumed: 432,
    chapters: [{
      chapter_id: chapter.chapter_id,
      candidate_version_id: chapter.candidate_version_id,
      l1a_unit_id: chapter.l1a_unit_id,
      deduction_progress_json: { current_particle_index: 2, token_consumed: 200 },
      candidate_plot_sim_json: {
        particles_records: [
          { particle_id: "particle-1", particle_status: "completed" },
          { particle_id: "particle-2", particle_status: "completed" },
        ],
      },
    }],
  };

  const projection = mergeDeductionRuntime(structuredClone(databaseResult), runtimeResult);
  const refreshedChapter = projection.result.chapters[0];

  assert.deepEqual(refreshedChapter.deduction_progress_json, chapter.deduction_progress_json);
  assert.deepEqual(refreshedChapter.candidate_plot_sim_json, chapter.candidate_plot_sim_json);
  assert.deepEqual(refreshedChapter.runtime_deduction_progress_json, runtimeResult.chapters[0].deduction_progress_json);
  assert.deepEqual(refreshedChapter.runtime_candidate_plot_sim_json, runtimeResult.chapters[0].candidate_plot_sim_json);
  assert.equal(refreshedChapter.runtime_l1a_token_consumed, 432);
  assert.equal(refreshedChapter.runtime_service_state, "running");
});
