# V7 MVP 当前进度

更新时间：2026-08-14（PDT）

## 验收结果

MVP 验收要求同一本书、同一 `local_operator_id` 从真实 Web 页面输入开始，依次经过 V7 规定的页面、n8n、PostgreSQL 和刷新恢复，连续完成 10 个正式章节。

当前结果：**0/10 个正式章节**。静态页面、源码或夹具测试、直接数据库写入、旧执行回放，以及受控失败均不计入完成。

## 当前真实结果

- 验收书 `d2173b3a-75a4-49df-9528-dfc08f9f6eb8` 已以 canonical `rpc_finalize_deduction_snapshot` 恢复为第 1、2 章 `plan_ready`；两章均无候选推演、检查点或正文，`deduction_locked=false`。
- ZH05 `fc798416-f7be-4ee6-abe6-199a98f97933` 已从当前 live workflow 做最小发布并读回 active version `5605e08a-4dfb-4504-8454-df37c125a524`：两个 FP008-01 HTTP 节点消费 active FP016 `parameters_jsonb.timeout_ms=240000`，且 n8n 无 HTTP 响应的传输失败返回既有 `MODEL_CALL_FAILED` 零写入路径。37 项 focused workflow tests 通过。该 HTTP 节点的 timeout 只约束响应头和响应体开始，不是整段流式响应的总时限。
- 真实页面 execution `3614` 使用该 published version；FP008-01 收到 HTTP 200 的 provider `ResourceExhausted` 信封，`JSON修复` 返回 `MODEL_PROVIDER_UNAVAILABLE`，未进入 FP008-02 或 RPC-009。PostgreSQL 前后均为两章 `plan_ready`、无候选推演/检查点/正文。
- 真实页面 execution `3634` 证明 provider 可再次产生有效 FP008-01 输入并进入 FP008-02；FP008-02 在等待 `770304 ms` 后连接被重置（`ECONNRESET: socket hang up`）。`JSON修复1` 以 `DEDUCTION_SERVICE_FAILED` 返回，FP008-03/04 只走现有失败响应，`rpc_request=null`；两章 PostgreSQL、产品请求日志和页面刷新均保持零写入、可重试。
- 真实页面 execution `3635` 使用同一 published version；FP008-01 的 HTTP 200 响应体为 7,843 个空白字符，不含 JSON 信封或模型正文。`JSON修复` 正确返回 `MODEL_OUTPUT_INVALID`，未进入 FP008-02、FP008-03/04 或 RPC-009；两章仍为 `plan_ready`、无 checkpoint/候选推演/正文且未锁定。刷新后重新选择第 1 章，页面恢复 8 个颗粒和可用“开始推演”。
- 页面在受控错误后显示既有“开始推演”；刷新、重新选择第 1 章后仍显示 8 个颗粒和可用“开始推演”，没有重放旧错误或产生业务写入。

## 当前运行时阻断

当前最小阻断是 FP008-01 上游 provider 的空白 HTTP 200 响应：execution `3635` 在 304 秒后得到只含空格和换行的响应，当前 `JSON修复` 已按合同 fail-closed 为 `MODEL_OUTPUT_INVALID`。这是用户不可处理的模型/供应商异常，不是 JSON 修复器或 FP008-02 的业务错误；当前失败映射、零写入、服务重启后的内存清理和页面刷新恢复均已证明正确。现有 HTTP 节点可重试网络 throw，但尚未证明能把这类 200 空白内容转换为同一请求的参数级重试；V7 未定义备用模型、自动切换或把空白响应伪装成候选推演的规则。

## 最小下一步

先以 execution `3635` 的保存响应确认 HTTP Request 节点能否仅通过现有响应格式参数把纯空白 HTTP 200 变为节点错误，从而复用已上线的 `retryOnFail/maxTries`；这一步不新增或重连节点。若 n8n 不支持该参数级恢复，FP008-01 的语义重试仍需审批，因为最小实现需要新增或重连重试控制边；之后再从同一页面重新触发并验收 FP008-01/02/04、RPC-009 和刷新恢复。

## 继续执行约束

- 不使用手工正文、直接写入成功审计/正式章节、伪造页面成功或绕过页面调用 workflow。
- 每次只修复一个经真实 execution 证明的首失败边界；workflow 变更必须备份、发布、读回并进行真实页面触发。
- 当前候选的技术恢复只允许恢复到 V7 已有的“待正文呈现”页面入口，保留请求和审计证据。
