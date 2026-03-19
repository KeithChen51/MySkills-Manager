# Skillar Skill Evaluator 模块设计文档

**版本**: 6.0 (Reimagined)
**日期**: 2026年3月19日
**基于**: v5.0 理论框架 + skill-creator 最新实践调研 + 用户痛点分析

---

## 1. 愿景与理论基础

### 1.1. 从"管理"到"度量"

Skillar 作为 AI Skills 本地桌面管理器，已解决了 Skills 的统一收敛、跨工具同步和使用追踪等核心问题。**Skill Evaluator** 旨在填补"度量"空白，为用户提供一套科学、可靠的评估框架。

### 1.2. v6.0 重点目标

基于已上线的评测基础能力和用户反馈，v6.0 聚焦解决四个核心问题：

| # | 问题 | 目标状态 |
|---|---|---|
| 1 | **运行过程黑盒** — 看不到实时信息 | 逐 case 实时流式状态 + 实时统计面板 |
| 2 | **评测维度不完善，结果分散** | 五维模型完整落地 + 统一 Scorecard 视图 |
| 3 | **视觉呈现差** | 雷达图 / 趋势图 / 对比表等专业可视化 |
| 4 | **缺少优化建议和闭环** | Analyzer 自动分析 + 改进建议 + Description 优化 |

### 1.3. 理论基础

- SkillsBench [1]：高质量 Skills 平均提升 Agent 任务成功率 16.2%
- SoK: Agentic Skills [2]：Representation × Scope 正交分类法
- Anthropic skill-creator (2026.03)：功能评测 5 步流程 + Description 优化循环 + Analyzer/Grader Agent 模式

---

## 2. Skill 分类体系

沿用 v5.0 的 **Representation × Scope 正交分类法**（参考 SoK [2]）。

### MVP 范围

| Representation | 评估复杂度 | 支持状态 |
|---|---|---|
| Natural-language | Low | ✅ 支持 |
| Tool macros | Medium | ✅ 支持 |
| Code-as-skill | High | ❌ 后续 |
| Hybrid | High | ❌ 后续 |

---

## 3. 五维评估框架

### 3.1. 评估维度

| 维度 | 核心问题 | 关键指标 | 实现状态 |
|---|---|---|---|
| **触发准确性** | 是否在正确时机触发？ | Precision, Recall, F1, 误触发率 | v6 增强 |
| **功能正确性** | 能否引导产出预期结果？ | Pass Rate, Assertion Rate, Quality Score | v6 增强 |
| **鲁棒性** | 输入变化时是否稳定？ | 多轮一致性, 方差分析 | v6 新增 |
| **效率** | 执行成本如何？ | Token 消耗, 延迟, 金钱成本 | v6 新增 |
| **增益量化** | 比没有 Skill 提升多少？ | with_skill vs without_skill Delta | v6 新增 |

### 3.2. 统一得分卡 (Scorecard)

每次评测完成后生成一张统一得分卡，而非分散展示：

```
╭─────────────────────────────────────────╮
│         Skill: my-awesome-skill         │
│         Model: gpt-4o-mini              │
│         Date: 2026-03-19 12:00          │
├─────────────────────────────────────────┤
│                                         │
│     ▲ 触发准确性: 92% (±3%)             │
│    ╱ ╲                                  │
│   ╱   ╲ 功能正确性: 85% (±5%)          │
│  ╱  ◆  ╲                               │
│ ╱ 雷达图 ╲ 鲁棒性: 78% (±8%)          │
│  ╲     ╱                                │
│   ╲   ╱  效率: 0.034 USD/run           │
│    ╲ ╱                                  │
│     ▼ 增益: +23% vs baseline            │
│                                         │
│  综合评级: ★★★★☆ (4.1/5)               │
│  Analyzer: "触发精度优秀，但功能正确性  │
│  在复杂指令场景存在退化，建议..."       │
╰─────────────────────────────────────────╯
```

---

## 4. 模型角色分离

### 4.1. 三角色架构

评测流程中的模型分为三个角色，支持独立配置：

