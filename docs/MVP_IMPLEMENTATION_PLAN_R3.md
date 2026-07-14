# MVP Implementation Plan R3

## 1. 当前状态

- Plan revision: 3
- Base commit: `5e7e4caa2d4bf20d098bc44f80c9678cf1715a89`
- Plan status: `CANDIDATE_PAUSED`
- Execution status: `PAUSED_BY_CREATOR`
- Task state: `0 READY / 13 PLANNED`
- Selected task: none
- 当前窗口只完成 Task 重排和交接，不启动产品 Task。
- 创作者已要求新窗口按当前 R3 执行；新窗口可以记录一次最小激活，不需要再次询问是否采用 R3。

旧 G04 revision 2、G07 R2/V11 和 85-Task `IMPLEMENTATION_CONTROL` 只保留为历史映射来源，不再是活动任务源。

## 2. MVP 交付原则

1. 产品只有浏览器 Web，不开发或验收移动端、桌面端原生应用。
2. Web 负责用户操作，n8n 负责编排，PostgreSQL 负责事务和业务真值。
3. 内部载荷保持简单 JSON。除 FP008-02 外不建设复杂 API、事件平台、通用网关或恢复框架。
4. `apps/api` 只允许 FP008-02 的密钥、CORS 或流式薄胶水，不得持有业务状态机。
5. 使用当前本地 PostgreSQL 和 n8n，不新建容器。Git 只做版本管理，不承担部署。
6. V7 外功能、V7 可选增强、原型中的额外按钮和代码优化进入 `FEATURE_CANDIDATES.md`。
7. 页面是前端最小交付单位。同一页面不能被多个 Task 拆开施工。

## 3. 13 个 Task

R3 由 3 个运行底座、9 个页面缝合 Task 和 1 个只读 MVP Gate 组成。

| Task | 唯一页面/责任 | 原型 | 推理基线 |
|---|---|---|---|
| `F0-05-PG-RUNTIME-GUARDS` | PostgreSQL 锁、幂等、CAS、事务回滚 | 无页面 | terra / high |
| `F0-06-N8N-PRODUCTION-BASE` | 最薄 n8n 生产骨架 | 无页面 | terra / medium |
| `F0-07-RUNTIME-SEEDS` | 内置技能和运行默认值 | 无页面 | terra / medium |
| `S1-WORKBENCH-PAGE` | 工作台、配置、共享视觉层 | `workbench.html` | terra / medium |
| `S1-NEW-BOOK-PAGE` | 新书录入、补全、预览、原子建书 | `new_book.html` | terra / medium |
| `S2-WORLD-PAGE` | 世界候选、编辑、版本、确认/退回 | `world_creator.html` | terra / medium |
| `S2-CHARACTERS-PAGE` | 角色、关系、记忆、版本、确认/退回 | `character_settings.html` | terra / medium |
| `S2-L1A-PAGE` | 冲突候选、三线排序、逐条确认、锁定 | `l1a_settings.html` | terra / high |
| `S3-PRODUCTION-STAGE-PAGE` | 启动、场景条件包、章方案、执行计划 | `production_stage.html` | terra / high |
| `S4-MULTI-AGENT-DEDUCTION-PAGE` | 颗粒、FP008-02 推演、进度/暂停/恢复 | `multi_agent_deduction.html` | terra / high |
| `S4-AUDIT-REVIEW-PAGE` | 推演审查、放行/退回、锁定、正文交接 | `audit_review.html` | terra / high |
| `S5-AUDIT-STAGE-PAGE` | 正文、P0 审计、主编、修订、正式写回 | `audit_stage.html` | terra / high |
| `MVP-GATE` | 真实浏览器单章全链路验收 | 读取全部 9 页 | terra / high |

`iteration.html`、`skill_library.html`、`tabs_effect_preview.html` 和世界拖拽实验页不属于当前单章 MVP 页面集合。

## 4. 最短依赖路径

激活后，`F0-05-PG-RUNTIME-GUARDS` 与 `F0-06-N8N-PRODUCTION-BASE` 可并行施工；二者完成后进入：

`F0-07-RUNTIME-SEEDS -> S1-WORKBENCH-PAGE -> S1-NEW-BOOK-PAGE -> (S2-WORLD-PAGE || S2-CHARACTERS-PAGE) -> S2-L1A-PAGE -> S3-PRODUCTION-STAGE-PAGE -> S4-MULTI-AGENT-DEDUCTION-PAGE -> S4-AUDIT-REVIEW-PAGE -> S5-AUDIT-STAGE-PAGE -> MVP-GATE`

两个 Coder 可以并行编辑不相交 scope；集成合并、同一数据库迁移验证和同一 n8n runtime 写入保持串行。

## 5. 页面唯一所有权

每个 Page Task 一次交付以下内容：

- `apps/web/src/pages/<page>/**`：该页面结构、局部 CSS、交互和可见状态。
- `orchestration/workflows/<page>/**`：该页面调用的最小 n8n 工作流。
- `db/migrations/*__<page>__*.sql`、`db/functions/<page>/**`：该页面需要的真值与事务。
- `packages/contracts/src/<page>/**`：最小请求、结果、状态和错误 JSON。
- `tests/pages/<page>/**`：从真实页面操作到 n8n/PostgreSQL 结果的页面级测试。

