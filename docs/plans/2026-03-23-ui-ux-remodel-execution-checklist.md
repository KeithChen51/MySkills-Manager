# 2026-03-23 UI/UX 重塑执行顺序与逐页验收清单

> 本清单用于把已冻结决策转成可执行任务。执行时只做实现，不再改动产品决策口径。  
> 决策源：`docs/plans/2026-03-20-ui-ux-remodel-decisions.md`、`docs/plans/2026-03-23-ui-ux-remodel-decision-consolidation.md`

## 1. 执行总顺序（按页面）

1. 技能&工具页（Skills + Tools 一体）
2. 使用记录页（Dashboard + Logs 一体）
3. 评测页（Eval）
4. Git 页
5. 设置页
6. 全局回归与一致性收口

## 2. 全局执行原则

- [x] 严格遵守 Logo 不变、品牌调性不变。
- [x] 成功语义色统一使用高级绿色 `#2F7A66`，不抢主视觉色。
- [x] 所有实际时间相关展示统一北京时间（UTC+08:00）。
- [x] 通用设计语言沿用已冻结规则，不在页面内重复发明新规范。
- [x] 发生冲突时用“新增反转条目”记录，不覆盖既有决策。

## 3. Phase A：技能&工具页（优先级 P0）

**决策覆盖**  
`5.0 - 5.67` + `5.207 - 5.316`

