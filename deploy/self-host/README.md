# 国内自托管模板

这个目录放生产部署的模板和脚本，不包含真实密钥。正式上线时建议把仓库放到服务器 `/opt/teaching-loop/repo`，把 Supabase 官方 self-hosting compose 固定到 `/opt/teaching-loop/supabase`。

## 文件说明

| 文件 | 用途 |
|---|---|
| `Caddyfile.example` | `app`、`api`、`studio` 三个子域名的 HTTPS 反向代理示例 |
| `docker-compose.override.example.yml` | Supabase 官方 compose 的最小覆盖示例，强调端口不直接暴露公网 |
| `app.env.example` | 前端构建公开环境变量模板 |
| `supabase.env.example` | 自托管 Supabase 私有环境变量模板 |
| `scripts/generate-secrets.ps1` | 生成 JWT secret、数据库密码等本地候选值 |
| `scripts/health-check.ps1` | 检查前端、API、Studio 的 HTTPS 可用性 |
| `scripts/backup-postgres.ps1` | 使用 `docker compose exec db pg_dumpall` 生成数据库备份 |

## 上线顺序

1. 准备已备案域名和大陆云服务器。
2. 安装 Docker Engine、Docker Compose Plugin、Caddy 或 Nginx。
3. 固定 Supabase 官方 self-hosting 版本，把官方 `docker/` 目录放到 `/opt/teaching-loop/supabase`。
4. 按 `supabase.env.example` 创建服务器私有 env 文件，填入生成的随机密钥。
5. 设置 `SITE_URL=https://app.example.com`、`API_EXTERNAL_URL=https://api.example.com`、`ALLOWED_ORIGINS=https://app.example.com`。
6. 启动 Supabase 后执行 `supabase/migrations/` 中的迁移。
7. 构建前端 `dist/`，同步到 `/opt/teaching-loop/app/`。
8. 配置 HTTPS 反代，只开放 `80/443`。
9. 创建首位教师账号，完成 RLS、上传、批改、错题库、家长周报和备份恢复验收。

## 安全边界

- 不把数据库、Kong 内部端口、Studio 默认端口直接暴露公网。
- 不在命令行参数里粘贴真实 Service Role Key、AI Key 或同步令牌。
- 不把服务器 `.env`、备份文件、Storage 原始文件同步回 Git。
- AI 默认可以关闭；未配置模型时，人工批改和资料浏览仍应可用。
