# 2026-03-23 UI/UX 重塑抽样核对（模块级）

> 目标：对应 `2026-03-23-ui-ux-remodel-decision-consolidation.md`，对本批核心模块做“每模块不少于 10 条”关键细则抽样。  
> 说明：本文件只记录代码/样式可验证项；“真实人工端到端走查”另在执行清单中单列。

## A. 技能&工具（抽样 10/10）

| # | 决策点 | 证据 | 结论 |
|---|---|---|---|
| 1 | 合并为同一导航域（Skills+Tools） | `src/App.tsx:176`、`src/pages/SkillToolsPage.tsx:25` | 通过 |
| 2 | 页内 Tab 切换而非路由割裂 | `src/pages/SkillToolsPage.tsx:26`、`src/pages/SkillToolsPage.tsx:51` | 通过 |
| 3 | 页头主按钮保留“扫描本机技能” | `src/pages/SkillsPage.tsx:345`、`src/i18n/messages.ts:1579` | 通过 |
| 4 | 扫描为实时请求流，不做伪等待 | `src/pages/skills/useSkillsPageController.ts:70`、`src/pages/skills/useSkillsPageController.ts:91` | 通过 |
| 5 | 同步入口下沉到 Tools 卡片动作区 | `src/pages/tools/ToolCard.tsx:276` | 通过 |
| 6 | 同步方向固定为 `my-skills -> 工具路径` | `src/pages/tools/ToolCard.tsx:296`、`src/i18n/messages.ts:1340` | 通过 |
| 7 | Skills/Tools 术语分离（扫描 vs 下发） | `src/i18n/messages.ts:1584`、`src/i18n/messages.ts:1337` | 通过 |
| 8 | Tools 主任务优先级：追踪优先于自动同步 | `src/pages/tools/ToolCard.tsx:129`、`src/pages/tools/ToolCard.tsx:142` | 通过 |
| 9 | 卡片反馈具备 `aria-live` 且不喧哗 | `src/pages/tools/ToolCard.tsx:321` | 通过 |
| 10 | 冲突处理为“看 diff + 选基准”简化模型 | `src/pages/skills/SkillConflictDrawer.tsx:139`、`src/pages/skills/SkillConflictDrawer.tsx:183` | 通过 |

## B. 使用记录（抽样 10/10）

| # | 决策点 | 证据 | 结论 |
|---|---|---|---|
| 1 | Dashboard 定位为“使用记录”主页面 | `src/App.tsx:178`、`src/i18n/messages.ts:239` | 通过 |
| 2 | 日志以内页悬浮窗呈现 | `src/pages/DashboardPage.tsx:392`、`src/pages/DashboardPage.tsx:395` | 通过 |
| 3 | 悬浮窗不遮挡侧边栏 | `src/pages/DashboardPage.css:106` | 通过 |
| 4 | 关闭路径：右上关闭 + 窗外关闭 | `src/pages/DashboardPage.tsx:392`、`src/pages/DashboardPage.tsx:413` | 通过 |
| 5 | 打开后焦点落在筛选首控件 | `src/pages/DashboardPage.tsx:128`、`src/pages/DashboardPage.tsx:432` | 通过 |
| 6 | 关闭后回落到“查看日志”按钮锚点 | `src/pages/DashboardPage.tsx:149`、`src/pages/DashboardPage.tsx:242` | 通过 |
| 7 | Top 技能与日志过滤联动 | `src/pages/DashboardPage.tsx:158`、`src/pages/DashboardPage.tsx:424` | 通过 |
| 8 | 日志排序口径：时间倒序 + 技能次序 | `src/pages/DashboardPage.tsx:211` | 通过 |
| 9 | 日志时间统一走北京时间格式化器 | `src/pages/DashboardPage.tsx:531`、`src/domain/logTimestamp.ts:1` | 通过 |
| 10 | 同页连续流，无额外路由跳转 | `src/pages/DashboardPage.tsx:382`、`src/App.tsx:178` | 通过 |

## C. 全局文字/样式治理（抽样 10/10）

| # | 决策点 | 证据 | 结论 |
|---|---|---|---|
| 1 | 标题语义类统一由 token 驱动 | `src/styles/primitives.css:50` | 通过 |
| 2 | 正文/说明文语义类统一由 token 驱动 | `src/styles/primitives.css:57`、`src/styles/primitives.css:62` | 通过 |
| 3 | `body` 字体与主文本色全局统一 | `src/styles/foundation.css:24`、`src/styles/foundation.css:25` | 通过 |
| 4 | 成功语义色统一为 `#2F7A66`（亮色） | `src/styles/tokens.css:24` | 通过 |
| 5 | 成功语义色统一为 `#2F7A66`（暗色） | `src/styles/tokens.css:170` | 通过 |
| 6 | 图表成功语义色与全局成功色一致 | `src/styles/tokens.css:43`、`src/styles/tokens.css:187` | 通过 |
| 7 | 开关 active 语义色与成功色对齐 | `src/styles/tokens.css:66`、`src/styles/tokens.css:209` | 通过 |
| 8 | 侧边栏 IA 顺序与最新结构一致 | `src/components/Sidebar.tsx:27`、`src/components/Sidebar.tsx:30` | 通过 |
| 9 | 设置入口独立置底，状态语义清晰 | `src/components/Sidebar.tsx:71`、`src/components/Sidebar.tsx:74` | 通过 |
| 10 | 时间口径代码统一到北京时间工具链 | `src/domain/logTimestamp.ts:1`、`src/domain/lastSyncTime.ts:1` | 通过 |