| 角色 | 职责 | 默认策略 | 配置方式 |
|---|---|---|---|
| **Executor** (被测) | 模拟 Agent 执行任务 | 用户选择的模型 | 必选 |
| **Judge** (评判) | LLM-as-Judge 评分 + Analyzer 分析 | 推荐最强可用模型 | 独立下拉，默认=Executor |
| **Generator** (生成) | 生成测试用例 | 默认=Judge | 独立下拉，默认=Judge |

### 4.2. 弱模型容错

- **JSON 解析多级容错**: 严格解析 → 宽松提取 → Regex fallback → 标记ERROR
- **Judge 降级保护**: LLM Judge 失败率 > 30% 时自动 fallback 到启发式评分，报告中标注
- **可信度标签**: Judge 与 Executor 同为弱模型时显示 ⚠ "评分仅供参考"

---

## 5. 核心评测流程

### 5.1. 触发准确性测试

**双环境测试**：
- **干净环境 (Clean)**: 仅包含当前 Skill，评估 description 质量
- **复杂环境 (Complex)**: 包含所有已安装 Skills，评估竞争表现，报告"被哪个 Skill 抢走触发"

**流式截断机制**: streaming 调用 API，检测到 `skill` tool call 即截断，降低成本

**统计聚合**: 每个 query 支持多轮运行（默认3轮），按 trigger_rate 确定 pass/fail，计算 Precision/Recall/F1

### 5.2. 功能正确性测试

#### Layer 1: 硬性门控 (Hard Gate)

结构性断言 + 确定性验证器。任一检查失败则 FAIL，跳过 Layer 2。

#### Layer 2: 质量评分 (Quality Score)

由 Judge 模型评分，维度：
- **Relevance** (相关性): 输出与 prompt 的对齐度
- **Instruction Following** (遵循指令): 对 assertion 的满足程度
- **Completeness** (完整性): 输出是否完整覆盖

分数标准化到 [0, 1]，附带 rationale 和 improvement_suggestions。

### 5.3. 增益量化测试

同一模型 + 同一 prompt，分别运行 `with_skill`（注入 SKILL.md）和 `without_skill`（裸跑），对比：

| 指标 | with_skill | without_skill | Delta |
|---|---|---|---|
| Pass Rate | 85% ± 5% | 35% ± 8% | **+50%** |
| Quality Score | 0.82 ± 0.04 | 0.61 ± 0.09 | **+0.21** |
| Latency | 3.2s ± 0.8s | 2.1s ± 0.5s | +1.1s |
| Tokens | 3800 ± 400 | 2100 ± 300 | +1700 |

### 5.4. 鲁棒性评估

通过多轮运行的**方差分析**自动评估：
- 低方差 (stddev < 5%) = 高鲁棒性
- 高方差 (stddev > 20%) = 鲁棒性问题，标记为 analyzer note

### 5.5. 效率评估

从每次 API 调用中收集：
- `input_tokens` / `output_tokens` → Token 消耗
- `latency_ms` → 响应延迟
- 基于模型定价表估算 → 金钱成本（USD/CNY）

---

## 6. Analyzer 自动分析

### 6.1. 定位

Analyzer 是评测闭环的关键组件。它不是简单地展示数据，而是**主动发现模式和异常**，生成可操作的改进建议。

### 6.2. 分析流程

1. **Per-Assertion 模式分析**
   - 双配置都 PASS → "非区分性断言，考虑加强"
   - 双配置都 FAIL → "可能超出模型能力范围"
   - with_skill PASS / without_skill FAIL → "Skill 在此处发挥核心价值"
   - 高方差 → "可能是 flaky 测试或非确定性行为"

2. **Cross-Case 模式分析**
   - 哪类 case 一致性最差？
   - 哪个 bucket（positive/negative/boundary/adjacent）问题最大？

3. **效率权衡分析**
   - "Skill 提升 Pass Rate +50% 但增加延迟 +1.1s，Token 消耗 +80%"

4. **改进建议生成**
   - Description 改进建议（基于触发失败分析）
   - SKILL.md 内容改进建议（基于功能失败分析）
   - 测试集改进建议（非区分性断言的替代方案）

