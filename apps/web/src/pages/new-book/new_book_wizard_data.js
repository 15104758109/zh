window.NEW_BOOK_WIZARD_DATA = {
  menu: [
    { label: "总控设置", icon: "dashboard", href: "/workbench" },
    { label: "设计阶段", icon: "architecture", href: "/books/new", active: true },
    { label: "生产阶段", icon: "precision_manufacturing", href: "#", requiresBook: true },
    { label: "审计阶段", icon: "fact_check", href: "#", requiresBook: true },
    { label: "迭代管理", icon: "history", href: "#", requiresBook: true }
  ],
  book: {
    title: "未命名作品",
    bookName: "",
    intent_json: { genre: "", subGenre: "", creative_intent: "" },
    selling_points_json: {},
    forbid_json: { rules: [] },
    targetWords: "1000000",
    chapterWords: "2000",
    presentation_intensity: 0.5,
    // D-001 book_project 自动化开关（对应快速控制面板）
    auto_production: false,
    auto_audit: false,      // 审计阶段自动化
    auto_iteration: false,
    // D-001 book_project 运行状态
    stage_code: "design",
    run_status: "draft"
  },
  chat: [],
  prompts: ["补全核心卖点", "检查设定绑定", "生成风险提示"],
  worldBindings: [],
  stages: [
    {
      step: "01",
      title: "创作原点",
      key: "creative_origin",
      icon: "psychology",
      guide: "明确作品意图、卖点、爽点与红线",
      next: "世界设定",
      fields: [
        { key: "title", type: "input", label: "作品名称 *", value: "" },
        { key: "genre", type: "select", label: "主题材 *", options: ["", "科幻", "玄幻", "言情", "武侠", "恐怖", "同人"], value: "" },
        { key: "subGenre", type: "input", label: "副题材", value: "" },
        { key: "targetWords", type: "input", label: "目标总字数 *", value: "1000000" },
        { key: "chapterWords", type: "input", label: "单章字数 *", value: "2000" },
        { key: "creativeIntent", type: "textarea", label: "创作意图 *", value: "", full: true },
        { key: "sellingPoint", type: "textarea", label: "核心卖点 *", value: "", full: true },
        { key: "targetEmotion", type: "tags", label: "目标情绪", value: "", tags: [], tone: "primary", full: true },
        { key: "forbid", type: "textarea", label: "创作禁区与避雷红线 *", value: "", full: true }
      ]
    },
    {
      step: "02",
      title: "世界设定",
      key: "world_settings",
      icon: "public",
      guide: "建立规则、地理、资源、势力与绑定关系",
      next: "角色设定",
      // ── V7附录D 修订：结构化字段替代 title+text 平铺 ──
      // 映射关系见 V7_附录D_数据标准修订方案 §D.2.1b
      categories: ["规则", "地理", "资源", "势力", "职业/超能", "怪物/灾难", "大事记"],
      cards: [],
      bindings: [],
      fields: []
    },
    {
      step: "03",
      title: "角色设定",
      key: "characters",
      icon: "group",
      guide: "绑定世界设定与人物哲学",
      next: "冲突种子",
      activeCharIndex: 0,
      characters: [],
      philosophyDims: ["主体能动性", "价值排序", "底层信念", "自由与责任", "秩序与反叛", "牺牲边界", "亲密关系", "权力观", "财富观", "生死观", "复仇观"]
    },
    {
      step: "04",
      title: "冲突种子",
      key: "conflict_seed",
      icon: "gavel",
      guide: "形成驱动主线升级的冲突内核",
      next: "终审确认",
      // ── V7附录D 修订：冲突种子独立表 conflict_seed 四项结构化 ──
      // parties / interest_gap / resource_point / stake_cost 四列分离，缺一 P0阻断
      conflictTypeOptions: ["资源争夺","价值观对立","认知偏差","权力博弈","生存压迫","情感纠葛","身份对立","信念冲突","规则矛盾","信息不对等"],
      conflictEntries: []
    },
    {
      step: "05",
      title: "终审确认",
      key: "final_review",
      icon: "fact_check",
      guide: "汇总内容，检查风险并开始创作",
      next: "",
      modules: [
        ["创作原点", "检查意图、核心卖点、目标情绪和红线是否闭合。"],
        ["世界设定", "检查 7 板块数量、未绑定设定和高风险设定。"],
        ["冲突种子", "检查冲突清单完整度、烈度与鲁棒性分布、角色弧光一致性。"],
        ["登场角色", "检查核心主角、反派和重要配角是否完整。"],
        ["绑定关系", "检查角色、世界设定、冲突之间是否互相支撑。"],
        ["风险与缺失", "标记缺失字段、逻辑断点和商业爽点不足。"]
      ],
      prototypeRisks: []
    }
  ],
  charConstants: {
    roleMap: {
      "核心主角": "protagonist",
      "重要配角": "support",
      "反派大佬": "antagonist",
      "常驻NPC": "ensemble"
    },
    TRAITS: [
      { name: "讲道义", delta: { "底层信念": 20, "价值排序": 20, "牺牲边界": 15, "秩序与反叛": 10 }, tone: "primary" },
      { name: "胆子大", delta: { "主体能动性": 25, "生死观": 20, "自由与责任": 15 }, tone: "primary" },
      { name: "重感情", delta: { "亲密关系": 20, "牺牲边界": 20, "价值排序": 15, "底层信念": 10 }, tone: "primary" },
      { name: "有担当", delta: { "主体能动性": 20, "权力观": 15, "秩序与反叛": 15, "自由与责任": 20 }, tone: "primary" },
      { name: "真性情", delta: { "底层信念": 25, "亲密关系": 20, "价值排序": 15 }, tone: "primary" },
      { name: "爱保护人", delta: { "牺牲边界": 25, "亲密关系": 15, "秩序与反叛": 10, "权力观": -10 }, tone: "primary" },
      { name: "老江湖", delta: { "权力观": 15, "主体能动性": 20, "底层信念": -15, "价值排序": -10 }, tone: "accent" },
      { name: "独来独往", delta: { "亲密关系": -20, "自由与责任": 15, "秩序与反叛": -15, "主体能动性": 10 }, tone: "accent" },
      { name: "随遇而安", delta: { "主体能动性": -20, "秩序与反叛": 10, "生死观": 15, "复仇观": -15 }, tone: "accent" },
      { name: "不当回事", delta: { "生死观": 20, "复仇观": -15, "财富观": -10, "亲密关系": 10 }, tone: "accent" },
      { name: "想清净", delta: { "权力观": -25, "财富观": -20, "自由与责任": 15, "亲密关系": -10 }, tone: "accent" },
      { name: "算得精", delta: { "财富观": 20, "主体能动性": 15, "价值排序": -15, "亲密关系": -10 }, tone: "accent" },
      { name: "冷血", delta: { "亲密关系": -25, "牺牲边界": -20, "底层信念": -20, "价值排序": -10 }, tone: "warn" },
      { name: "野心大", delta: { "权力观": 25, "主体能动性": 20, "牺牲边界": -15, "价值排序": -10 }, tone: "warn" },
      { name: "很记仇", delta: { "复仇观": 25, "生死观": 20, "亲密关系": -15, "底层信念": -10 }, tone: "warn" },
      { name: "不守规矩", delta: { "秩序与反叛": -25, "底层信念": -20, "价值排序": -15, "自由与责任": 10 }, tone: "warn" },
      { name: "只信自己", delta: { "权力观": 20, "牺牲边界": -25, "亲密关系": -20, "财富观": 10 }, tone: "warn" },
      { name: "没底线", delta: { "价值排序": -25, "底层信念": -25, "自由与责任": -15, "秩序与反叛": -15 }, tone: "warn" }
    ],
    QUADRANT: {
      "讲道义":    { s: 0.10, w: 0.80, t: 0.10 },
      "胆子大":    { s: 0.20, w: 0.50, t: 0.30 },
      "重感情":    { s: 0.10, w: 0.80, t: 0.10 },
      "有担当":    { s: 0.30, w: 0.50, t: 0.20 },
      "真性情":    { s: 0.10, w: 0.70, t: 0.20 },
      "爱保护人":    { s: 0.15, w: 0.75, t: 0.10 },
      "老江湖":    { s: 0.60, w: 0.20, t: 0.20 },
      "独来独往":    { s: 0.40, w: 0.15, t: 0.45 },
      "随遇而安":    { s: 0.15, w: 0.20, t: 0.65 },
      "不当回事":    { s: 0.25, w: 0.10, t: 0.65 },
      "想清净":    { s: 0.10, w: 0.20, t: 0.70 },
      "算得精":    { s: 0.75, w: 0.10, t: 0.15 },
      "冷血":    { s: 0.80, w: 0.05, t: 0.15 },
      "野心大":    { s: 0.70, w: 0.10, t: 0.20 },
      "很记仇":    { s: 0.60, w: 0.05, t: 0.35 },
      "不守规矩":    { s: 0.40, w: 0.05, t: 0.55 },
      "只信自己":    { s: 0.85, w: 0.05, t: 0.10 },
      "没底线":    { s: 0.25, w: 0.05, t: 0.70 }
    },
    DESC: {
      "主体能动性": { low: "听从安排，缺乏主动意志", mid: "视情境而动，偶尔主动进取", high: "主动创造局面，拒绝被动等待" },
      "价值排序":   { low: "以利益为先，对道义漠然", mid: "义利并重，随境况权衡取舍", high: "坚守道义，宁舍利益不失节" },
      "底层信念":   { low: "世界充满恶意，信任皆为奢望", mid: "人心善恶并存，需审慎辨别", high: "坚信善念终胜，以诚待万物" },
      "自由与责任": { low: "逃避束缚，拒绝承担代价", mid: "自由与担当间寻求平衡", high: "以责任为重，自愿承担代价" },
      "秩序与反叛": { low: "打破规则，以混乱求突破", mid: "尊重秩序，但不盲目服从", high: "坚守秩序，以稳定护众生" },
      "牺牲边界":   { low: "自保优先，不愿为他人牺牲", mid: "权衡后可为他人有限牺牲", high: "愿为大义放弃一切所有" },
      "亲密关系":   { low: "拒绝深交，以孤立保护自我", mid: "有选择地建立深厚羁绊", high: "珍视羁绊，全心托付所爱" },
      "权力观":     { low: "视权力为枷锁，不求掌控", mid: "以权力为工具，适度运用", high: "渴望掌控全局，以权力为目标" },
      "财富观":     { low: "视财物如粪土，不为利所动", mid: "量入为出，财富为手段非目的", high: "积聚财富为首务，利益驱动行动" },
      "生死观":     { low: "惜命如金，极力回避死亡风险", mid: "直面生死，不执着也不轻视", high: "视死如归，生死不过一念之间" },
      "复仇观":     { low: "以和为贵，放下仇恨向前走", mid: "记仇但能克制，择机而动", high: "以牙还牙，复仇是最高使命" }
    }
  }
};


