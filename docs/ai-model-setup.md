# AI 模型接入

学生网页不会直接调用模型供应商，也不会保存或读取 API Key。生产链路为：

```text
学生答疑页 -> Supabase tutor-chat Edge Function -> 模型供应商 API
                                      -> 私有资料/已确认错题检索
```

## 文本答疑（DeepSeek）

在 Supabase Dashboard 的 `Edge Functions -> Secrets` 中保存：

```text
AI_TEXT_BASE_URL=https://api.deepseek.com
AI_TEXT_MODEL=deepseek-chat
AI_TEXT_API_KEY=<在供应商后台创建的 Key>
```

Key 只能填在 Supabase Secrets，不得写入 `.env`、GitHub Pages 的 `VITE_*` 变量、源码或聊天记录。保存后部署 `settings` 和 `tutor-chat`，在教师端“平台设置”中启用 AI，再点击“检测文本模型”。只有真实请求返回合法 JSON 时才算连通。

## 图片答疑

DeepSeek 文本配置不等于图片识别。图片答疑需要另一个兼容 OpenAI Chat Completions 且真实支持图片输入的视觉模型：

```text
AI_VISION_BASE_URL=<视觉服务的 OpenAI 兼容地址>
AI_VISION_MODEL=<支持图片输入的模型名>
AI_VISION_API_KEY=<视觉服务 Key>
```

未配置视觉模型时，文字答疑仍可用，图片按钮会停用。作业 PDF 原件保留给教师人工批改；当前 AI 初批只读取图片附件。

## Embedding（可选）

未配置 Embedding 时使用 PostgreSQL 关键词检索，不影响资料引用。若启用，服务必须支持 1536 维输出：

```text
AI_EMBEDDING_BASE_URL=<Embedding 服务地址>
AI_EMBEDDING_MODEL=<1536 维模型名>
AI_EMBEDDING_API_KEY=<Embedding 服务 Key>
```

再次运行资料增量同步时，系统会给内容未变化但缺少向量的旧片段补齐 Embedding。

## 上线检查

1. 教师端显示“配置已检测”。
2. “检测文本模型”返回模型名和延迟。
3. 学生监护人知情时间已记录。
4. 教师端已启用 AI，并设置每日消息额度。
5. 用不含真实学生隐私的测试题分别验证资料命中和资料未命中回答。

模型失败、超时或输出未通过安全校验时，接口返回可重试错误，学生输入不会被清空。模型 Key 不会进入前端构建产物或 Bootstrap 响应。
