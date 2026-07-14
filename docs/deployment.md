# 可选：国内自托管部署与 Secrets
本文档是将来需要境内数据落地或更稳定国内访问时的付费升级路线。当前免费 V1 默认使用 GitHub Pages + Supabase 官方免费项目，见 [free-deployment.md](free-deployment.md)。
## 1. 部署结论

- 正式环境使用备案域名 + 中国大陆云服务器 + HTTPS。
- Supabase 使用官方 Docker Compose 自托管，承载 Auth、PostgreSQL、Storage、Realtime、Kong、Studio、Edge Runtime。
- 前端 React/PWA 构建为静态文件，由同一台服务器的 Caddy 或 Nginx 托管。
- AI Key、Service Role Key、同步令牌只放服务器私有 env 文件或云厂商密钥服务，不进入 Git、浏览器、GitHub Actions 或聊天记录。
- Studio、PostgreSQL、Kong 内部端口不得直接暴露公网；公网只开放 `80/443`，并通过反向代理按域名转发。

## 2. 推荐资源

首版建议：

| 项目 | 建议 |
|---|---|
| 云厂商 | 阿里云杭州/上海，或腾讯云上海/广州等大陆区域 |
| 系统 | Ubuntu 24.04 LTS |
| 规格 | 4 核 8 GB 起步，100 GB 云盘起步 |
| 网络 | 公网 IP，备案域名，HTTPS 证书 |
| 备份 | 每日数据库备份 + Storage 文件备份 + 云盘快照 |

购买服务器、域名解析、ICP备案、支付订单、线上部署都属于外部操作，执行前必须再次取得明确授权。

## 3. 域名规划

推荐使用三个子域名：

| 域名 | 用途 |
|---|---|
| `app.example.com` | 学生、教师、家长访问的前端 |
| `api.example.com` | Supabase API、Auth、Storage、Functions 网关 |
| `studio.example.com` | Supabase Studio 管理后台，仅建议临时开放或加白名单/VPN |

`app.example.com` 的前端环境变量：

```dotenv
VITE_DEMO_MODE=false
VITE_SUPABASE_URL=https://api.example.com
VITE_SUPABASE_ANON_KEY=浏览器可用的_anon_key
VITE_BASE_PATH=/
```

## 4. 本地配置文件

从 `.env.example` 复制出 `.env.local`，只用于本机开发和工具调用：

```dotenv
VITE_DEMO_MODE=true
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_BASE_PATH=/

PLATFORM_URL=
KNOWLEDGE_SYNC_TOKEN=
TEACHER_ACCESS_TOKEN=
```

注意：

- 所有 `VITE_*` 都会进入浏览器构建产物，只能放公开配置。
- `PLATFORM_URL` 指向 `https://api.example.com`，本地同步工具会自动补出 `/functions/v1/<函数名>`。
- `KNOWLEDGE_SYNC_TOKEN`、`TEACHER_ACCESS_TOKEN`、Service Role Key、数据库密码和 AI Key 都不能提交。

## 5. 服务器文件

仓库提供自托管模板目录：[deploy/self-host](../deploy/self-host/)。

建议服务器目录结构：

```text
/opt/teaching-loop/
├── app/                    # 前端 dist 静态文件
├── repo/                   # 本仓库代码
├── supabase/               # 官方 Supabase self-hosting compose
├── env/
│   ├── supabase.env        # 私有，不提交
│   └── app.env             # 私有，不提交
├── backups/
│   ├── postgres/
│   └── storage/
└── caddy/
    └── Caddyfile
```

服务器上的 `env/*.env` 必须权限收紧，只允许部署用户读取。

## 6. 自托管 Supabase

正式部署时按 Supabase 官方 self-hosting Docker 文档固定一个 Supabase 版本。推荐流程：

1. 在服务器安装 Docker Engine 和 Docker Compose Plugin。
2. 拉取 Supabase 官方仓库中 `docker/` 目录到 `/opt/teaching-loop/supabase`。
3. 复制 `.env.example` 为私有 `.env`，用 `deploy/self-host/scripts/generate-secrets.ps1` 生成 JWT secret、anon key、service role key、数据库密码等。
4. 设置 `SITE_URL=https://app.example.com`，`API_EXTERNAL_URL=https://api.example.com`。
5. 将本仓库 `supabase/functions/` 挂载或同步到官方 compose 的 Edge Runtime functions 目录。
6. 启动服务后执行数据库迁移，并创建首位教师账号。

本仓库不提交官方 compose 的完整副本，避免版本漂移；只提交覆盖配置、反代示例和运维脚本。真正上线时应记录使用的 Supabase commit 或 release tag。

## 7. 数据库迁移与函数

数据库依赖扩展：

- `pgcrypto`
- `vector`
- `citext`
- `pg_trgm`

迁移文件位于 `supabase/migrations/`。迁移后应确认：

