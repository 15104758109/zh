# Zongheng Narrative Engine V7


本文件是当前执行规则；`docs/v7设计文档_20260709_终版.md`（下称 V7）是唯一业务范围权威。

目标是在现有本地 Web + n8n + PostgreSQL 上，以原生组件和低代码方式跑通 V7 的真实用户旅程。MVP 验收尺度是：同一本书从真实页面输入开始，在同一 book/operator 上下文中连续完成 10 章生产，并真实经过 V7 指定的页面、n8n、RPC、PostgreSQL 与刷新恢复。

十章是验收尺度，不是新增业务范围。不得用直接造数据库记录、静态正文、伪造成功、局部源码测试或受控阻塞冒充完成。

MVP 的目的还包括约束 AI 不把项目复杂化成研发治理平台。当前优先解决阻断真实 V7 用户结果的工程 P0；非阻断的完整回归、异常收敛、可靠性增强和广泛质量工作放到 MVP 通过后。工程 P0 与章节审计中的业务 P0/P1 是不同概念。

判断工程 P0 时，以当前 FP 用户结果为准：若问题会阻断必经链路、造成错误持久化/跨书污染/虚假成功，或使同一本书无法继续正常旅程，则可视为 P0；仅因架构不够漂亮、理论风险或未来可能需要，不得升级为 P0。

---

## 2. 权威来源

按以下顺序使用：

1. `docs/v7设计文档_20260709_终版.md`：业务行为、FP 归属、数据状态、持久化职责。
2. `docs/前端原型_v2/` 对应文件：页面内容、DOM、CSS、布局和交互。截图仅是视觉证据。共享样式参考 `docs/前端原型_v2/common/ScreenShot_2026-06-28_043110_371.jpg`；WORLD 源原型为 `pages/world-settings-drag-binding.html`。
3. `docs/后端/n8n/*.json`：现有 workflow 的可编辑基线。
4. `docs/后端/对齐版提示词.md`：V7 模型行为实现材料，不扩张业务范围。
5. `db/install/v7-data-rpc-contract.sql`：唯一 PostgreSQL canonical；live catalog 和当前源码只能证明实现状态，不能覆盖 V7。

旧 Task Index、旧进度、历史审计、evidence bundle、旧会话结论、历史 branch/worktree/`HEAD` 都不是范围来源，只能作为待核实线索。

---

## 3. 平台与实现边界

- Node.js 24、pnpm 9。
- 保留现有 HTML/CSS/ESM，不引入第二前端框架、router、application shell 或等价实现语言。
- PostgreSQL 是唯一数据库方言；使用现有 `n8n-pgvector` 和 `zh_narrative`。
- n8n 使用现有本地 5678 运行时，不创建新容器或第二 orchestration layer。
- 持久化页面动作必须经过文档规定的 n8n workflow 再到 PostgreSQL；FP008-02 是当前唯一 high-code exception。
- TypeScript 仅保留在已经使用它的代码中，包括 FP008-02；浏览器 adapter 和 workflow test 保持 JavaScript/ESM。

项目是基于既有平台原生能力和 n8n 低代码执行逻辑完成的产品。优先复用既有页面、共享组件、workflow、RPC、Prompt/model binding、credential、execution data 和 partial/manual execution；不要为已有能力再造平台。

修改 n8n 默认只修现有 node 的 mapping、RPC call、error handling、参数或 V7 已定义 Prompt。新增/删除/合并/重连 node，或在页面、workflow、数据库之间移动业务判断，属于业务变更，须先走审批边界。

---

## 4. 以 FP 为开发单元

不要把“前端”“后端”“审计”拆成彼此独立的产品任务。一个页面及其 V7 FP 用户结果是一个完整 delivery slice。

每个 slice 固定按以下顺序定义：

`用户动作 -> V7 FP -> 各层职责 -> request DTO -> workflow action -> RPC/state -> 页面结果`

页面只负责 scoped projection、收集用户意图、发送请求、展示 loading/error/result 和刷新恢复。不得直连 PostgreSQL、推断服务端状态、伪造字段/默认值/成功结果或复制 workflow 决策。

n8n/服务端只承担 V7 分配的业务执行、模型调用、RPC、状态和持久化职责。PostgreSQL 只实现 canonical contract，不因测试便利新增重复状态或生命周期。

