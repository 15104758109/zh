# 纵横叙事引擎 · 开发窗口线束

> 本文件是 `docs/IMPLEMENTATION_CONTROL.md` 的执行视图，不建立新的业务、数据、RPC 或 Gate 事实。发生冲突时立即停止，并回到 IMPLEMENTATION_CONTROL 的全局决策/注册表处理。

## 1. 当前启动状态

```text
G01_REQUIRED=APPROVED
G02_REQUIRED=APPROVED
G03_A_TO_D_REQUIRED=APPROVED
G04_R1_GATE=APPROVED
G04_ACTIVE_REVISION=2
G04_GATE_REQUIRED=APPROVED
CURRENT_G04_GATE=APPROVED
CURRENT_MODE=G04_R2_APPROVED_F0_01_READY
G05_GATE=APPROVED
G06_GATE=APPROVED
G07_GATE=PENDING
G07_A_STATUS=IMPLEMENTED
G07_A_BRANCH=autonomy/integration
G07_A_COMMIT=24f5df65c2714dab58880f35a8207f0d8fc37131
G07_A_ORCHESTRATOR_SHA256=b7740b350f6be74ee7359075354056002d27aee4e1d5cbec12bf1917237d86bd
G07_A_ORCHESTRATOR_TEST_ASSERTIONS=161
G07_A_POLICY_SHA256=e171d92c9e7092006bc7279c9b7a1553baa8f36fef2e58824e0de742a20eb370
G07_A_EVIDENCE_TOOL_SHA256=b1cbce436601eb660b0cd33c4e0918101a5db62507baf4f4ebf24c9a197db8cd
G07_A_EVIDENCE_TOOL_TEST_ASSERTIONS=24
G07_A_SENSITIVE_PATTERNS_SHA256=6a565f3538a524d5c95b88f61ba5e59d9246d438ee67216cefba2c0f477dfba7
G07_A_EVIDENCE_STATUS=ACTIVE_V11_IMPLEMENTATION_EVIDENCE
G07_A_EVIDENCE_PATH=docs/G07_A_EVIDENCE_V11.json
G07_A_EVIDENCE_SHA256=d89a1253278ee41bce2a39e53ff093166cba4b3e986febf7bbd30306ffe91d3c
G07_A_POLICY_SCHEMA=g07-autonomy-policy/v6
G07_A_REPORT_SCHEMA=g07-role-report/v6
G07_A_SECRET_SCAN_VERSION=G07_CANDIDATE_BLOBS_V2
```

- G02、G03-A~D 与历史 G04 revision 1 已由创作者批准；历史证据只登记在 `G04_R1_GATE=APPROVED`。
- 当前 Task Index 是已批准的 85-Task revision 2；仅 `F0-01-REPO` 为 `READY`，其余 84 个 `PLANNED`。
- 目标 Task 不是 `READY`，或任一 `depends_on` 未 `VERIFIED` 时，不得启动实现。
- 机器 Schema/迁移不存在时，不得实现或假定数据库契约；测试不存在时，不得标记 `VERIFIED`。

## 2. 唯一控制入口

每个窗口先读 `docs/IMPLEMENTATION_CONTROL.md`，只装载与当前角色和对象有关的内容。

| 读取内容 | 用途 |
|---|---|
| Gate Register | 确认当前阶段是否允许执行 |
| 事实源职责 / 成熟度 | 确认哪类材料能证明什么 |
| 术语 / RPC / 废弃项 | 使用正式名称并阻止旧入口复活 |
| 全局决策 | 约束写回、上游锁、FP008 生命周期、P0、本地操作者、统一配置、预算、恢复、Prompt 分权、交互合同与自动化默认值 |
| FP 对齐矩阵 / 依赖图 | 确认目标是否具备实施前置材料 |
| Task Index | 获取 Task ID、唯一 `FP::FPddd-dd` 主归属、支持责任、依赖、write_scope 和状态 |
| 角色读取视图 / 窗口协议 | 限制本窗口的读取、写入与输出 |
| 未对齐材料清单 | 识别必须回流而非在下游脑补的缺口 |

