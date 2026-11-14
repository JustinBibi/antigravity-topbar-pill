# Antigravity Topbar Token Pill (`antigravity-topbar-pill`)

<p align="center">
  <b>极简、无侵入、原生质感的 Google Antigravity 顶栏上下文 Token 实时监视器</b><br>
  <i>A minimalist, 100% non-intrusive real-time context token usage pill for Google Antigravity desktop top bar via CDP.</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg" alt="Node version" />
  <img src="https://img.shields.io/badge/Dependencies-0-brightgreen.svg" alt="Zero dependencies" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg" alt="Platform" />
</p>

---

## 🌟 为什么选择 CDP 注入而不是修改 ASAR？ / Why CDP over ASAR Patching?

以往的 Electron 插件或 UI 增强方案通常采用解包 `app.asar`、注入脚本并重新打包的方式。这种方式存在致命缺陷：

| 维度 | ASAR 暴力解包修改方案 | 本方案 (`antigravity-topbar-pill` CDP 注入) |
| :--- | :--- | :--- |
| **应用完整性** | ❌ 破坏 Electron 代码签名与完整性校验，可能触发系统安全报警 | ✅ **100% 零修改**。完全不碰 `app.asar`，纯外部协议连接 |
| **应用自动更新** | ❌ 每次 Antigravity 自动更新后修改被彻底覆盖，必须重新打补丁 | ✅ **抗更新能力强**。外部守护进程自动发现端口，更新毫无影响 |
| **内存与性能** | ❌ 引入 Webpack/Vite 大体积打包或多余运行时 | ✅ **极低资源消耗**。内存 `< 15MB`，无动作时 CPU 占用几乎为 `0%` |
| **第三方依赖** | ❌ 需安装大量 npm 依赖包 (几十 MB 到数百 MB) | ✅ **零外部依赖 (0 Dependencies)**，纯 Node.js 内置模块 |
| **安装与卸载** | ❌ 必须杀掉应用、替换文件，卸载时需要备份恢复 | ✅ **即开即用、随时卸载**。一键启动，停止时自动抹平 DOM 节点 |

---

## ✨ 核心特性 / Features

1. **原生无边框极简药丸 (Native Minimalist Pill)**
   - 完美融入 Antigravity 顶栏标题工具栏，半透明背景，无生硬边框。
   - 随上下文消耗动态变色指示点：
     - 🟢 `< 60%`：安全（绿色 `#10b981`）
     - 🟡 `60% ~ 85%`：注意（琥珀色 `#f59e0b`）
     - 🔴 `>= 85%`：告警（红色 `#ef4444`）

2. **悬停丰富信息卡片 (Interactive Tooltip Breakdown)**
   - 鼠标悬停即刻弹出高质感毛玻璃半透明浮层，完整呈现：
     - 当前活动模型（如 `Gemini 3.8 Flash High`、`Claude 3.7 Sonnet` 等）
     - 输入 Tokens (Input Tokens)
     - 缓存命中 Tokens (Cache Read Tokens)
     - 输出 Tokens (Output Tokens)
     - 实际上下文占用量与总窗口上限（如 `157K / 1M (16%)`）

3. **多模型上下文窗口智能感知 (Multi-Model Context Limits)**
   - 自动识别当前会话使用的模型并动态匹配其 Context Window 限制：
     - Gemini 1.5 / 2.0 / 2.5 / 3.0 Pro: **2,000,000 Tokens (2M)**
     - Gemini Flash 系列: **1,000,000 Tokens (1M)**
     - Claude 3.5 / 3.7 Sonnet / Thinking / Opus: **200,000 Tokens (200K)**
     - OpenAI o1 / o3 / o3-mini: **200,000 Tokens (200K)**
     - DeepSeek V3 / R1: **128,000 Tokens (128K)**
     - GPT-4o / GPT-4: **128,000 Tokens (128K)**
     - Qwen / Llama: **128,000 Tokens (128K)**

4. **自愈与全生命周期恢复 (Resilience & Auto-Recovery)**
   - **重启恢复**：Antigravity 重启或端口变更时自动重新探测并连接。
   - **刷新恢复**：页面按 `Cmd+R` 或热重载时，通过 CDP `Page.addScriptToEvaluateOnNewDocument` 自动重新挂载。
   - **路由感知**：会话路由切换 (SPA Route Change) 秒级响应，无需轮询。
   - **大文件韧性**：针对单步含超长工具返回内容（>150KB）的 transcript 日志进行高效倒序扫描，避免整文件重读。

5. **macOS LaunchAgent 开机自启 (macOS LaunchAgent Support)**
   - 内置生成标准 LaunchAgent plist，支持用户登录时自动常驻后台。

