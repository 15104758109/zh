# V7 MVP 当前进度

更新时间：2026-08-14（PDT）

## 真实用户旅程

- MVP 当前为 **0/10 个正式章节**。验收书 `d2173b3a-75a4-49df-9528-dfc08f9f6eb8` 的第 1、2 章均为 `plan_ready`；没有候选推演、checkpoint、正文或 `deduction_locked`。
- 真实页面从第 1 章“开始推演”触发 ZH05 `fc798416-f7be-4ee6-abe6-199a98f97933`。execution `3659` 的 FP008-01 收到 HTTP 200，但只有 headers/statusCode/statusMessage，没有 `data/body`；未进入 FP008-02、FP008-03/04 或 RPC-009，零业务写入。
- ZH05 已发布并读回 active version `b5231eaa-69a0-4365-b83f-0389ddf8aaba`：`JSON修复` 仅把“2xx 且缺 data/body”归为既有 `MODEL_OUTPUT_INVALID`，保留已解析但颗粒合同不完整时的 `PARTICLE_MAPPING_REJECTED`。节点数量与连接未变，focused workflow tests `37/37` 通过。
- 新版本的真实页面 execution `3660` 未产生任何节点结果或数据库写入，24 分钟无正文后被精确停止。页面刷新并重新选择第 1 章后恢复 8 个颗粒和可用“开始推演”入口。
- 受控模型测试未切换 active 配置：RelayCove Haiku 当前为 HTTP 401，Gemma 当前为 HTTP 429，均未保存为模型模板。

## 当前运行时阻断

FP008-01 当前 active 的 OpenRouter/Nvidia Super 已出现一次 HTTP 200 无正文和一次无正文挂起。JSON 信封/映射职责已按现有错误合同修复并经发布读回；剩余阻断是用户不可处理的 provider/model 稳定性。没有可通过当前受控连接测试的替代模型，且 V7 未定义自动切换模型、语义级重试或把无正文伪装为候选推演的规则。

## 最小下一步

等待一个可通过受控连接测试的 FP016 候选模型后，串行从第 1 章真实页面重试一次，并验收 FP008-01 -> FP008-02 -> FP008-03/04 -> RPC-009、PostgreSQL 和刷新恢复。不得直接写入成功推演、正文或章节状态。