// V7 §5 数据标准（2026-07-04）
// 依据：D-001/D-002/D-021/D-026/D-028/D-028b
const WIZARD_DATA = {
  STAGES: [
    { id: "stage1", title: "创作原点", description: "确认作品名称、题材方向、目标读者、防雷红线与文学呈现强度。", l1_required_fields: ["title", "intent_json", "forbid_json", "stage_code", "presentation_intensity"], lockable: true },
    { id: "stage2", title: "世界设定", description: "建立规则、地理、资源、势力、职业、怪物、大事七板块的初始态设定。", l1_required_fields: ["board_type", "atom_type", "item_name", "item_content", "affordance_dims", "setting_layer"], lockable: true },
    { id: "stage3", title: "角色设定", description: "确认角色基础信息、L0-L3四层本体、知识边界与初始关系边。", l1_required_fields: ["char_name", "char_type", "five_layers_json", "knowledge_boundary_json", "arc_json"], lockable: true },
    { id: "stage4", title: "冲突种子", description: "提交用户意图层，由后端补全压力维度与建议冲突结构。", l1_required_fields: ["seed_type", "involved_chars", "desired_arc", "desired_intensity"], lockable: true },
    { id: "stage5", title: "终审确认", description: "汇总阶段锁定状态，全部锁定后允许最终确认创建。", l1_required_fields: ["stage_locks", "creator_confirmed"], lockable: true },
  ],
  BOOK_ENUMS: {
    GENRE_TYPES: ["科幻", "玄幻", "言情", "武侠", "恐怖", "同人"],
    TARGET_READERS: ["男频爽文读者", "女频情感读者", "群像权谋读者", "硬核设定读者", "轻松下饭读者", "悬疑推理读者", "青少年读者", "成熟现实向读者"],
    PRESENTATION_INTENSITY: [{ value: 0, label: "极简白描" }, { value: 0.25, label: "轻度文学化" }, { value: 0.5, label: "均衡呈现" }, { value: 0.75, label: "强文学表达" }, { value: 1, label: "高密度诗性" }],
    STAGE_CODES: ["设计", "生产", "审计", "迭代"],
  },
  CONFLICT_SEED: {
    SEED_TYPES: ["资源", "身份", "信念", "权力", "生存", "情感", "规则", "信息"],
    ARC_DIRECTIONS: ["成长", "堕落", "错位", "稳定"],
    INTENSITY_LEVELS: [1, 2, 3, 4, 5],
    BACKEND_SUPPLEMENT_FIELDS: ["pressure_dims", "suggested_parties", "suggested_interest_gap", "suggested_resource_point", "suggested_stake_cost", "seed_status"],
    DISPLAY_ONLY_FIELDS: ["parties", "interest_gap", "resource_point", "stake_cost"],
    SEED_STATUS: ["一致", "需复核", "断裂"],
  },
  WORLD_SCHEMA: {
    AFFORDANCE_DIMS: ["技术阻力", "制度代价", "哲学困境", "动机来源", "升级触发"],
    SETTING_LAYERS: ["初始设定", "未来走向", "运营修订"],
    BINDING_TYPES: {
      规则: { 地理: ["管辖", "豁免"], 职业: ["赋能", "限制", "依赖"], 势力: ["约束", "豁免"], 怪物: ["催生", "压制"] },
      地理: { 资源: ["产出", "封锁"], 势力: ["盘踞", "争夺", "流亡"], 怪物: ["栖息", "迁徙"], 规则: ["受规则影响"] },
      资源: { 势力: ["控制", "依赖", "争夺"], 职业: ["消耗", "炼制"], 怪物: ["滋养"], 地理: ["源自", "污染"] },
      势力: { 职业: ["雇佣", "垄断", "培养"], 怪物: ["驯化", "敌对"], 规则: ["制定", "破坏"], 资源: ["垄断", "掠夺"] },
      职业: { 规则: ["遵循", "突破"], 资源: ["依赖", "转化"], 势力: ["服务", "反抗"], 怪物: ["克制", "诱发"] },
      怪物: { 地理: ["盘踞", "污染"], 资源: ["守护", "吞噬"], 势力: ["威胁", "交易"], 规则: ["触犯", "例外"] },
      大事: { 规则: ["改写", "暴露"], 地理: ["改变", "毁坏"], 资源: ["枯竭", "释放"], 势力: ["重组", "瓦解"], 职业: ["兴起", "衰落"], 怪物: ["唤醒", "封印"] },
    },
    boards: {
      规则: { board_type: "规则", default_affordance_dims: ["制度代价", "哲学困境", "升级触发"], l1_fields: ["violate_cost", "apply_scope", "rule_type"], l2_fields: ["exception_case", "enforcer", "origin_reason"], enum_values: { rule_type: ["禁忌", "律法", "天道", "契约", "门规", "潜规则"], apply_scope: ["全世界", "地域限定", "势力内部", "职业限定", "事件触发"], violate_cost: ["轻微代价", "资源损失", "身份惩罚", "生命风险", "世界级反噬"] }, interlock_rules: [{ trigger: "violate_cost=世界级反噬", constraint: "apply_scope 不应为空", action: "提示补充适用范围" }, { trigger: "rule_type=禁忌", constraint: "exception_case 建议说明例外", action: "提示补充例外案例" }] },
      地理: { board_type: "地理", default_affordance_dims: ["技术阻力", "动机来源", "升级触发"], l1_fields: ["danger_level", "location_text"], l2_fields: ["resource_hint", "access_condition", "local_rule"], enum_values: { danger_level: ["低", "中", "高", "极高"], access_condition: ["自由进入", "身份许可", "资源消耗", "季节窗口", "剧情触发"] }, interlock_rules: [{ trigger: "danger_level=低", constraint: "稀有资源不建议只绑定低危险地理", action: "提示检查稀有资源来源" }] },
      资源: { board_type: "资源", default_affordance_dims: ["技术阻力", "制度代价", "动机来源"], l1_fields: ["scarcity_level", "usability"], l2_fields: ["controller", "origin_geo", "side_effect"], enum_values: { scarcity_level: ["常见", "稀有", "唯一", "枯竭中"], usability: ["修炼", "交易", "治疗", "铸造", "献祭", "信息媒介"] }, interlock_rules: [{ trigger: "scarcity_level=唯一", constraint: "controller 绑定边不超过1", action: "提示唯一资源控制者过多" }, { trigger: "scarcity_level=稀有", constraint: "origin_geo 的 danger_level 不宜为低", action: "提示补充来源风险" }] },
      势力: { board_type: "势力", default_affordance_dims: ["制度代价", "动机来源", "升级触发"], l1_fields: ["faction_status", "stance"], l2_fields: ["leader", "resource_claim", "enemy_force"], enum_values: { faction_status: ["鼎盛", "稳定", "衰退", "潜伏", "分裂"], stance: ["友善", "中立", "敌对", "交易", "暧昧"] }, interlock_rules: [{ trigger: "faction_status=分裂", constraint: "enemy_force 或内部派系建议非空", action: "提示补充分裂来源" }] },
      职业: { board_type: "职业", default_affordance_dims: ["技术阻力", "制度代价", "哲学困境"], l1_fields: ["cost_mechanism", "is_system"], l2_fields: ["promotion_path", "resource_need", "taboo"], enum_values: { cost_mechanism: ["体力", "寿命", "资源", "信念", "关系", "记忆"], is_system: ["是", "否"] }, interlock_rules: [{ trigger: "is_system=是", constraint: "promotion_path 建议非空", action: "提示补充晋升路径" }] },
      怪物: { board_type: "怪物", default_affordance_dims: ["技术阻力", "动机来源", "升级触发"], l1_fields: ["threat_level", "counter_text"], l2_fields: ["habitat", "drop_resource", "origin_rule"], enum_values: { threat_level: ["低", "中", "高", "灾厄"], counter_text: ["物理克制", "规则克制", "资源克制", "职业克制", "暂无克制"] }, interlock_rules: [{ trigger: "threat_level=灾厄", constraint: "counter_text 不应为暂无克制", action: "提示补充最低可行克制方式" }] },
      大事: { board_type: "大事", default_affordance_dims: ["哲学困境", "动机来源", "升级触发"], l1_fields: ["event_era"], l2_fields: ["cause", "consequence", "affected_boards"], enum_values: { event_era: ["远古", "近代", "开篇前", "开篇时", "未来态"] }, interlock_rules: [{ trigger: "event_era=未来态", constraint: "setting_layer 应为未来走向", action: "提示切换时间态" }] },
    },
  },
  CHARACTER_SCHEMA: {
    CHAR_TYPES: ["主角", "配角", "群像", "反派"],
    L0_DIMENSIONS: [{ key: "agency", label: "主体能动性", range: [-100, 100] }, { key: "value_order", label: "价值排序", range: [-100, 100] }, { key: "core_belief", label: "底层信念", range: [-100, 100] }, { key: "freedom_responsibility", label: "自由与责任", range: [-100, 100] }, { key: "order_rebellion", label: "秩序与反叛", range: [-100, 100] }, { key: "sacrifice_boundary", label: "牺牲边界", range: [-100, 100] }, { key: "intimacy_drive", label: "亲密关系", range: [-100, 100] }, { key: "power_view", label: "权力观", range: [-100, 100] }, { key: "wealth_view", label: "财富观", range: [-100, 100] }, { key: "life_death_view", label: "生死观", range: [-100, 100] }, { key: "revenge_view", label: "复仇观", range: [-100, 100] }],
    TRAIT_DELTAS: { 胆子大: { agency: 15, order_rebellion: 6 }, 爱保护人: { intimacy_drive: 12, sacrifice_boundary: -8, value_order: 6 }, 讲规矩: { order_rebellion: -14, freedom_responsibility: 10 }, 不服输: { agency: 12, revenge_view: 8 }, 重情义: { intimacy_drive: 15, value_order: 8 }, 冷静: { core_belief: 8, life_death_view: 6 }, 野心强: { power_view: 15, agency: 8 }, 怕失去: { intimacy_drive: 10, life_death_view: -8 } },
    KB_QUADRANTS: ["已知", "未知", "错误认知", "合理推断"],
    ARC_DIRECTIONS: ["成长", "堕落", "稳定", "错位"],
    GENERATION_HINTS: { L1: "基于长期承诺和出身背景由AI生成驱动层", L2: "基于绑定职业和资源由AI生成世界作用位", L3: "基于关系基础由AI生成关系作用位", KB: "基于L0底盘和背景由AI生成知识边界" },
  },
  RELATION_SCHEMA: {
    DIMENSIONS: [{ key: "trust", label: "信任", range: [-100, 100] }, { key: "intimacy", label: "亲密", range: [-100, 100] }, { key: "power_balance", label: "权力倾斜", range: [-100, 100] }, { key: "dependence", label: "依赖", range: [-100, 100] }, { key: "hostility", label: "敌意", range: [0, 100] }, { key: "common_goal", label: "共同目标", range: [0, 100] }, { key: "secret_known", label: "知晓秘密", range: [0, 100] }, { key: "emotional_bond", label: "情感纽带", range: [-100, 100] }],
    STRUCTURE_FIELDS: ["relation_type", "relation_hierarchy", "relation_origin"],
    RELATION_TYPES: ["同盟", "师徒", "亲族", "敌对", "交易", "暧昧", "竞争", "债务"],
    RELATION_HIERARCHIES: ["平等", "上下级", "导师-学徒", "庇护-被庇护", "控制-反抗"],
    INIT_POLICY: "user_filled_only",
  },
  NO_PERSIST_FIELDS: ["ai.tension", "ai.note", "ai.suggestion", "activeProposals", "pivotStack", "bindingDraft", "currentProjection", "viewMode", "mapLayer", "externalRoles"],
};
WIZARD_DATA.BINDING_TYPES = WIZARD_DATA.WORLD_SCHEMA.BINDING_TYPES;
window.WIZARD_DATA = WIZARD_DATA;
