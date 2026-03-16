# 填写指南：如何完善这个Skill

本文档帮助你了解Skill中每个文件的用途，以及需要你填写哪些内容。所有需要填写的位置都用 `<!-- TODO: ... -->` 标记。

## 快速开始

你可以按照以下优先级逐步填充内容：

| 优先级 | 文件 | 说明 | 预计耗时 |
| :--- | :--- | :--- | :--- |
| P0 | `references/cases/_TEMPLATE.md` | 按模板写入第1个真实案例 | 30分钟/案例 |
| P0 | `references/standards/ui_spec.md` | 填入公司品牌色、字体、组件库 | 1小时 |
| P1 | `references/standards/deployment_guide.md` | 填入部署资源申请流程 | 1-2小时 |
| P1 | `references/standards/system_landscape.md` | 填入系统和设备信息 | 1-2小时 |
| P1 | `references/pathways/01_webapp_dev.md` | 补充推荐工具和Prompt技巧 | 1小时 |
| P2 | `references/pathways/02_plugin_dev.md` | 补充插件开发经验 | 30分钟 |
| P2 | `references/pathways/03_automation_script.md` | 补充脚本开发经验 | 30分钟 |
| P2 | `references/pathways/04_demo_to_prd.md` | 补充Demo转PRD流程 | 30分钟 |
| P2 | `references/questions.json` | 根据实际情况调整问题和选项 | 30分钟 |

## 各文件详细说明

### SKILL.md（核心控制器）

**你需要做什么**：一般不需要修改。如果你想调整AI助手的引导语或交互流程，可以直接编辑。

---

### references/questions.json（诊断问题引擎）

**你需要做什么**：审阅现有的5个问题和选项，根据实际情况：
- 修改选项文字使其更贴合你们的业务术语
- 增加或删除选项
- 增加新的问题（需同时在 `scripts/generate_roadmap.py` 中更新映射）

**注意**：`pathway_tag` 字段必须与 `pathways/` 目录下的文件名对应。

---

### references/pathways/（开发路径指南）

**你需要做什么**：每个路径文件中都有 `<!-- TODO -->` 标记，需要填入：
- 推荐的AI工具和使用技巧
- 关键Prompt模板
- 公司特有的流程和联系人
- 你们总结的经验和注意事项

**如需新增路径**：
1. 在 `pathways/` 下新建 `05_xxx.md` 文件
2. 在 `pathways/index.md` 中添加条目
3. 在 `questions.json` 的 `q2_output` 问题中添加对应选项
4. 在 `scripts/generate_roadmap.py` 的 `PATHWAY_TITLES` 中添加映射

---

### references/cases/（成功案例库）

**你需要做什么**：
1. 复制 `_TEMPLATE.md` 并重命名（遵循命名规范：`{形态}_{序号}_{描述}.md`）
2. 按模板填写案例内容
3. 在 `cases/index.md` 中更新案例数量

**案例越多，Skill的价值越大。** 建议先收集3-5个典型案例作为起步。

---

### references/standards/（规范与资源中心）

**你需要做什么**：

**ui_spec.md**：填入公司品牌色值、字体规范、推荐组件库、布局规范等。这些信息可以从公司设计团队获取。

**deployment_guide.md**：填入云服务器/容器资源的申请流程、联系人、可申请的资源类型等。这些信息需要与IT部门确认。

**system_landscape.md**：填入门店和事业部使用的系统清单、设备信息、数据接口现状等。部分信息可能需要调研后逐步补充。

---

### scripts/generate_roadmap.py（路线图生成器）

**你需要做什么**：一般不需要修改。如果你修改了 `questions.json` 中的问题ID或选项值，需要同步更新脚本中的 `QUESTION_LABELS`、`OPTION_LABELS` 和 `PATHWAY_TITLES` 映射。

---

### templates/roadmap_template.html（路线图模板）

**你需要做什么**：一般不需要修改。如果你想调整路线图的视觉样式（颜色、布局等），可以修改 `<style>` 部分的CSS。

---

## 维护建议

- **定期收集新案例**：每当有同事完成一个自主开发项目，就邀请他们按模板写一份案例
- **及时更新规范**：当公司的UI规范、部署流程等发生变化时，同步更新对应文件
- **迭代问题设计**：根据用户反馈，优化 `questions.json` 中的问题和选项
- **扩展路径**：当出现新的产出形态（如小程序、桌面应用等），新增对应的路径文件