### 6.3. 实现方式

由 Judge 模型进行分析（Python 引擎中），输出结构化的 `analyzer_notes` 和 `improvement_suggestions`。

---

## 7. 实时进度系统

### 7.1. 设计原则

从"黑盒等待"到"透明可视"：用户在评测运行期间应能看到每一步的实时状态。

### 7.2. 进度事件流

```
Pipeline Progress Event:
├── 当前阶段: "trigger_clean" / "trigger_complex" / "functional" / "analyzer"
├── 总体进度: 45% (步骤 3/7)
├── 当前重复轮次: 2/3
├── Case 级别状态:
│   ├── case-001: ✅ PASS (latency: 1.2s, tokens: 450)
│   ├── case-002: ❌ FAIL (error: "JSON parse failed")
│   ├── case-003: ⏳ Running...
│   └── case-004: ⏸ Pending
├── 实时统计:
│   ├── 当前 Pass Rate: 67% (2/3 completed)
│   ├── 累计 Token: 1,350
│   └── 累计耗时: 4.5s
└── 预估剩余: ~12s
```

### 7.3. 前端展示

运行中页面包含：
- **进度条** — 总体和当前阶段的双层进度
- **Case 网格** — 每个 case 显示为小卡片（绿/红/蓝/灰），实时翻转状态
- **实时统计面板** — Pass Rate 仪表盘、Token 计数器、耗时计时器
- **日志流** — 可折叠的详细日志区域

---

## 8. 测试用例管理

### 8.1. 生成策略

- **LLM 自动生成**: 分析 SKILL.md 内容，按 bucket 生成均衡的测试集
- **用户手动编写/编辑**: 表格式编辑器，支持行内验证
- **导入外部数据集**: 兼容 agentskills.io 的 `evals/evals.json` 格式

### 8.2. 触发测试集 Bucket 结构

| Bucket | 比例 | 说明 |
|---|---|---|
| positive_trigger | ≥25% | 应该触发的正面查询 |
| negative_trigger | ≥25% | 不应触发的无关查询 |
| boundary_ambiguous | ≥25% | 边界模糊的查询 |
| adjacent_skill_confusion | ≥25% | 容易误触发的相邻 Skill 查询 |

---

## 9. 结果展示与对比

### 9.1. 四个视图

| 视图 | 何时显示 | 核心内容 |
|---|---|---|
| **Setup** | 评测前 | 模型选择、模式选择、数据集管理 |
| **Running** | 评测中 | 实时进度（§7） |
| **Result** | Quick 模式完成后 | 触发结果 + 统计 |
| **Review** | Full 模式完成后 | 五维 Scorecard + Analyzer + 详细分项 |

### 9.2. Review 视图结构

```
┌─────────────────────────────────────────────────────────┐
│ 🎯 Scorecard (雷达图 + 五维分数 + 综合评级)             │
├─────────────────────────────────────────────────────────┤
│ 📊 增益对比 (with_skill vs without_skill 双栏对比表)     │
├─────────────────────────────────────────────────────────┤
│ 💡 Analyzer 洞察 (自动分析 notes + 改进建议)            │
├─────────────────────────────────────────────────────────┤
│ 📋 触发详情 | 📋 功能详情 | 📋 效率详情   (Tab 切换)   │
│    逐 case    逐 case        Token/延迟                 │
│    pass/fail   pass/fail     成本估算                   │
│    confidence   quality       对比图表                   │
├─────────────────────────────────────────────────────────┤
│ 📈 历史趋势 (折线图：质量分/Pass Rate 随迭代变化)       │
└─────────────────────────────────────────────────────────┘
```

### 9.3. 历史对比

- 每次评测结果持久化为 JSON（`~/my-skills/.eval/{skill-name}/`）
- 两次结果可 Diff 对比（指标增减高亮）
- 折线趋势图展示质量随迭代的变化
- 记录 SKILL.md hash 关联到具体版本

---

## 10. 评估模式