恢复页面时保留原型的信息、DOM、CSS、布局和交互模型，只原位替换 mock 数据与 handler；共享 sidebar/header/theme/navigation 复用 `apps/web/src/pages/prototype/common/` 等既有资产。

---

## 5. 分层阅读与上下文控制

为避免过度阅读导致上下文污染、职责串线和幻觉，每个窗口、task、开发周期只读取当前 FP 所需内容。

顺序：

1. 本文件；
2. 当前 V7 FP；
3. 该 FP 直接关联的 production/use/management 数据定义；
4. 对应 prototype；
5. 对应 n8n workflow；
6. 其 Prompt/model binding；
7. canonical RPC；
8. 直接受影响源码；
9. focused tests。

只有识别出明确 producer-consumer 接口后，才读取另一个 FP/workflow。历史定义需要时交给只读 subagent，仅提取指定定义及演变；历史材料不得覆盖 V7。

在诊断 node 前，先证明当前 entry action/FP 确实经过该 node；不得从 node 名称或错误症状反推业务范围。

---

## 6. 主窗口与 subagent

采用 **read-many, write-one**。

主窗口负责：当前 slice、业务判断、工程 P0、证据审查、已验证事实、失败边界、审批和最终 acceptance。主窗口不应被大量历史材料、重复日志或并行调查细节污染。

主窗口保持一个紧凑 current-slice record：

- 用户动作 / FP；
- page entry / expected result；
- book/operator/L1A/chapter-version IDs；
- source workflow hash；
- live workflow ID / published version；
- active Prompt/model IDs；
- latest trusted execution ID；
- PostgreSQL state；
- first failing boundary/node；
- files allowed to change；
- 已冻结、无需重复验证的边界；
- 当前工程 P0 blocker；
- next smallest action。

不要创建 Task Index、agent 状态平台、evidence bundle 或额外 tracking file。

subagent 默认只读，用于限定范围的并行调查。一个 active slice 只有一个 implementation writer；同一本书/candidate、workflow publish、Prompt activation、PostgreSQL stateful test 和 browser journey 保持串行。并发用于提高调查效率，不是利用率目标。

已经在相同 source hash、published workflow、Prompt/model、RPC 和业务版本下证明的边界，不因换窗口或换 agent 重跑昂贵验证。只有相关版本变化、downstream 证明 contract incompatibility，或此前缺少必要证据时才 reopen。

---

## 7. 业务常态、异常与 MVP 边界

遇到失败先分类，不先加补丁：

1. **V7 业务常态**：按 V7 正常呈现和恢复，不新增状态。
2. **用户可处理异常**：优先使用已有页面/recovery path，不把异常永久化为业务模型。
3. **用户不可处理异常**：如 provider outage、process/runtime failure、资源耗尽、历史脏 candidate、退役 defect 残留等，若不属于当前工程 P0，记录为 MVP 后的可靠性任务，目标是减少、避免或自动恢复，而不是在 MVP 中增加 V7 外字段、RPC、route、node、按钮或状态机。

对已经证明为相同 normal pause 的边界，不重复昂贵模型调用；优先 saved execution data 或新的最小有效 page-created candidate。

不得为测试直接 seed 成功业务结果。

---

## 8. n8n 诊断与上线验证

修改前从具体 production execution 诊断：

1. 从真实入口确认 action/FP；
2. 通过 Public API 获取 execution ID；
3. 确认实际 published workflow version；
4. 找到第一个 unexpected node；
5. 检查真实 input/output；
6. 比较执行前后 PostgreSQL state；
7. 只修第一个失败边界。

优先使用 saved execution data、partial/manual execution、pinned data 和 deterministic contract test 重现 mapping/parser 等问题，避免重复无关模型调用。它们是诊断证据，不能替代 production acceptance。

修改 attachment 后必须：更新同一 live workflow -> publish -> read back -> 验证 topology/changed fields -> 一次真实 production trigger -> 检查 execution -> 验证 RPC/PostgreSQL/browser/refresh。

`active=true`、API update response、node count、editor success 或 attachment test 单独都不能证明逻辑已上线。

attachment 与 live workflow 在 node、connection、business-parameter semantics 一致且 Public API `activeVersionId` 指向目标版本时视为同步；export-only `versionId`、timestamp、coordinates 等 volatile metadata 可不同。

