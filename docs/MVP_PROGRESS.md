# V7 MVP 当前进度

更新时间：2026-08-17（PDT）

## 真实用户旅程

- 验收书《熔炼末世：文明重启》`fa26bdb2-6c0c-446a-8739-d85ec39990aa` 在同一 book/operator/L1A 上已完成第 1 至第 8 章的真实生产、审计、正式写入和作者确认。
- 第 4 章 `ffdf2151-9e68-417d-b117-ca1efad8f821`，正式版本 `d9d52b5b-8ce7-472c-a80c-4eda06222e8f`。`4047` 在 FP012-02 正常等待后恢复为 `success`，章节状态为 `creator_confirmed`。
- 第 5、6 章已由同一书的 L1A `73df8587-6d93-4a78-8011-add9f55ad5f5` 经 ZH05 `4080` 完成真实推演，并在 ZH06 `4114` 中真实经过 FP009 至 FP013、正式写入和作者继续确认；当前作品已有 6 章正式章节。该 L1A 已正常完成。
- L1A `dd559013-19eb-4cd0-ad2d-fb6ff0f2ce92` 的第 7、8 章候选均已通过既有 deduction/audit/作者确认链路；第 8 章 `ad21b7d8-3216-49b4-9298-af4dc29413be`、版本 `112ea96c-0e26-4b69-acce-7daf56821c4f` 由 ZH06 `4130` 完成 FP009 至 FP013 并正式写入。
- `/deduction-review` 已能在刷新后识别 current L1A 上正式、有效、非影子且待作者确认的章节，并跳转到既有 scoped `/audit` 页面；它不拼接或暴露签名回调。该恢复经过真实 API、浏览器刷新和 PostgreSQL 状态核验。

## 当前运行时阻断

- RelayCove 模型目录当前不包含 Claude Haiku；`gpt-5.6-luna` 与 `gpt-5.6-terra` 已通过无业务数据的 Chat Completions JSON 探针。复杂任务仍由已验证的 Terra binding 承担，模型目录不声明免费/价格能力。
- RelayCove Terra 已经独立命令、ZH00 受控连接测试和真实 ZH06 `4114` 验证。复杂任务模板 active v70 指向 `gpt-5.6-terra`；ZH06 的 FP009、FP010、FP013 凭据映射与模板一致。无当前工程 P0 阻断。

## 最小下一步

从既有生产页面生成第 9、10 章候选，按同一页面、n8n、PostgreSQL 与刷新恢复链路完成正文推演、审计和作者确认。