不得从目录名、行号、n8n 节点 ID 或聊天记忆反推任务。没有稳定键就没有任务。

## 3. 事实源按职责读取

| 要回答的问题 | 读取材料 | 结论边界 |
|---|---|---|
| 产品/节点打算做什么 | `docs/v7设计文档_20260709_终版.md` 的目标 FP 稳定锚点 | 业务意图，不是物理契约 |
| 表、字段、约束、RPC 签名是什么 | 真实机器 Schema/迁移 | 当前仓库缺失，缺失即阻断数据库实现 |
| 用户动作应怎样响应 | 目标 `contracts/interactions/*.yaml` 机器交互合同 | 当前仓库缺失；必须由目标垂直/能力 Task 在 F0-17 Schema 下建立，不能从原型按钮猜测 |
| 模型应怎样工作 | `docs/后端/对齐版提示词.md` 的目标 FP 锚点 | 模型行为设计，不是部署证明 |
| 当前实验流程怎样连线 | `docs/后端/n8n/` 的目标 JSON | 流程部署实现，不得覆盖业务/数据裁决 |
| 页面视觉方向是什么 | `docs/前端原型_v2/` 中真实存在的 HTML/截图 | 视觉参考，不是行为合同 |
| 行为是否真的通过 | 可重复测试、日志、截图与事务证据 | 当前仓库缺失，不得给 VERIFIED |

Prompt 源与 n8n 内嵌配置不一致时，输出部署漂移；不得把任一方静默覆盖另一方。本线束不允许直接修改实验 n8n 来消除文档差异。

## 4. 角色窗口

角色和读取边界以 IMPLEMENTATION_CONTROL 中以下视图为准：

| 视图 ID | 窗口职责 | 与其他窗口的关系 |
|---|---|---|
| `VIEW::COORDINATOR` | 校验 Gate、稳定键、依赖与对齐材料；组织交接 | 不编码、不代签审计 |
| `VIEW::GAP_AUDITOR` | 只读检查意图、契约、Prompt、部署、原型和证据缺口 | 不修复实现，不把缺失项判 PASS |
| `VIEW::CODER` | 在明确写入范围内实现一个已解锁 Task，并交付该 Task 自有交互合同 | 不改变业务/RPC/锁/状态语义；普通 coder 不改 Prompt 源或发布 binding |
| `VIEW::PROMPT_EDITOR` | 仅处理已实例化的 `TASKCLASS::PROMPT_REVISION(FPddd-dd)`，修改一个目标 Prompt 锚点 | 不改代码/Schema/n8n/业务边界，不复核或发布自己的 revision |
| `VIEW::AUDITOR` | 独立按交互合同执行正常、异常、对象范围、恢复与端到端行为验收 | 不以编码者说明、原型或测试反推合同；不修改实现制造 PASS |
| `VIEW::REVIEWER` | 评审事实源、机器契约、RPC、写回与依赖；Prompt 场景独立验证 Schema/哈希/回归 | 不顺手改代码/Prompt消除问题，不替 F0-15 发布 |
| `VIEW::ARCHITECT` | 裁决跨 FP、RPC、锁、P0、状态或事实源冲突 | 不能替创作者批准 Gate |

一个窗口只能承担一个角色。`VIEW::CODER`、`VIEW::PROMPT_EDITOR`、`VIEW::AUDITOR`、`VIEW::REVIEWER` 必须相互独立；Prompt revision、review、release 三责不得合窗，交接只传稳定键、Task ID、决策 ID、对齐债 ID 和证据 ID。

## 5. 窗口启动声明

每个窗口开始前必须原样填完：

