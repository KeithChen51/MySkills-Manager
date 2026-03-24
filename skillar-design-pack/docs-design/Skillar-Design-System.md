# Skillar Design System (v2.0)

**Prism Rational × F-soft · 2026-03-24**

---

## 1. 核心理念

Skillar 的设计语言追求**克制、清晰、有序**。

- **克制**：低饱和度冷色基底，品牌四色只在关键位置出现，不喧宾夺主。
- **清晰**：明确的排版层级和语义 token，每个值都能追溯到决策轮次。
- **有序**：8pt 间距网格、三档动效、统一的控件高度，保持视觉节奏一致。

## 2. Logo

Logo 采用石墨灰三角形搭配暖橙、天蓝、蓝紫、薰衣草四色光线。这四色贯穿整个 UI，分别承担不同的功能语义。

| 白底版 | 透明底版 |
| :--- | :--- |
| ![Logo White](../logo/F-soft-white.png) | ![Logo Transparent](../logo/F-soft-transparent.png) |

## 3. 色彩系统

色彩方向：Prism Rational（R28 确定）。在冷静克制的灰蓝基底上，用品牌四色提供功能性温度。

### 3.1 浅色主题

#### 交互语义色

| Token | 色值 | 角色 |
| :--- | :--- | :--- |
| `--accent` | `#63b3ed` 天蓝 | 主按钮、选中态、导航高亮、链接 |
| `--secondary` | `#b794f4` 薰衣草 | 分类标签、模式徽章、二级按钮 |
| `--highlight` | `#f6ad55` 暖橙 | 新功能标记、CTA 辅助、重要提示 |
| `--info` | `#7f9cf5` 蓝紫 | 信息提示、帮助链接、引导文案 |
| `--success` | `#2f7a66` 高级绿 | 同步成功、状态正常 |
| `--warning` | `#e39e4f` 暖琥珀 | 警告提示 |
| `--danger` | `#d46d82` 暗玫 | 错误状态、删除操作 |

每个语义色配套 `-hover`、`-bg`（14% 透明度）、`-border` 衍生变量。

#### 中性色

| Token | 色值 | 角色 |
| :--- | :--- | :--- |
| `--text-primary` | `#2d3748` | 标题 / 主文字 |
| `--text-secondary` | `#475467` | 正文 / 次要文字 |
| `--text-muted` | `#68788f` | 辅助 / 占位符 |
| `--text-disabled` | `#a0aec0` | 禁用态 |
| `--bg-primary` | `#f2f4f9` | 页面背景 |
| `--bg-card` | `#fbfcfe` | 卡片背景 |
| `--border-card` | `#d3dcea` | 卡片边框 |
| `--border-input` | `#bcc9dc` | 输入框边框 |

#### 装饰色（背景辉光 / 渐变用）

| Token | 色值 | 来源 |
| :--- | :--- | :--- |
| `--prism-orange` | `#f6ad55` | Logo 暖橙 |
| `--prism-yellow` | `#f2c27f` | Logo 衍生 |
| `--prism-aqua` | `#63b3ed` | Logo 天蓝 |
| `--prism-blue` | `#7f9cf5` | Logo 蓝紫 |
| `--prism-purple` | `#b794f4` | Logo 薰衣草 |

### 3.2 深色主题

语义色自动提亮：`--accent: #7fc2f1`、`--secondary: #cfb2ff`、`--highlight: #fbd38d`、`--info: #a3bffa`。
Success/Warning/Danger 同理。完整值见 `tokens.css :root[data-theme="dark"]`。

## 4. 排版规范

### 字体栈（系统原生）

| 角色 | 栈 |
| :--- | :--- |
| 正文 | SF Pro Text → Segoe UI → PingFang SC → Microsoft YaHei UI → system-ui |
| 标题 | SF Pro Display → Segoe UI → PingFang SC → Microsoft YaHei UI → system-ui |
| 等宽 | Cascadia Code → JetBrains Mono → SF Mono → Consolas |

### 字号层级

| Token | 值 | 场景 |
| :--- | :--- | :--- |
| `--text-xs` | 0.8125rem (13px) | 标签、辅助、时间戳 |
| `--text-sm` | 0.875rem (14px) | 正文默认 |
| `--text-md` | 1rem (16px) | 强调正文、按钮 |
| `--text-lg` | 1.125rem (18px) | 区域标题 |
| `--text-xl` | 1.375rem (22px) | 页面标题 |

### 语义排版 Token

| Token | Size / Weight / Line |
| :--- | :--- |
| `--typo-page-title-*` | 1.375rem / 600 / 1.3 |
| `--typo-section-title-*` | 1.125rem / 600 / 1.4 |
| `--typo-body-*` | 0.875rem / 400 / 1.6 |
| `--typo-meta-*` | 0.8125rem / 400 / 1.45 |

## 5. 组件规范

### 5.1 圆角

| 场景 | Token | 值 |
| :--- | :--- | :--- |
| 按钮、输入框、标签 | `--radius-sm` | 6px |
| 卡片、下拉 | `--radius-md` | 10px |
| 模态框、大面板 | `--radius-lg` | 14px |
| 胶囊标签 | `--radius-pill` | 999px |

### 5.2 阴影

灰调阴影（非蓝调），确保层级感而不抢注意力。

| Token | 值 |
| :--- | :--- |
| `--shadow-card` | `0 1px 2px rgba(45,55,72,0.06), 0 8px 18px rgba(85,103,133,0.06)` |
| `--shadow-card-hover` | `0 2px 6px rgba(45,55,72,0.07), 0 14px 26px rgba(85,103,133,0.1)` |
| `--shadow-drawer` | `-18px 0 36px rgba(27,37,54,0.24)` |

### 5.3 按钮

| 类型 | 背景 | 文字色 | 场景 |
| :--- | :--- | :--- | :--- |
| Primary | `--accent` 渐变 | `--accent-contrast` | 主操作 |
| Secondary | `--secondary` | 白 | 二级操作（薰衣草） |
| Highlight | `--highlight` | `--text-primary` | CTA 辅助（暖橙） |
| Ghost | 透明 + 边框 | `--text-secondary` | 次要 / 取消 |

四态：default → hover (brightness 1.04) → active (brightness 0.94) → disabled (opacity 0.6)。

### 5.4 标签

| 类型 | 背景/边框 | 文字色 | 场景 |
| :--- | :--- | :--- | :--- |
| `tag-secondary` | `--secondary-bg` / `--secondary-border` | `--secondary` | 分类 |
| `tag-highlight` | `--highlight-bg` / `--highlight-border` | `--highlight` (78% mix) | 新功能 |
| `tag-info` | `--info-bg` / `--info-border` | `--info` | 信息 |

### 5.5 控件尺寸

| Token | 值 | 场景 |
| :--- | :--- | :--- |
| `--control-height` | 40px | 标准控件 |
| `--control-height-compact` | 32px | 紧凑场景 |
| `--control-height-touch` | 44px | 触控友好 |

### 5.6 间距（8pt 网格）

`2 → 4 → 8 → 12 → 16 → 24 → 32 → 40` px，对应 `--sp-2xs` 到 `--sp-3xl`。

### 5.7 动效

| Token | 值 | 场景 |
| :--- | :--- | :--- |
| `--transition-fast` | 0.14s ease-out | 按钮态变 |
| `--transition` | 0.18s ease-in-out | 通用过渡 |
| `--transition-slow` | 0.22s ease-out | 抽屉 / 弹层 |

---

**文档版本**: 2.0
**最后更新**: 2026-03-24
