# CF Emby Player

一个部署在 **Cloudflare Workers** 上的轻量 Emby 播放器（原生 HTML/CSS/JS）。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/luckyf1oat/cfemby)

> 一键部署前，请先把 `<YOUR_GITHUB_REPO_URL>` 替换成你的公开 GitHub 仓库地址（例如 `https://github.com/yourname/cfemby`）。

## 功能

- Emby 登录（服务器地址 + 用户名 + 密码）
- 媒体库列表
- 条目列表（Movie/Episode 可播放）
- 内置视频播放器
- Worker 代理 API（避免浏览器 CORS 问题）
- 本地配置管理（localStorage）

## 项目结构

```txt
.
├─ src/
│  └─ worker.js        # Worker 入口 + API + 静态页面
├─ package.json
├─ wrangler.toml
└─ README.md
```

## 1) 安装依赖

```bash
npm install
```

## 2) 本地开发

```bash
npm run dev
```

然后打开 Wrangler 提供的本地地址（通常是 `http://127.0.0.1:8787`）。

## 3) 登录 Cloudflare（首次）

```bash
npx wrangler login
```

## 4) 部署到 Cloudflare Workers

```bash
npm run deploy
```

部署成功后，wrangler 会输出一个 `*.workers.dev` 域名，直接访问即可。

## 使用说明

1. 在登录区域输入：
   - Emby 地址（例如 `https://emby.example.com`）
   - 用户名
   - 密码
2. 登录后点击媒体库
3. 在条目里点击“播放”

## API 说明（前端调用 Worker）

- `POST /api/login`
- `GET /api/libraries`
- `GET /api/items?parentId=xxx`
- `GET /api/stream?itemId=xxx&mediaSourceId=xxx&server=...&token=...&userId=...`

> 注意：为了让 `<video>` 直接拉流，`/api/stream` 使用 query 参数携带鉴权信息（快速可用优先）。

## 已知限制

1. 当前方案默认“实现优先”，并非零暴露源站。浏览器可见 Emby 服务器地址。
2. 未做多用户隔离与后端持久会话。
3. 仅实现基础视频播放，未扩展字幕轨道/码率切换等高级功能。

## 后续可升级方向

- 增加 Worker 侧会话（HttpOnly Cookie）
- 隐藏 Emby 源站（由 Worker 完整代理）
- 支持分页、搜索、继续播放、字幕选择
- 拆分前端静态文件，不在 Worker 中内嵌字符串