```yaml
gate:
  historical: G04_R1_GATE=<actual_value>
  active_revision: G04_GATE=<actual_value>; G04_REVISION=<actual_value>
task_id: <exact Task ID>
view_id: VIEW::<ROLE>
object_key: FP::FPddd-dd | GLOBAL::<OBJECT>
read_paths_and_anchors:
  - <real path>#<stable anchor>
missing_materials:
  - <ALIGN-DEBT id or NONE>
known_conflicts:
  - <decision/debt id or NONE>
allowed_write_scope:
  - <exact paths or READ_ONLY>
interaction_contract: <contracts/interactions/*.yaml or NOT_APPLICABLE>
prompt_revision_task: <instantiated Task ID or NOT_APPLICABLE>
```

启动声明失败条件：

- 活动 `G04_GATE` 未达到该动作要求；历史 `G04_R1_GATE=APPROVED` 不足以启动 revision 2 Task。
- `object_key` 不在 Task Index，或目标 Task 状态不是 `READY`。
- 读取路径不存在。
- 需要的机器 Schema、交互矩阵或测试证据缺失。
- 写入范围没有精确到真实路径。
- 当前角色需要改变全局决策才能继续。

## 6. 执行节拍

### 6.1 Align

由 `VIEW::GAP_AUDITOR` 只读检查目标 FP 的七列材料：V7 业务意图、Schema/迁移、交互矩阵、Prompt、n8n、原型/视觉、测试证据。输出对齐债，不写实现。

只有协调窗口把目标 `ALIGN::FPddd` 行和目标 Task 行从骨架补齐，并确认依赖闭合后，才能进入实现。

### 6.2 Implement

由 `VIEW::CODER` 处理一个状态为 `READY` 的 Task；FP 垂直 Task 同时绑定唯一 `FP::` 主归属键：

1. 先读 Gate、目标 Task、全局决策和机器契约。
2. 只改启动声明中的允许路径。
3. 只调用 IMPLEMENTATION_CONTROL RPC 注册表中非废弃、非实验状态的名称。
4. 对数据库写入，以机器迁移为准；V7 中的字段表只作业务意图参考。
5. 实现中发现缺口时回流，不在下游新增字段、RPC、锁或状态语义。
6. 用户可见垂直/能力 Task 在自身 write_scope 内交付交互合同；普通 coder 不修改 Prompt 源。
7. 输出实际修改、测试命令、交互合同、证据和未覆盖风险。

### 6.3 Audit

由 `VIEW::AUDITOR` 独立执行：

- 正常路径、输入边界和幂等。
- P0、本地操作者/作品范围、锁所有权和前端绕过。
- 部分写入失败时的完整回滚。
- 候选/影子/正式隔离及历史保留。
- 长任务暂停、恢复、预算与重复成本。
- 加载、空、失败、暂停、只读和完成等用户可见状态。

没有可重复命令和证据时，结论只能是 `NOT_VERIFIED`，不能用文档自述替代。

### 6.4 Review

由 `VIEW::REVIEWER` 检查：

- 业务意图没有被机器实现静默改写。
- Schema/RPC/字段/枚举与机器契约一致。
- 正式章节提交只使用 `rpc_commit_chapter`，实际写表是登记作用域子集且账本完整。
- 上游冻结、作品锁与对象令牌语义未被放宽。
- FP008-02 没有持久化，FP008-04 是推演快照唯一持久化入口。
- Prompt 源与部署版本的映射、哈希和漂移有记录。
- 废弃项没有进入新实现。

### 6.4.1 Prompt 与交互分权

1. Prompt 源变更必须先有已登记十五列的 `TASKCLASS::PROMPT_REVISION(FPddd-dd)` 实例，且活动 `G04_GATE=APPROVED`、`G04_REVISION=2`。
2. `VIEW::PROMPT_EDITOR` 只提交目标锚点 revision、源哈希、理由和回归样本，不发布、不激活。
3. 不同 `VIEW::REVIEWER` 验证目标 Schema、哈希、禁项和回归，输出 `APPROVE_FOR_RELEASE` 或 `REJECT`。
4. 只有 `F0-15-PROMPT-RELEASE` 可发布制品、建立运行 binding 或技术回滚；FP014-04 只在已发布制品内提升业务配置 candidate。
5. F0-17 只拥有交互合同 Schema/lint；目标垂直/用户可见 capability Task 编写自己的合同，独立 Auditor 按合同验收。

