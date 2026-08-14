# V7 MVP 当前进度

更新时间：2026-08-14（PDT）

## 验收结果

MVP 验收要求同一本书、同一 `local_operator_id` 从真实 Web 页面输入开始，依次经过 V7 规定的页面、n8n、PostgreSQL 和刷新恢复，连续完成 10 个正式章节。

当前结果：**0/10 个正式章节**。静态页面、源码或夹具测试、直接数据库写入、旧执行回放，以及受控失败均不计入完成。

## 当前真实结果

- 验收书 `d2173b3a-75a4-49df-9528-dfc08f9f6eb8` 已以 canonical `rpc_finalize_deduction_snapshot` 恢复为第 1、2 章 `plan_ready`；两章均无候选推演、检查点或正文，`deduction_locked=false`。
- ZH05 `fc798416-f7be-4ee6-abe6-199a98f97933` 已从当前 live workflow 做最小发布并读回 active version `5605e08a-4dfb-4504-8454-df37c125a524`：两个 FP008-01 HTTP 节点消费 active FP016 `parameters_jsonb.timeout_ms=240000`，且 n8n 无 HTTP 响应的传输失败返回既有 `MODEL_CALL_FAILED` 零写入路径。37 项 focused workflow tests 通过。
- 真实页面 execution `3614` 使用该 published version；FP008-01 收到 HTTP 200 的 provider `ResourceExhausted` 信封，`JSON修复` 返回 `MODEL_PROVIDER_UNAVAILABLE`，未进入 FP008-02 或 RPC-009。PostgreSQL 前后均为两章 `plan_ready`、无候选推演/检查点/正文。
- 页面在受控错误后显示既有“开始推演”；刷新、重新选择第 1 章后仍显示 8 个颗粒和可用“开始推演”，没有重放旧错误或产生业务写入。

## 当前运行时阻断

当前最小阻断是 active FP008-01 provider 的容量限制：execution `3614` 在约 3 秒内返回 `ResourceExhausted: Worker local total request limit reached (33/32)`。这是模型服务端的 HTTP 200 错误信封，不是 n8n 传输超时；V7 未定义备用模型、自动切换或把该 payload 伪装成候选推演的规则。页面和数据库均已保持可重试状态。

## 最小下一步

待 provider 容量恢复后，从同一推演页第 1 章的既有“开始推演”入口重新触发一次；先验收 FP008-01/02/04 的真实完成、RPC-009 和刷新恢复，再进入 FP009/FP010 的首个实际失败边界。

## 继续执行约束

- 不使用手工正文、直接写入成功审计/正式章节、伪造页面成功或绕过页面调用 workflow。
- 每次只修复一个经真实 execution 证明的首失败边界；workflow 变更必须备份、发布、读回并进行真实页面触发。
- 当前候选的技术恢复只允许恢复到 V7 已有的“待正文呈现”页面入口，保留请求和审计证据。