---

## 🏗️ 架构原理解析 / Architecture

```text
┌────────────────────────────────────────────────────────┐
│             Google Antigravity Desktop                 │
│                                                        │
│   [ Topbar: (🟢 16% · 157K)  Controls  [+][-][x] ]     │
│       ▲                                                │
│       │ DOM Badge & Hover Tooltip                      │
│       ▼                                                │
│   Electron Chromium Renderer                           │
│       ▲                                                │
└───────┼────────────────────────────────────────────────┘
        │
        │ Chrome DevTools Protocol (CDP) WebSocket
        │ (Discovered via ~/Library/Application Support/Antigravity/DevToolsActivePort)
        ▼
┌────────────────────────────────────────────────────────┐
│             antigravity-topbar-pill                    │
│                                                        │
│  - src/cdp.js      : Lightweight native WebSocket CDP  │
│  - src/daemon.js   : Lifecycle & auto-reconnection     │
│  - src/inject.js   : High-performance DOM pill badge   │
│  - src/tracker.js  : Backward transcript scanner       │
└───────▲────────────────────────────────────────────────┘
        │
        │ fs.watch (Debounced event streaming)
        ▼
┌────────────────────────────────────────────────────────┐
│ ~/.gemini/antigravity/brain/<id>/.../transcript.jsonl  │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 快速上手 / Quick Start

### 环境要求 (Prerequisites)
- **Node.js**: `>= 18.0.0` (推荐 Node 20 / 22 / 25)
- **操作系统**: macOS（支持 LaunchAgent）、Linux、Windows

### 1. 克隆或下载仓库
```bash
git clone https://github.com/JustinBibi/antigravity-topbar-pill.git
cd antigravity-topbar-pill
```

### 2. 后台启动 (Start Background Daemon)
```bash
node index.js start
```

### 3. 查看状态 (Check Status)
```bash
node index.js status
```
*输出示例：*
```text
[ag-topbar] Status: Running (PID: 64123)
[ag-topbar] DevTools Port: 55312
[ag-topbar] Connected: YES
[ag-topbar] Uptime: 12s
[ag-topbar] Active Window Sessions:
  - Conversation: 664aea0e-c0e4-4e67-bd25-02e8415a3422
    Model: Gemini 3.8 Flash High
    Context: 157K / 1M (16%)
```

### 4. 停止并清理 (Stop & Detach)
```bash
node index.js stop
```
*该命令会优雅断开连接，并即刻从所有打开的 Antigravity 窗口中清理药丸 DOM 与监听器，不留任何痕迹。*

---

## 🖥️ 设为开机常驻服务 (macOS LaunchAgent)

如果您希望每次开机登录后自动后台启动，无需手动输入命令：

### 安装并启动 LaunchAgent
```bash
node index.js install-daemon
```
程序会在 `~/Library/LaunchAgents/com.justinbibi.antigravity-topbar.plist` 生成规范的服务配置并激活。

### 卸载 LaunchAgent
```bash
node index.js uninstall-daemon
```

---

## 🛠️ CLI 命令速查 / Commands

| 命令 | 说明 |
| :--- | :--- |
| `node index.js start` | 在后台启动守护进程 |
| `node index.js stop` | 停止后台守护进程并清理 UI 药丸 |
| `node index.js status` | 检查守护进程状态、连接端口及各窗口会话 |
| `node index.js run` | 在前台直接运行（输出详细调试日志，按 `Ctrl+C` 退出） |
| `node index.js install-daemon` | 安装并激活 macOS LaunchAgent 开机自启服务 |
| `node index.js uninstall-daemon` | 卸载 macOS LaunchAgent 服务并清理药丸 |
| `npm test` | 执行全套自动化单元测试与 CDP 注入联调测试 |

---

## 🧪 自动化测试 / Testing

项目内置了严格的测试集，覆盖 Token 算法边界、超大日志抗压扫描、LaunchAgent Plist 生成与真实 CDP DOM 注入：

```bash
npm test
```

---

## 🤖 AI 智能体指南 / Guide for AI Agents

如果您是一个正在协助用户的 AI Agent（如 Cursor Agent、Antigravity Assistant、Claude Code 等），请直接参考 [AGENTS.md](file:///Users/bibizhang/Projects/antigravity-topbar-pill/AGENTS.md) 了解安全安装与无害验证断言步骤。

---

## 📄 开源许可证 / License

本项目基于 [MIT License](file:///Users/bibizhang/Projects/antigravity-topbar-pill/LICENSE) 开源发布。
Copyright (c) 2026 JustinBibi.