**主要文件**
- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/pages/SkillsPage.tsx`
- `src/pages/SkillsPage.css`
- `src/pages/ToolsPage.tsx`
- `src/pages/ToolsPage.css`
- `src/pages/skills/*`
- `src/pages/tools/*`
- `src/domain/skillConflict*.ts`

**实现清单**
- [x] 技能与工具保留同一导航域内的页内切换心智，不再做割裂流程。
- [x] 页头主按钮仅保留“扫描本机技能”。
- [x] 同步入口下沉到 Tools 卡片级动作，不在 Skills 结果区放同步主链路。
- [x] Tools 卡片同步方向固定为“my-skills -> 工具路径”。
- [x] 术语分离：Skills 域用“收录到 my-skills”，Tools 域用“下发到工具”。
- [x] 成功/失败提示、tooltip、spinner、aria-live 按已冻结细则落地。
- [x] 冲突处理保持“用户看 diff 后选基准版本”的简化模型。

**验收清单**
- [x] 扫描是秒级反馈，不出现伪等待长进度。
- [x] Tools 主任务优先级正确（追踪优先于自动同步）。
- [x] 主按钮、次按钮、状态提示层级清晰且不互抢。
- [x] 样式与动效语气符合“轻松而有秩序”。

## 4. Phase B：使用记录页（优先级 P0）

**决策覆盖**  
`5.68 - 5.131` + `5.189 - 5.206`

**主要文件**
- `src/pages/DashboardPage.tsx`
- `src/pages/DashboardPage.css`
- `src/pages/LogsPage.tsx`
- `src/pages/LogsPage.css`
- `src/components/Sidebar.tsx`
- `src/App.tsx`
- `src/domain/logTimestamp.ts`
- `src/domain/logDateRange.ts`

**实现清单**
- [x] Dashboard 收敛为“使用记录数据看板”，不再是独立心智页面。
- [x] Logs 独立页退役，日志能力以内嵌大悬浮窗方式呈现。
- [x] 悬浮窗不遮挡侧边栏，支持右上角关闭与窗外关闭。
- [x] Top 技能与日志过滤联动保留，不跳转评测页。
- [x] 日志行展开、路径展示、时间口径、排序规则按冻结规范统一。

**验收清单**
- [x] 用户从概览到日志是同页连续流，不出现路由跳跃割裂。
- [x] 悬浮窗关闭后回落锚点与滚动行为符合已定规则。
- [x] 使用记录页文案不混入评测语义。

## 5. Phase C：评测页（优先级 P1）

**决策覆盖**  
`5.317 - 5.573`

**主要文件**
- `src/pages/EvalPage.tsx`
- `src/pages/EvalPage.css`
- `src/components/KpiCard.tsx`
- `src/components/KpiCard.css`
- `src/domain/*`（与评测展示口径相关）

**实现清单**
- [x] 首屏核心指标固定为：总通过率、本次vs上次提升、失败样本数、评测耗时。
- [x] 提升值三态、精度、符号、缺失态、颜色语义按冻结规则实现。
- [x] 历史弹窗完成冻结重塑（首屏 20 条、加载更多、单条展开、分组详情、当前基准标记、刷新重置）。
- [x] 结果区图表与表格完成收展、筛选、分页、复制反馈与摘要口径落地（含 Complex Trigger 默认收起）。
- [x] 评测页与全局文字体系、时间口径保持一致。

**验收清单**
- [x] 首屏 3 秒可读：用户能立即判断质量趋势与变化幅度。
- [x] 所有关键数字口径一致，不出现“同字段不同格式”。
- [x] “Review Workbench”不在本批实现范围（保持冻结后置）。

## 6. Phase D：Git 页（优先级 P1）

**决策覆盖**  
`5.574 - 5.632`

**主要文件**
- `src/pages/GitPage.tsx`
- `src/pages/GitPage.css`

**实现清单**
- [x] Git 页面定位为“本机仓库技能同步治理工作台”。
- [x] 概览与详情的信息架构、主操作顺序、状态 pill、卡片密度按决策落地。
- [x] 图谱弹窗与忽略规则弹窗的开合、保存、重置、草稿行为按冻结规则落地。
- [x] 空态、排序、默认去向、反馈留存策略全部对齐决策。
- [x] 时间显示统一 `YYYY-MM-DD HH:mm`（北京时间）。

**验收清单**
- [x] 仓库从新增到治理到提交图谱查看形成连续闭环。
- [x] 危险动作（删除）有明确确认且层级克制。
- [x] 反馈状态可感知但不喧哗。

## 7. Phase E：设置页（优先级 P2）

**决策覆盖**  
`5.633 - 5.654`

**主要文件**
- `src/pages/SettingsPage.tsx`
- `src/pages/SettingsPage.css`

**实现清单**
- [x] 设置页重构为“左侧分类 + 右侧内容”双栏工作台。
- [x] 分类分组、默认选中、导航宽度、选中态、分段卡片全部按已定规则落地。
- [x] 采用分区独立保存/生效，不做全局保存。
- [x] 分类切换遇未保存改动时弹确认（保留/丢弃/取消切换）。
- [x] 危险动作按钮保持次级位，风险可见但不抢主任务。

**补拍板收敛（本轮冻结）**
- [x] 未保存确认弹窗信息密度：保持“标题 + 1 段说明 + 三动作按钮”。
- [x] 左侧分类 dirty 标记可见性：不额外显示 dirty 标记，改为切换时统一确认拦截。
- [x] 超长分段卡片的主操作可达策略：保持“分段卡片底部右侧主操作 + 右侧内容区滚动”。

## 8. Phase F：全局收口与回归（优先级 P0）

**主要文件**
- `src/styles/tokens.css`
- `src/styles/primitives.css`
- `src/styles/foundation.css`
- `src/App.css`
- 各页面 `*.css`

**收口清单**
- [x] 全局标题/正文/说明文语义类调用一致。
- [x] 无新增写死字体尺寸/颜色值破坏 token 体系。
- [x] 侧边栏导航命名、顺序、状态语义与最新信息架构一致。
- [x] 成功/失败/警告语义色及组件状态四态全局一致。

**回归清单**
- [x] `npm run lint` 通过。
- [x] `npm run build` 通过。
- [ ] 手工走查：技能&工具 -> 使用记录 -> 评测 -> Git -> 设置 全链路。
- [x] 对照 `2026-03-23-ui-ux-remodel-decision-consolidation.md` 抽样核对每模块不少于 10 条关键细则（见 `docs/plans/2026-03-23-ui-ux-remodel-sampling-check.md`）。

## 9. 建议执行节奏

- [ ] 每个 Phase 独立提交，避免跨页面大杂烩。
- [ ] 每个 Phase 完成后先做局部验收，再进入下一 Phase。
- [ ] P0（A/B/F）全部通过后，再推进 P1（C/D）与 P2（E）。
