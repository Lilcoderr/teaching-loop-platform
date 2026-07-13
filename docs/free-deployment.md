# GitHub Pages + Supabase 免费部署

V1 默认使用 GitHub Pages 托管 React/PWA 静态前端，Supabase 官方免费项目承载 Auth、PostgreSQL、RLS、Storage 和 Edge Functions。不需要购买云服务器。

> 该方案适合少量学生试运行，但 GitHub Pages 与 Supabase 在中国大陆的访问速度和稳定性不能保证。Supabase 免费项目受配额和闲置暂停政策约束，真实使用前应取得监护人知情同意并完成网络与权限验收。

## 线上资源

- 前端：`https://lilcoderr.github.io/teaching-loop-platform/`
- 代码：`https://github.com/Lilcoderr/teaching-loop-platform`
- 后端：`https://ifthxykbxivkqmiwjfte.supabase.co`
- 区域：`Southeast Asia (Singapore)`

GitHub 仓库只保存程序代码。账号、作业、错题、评价、聊天和资料文件都存放在启用 RLS 的 Supabase 私有资源中；学生资料、题库、`memory-bank`、数据库密码和服务端密钥不得进入 Git 历史。

## GitHub Actions 配置

| 类型 | 名称 | 内容 |
|---|---|---|
| Repository variable | `VITE_SUPABASE_URL` | Supabase Project URL |
| Repository secret | `VITE_SUPABASE_ANON_KEY` | Supabase publishable key |

`.github/workflows/pages.yml` 会在 `main` 推送后执行 lint、test、生产构建并发布 Pages。生产构建固定使用 `VITE_DEMO_MODE=false`，缺少任一 Supabase 配置时直接失败，避免线上静默进入演示模式。

## Supabase 配置

- Auth Site URL 与 Redirect URL 均包含完整 Pages 地址。
- 公开注册关闭，学生和家长账号只由教师创建。
- `ALLOWED_ORIGINS=https://lilcoderr.github.io`，Origin 不包含仓库路径。
- 所有业务表启用 RLS；学生只能访问本人数据，家长只能读取关联学生的已发布周报。
- `submissions` 与 `materials` Storage bucket 保持私有。
- Edge Functions 使用 Supabase 自动注入的服务端密钥；Service Role Key 不进入 GitHub。

AI 未配置时，上传、人工批改、错题整理、评价、资料、留言和复习功能仍可使用。AI Key、同步令牌和教师管理令牌只能存放在 Supabase Secrets 或被忽略提交的本地配置中。

## 本地环境

从 `.env.example` 创建被 Git 忽略的 `.env.local`：

```dotenv
VITE_DEMO_MODE=false
VITE_SUPABASE_URL=https://ifthxykbxivkqmiwjfte.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
VITE_BASE_PATH=/

PLATFORM_URL=https://ifthxykbxivkqmiwjfte.supabase.co
KNOWLEDGE_SYNC_TOKEN=
TEACHER_ACCESS_TOKEN=
```

所有 `VITE_*` 都会进入浏览器构建产物，只能放公开客户端配置。`SUPABASE_SERVICE_ROLE_KEY`、模型 Key 和专用同步令牌绝不能以 `VITE_` 开头。

## 上线验收

- 两种上传、在线批改、教师评价、错题入库、复习任务和资料检索完整可用。
- 学生 A 无法访问学生 B 的资料、错题或聊天；家长只能查看已发布周报。
- 一级提示不能引用完整解析，达到完整解答阶段后才允许使用 `solution_gated` 内容。
- 构建产物不含 Service Role Key、AI Key、同步令牌、真实学生姓名或本地绝对路径。
- 在学生真实手机、移动网络和家庭网络上实测访问，并保留备用提交渠道。

## 可选升级

[国内自托管部署](deployment.md)保留为将来需要境内数据落地或更稳定国内访问时的付费升级路线，不是当前免费 V1 的前提。
