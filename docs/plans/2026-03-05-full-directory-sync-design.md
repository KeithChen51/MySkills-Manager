# Skills 完整目录同步设计方案

## 背景

当前同步逻辑只复制 `SKILL.md` 单个文件。含 `scripts/`、`examples/`、`resources/` 等附属内容的 skill（如 `ui-ux-pro-max`）同步后无法正常运行。

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 同步方式 | 递归文件复制 | 兼容性最好，避免 symlink/junction 在部分工具中不被识别 |
| 采集触发 | 三种模式全做，用户自选 | 灵活性最大 |
| Hash 校验 | 递归 hash 整个 skill 目录 | 目标是"完整同步"，检测也应完整 |
| 存量迁移 | 展示各来源文件清单，用户确认 | 对已有用户最安全 |

## 阶段一：核心同步升级

**目标：** 同步从"只复制 SKILL.md"变为"复制完整目录"。

### 后端改动

#### `sync_ops.rs`

新增两个函数：

- `sync_skill_dir(source_dir, target_dir)` — 清空 target_dir 后递归复制整个 source_dir
- `dir_content_hash(skill_dir)` — 收集目录下所有文件的相对路径（排序后）逐文件读取内容计算联合 hash

#### `apply_engine.rs`

同步循环从 `sync_skill_file(source SKILL.md, target SKILL.md)` 改为 `sync_skill_dir(source_dir, target_dir)`。

增量同步函数 `sync_saved_skill_to_copy_tools_with_home` 同样改为目录级。

#### `skills_overview.rs`

`skill_hashes_by_name` 从读单个 SKILL.md 改为调用 `dir_content_hash`。

#### `conflict_resolution.rs`

冲突解决从写单文件改为复制整个目录。

### 交付标准

点击"同步"后，工具目录中的 skill 与 my-skills 基准完全一致，包含所有附属文件。

---

## 阶段二：采集与迁移

**目标：** 用户能把工具中已有的完整 skill 采集回 my-skills 基准。

### 后端改动

- `config_store.rs` — 新增 `import_mode` 配置（`manual` / `prompt` / `auto`）
- 新增 `import_engine.rs` — 采集/导入逻辑
- `conflict_resolution.rs` — `SkillConflictVariant` 增加 `file_list: Vec<String>` 字段

### 前端改动

- Settings 页面新增"采集模式"下拉选择
- Skills Overview 页面：
  - skill 卡片显示文件数量（完整度指标）
  - 不存在于 my-skills 的 skill 显示"导入"按钮
  - 冲突解决对话框增加文件清单对比面板

### 交付标准

用户可选择三种采集模式；冲突解决展示各来源文件列表；能将最完整版本导入为基准。

---

## 阶段三：启动检测与自动化

**目标：** 应用启动时自动检测新 skill 并根据用户设置处理。

### 改动范围

- 前端启动钩子 — 增加扫描逻辑
- 通知/弹窗组件 — 展示检测结果
- 状态栏 — 显示自动导入结果

### 交付标准

- `prompt` 模式下启动时弹出新 skill 确认框
- `auto` 模式下静默导入并在状态栏提示

---

## 总结

| 阶段 | 核心价值 | 预估工作量 |
|------|---------|-----------|
| 一 | 完整目录同步 | 中等（4 个后端文件改造） |
| 二 | 采集 + 迁移 | 较大（后端 + 前端 + UI） |
| 三 | 启动自动化 | 较小（基于阶段二封装） |
