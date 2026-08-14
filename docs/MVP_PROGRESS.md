# V7 MVP 当前进度

更新时间：2026-08-14（PDT）

## 验收结果

MVP 验收要求同一本书、同一 `local_operator_id` 从真实 Web 页面输入开始，依次经过 V7 规定的页面、n8n、PostgreSQL 和刷新恢复，连续完成 10 个正式章节。

当前结果：**0/10 个正式章节**。静态页面、源码或夹具测试、直接数据库写入、旧执行回放，以及受控失败均不计入完成。

## 当前真实结果

- 当前书的页面 `/books/:bookId/deduction-review` 能读取同一锁定 L1A 的顺序第 1 章；刷新后真实显示既有“开始生成正文”动作。
- 为恢复前次技术失败，只在可回退备份保护下清空同一候选的候选正文并将章节恢复为 `deduction_complete`；没有伪造正文、审计、正式章节或跨书数据。
- ZH06 的 `JSON修复 (2)` 已针对 execution `3578` 的唯一闭合符错位发布并读回。它只移动唯一终端 `}` 到唯一缺失的对象闭合处；九项检查、P0 清单、交接包和 RPC 校验仍 fail-closed。
- 当前 active FP016 模型已恢复为 `nvidia/nemotron-3-super-120b-a12b:free`，配置版本 `33`；ZH06 workflow `ed2280fe-25ab-401f-a700-d2a79d40c369` 已发布并读回 active version `23e62e42-d545-40ce-89ce-df87000f4a46`。
- 真实执行 `3593` 使用旧 OpenAI credential 在 RelayCove 返回 401；`3594` 使用 RelayCove credential 得到 HTTP 200，但 Claude 输出不符合 FP010 JSON 合同，parser 正确拒绝；两者均未写入业务状态。
- 真实页面执行 `3598` 已通过 FP009（HTTP 200、JSON 修复成功、候选正文约 1703 字），随后 FP010 模型调用超时并取消；真实页面执行 `3599` 在同一 Nemotron 入口超过 7 分钟无后续节点输出后取消。取消执行均确认无数据库写入。
- 当前数据库仍为同一候选 `5c766357-4d65-4d45-ba0a-2f7a5482302f` 的 `prose_text=NULL`、章节 `status/run_status=deduction_complete`、客观审计 `0`、正式章节 `0`。
- 页面已修复旧 `presentationError` 和失败幂等键遮住后端可重试状态的问题；刷新后会回到既有按钮，而不重放旧失败响应。

## 当前运行时阻断

当前最小阻断是 active provider 在真实页面触发中出现无输出或超时：`3598` 在 FP010 调用超时，`3599` 在 FP009/FP010 后续节点无输出。FP009/FP010 binding、endpoint、请求映射和已有 3 次/5 秒 transport retry 已核对一致；现有解析器正确拒绝空或非 JSON 响应，数据库保持同一候选可重试状态。V7 未定义备用模型或响应级自动重试规则，不得将 headers/status 伪装为正文或审计 DTO。

## 最小下一步

保持页面在同一 `deduction-review` 的“开始生成正文”入口；当前不再重复触发高成本模型请求。待 provider 返回完整 completion，或创作者明确批准备用模型/响应级自动重试规则后，再继续检查 FP010 解析、RPC/PostgreSQL、刷新恢复和后续审计节点的第一个实际失败边界。

## 继续执行约束

- 不使用手工正文、直接写入成功审计/正式章节、伪造页面成功或绕过页面调用 workflow。
- 每次只修复一个经真实 execution 证明的首失败边界；workflow 变更必须备份、发布、读回并进行真实页面触发。
- 当前候选的技术恢复只允许恢复到 V7 已有的“待正文呈现”页面入口，保留请求和审计证据。
