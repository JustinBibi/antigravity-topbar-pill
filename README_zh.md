# Context Meter — Antigravity 官方架构上下文监控插件 (`context-meter`)

<p align="center">
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

<p align="center">
  <b>基于 Antigravity 官方 Sidecar UI Plugin 体系的实时上下文 Token 监控面板，支持缓存命中率与每轮增长趋势图。</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg" alt="Node version" />
  <img src="https://img.shields.io/badge/Dependencies-0-brightgreen.svg" alt="Zero dependencies" />
  <img src="https://img.shields.io/badge/Plugin-Antigravity%20Sidecar%20UI-blue.svg" alt="Antigravity Sidecar UI Plugin" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" />
</p>

---

## 为什么转向官方 Sidecar UI 插件？

从 **Antigravity v2.35+** 开始，Electron 默认关闭了远程调试端口（`--remote-debugging-port`）。本项目 v2.0 全面迁移至 Antigravity 原生 **Plugin + Sidecar Web UI** 体系：

- **零启动门槛、彻底告别 CDP**：直接点击原版 Dock 图标正常打开 Antigravity 即可，无需传参、无需额外启动器 `.app`、无需 LaunchAgent。
- **原生绑定当前对话**：Antigravity 打开侧边栏（`AUX_PANE`）时自动将当前 `conversationId` 传给面板，多窗口及切换历史旧对话天然精准同步。
- **零外部依赖**：仅使用 Node.js 内置模块与 Antigravity 自动注入的 `sidecar_sdk`。
- **原生亮/暗主题同步**：通过 `/preload.js` 自动继承宿主 CSS 主题变量，搭配透明底矢量图标，与原生界面融为一体。
- **强制 Token 鉴权与增量读取**：数据接口采用 `POST /api/usage` 接入框架层 `x-sidecar-token` 校验；日志解析采用 64KB 增量分块读取与 ETag 短路，长对话同样流畅不卡顿。

---

## 核心特性

1. **实时上下文占用仪表盘**
   - 直观展示当前上下文占比、已用 / 上限（如 `110K / 1M`）以及剩余可用预算。
   - 动态健康状态指示：
     - `< 60%`：Healthy（绿色 `#10b981`）
     - `60% – 85%`：Elevated（琥珀色 `#f59e0b`）
     - `>= 85%`：Critical（红色 `#ef4444`）

2. **Token 明细与 Prompt Cache 命中率**
   - **Input (Uncached)**：最新一轮非缓存输入 Token。
   - **Cached Read**：缓存命中 Token 与实时 **Cache Hit Rate (%)**。
   - **Output**：最新一轮输出 Token 及全会话真实累计输出（超过 40 轮依然精确汇总）。
   - 完整兼容 **Claude `cache_creation_input_tokens`** 上下文计入。

3. **1:1 自适应每轮增长趋势图（Turn-by-Turn Growth）**
   - 随侧边栏宽度 `ResizeObserver` 1:1 等比渲染的 SVG 面积折线图，底部原生 HTML 坐标轴展示真实轮次范围（如 `T22` → `T61`）。
   - 鼠标悬停任意节点即可查看该轮上下文总量、真实单轮增量（`+Δ`）与输出 Token。

---

## 快速安装

### 1. 克隆并安装插件软链
```bash
git clone https://github.com/JustinBibi/antigravity-topbar-pill.git
cd antigravity-topbar-pill
npm run install-plugin
```
命令会在 `~/.gemini/config/plugins/context-meter` 创建指向本仓库的软链接（Windows 下自动使用 `junction`，且拒绝覆盖已存在的非软链目录，防止误删数据）。

### 2. 在 Antigravity 中启用
1. 打开 Antigravity 左侧栏的 **Customizations → Plugins**。
2. 找到 **Context Meter**（`context-meter`）并开启。
3. 在任意对话窗口的右侧边栏点击 **`+`** 按钮选择 **Context Meter** 即可常驻查看。

> **更新提示**：拉取后端代码更新（`main.mjs` / `tracker.mjs`）后，在 **Customizations → Plugins** 中将 **Context Meter** 关闭再重新开启一次即可热重载 Sidecar 进程。

### 卸载
```bash
npm run uninstall-plugin
```

---

## 目录结构

```text
antigravity-topbar-pill/
├── plugin.json                        # Antigravity 插件清单
├── assets/logo.svg                    # 透明背景插件图标
├── sidecars/context_panel/
│   ├── sidecar.json                   # 声明 has_web_ui 与 AUX_PANE 入口
│   ├── main.mjs                       # sidecar_sdk 服务（GET / 与强制鉴权 POST /api/usage）
│   ├── tracker.mjs                    # 64KB 增量 transcript.jsonl 解析 + ETag 缓存
│   └── index.html                     # 原生主题侧边栏 UI + 1:1 自适应 SVG 趋势图
├── scripts/install.mjs                # 安全软链安装/卸载脚本
└── test/run-tests.mjs                 # 自动化单元测试、安全校验与清单校验
```

---

## 自动化测试

```bash
npm test
```

---

## AI 智能体指南

如果你是正在协助用户的 AI Agent，请参考 [AGENTS.md](AGENTS.md) 了解安全安装、Sidecar 开发避坑规范、自动化测试断言与侧边栏唤醒方式。

---

## 开源许可证

本项目基于 [MIT License](LICENSE) 开源发布。
Copyright (c) 2026 JustinBibi.
