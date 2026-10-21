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

`npm run smoke` 会用一份固定生日核对四柱、大运顺逆和立春前的流年，不需要网络。

## 添加到主屏幕

生产构建带有 Web App Manifest 和自动更新的 Service Worker（`vite-plugin-pwa`，`registerType: 'autoUpdate'`）。

1. 用手机浏览器打开部署后的地址，或本机 `npm run preview` 的地址。
2. iOS Safari：分享 → 添加到主屏幕。
3. Android Chrome：菜单 → 安装应用，或「添加到主屏幕」。

安装后以独立窗口打开。壳和排盘可以离线使用。聊天需要联网。

开发模式默认不启用 Service Worker，避免热更新被旧缓存卡住。

## API Key 只在本地

设置页粘贴 DeepSeek API Key。它只写入这台浏览器的 IndexedDB（Dexie），不会进入代码仓库，也没有后端代发。

- 默认接口：`https://api.deepseek.com`
- 默认模型：`deepseek-chat`（更快）。设置里可以换成 `deepseek-reasoner`，回复前会多一段可折叠的「思考过程」
- 也可以改成别的 OpenAI Chat Completions 兼容地址和模型名
- 换浏览器、换设备或清除站点数据后，需要重新粘贴
- 同一台设备上能打开这个页面的人，也能读到这把密钥

聊天请求从浏览器直接发到你填写的地址，并尽量以流式输出。

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
- 本地库：Dexie / IndexedDB，表为 `profiles`、`charts`、`chat_sessions`、`chat_messages`、`settings`

本版没有改用 Ant Design。若以后 Astryx 的 Vite 插件无法安装，可以换成薄的 Ant Design 层，页面和数据流不必改。

## 分析框架

聊天会把浏览器里算出的机器排盘全文放进提示词，并按对方这句话决定写完整批盘还是短回复。问批盘、排盘、运势、分析八字、看命盘、大运流年时，按日主、十神、五行、格局、大运、流年、建议来写；聊日常就只连到当前大运、流年和相关十神。干支以机器报告为准，模型不能改。本引擎不计算神煞。

这套顺序和经典摘要来自 [bazi-skill](https://github.com/jinchenma94/bazi-skill)（MIT，Copyright (c) 2025 jinchenma94）。参考文本在 `vendor/bazi-skill/`：`SKILL.md`、`classical-texts.md`、`wuxing-tables.md`、`dayun-rules.md`、`shensha-table.md`，许可证原文是同目录的 `LICENSE`。浏览器里不运行该仓库的 Python 排盘脚本。

## 这版没有做

真太阳时、六爻、神煞、推送通知、后端、Cloudflare Worker、多用户同步。
