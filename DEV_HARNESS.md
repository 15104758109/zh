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
- 因此当前可启动 F0-01 仓库底座实现，或继续治理/差距审计；不得启动其他 Task，也不得声称任何 FP 已实现或已验证。

## 10. G07-A 自治控制面

稳定政策锚点为 `G07::AUTONOMY`，机器政策位于 `.autonomy/policy.json`。`tools/project-orchestrator.mjs` 只管理 HMAC 完整性事件、严格语义回放、Task/Slice 状态投影、nonce 租约、证据、预算、恢复、简报和角色提示词；它不直接调用模型。Coder、Auditor、Reviewer、Architect 与 Slice Gate Runner 只返回 `g07-role-report/v2` 结构化报告，不得直接写 ignored 运行时 `.autonomy/events.jsonl` 或 Task 状态。

```text
node tools/project-context-loader.mjs --self-test
node tools/project-orchestrator.mjs --self-test
node tools/project-orchestrator.mjs status --run-id <run-id>
node tools/project-orchestrator.mjs dry-run --run-id <run-id>
node tools/project-orchestrator.mjs resume --run-id <run-id>
node tools/project-orchestrator.mjs report --run-id <run-id> [--slice-id <slice>]
```

- `dry-run` 只能计算下一 Task、角色、FP 集、scope 和上下文哈希；它必须比较前后事件字节/哈希、Task 投影哈希和精确 scope 产品树哈希来证明不写事件、不改状态、不创建产品文件。
- 只有 Orchestrator 可执行 `lease`、`record`、`verify-evidence`、`transition` 和 `unlock`；`record` 的 PASS/APPROVE 文字不能直接形成 `VERIFIED`。证据验证还必须绑定 clean worktree、当前稳定控制上下文、同一 commit、含删除的 scope、秘密扫描和可信平台身份/会话见证。
- 同一 run 最多一个写租约和两个只读审查租约；过期租约只能由 `resume`/下一次原子租用记录恢复事件。
- 验收、scope、秘密、stale commit/context 等证据失败必须写 `EVIDENCE_REJECTED`、失败指纹和计数后进入返修；三次返修进入 Replan。Architect 只处理 A/B/C/D，C 必须转 `CREATOR_REQUIRED`；两次 Replan 耗尽时按依赖祖先闭包暂停关键路径。Orchestrator 不接受字符串解除 `CREATOR_REQUIRED`。
- 预算任一已配置维度达到 80% 通知、100% 硬停；未知费用不得假报为 0。
- G07 阶段禁止真实项目模型调用、付费测试、push、部署、生产写入、凭据访问和自动合并主分支。平台授权不可绕过；当前没有可信角色会话见证提供方时也必须返回 `ENVIRONMENT_APPROVAL_REQUIRED`，不得把不同 actor/session 字符串当机械独立性。
- 当前 `G07_GATE=PENDING`，因此即使路由器确认 `F0-01-REPO` 为唯一 READY，G07-A dry-run 也必须拒绝产品执行。测试、dry-run、G07-A/G07-B 或 Architect 均不得自行写 `G07_GATE=APPROVED`。
- 当前返修实现由 `G07_A_COMMIT=e68accecac93d60c533c63eddc4a18c1053667d6` 锁定，测试/dry-run/scope/秘密证据位于 `docs/G07_A_EVIDENCE.json`；登记提交只更新控制状态和证据引用，不改该实现 commit。
