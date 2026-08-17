# V7 MVP 当前进度

更新时间：2026-08-16（PDT）

## 真实用户旅程

- 验收书《熔炼末世：文明重启》`fa26bdb2-6c0c-446a-8739-d85ec39990aa` 在同一 book/operator/L1A 上已完成第 1 至第 4 章的真实生产、审计、正式写入和作者确认。
- 第 4 章 `ffdf2151-9e68-417d-b117-ca1efad8f821`，正式版本 `d9d52b5b-8ce7-472c-a80c-4eda06222e8f`。`4047` 在 FP012-02 正常等待后恢复为 `success`，章节状态为 `creator_confirmed`。
- 第 5、6 章已由同一书的 L1A `73df8587-6d93-4a78-8011-add9f55ad5f5` 经 ZH05 `4080` 完成真实推演；两章均为 `deduction_complete`、`deduction_locked=true`，仍是未确认候选，尚未进入正文呈现、审计或正式化。
- `/deduction-review` 已能在刷新后识别 current L1A 上正式、有效、非影子且待作者确认的章节，并跳转到既有 scoped `/audit` 页面；它不拼接或暴露签名回调。该恢复经过真实 API、浏览器刷新和 PostgreSQL 状态核验。

## 当前运行时阻断

- 第 5 章已产生候选正文并被 FP010 客观审计正确拦截：正文越过锁定推演且包含主角未知的规则细节，页面可从既有“继续正文呈现”恢复同一候选审计链路。
- 2026-08-17 的免费模型实测阻断：GLM 5.2 连接测试 503；Nemotron Nano 返回 reasoning 而无 `message.content`；gpt-oss 与 Gemma 返回 429；Super 与 Ultra 在真实正文调用中长挂起。Ultra 的执行 `4110` 最终返回可解析的 FP010 JSON，却缺少 V7 强制 `audited_handoff_package`，被 `JSON修复 (2)` 以 `FP010_OUTPUT_INVALID` 正确阻止。不得放宽该节点或伪造交接包。

## 最小下一步

保留第 5 章同一候选及页面恢复入口；等待一个能同时满足免费可用、标准 `message.content`、真实正文响应时延和 FP010 完整交接包合同的供应商模型后，从既有 `/deduction-review` 页面恢复 FP009-00。
