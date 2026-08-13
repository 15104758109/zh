function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstText(...values) {
  return values.map(textValue).find(Boolean) || "";
}

function relationDescription(changeEvent) {
  if (typeof changeEvent === "string") return changeEvent.trim();
  const event = objectValue(changeEvent);
  return firstText(event.change, event.summary, event.description, event.event_name);
}

function characterMemories(initialMemories, reference) {
  return initialMemories
    .filter((memory) => memory?.char_ref === reference)
    .map((memory) => textValue(memory.memory_content))
    .filter(Boolean);
}

export function buildInitialMemoryConfirmation(initialMemories, clientRefMap) {
  const memories = Array.isArray(initialMemories) ? initialMemories : [];
  const idsByReference = objectValue(clientRefMap);

  return memories.map((memory) => {
    const source = objectValue(memory);
    const confirmation = {
      char_id: textValue(idsByReference[textValue(source.char_ref)]),
      memory_type: textValue(source.memory_type),
      truth_status: textValue(source.truth_status),
      memory_content: textValue(source.memory_content),
    };
    for (const field of ["importance", "decay_rate"]) {
      if (source[field] !== undefined) confirmation[field] = source[field];
    }
    return confirmation;
  });
}

export function normalizeCharacterCandidates(candidate) {
  const source = objectValue(candidate);
  const characters = Array.isArray(source.characters) ? source.characters : [];
  const relations = Array.isArray(source.relations) ? source.relations : [];
  const initialMemories = Array.isArray(source.initial_memories) ? source.initial_memories : [];
  const namesByReference = new Map(
    characters.map((character) => [textValue(character?.client_ref), textValue(character?.char_name)]),
  );

  return characters.map((item, index) => {
    const layers = objectValue(item?.five_layers_json);
    const l0 = objectValue(layers.L0);
    const l1 = objectValue(layers.L1);
    const l2 = objectValue(layers.L2);
    const l3 = objectValue(layers.L3);
    const reference = textValue(item?.client_ref);
    const candidateRelations = relations
      .filter((relation) => relation?.from_ref === reference || relation?.to_ref === reference)
      .map((relation) => {
        const fromRef = textValue(relation?.from_ref);
        const toRef = textValue(relation?.to_ref);
        const counterpartRef = fromRef === reference ? toRef : fromRef;
        return {
          counterpart: namesByReference.get(counterpartRef) || counterpartRef,
          description: relationDescription(relation?.change_event ?? relation?.change_event_json),
        };
      })
      .filter((relation) => relation.counterpart || relation.description);

    return {
      id: reference || `candidate-${index + 1}`,
      name: textValue(item?.char_name),
      charType: textValue(item?.char_type),
      gender: textValue(item?.gender),
      resource: firstText(l2["资源"], l2.resource),
      roleCharm: firstText(item?.role_charm, item?.description),
      l0,
      l1: {
        innerDrive: firstText(l1["核心动机"], l1.core_motivation, l1.motivation),
        outerDrive: firstText(l1["外驱动"], l1.outer_drive),
        desire: firstText(l1["欲望"], l1.desire, l1.core_desire),
        fear: firstText(l1["恐惧"], l1.fear, l1.core_fear),
        shame: firstText(l1["羞耻"], l1.shame),
        obsession: firstText(l1["执念"], l1.obsession),
        raw: l1,
      },
      l2,
      l3,
      knowledge: {
        confirmed: Array.isArray(item?.knowledge_boundary_json?.knows) ? item.knowledge_boundary_json.knows : [],
        unknown: Array.isArray(item?.knowledge_boundary_json?.unknown) ? item.knowledge_boundary_json.unknown : [],
        wrong: Array.isArray(item?.knowledge_boundary_json?.false_belief) ? item.knowledge_boundary_json.false_belief : [],
        doubt: Array.isArray(item?.knowledge_boundary_json?.reasonable_suspect) ? item.knowledge_boundary_json.reasonable_suspect : [],
      },
      initialMemories: characterMemories(initialMemories, reference),
      candidateRelations,
      arc: objectValue(item?.arc_json),
    };
  });
}

export function normalizeCharacterSnapshot(snapshot) {
  const source = objectValue(snapshot);
  const characters = Array.isArray(source.characters) ? source.characters : [];
  const relations = Array.isArray(source.relations) ? source.relations : [];
  const initialMemories = Array.isArray(source.initial_memories) ? source.initial_memories : [];
  const namesById = new Map(characters.map((character) => [textValue(character?.id), textValue(character?.char_name)]));
  const state = textValue(source.state);

  return characters.map((character, index) => {
    const id = textValue(character?.id);
    const normalized = normalizeCharacterCandidates({
      characters: [{ ...character, client_ref: id || `snapshot-${index + 1}` }],
      relations: [],
      initial_memories: [],
    })[0];
    const candidateRelations = relations
      .filter((relation) => textValue(relation?.char_a_id) === id || textValue(relation?.char_b_id) === id)
      .map((relation) => {
        const counterpartId = textValue(relation?.char_a_id) === id
          ? textValue(relation?.char_b_id)
          : textValue(relation?.char_a_id);
        return {
          counterpart: namesById.get(counterpartId) || counterpartId,
          description: relationDescription(relation?.change_event_json),
        };
      })
      .filter((relation) => relation.counterpart || relation.description);
    return {
      ...normalized,
      id: id || normalized.id,
      candidateId: id || normalized.id,
      snapshotState: state,
      initialMemories: initialMemories
        .filter((memory) => textValue(memory?.char_id) === id)
        .map((memory) => textValue(memory?.memory_content))
        .filter(Boolean),
      candidateRelations,
    };
  });
}
