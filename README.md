<p align="center">
  <img src="./skillar-design-pack/logo/skillar-icon-centered-light.png" alt="Skillar Logo" width="220">
</p>

<h1 align="center">Skillar (MySkills Manager)</h1>

<p align="center">
  面向 AI Skills 的本地桌面管理器：统一收敛、跨工具同步、使用追踪与冲突治理。
</p>

<p align="center">
  <a href="#设计哲学">设计哲学</a> •
  <a href="#核心能力">核心能力</a> •
  <a href="#内置工具支持">内置工具支持</a> •
  <a href="#下载方式">下载方式</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#开发与测试">开发与测试</a> •
  <a href="#项目结构">项目结构</a> •
  <a href="#配置与数据目录">配置与数据目录</a>
</p>

---

## 设计哲学

Skillar 的产品设计遵循三条原则：

- 统一（Unify）：把分散在不同 AI 工具里的 skills 收敛到一个可版本化的中心目录。
- 洞察（Insight）：通过可观测日志和统计看板，持续验证哪些 skill 真正有效。
- 掌控（Mastery）：由你决定同步范围、跟踪策略、冲突基准，而不是被工具默认行为绑定。

这三条原则对应到下方的核心能力：统一管理与同步、数据看板与日志、冲突治理与可控配置。
## 核心能力

以下内容聚焦 `myskills-manager` 子项目当前已经落地的主应用能力。

### 1. Skills 管理与编辑

- 扫描 `~/my-skills`（或 `MYSKILLS_ROOT_DIR`）下的技能目录，读取 `SKILL.md`。
- 支持按名称、描述、标签、备注搜索，并按分类筛选。
- 内置 Monaco 编辑器，支持 frontmatter 字段编辑（`category` / `tags` / `my_notes`）。
- 保存时自动更新 `last_updated`，并对 copy 模式工具触发增量同步。

### 2. 多工具同步（symlink 优先，copy 回退）

- 内置支持：Antigravity、Codex、Claude Code、Cursor、Windsurf、Trae、OpenCode。
- 自动探测工具路径，支持路径覆盖（override）与自定义工具。
- 支持每个工具独立的 `Auto Sync` 与 `Usage Tracking` 开关。
- 同步过程对规则文件与 hook 变更提供备份与失败回滚。

### 3. 冲突检测与解决

- 扫描本机各工具中的 skills，识别：
  - 已同步（hash 一致）
  - 未收录
  - 同名冲突（hash 不一致）
- 冲突详情支持“仅看变更 / 完整内容”双视图。
- 可将任意来源一键“设为基准”并回写到 `my-skills`。

### 4. 使用日志与数据看板

- 读取 `skill-usage.jsonl` 并提供分页筛选查询。
- 仪表盘提供总调用、活跃技能、工具分布、日趋势、未使用技能。
- 支持最近 7 / 30 / 90 天窗口。
- 使用 SQLite 索引（`skill-usage-index.sqlite3`）加速日志与统计查询。
- 指标标注为 lower-bound estimate（下限估计）。

### 5. Onboarding 与内置 Router 补种

- 首次启动引导设置 skills 目录与自动同步策略。
- 支持导入已安装工具中的 skills 到 `my-skills`。
- 自动确保内置 `myskills-router` 存在，并处理旧 `myskills-command` 迁移。

### 6. Git 面板

- 查看分支、已改动/已暂存/未跟踪文件。
- 应用内执行 `commit` 与 `push`（`origin`）。

## 内置工具支持

> 路径中的 `~` 表示用户主目录（Windows 通常为 `%USERPROFILE%`）。

| Tool | ID | 默认 Skills 目录 | 默认 Rules 文件 |
| :--- | :--- | :--- | :--- |
| Antigravity | `antigravity` | `~/.gemini/antigravity/skills` | `~/.gemini/GEMINI.md` |
| Codex | `codex` | `~/.codex/skills` | `~/.codex/AGENTS.md` |
| Claude Code | `claude-code` | `~/.claude/skills` | `~/.claude/CLAUDE.md` |
| Cursor | `cursor` | `~/.cursor/skills` | `~/.cursor/rules/myskills-tracker.mdc` |
| Windsurf | `windsurf` | `~/.codeium/windsurf/skills` | `~/.codeium/windsurf/memories/global_rules.md` |
| Trae | `trae` | `~/.trae/skills` | `~/.trae/AGENTS.md` |
| OpenCode | `opencode` | `~/.config/opencode/skills` | `~/.config/opencode/AGENTS.md` |

说明：部分工具有候选回退路径（例如 `~/.windsurf/skills`、`~/.opencode/skills`），运行时会自动探测。

## 下载方式

### 1) 直接下载（推荐）

- GitHub Releases: `https://github.com/KeithChen51/MySkills-Manager/releases/latest`
- 主要面向 Windows，下载后可直接使用 `Skillar.exe`（以发布页实际文件名为准）。