### 6.5 Decide

只在触发回流时打开 `VIEW::ARCHITECT`。输出必须是：

```text
decision: APPROVE | REPLAN | ESCALATE_TO_CREATOR
object_key: <stable key>
facts_used: <decision/contract/evidence ids>
conflicts: <ids or NONE>
required_updates: <responsible fact sources>
```

涉及产品边界、版本承诺或 Gate 的新取舍时只能 `ESCALATE_TO_CREATOR`。

## 7. 强制回流条件

出现任一项立即停止当前实现/审计窗口：

1. 新增、改名、废弃 RPC，或需要依赖实验未契约 RPC。
2. 扩大/缩小 `rpc_commit_chapter` 的正式写回逻辑作用域。
3. 改变 FP004-01 上游冻结点、FP004-04 二次锁定或锁所有权语义。
4. 让 FP008-02 写数据库、绕过 FP008-04，或改变 `deduction_locked` 里程碑。
5. 改变 P0、候选/影子/正式三态、前端零裁决或原子回滚规则。
6. 使用 V7 示意字段替代缺失机器契约。
7. Prompt 源与 n8n 部署冲突且影响写库、P0、锁、RPC 或跨 FP 消费。
8. 需要修改目标窗口允许写入范围之外的文件。
9. 普通 coder 需要修改 Prompt 源、缺独立 Prompt review、绕过 F0-15 发布，或用户可见 Task 缺交互合同。

## 8. 证据与交接契约

每个窗口的末尾必须输出：

```markdown
## 窗口尾注
- object_key：
- task_id：
- view_id：
- 已读路径与稳定锚点：
- 修改路径：
- 执行命令：
- 行为/契约证据：
- 交互合同/Prompt revision-review-release 证据：
- 未覆盖风险：
- 新增或关闭的对齐债：
- 下一窗口：
```

证据引用优先使用测试 ID、迁移 ID、决策 ID、对齐债 ID、提交哈希或稳定 FP 锚点。源代码行号只能辅助定位当次 diff，不能成为跨文档事实键。

## 9. 当前阶段结论

- `G01_GATE=APPROVED` 已满足。
- `G02_GATE=APPROVED`（2026-07-10，创作者明确批准）。
- `G03-A_GATE`~`G03-D_GATE`、活动 `G04_GATE` 均已批准，当前 `G04_REVISION=2`。
- 当前 85 个 Task 中仅 `F0-01-REPO` 为 `READY`，其余 84 个 `PLANNED`；Schema/迁移、机器交互合同、源码和测试证据仍缺失。
- 因此业务 Task Index 中唯一候选是 F0-01，但当前 `G07_GATE=PENDING` 且自治政策禁用产品执行；本阶段只能继续控制面返修/差距审计，不得启动任何产品 Task，也不得声称任何 FP 已实现或已验证。

## 10. G07-A 自治控制面

稳定政策锚点为 `G07::AUTONOMY`，机器政策位于 `.autonomy/policy.json`。`tools/project-orchestrator.mjs` 管理 v4 事件链上的当前控制面实现：工作区外单调 head、Ed25519 收据、平台写 capability、严格历史语义回放、Task/Slice 投影、租约、blob 证据、预算、恢复、简报和角色提示词；它不直接调用模型。Coder、Prompt Editor、Auditor、Reviewer、Architect 与 Slice Gate Runner 只返回 `g07-role-report/v6`；每份报告必须携带绑定 Task Index 推荐档位与实际模型的 `MODEL_SESSION`，且 `ROLE_REPORT` 必须绑定真实 lease/actor/role/对象/attempt 与报告哈希，不得直接写事件或 Task 状态。Task Index 中主责为 Auditor 的证据 Task 以单写入者 capability 执行，之后仍需独立 Auditor/Reviewer；Slice Gate Runner 使用专用只读 slice lease，且 PASS 必须携带绑定登记用户入口、Task evidence、commit/context、执行结果及大于零制品字节数的 `SLICE_GATE_EXECUTION` 平台收据。平台私钥、单调 head、head provider 命令和可信收据 inbox 都必须位于角色不可写域，head 命令每次执行前复核哈希；任一 provider 不可用时必须硬停为 `ENVIRONMENT_APPROVAL_REQUIRED`。