对于 HTTP Request 节点开启 full response 后，JSON 修复节点的测试输入必须保留实际两层数据合同：`statusCode` 为 2xx，`data` 是 provider completion JSON 字符串，且最终 DTO 位于 `choices[0].message.content` 字符串。不得以旧的 `output_text` 或直接 DTO 测试输入倒逼生产解析器放宽；先用已保存 execution 的最小信封夹具复现，再判定是 transport、解包、提示词输出还是 V7 语义校验失败。

一次迭代只改变一个 failure boundary，除非同一 execution 证明多个层属于不可分割的 contract repair。

---

## 9. 测试策略

MVP 阶段按成本递增验证：

1. zero-model deterministic DTO/RPC/version/idempotency；
2. 当前 workflow/backend 的最小 V7 合法 book-scoped input，覆盖 success、documented pause、controlled failure、persistence；
3. adjacent producer-consumer contract；
4. real page -> n8n -> RPC/PostgreSQL -> refresh recovery；
5. slices 冻结后再运行同一本书连续 10 章 acceptance。

不要用高成本层诊断尚未解决的低层 contract mismatch。降低 token/模型调用是为了快速反馈和迭代，不允许绕过真实链路、持久化或制造假成功。

MVP 通过后再进行完整 regression、异常矩阵、provider/recovery、长周期稳定性、性能及非 P0 质量测试。

数据库支持的 test suite 串行运行。中断遗留唯一前缀 test DB 时，确认无连接后只删除该 test DB。

Browser acceptance 使用真实 local route；检查 layout、console、direct refresh、real controls、loading/error/recovery 和 cross-page book context。当前桌面视觉参考为 1920x1080、100% zoom。

Functional QA 与 data/RPC QA 可合并为一个 review role；user-operation QA 和 visual QA 独立于 implementation role。

---

## 10. 关键业务约束

章节 formalization 必须验证当前 candidate 最新 completed、valid、non-shadow audit 的完整 D-031 objective-pass tuple：

- `has_p0_blocker=false`
- P0 list 为空
- return route 为空
- `formalization_eligible=true`

同时 candidate prose snapshot 必须仍匹配，candidate 仍 current/valid，同版本拥有 latest chief-editor Y。业务 P0 和 P1 都阻止 formalization；不能只检查 `has_p0_blocker=false`，因为 P1 也可能为该值。

测试小说的 setting、characters、themes、plot devices 和 model output 只属于 book scope，不得进入 shared service、schema/RPC contract、n8n 通用规则、shared component、default、public Prompt 或 cross-book test。

六个 book primary genres：`科幻`、`玄幻`、`言情`、`武侠`、`恐怖`、`同人`。

新书页面默认 `1000000` total words、`2000` words/chapter；expected chapters=`ceil(total/chapter)`，initial L1A target=`ceil(chapters/3)`，二者为只读 projection，不持久化重复 count，也不在创建书籍时生成 167 条 L1A。

`target_words/chapter_words` 与一次 L1A deduction attempt 固定 `1000000` token budget 分离。

FR-087 percentages 只约束 FP013-01 candidate-generation，不定义 PostgreSQL `change_limit`、HTTP 422 或 formal-write eligibility；V7 未定义 server-verifiable comparison basis/algorithm/threshold 前，enhancement persistence 保持 fail-closed。

保留已批准 72 个 builtin skill 的内容和 source hash。当前 source 缺少 `言情/武侠/恐怖/同人` direct primary coverage；不得自行 bulk remapping，创作者批准 per-skill ownership/replacement 前，对应 journey 视为 blocked。

`db/install/v7-data-rpc-contract.sql` 只在本地产品数据库被有意清空时用于 rebuild，不是 incremental migration command。

---

## 11. 审批边界

V7 未定义且会改变用户体验、数据或流程的行为，不自行实现。

若当前结果因此受阻，用简体中文业务人话说明：

- 用户想完成什么；
- V7 已定义什么；
- 缺少/冲突什么；
- 修改后用户会看到什么；
- 不修改阻塞什么；
- 可选方案及业务影响；
- 最后附简短技术对象。

新增或修改 user-visible field/action、default、threshold、gate、workflow responsibility、persisted state、RPC contract、recovery rule 前等待批准。

纯粹恢复现有 V7/prototype/RPC contract 的 fix 不需要批准。批准后同步更新所有受影响 FP、producer、consumer、复用数据定义和状态说明。

