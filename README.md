# 知行学伴

面向一对一家教场景的学情闭环平台。学生分别提交当日作业与错题/不会题，查看教师批改、今日评价、错题本和按科目专题整理的学习资料，并进行分级 AI 答疑；教师负责确认 AI 初批、在线批改作业、发布评价和学习资料；家长只能查看已经发布的周报。

> 当前仓库可以直接运行虚构数据演示。接入真实学生前，必须完成 Supabase、RLS、Storage、Edge Functions、监护人知情同意和真实网络验收。未配置 AI 时，上传、人工批改、错题整理、评价、学习资料、留言和复习流程仍应可用。

## 架构边界

```text
GitHub Pages（React/PWA 静态前端）
                 │ HTTPS
                 ▼
Supabase 新加坡免费项目（Auth / PostgreSQL / RLS / Storage / Edge Functions）
                 │ 服务端调用
                 ▼
可选 AI / Embedding 供应商

本地讲义目录 ──专用令牌──> 私有知识库
已确认学情   <──教师导出── memory-bank/网站同步
```

- V1 默认使用 GitHub Pages + Supabase 官方免费项目，适合少量学生试运行。
- GitHub Actions 在 `main` 推送后执行检查并自动发布 Pages。
- `VITE_*` 会进入浏览器构建产物，不能存放 Service Role Key、AI Key 或同步令牌。
- 学生数据、讲义、题库和 `memory-bank` 不进入本仓库；本地配置文件已由 `.gitignore` 排除。
- Codex 不作为学生聊天后端，也不会让学生输入直接访问本地工作区。
- 学生和家长账号由教师发放临时密码；真实环境首次登录会显示不可跳过的改密窗口，密码更新和后端确认均成功后才解除限制。

## 本地演示

要求 Node.js 20 或更高版本。

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

保持 `.env.local` 中 `VITE_DEMO_MODE=true`，打开终端显示的本地地址。应用默认进入教师演示视角，可通过界面切换教师、学生和家长，也可以使用[演示账号](docs/demo-accounts.md)。演示数据只保存在当前浏览器 `localStorage`，不得用于录入真实学生资料。

常用检查：

```powershell
npm run lint
npm test
npm run build
npm run preview
```

## 真实环境

1. 按[GitHub Pages + Supabase 免费部署指南](docs/free-deployment.md)创建新加坡免费项目、执行数据库迁移、部署 Edge Functions，并配置 GitHub Pages。
2. 将 `.env.local` 的 `VITE_DEMO_MODE` 改为 `false`，填写 Supabase URL 与浏览器 `anon` key，在本地完成登录、首登强制改密及其他全流程验收。
3. 按[未成年人数据清单](docs/privacy-minors-checklist.md)取得并记录监护人知情同意，确认留存和删除安排。
4. 按[国内访问验收表](docs/china-access-checklist.md)使用学生真实设备、移动网络和家庭网络测试；海外免费服务在国内的稳定性不能保证。
5. `.github/workflows/ci.yml` 做演示构建检查，`.github/workflows/pages.yml` 使用生产 Supabase 配置发布 Pages。
GitHub Pages 与 Supabase 免费额度不要求购买服务器；AI、视觉识别和 Embedding 可能按量付费，未配置模型时非 AI 功能仍可正常使用。

## AI 接入与答疑规则

平台不把 Codex 或任何固定模型直接暴露给学生，也不自带免费模型额度。服务端使用 OpenAI 兼容接口适配供应商：数据库当前默认文本模型名为 `deepseek-chat`，但只有在 Supabase Functions Secrets 中同时配置服务地址和 API Key 后才会真正调用。模型密钥不会保存或显示在网页中。

- 文本答疑至少需要 `AI_TEXT_BASE_URL`、`AI_TEXT_API_KEY` 和对应的 `AI_TEXT_MODEL`。如果供应商确实使用 `deepseek-chat`，可明确填写该模型名；使用其他供应商时填写其实际模型名。
- 单图答疑还需要 `AI_VISION_BASE_URL`、`AI_VISION_API_KEY` 和真正支持图片输入的 `AI_VISION_MODEL`。纯文本 DeepSeek 模型不能代替视觉模型。
- Embedding 为可选项。配置 `AI_EMBEDDING_*` 后使用向量与关键词混合检索；不配置时仍会进行关键词检索，不影响通用 AI 答疑。
- 文本、视觉和 Embedding 可以使用同一供应商的共用 `AI_BASE_URL` / `AI_API_KEY`，也可以分别使用不同供应商。分类配置优先于共用配置。

学生选择“诊断卡点、给个提示、关键步骤、完整解答”后，服务端会锁定对应回答级别。答疑先检索该学生当前科目下获授权的讲义、学习资料和教师确认错题：命中可靠资料时，模型结合资料方法与自身学科能力回答并附来源；未命中时直接使用通用模型回答，并明确说明本次未在已学资料中找到对应内容。图片只进行一次视觉转录，随后由文本模型结合转录、检索结果、学生尝试和所选级别生成回答。

## 本地资料联动

以下命令读取被忽略提交的本地配置，任何令牌都不应出现在命令行参数、日志或 Git 中：

```powershell
Copy-Item tools/knowledge-sources.example.json knowledge-sources.local.json
Copy-Item tools/memory-pull.example.json memory-pull.local.json
Copy-Item tools/question-bank-import.example.json question-bank-import.local.json

npm run knowledge:sync -- --config knowledge-sources.local.json
npm run memory:pull -- --config memory-pull.local.json
npm run question-bank:import -- --config question-bank-import.local.json
```

复制后先把匿名占位、学生 UUID 和本地目录改为实际值。这三份 `*.local.json` 已被忽略提交；不要直接把真实学生资料写回 `tools/*.example.json`。

- `knowledge:sync`：增量同步指定学生、科目的 Markdown/HTML 讲义；同名文件优先 Markdown，文件消失时只停用远端版本。
- `memory:pull`：把网站中教师确认的学情导出到本地待整理目录，不自动覆盖正式档案。
- `question-bank:import`：只导入已复核且可追溯到原试卷、题号和页码的题目，禁止 AI 编题。

具体配置模板和当前能力边界见[部署与 Secrets 指南](docs/deployment.md)。

## 文档

- [GitHub Pages + Supabase 免费部署](docs/free-deployment.md)
- [EdgeOne 国内访问镜像](docs/edgeone-mirror.md)
- [可选：国内自托管部署与 Secrets](docs/deployment.md)
- [国内访问验收表](docs/china-access-checklist.md)
- [未成年人数据与隐私操作清单](docs/privacy-minors-checklist.md)
- [演示账号与验收路径](docs/demo-accounts.md)

## 费用与可用性声明

- GitHub Pages 只承载公开静态前端，不承载真实学生数据。
- Supabase 免费项目承载数据库和私有文件，受免费额度、闲置暂停和海外网络可用性限制。
- AI、视觉识别和向量模型的价格、上下文限制、数据处理条款应在上线前重新核对，并设置每日额度和总预算告警。
- 模型供应商仍是公网依赖，在中国大陆不同运营商和时段的可用性需要实测；未通过真实网络测试前，不应把平台作为唯一交作业渠道。