### 2) 从源码运行（开发/试用）

```bash
git clone https://github.com/KeithChen51/MySkills-Manager.git
cd MySkills-Manager/myskills-manager
npm install

# 首次在本机运行时需要先安装 Tauri CLI（v2）
cargo install tauri-cli --version "^2"

cargo tauri dev
```

### 3) 本地构建可执行文件（Windows）

```bash
npm run build:desktop:windows
```

构建后可在 `release/Skillar.exe` 获取分发文件。

## 快速开始

### 前置条件

- Node.js 20.19+（或 22.12+）
- Rust stable（当前 `src-tauri/Cargo.toml` 声明 `rust-version = 1.77.2`）
- Tauri CLI v2（例如：`cargo install tauri-cli --version "^2"`）
- Tauri 构建依赖

### 安装依赖

```bash
git clone https://github.com/KeithChen51/MySkills-Manager.git
cd MySkills-Manager/myskills-manager
npm install
```

### 安装 Tauri CLI（首次一次性）

```bash
cargo install tauri-cli --version "^2"
```

说明：当前仓库没有把 Tauri CLI 作为项目内依赖一起安装，执行 `cargo tauri dev` / `cargo tauri build` 前需要先在本机准备好 CLI。

### 启动方式

- 桌面开发模式（推荐）

```bash
cargo tauri dev
```

- 前端调试模式（仅 Vite）

```bash
npm run dev
```

### 构建

```bash
npm run build:desktop
```

Windows 发布打包（生成 `release/Skillar.exe` 并准备发布物料）：

```bash
npm run build:desktop:windows
```

## 开发与测试

### 常用脚本

| 命令 | 说明 |
| :--- | :--- |
| `npm run dev` | 启动 Vite 前端开发服务 |
| `npm run build` | 构建前端（TypeScript + Vite） |
| `npm run build:desktop` | 构建 Tauri 桌面应用 |
| `npm run build:desktop:windows` | Windows 一键发布打包（含 gitee 物料） |
| `npm run expose:exe` | 将 `app.exe` 暴露为 `release/Skillar.exe` |
| `npm run pack:gitee` | 生成 gitee 发布包（源码 zip + exe） |
| `npm run lint` | ESLint 检查 |

### 测试命令

```bash
# 前端/脚本测试（Node test runner）
npx tsx --test test/*.test.ts

# Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml
```

### 当前测试状态

- 2026-03-06 实测：`cargo test --manifest-path src-tauri/Cargo.toml` 全部通过。
- 2026-03-06 实测：`npx tsx --test test/*.test.ts` 目前有 2 个失败断言，位于 `test/skillsConflictResolution.test.ts` 与 `test/toolsSwitchStyle.test.ts`。

## 项目结构

```text
myskills-manager/
├── src/                     # React + TypeScript 前端
│   ├── api/                 # Tauri invoke API 封装
│   ├── components/          # 组件（SkillEditor、Sidebar 等）
│   ├── domain/              # 前端领域逻辑（diff、tags、文档转换）
│   ├── i18n/                # 中英文文案
│   ├── pages/               # Skills/Tools/Dashboard/Logs/Git/Settings
│   └── styles/              # 设计令牌与基础样式
├── src-tauri/               # Rust 后端与 Tauri 配置
│   └── src/
│       ├── setup/           # 同步引擎、规则注入、hook、冲突处理
│       ├── onboarding.rs    # 首次引导与导入
│       ├── skills.rs        # 技能读写与元数据解析
│       ├── logs.rs          # 日志查询
│       ├── log_index.rs     # SQLite 日志索引
│       ├── stats.rs         # 统计聚合
│       └── git.rs           # Git 操作
├── test/                    # TS 测试
├── scripts/                 # 发布与打包脚本
├── builtin-skills/          # 内置技能模板（含 myskills-router）
└── README.md
```

## 配置与数据目录

- Skills 根目录（默认）：`~/my-skills`
- 环境变量覆盖：`MYSKILLS_ROOT_DIR`
- 应用配置目录：`~/.myskills-manager`
- Onboarding 配置：`~/.myskills-manager/config.json`
- 同步配置：`~/.myskills-manager/sync-config.json`
- 自定义工具配置：`~/.myskills-manager/custom-tools.json`
- 工具路径覆盖：`~/.myskills-manager/tool-path-overrides.json`
- 使用日志：`~/my-skills/.logs/skill-usage.jsonl`
- 日志索引：`~/my-skills/.logs/skill-usage-index.sqlite3`

## 发布说明

- 桌面构建产物位于 `src-tauri/target/release/bundle/`。
- Windows 分发可执行文件默认为 `release/Skillar.exe`。
- 若使用 `pack:gitee`，会输出 exe 与源码压缩包。

---

<p align="center">Built by Keith Lim</p>
