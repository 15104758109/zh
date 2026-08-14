# V7 MVP 当前进度

更新时间：2026-08-14（PDT）

## 验收结果

MVP 验收要求同一本书、同一 `local_operator_id` 从真实 Web 页面输入开始，依次经过 V7 规定的页面、n8n、PostgreSQL 和刷新恢复，连续完成 10 个正式章节。

当前结果：**0/10 个正式章节**。静态页面、源码或夹具测试、直接数据库写入、旧执行回放，以及受控失败均不计入完成。

## 当前真实结果

- 验收书 `d2173b3a-75a4-49df-9528-dfc08f9f6eb8` 已以 canonical `rpc_finalize_deduction_snapshot` 恢复为第 1、2 章 `plan_ready`；两章均无候选推演、检查点或正文，`deduction_locked=false`。
- ZH05 `fc798416-f7be-4ee6-abe6-199a98f97933` 已从当前 live workflow 做最小发布并读回 active version `5605e08a-4dfb-4504-8454-df37c125a524`：两个 FP008-01 HTTP 节点消费 active FP016 `parameters_jsonb.timeout_ms=240000`，且 n8n 无 HTTP 响应的传输失败返回既有 `MODEL_CALL_FAILED` 零写入路径。37 项 focused workflow tests 通过。该 HTTP 节点的 timeout 只约束响应头和响应体开始，不是整段流式响应的总时限。
- 真实页面 execution `3614` 使用该 published version；FP008-01 收到 HTTP 200 的 provider `ResourceExhausted` 信封，`JSON修复` 返回 `MODEL_PROVIDER_UNAVAILABLE`，未进入 FP008-02 或 RPC-009。PostgreSQL 前后均为两章 `plan_ready`、无候选推演/检查点/正文。
- 页面在受控错误后显示既有“开始推演”；刷新、重新选择第 1 章后仍显示 8 个颗粒和可用“开始推演”，没有重放旧错误或产生业务写入。

## 当前运行时阻断

当前最小阻断是 active FP008-01 provider 未产生可用模型结果：execution `3614` 在约 3 秒内返回 HTTP 200 的 `ResourceExhausted: Worker local total request limit reached (33/32)` 错误信封；同一页面入口的 execution `3618` 使用同一 published version，在 HTTP 节点等待 `304323 ms` 后只得到空响应，未进入 FP008-02 或 RPC-009。现有节点可重试 HTTP/网络 throw，但不能把 HTTP 200 错误信封或已开始响应后的空结果驱回上游请求；V7 未定义备用模型、自动切换或把该 payload 伪装成候选推演的规则。两次前后 PostgreSQL 均保持第 1、2 章 `plan_ready`、无候选推演/检查点/正文，页面恢复可重试入口。

## 最小下一步

需先决定是否按 V7 补齐 FP008-01 对 HTTP 200 错误信封和空响应的真实请求重试：现有节点参数无法回驱上游 HTTP，最小实现需要新增或重连重试控制边，属于审批边界。若暂不变更拓扑，待 provider 恢复后仍从同一推演页第 1 章的既有“开始推演”入口重新触发一次；先验收 FP008-01/02/04 的真实完成、RPC-009 和刷新恢复，再进入 FP009/FP010 的首个实际失败边界。

## 继续执行约束

- 不使用手工正文、直接写入成功审计/正式章节、伪造页面成功或绕过页面调用 workflow。
- 每次只修复一个经真实 execution 证明的首失败边界；workflow 变更必须备份、发布、读回并进行真实页面触发。
- 当前候选的技术恢复只允许恢复到 V7 已有的“待正文呈现”页面入口，保留请求和审计证据。
