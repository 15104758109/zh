const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARTICLE_TYPES = new Set(["truth", "resource", "info", "emotion", "hook"]);
const ROLE_TYPES = new Set(["protagonist", "antagonist", "supporting", "ensemble"]);
const KNOWLEDGE_KEYS = ["knows", "unknown", "false_belief", "reasonable_suspect"] as const;
const LIVE_STATE_KEYS = [
  "philosophy_live_json", "emotion_state_json", "drive_live_json", "trigger_state_json",
  "goal_state_json", "pressure_level", "current_goal_txt", "current_emo_tag",
] as const;
const RELATION_NUMERIC_KEYS = [
  "trust", "intimacy", "power_balance", "dependence", "hostility", "common_goal",
  "secret_known", "emotional_bond",
] as const;
const RELATION_TEXT_KEYS = [
  "relation_type", "relation_hierarchy", "relation_origin", "relation_overview",
] as const;
const MEMORY_TYPES = new Set(["event", "emotion", "knowledge", "relationship"]);
const MEMORY_TRUTH_STATUSES = new Set(["true", "misremembered", "false"]);
const SCENE_CONDITION_ARRAY_KEYS = [
  "participant_chars",
  "rule_locks",
  "scene_affordance",
  "available_resource_codes",
  "info_reveal_candidates",
  "chain_reaction_candidates",
  "scene_constraints",
  "forbid_lines_active",
  "materialize_notes",
] as const;
const FORBIDDEN_OUTPUT_KEYS = new Set([
  "selected_event",
  "dramatic_irony",
  "pacing",
  "emotional_arc",
  "prose_text",
  "novel_text",
]);

export const FP008_TOKEN_BUDGET = 10_000_000;
export const FP008_TOKEN_BUDGET_VERSION = "mvp-fixed-10000000";
export const FP008_DEFAULT_MODEL_MAX_TOKENS = 32_000;

type JsonObject = Record<string, unknown>;

type CandidateTruthState = {
  characters: Map<string, JsonObject>;
  characterCodes: Map<string, string>;
  worlds: Map<string, JsonObject>;
  relations: Map<string, JsonObject>;
  relationParticipants: Map<string, string[]>;
  memories: Map<string, JsonObject[]>;
};

export type ModelInvocation = Readonly<{
  nodeCode: "NODE_05" | "NODE_06";
  mode: "character_respond" | "director_distribute" | "director_converge";
  binding: JsonObject;
  input: JsonObject;
  sessionKey: string;
  continueSession: boolean;
}>;

export type ModelReply = Readonly<{
  output: unknown;
  usage: Readonly<{ total_tokens: number }>;
}>;

export type ModelInvoker = ((invocation: ModelInvocation) => Promise<ModelReply>) & {
  clearSession?: (sessionKey: string) => void;
  estimateTokenUsage?: (invocation: ModelInvocation) => number;
};

export type DiagnosticValue = string | number | boolean | null | readonly string[];

export type EngineAttemptObserver = (event: Readonly<{
  source: "engine";
  nodeCode: ModelInvocation["nodeCode"];
  mode: ModelInvocation["mode"];
  engine_attempt: number;
  outcome: "retry" | "failed" | "blocked";
  error_category: "deduction" | "transport_or_internal";
  error_code: string | null;
  provider_status: number | null;
  retry_scheduled: boolean;
}>) => void;

function observeEngineAttempt(observer: EngineAttemptObserver | undefined, event: Parameters<EngineAttemptObserver>[0]): void {
  try {
    observer?.(event);
  } catch {
    // Diagnostics must never affect FP008 execution.
  }
}

export class DeductionServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly diagnostics?: Readonly<Record<string, DiagnosticValue>>;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    statusCode = 400,
    diagnostics?: Readonly<Record<string, DiagnosticValue>>,
    retryable = false,
  ) {
    super(message);
    this.name = "DeductionServiceError";
    this.code = code;
    this.statusCode = statusCode;
    if (diagnostics !== undefined) this.diagnostics = diagnostics;
    this.retryable = retryable;
  }
}

class BudgetReached extends Error {}
class ModelCallBlocked extends Error {}
class PauseReached extends Error {}

function isExhaustedProviderFailure(error: DeductionServiceError): boolean {
  if (error.code === "MODEL_PROVIDER_UNAVAILABLE" || error.code === "MODEL_PROVIDER_TIMEOUT") return true;
  return error.code === "MODEL_PROVIDER_REJECTED"
    && [429, 502, 503, 504].includes(Number(error.diagnostics?.provider_status));
}

function fail(code: string, message: string, statusCode = 400): never {
  throw new DeductionServiceError(code, message, statusCode);
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_REQUEST", `${label} must be an object.`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail("INVALID_REQUEST", `${label} must be an array.`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail("INVALID_REQUEST", `${label} is required.`);
  return value.trim();
}

function uuid(value: unknown, label: string): string {
  const normalized = string(value, label).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) fail("INVALID_REQUEST", `${label} must be a UUID.`);
  return normalized;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    fail("INVALID_REQUEST", `${label} must be a non-negative integer.`);
  }
  return Number(value);
}