```text
node tools/project-context-loader.mjs --self-test
node tools/project-orchestrator.mjs --self-test
node tools/g07-control-evidence.mjs --self-test
node tools/g07-control-evidence.mjs --all
node tools/project-orchestrator.mjs status --run-id <run-id>
node tools/project-orchestrator.mjs dry-run --run-id <run-id>
node tools/project-orchestrator.mjs lease --run-id <run-id> --task-id <task-id> --role <role> --actor-id <actor> --attempt-id <attempt> --platform-receipt-file <signed-receipt.json> --workspace-capability-receipt-file <signed-capability.json>
node tools/project-orchestrator.mjs lease --run-id <run-id> --slice-id <slice-id> --role slice_gate_runner --actor-id <actor> --attempt-id <attempt> --platform-receipt-file <signed-receipt.json>
node tools/project-orchestrator.mjs record --run-id <run-id> --report-file <signed-role-report.json>
node tools/project-orchestrator.mjs verify-evidence --run-id <run-id> --task-id <task-id> --candidate-commit <sha> --verification-receipt-file <signed-receipt.json>
node tools/project-orchestrator.mjs transition --run-id <run-id> --task-id <task-id> --to-status <status> --platform-receipt-file <signed-receipt.json>
node tools/project-orchestrator.mjs unlock --run-id <run-id> --receipts-file <signed-receipts-by-task.json>
node tools/project-orchestrator.mjs record-usage --run-id <run-id> --meter-receipt-file <signed-receipt.json>
node tools/project-orchestrator.mjs resume --run-id <run-id>
node tools/project-orchestrator.mjs report --run-id <run-id> [--slice-id <slice>]
```

