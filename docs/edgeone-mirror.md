# EdgeOne 国内访问镜像

本项目保留 GitHub Pages 作为备用入口，并可通过 EdgeOne Makers 发布同一份 React/PWA 静态前端。两个入口共用 Supabase；EdgeOne 只负责静态文件分发，不会复制学生作业、错题或模型密钥。

## 自动部署

`.github/workflows/edgeone-makers.yml` 在 `main` 推送或手动触发时执行：

1. 安装依赖、运行 lint 和测试。
2. 使用 `VITE_BASE_PATH=/` 构建根路径产物（GitHub Pages 的仓库子路径构建不复用）。
3. 使用官方 `edgeone makers deploy` CLI 发布到固定项目名 `teaching-loop-platform`。

需要在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中配置：

- `EDGEONE_API_TOKEN`：EdgeOne Makers 控制台创建的短期 API Token。建议设置 1 天至 1 年的过期时间，过期后重新替换，不要写入代码、日志或聊天。
- `VITE_SUPABASE_URL`：已有的仓库变量。
- `VITE_SUPABASE_ANON_KEY`：已有的仓库 Secret。

如果只在 EdgeOne 控制台绑定 GitHub 仓库，也可以由 EdgeOne 自己构建部署；本工作流适合希望两个平台都由一次 `git push` 触发的情况。

## 免费与国内访问边界

EdgeOne Makers 当前提供免费档，但免费资格、配额和服务稳定性以账号控制台显示为准，不承诺 SLA。官方域名管理规则还要求注意：

- 选择“中国大陆可用区”或“全球可用区（含中国大陆）”时，系统生成的项目/部署预览链接有效期为 3 小时，过期可能返回 401。
- 要获得长期固定入口，通常需要绑定自定义域名；上述加速区域的自定义域名需要完成 ICP 备案。
- 选择“全球可用区（不含中国大陆）”虽然不要求备案，但中国大陆网络访问会返回 401，不适合作为国内镜像。

因此，未准备备案域名前，EdgeOne 入口应视为国内可用性测试/临时镜像；GitHub Pages 继续作为备用入口。EdgeOne 也不能消除 Supabase 海外区域和模型供应商带来的跨境延迟，登录、上传、答疑仍需在学生手机网络上实测。

## 密钥边界

EdgeOne 构建产物只含浏览器可用的 Supabase URL 与 anon key。AI API Key、Service Role Key、同步令牌和数据库密码仍只放在 Supabase Secrets 或本地私有配置，绝不放入 EdgeOne 环境变量和前端构建产物。

官方参考：

- [EdgeOne Makers CLI 与 CI/CD](https://pages.edgeone.ai/zh/document/edgeone-cli)
- [API Token](https://pages.edgeone.ai/zh/document/api-token)
- [域名管理与中国大陆访问规则](https://pages.edgeone.ai/zh/document/domain-overview)
