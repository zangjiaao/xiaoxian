# 把小闲部署到 Cloudflare

小闲用一个 Worker 同时提供页面和 `/api/*`。档案在 D1 里，按 Cloudflare Access 登录邮箱分开。DeepSeek 密钥只放在 Worker secret 里，浏览器不再保存。

下面的命令都在仓库根目录执行。需要 Node.js 22+，以及已经登录的 Wrangler（`npx wrangler login`）。

## 1. 创建 D1

```bash
npx wrangler d1 create xiaoxian
```

命令会打印 `database_id`。打开 `wrangler.jsonc`，把 `d1_databases[0].database_id` 换成这个 UUID。文件里现在的 `11111111-1111-4111-8111-111111111111` 只够本地开发。

## 2. 跑 migrations

远端（部署用的库）：

```bash
npx wrangler d1 migrations apply xiaoxian --remote
```

本地（`wrangler dev` 用的库）：

```bash
npx wrangler d1 migrations apply xiaoxian --local
```

迁移在 `migrations/0001_init.sql`。表有 `profiles`、`charts`、`chat_sessions`、`chat_messages`、`settings`，每一行都带 `user_email`。

## 3. 设置 secret 和 vars

密钥不要写进 `wrangler.jsonc`，也不要贴进聊天记录：

```bash
npx wrangler secret put DEEPSEEK_API_KEY
```

按提示粘贴 DeepSeek 的 key。

这些是普通变量，写在 `wrangler.jsonc` 的 `vars` 里，然后随部署生效：

| 变量 | 作用 |
| --- | --- |
| `DEEPSEEK_MODEL` | 用户没选模型时的默认值，只能是 `deepseek-chat`（默认）或 `deepseek-reasoner` |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com`。Worker 会请求 `{BASE}/chat/completions` |
| `ACCESS_TEAM_DOMAIN` | `https://<团队名>.cloudflareaccess.com` |
| `ACCESS_AUD` | Access 应用的 Audience (AUD) Tag |
| `DEV_USER_EMAIL` | 生产保持空字符串。只在本机 `localhost` / `127.0.0.1` 上跳过 JWT |

`ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 等第 5 步拿到后再填。留空时，线上请求会返回 401。

本地开发把覆盖项放在 `.dev.vars`（已 gitignore），可以照 `.dev.vars.example` 复制：

```bash
DEV_USER_EMAIL=you@example.com
DEEPSEEK_API_KEY=sk-...
```

`.dev.vars` 不会上传。`DEV_USER_EMAIL` 再写进生产变量也没用：Worker 只在请求 Host 是本机时才认它。

## 4. 构建并部署

```bash
npm run deploy
```

这会先 `npm run build`（页面输出到 `dist/`），再 `npx wrangler deploy`。Worker 用 Workers Static Assets 托管 `dist/`，`/api/*` 由 `worker/index.ts` 先处理。

只看会上传什么、不真正发布：

```bash
npm run build
npx wrangler deploy --dry-run
```

本地同时看页面和 API：

```bash
npm run build
npm run cf:dev
```

默认地址是 `http://127.0.0.1:8787`。改前端时也可以另开 `npm run dev`（43123），Vite 会把 `/api` 代理到 8787。

## 5. 用 Cloudflare Access 只让朋友打开

先确认一次性验证码登录可用：

1. 打开 [Cloudflare 仪表盘](https://dash.cloudflare.com/) 的 **Zero Trust**。
2. **Integrations** → **Identity providers** → **Add new identity provider** → **One-time PIN**。
3. 如果邮件网关会拦信，放行发件人 `noreply@notify.cloudflare.com`。

再给小闲建一个自托管应用：

1. **Zero Trust** → **Access controls** → **Applications** → **Create new application**。
2. 选 **Self-hosted**。
3. 应用名例如 `小闲`。Public hostname 填下一步要绑定的自定义域名，例如 `xiaoxian.example.com`。路径留空，保护整站。
4. 添加一条 Allow 策略。名称例如 `朋友`。Include 选 **Emails**，把朋友的邮箱逐个填进去（也加上你自己的）。
5. 在 Require 里加上 **Login methods** → **One-time PIN**，这样名单里的人用邮箱收验证码，而不是任意登录方式。不要只写「允许一次性验证码」却不限制邮箱，否则任何人都能收码进来。
6. 保存应用。

记下两个值，写回 `wrangler.jsonc` 的 `vars`，再 `npm run deploy` 一次：

- **AUD**：打开这个应用的详情 / Overview，复制 **Application Audience (AUD) Tag**，填到 `ACCESS_AUD`。
- **团队域名**：Zero Trust → **Settings** → **Team name and domain**。团队名是 `<team>` 时，`ACCESS_TEAM_DOMAIN` 填 `https://<team>.cloudflareaccess.com`。证书地址是 `{团队域名}/cdn-cgi/access/certs`，Worker 会自己去取，不用另配。

Worker 校验请求头 `Cf-Access-Jwt-Assertion`：签名必须对上团队证书，`iss` 是团队域名，`aud` 包含这个 AUD，并且令牌里有邮箱。邮箱就是用户 id。校验失败返回 401。

Access 挡住的是浏览器入口。Worker 再验一次 JWT，避免有人绕过页面直接打 API。

## 6. 绑定自定义域名

域名要已经在同一个 Cloudflare 账号里。

1. **Workers & Pages** → 选中 `xiaoxian` → **Settings** → **Domains & Routes** → **Add** → **Custom domain**。
2. 填 `xiaoxian.example.com`（和 Access 应用的 hostname 一致）。Cloudflare 会建 DNS 并签发证书。
3. 也可以写进 `wrangler.jsonc` 后再部署：

```jsonc
"routes": [{ "pattern": "xiaoxian.example.com", "custom_domain": true }]
```

`wrangler.jsonc` 里已经写了 `"workers_dev": false` 和 `"preview_urls": false`（Wrangler 4.151 的配置字段就是这两个名字）。下次 `npm run deploy` 会关掉 `*.workers.dev` 和 Preview URL。只在仪表盘里关、配置里不写的话，下次 deploy 会把 `workers.dev` 重新打开。`preview_urls` 不写时，Wrangler 不会改已有的预览开关，所以这里显式写成 `false`。

自定义域名如果是在仪表盘绑的，**不要**把 `routes` 写进 `wrangler.jsonc`。配置里没有 `routes` 时，deploy 不会解绑仪表盘上的域名。一旦写了 `routes`（或 `route`），Wrangler 会用这份列表覆盖该 Worker 的路由和自定义域名。上面的 `routes` 示例只适合从一开始就用配置管理域名的情况。

Access 应用的 hostname 必须覆盖你真正给人的那个域名。`workers.dev` 关掉之后，没走 Access 的预览地址也不会再公开。

## 7. 朋友第一次打开

1. 打开自定义域名，输入自己的邮箱，收一次性验证码。
2. 邮箱不在允许列表里的人过不了 Access。
3. 如果这台浏览器里还有旧版小闲存在 IndexedDB 的档案，档案页和设置页会出现「导入到云端」。点一次即可。以前保存在本地的 API Key 不会上传。
4. 设置页只切换 `deepseek-chat` / `deepseek-reasoner`。选 reasoner 时，聊聊里的思考过程仍然可以折叠。

## 接口一览

都要先通过上面的身份校验。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/me` | 当前邮箱 |
| GET/PUT/DELETE | `/api/profiles/:id` | 档案。GET `/api/profiles` 列出自己的 |
| GET/PUT/DELETE | `/api/charts/:id` | 排盘缓存 |
| GET/PUT/DELETE | `/api/sessions/:id` | 会话。列表用 `GET /api/sessions?profile_id=` |
| GET/PUT/DELETE | `/api/sessions/:id/messages/:messageId` | 消息。列表不带 messageId |
| GET/PUT | `/api/settings` | `model` 与 `lastProfileId` |
| POST | `/api/import` | 一次性导入本地 Dexie 数据 |
| POST | `/api/chat` | 转发到 DeepSeek，SSE 原样返回，含 `reasoning_content` |

参考：

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Access 一次性验证码](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [校验 Access JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
