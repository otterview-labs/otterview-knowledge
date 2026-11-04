# 独立知识库工作台

知识库可以使用单独的站点账号登录。这个模式服务于一套共享资料的工作台：它提供一个操作账号，现有文档权限仍由运行时根据配置的资源属主判断。若要给每位成员单独账号和访问权限，应使用团队身份系统，不能共用此模式作为多租户入口。

## 配置和启动

1. 给站点分配一个浏览器信任的 HTTPS 域名，让反向代理保留请求的 Host，并让 Uvicorn 只信任该代理的转发头。不要将代理头信任地址设为 `*`。本地开发可使用 `http://127.0.0.1:<端口>`。
2. 在由服务进程独占的目录创建配置，目录不应位于静态文件或上传目录：

   ```bash
   install -d -m 700 /etc/otterview-knowledge/workspace
   python scripts/configure_workspace_auth.py /etc/otterview-knowledge/workspace/account.json \
     --origin https://knowledge.example.org --username workspace-admin
   ```

   工具会交互式读取密码，配置仅保留盐和哈希，权限为 `0600`。默认资源属主为 `anonymous`，适合过去通过无认证接口导入的资料；已有专用属主的部署使用 `--owner-id` 指定现有 ID。会话 SQLite 数据库创建在同一目录，容器部署需把整个目录挂载为可写，并由服务进程用户独占。
3. 给知识库服务配置 `KNOWLEDGE_WORKSPACE_AUTH_FILE=/etc/otterview-knowledge/workspace/account.json`，重启知识库。未设置该变量时，运行时保留原有 API 鉴权行为。设置后，首页、文档、上传文件和 API 都经过会话校验；`/health` 和登录所需的两项静态资源仍可访问。

## 已有 Agent 调用

切换前确认每个调用方。对已核对的 Agent 搜索、复核集合创建和批量入库接口，可以配置服务令牌：生成 32 字节随机 URL 安全令牌（无填充，43 个字符），把令牌的 SHA-256 十六进制摘要放入配置的 `service_token_sha256`，只给 Agent 配置令牌原文。Agent 的 HTTP 客户端通过 `X-Knowledge-Service-Token` 发送；其他路径仍需浏览器登录。令牌应通过私有 Docker 网络或 TLS 传递。不要在公网代理上开放本来只供 Agent 使用的直连端口。

## 切换验收

- 浏览器访问根路径先看到登录；登录后能列集合、搜索、打开正文和摘要，并能上传。
- 未登录访问检索 API 和上传文件链接均被拦截；退出后旧会话失效。
- Agent 正常调用实际使用的接口；匿名请求及无权限的服务令牌不能调用这些接口。
- 检查反代的 TLS 与应用健康。保留原启动配置作为回滚点。
