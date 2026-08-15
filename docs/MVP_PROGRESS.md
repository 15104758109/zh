# V7 MVP 当前进度

更新时间：2026-08-15（PDT）

## 真实用户旅程

- MVP 当前为 **1/10 个正式章节**。验收书 `d2173b3a-75a4-49df-9528-dfc08f9f6eb8` 的第 1 章版本 `5c766357-4d65-4d45-ba0a-2f7a5482302f` 已从真实页面进入 ZH06，依次通过 FP009、FP010、FP011、FP012、FP013，并由 `rpc_commit_chapter` 正式写入。
- 当前真实 execution `3779` 停在 FP012-02 创作者确认等待：章节和版本均为 `formal`、`valid`，`review_decision=Y`，`confirmation_status=unconfirmed`，`run_status=awaiting_creator_confirmation`。这是 V7 的创作者确认常态，不是后端暂停故障。
- 已修复正式化后旧 FP008 paused snapshot 使 `/api/books/.../deduction` 误报 `RPC_UNAVAILABLE` 的投影缺陷。真实接口恢复 200，刷新审核页可读取下一章候选和已正式的审计投影；不把内存 paused 状态伪装成可恢复检查点。
- 真实 `/audit` 页面可显示正式正文与三类审计结果；当前“继续下一章/退回当前章”仍禁用，因为 execution `3779` 的初始 webhook 响应没有返回页面合同要求的 signed `wait_route`，不能安全调用等待回调。

## 当前运行时阻断

- ZH06 live workflow `ed2280fe-25ab-401f-a700-d2a79d40c369` 的 `activeVersionId=2f07958b-997a-4e25-9a99-a13ecaa1bcad`。现有 Respond 节点在 FP012-01 的并行分支执行，早于 `rpc_commit_chapter` 与 FP012-02 Wait；即使 `$execution.resumeUrl` 可用，提前返回会让创作者拿到尚未进入等待的地址，形成竞态。
- 恢复创作者继续/退回需要将既有成功响应连接到 `FP013-02` 成功后，并保留同一 Wait 节点与签名 `$execution.resumeUrl`。这是一处既有 n8n 连线调整，需按 AGENTS 的审批边界执行、发布读回并以新的真实页面旅程复验。
- FP016 的模型配置不再是当前第 1 章的首个阻断：本次 FP012-01 真实主编输出为合法 Y。模型输出可靠性仍须在后续章节持续观察，优先保持 JSON 解析与 V7 DTO fail-closed，不从 reasoning 伪造业务裁决。

## 最小下一步

获得该最小 ZH06 连线调整的批准后：备份 live workflow，重连已存在的 `FP013-02正文入库 -> Respond：审计与写回完成` 成功出口并移除 FP012-01 的提前成功响应，发布读回；从同一本书真实页面重新触发下一章节，验证 signed `wait_route`、`/audit` 按钮、continue/return 回调、PostgreSQL 和刷新恢复。之后继续同一本书的连续 10 章验收。
