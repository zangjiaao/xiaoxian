# 小闲

给自己和朋友用的个人八字对照本。看四柱、大运、流年，也可以把命盘当成聊天背景，聊聊今天的具体经历。

它是娱乐和自我反思工具，不是算命，也不做宿命判断。健康、法律和重大财务决定，请咨询专业人士。

## 本地运行

需要 Node.js 22+。

```bash
npm install
npm run dev
```

开发服务器默认在 [http://127.0.0.1:43123](http://127.0.0.1:43123)。

```bash
npm run build
npm run preview
```

`npm run smoke` 会用一份固定生日核对四柱、大运顺逆和立春前的流年，并核对 Access JWT 的本地校验，不需要网络。

部署到 Cloudflare 的步骤在 [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)。本地要连 D1 和聊天代理时，先 `npm run build`，再 `npm run cf:dev`（默认 `http://127.0.0.1:8787`）。`.dev.vars` 里的 `DEV_USER_EMAIL` 只在本机跳过登录。

## 添加到主屏幕

生产构建带有 Web App Manifest 和自动更新的 Service Worker（`vite-plugin-pwa`，`registerType: 'autoUpdate'`）。

1. 用手机浏览器打开部署后的地址，或本机 `npm run preview` 的地址。
2. iOS Safari：分享 → 添加到主屏幕。
3. Android Chrome：菜单 → 安装应用，或「添加到主屏幕」。

安装后以独立窗口打开。壳和排盘可以离线使用。聊天需要联网。

开发模式默认不启用 Service Worker，避免热更新被旧缓存卡住。

## 模型和登录

DeepSeek 密钥放在 Worker 的 `DEEPSEEK_API_KEY` secret 里。浏览器不再保存密钥，设置页也没有密钥输入。

- 默认模型：`deepseek-chat`。设置里可以换成 `deepseek-reasoner`，回复前会多一段可折叠的「思考过程」
- 可选模型只有这两个。接口地址由 Worker 的 `DEEPSEEK_BASE_URL` 决定，默认 `https://api.deepseek.com`
- 聊天请求发到同源的 `/api/chat`，Worker 再以流式（SSE）转给 DeepSeek
- 线上用 Cloudflare Access 的邮箱一次性验证码。邮箱就是用户 id，档案按邮箱分开

## 排盘说明

计算使用 `lunar-typescript`，完全在浏览器里完成。

- 输入是公历的钟表时间，界面按北京时间理解
- 还没有真太阳时，出生地只作备注
- 时、分可以留空。留空则时柱标为「未知」，只排六字；大运起运岁数按当天中午估算
- 年柱、流年按立春时刻切换，不一定在元旦
- 23 点按排盘库默认算法处理晚子时（日柱留在当天）

## 技术栈

- React 19、Vite、TypeScript
- UI：`@astryxdesign/core` + `@astryxdesign/theme-neutral`
- 组件以源码方式交给 `@astryxdesign/build/vite` 编译 StyleX，并拆成 `reset < astryx-base < astryx-theme < product` 层。应用自己的布局也用 StyleX
- 中文界面文案由应用提供。Astryx 组件字符串通过 `InternationalizationProvider` 使用 `zh-Hans`（语言包文件名仍是上游的 `zh-CN.generated.js`）
- 云端：Cloudflare Worker（静态资源 + `/api/*`）、D1、Access JWT。表为 `profiles`、`charts`、`chat_sessions`、`chat_messages`、`settings`，按登录邮箱隔离
- 浏览器里的 Dexie / IndexedDB 只做离线缓存，以及把旧版本地档案一次性导入云端

本版没有改用 Ant Design。若以后 Astryx 的 Vite 插件无法安装，可以换成薄的 Ant Design 层，页面和数据流不必改。

## 分析框架

聊天会把浏览器里算出的机器排盘全文放进提示词，并按对方这句话决定写完整批盘还是短回复。问批盘、排盘、运势、分析八字、看命盘、大运流年时，按日主、十神、五行、格局、大运、流年、建议来写；聊日常就只连到当前大运、流年和相关十神。干支以机器报告为准，模型不能改。本引擎不计算神煞。

这套顺序和经典摘要来自 [bazi-skill](https://github.com/jinchenma94/bazi-skill)（MIT，Copyright (c) 2025 jinchenma94）。参考文本在 `vendor/bazi-skill/`：`SKILL.md`、`classical-texts.md`、`wuxing-tables.md`、`dayun-rules.md`、`shensha-table.md`，许可证原文是同目录的 `LICENSE`。浏览器里不运行该仓库的 Python 排盘脚本。

## 这版没有做

真太阳时、六爻、神煞、推送通知。多人各自登录后数据按邮箱分开，没有实时协同编辑。