- `dry-run` 只能计算下一 Task、角色、FP 集、scope 和上下文哈希；它比较前后事件字节/哈希、Task 投影、精确 scope 产品树和 ignored 路径名称哈希，证明不写事件、不改状态、不创建产品文件。
- 只有 Orchestrator 可执行状态命令；所有 JSON 输入只允许来自 policy 登记的工作区外可信 inbox，且拒绝越界、realpath 逃逸、非普通文件、符号链接/目录联接、硬链接和超限文件。平台公钥与单调 head 命令使用相同文件检查。
- 写租约必须同时验证 `LEASE_GRANT` 和 `WORKSPACE_CAPABILITY`。后者由平台 sandbox 强制只开放精确 write scope，并拒绝 `.git/.autonomy/.env`、inbox 和所有 scope 外路径；Coder、Prompt Editor 或主责 Auditor 的平台主体/会话必须与 capability 一致。
- `VERIFIED` 绑定同一 commit、历史/当前 control context、含删除 scope、原始文本/二进制 candidate blobs、超限阻断、平台命令制品和独立身份。合法升级后旧 `VERIFIED` 使用事件内历史 facts 回放，不要求当前 context hash 相等。
- `tools/g07-control-evidence.mjs --all` 现场执行自测、语法与 Dry Run，并把归一化结果与活动 evidence 的完整 `mechanical_claims` 做结构相等比较；stdout、Dry Run base/context 等随登记 HEAD 漂移的值不得伪装为固定可复现证据。
- 所有 run 合计最多一个写租约和两个只读审查租约；本地事件数/末哈希每次都与外部单调 head 核对，删尾或整日志删除立即阻断。任意恢复 run 可 CAS 对账合法本地领先、清理过期租约并 quarantine stale 损坏锁。
- 验收、scope、秘密、stale commit/context 等 Gate 失败必须写 `EVIDENCE_REJECTED`。报告 selector 被改写时不得写拒绝事件或影响真实租约；缺字段只有在 `ROLE_REPORT` 收据绑定真实租约和该提交哈希时，才可写 `REPORT_REJECTED` 并只释放自身租约，保留 sibling lease。三次返修进入 Replan；Architect 只处理 A/B/C/D，C 必须转 `CREATOR_REQUIRED`；两次 Replan 耗尽时按依赖祖先闭包暂停关键路径。Orchestrator 不接受字符串解除 `CREATOR_REQUIRED`。
- 候选秘密扫描由 `tools/g07-sensitive-patterns.mjs` 单一规则源驱动，两套扫描器必须使用同一登记哈希和 `G07_CANDIDATE_BLOBS_V2`，包括二进制 blob 与 `github_pat_` fine-grained PAT。
- 预算上限只取已登记 policy，角色/run 不可覆盖；用量只取不可复用的平台计量收据。任一已配置维度达到 80% 通知；100% 时只允许纯控制面本地读取，Task/Slice 租约、只读审查、角色/模型、外部与付费动作全部硬停，未知费用不得假报为 0。
- G07 阶段禁止真实项目模型调用、付费测试、push、部署、生产写入、凭据访问和自动合并主分支。平台授权不可绕过；当前没有可信角色会话见证提供方时也必须返回 `ENVIRONMENT_APPROVAL_REQUIRED`，不得把不同 actor/session 字符串当机械独立性。
- 当前 `G07_GATE=PENDING`，因此即使路由器确认 `F0-01-REPO` 为唯一 READY，G07-A dry-run 也必须拒绝产品执行。测试、dry-run、G07-A/G07-B 或 Architect 均不得自行写 `G07_GATE=APPROVED`。
- `tools/g07-control-evidence.mjs --all` 是独立复现入口：从 Git 对象运行旧 G06 58 项，运行当前 G06/G07 自测，并从 `G07_A_BASE_COMMIT` 动态扫描到调用时 `HEAD`，所以证据登记 commit 也在 scope 和原始 blob 秘密检查内。
- 活动实现、证据路径/哈希、policy/report/秘密扫描版本只取第 1 节机器块，并由 `tools/g07-control-evidence.mjs --all` 与 IMPLEMENTATION_CONTROL 逐项比较；任一语义漂移直接 FAIL。`G07_A_STATUS=IMPLEMENTED` 只表示等待新的独立 G07-B。审计必须在最终 HEAD 运行完整证据命令，不得据此启动产品 Task。

## 11. R3 最小 MVP 活动入口

R3 以 `docs/MVP_IMPLEMENTATION_PLAN_R3.md` 和 `docs/MVP_TASK_INDEX_R3.json` 为唯一新入口；旧 G04 revision 2、G07 R2/V11 与 85 项索引仅用于历史映射。创作者授权的最小激活已记录：

```text
R3_PLAN_STATUS=APPROVED
R3_EXECUTION_STATUS=ACTIVE
R3_READY=2
R3_PLANNED=11
R3_SELECTED_TASK=null
```

只允许运行以下只读命令：

```text
pnpm mvp:plan
node tools/mvp-plan.mjs status
node tools/mvp-plan.mjs dry-run
node tools/mvp-plan.mjs --self-test
```

`tools/mvp-plan.mjs` 不实现 start、lease、transition 或任何状态写入。本源窗口不得启动产品 Task。`docs/R3_EXECUTION_HANDOFF.md` 已记录创作者要求新窗口执行当前 R3；新窗口只需完成一次最小激活，不得重做 Task 架构。13 项中包含 9 个页面唯一 owner；所有 Coder、Business Auditor、Reviewer 和 MVP Gate Runner 请求 `gpt-5.6-terra`，页面 Auditor 必须检查原型/CSS/外观/布局/交互继承及真实浏览器状态。