- RLS 已启用，学生只能访问本人数据。
- 家长只能访问关联学生的已发布周报。
- 浏览器不能写入教师确认字段、发布周报、创建账号或读取知识片段正文。
- Storage bucket 为私有桶，文件下载经服务端权限校验。

Edge Functions 依赖环境变量：

| 变量 | 是否必需 | 用途 |
|---|---|---|
| `SUPABASE_URL` | 必需 | 自托管 API 地址 |
| `SUPABASE_ANON_KEY` | 必需 | 验证普通用户请求 |
| `SUPABASE_SERVICE_ROLE_KEY` | 必需 | 服务端特权操作 |
| `ALLOWED_ORIGINS` | 正式必需 | 允许的前端 Origin |
| `AI_BASE_URL` | 可选 | 三类模型共用的 OpenAI 兼容服务地址；可被下方分类地址覆盖 |
| `AI_API_KEY` | 可选 | 三类模型共用密钥；可被下方分类密钥覆盖 |
| `AI_TEXT_BASE_URL` / `AI_TEXT_API_KEY` | 可选 | 文本答疑与周报模型的独立服务地址和密钥 |
| `AI_VISION_BASE_URL` / `AI_VISION_API_KEY` | 图片答疑必需 | 作业识别和题目图片答疑的独立服务地址和密钥 |
| `AI_EMBEDDING_BASE_URL` / `AI_EMBEDDING_API_KEY` | 向量检索可选 | Embedding 服务的独立地址和密钥；未配置时仍使用关键词检索 |
| `AI_TEXT_MODEL` | 可选 | 文本分析/答疑模型；设置后覆盖数据库中的默认模型名 |
| `AI_VISION_MODEL` | 图片答疑必需 | 必须是所配置视觉服务实际支持图片输入的模型，不能填写纯文本模型 |
| `AI_EMBEDDING_MODEL` | 可选 | 1536 维向量模型，默认 `text-embedding-3-small` |

分类配置优先于共用的 `AI_BASE_URL` / `AI_API_KEY`；某一分类缺少地址或密钥时，对应字段会分别回退到共用配置。若没有共用后备，则该分类的 URL 与 Key 必须同时配置。模型接口需兼容 OpenAI 的 `/chat/completions` 或 `/embeddings` 请求格式。AI 未配置时，上传、人工批改、错题整理、评价、学习资料、留言和复习功能仍应可用；图片答疑会明确提示视觉模型不可用，不会假装识别图片。

## 8. 前端构建

服务器或 CI 上构建：

```powershell
npm ci
$env:VITE_DEMO_MODE='false'
$env:VITE_SUPABASE_URL='https://api.example.com'
$env:VITE_SUPABASE_ANON_KEY='<anon-key>'
$env:VITE_BASE_PATH='/'
npm run build
```

将 `dist/` 同步到服务器 `/opt/teaching-loop/app/`。`dist/` 中不得出现 AI Key、Service Role Key、同步令牌、学生姓名或本地绝对路径。

## 9. 本地资料工具

三类工具仍从被忽略提交的本地配置读取：

```powershell
Copy-Item tools/knowledge-sources.example.json knowledge-sources.local.json
Copy-Item tools/memory-pull.example.json memory-pull.local.json
Copy-Item tools/question-bank-import.example.json question-bank-import.local.json

npm run knowledge:sync -- --config knowledge-sources.local.json --dry-run
npm run memory:pull -- --config memory-pull.local.json
npm run question-bank:import -- --config question-bank-import.local.json --dry-run
```

- `knowledge:sync`：增量同步指定学生、科目的 Markdown/HTML 讲义和方法技巧。
- `memory:pull`：把教师确认后的学情导出到 `memory-bank/网站同步/`，不覆盖正式档案。
- `question-bank:import`：只导入已复核且有来源的题目，禁止 AI 编题。

## 10. 上线验收

上线前至少完成：

- 两种上传：当日作业、错题/不会题。
- AI 初批失败时进入人工批改队列。
- 教师批改、评价、错题入学生专属题库、复习任务。
- 学习资料按学生/科目/类别展示，支持标题检索和方法技巧正文检索。
- 四级 AI 答疑：卡点诊断、一级提示、关键步骤、完整解答。
- 学生 A 无法访问学生 B 的资料、错题、讲义授权和周报。
- 家长只能看已发布周报。
- 数据库备份可恢复，Storage 文件可恢复。
- 移动网络、家庭宽带和不同手机浏览器实测。
- 构建产物和日志不含真实密钥与学生隐私。

## 11. 运维边界

- 自托管不是免维护，服务器安全补丁、Supabase 升级、备份恢复、磁盘容量、证书续期都需要定期检查。
- Studio 管理后台不建议长期裸露公网。
- 真实学生数据不得同步到海外演示环境。
- 任何 `git push`、部署、购买云资源、改 DNS、改服务器防火墙、删除线上数据，都必须另行确认。