function numberInRange(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail("INVALID_REQUEST", `${label} must be a number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value === null) return null;
  return uuid(value, label);
}

function has(source: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => jsonEqual(entry, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftObject = left as JsonObject;
  const rightObject = right as JsonObject;
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && jsonEqual(leftObject[key], rightObject[key])
    ));
}

function requireFields(source: JsonObject, fields: readonly string[], label: string): void {
  for (const field of fields) {
    if (!has(source, field)) fail("MODEL_OUTPUT_INVALID", `${label}.${field} is required.`, 502);
  }
}

function closed(source: JsonObject, fields: readonly string[], label: string): void {
  const unexpected = Object.keys(source).find((key) => !fields.includes(key));
  if (unexpected) fail("INVALID_REQUEST", `${label}.${unexpected} is not supported.`);
}

function normalizeSceneConditionPackage(value: unknown, label: string): JsonObject {
  const scenePackage = object(value, label);
  if (!has(scenePackage, "scene_location")) fail("INVALID_REQUEST", `${label}.scene_location is required.`);
  for (const key of SCENE_CONDITION_ARRAY_KEYS) array(scenePackage[key], `${label}.${key}`);
  return scenePackage;
}

function assertNoForbiddenOutput(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenOutput(entry, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as JsonObject)) {
    if (FORBIDDEN_OUTPUT_KEYS.has(key)) {
      fail("MODEL_OUTPUT_INVALID", `${label}.${key} belongs to the presentation layer.`, 502);
    }
    assertNoForbiddenOutput(nested, `${label}.${key}`);
  }
}

function scopeKey(scope: JsonObject): string {
  return `${scope.local_operator_id}:${scope.book_id}:${scope.l1a_unit_id}`;
}

function normalizeScope(value: unknown): JsonObject {
  const scope = object(value, "scope");
  closed(scope, ["local_operator_id", "book_id", "l1a_unit_id"], "scope");
  scope.local_operator_id = uuid(scope.local_operator_id, "scope.local_operator_id");
  scope.book_id = uuid(scope.book_id, "scope.book_id");
  scope.l1a_unit_id = uuid(scope.l1a_unit_id, "scope.l1a_unit_id");
  return scope;
}

function sessionKey(scope: JsonObject, chapter: JsonObject): string {
  return `${scopeKey(scope)}:${chapter.chapter_id}:${chapter.chapter_version_id}`;
}

function nextCallTokenReserve(
  binding: JsonObject,
  observedUsage: number | undefined,
  estimatedUsage: number | undefined,
): number {
  const parameters = binding.parameters_jsonb;
  const configured = parameters && typeof parameters === "object" && !Array.isArray(parameters)
    ? Number((parameters as JsonObject).max_tokens)
    : NaN;
  const configuredReserve = Number.isSafeInteger(configured) && configured > 0 ? configured : 0;
  return Math.max(
    FP008_DEFAULT_MODEL_MAX_TOKENS,
    observedUsage ?? 0,
    configuredReserve,
    estimatedUsage ?? 0,
  );
}

function normalizeKnowledge(value: unknown, label: string): JsonObject {
  const boundary = object(value, label);
  for (const key of KNOWLEDGE_KEYS) array(boundary[key], `${label}.${key}`);
  return boundary;
}

function initialLiveStateProjection(
  character: JsonObject,
  value: unknown,
  label: string,
): JsonObject {
  const projection = object(value, label);
  const allowed = ["source", "five_layers_json", "knowledge_boundary_json"];
  const unexpected = Object.keys(projection).find((key) => !allowed.includes(key));
  if (unexpected) {
    fail(
      "INITIAL_LIVE_STATE_PROJECTION_INVALID",
      `The initial live-state projection cannot contain ${unexpected}; memories and relations are separate role context.`,
      409,
    );
  }
  if (has(projection, "source") && projection.source !== "initial_live_state_projection") {
    fail("INITIAL_LIVE_STATE_PROJECTION_INVALID", "The initial live-state projection source is invalid.", 409);
  }
  if (has(projection, "five_layers_json")
    && !jsonEqual(object(projection.five_layers_json, `${label}.five_layers_json`), character.five_layers_json)) {
    fail("INITIAL_LIVE_STATE_PROJECTION_INVALID", "The initial live-state projection must use the formal role settings.", 409);
  }
  if (has(projection, "knowledge_boundary_json")
    && !jsonEqual(
      normalizeKnowledge(projection.knowledge_boundary_json, `${label}.knowledge_boundary_json`),
      character.knowledge_boundary_json,
    )) {
    fail("INITIAL_LIVE_STATE_PROJECTION_INVALID", "The initial live-state projection must use the formal knowledge boundary.", 409);
  }
  return {
    source: "initial_live_state_projection",
    five_layers_json: structuredClone(character.five_layers_json),
    knowledge_boundary_json: structuredClone(character.knowledge_boundary_json),
  };
}

function liveStateSnapshot(value: unknown, label: string): JsonObject {
  const state = object(value, label);
  requireFields(state, LIVE_STATE_KEYS, label);
  if (typeof state.pressure_level !== "number" || !Number.isFinite(state.pressure_level)) {
    fail("INVALID_REQUEST", `${label}.pressure_level must be a finite number.`);
  }
  return state;
}

function relationSnapshot(value: unknown, label: string): JsonObject {
  const relation = object(value, label);
  requireFields(relation, [
    ...RELATION_NUMERIC_KEYS,
    ...RELATION_TEXT_KEYS,
    "change_event_json",
  ], label);
  for (const key of RELATION_NUMERIC_KEYS) {
    if (!Number.isInteger(relation[key])) {
      fail("INVALID_REQUEST", `${label}.${key} must be an integer.`);
    }
  }
  for (const key of ["relation_type", "relation_hierarchy"]) string(relation[key], `${label}.${key}`);
  object(relation.change_event_json, `${label}.change_event_json`);
  return {
    trust: relation.trust,
    intimacy: relation.intimacy,
    power_balance: relation.power_balance,
    dependence: relation.dependence,
    hostility: relation.hostility,
    common_goal: relation.common_goal,
    secret_known: relation.secret_known,
    emotional_bond: relation.emotional_bond,
    relation_type: relation.relation_type,
    relation_hierarchy: relation.relation_hierarchy,
    relation_origin: relation.relation_origin,
    relation_overview: relation.relation_overview,
    change_event_json: relation.change_event_json,
  };
}

function normalizeBinding(value: unknown, expectedNode: "NODE_05" | "NODE_06"): JsonObject {
  const binding = object(value, `model_bindings.${expectedNode}`);
  if (string(binding.node_code, `${expectedNode}.node_code`) !== expectedNode) {
    fail("INVALID_REQUEST", `${expectedNode} binding has the wrong node_code.`);
  }
  for (const field of ["prompt_text", "model_name", "provider_base_url", "api_key_ref"]) {
    string(binding[field], `${expectedNode}.${field}`);
  }
  return binding;
}

function normalizeParticle(value: unknown, chapterIndex: number, particleIndex: number): JsonObject {
  const particle = object(value, `chapters[${chapterIndex}].particles[${particleIndex}]`);
  const required = [
    "particle_id", "content", "type", "emotion_phase", "staged_task", "reveal_to",
    "assigned_to_role_type", "involved_chars", "required_chars", "source_field", "purpose",
  ];
  requireFields(particle, required, "particle");
  for (const field of ["particle_id", "content", "emotion_phase", "staged_task", "source_field", "purpose"]) {
    string(particle[field], `particle.${field}`);
  }
  if (!PARTICLE_TYPES.has(string(particle.type, "particle.type"))) {
    fail("INVALID_REQUEST", "particle.type is outside the V7 enum.");
  }
  if (!ROLE_TYPES.has(string(particle.assigned_to_role_type, "particle.assigned_to_role_type"))) {
    fail("INVALID_REQUEST", "particle.assigned_to_role_type is outside the V7 enum.");
  }
  array(particle.involved_chars, "particle.involved_chars");
  array(particle.required_chars, "particle.required_chars");
  if (particle.type === "resource" && particle.world_verified !== true) {
    fail("RESOURCE_PARTICLE_NOT_VERIFIED", "A resource particle is not world-verified.", 409);
  }
  return particle;
}

function normalizeCharacter(value: unknown, index: number): JsonObject {
  const character = object(value, `characters[${index}]`);
  character.character_id = uuid(character.character_id, `characters[${index}].character_id`);
  character.char_code = string(character.char_code, `characters[${index}].char_code`);
  character.role_type = string(character.role_type, `characters[${index}].role_type`);
  if (!ROLE_TYPES.has(character.role_type as string)) fail("INVALID_REQUEST", "character.role_type is invalid.");
  object(character.five_layers_json, `characters[${index}].five_layers_json`);
  character.knowledge_boundary_json = normalizeKnowledge(
    character.knowledge_boundary_json,
    `characters[${index}].knowledge_boundary_json`,
  );
  if (!has(character, "live_state_id") || !has(character, "live_state_source")) {
    fail("INITIAL_LIVE_STATE_PROJECTION_REQUIRED", "Each role needs a formal live-state reference or an initial projection.", 409);
  }
  character.live_state_id = optionalUuid(character.live_state_id, `characters[${index}].live_state_id`);
  character.live_state_source = string(character.live_state_source, `characters[${index}].live_state_source`);
  if (character.live_state_id === null) {
    if (character.live_state_source !== "initial_live_state_projection") {
      fail("INITIAL_LIVE_STATE_PROJECTION_REQUIRED", "A missing formal live state must use the initial projection.", 409);
    }
    character.live_state_json = initialLiveStateProjection(
      character,
      character.live_state_json,
      `characters[${index}].live_state_json`,
    );
  } else {
    if (character.live_state_source !== "formal_live_state") {
      fail("LIVE_STATE_SOURCE_INVALID", "A formal live state needs the formal_live_state source.", 409);
    }
    character.live_state_json = liveStateSnapshot(
      character.live_state_json,
      `characters[${index}].live_state_json`,
    );
  }
  array(character.active_memory_json, `characters[${index}].active_memory_json`);
  return character;
}

function normalizeCheckpoint(value: unknown, chapter: JsonObject): JsonObject {
  const checkpoint = object(value, "chapter.checkpoint");
  const plot = object(checkpoint.candidate_plot_sim_json, "checkpoint.candidate_plot_sim_json");
  const progress = object(checkpoint.deduction_progress_json, "checkpoint.deduction_progress_json");
  const inputSnapshot = object(plot.deduction_input_snapshot, "candidate_plot_sim_json.deduction_input_snapshot");
  const checkpointParticles = array(
    inputSnapshot.particles,
    "candidate_plot_sim_json.deduction_input_snapshot.particles",
  );
  const checkpointParticipants = array(
    inputSnapshot.participating_chars,
    "candidate_plot_sim_json.deduction_input_snapshot.participating_chars",
  );
  const records = array(plot.particles_records, "candidate_plot_sim_json.particles_records");
  candidateTruthLedger(plot.candidate_truth_ledger, "candidate_plot_sim_json.candidate_truth_ledger");
  const particles = chapter.particles as JsonObject[];
  if (!jsonEqual(checkpointParticles, particles)
    || !jsonEqual(checkpointParticipants, chapter.participating_chars)) {
    fail("INVALID_CHECKPOINT", "Checkpoint deduction input does not match the persisted attempt.", 409);
  }
  const current = integer(progress.current_particle_index, "deduction_progress_json.current_particle_index");
  if (current > particles.length || records.length !== current) {
    fail("INVALID_CHECKPOINT", "Checkpoint records do not match current_particle_index.", 409);
  }
  if (integer(progress.remaining_particles, "deduction_progress_json.remaining_particles") !== particles.length - current) {
    fail("INVALID_CHECKPOINT", "Checkpoint remaining_particles does not match the particle cursor.", 409);
  }
  const checkpointCharacterCodes = (chapter.participating_chars as JsonObject[])
    .map((participant) => participant.char_code as string);
  records.forEach((record, index) => validateConvergence(
    record,
    particles[index],
    index + 1,
    particles.length,
    undefined,
    checkpointCharacterCodes,
  ));
  integer(progress.token_consumed, "deduction_progress_json.token_consumed");
  if (progress.token_budget !== FP008_TOKEN_BUDGET
    || progress.token_budget_version !== FP008_TOKEN_BUDGET_VERSION) {
    fail("TOKEN_BUDGET_CONTRACT_MISMATCH", "Checkpoint token budget does not match V7.", 409);
  }
  if (typeof progress.token_budget_exceeded !== "boolean" || typeof progress.deduction_complete !== "boolean") {
    fail("INVALID_CHECKPOINT", "Checkpoint completion flags are invalid.", 409);
  }
  if (progress.deduction_complete !== (current === particles.length)) {
    fail("INVALID_CHECKPOINT", "Checkpoint completion does not match the particle cursor.", 409);
  }
  integer(progress.reject_count, "deduction_progress_json.reject_count");
  return checkpoint;
}

function normalizeCommand(value: unknown): JsonObject {
  const command = object(value, "request");
  closed(command, [
    "action", "scope", "creator_direction", "token_budget", "token_budget_version", "chapters",
    "characters", "world_state", "world_resistance_refs", "relations", "model_bindings",
  ], "request");
  const action = string(command.action, "action");
  if (!["start", "resume", "restart"].includes(action)) fail("INVALID_ACTION", "Unsupported deduction action.");

  const scope = normalizeScope(command.scope);

  if (command.token_budget !== FP008_TOKEN_BUDGET
    || command.token_budget_version !== FP008_TOKEN_BUDGET_VERSION) {
    fail("TOKEN_BUDGET_CONTRACT_MISMATCH", "The active L1A budget must be the V7 fixed budget.", 409);
  }
  if (action === "restart" && has(command, "creator_direction")) {
    command.creator_direction = string(command.creator_direction, "creator_direction");
  } else if (action !== "restart" && has(command, "creator_direction")) {
    fail("INVALID_REQUEST", "creator_direction is accepted only for whole-L1A restart.");
  }

  const characters = array(command.characters, "characters").map(normalizeCharacter);
  const characterByCode = new Map(characters.map((character) => [character.char_code as string, character]));
  if (!characters.length || characterByCode.size !== characters.length) {
    fail("INVALID_REQUEST", "characters must contain unique char_code values.");
  }

  const chapters = array(command.chapters, "chapters").map((entry, chapterIndex) => {
    const chapter = object(entry, `chapters[${chapterIndex}]`);
    chapter.chapter_id = uuid(chapter.chapter_id, `chapters[${chapterIndex}].chapter_id`);
    chapter.chapter_version_id = uuid(chapter.chapter_version_id, `chapters[${chapterIndex}].chapter_version_id`);
    chapter.chapter_index = integer(chapter.chapter_index, `chapters[${chapterIndex}].chapter_index`);
    if (chapter.chapter_index === 0) fail("INVALID_REQUEST", "chapter_index must be positive.");
    object(chapter.target_snapshot_json, `chapters[${chapterIndex}].target_snapshot_json`);
    object(chapter.chapter_implementation_json, `chapters[${chapterIndex}].chapter_implementation_json`);
    chapter.scene_condition_package = normalizeSceneConditionPackage(
      chapter.scene_condition_package,
      `chapters[${chapterIndex}].scene_condition_package`,
    );
    if (!has(chapter, "shadow_summary")) fail("INVALID_REQUEST", "chapter.shadow_summary is required.");
    const particles = array(chapter.particles, `chapters[${chapterIndex}].particles`)
      .map((particle, particleIndex) => normalizeParticle(particle, chapterIndex, particleIndex));
    if (particles.length < 3) fail("PARTICLE_SET_TOO_SMALL", "Each chapter requires at least three particles.", 409);
    if (new Set(particles.map((particle) => particle.particle_id)).size !== particles.length) {
      fail("INVALID_REQUEST", "particle_id values must be unique inside a chapter.");
    }
    chapter.particles = particles;
    const participants = array(chapter.participating_chars, `chapters[${chapterIndex}].participating_chars`);
    if (!participants.length) fail("INVALID_REQUEST", "participating_chars cannot be empty.");
    const participantCodes = new Set<string>();
    for (const participantValue of participants) {
      const participant = object(participantValue, "participating_char");
      const code = string(participant.char_code, "participating_char.char_code");
      if (participantCodes.has(code)) fail("INVALID_REQUEST", `Participating character ${code} is duplicated.`);
      participantCodes.add(code);
      const role = string(participant.role_type, "participating_char.role_type");
      const character = characterByCode.get(code);
      if (!character || character.role_type !== role || character.character_id !== uuid(participant.char_id, "participating_char.char_id")) {
        fail("CHARACTER_SCOPE_MISMATCH", `Participating character ${code} does not match the character input.`, 409);
      }
      string(participant.activation_reason, "participating_char.activation_reason");
    }
    if (action === "restart" && has(chapter, "checkpoint")) {
      fail("RESTART_OLD_RESULT_FORBIDDEN", "A whole-L1A restart cannot consume an old checkpoint.", 409);
    }
    if (action === "start" && has(chapter, "checkpoint")) {
      fail("INVALID_CHECKPOINT", "Use resume, not start, when a checkpoint exists.", 409);
    }
    if (has(chapter, "checkpoint")) chapter.checkpoint = normalizeCheckpoint(chapter.checkpoint, chapter);
    return chapter;
  });
  if (!chapters.length) fail("INVALID_REQUEST", "chapters cannot be empty.");
  const chapterIdentity = chapters.map((chapter) => `${chapter.chapter_id}:${chapter.chapter_version_id}`);
  if (new Set(chapterIdentity).size !== chapterIdentity.length) fail("INVALID_REQUEST", "Chapter identities must be unique.");
  if (action === "resume") {
    const checkpoints = chapters
      .map((chapter) => chapter.checkpoint as JsonObject | undefined)
      .filter((checkpoint): checkpoint is JsonObject => checkpoint !== undefined);
    if (!checkpoints.length) {
      fail("RESUME_CHECKPOINT_REQUIRED", "Resume requires a persisted L1A checkpoint.", 409);
    }
    const checkpointTokenTotal = checkpoints.reduce((total, checkpoint) => (
      total + Number((checkpoint.deduction_progress_json as JsonObject).token_consumed)
    ), 0);
    const checkpointBudgetExceeded = checkpoints.some((checkpoint) => (
      (checkpoint.deduction_progress_json as JsonObject).token_budget_exceeded === true
    ));
    if (checkpointTokenTotal > FP008_TOKEN_BUDGET
      || (checkpointTokenTotal >= FP008_TOKEN_BUDGET && !checkpointBudgetExceeded)) {
      fail("INVALID_CHECKPOINT", "Checkpoint token budget flag does not match the L1A token total.", 409);
    }
  }

  command.scope = scope;
  command.characters = characters;
  command.chapters = chapters;
  const worldState = array(command.world_state, "world_state").map((entry, index) => {
    const state = object(entry, `world_state[${index}]`);
    if (state.is_active !== true || state.setting_layer !== "initial") {
      fail("WORLD_STATE_SCOPE_INVALID", "FP008-02 accepts only active initial world state.", 409);
    }
    state.world_state_id = uuid(state.world_state_id, `world_state[${index}].world_state_id`);
    state.atom_value_jsonb = object(state.atom_value_jsonb, `world_state[${index}].atom_value_jsonb`);
    return state;
  });
  command.world_state = worldState;
  const worldAtomKeys = new Set(worldState
    .map((state) => typeof state.atom_key === "string" ? state.atom_key : "")
    .filter(Boolean));
  command.world_resistance_refs = (command.world_resistance_refs == null
    ? []
    : array(command.world_resistance_refs, "world_resistance_refs")
  ).map((entry, index) => {
    const reference = object(entry, `world_resistance_refs[${index}]`);
    const atomKey = string(reference.atom_key, `world_resistance_refs[${index}].atom_key`);
    if (!worldAtomKeys.has(atomKey)) {
      fail("WORLD_REFERENCE_REJECTED", "A world resistance reference is not available in the active initial world state.", 409);
    }
    return reference;
  });
  command.relations = array(command.relations, "relations").map((entry, index) => {
    const relation = object(entry, `relations[${index}]`);
    if (relation.is_formal !== true || relation.is_valid !== true || relation.is_shadow !== false) {
      fail("RELATION_SCOPE_INVALID", "FP008-02 accepts only formal, valid, non-shadow relations.", 409);
    }
    relation.relation_state_id = uuid(relation.relation_state_id, `relations[${index}].relation_state_id`);
    relation.char_a_id = uuid(relation.char_a_id, `relations[${index}].char_a_id`);
    relation.char_b_id = uuid(relation.char_b_id, `relations[${index}].char_b_id`);
    relation.current_state_json = relationSnapshot(relation, `relations[${index}]`);
    return relation;
  });
  const bindings = object(command.model_bindings, "model_bindings");
  closed(bindings, ["NODE_05", "NODE_06"], "model_bindings");
  command.model_bindings = {
    NODE_05: normalizeBinding(bindings.NODE_05, "NODE_05"),
    NODE_06: normalizeBinding(bindings.NODE_06, "NODE_06"),
  };
  return command;
}

function activeMemories(character: JsonObject): unknown[] {
  return (character.active_memory_json as unknown[]).filter((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const memory = entry as JsonObject;
    return memory.is_valid === true && memory.is_shadow === false;
  });
}

function roleKnowledgeBoundary(character: JsonObject): JsonObject {
  return structuredClone(character.knowledge_boundary_json as JsonObject);
}

function directorParticipantRoles(chapter: JsonObject): JsonObject[] {
  return (chapter.participating_chars as JsonObject[]).map((participant) => ({
    char_code: participant.char_code,
    role_type: participant.role_type,
    activation_reason: participant.activation_reason,
  }));
}

function lightPreviousParticleRecords(records: JsonObject[]): JsonObject[] {
  const previous = records.at(-1);
  if (!previous) return [];
  return [{
    particle_id: previous.particle_id,
    events_in_round: structuredClone(previous.events_in_round),
  }];
}

function candidateActionsForDirector(results: JsonObject[]): JsonObject[] {
  return results.map((result) => ({
    char_code: result.char_code,
    candidate_actions: (result.candidate_actions as JsonObject[])
      .filter((action) => action.audit_block === false && action.scene_coupling !== "失真")
      .map((action) => structuredClone(action)),
    hidden_resistance: structuredClone(result.hidden_resistance),
  }));
}

function emptyCandidateTruthLedger(): JsonObject {
  return {
    schema_version: 1,
    world_changes: [],
    character_live_state_changes: [],
    relation_changes: [],
    memories: [],
  };
}

function candidateTruthLedger(value: unknown, label: string): JsonObject {
  const ledger = object(value, label);
  if (ledger.schema_version !== 1) {
    fail("INVALID_CHECKPOINT", `${label}.schema_version must be 1.`, 409);
  }
  for (const key of ["world_changes", "character_live_state_changes", "relation_changes", "memories"]) {
    array(ledger[key], `${label}.${key}`);
  }
  return ledger;
}

function eventIdsForChange(
  value: unknown,
  label: string,
  eventIds: Set<string>,
): string[] {
  const ids = array(value, label).map((eventId, index) => string(eventId, `${label}[${index}]`));
  if (!ids.length || new Set(ids).size !== ids.length || ids.some((eventId) => !eventIds.has(eventId))) {
    fail("MODEL_OUTPUT_INVALID", `${label} must reference selected events from this particle.`, 502);
  }
  return ids;
}

function mergeCandidateChange(
  entries: JsonObject[],
  key: string,
  entry: JsonObject,
): void {
  const existing = entries.find((candidate) => candidate[key] === entry[key]);
  if (!existing) {
    entries.push(structuredClone(entry));
    return;
  }
  if (!jsonEqual(existing.after, entry.before)) {
    fail("CANDIDATE_TRUTH_DRIFT", "A candidate change must continue from its previous candidate value.", 409);
  }
  existing.after = structuredClone(entry.after);
  existing.event_ids = [...new Set([
    ...(existing.event_ids as string[]),
    ...(entry.event_ids as string[]),
  ])];
  for (const field of ["change_type", "change_layer", "change_reason", "change_event"]) {
    if (has(entry, field)) existing[field] = structuredClone(entry[field]);
  }
}

function sameCandidateMemory(left: JsonObject, right: JsonObject): boolean {
  return jsonEqual(
    {
      character_id: left.character_id,
      memory_type: left.memory_type,
      memory_content: left.memory_content,
      truth_status: left.truth_status,
      importance: left.importance,
      decay_rate: left.decay_rate,
      event_ids: left.event_ids,
    },
    {
      character_id: right.character_id,
      memory_type: right.memory_type,
      memory_content: right.memory_content,
      truth_status: right.truth_status,
      importance: right.importance,
      decay_rate: right.decay_rate,
      event_ids: right.event_ids,
    },
  );
}

function candidateTruthState(command: JsonObject): CandidateTruthState {
  const characters = new Map<string, JsonObject>();
  const characterCodes = new Map<string, string>();
  const memories = new Map<string, JsonObject[]>();
  for (const character of command.characters as JsonObject[]) {
    const characterId = character.character_id as string;
    characters.set(characterId, structuredClone(character.live_state_json as JsonObject));
    characterCodes.set(characterId, character.char_code as string);
    memories.set(characterId, activeMemories(character).map((memory) => structuredClone(memory as JsonObject)));
  }
  const worlds = new Map<string, JsonObject>();
  for (const world of command.world_state as JsonObject[]) {
    worlds.set(world.world_state_id as string, structuredClone(world.atom_value_jsonb as JsonObject));
  }
  const relations = new Map<string, JsonObject>();
  const relationParticipants = new Map<string, string[]>();
  for (const relation of command.relations as JsonObject[]) {
    relations.set(
      relation.relation_state_id as string,
      structuredClone(relation.current_state_json as JsonObject),
    );
    relationParticipants.set(relation.relation_state_id as string, [
      relation.char_a_id as string,
      relation.char_b_id as string,
    ]);
  }
  return { characters, characterCodes, worlds, relations, relationParticipants, memories };
}

function cloneCandidateTruthState(state: CandidateTruthState): CandidateTruthState {
  return {
    characters: new Map([...state.characters.entries()].map(([key, value]) => [key, structuredClone(value)])),
    characterCodes: new Map(state.characterCodes),
    worlds: new Map([...state.worlds.entries()].map(([key, value]) => [key, structuredClone(value)])),
    relations: new Map([...state.relations.entries()].map(([key, value]) => [key, structuredClone(value)])),
    relationParticipants: new Map([...state.relationParticipants.entries()]
      .map(([key, value]) => [key, structuredClone(value)])),
    memories: new Map([...state.memories.entries()]
      .map(([key, value]) => [key, structuredClone(value)])),
  };
}

function appendCandidateMemory(state: CandidateTruthState, memory: JsonObject): void {
  const characterId = memory.character_id as string;
  const existing = state.memories.get(characterId);
  if (!existing) fail("CANDIDATE_TRUTH_DRIFT", "A candidate memory is outside the current role scope.", 409);
  if (existing.some((candidate) => sameCandidateMemory(candidate, memory))) return;
  existing.push({ ...structuredClone(memory), is_valid: true, is_shadow: false });
}

function applyCandidateTruthLedger(
  state: CandidateTruthState,
  value: unknown,
  label: string,
): void {
  const ledger = candidateTruthLedger(value, label);
  for (const entryValue of ledger.world_changes as unknown[]) {
    const entry = object(entryValue, `${label}.world_changes[]`);
    const worldId = uuid(entry.world_state_id, `${label}.world_changes[].world_state_id`);
    const before = object(entry.before, `${label}.world_changes[].before`);
    const after = object(entry.after, `${label}.world_changes[].after`);
    if (!jsonEqual(state.worlds.get(worldId), before)) {
      fail("INVALID_CHECKPOINT", "A checkpoint world baseline no longer matches the formal projection.", 409);
    }
    state.worlds.set(worldId, structuredClone(after));
  }
  for (const entryValue of ledger.character_live_state_changes as unknown[]) {
    const entry = object(entryValue, `${label}.character_live_state_changes[]`);
    const characterId = uuid(entry.character_id, `${label}.character_live_state_changes[].character_id`);
    const before = object(entry.before, `${label}.character_live_state_changes[].before`);
    const after = liveStateSnapshot(entry.after, `${label}.character_live_state_changes[].after`);
    if (!jsonEqual(state.characters.get(characterId), before)) {
      fail("INVALID_CHECKPOINT", "A checkpoint character baseline no longer matches the formal projection.", 409);
    }
    state.characters.set(characterId, structuredClone(after));
  }
  for (const entryValue of ledger.relation_changes as unknown[]) {
    const entry = object(entryValue, `${label}.relation_changes[]`);
    const relationId = uuid(entry.relation_state_id, `${label}.relation_changes[].relation_state_id`);
    const before = relationSnapshot(entry.before, `${label}.relation_changes[].before`);
    const after = relationSnapshot(entry.after, `${label}.relation_changes[].after`);
    if (!jsonEqual(state.relations.get(relationId), before)) {
      fail("INVALID_CHECKPOINT", "A checkpoint relation baseline no longer matches the formal projection.", 409);
    }
    state.relations.set(relationId, structuredClone(after));
  }
  for (const entryValue of ledger.memories as unknown[]) {
    const entry = object(entryValue, `${label}.memories[]`);
    appendCandidateMemory(state, entry);
  }
}

function directorCandidateStateContext(
  state: CandidateTruthState,
  participants: JsonObject[],
): JsonObject {
  const participantIds = new Set(participants.map((participant) => participant.character_id as string));
  return {
    characters: participants.map((participant) => ({
      character_id: participant.character_id,
      char_code: participant.char_code,
      live_state_json: structuredClone(state.characters.get(participant.character_id as string)),
    })),
    world_state: [...state.worlds.entries()].map(([world_state_id, current_value]) => ({
      world_state_id,
      current_value: structuredClone(current_value),
    })),
    relations: [...state.relations.entries()]
      .filter(([relationId]) => {
        const [charA, charB] = state.relationParticipants.get(relationId) ?? [];
        return typeof charA === "string" && typeof charB === "string"
          && participantIds.has(charA) && participantIds.has(charB);
      })
      .map(([relation_state_id, current_state]) => {
        const [charA, charB] = state.relationParticipants.get(relation_state_id) ?? [];
        const charACode = charA ? state.characterCodes.get(charA) : undefined;
        const charBCode = charB ? state.characterCodes.get(charB) : undefined;
        if (!charA || !charB || !charACode || !charBCode) {
          fail("CANDIDATE_TRUTH_DRIFT", "A candidate relation lacks its formal role mapping.", 409);
        }
        return {
          relation_state_id,
          char_a_id: charA,
          char_b_id: charB,
          char_a_code: charACode,
          char_b_code: charBCode,
          current_state: structuredClone(current_state),
        };
      }),
  };
}

function relationConvergenceRepairFeedback(
  value: unknown,
  state: CandidateTruthState,
): JsonObject | null {
  const result = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
  const events = Array.isArray(result?.events_in_round) ? result.events_in_round : null;
  const relationDiff = Array.isArray(result?.relation_diff) ? result.relation_diff : null;
  if (!events || !relationDiff) return null;

  const participantsByEvent = new Map<string, Set<string>>();
  for (const eventValue of events) {
    const event = eventValue !== null && typeof eventValue === "object" && !Array.isArray(eventValue)
      ? eventValue as JsonObject
      : null;
    const eventId = typeof event?.event_id === "string" ? event.event_id : null;
    const participants = Array.isArray(event?.participating_chars) ? event.participating_chars : null;
    if (!eventId || !participants || participants.some((participant) => typeof participant !== "string")) return null;
    participantsByEvent.set(eventId, new Set(participants));
  }

  const constraints: JsonObject[] = [];
  const seen = new Set<string>();
  for (const diffValue of relationDiff) {
    const diff = diffValue !== null && typeof diffValue === "object" && !Array.isArray(diffValue)
      ? diffValue as JsonObject
      : null;
    const relationId = typeof diff?.relation_state_id === "string" ? diff.relation_state_id : null;
    if (!relationId || seen.has(relationId)) continue;
    seen.add(relationId);
    const [charA, charB] = state.relationParticipants.get(relationId) ?? [];
    const charACode = charA ? state.characterCodes.get(charA) : undefined;
    const charBCode = charB ? state.characterCodes.get(charB) : undefined;
    if (!charA || !charB || !charACode || !charBCode) continue;
    constraints.push({
      relation_state_id: relationId,
      char_a_code: charACode,
      char_b_code: charBCode,
      allowed_event_ids: [...participantsByEvent.entries()]
        .filter(([, participants]) => participants.has(charACode) && participants.has(charBCode))
        .map(([eventId]) => eventId),
      omit_relation_change_when_empty: true,
    });
  }
  return constraints.length ? {
    repair_reason: "Each relation change must cite only shared selected events.",
    relation_change_constraints: constraints,
  } : null;
}

function validateDistribution(value: unknown, chapter: JsonObject, particle: JsonObject): Map<string, JsonObject> {
  assertNoForbiddenOutput(value, "director_distribution");
  const envelope = object(value, "director_distribution");
  closed(envelope, ["char_tasks"], "director_distribution");
  const entries = array(envelope.char_tasks, "director_distribution.char_tasks");
  const byCode = new Map<string, JsonObject>();
  for (const entryValue of entries) {
    const entry = object(entryValue, "char_task_entry");
    const code = string(entry.char_code, "char_task_entry.char_code");
    // Strict provider schemas require every declared task property. The
    // protagonist's role-specific staged-goal field is therefore allowed as
    // an explicit null placeholder, but never as a populated value.
    const task = { ...object(entry.task, `char_tasks.${code}`) };
    if (task.particle_id !== particle.particle_id || task.isolation_confirmed !== true) {
      fail("CHAR_TASK_ISOLATION_FAILED", `Character task ${code} is not isolated for this particle.`, 502);
    }
    const enhancement = object(task.dramatic_enhancement, `char_tasks.${code}.dramatic_enhancement`);
    requireFields(enhancement, [
      "supporting_staged_goal", "antagonist_control_intent", "ensemble_pressure_direction",
      "peak_conflict_moment", "enhancement_feedback",
    ], `char_tasks.${code}.dramatic_enhancement`);
    requireFields(task, ["visible_situation", "emotion_phase_hint", "last_round_summary"], `char_tasks.${code}`);
    const participant = (chapter.participating_chars as JsonObject[]).find((item) => item.char_code === code);
    if (!participant) fail("MODEL_OUTPUT_INVALID", `Unknown character task ${code}.`, 502);
    const role = participant.role_type;
    if (role === "protagonist") {
      requireFields(task, ["newly_perceivable_particles", "long_term_promise"], `char_tasks.${code}`);
      if (has(task, "staged_goal_injected") && task.staged_goal_injected !== null) {
        fail("CHAR_TASK_ISOLATION_FAILED", "The protagonist received staged_goal_injected.", 502);
      }
      if (task.staged_goal_injected === null) delete task.staged_goal_injected;
    } else {
      requireFields(task, ["staged_goal_injected"], `char_tasks.${code}`);
      if (role === "ensemble") requireFields(task, ["sartre_dilemma_anchor"], `char_tasks.${code}`);
    }
    if (byCode.has(code)) fail("MODEL_OUTPUT_INVALID", `Duplicate character task ${code}.`, 502);
    byCode.set(code, task);
  }
  if (byCode.size !== (chapter.participating_chars as unknown[]).length) {
    fail("MODEL_OUTPUT_INVALID", "The director did not return one task per participating character.", 502);
  }
  return byCode;
}

function lastRoundVisibleEvents(records: JsonObject[], recipientCode: string): JsonObject[] | null {
  const previous = records.at(-1);
  if (!previous) return null;
  const events = array(previous.events_in_round, "truth_ledger.events_in_round");
  const deliveries = events.flatMap((eventValue) => {
    const event = object(eventValue, "truth_ledger.event");
    if (event.recipient_char !== recipientCode) return [];
    return [{
      event_id: event.event_id,
      source_char: event.source_char,
      recipient_char: event.recipient_char,
      delivery_channel: event.delivery_channel,
      delivery_payload: event.delivery_payload,
    }];
  });
  return deliveries;
}

function packageCharacterTasks(tasks: Map<string, JsonObject>, records: JsonObject[]): void {
  for (const [charCode, task] of tasks) {
    // The director may set reveal instructions, but only the backend truth ledger
    // determines what a role receives from the preceding particle.
    task.last_round_summary = lastRoundVisibleEvents(records, charCode);
  }
}

function validateModelOutput<T>(validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    if (error instanceof DeductionServiceError && error.code === "INVALID_REQUEST") {
      throw new DeductionServiceError("MODEL_OUTPUT_INVALID", error.message, 502);
    }
    throw error;
  }
}

function normalizeRedundantCharacterId(
  value: unknown,
  expectedCode: string,
  expectedCharacterId: string,
): JsonObject {
  const result = object(value, `character_result.${expectedCode}`);
  if (!has(result, "character_id") || result.char_code !== expectedCode) return result;
  if (uuid(result.character_id, `character_result.${expectedCode}.character_id`) !== expectedCharacterId) {
    return result;
  }
  const { character_id: _characterId, ...canonical } = result;
  return canonical;
}

function validateCharacterResult(
  value: unknown,
  expectedCode: string,
  expectedCharacterId: string,
  roleType: unknown,
): JsonObject {
  const result = normalizeRedundantCharacterId(value, expectedCode, expectedCharacterId);
  assertNoForbiddenOutput(result, `character_result.${expectedCode}`);
  const required = [
    "char_code", "knowledge_snapshot", "info_gap_exploited", "l3_activation", "trigger_check",
    "real_intent", "hidden_goal", "misread", "misread_impact", "dual_spiral", "candidate_actions",
    "baseline_comparison", "chain_reaction_risk", "unresolved_risk", "internal_drive_tension",
    "hidden_resistance",
  ];
  closed(
    result,
    [...required, "amplification_type", "sartre_anchor_used"],
    `character_result.${expectedCode}`,
  );
  requireFields(result, required, `character_result.${expectedCode}`);
  if (roleType === "ensemble") {
    requireFields(result, ["amplification_type", "sartre_anchor_used"], `character_result.${expectedCode}`);
  }
  if (result.char_code !== expectedCode) fail("MODEL_OUTPUT_INVALID", "Character result identity mismatch.", 502);
  normalizeKnowledge(result.knowledge_snapshot, `character_result.${expectedCode}.knowledge_snapshot`);
  const actions = array(result.candidate_actions, `character_result.${expectedCode}.candidate_actions`);
  if (!actions.length) fail("MODEL_OUTPUT_INVALID", "candidate_actions must contain at least one action.", 502);
  for (const actionValue of actions) {
    const action = object(actionValue, "candidate_action");
    requireFields(action, [
      "action_id", "action_type", "surface_action", "tactic_ref", "deep_motivation", "root_basis",
      "boundary_check", "audit_block", "audit_block_reason", "memory_evidence", "scene_coupling",
      "utilized_conditions",
    ], "candidate_action");
    string(action.action_id, "candidate_action.action_id");
    if (typeof action.audit_block !== "boolean") {
      fail("MODEL_OUTPUT_INVALID", "candidate_action.audit_block must be boolean.", 502);
    }
  }
  const resistances = array(result.hidden_resistance, `character_result.${expectedCode}.hidden_resistance`);
  for (const resistanceValue of resistances) {
    const resistance = object(resistanceValue, "hidden_resistance[]");
    requireFields(resistance, ["type", "description"], "hidden_resistance[]");
    string(resistance.type, "hidden_resistance[].type");
    string(resistance.description, "hidden_resistance[].description");
  }
  return result;
}

function selfCheckPasses(value: unknown): boolean {
  const check = object(value, "director_convergence.self_check");
  const fields = ["emotion", "hook", "pivot"] as const;
  requireFields(check, fields, "director_convergence.self_check");
  return fields.every((key) => check[key] === true || check[key] === "pass");
}

function assignBackendParticleSequence(
  value: unknown,
  completed: number,
  total: number,
  tokenBudgetExceeded: boolean,
): JsonObject {
  const result = object(value, "director_convergence");
  return {
    ...result,
    particles_completed: completed,
    remaining_particles: total - completed,
    deduction_complete: completed === total,
    token_budget_exceeded: tokenBudgetExceeded,
  };
}

function normalizeDerivedConvergenceControls(value: unknown): JsonObject {
  const result = object(value, "director_convergence");
  if (has(result, "retry_required")) return result;

  const status = result.particle_status;
  if (!(["completed", "pending", "blocked"] as const).includes(status as "completed" | "pending" | "blocked")) {
    return result;
  }
  if (!has(result, "self_check")) return result;

  return {
    ...result,
    retry_required: !(status === "completed" && selfCheckPasses(result.self_check)),
  };
}

function normalizeKnownConvergenceAliases(value: unknown): JsonObject {
  const result = object(value, "director_convergence");
  if (has(result, "dual_spiral_verdict") || !has(result, "dual_spiral_verrix")) return result;

  const { dual_spiral_verrix: dualSpiralVerdict, ...canonical } = result;
  return { ...canonical, dual_spiral_verdict: dualSpiralVerdict };
}

function validateConvergence(
  value: unknown,
  expectedParticle: JsonObject | undefined,
  expectedCompleted?: number,
  expectedTotal?: number,
  characterResults?: JsonObject[],
  checkpointCharacterCodes?: string[],
): JsonObject {
  assertNoForbiddenOutput(value, "director_convergence");
  const result = normalizeDerivedConvergenceControls(normalizeKnownConvergenceAliases(value));
  const requiredFields = [
    "particle_id", "particle_status", "p0_precheck", "events_in_round", "dual_spiral_verdict",
    "rebellion_record", "emotion_band", "state_diff", "relation_diff", "memory_changes", "particles_completed",
    "particle_completion_evidence", "remaining_particles", "retry_required", "deduction_complete",
    "hook_signals", "alt_paths", "chain_reaction_candidates", "self_check", "next_round_focus",
    "token_budget_exceeded",
  ] as const;
  closed(result, requiredFields, "director_convergence");
  requireFields(result, requiredFields, "director_convergence");
  if (expectedParticle && result.particle_id !== expectedParticle.particle_id) {
    fail("MODEL_OUTPUT_INVALID", "Director convergence particle identity mismatch.", 502);
  }
  if (!["completed", "pending", "blocked"].includes(String(result.particle_status))) {
    fail("MODEL_OUTPUT_INVALID", "particle_status is invalid.", 502);
  }
  const events = array(result.events_in_round, "director_convergence.events_in_round");
  const eventIds = new Set<string>();
  const characterCodes = new Set(characterResults
    ? characterResults.map((characterResult) => characterResult.char_code as string)
    : checkpointCharacterCodes ?? []);
  const candidateActions = characterResults?.flatMap((characterResult) => (
    characterResult.candidate_actions as JsonObject[]
  ));
  for (const eventValue of events) {
    const event = object(eventValue, "events_in_round[]");
    requireFields(event, [
      "event_id", "description", "primary_char", "participating_chars", "is_particle_advancing",
      "is_short_climax", "key_choices", "why_selected",
    ], "events_in_round[]");
    const eventId = string(event.event_id, "events_in_round[].event_id");
    if (eventIds.has(eventId)) {
      fail("MODEL_OUTPUT_INVALID", "events_in_round contains a duplicate event_id.", 502);
    }
    eventIds.add(eventId);
    array(event.participating_chars, "events_in_round[].participating_chars").map((participant, index) => string(
      participant,
      `events_in_round[].participating_chars[${index}]`,
    ));
    const deliveryFields = ["source_char", "recipient_char", "delivery_channel", "delivery_payload"];
    const hasDelivery = deliveryFields.some((field) => has(event, field));
    if (hasDelivery) {
      requireFields(event, deliveryFields, "events_in_round[]");
      const sourceChar = string(event.source_char, "events_in_round[].source_char");
      const recipientChar = string(event.recipient_char, "events_in_round[].recipient_char");
      if (!characterCodes.has(sourceChar) || !characterCodes.has(recipientChar) || sourceChar === recipientChar) {
        fail("MODEL_OUTPUT_INVALID", "A selected delivery must connect two participating characters.", 502);
      }
      string(event.delivery_channel, "events_in_round[].delivery_channel");
      if (string(event.delivery_payload, "events_in_round[].delivery_payload") !== event.description) {
        fail("MODEL_OUTPUT_INVALID", "A delivery payload must be the selected event's observable description.", 502);
      }
    }
    if (event.audit_block === true) fail("P0_ACTION_SELECTED", "An audit-blocked event was selected.", 502);
    const choices = array(event.key_choices, "events_in_round[].key_choices");
    if (candidateActions) {
      if (!choices.length) {
        fail("MODEL_OUTPUT_INVALID", "Each selected event must reference a candidate action.", 502);
      }
      for (const choiceValue of choices) {
        const choice = string(choiceValue, "events_in_round[].key_choices[]");
        const matching = candidateActions.filter((action) => action.action_id === choice);
        if (!matching.length) {
          fail("MODEL_OUTPUT_INVALID", "A selected event referenced an unknown candidate action.", 502);
        }
        if (matching.some((action) => action.audit_block === true)) {
          fail("P0_ACTION_SELECTED", "An audit-blocked candidate action was selected.", 502);
        }
        if (matching.some((action) => action.scene_coupling === "失真")) {
          fail("MODEL_OUTPUT_INVALID", "A scene-distorted candidate action was selected.", 502);
        }
      }
    }
  }
  const stateDiff = array(result.state_diff, "director_convergence.state_diff");
  for (const diffValue of stateDiff) {
    const diff = object(diffValue, "state_diff[]");
    requireFields(diff, ["entity_type", "entity_id", "after", "event_ids"], "state_diff[]");
    const entityType = string(diff.entity_type, "state_diff[].entity_type");
    if (!new Set(["character_live_state", "world_state"]).has(entityType)) {
      fail("MODEL_OUTPUT_INVALID", "state_diff.entity_type is invalid.", 502);
    }
    uuid(diff.entity_id, "state_diff[].entity_id");
    object(diff.after, "state_diff[].after");
    eventIdsForChange(diff.event_ids, "state_diff[].event_ids", eventIds);
    if (entityType === "character_live_state") {
      requireFields(diff, ["change_type", "change_layer", "change_reason"], "state_diff[]");
      string(diff.change_type, "state_diff[].change_type");
      const changeLayer = diff.change_layer;
      if (!Number.isInteger(changeLayer) || Number(changeLayer) < 0 || Number(changeLayer) > 3) {
        fail("MODEL_OUTPUT_INVALID", "state_diff.change_layer must be between 0 and 3.", 502);
      }
      string(diff.change_reason, "state_diff[].change_reason");
      liveStateSnapshot(diff.after, "state_diff[].after");
    }
  }
  const relationDiff = array(result.relation_diff, "director_convergence.relation_diff");
  for (const diffValue of relationDiff) {
    const diff = object(diffValue, "relation_diff[]");
    requireFields(diff, ["relation_state_id", "after", "change_event", "event_ids"], "relation_diff[]");
    uuid(diff.relation_state_id, "relation_diff[].relation_state_id");
    relationSnapshot(diff.after, "relation_diff[].after");
    object(diff.change_event, "relation_diff[].change_event");
    eventIdsForChange(diff.event_ids, "relation_diff[].event_ids", eventIds);
  }
  const memoryChanges = array(result.memory_changes, "director_convergence.memory_changes");
  for (const memoryValue of memoryChanges) {
    const memory = object(memoryValue, "memory_changes[]");
    requireFields(memory, [
      "character_id", "memory_type", "memory_content", "truth_status", "importance", "decay_rate", "event_ids",
    ], "memory_changes[]");
    uuid(memory.character_id, "memory_changes[].character_id");
    if (!MEMORY_TYPES.has(string(memory.memory_type, "memory_changes[].memory_type"))) {
      fail("MODEL_OUTPUT_INVALID", "memory_changes.memory_type is invalid.", 502);
    }
    string(memory.memory_content, "memory_changes[].memory_content");
    if (!MEMORY_TRUTH_STATUSES.has(string(memory.truth_status, "memory_changes[].truth_status"))) {
      fail("MODEL_OUTPUT_INVALID", "memory_changes.truth_status is invalid.", 502);
    }
    numberInRange(memory.importance, "memory_changes[].importance", 0, 1);
    numberInRange(memory.decay_rate, "memory_changes[].decay_rate", 0, 1);
    eventIdsForChange(memory.event_ids, "memory_changes[].event_ids", eventIds);
  }
  const band = object(result.emotion_band, "director_convergence.emotion_band");
  const bandType = string(band.band_type, "emotion_band.band_type");
  if (!["LOW", "HIGH", "PLATFORM"].includes(bandType)) fail("MODEL_OUTPUT_INVALID", "emotion band is invalid.", 502);
  const entityChanges = array(band.entity_change_type, "emotion_band.entity_change_type");
  if (typeof band.emotion_justified !== "boolean"
    || (["LOW", "HIGH"].includes(bandType) && (!entityChanges.length || band.emotion_justified !== true))) {
    fail("MODEL_OUTPUT_INVALID", "LOW/HIGH emotion bands require a justified entity change.", 502);
  }
  array(result.hook_signals, "director_convergence.hook_signals");
  array(result.alt_paths, "director_convergence.alt_paths");
  array(result.chain_reaction_candidates, "director_convergence.chain_reaction_candidates");
  array(result.particle_completion_evidence, "director_convergence.particle_completion_evidence");
  if (expectedCompleted !== undefined && expectedTotal !== undefined) {
    if (integer(result.particles_completed, "director_convergence.particles_completed") !== expectedCompleted
      || integer(result.remaining_particles, "director_convergence.remaining_particles") !== expectedTotal - expectedCompleted
      || result.deduction_complete !== (expectedCompleted === expectedTotal)) {
      fail("MODEL_OUTPUT_INVALID", "Director completion counters do not match the particle sequence.", 502);
    }
  }
  if (typeof result.retry_required !== "boolean"
    || typeof result.deduction_complete !== "boolean"
    || typeof result.token_budget_exceeded !== "boolean") {
    fail("MODEL_OUTPUT_INVALID", "Director convergence flags are invalid.", 502);
  }
  selfCheckPasses(result.self_check);
  return result;
}

function selectedEventParticipants(result: JsonObject): Map<string, Set<string>> {
  const participants = new Map<string, Set<string>>();
  for (const eventValue of result.events_in_round as unknown[]) {
    const event = object(eventValue, "events_in_round[]");
    participants.set(
      event.event_id as string,
      new Set((event.participating_chars as unknown[]).map((entry, index) => (
        string(entry, `events_in_round[].participating_chars[${index}]`)
      ))),
    );
  }
  return participants;
}

function participantReceivesEvent(
  result: JsonObject,
  eventId: string,
  characterCode: string,
): boolean {
  const event = (result.events_in_round as JsonObject[])
    .find((candidate) => candidate.event_id === eventId);
  if (!event) return false;
  return (event.participating_chars as unknown[]).includes(characterCode)
    || event.recipient_char === characterCode;
}

function materializeCandidateTruth(
  result: JsonObject,
  state: CandidateTruthState,
  plot: JsonObject,
): void {
  const ledger = candidateTruthLedger(plot.candidate_truth_ledger, "candidate_plot_sim_json.candidate_truth_ledger");
  const eventParticipants = selectedEventParticipants(result);
  const worldChanges = ledger.world_changes as JsonObject[];
  const characterChanges = ledger.character_live_state_changes as JsonObject[];
  const relationChanges = ledger.relation_changes as JsonObject[];
  const memories = ledger.memories as JsonObject[];
  const normalizedStateDiff: JsonObject[] = [];
  const seenStateChanges = new Set<string>();

  for (const diffValue of result.state_diff as unknown[]) {
    const diff = object(diffValue, "state_diff[]");
    const entityType = diff.entity_type as string;
    const entityId = diff.entity_id as string;
    const eventIds = diff.event_ids as string[];
    if (entityType === "world_state") {
      if (seenStateChanges.has(`${entityType}:${entityId}`)) {
        fail("MODEL_OUTPUT_INVALID", "A particle cannot write the same candidate state twice.", 502);
      }
      seenStateChanges.add(`${entityType}:${entityId}`);
      const before = state.worlds.get(entityId);
      if (!before) fail("MODEL_OUTPUT_INVALID", "A world change is outside the formal execution context.", 502);
      const after = object(diff.after, "state_diff[].after");
      if (jsonEqual(before, after)) fail("MODEL_OUTPUT_INVALID", "A world change must alter its current value.", 502);
      const entry = {
        world_state_id: entityId,
        before: structuredClone(before),
        after: structuredClone(after),
        event_ids: structuredClone(eventIds),
      };
      state.worlds.set(entityId, structuredClone(after));
      mergeCandidateChange(worldChanges, "world_state_id", entry);
      normalizedStateDiff.push({ entity_type: entityType, entity_id: entityId, ...entry });
      continue;
    }

    const before = state.characters.get(entityId);
    const characterCode = state.characterCodes.get(entityId);
    if (!before || !characterCode) {
      fail("MODEL_OUTPUT_INVALID", "A character change is outside the formal execution context.", 502);
    }
    if (eventIds.some((eventId) => !eventParticipants.get(eventId)?.has(characterCode))) {
      fail("MODEL_OUTPUT_INVALID", "A character change must reference an event in which that role appears.", 502);
    }
    const after = liveStateSnapshot(diff.after, "state_diff[].after");
    // A complete but unchanged snapshot is not a candidate change. Preserve
    // all scope and event checks above, then omit it from F4's truth ledger.
    if (jsonEqual(before, after)) continue;
    if (seenStateChanges.has(`${entityType}:${entityId}`)) {
      fail("MODEL_OUTPUT_INVALID", "A particle cannot write the same candidate state twice.", 502);
    }
    seenStateChanges.add(`${entityType}:${entityId}`);
    const entry = {
      character_id: entityId,
      before: structuredClone(before),
      after: structuredClone(after),
      change_type: diff.change_type as string,
      change_layer: diff.change_layer as number,
      change_reason: diff.change_reason as string,
      event_ids: structuredClone(eventIds),
    };
    state.characters.set(entityId, structuredClone(after));
    mergeCandidateChange(characterChanges, "character_id", entry);
    normalizedStateDiff.push({ entity_type: entityType, entity_id: entityId, ...entry });
  }
  result.state_diff = normalizedStateDiff;

  const normalizedRelationDiff: JsonObject[] = [];
  const seenRelations = new Set<string>();
  for (const diffValue of result.relation_diff as unknown[]) {
    const diff = object(diffValue, "relation_diff[]");
    const relationId = diff.relation_state_id as string;
    if (seenRelations.has(relationId)) {
      fail("MODEL_OUTPUT_INVALID", "A particle cannot write the same candidate relation twice.", 502);
    }
    seenRelations.add(relationId);
    const before = state.relations.get(relationId);
    const [charA, charB] = state.relationParticipants.get(relationId) ?? [];
    const charACode = charA ? state.characterCodes.get(charA) : undefined;
    const charBCode = charB ? state.characterCodes.get(charB) : undefined;
    if (!before || !charA || !charB || !charACode || !charBCode) {
      fail("MODEL_OUTPUT_INVALID", "A relation change is outside the formal execution context.", 502);
    }
    const eventIds = diff.event_ids as string[];
    if (eventIds.some((eventId) => {
      const participants = eventParticipants.get(eventId);
      return !participants?.has(charACode) || !participants.has(charBCode);
    })) {
      fail("MODEL_OUTPUT_INVALID", "A relation change must reference an event containing both roles.", 502);
    }
    const after = relationSnapshot(diff.after, "relation_diff[].after");
    if (jsonEqual(before, after)) fail("MODEL_OUTPUT_INVALID", "A relation change must alter its current snapshot.", 502);
    const entry = {
      relation_state_id: relationId,
      char_a_id: charA,
      char_b_id: charB,
      before: structuredClone(before),
      after: structuredClone(after),
      change_event: structuredClone(diff.change_event),
      event_ids: structuredClone(eventIds),
    };
    state.relations.set(relationId, structuredClone(after));
    mergeCandidateChange(relationChanges, "relation_state_id", entry);
    normalizedRelationDiff.push(structuredClone(entry));
  }
  result.relation_diff = normalizedRelationDiff;

  const normalizedMemories: JsonObject[] = [];
  for (const memoryValue of result.memory_changes as unknown[]) {
    const memory = object(memoryValue, "memory_changes[]");
    const characterId = memory.character_id as string;
    const characterCode = state.characterCodes.get(characterId);
    const eventIds = memory.event_ids as string[];
    if (!characterCode || eventIds.some((eventId) => !participantReceivesEvent(result, eventId, characterCode))) {
      fail("MODEL_OUTPUT_INVALID", "A candidate memory must belong to a role that received its event.", 502);
    }
    const entry = {
      character_id: characterId,
      memory_type: memory.memory_type as string,
      memory_content: memory.memory_content as string,
      truth_status: memory.truth_status as string,
      importance: memory.importance as number,
      decay_rate: memory.decay_rate as number,
      event_ids: structuredClone(eventIds),
    };
    if (!memories.some((candidate) => sameCandidateMemory(candidate, entry))) {
      memories.push(structuredClone(entry));
    }
    appendCandidateMemory(state, entry);
    if (!normalizedMemories.some((candidate) => sameCandidateMemory(candidate, entry))) {
      normalizedMemories.push(entry);
    }
  }
  result.memory_changes = normalizedMemories;
}

function buildProgress(checkpoint: JsonObject | undefined, particleCount: number): JsonObject {
  if (checkpoint) return structuredClone(checkpoint.deduction_progress_json as JsonObject);
  return {
    current_particle_index: 0,
    remaining_particles: particleCount,
    token_consumed: 0,
    token_budget: FP008_TOKEN_BUDGET,
    token_budget_version: FP008_TOKEN_BUDGET_VERSION,
    token_budget_exceeded: false,
    deduction_complete: false,
    reject_count: 0,
  };
}

function buildPlot(checkpoint: JsonObject | undefined, chapter: JsonObject): JsonObject {
  if (checkpoint) return structuredClone(checkpoint.candidate_plot_sim_json as JsonObject);
  return {
    deduction_input_snapshot: {
      particles: structuredClone(chapter.particles),
      participating_chars: structuredClone(chapter.participating_chars),
    },
    particles_records: [],
    candidate_truth_ledger: emptyCandidateTruthLedger(),
    chapter_summary: null,
  };
}

function chapterSummary(records: JsonObject[]): JsonObject {
  const eventCount = records.reduce((total, record) => total + (record.events_in_round as unknown[]).length, 0);
  return {
    summary: `已完成 ${records.length} 个推演颗粒，记录 ${eventCount} 个结构化事件。`,
    completed_particle_count: records.length,
    event_count: eventCount,
  };
}

export function createDeductionEngine({
  invokeModel,
  now = () => new Date().toISOString(),
  onAttempt,
}: {
  invokeModel: ModelInvoker;
  now?: () => string;
  onAttempt?: EngineAttemptObserver;
}) {
  if (typeof invokeModel !== "function") throw new TypeError("invokeModel is required");
  const projections = new Map<string, JsonObject>();
  const active = new Set<string>();
  const pauseRequests = new Set<string>();
  const observedCallUsage = new Map<string, number>();
  const inFlightReservations = new Map<string, number>();

  function getProjection(scopeValue: unknown): JsonObject | null {
    const projection = projections.get(scopeKey(normalizeScope(scopeValue)));
    return projection ? structuredClone(projection) : null;
  }

  function requestPause(scopeValue: unknown): JsonObject {
    const scope = normalizeScope(scopeValue);
    const key = scopeKey(scope);
    if (!active.has(key)) fail("DEDUCTION_NOT_RUNNING", "This L1A deduction is not running.", 409);
    const projection = projections.get(key);
    if (!projection) fail("DEDUCTION_NOT_RUNNING", "This L1A deduction is not running.", 409);
    pauseRequests.add(key);
    projection.service_state = "pause_requested";
    projection.updated_at = now();
    return structuredClone(projection);
  }

  async function invokeWithRetry(
    invocation: ModelInvocation,
    projection: JsonObject,
    chapterProjection: JsonObject,
  ): Promise<unknown> {
    const runKey = String(projection.l1a_unit_id);
    const chargeUsage = (tokens: number) => {
      observedCallUsage.set(runKey, Math.max(observedCallUsage.get(runKey) ?? 0, tokens));
      projection.token_consumed = (projection.token_consumed as number) + tokens;
      const progress = chapterProjection.deduction_progress_json as JsonObject;
      progress.token_consumed = (progress.token_consumed as number) + tokens;
      if ((projection.token_consumed as number) >= FP008_TOKEN_BUDGET) {
        projection.token_budget_exceeded = true;
        progress.token_budget_exceeded = true;
      }
      projection.updated_at = now();
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const estimatedUsage = invokeModel.estimateTokenUsage?.(invocation);
      const reserve = nextCallTokenReserve(
        invocation.binding,
        observedCallUsage.get(runKey),
        estimatedUsage,
      );
      const inFlightReserved = inFlightReservations.get(runKey) ?? 0;
      if ((projection.token_consumed as number) + inFlightReserved + reserve > FP008_TOKEN_BUDGET) {
        throw new BudgetReached();
      }
      inFlightReservations.set(runKey, inFlightReserved + reserve);
      try {
        const reply = await invokeModel(invocation);
        const replyObject = object(reply, "model_reply");
        const usage = object(replyObject.usage, "model_reply.usage");
        const tokens = integer(usage.total_tokens, "model_reply.usage.total_tokens");
        chargeUsage(tokens);
        return replyObject.output;
      } catch (error) {
        if (error instanceof DeductionServiceError) {
          if (isExhaustedProviderFailure(error)) {
            observeEngineAttempt(onAttempt, {
              source: "engine", nodeCode: invocation.nodeCode, mode: invocation.mode,
              engine_attempt: attempt + 1, outcome: "blocked", error_category: "transport_or_internal",
              error_code: error.code, provider_status: typeof error.diagnostics?.provider_status === "number" ? error.diagnostics.provider_status : null,
              retry_scheduled: false,
            });
            throw new ModelCallBlocked();
          }
          // Only a 2xx adapter response that could not be parsed is transient here.
          // Engine validators and business failures remain fail-closed.
          if (!error.retryable) {
            observeEngineAttempt(onAttempt, {
              source: "engine", nodeCode: invocation.nodeCode, mode: invocation.mode,
              engine_attempt: attempt + 1, outcome: "failed", error_category: "deduction",
              error_code: error.code, provider_status: typeof error.diagnostics?.provider_status === "number" ? error.diagnostics.provider_status : null,
              retry_scheduled: false,
            });
            throw error;
          }
          const chargedTokens = error.diagnostics?.provider_total_tokens;
          if (typeof chargedTokens === "number" && Number.isSafeInteger(chargedTokens) && chargedTokens >= 0) {
            chargeUsage(chargedTokens);
          }
          if (attempt === 2) {
            observeEngineAttempt(onAttempt, {
              source: "engine", nodeCode: invocation.nodeCode, mode: invocation.mode,
              engine_attempt: attempt + 1, outcome: "failed", error_category: "deduction",
              error_code: error.code, provider_status: typeof error.diagnostics?.provider_status === "number" ? error.diagnostics.provider_status : null,
              retry_scheduled: false,
            });
            throw error;
          }
          observeEngineAttempt(onAttempt, {
            source: "engine", nodeCode: invocation.nodeCode, mode: invocation.mode,
            engine_attempt: attempt + 1, outcome: "retry", error_category: "deduction",
            error_code: error.code, provider_status: typeof error.diagnostics?.provider_status === "number" ? error.diagnostics.provider_status : null,
            retry_scheduled: true,
          });
          continue;
        }
        if (error instanceof BudgetReached) throw error;
        if (attempt === 2) {
          observeEngineAttempt(onAttempt, {
            source: "engine", nodeCode: invocation.nodeCode, mode: invocation.mode,
            engine_attempt: attempt + 1, outcome: "blocked", error_category: "transport_or_internal",
            error_code: null, provider_status: null, retry_scheduled: false,
          });
          throw new ModelCallBlocked();
        }
        observeEngineAttempt(onAttempt, {
          source: "engine", nodeCode: invocation.nodeCode, mode: invocation.mode,
          engine_attempt: attempt + 1, outcome: "retry", error_category: "transport_or_internal",
          error_code: null, provider_status: null, retry_scheduled: true,
        });
      } finally {
        const remaining = (inFlightReservations.get(runKey) ?? 0) - reserve;
        if (remaining > 0) inFlightReservations.set(runKey, remaining);
        else inFlightReservations.delete(runKey);
      }
    }
    throw new ModelCallBlocked();
  }

  async function run(
    command: JsonObject,
    projection: JsonObject,
    truthState: CandidateTruthState,
  ): Promise<void> {
    const scope = command.scope as JsonObject;
    const characters = command.characters as JsonObject[];
    const bindings = command.model_bindings as Record<"NODE_05" | "NODE_06", JsonObject>;
    const chapterInputs = command.chapters as JsonObject[];
    const chapterProjections = projection.chapters as JsonObject[];
    const executionKey = scopeKey(scope);
    const pauseBeforeSemanticRetry = () => {
      if (pauseRequests.has(executionKey)) throw new PauseReached();
    };
    let activeTruthState = truthState;

    try {
      if (projection.token_budget_exceeded === true && !chapterProjections.every((chapter) => (
          (chapter.deduction_progress_json as JsonObject).deduction_complete === true
        ))) {
        throw new BudgetReached();
      }
      for (let chapterOffset = 0; chapterOffset < chapterInputs.length; chapterOffset += 1) {
        const chapter = chapterInputs[chapterOffset];
        const chapterProjection = chapterProjections[chapterOffset];
        if (!chapter || !chapterProjection) fail("INVALID_REQUEST", "Chapter projection alignment failed.");
        const progress = chapterProjection.deduction_progress_json as JsonObject;
        const plot = chapterProjection.candidate_plot_sim_json as JsonObject;
        const records = plot.particles_records as JsonObject[];
        if (progress.deduction_complete === true) continue;

        const participants = (chapter.participating_chars as JsonObject[]).map((participant) => {
          const character = characters.find((candidate) => candidate.char_code === participant.char_code);
          if (!character) fail("CHARACTER_SCOPE_MISMATCH", "Participating character data disappeared.", 409);
          return character;
        });
        for (let particleIndex = progress.current_particle_index as number;
          particleIndex < (chapter.particles as JsonObject[]).length;
          particleIndex += 1) {
          const particle = (chapter.particles as JsonObject[])[particleIndex];
          if (!particle) fail("INVALID_REQUEST", "Particle index is invalid.");
          let completed = false;
          let lastConvergence: JsonObject | null = null;
          let selfCheckFailures = 0;
          let distributionOutputRetries = 0;
          let distributionSessionReset = false;
          let convergenceOutputRetries = 0;
          let convergenceRepair: JsonObject | null = null;
          let retrySequence = 0;
          let tasks: Map<string, JsonObject> | null = null;
          let characterResults: JsonObject[] | null = null;

          for (;;) {
            const directorSession = sessionKey(scope, chapter);
            const resetDirectorSession = () => {
              invokeModel.clearSession?.(directorSession);
              distributionSessionReset = true;
            };
            if (tasks === null || characterResults === null) {
              const distributionOutput = await invokeWithRetry({
                nodeCode: "NODE_06",
                mode: "director_distribute",
                binding: bindings.NODE_06,
                sessionKey: directorSession,
                continueSession: (particleIndex > 0 || retrySequence > 0) && !distributionSessionReset,
                input: {
                  scope,
                  creator_direction: command.creator_direction ?? null,
                  particle,
                  target_snapshot_json: chapter.target_snapshot_json,
                  remaining_particles: (chapter.particles as JsonObject[]).slice(particleIndex),
                  scene_condition_package: chapter.scene_condition_package,
                  participating_roles: directorParticipantRoles(chapter),
                  previous_particle_records: lightPreviousParticleRecords(records),
                },
              }, projection, chapterProjection);
              try {
                tasks = validateModelOutput(() => validateDistribution(distributionOutput, chapter, particle));
              } catch (error) {
                if (error instanceof DeductionServiceError
                  && error.code === "MODEL_OUTPUT_INVALID"
                  && distributionOutputRetries < 2) {
                  // Do not feed an already parsed but semantically invalid
                  // assistant reply back into the next F1 attempt.
                  pauseBeforeSemanticRetry();
                  resetDirectorSession();
                  distributionOutputRetries += 1;
                  retrySequence += 1;
                  continue;
                }
                throw error;
              }
              distributionSessionReset = false;
              packageCharacterTasks(tasks, records);
              if (projection.token_budget_exceeded === true) throw new BudgetReached();

              const settledCharacterResults = await Promise.allSettled(participants.map(async (character) => {
                const code = character.char_code as string;
                const task = tasks?.get(code);
                if (!task) fail("MODEL_OUTPUT_INVALID", `Missing task for ${code}.`, 502);
                const projectedState = activeTruthState.characters.get(character.character_id as string);
                const projectedMemories = activeTruthState.memories.get(character.character_id as string);
                if (!projectedState || !projectedMemories) {
                  fail("CANDIDATE_TRUTH_DRIFT", "The role projection is unavailable for the current particle.", 409);
                }
                for (let roleOutputAttempt = 0; roleOutputAttempt < 3; roleOutputAttempt += 1) {
                  const output = await invokeWithRetry({
                    nodeCode: "NODE_05",
                    mode: "character_respond",
                    binding: bindings.NODE_05,
                    sessionKey: `${directorSession}:${particle.particle_id}:${code}:${retrySequence}:${roleOutputAttempt}`,
                    continueSession: false,
                    input: {
                      scope,
                      particle_id: particle.particle_id,
                      char_task: task,
                      character: {
                        character_id: character.character_id,
                        char_code: character.char_code,
                        role_type: character.role_type,
                        five_layers_json: character.five_layers_json,
                        knowledge_boundary_json: roleKnowledgeBoundary(character),
                        live_state_json: structuredClone(projectedState),
                        active_memory_json: structuredClone(projectedMemories),
                      },
                    },
                  }, projection, chapterProjection);
                  try {
                    return validateModelOutput(() => validateCharacterResult(
                      output,
                      code,
                      character.character_id as string,
                      character.role_type,
                    ));
                  } catch (error) {
                    if (!(error instanceof DeductionServiceError)
                      || error.code !== "MODEL_OUTPUT_INVALID"
                      || roleOutputAttempt === 2) throw error;
                    pauseBeforeSemanticRetry();
                  }
                }
                throw new Error("Unreachable character output retry state.");
              }));
              const successfulCharacterResults: JsonObject[] = [];
              for (const settledResult of settledCharacterResults) {
                if (settledResult.status === "rejected") throw settledResult.reason;
                successfulCharacterResults.push(settledResult.value);
              }
              characterResults = successfulCharacterResults;
              if (projection.token_budget_exceeded === true) throw new BudgetReached();
            }

            if (!tasks || !characterResults) fail("INTERNAL_ERROR", "The particle role results were not prepared.", 500);
            const roleResults = characterResults;

            const allSafeActions = roleResults.some((result) => (
              (result.candidate_actions as JsonObject[]).some((action) => (
                action.audit_block === false && action.scene_coupling !== "失真"
              ))
            ));
            if (!allSafeActions) {
              pauseBeforeSemanticRetry();
              tasks = null;
              characterResults = null;
              lastConvergence = null;
              retrySequence += 1;
              continue;
            }

            const convergenceOutput = await invokeWithRetry({
              nodeCode: "NODE_06",
              mode: "director_converge",
              binding: bindings.NODE_06,
              sessionKey: directorSession,
              continueSession: true,
              input: {
                scope,
                creator_direction: command.creator_direction ?? null,
                particle,
                target_snapshot_json: chapter.target_snapshot_json,
                character_candidate_actions: candidateActionsForDirector(roleResults),
                scene_condition_package: chapter.scene_condition_package,
                previous_particle_records: lightPreviousParticleRecords(records),
                candidate_state_context: directorCandidateStateContext(activeTruthState, participants),
                particle_sequence: {
                  particles_completed: particleIndex + 1,
                  remaining_particles: (chapter.particles as JsonObject[]).length - particleIndex - 1,
                  deduction_complete: particleIndex + 1 === (chapter.particles as JsonObject[]).length,
                },
                token_consumed: projection.token_consumed,
                token_budget: FP008_TOKEN_BUDGET,
                ...(convergenceRepair ? { convergence_repair: convergenceRepair } : {}),
              },
            }, projection, chapterProjection);
            try {
              lastConvergence = validateModelOutput(() => (
                validateConvergence(
                  assignBackendParticleSequence(
                    convergenceOutput,
                    particleIndex + 1,
                    (chapter.particles as JsonObject[]).length,
                    projection.token_budget_exceeded === true,
                  ),
                  particle,
                  particleIndex + 1,
                  (chapter.particles as JsonObject[]).length,
                  roleResults,
                )
              ));
            } catch (error) {
              if (error instanceof DeductionServiceError && error.code === "P0_ACTION_SELECTED") {
                pauseBeforeSemanticRetry();
                resetDirectorSession();
                retrySequence += 1;
                continue;
              }
              if (error instanceof DeductionServiceError && error.code === "MODEL_OUTPUT_INVALID"
                && convergenceOutputRetries < 2) {
                if (error.message === "A relation change must reference an event containing both roles.") {
                  convergenceRepair = relationConvergenceRepairFeedback(convergenceOutput, activeTruthState);
                }
                pauseBeforeSemanticRetry();
                resetDirectorSession();
                convergenceOutputRetries += 1;
                retrySequence += 1;
                continue;
              }
              throw error;
            }
            convergenceRepair = null;
            const passes = selfCheckPasses(lastConvergence.self_check);
            if (lastConvergence.particle_status === "completed" && passes && lastConvergence.retry_required === false) {
              try {
                const stagedState = cloneCandidateTruthState(activeTruthState);
                const stagedPlot = structuredClone(plot);
                validateModelOutput(() => materializeCandidateTruth(lastConvergence as JsonObject, stagedState, stagedPlot));
                activeTruthState = stagedState;
                plot.candidate_truth_ledger = stagedPlot.candidate_truth_ledger;
              } catch (error) {
                if (error instanceof DeductionServiceError
                  && error.code === "MODEL_OUTPUT_INVALID"
                  && convergenceOutputRetries < 2) {
                  if (error.message === "A relation change must reference an event containing both roles.") {
                    convergenceRepair = relationConvergenceRepairFeedback(lastConvergence, activeTruthState);
                  }
                  pauseBeforeSemanticRetry();
                  resetDirectorSession();
                  convergenceOutputRetries += 1;
                  tasks = null;
                  characterResults = null;
                  lastConvergence = null;
                  retrySequence += 1;
                  continue;
                }
                throw error;
              }
              records.push(lastConvergence);
              progress.current_particle_index = particleIndex + 1;
              progress.remaining_particles = (chapter.particles as JsonObject[]).length - particleIndex - 1;
              projection.updated_at = now();
              completed = true;
              break;
            }
            if (!passes) {
              selfCheckFailures += 1;
              if (selfCheckFailures >= 3) break;
              pauseBeforeSemanticRetry();
              resetDirectorSession();
              tasks = null;
              characterResults = null;
              retrySequence += 1;
              continue;
            }
            if (lastConvergence.particle_status === "blocked") {
              fail("MODEL_OUTPUT_INVALID", "Only the engine can block a particle after three failed self-checks.", 502);
            }
            pauseBeforeSemanticRetry();
            resetDirectorSession();
            retrySequence += 1;
          }

          if (!completed) {
            if (lastConvergence && lastConvergence.particle_status !== "blocked") {
              lastConvergence = { ...lastConvergence, particle_status: "blocked", retry_required: false };
            }
            if (lastConvergence && !records.some((record) => record.particle_id === particle.particle_id)) {
              records.push(lastConvergence);
            }
            projection.service_state = "blocked";
            projection.blocked_code = "DEDUCTION_BLOCKED";
            projection.updated_at = now();
            return;
          }
          const hasRemainingWork = particleIndex + 1 < (chapter.particles as JsonObject[]).length
            || chapterProjections.slice(chapterOffset + 1).some((candidate) => (
              (candidate.deduction_progress_json as JsonObject).deduction_complete !== true
            ));
          if (hasRemainingWork && pauseRequests.delete(scopeKey(scope))) {
            if (particleIndex + 1 === (chapter.particles as JsonObject[]).length) {
              progress.deduction_complete = true;
              progress.remaining_particles = 0;
              plot.chapter_summary = chapterSummary(records);
            }
            projection.service_state = "paused";
            projection.updated_at = now();
            return;
          }
          if (projection.token_budget_exceeded === true
            && particleIndex + 1 < (chapter.particles as JsonObject[]).length) {
            throw new BudgetReached();
          }
        }

        progress.deduction_complete = true;
        progress.remaining_particles = 0;
        plot.chapter_summary = chapterSummary(records);
        if (projection.token_budget_exceeded === true && chapterOffset + 1 < chapterInputs.length) {
          throw new BudgetReached();
        }
      }
      projection.deduction_complete = chapterProjections.every((chapter) => (
        (chapter.deduction_progress_json as JsonObject).deduction_complete === true
      ));
      if (projection.deduction_complete === true) {
        for (const chapterProjection of chapterProjections) {
          const plot = chapterProjection.candidate_plot_sim_json as JsonObject;
          plot.chapter_summary = chapterSummary(plot.particles_records as JsonObject[]);
        }
      }
      projection.service_state = projection.deduction_complete === true ? "completed" : "paused";
      projection.updated_at = now();
    } catch (error) {
      if (error instanceof PauseReached) {
        pauseRequests.delete(executionKey);
        projection.service_state = "paused";
        projection.updated_at = now();
        return;
      }
      if (error instanceof BudgetReached) {
        projection.service_state = "paused";
        projection.token_budget_exceeded = true;
        for (const chapter of chapterProjections) {
          const progress = chapter.deduction_progress_json as JsonObject;
          if (progress.deduction_complete !== true) progress.token_budget_exceeded = true;
        }
        projection.updated_at = now();
        return;
      }
      if (error instanceof ModelCallBlocked) {
        projection.service_state = "blocked";
        projection.blocked_code = "MODEL_CALL_FAILED";
        projection.updated_at = now();
        return;
      }
      projection.service_state = "failed";
      projection.blocked_code = error instanceof DeductionServiceError ? error.code : "INTERNAL_ERROR";
      projection.updated_at = now();
      throw error;
    }
  }

  async function execute(commandValue: unknown): Promise<JsonObject> {
    const command = normalizeCommand(commandValue);
    const scope = command.scope as JsonObject;
    const key = scopeKey(scope);
    if (active.has(key)) fail("DEDUCTION_ALREADY_RUNNING", "This L1A deduction is already running.", 409);
    const previous = projections.get(key);
    if (command.action === "start" && previous) {
      fail("DEDUCTION_CONTEXT_EXISTS", "Use resume for the existing L1A deduction context.", 409);
    }
    if (command.action === "restart") observedCallUsage.delete(String(scope.l1a_unit_id));

    const commandChapters = command.chapters as JsonObject[];
    let projection: JsonObject;
    if (command.action === "resume" && previous?.service_state === "paused") {
      const previousChapters = Array.isArray(previous.chapters) ? previous.chapters as JsonObject[] : [];
      const sameChapterContext = previousChapters.length === commandChapters.length
        && previousChapters.every((chapter, index) => (
          chapter.chapter_id === commandChapters[index]?.chapter_id
          && chapter.candidate_version_id === commandChapters[index]?.chapter_version_id
        ));
      if (!sameChapterContext) {
        fail(
          "INVALID_CHECKPOINT",
          "The persisted resume request no longer matches the paused in-memory chapter context.",
          409,
        );
      }
      projection = structuredClone(previous);
      projection.service_state = "running";
      projection.updated_at = now();
    } else {
      const chapters = commandChapters.map((chapter) => {
        const checkpoint = chapter.checkpoint as JsonObject | undefined;
        const progress = buildProgress(checkpoint, (chapter.particles as JsonObject[]).length);
        return {
          chapter_id: chapter.chapter_id,
          l1a_unit_id: scope.l1a_unit_id,
          chapter_index: chapter.chapter_index,
          candidate_version_id: chapter.chapter_version_id,
          candidate_plot_sim_json: buildPlot(checkpoint, chapter),
          deduction_progress_json: progress,
          deduction_locked: false,
        };
      });
      projection = {
        book: {
          id: scope.book_id,
          current_l1a_id: scope.l1a_unit_id,
          token_budget: FP008_TOKEN_BUDGET,
          token_budget_version: FP008_TOKEN_BUDGET_VERSION,
        },
        l1a_unit_id: scope.l1a_unit_id,
        chapters,
        token_consumed: chapters.reduce((sum, chapter) => (
          sum + Number((chapter.deduction_progress_json as JsonObject).token_consumed)
        ), 0),
        token_budget: FP008_TOKEN_BUDGET,
        token_budget_version: FP008_TOKEN_BUDGET_VERSION,
        token_budget_exceeded: chapters.some((chapter) => (
          (chapter.deduction_progress_json as JsonObject).token_budget_exceeded === true
        )),
        deduction_complete: false,
        service_state: "running",
        updated_at: now(),
      };
    }
    if ((projection.token_consumed as number) >= FP008_TOKEN_BUDGET) projection.token_budget_exceeded = true;
    const truthState = candidateTruthState(command);
    for (const chapterProjection of projection.chapters as JsonObject[]) {
      const plot = chapterProjection.candidate_plot_sim_json as JsonObject;
      applyCandidateTruthLedger(truthState, plot.candidate_truth_ledger, "candidate_plot_sim_json.candidate_truth_ledger");
    }
    projections.set(key, projection);
    active.add(key);
    try {
      await run(command, projection, truthState);
      return structuredClone(projection);
    } finally {
      active.delete(key);
      pauseRequests.delete(key);
      inFlightReservations.delete(String(scope.l1a_unit_id));
      for (const chapter of command.chapters as JsonObject[]) {
        invokeModel.clearSession?.(sessionKey(scope, chapter));
      }
      // Only a paused checkpoint remains available for the documented resume path.
      // Terminal results travel in the HTTP response and are persisted by FP008-04.
      if (["completed", "failed", "blocked"].includes(String(projection.service_state))) {
        projections.delete(key);
        observedCallUsage.delete(String(scope.l1a_unit_id));
      }
    }
  }

  return Object.freeze({ execute, getProjection, requestPause });
}