---

## 12. Git、版本与运行环境

编辑前检查 `git status`，保留其他任务有效变更。当前 dirty checkout 中，`HEAD` 只是历史比较材料；不得为减少 status noise 从 `HEAD` 清理或替换当前文件。

当前有效版本由 exact source hash、live workflow/published version、active Prompt/model revision、PostgreSQL function definition、scoped business-version state 和真实测试结果共同确认。

长期保存/同步只保留经过对应真实测试的稳定版本。未通过测试的中间版本可短期用于调试，但不是稳定基线。新版本已测试成功且覆盖旧版本全部仍有效定义、又无回滚/兼容/审计需要时，可删除旧保存版本以减少噪音。

稳定版本只同步到项目已经批准的 Git remote、服务器或备份位置；不要自行选择云服务、push、deploy 或把备份当上线。若当前项目约束禁止远端操作，则保持本地，等待明确授权。

FP016 active model/Prompt configuration 是 runtime authority。`.env` 只提供 local secrets、credential resolution 和明确测试变量，不得静默覆盖文档配置旅程选定的 model/Prompt/node binding。

启动 browser/dev server/helper 前，在 current-slice record 中记 owner、purpose、PID/port 或 page identity；验证后关闭任务启动的页面和服务，只保留下一个紧邻串行 journey 必需的产品服务。

历史 worktree 只能在确认 exact absolute path、clean 且无 active task/process 后删除；不得批量终止未知 process。

---

## 13. Progress 与共享工作区

`docs/MVP_PROGRESS.md` 是唯一 active implementation progress record，只记录：

- 真实 user-journey outcome；
- 当前已验证 runtime blocker；
- next smallest product action。

区分 source/test readiness 与 live browser/n8n/PostgreSQL completion。runtime unavailable 时保留 last successful snapshot 时间戳并标记当前 unavailable，不得把旧 healthy snapshot 当当前状态。

不要记录 agent conversation、subtask state、evidence bundle、历史 governance gate 或恢复旧任务系统。

并发 writer 使用不重叠 page/workflow scope。shared route、common CSS/components、shared contract 仅由 integration owner 串行修改；live PostgreSQL change、n8n import/activation、shared frontend integration 串行。

新的/修改的 public RPC 只有在 canonical SQL、request/response contract、matching n8n mapping 和至少一个真实 user-journey assertion 一致时才完成。

不要提交 generated evidence、ad hoc report、temporary DB、scratch script、duplicate workflow export 或 obsolete governance asset。删除只服务于 retired schema/workflow/task index/generated evidence 的旧 test/tool；保留证明当前 V7 journey 的 executable tests。

---

## 14. 面向用户与创作者的表达

项目面向简体中文用户。开发反馈、审批说明和用户可见文案默认使用简体中文。

在不损失语义和执行精度时，先用业务视角的人话说明“用户要做什么、现在发生什么、影响什么、下一步是什么”，再附 FP/RPC/node/DTO 等技术信息。

文件路径、字段名、RPC、node、Prompt、代码和其他执行标识保持原文，避免翻译歧义。

---

## 15. 每个 slice 的执行检查

开始或恢复一个 slice 时，只确认：

1. 用户动作和 V7 FP 是什么？
2. 页面、n8n、Prompt/model、RPC、PostgreSQL 各自职责是什么？
3. 当前第一个真实失败边界是什么？
4. 它是业务常态、用户可处理异常还是不可处理异常？
5. 是否阻断当前 FP，属于工程 P0？
6. 最小修复是什么？是否仍在 V7 边界内？
7. 最便宜但有效的验证是什么？
8. 哪些边界已经证明，无需重复测试？
9. 达到哪些真实证据后冻结该 slice？

核心原则：

**先 V7，后实现；先用户动作，后技术模块；先原生/低代码，后新增代码；先当前 FP，后全局；先真实阻断，后假想风险；先最小有效验证，后完整测试；先业务常态，后异常补丁；先已验证事实，后历史线索。**

---

## 16. Commands

```powershell
pnpm install --frozen-lockfile
pnpm --filter @zhreplan/web dev
pnpm --filter @zhreplan/web test
pnpm --filter @zhreplan/web build
pnpm typecheck
docker exec -it n8n-pgvector sh -lc 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d zh_narrative'
```
