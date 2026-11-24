<div align="center">

<img src="src-tauri/icons/128x128.png" width="112" alt="PuppyRouter App">

# PuppyRouter App

**PuppyRouter 官方桌面客户端**

在一个原生桌面应用中登录 PuppyRouter、查看余额和 API Key，并为 16 个受支持的应用配置模型供应商。


[下载客户端](https://puppyrouter.com/client) · [使用文档](https://blog.puppyrouter.com/docs/puppyrouter-app) · [PuppyRouter 官网](https://puppyrouter.com)

</div>

[English](README_EN.md) · 简体中文 · [繁體中文](README_ZH-TW.md) · [日本語](README_JA.md) · [한국어](README_KO.md) · [Türkçe](README_TR.md) · [Русский](README_RU.md) · [Deutsch](README_DE.md)

## 这是什么

PuppyRouter App 是基于 Tauri 2 构建的跨平台 AI 客户端配置工具。它将不同应用分散在 JSON、TOML 和环境变量中的 API 配置集中到一个可视化界面，并针对 PuppyRouter 提供完整的账户与 Key 集成。

无需手动编辑配置文件。选择应用和 API Key 后，Key 会先保存到该应用的本地 PuppyRouter provider；再点击启用，才会将配置写入目标应用。

## 主要功能

- **PuppyRouter 浏览器登录**：通过 PuppyRouter 网站的 Google 登录完成授权，桌面端不接触 Google 密码。
- **API Key 自动同步**：读取当前账户可用 Key、所属分组、剩余额度和使用额度。
- **按应用独立配置**：每个应用可以单独选择密钥。已启用的 PuppyRouter 配置会在更换密钥时刷新。
- **分阶段应用**：首次选择密钥时先保存在本地供应商卡片，点击启用后再写入目标应用。Antigravity CLI 在启动时读取所选配置。
- **云端分组修改**：在客户端内调整指定 Key 的分组，并对同分组操作进行拦截。
- **配置诊断**：检查云端 Key、本地 PuppyRouter provider 和目标应用 live config 三层信息是否一致。
- **官方登录切换**：保留不可删除的 PuppyRouter 与 Official provider，并支持切回官方登录方式。
- **自定义渠道**：在两个内置 provider 之外添加自己的兼容 API 渠道。
- **余额显示**：支持人民币、美元以及跟随界面语言自动选择显示货币。
- **统一管理**：包含 MCP、Skills、Prompts、会话、备份、代理、故障切换和请求诊断工具。
- **界面与导航**：浅蓝主题配绿色启用状态。通过侧边栏选择应用，在支持的应用中使用直连、路由和聚合模式。

## 支持的应用

| 配置方式 | 应用 |
| --- | --- |
| 切换当前供应商 | Claude Code、Claude Desktop、Codex、Gemini CLI、Grok Build |
| 启动时应用 | Antigravity CLI |
| 写入应用原生供应商列表 | OpenCode、OpenClaw、Hermes Agent、Pi、MiniMax Code、Kimi Code、DeepSeek Harness、Oh My Pi、GitHub Copilot CLI、WorkBuddy |

MCP、Skills、插件、提示词、会话和路由的可用范围随应用而异。Grok Build 支持绑定 xAI 账号、切回官方登录及管理自己的模型配置。

## 下载

请始终从 PuppyRouter 官方下载页获取当前稳定版本：

**https://puppyrouter.com/client**

当前提供：

- Windows x64 MSI
- Windows ARM64 MSI
- macOS Apple Silicon DMG
- Ubuntu x86_64 DEB

Windows 用户不确定架构时应选择 x64。Windows ARM64 安装包仅适用于确认使用 ARM 处理器的设备。

## 使用方式

1. 安装并打开 PuppyRouter App。
2. 在供应商页的 PuppyRouter 账户入口完成浏览器授权。
3. 从侧边栏选择目标应用。
4. 点击需要使用的 API Key。
5. 确认 Key 已应用到当前应用的本地 PuppyRouter provider。
6. 点击 PuppyRouter provider 的启用按钮，将配置写入目标应用。
7. 完全退出目标应用后重新打开，使新配置完整生效。

更完整的图文教程请阅读：

**https://blog.puppyrouter.com/docs/puppyrouter-app**

## 配置与隐私

PuppyRouter App 的设备级设置保存在：

```text
~/.puppyrouter-app/settings.json
```

本地 provider、同步状态和其他应用数据保存在：

```text
~/.puppyrouter-app/puppyrouter-app.db
```

桌面登录会话保留在设备上。WebDAV 和 S3 同步会跳过 PuppyRouter 账户会话和所选密钥的账户记录。应用通过 `https://puppyrouter.com` 获取当前已登录用户有权访问的账户、余额、Key 和分组信息。PuppyRouter 登录会话保存在本机，不会被写入仓库或公开构建产物。

## 本地开发

环境要求：

- Node.js 20+
- pnpm
- Rust stable
- Tauri 2 对应平台依赖

```bash
pnpm install
pnpm typecheck
pnpm test:unit
pnpm tauri dev
```

构建当前平台安装包：

```bash
pnpm build
```

macOS 发布包还需要 Developer ID Application 签名和 Apple notarization。Windows、Linux 和 updater artifact 由仓库中的 GitHub Actions workflow 构建。

## 项目关系

PuppyRouter App 基于开源项目 CC Switch 进行二次开发，保留并持续维护其 provider 管理、MCP、Skills、Prompts、代理与跨平台基础能力。

PuppyRouter 相关账户同步、固定 provider、配置诊断、分组管理、品牌界面和发布流程由 PuppyRouter 项目维护。

## License

本项目遵循 [MIT License](LICENSE)。第三方组件与品牌名称归各自权利人所有。