## F. 评测页（抽样 10/10）

| # | 决策点 | 证据 | 结论 |
|---|---|---|---|
| 1 | 首屏核心 KPI 四项固定 | `src/pages/EvalPage.tsx:1686`、`src/pages/EvalPage.tsx:1706` | 通过 |
| 2 | `本次 vs 上次` 提升值按百分点计算 | `src/pages/EvalPage.tsx:1635` | 通过 |
| 3 | 提升值精度两位小数 | `src/pages/EvalPage.tsx:1640` | 通过 |
| 4 | 提升值三态语义（正/负/中性） | `src/pages/EvalPage.tsx:1641`、`src/pages/EvalPage.tsx:1647` | 通过 |
| 5 | 基准时间展示统一北京时间 | `src/pages/EvalPage.tsx:1648`、`src/pages/EvalPage.tsx:1652` | 通过 |
| 6 | 3 秒速览条（Quickline）在首屏可读 | `src/pages/EvalPage.tsx:1676` | 通过 |
| 7 | Complex Trigger 默认收起 | `src/pages/EvalPage.tsx:562`、`src/pages/EvalPage.tsx:563` | 通过 |
| 8 | 历史弹窗首屏加载 20 条 | `src/pages/EvalPage.tsx:522`、`src/pages/EvalPage.tsx:1093` | 通过 |
| 9 | 历史“加载更多”每次 +20 | `src/pages/EvalPage.tsx:1141` | 通过 |
| 10 | 历史当前基准标记与单条展开机制 | `src/pages/EvalPage.tsx:4534`、`src/pages/EvalPage.tsx:4545` | 通过 |

## G. Git 页（抽样 10/10）

| # | 决策点 | 证据 | 结论 |
|---|---|---|---|
| 1 | 页面双态架构：overview -> detail | `src/pages/GitPage.tsx:388`、`src/pages/GitPage.tsx:1218` | 通过 |
| 2 | 状态层级：主状态 + 次状态 | `src/pages/GitPage.tsx:483`、`src/pages/GitPage.tsx:486` | 通过 |
| 3 | 时间格式统一 `YYYY-MM-DD HH:mm`（北京） | `src/pages/GitPage.tsx:58`、`src/pages/GitPage.tsx:125` | 通过 |
| 4 | 图谱弹窗默认加载量 120 | `src/pages/GitPage.tsx:144`、`src/pages/GitPage.tsx:841` | 通过 |
| 5 | 图谱“加载更多”按 120 递增 | `src/pages/GitPage.tsx:868` | 通过 |
| 6 | 删除仓库采用确认弹窗 | `src/pages/GitPage.tsx:1799`、`src/pages/GitPage.tsx:1830` | 通过 |
| 7 | 忽略规则草稿 dirty 检测与保存约束 | `src/pages/GitPage.tsx:479`、`src/pages/GitPage.tsx:2088` | 通过 |
| 8 | 同步路径在详情区就地编辑与保存 | `src/pages/GitPage.tsx:1508`、`src/pages/GitPage.tsx:1525` | 通过 |
| 9 | 语义色状态 pill 对齐 success/warning/danger token | `src/pages/GitPage.css:1233`、`src/pages/GitPage.css:1245` | 通过 |
| 10 | 操作成功反馈 3 秒自动淡出 | `src/pages/GitPage.tsx:605`、`src/pages/GitPage.tsx:608` | 通过 |

## H. 设置页（抽样 10/10）

| # | 决策点 | 证据 | 结论 |
|---|---|---|---|
| 1 | 四分类模型（基础/外观/集成/评测） | `src/pages/SettingsPage.tsx:54`、`src/pages/SettingsPage.tsx:56` | 通过 |
| 2 | 默认选中“基础”分类 | `src/pages/SettingsPage.tsx:138` | 通过 |
| 3 | 双栏工作台（左导航 + 右内容） | `src/pages/SettingsPage.tsx:730`、`src/pages/SettingsPage.tsx:751` | 通过 |
| 4 | 左栏固定宽度约 220-240 | `src/pages/SettingsPage.css:9` | 通过 |
| 5 | 选中态“轻底色 + 左侧细色条” | `src/pages/SettingsPage.css:79`、`src/pages/SettingsPage.css:85` | 通过 |
| 6 | 切分类前检测未保存改动 | `src/pages/SettingsPage.tsx:224`、`src/pages/SettingsPage.tsx:228` | 通过 |
| 7 | 未保存切换三动作（取消/丢弃/保留） | `src/pages/SettingsPage.tsx:783`、`src/pages/SettingsPage.tsx:801` | 通过 |
| 8 | 分类切换后右侧滚动重置到顶部 | `src/pages/SettingsPage.tsx:206` | 通过 |
| 9 | 分段卡片承载 + 分段按钮右下固定 | `src/pages/SettingsPage.css:151`、`src/pages/SettingsPage.css:180` | 通过 |
| 10 | 不额外显示左侧 dirty 标记，保持导航克制 | `src/pages/SettingsPage.tsx:738`、`src/pages/SettingsPage.tsx:745` | 通过 |

## 结论

1. 本轮抽样覆盖模块：`A/B/C/F/G/H`，每模块 10 条，共 60 条，均有代码证据。  
2. 仍需单独执行的验证：真实交互环境下的“手工全链路走查”（不以代码静态证据替代）。

