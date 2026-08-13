# 纵横叙事引擎 V7

本仓库是本地运行的单章小说生产 MVP。产品链路由浏览器页面、现有 n8n
工作流和 PostgreSQL 组成；只有 V7 明确标记为高代码例外的 FP008-02 使用
独立 Node.js 服务。

当前实现仍在联调。测试通过只证明对应合同，不代表整条 MVP 已可用；缺少
V7 数据定义或运行配置的入口会明确失败，不会返回假成功。

## 当前进度

产品旅程的唯一活动进度记录是 `docs/MVP_PROGRESS.md`。它只记录已由真实页面、
n8n 和 PostgreSQL 证明的结果、当前阻塞和下一步，不定义业务范围，也不恢复
历史 Task Index、审计证据协议或开发治理状态机。

## 权威来源

1. `docs/v7设计文档_20260709_终版.md` 定义业务功能、前后端职责和数据状态。
2. `docs/前端原型_v2/` 定义页面内容、DOM、布局、CSS 和原型交互；WORLD
   使用 `pages/world-settings-drag-binding.html`。
3. `docs/前端原型_v2/common/ScreenShot_2026-06-28_043110_371.jpg` 是共享
   组件颜色和风格语义参考。
4. `docs/后端/n8n/*.json` 是本地 n8n 工作流的唯一可修改基线。
5. `db/install/v7-data-rpc-contract.sql` 是 PostgreSQL 数据标准和 RPC 的唯一
   canonical 安装入口。

现有源码、数据库和测试只说明“当前实现了什么”，不能覆盖 V7 对“应该实现
什么”的定义。任何文档外功能、默认值、状态、RPC 字段或工作流职责都必须先
用业务语言说明影响并获得创作者批准。

## 技术环境

- Node.js 24
- pnpm 9
- PostgreSQL：现有 `n8n-pgvector` 容器中的 `zh_narrative`
- n8n：现有本地实例 `http://127.0.0.1:5678`
- Web：原生 HTML、CSS 和 JavaScript ESM
- FP008-02：TypeScript/Node.js

本项目不新建容器，不依赖云部署，也不需要 MySQL、SQLite 或 SQL Server。

## 本地运行

```powershell
pnpm install --frozen-lockfile
$env:PORT=4191
pnpm dev:web
```

打开 `http://127.0.0.1:4191/workbench`。数据库连接用户从容器内的
`POSTGRES_USER` 读取；本地 n8n 连接使用工作区已有 `.env`，不得把凭据写入
页面、工作流附件或仓库。

FP008-02 服务按需启动：

```powershell
pnpm --filter @zhreplan/api start:fp008
```

仅在明确要重建空的本地产品库时运行 `pnpm db:v7:rebuild`。不要对已有业务
数据的库把它当作增量迁移命令。

## 验证

```powershell
pnpm typecheck
pnpm build
pnpm test:db
pnpm test:business
pnpm test:pages
pnpm test:web
```

- `test:db` 从 canonical SQL 建立隔离临时库并验证 B1-B8 数据旅程。
- `test:business` 验证页面、n8n 和 RPC 之间的 V7 业务职责。
- `test:pages` 验证页面适配、状态、工作流映射和 FP008 服务。
- `test:web` 验证十个正式路由、原型移植和本地静态资源。

页面最终验收使用真实本地路由和 1920x1080、100% 缩放，检查原型视觉、
正常/空/加载/失败/恢复状态、直接刷新、跨页作品上下文、控制台错误和真实
按钮。生成截图和一次性审计报告不进入仓库。

## 目录

```text
apps/web/                       十个正式 Web 路由和共享页面资源
apps/api/src/features/fp008/    FP008-02 高代码运行时
db/install/                     PostgreSQL canonical 数据/RPC
docs/前端原型_v2/              页面视觉与交互参考
docs/后端/n8n/                 可修改的 n8n 附件
packages/contracts/src/         当前页面和 RPC 的 JSON 合同
tests/business/                 跨层业务旅程
tests/pages/                    页面、工作流和运行时验证
```

协作和审批边界见 `AGENTS.md`。
