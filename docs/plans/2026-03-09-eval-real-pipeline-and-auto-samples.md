# Eval链路与AI样例生成实施计划（先落盘后执行）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复当前构建阻断，打通真实评测链路，并在 Eval 页面支持 AI 自动生成大样本评测集（先预览可改再保存）。

**Architecture:** 前端通过 Tauri API 调用 Rust 命令；Rust 负责配置读写、Python 执行与错误归一化；Python eval_engine 统一负责 trigger/functional/sample-generation 三类任务输出，结果通过 JSON 回传前端展示。评测配置（API Key、Provider、Base URL、默认模型）统一存放到用户配置目录。

**Tech Stack:** React + TypeScript + Vite, Tauri 2 + Rust, Python 3 eval_engine

---

## Task 1: 落盘计划与阻断修复（编译可恢复）

**Files:**
- Create: `docs/plans/2026-03-09-eval-real-pipeline-and-auto-samples.md`
- Modify: `src/i18n/messages.ts`
- Modify: `src-tauri/py/eval_engine/schemas/trigger_eval_input.json`

**Step 1: 修复 i18n 语法错误**
- 转义 `eval.empty` 中文文案内嵌引号，确保 TS 可编译。

**Step 2: 修复 trigger schema 非法尾部**
- 删除 `trigger_eval_input.json` 中多余闭合大括号，保证 JSON 合法。

**Step 3: 验证最小阻断解除**
- Run: `npm run lint`
- Expected: 不再出现 `messages.ts` 语法错误。

## Task 2: 后端评测配置与命令契约打通

**Files:**
- Modify: `src-tauri/src/evals.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/root_dir.rs` (如需新增 eval config 路径辅助函数)
- Modify: `src-tauri/py/eval_engine/__main__.py`
- Modify: `src-tauri/py/eval_engine/trigger_eval.py`
- Modify: `src-tauri/py/eval_engine/functional_eval.py`
- Create: `src-tauri/py/eval_engine/sample_gen.py`

**Step 1: 新增 eval 配置读写命令**
- 新增 `eval_get_config`、`eval_save_config`。
- 配置文件路径：`~/.myskills-manager/eval-config.json`。
- 字段：`api_key`、`provider`、`base_url`、`default_model`。

**Step 2: 调整 run_trigger_eval / run_functional_eval 入参**
- 移除来自前端的 `api_key` 参数。
- 运行时从本地 eval config 读取 `api_key`。
- 参数路径转换移除 `unwrap`，改为显式错误返回。

**Step 3: 跨平台 Python 解释器探测**
- Windows: 优先 `py -3`，回退 `python`。
- 非 Windows: 优先 `python3`，回退 `python`。
- 探测失败返回可读错误。

**Step 4: 统一 Python CLI 真实执行**
- `__main__.py` 取消 placeholder，实际调用 `trigger_eval.run` 与 `functional_eval.run`。
- trigger 输出严格写 `--output-path`。
- functional 输出严格写 `summary.json`（Rust 读取该文件）。

**Step 5: 新增样例生成命令**
- 新增子命令 `generate-samples`。
- 默认生成 Trigger 40（20 正 + 20 负）与 Functional 20。
- 输出结构严格符合 schema。

## Task 3: 前端 API 层与设置页接入

**Files:**
- Modify: `src/api/tauri.ts`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/i18n/messages.ts`

**Step 1: 扩展 tauri API 封装**
- 新增类型：`EvalConfig`、`GeneratedEvalSamples`、`TriggerEvalOutput`、`FunctionalEvalOutput`。
- 新增函数：`evalGetConfig`、`evalSaveConfig`、`evalGenerateSamples`、`evalSaveDataset`。
- 更新：`runTriggerEval`、`runFunctionalEval`（移除 `apiKey` 入参）。

**Step 2: Settings 页面新增 API 配置区**
- 新增字段：API Key（掩码显示）、Base URL（可选）、默认模型。
- 页面加载时读取 config，保存时写回。

## Task 4: Eval 页面真实评测 + AI 样例生成流程

**Files:**
- Modify: `src/pages/EvalPage.tsx`
- Modify: `src/pages/EvalPage.css`
- Modify: `src/i18n/messages.ts`

**Step 1: 移除 mock 运行逻辑**
- 用真实 Tauri 命令替换当前 `setTimeout` mock。
- 接入运行状态、错误状态与结果渲染。

**Step 2: 模型选择能力**
- 增加“预置列表 + 自定义模型输入”。
- 默认值来自 settings 保存的 `default_model`。

**Step 3: 样例生成与保存链路**
- 增加“一键生成样例”按钮。
- 生成后展示 trigger/function 两份 JSON 可编辑预览。
- 用户选择本地路径并保存 JSON（触发 / 功能分别保存）。

**Step 4: 评测执行入口完整化**
- 运行前校验：已选 skill、model、trigger json 路径、functional json 路径。
- 调用 `runTriggerEval` 与 `runFunctionalEval` 后更新 KPI/图表/表格。

## Task 5: 测试与验证（完成前硬验证）

**Files:**
- Modify/Create tests in `test/` and `src-tauri/src/*` test modules as needed

**Step 1: 前端验证**
- Run: `npm run lint`
- Run: `npm run build`
- Run: `npx tsx --test test/*.test.ts`

**Step 2: Rust 验证**
- Run: `cargo test --manifest-path src-tauri/Cargo.toml`

**Step 3: 手工验收**
- 设置页配置 API Key/Model 能保存并回读。
- Eval 页可一键生成 40/20 样例，允许手动编辑后保存。
- 使用保存的 JSON 可成功执行评测并展示结果。
- 缺 key / 缺文件 / python 不可用时有明确错误，不崩溃。

## Constraints
- 本轮不做 `monaco/dompurify` 升级。
- API Key 先明文本地存储，日志禁止打印密钥。
- 样例规模先固定，后续再做可配置化。
