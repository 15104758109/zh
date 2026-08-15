# V7 MVP 当前进度

更新时间：2026-08-14（PDT）

## 真实用户旅程

- MVP 当前为 **0/10 个正式章节**。验收书 `d2173b3a-75a4-49df-9528-dfc08f9f6eb8` 的第 2 章已从真实推演页执行“继续推演 -> 暂停推演”。
- ZH05 `fc798416-f7be-4ee6-abe6-199a98f97933` 已发布版本 `c95730a0-03cd-4d05-b750-accec55e5cd5`。execution `3691` 真实经过 FP008-02 -> FP008-03 -> FP008-04 -> RPC-009：RelayCove 返回 HTTP 200，严格风险提示校验通过，RPC-009 返回 `deduction_partial`。
- 第 1 章候选版本已保存完整推演 `8/8` 并 `deduction_locked=true`；第 2 章候选版本 `fd875a1d-595f-4055-bfd7-ec69143f81b3` 保持 `0/5`、`deduction_locked=false` 的可恢复暂停检查点。第 2 章 token 为 `65,779`，L1A token 为 `2,880,677 / 10,000,000`。没有正文、正式章节或正式活态写入。
- 刷新真实推演页后，页面显示第 1 章“推演已完成”、第 2 章“推演部分完成”和“继续推演”；页面令牌数与 PostgreSQL 一致，浏览器无 console error。

## 当前运行时状态

暂停是 V7 正常状态。此前第 2 章无法恢复的首个工程阻断是 FP008-03 RelayCove 节点将提示词字符串中的 `{{...}}` 误解析为嵌套 n8n expression；已仅修复该请求映射并由 execution `3691` 验证。当前没有运行中的 n8n execution。

ZH06 审核页已经从真实页面发起 FP009 正文呈现。execution `3695` 在旧 RelayCove/Haiku 绑定下返回模型拒绝文本，JSON 修复节点正确阻止其成为候选正文；刷新页面后可恢复为“开始生成正文”。切换后的 OpenRouter Super（execution `3704`）与 `openrouter/free`（execution `3715`）都在外部模型响应阶段超过六分钟且无下游节点数据，已由 n8n API 取消；Nano 与 Ultra 的受控连接测试分别返回 Nvidia worker `ResourceExhausted` 和 provider error。所有这些执行前后，第一章候选 `5c766357-4d65-4d45-ba0a-2f7a5482302f` 仍为 `prose_text` 空、`audit_attempt_log` 为 0。

当前 FP009/FP010 运行时绑定已回退到 OpenRouter Super 版本 `44`；版本 `43` 的 `openrouter/free` 已归档。每次模型模板变更均通过 Workbench 的受控测试与保存路径完成，且保留了 `.tmp-fp016-before-openrouter-free-20260814-211900.dump`、`.tmp-fp016-before-ultra-20260814-213000.dump` 两份窄范围回退备份。ZH06 源合同回归 `64/64 PASS`；这不是完整用户旅程通过证据。

本书已进入 production，世界、角色和前端变体等设计辅助功能只读是业务常态，不能通过解锁或改库倒退补测。它们的正向验收必须在一本文档合法的新书中、FP004-04 锁定前依次覆盖；FP015-02 技能评价与优化保持 `REFERENCE_ONLY`，验收标准是不调用模型且不写库。

## 最小下一步

当前工程 P0 是外部模型在完整 FP009 输入上的容量/长响应阻断，而不是页面暂停或 JSON 解析错误。保持当前书候选状态不变，等待已配置供应商恢复可完成响应，或由创作者批准接入一个已验证可承载完整 FP009 输入的模型供应商；恢复后从审核页重试并检查 FP009、FP010、PostgreSQL 和刷新恢复。启动新的完整十章验收书时，先在设计阶段完成世界设定助手、角色设定助手和前端变体的正向旅程。不得直接写入成功推演、正文或章节状态。
