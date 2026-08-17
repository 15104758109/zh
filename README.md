# 纵横叙事引擎 V7

本仓库是本地运行的小说生产 MVP。浏览器页面、既有 n8n 工作流和 PostgreSQL
共同完成产品旅程；FP008-02 是 V7 明确的 Node.js 高代码例外。

## 快速启动

```powershell
pnpm install --frozen-lockfile
pnpm start
```

默认打开 `http://127.0.0.1:4176/workbench`。需要自定义端口时，在启动前设置
`PORT`。完整环境准备、可选服务和验证命令见[安装与本地运行说明](docs/安装与本地运行.md)。

## 文档入口

- [业务说明](docs/业务说明.md)：产品目标、用户旅程、职责边界和业务权威来源。
- [安装与本地运行说明](docs/安装与本地运行.md)：环境、配置、启动、验证和故障边界。
- [MVP 当前进度](docs/MVP_PROGRESS.md)：唯一活动进度记录，只收录真实旅程结果。
- [V7 设计文档](docs/v7设计文档_20260709_终版.md)：唯一业务范围权威。
- [执行规则](AGENTS.md)：协作、审批和运行时变更边界。

## 目录

```text
apps/web/                       十个正式 Web 路由和共享页面资源
apps/api/src/features/fp008/    FP008-02 高代码运行时
db/install/                     PostgreSQL canonical 数据/RPC
docs/前端原型_v2/              页面视觉与交互参考
docs/后端/n8n/                 可修改的 n8n 附件
packages/contracts/src/         页面和 RPC 的 JSON 合同
tests/business/                 跨层业务旅程
tests/pages/                    页面、工作流和运行时验证
```

根目录的 `.tmp-*` 是本地执行、诊断和回滚材料，已忽略且不进入 Git。仍用于
后端回滚的备份必须在仓库外归档后才能删除。
