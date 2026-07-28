<div align="center">

<img src="src-tauri/icons/128x128.png" width="112" alt="PuppyRouter App">

# PuppyRouter App

**PuppyRouter 官方桌面客户端**

在一个原生桌面应用中登录 PuppyRouter、查看余额和 API Key，并快速配置 Codex、Claude Code、Claude Desktop、Gemini CLI 与 OpenCode。

[![Release](https://img.shields.io/github/v/release/weng31415/puppy-cc-switch?label=version&color=f5b942)](https://github.com/weng31415/puppy-cc-switch/releases)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-171717)](https://puppyrouter.com/client)
[![Tauri](https://img.shields.io/badge/Tauri-2-f5b942)](https://tauri.app/)
[![License](https://img.shields.io/badge/license-MIT-171717)](LICENSE)

[下载客户端](https://puppyrouter.com/client) · [使用文档](https://blog.puppyrouter.com/docs/puppyrouter-app) · [PuppyRouter 官网](https://puppyrouter.com)

</div>

## 这是什么

PuppyRouter App 是基于 Tauri 2 构建的跨平台 AI 客户端配置工具。它将不同应用分散在 JSON、TOML 和环境变量中的 API 配置集中到一个可视化界面，并针对 PuppyRouter 提供完整的账户与 Key 集成。

无需手动编辑配置文件。选择应用、选择 API Key，然后点击应用即可完成本地 PuppyRouter provider 与目标应用 live config 的同步。

## 主要功能

- **PuppyRouter 浏览器登录**：通过 PuppyRouter 网站的 Google 登录完成授权，桌面端不接触 Google 密码。
- **API Key 自动同步**：读取当前账户可用 Key、所属分组、剩余额度和使用额度。
- **按应用独立配置**：Codex、Claude Code、Claude Desktop、Gemini CLI 和 OpenCode 可以分别选择不同 Key。
- **应用并启用**：更新 PuppyRouter App 本地 provider 后，立即走统一启用流程写入目标应用配置。
- **云端分组修改**：在客户端内调整指定 Key 的分组，并对同分组操作进行拦截。
- **配置诊断**：检查云端 Key、本地 PuppyRouter provider 和目标应用 live config 三层信息是否一致。
- **官方登录切换**：保留不可删除的 PuppyRouter 与 Official provider，并支持切回官方登录方式。
- **自定义渠道**：在两个内置 provider 之外添加自己的兼容 API 渠道。
- **余额显示**：支持人民币、美元以及跟随界面语言自动选择显示货币。
- **统一管理**：包含 MCP、Skills、Prompts、会话、备份、代理、故障切换和请求诊断工具。
- **黑金界面**：固定的 PuppyRouter 黑金视觉体系，支持简体中文、繁体中文、英语和日语。

## 支持的应用

| 应用                  | 自动配置 | 说明                                          |
| --------------------- | :------: | --------------------------------------------- |
| Codex / ChatGPT Codex |    是    | 支持 PuppyRouter provider、模型目录和配置诊断 |
| Claude Code           |    是    | 支持 API Key、endpoint 与禁用 Key 清理        |
| Claude Desktop        |    是    | 使用 Claude Desktop 第三方 provider 配置模式  |
| Gemini CLI            |    是    | 支持兼容 provider 配置                        |
| OpenCode              |    是    | 支持 OpenCode provider 配置                   |
| OpenClaw              |   手动   | 可查看 Key，但第三方应用兼容性无法长期保证    |
| Hermes                |   手动   | 可查看 Key，但需要用户手动配置 provider       |

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
2. 在应用顶部完成 PuppyRouter 登录。
3. 选择 Codex、Claude Code、Claude Desktop、Gemini CLI 或 OpenCode。
4. 点击需要使用的 API Key。
5. PuppyRouter App 会将该 Key 应用到当前选中的应用并启用 PuppyRouter provider。
6. 完全退出目标应用后重新打开，使新配置完整生效。

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

应用只通过 `https://puppyrouter.com` 获取当前已登录用户有权访问的账户、余额、Key 和分组信息。PuppyRouter 登录会话保存在本机，不会被写入仓库或公开构建产物。

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

PuppyRouter App 基于开源项目 [cc-switch](https://github.com/farion1231/cc-switch) 进行二次开发，保留并持续维护其 provider 管理、MCP、Skills、Prompts、代理与跨平台基础能力。

PuppyRouter 相关账户同步、固定 provider、配置诊断、分组管理、品牌界面和发布流程由 PuppyRouter 项目维护。

## License

本项目遵循 [MIT License](LICENSE)。第三方组件与品牌名称归各自权利人所有。
