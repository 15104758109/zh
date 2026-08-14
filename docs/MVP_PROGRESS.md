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
- 页面在受控错误后显示既有“开始推演”；刷新、重新选择第 1 章后仍显示 8 个颗粒和可用“开始推演”，没有重放旧错误或产生业务写入。

## 当前运行时阻断

当前最小阻断是 FP008-02 服务在有效推演中断开连接：execution `3634` 已跨过 FP008-01 并向本地服务提交了合法输入，但服务端在长模型调用期间关闭连接，n8n 收到 `ECONNRESET: socket hang up`。这是当前阻断真实页面到 RPC-009 的工程 P0；失败映射、零写入和刷新恢复已证明正确。FP008-01 的上游 provider 仍有 HTTP 200 `ResourceExhausted`、HTTP 429 限流和空响应三种不稳定形态，现有 n8n 节点不能将后两类语义失败驱回上游请求。V7 未定义备用模型、自动切换或把该 payload 伪装成候选推演的规则。

## 最小下一步

先让同一个有输出日志、受当前验收控制的 FP008-02 服务实例完成一次页面回放，定位连接关闭的第一条运行时错误；只修该服务生命周期/调用边界，再验证 FP008-01/02/04、RPC-009 和刷新恢复。FP008-01 对 HTTP 200 错误信封和空响应的真实请求重试仍需单独审批，因为现有节点参数无法回驱上游 HTTP，最小实现需要新增或重连重试控制边。

## 继续执行约束

- 不使用手工正文、直接写入成功审计/正式章节、伪造页面成功或绕过页面调用 workflow。
- 每次只修复一个经真实 execution 证明的首失败边界；workflow 变更必须备份、发布、读回并进行真实页面触发。
- 当前候选的技术恢复只允许恢复到 V7 已有的“待正文呈现”页面入口，保留请求和审计证据。