`S1-WORKBENCH-PAGE` 唯一拥有 `apps/web/src/app/**`、`apps/web/src/styles/**` 和 `apps/web/src/components/navigation/**`。其他页面必须继承共享视觉层，只修改自己的页面目录；共享 CSS 需要调整时返回其 owner，不允许两个页面 Task 同时改共享 CSS。

## 6. CSS、外观、布局和交互合同

视觉参考固定为目标页面 HTML，以及：

- `docs/前端原型_v2/common/theme.css`
- `docs/前端原型_v2/common/sidebar.css`
- 当前 `apps/web/src/app` 浏览器壳

实现必须系统继承以下可观察特征：

- 颜色与 CSS token、字体层级、间距和信息密度。
- 侧栏、顶栏、页面导航和主要布局区域。
- 控件形态、分组、视觉优先级和交互顺序。
- 正常、空态、加载、失败、退回、恢复、禁用和完成状态。
- 跨页面导航时当前作品上下文和可见状态连续。

原型只决定视觉和交互方向，不扩大业务功能。原型中不属于 V7 anchors/acceptance 的控件必须删除、禁用或登记候选，不能因为“还原页面”进入 MVP。

## 7. 页面审计

每个 Page Task 必须由一个全新、独立的 terra Business Auditor 在真实本地页面验收。Auditor 不审个人代码偏好，重点检查：

- 合同内操作能从页面完成，并连接真实 n8n/PostgreSQL，不是静态假数据。
- 成功、失败、退回、恢复和重复点击具有正确可见状态。
- 在 `1440x900` 和 `1280x720` 下无内容重叠、文本截断、布局跳动、失效按钮或不连贯导航。
- CSS、外观、布局、控件层级和交互顺序与登记原型及共享视觉层保持系统一致。
- 页面没有偷偷加入 V7 外功能，也没有因为删除 V7 外功能破坏核心布局。

最低证据为真实 URL、正常截图、失败或退回截图、恢复截图、交互结果和原型差异说明。Reviewer 只在 CRITICAL_SQL、FP008-02 或控制合同修改时增加，不能用代码优化阻断普通页面。

## 8. V7 业务边界

- 新书页不包含 FP001-05 商业评分。
- L1A 页不包含 FP004-05 变体和健康建议。
- 生产页在启动时从正式世界、角色、关系、有效记忆、锁定 L1A 和生效配置物化一个版本化 `scene_condition_package`；未来态、不可用资源、知识越权、场景缺失或未解决数据债必须拒绝。
- 多代理页先产出轻量颗粒，FP008-02 再逐颗粒实时生成 `char_tasks`。pgvector 召回必须回查 PostgreSQL `is_valid`。
- 推演审核页只有完整通过结果可以原子锁定并触发正文生成。
- 正文审计页不包含 FP011 或 FP012-03。第三次 N 结束为 `abandoned_by_user`，不存在 `manual_required`。
- Y 后必须依次完成事实不变文风增强、非空 `formal_summary`、`change_limit`，再进入 `released`。
- 正式正文、摘要、账本、实际触达和章节进度在一个 PostgreSQL 事务中写回。
- MVP 不创建 `world_binding` 或 `world_knowledge_entry` 物理表。

## 9. terra 模型策略

Coder、Business Auditor、Reviewer、MVP Gate Runner 以及必要的 Architect/Replanner 全部请求 `gpt-5.6-terra`。`actual_model` 只能从委派窗口或平台会话元数据记录，不能靠提示词自报。

普通 Task 基线为 `medium`。CRITICAL/HIGH、锁、事务、P0、FP008-02、正式原子写回和 MVP Gate 基线为 `high`。Orchestrator 可以把 medium 升为 high，但不能降低 Task Index 已登记强度。

terra 不可用或无法确认实际模型时转 `ENVIRONMENT_APPROVAL_REQUIRED`，不自动换其他模型系列。模型和推理强度不能改变 Schema、V7 anchors、acceptance 或业务合同。Auditor/Reviewer 即使使用同一 terra 系列，也必须是独立会话和独立上下文。

## 10. 并发和集成

- 最多两个依赖闭合且 write scope 不相交的 Coder 并行。
- 第一组是 F0-05 与 F0-06；第二个明确并行点是 World Page 与 Characters Page。
- Coder 只改获批 scope，不改 Task Index、`.autonomy` 或治理文档，也不能创建代理。
- candidate commit 改变后，旧 Auditor/Reviewer 证据全部失效。
- 合并只进入本地 `autonomy/integration`，不合并 main、不 push、不上云。

## 11. 新窗口交接

完整交接提示词位于 `docs/R3_EXECUTION_HANDOFF.md`。

本窗口保持 `PAUSED_BY_CREATOR` 和 `0 READY / 13 PLANNED`。新窗口读取本交接后，可以把当前创作者指令持久化为一次最小激活，目标初始状态是：

- `plan_status=APPROVED`
- `execution_status=ACTIVE`
- `F0-05-PG-RUNTIME-GUARDS=READY`
- `F0-06-N8N-PRODUCTION-BASE=READY`
- `2 READY / 11 PLANNED`

该激活不允许重做 Task 架构或增加功能。激活后应立即并行派发 F0-05 与 F0-06。

`MVP-GATE` PASS 只形成本地 MVP 候选。main、push、云部署、生产部署和 R0 发布仍为 `CREATOR_REQUIRED`。