| 模式 | 内容 | 适用场景 |
|---|---|---|
| **Quick** | 仅触发测试 (Clean) | 快速验证 description |
| **Standard** | 触发 (Clean + Complex) + 功能 + 效率 | 日常开发迭代 |
| **Full** | 五维全覆盖 + 增益量化 + Analyzer 分析 | 正式发布前验证 |

---

## 11. 成本控制

- **运行前预估**: 根据模式、用例数、模型定价预估 API 成本
- **运行中预算**: 支持设定最大预算，超限暂停
- **输入/输出货币**: 支持 USD / CNY 切换

---

## 12. Description 优化（P2 后续）

> 此功能为第二阶段实现，此处记录设计。

参考 skill-creator 的 `run_loop.py`：
- 将触发 eval set 分为 60% train / 40% test
- 评估当前 description（每 query 多轮取 trigger_rate）
- Judge 模型分析失败原因 → 提出 description 改进
- 在 train + test 上重新评估改进后的 description
- 最多 5 轮迭代，以 test score 选 best（防过拟合）
- 输出 before/after 对比 + 推荐 description

---

## 13. 技术架构

### 13.1. 三层架构

```
┌─────────────────────────────┐
│   React Frontend (v6 重构)   │
│   拆分为独立组件:            │
│   - EvalSetup               │
│   - EvalRunning              │
│   - EvalResult               │
│   - EvalReview               │
│   - EvalScorecard            │
│   - EvalHistory              │
│   共享 state: useEvalStore   │
├─────────────────────────────┤
│   Rust/Tauri 中间层          │
│   拆分为模块:               │
│   - evals/mod.rs (入口)      │
│   - evals/types.rs (类型)    │
│   - evals/pipeline.rs (管道) │
│   - evals/history.rs (历史)  │
│   - evals/analyzer.rs (分析) │
├─────────────────────────────┤
│   Python 评估引擎 (重构)     │
│   - llm_client.py (统一)     │
│   - trigger_eval.py          │
│   - functional_eval.py       │
│   - sample_gen.py            │
│   - analyzer.py (新增)       │
│   - schemas/ (JSON contract) │
└─────────────────────────────┘
```

### 13.2. Python 引擎重构要点

- **统一 LLM Client**: 从 trigger_eval / functional_eval 中提取公共 `LLMClient` 到 `llm_client.py`
- **多 Provider 支持**: 当前仅 `openai-compatible`，后续可扩展 Anthropic / Google 原生 API
- **Analyzer 模块**: 新增 `analyzer.py`，接收评测结果 JSON，输出 `analyzer_notes` + `improvement_suggestions`

### 13.3. 前端重构要点

- **拆分 EvalPage.tsx**: 从 3847 行单文件拆分为 6+ 个独立组件
- **State 管理**: 引入 `useEvalStore` (或 Context) 统一管理评测状态
- **可视化升级**: ECharts 雷达图、趋势折线图、Case 网格等

---

## 14. 错误处理

- **单 case 失败**: 重试 2 次后标记 ERROR，继续后续 case
- **断点续跑**: 支持中断后从断点继续
- **部分结果**: 超过半数 case 成功则生成带降级提示的部分报告
- **Judge 降级**: LLM Judge 调用失败 fallback 到启发式评分

---

## 15. 多语言支持

- 自动匹配 Skill 主要语言
- Judge 使用与 Skill 相同语言评分
- 跨语言测试可选，默认关闭

---

### 参考文献

[1] Li, X., et al. (2026). *SkillsBench*. arXiv:2602.12670.
[2] Jiang, Y., et al. (2026). *SoK: Agentic Skills*. arXiv:2602.20867.
[3] Anthropic. (2026). *Building Skills for Claude*. anthropic.com.
[4] Anthropic. (2026). *skill-creator*. github.com/anthropics/skills — 功能评测 + Analyzer + Description 优化实践.
[5] Agent Skills. (2026). *Evaluating skill output quality*. agentskills.io.
[6] PyMC Labs. (2026). *Improving AI Agent Performance with Domain-Specific Skills*. pymc-labs.com.
