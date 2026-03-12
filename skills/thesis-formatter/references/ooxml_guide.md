# OOXML 关键知识速查

## 目录

1. [文件结构](#文件结构)
2. [节与页面设置](#节与页面设置)
3. [页眉页脚](#页眉页脚)
4. [样式系统](#样式系统)
5. [段落格式](#段落格式)
6. [字符格式](#字符格式)
7. [常见陷阱](#常见陷阱)

## 文件结构

DOCX 是 ZIP 包，核心文件：

| 文件 | 作用 |
|------|------|
| word/document.xml | 文档主体（段落、表格） |
| word/styles.xml | 样式定义 |
| word/numbering.xml | 编号/列表定义 |
| word/header{N}.xml | 页眉内容 |
| word/footer{N}.xml | 页脚内容 |
| word/_rels/document.xml.rels | 关系文件（rId映射） |
| [Content_Types].xml | 内容类型声明 |

## 节与页面设置

节分隔符存储在 `<w:pPr><w:sectPr>` 中（段落级），最后一节的 sectPr 在 `<w:body><w:sectPr>` 中。

关键属性：
- `<w:pgSz w:w="11907" w:h="16840"/>` — A4纸（twips）
- `<w:pgMar w:top="1440" w:left="1588" .../>` — 页边距
- `<w:type w:val="nextPage"/>` — 节起始方式
- `<w:titlePg/>` — 首页不同（存在即启用）
- `<w:pgNumType w:fmt="upperRoman" w:start="1"/>` — 页码格式

## 页眉页脚

通过 sectPr 中的 headerReference/footerReference 引用：
```xml
<w:headerReference w:type="default" r:id="rId7"/>
<w:headerReference w:type="first" r:id="rId8"/>
<w:footerReference w:type="default" r:id="rId9"/>
```

type 值：`default`（默认页）、`first`（首页，需 titlePg）、`even`（偶数页）

**关键陷阱**：Header 段落样式可能定义了底部边框。即使页眉内容为空，横线仍会显示。解决方案：在空页眉段落中显式设置 `<w:pBdr><w:bottom w:val="none"/></w:pBdr>`。

页码域代码：
```xml
<w:fldChar w:fldCharType="begin"/>
<w:instrText> PAGE  \* MERGEFORMAT </w:instrText>
<w:fldChar w:fldCharType="separate"/>
<w:t>1</w:t>
<w:fldChar w:fldCharType="end"/>
```

## 样式系统

样式优先级（从低到高）：
1. 文档默认值（`<w:docDefaults>`）
2. 样式定义（`<w:style>`）
3. 直接格式（段落/run 上的属性）

**关键原则**：直接格式会覆盖样式。格式化论文时必须先清除直接格式，再应用样式。

样式 ID vs 名称：`<w:style w:styleId="Heading1">` 中 styleId 是内部ID，`<w:name w:val="heading 1"/>` 是显示名。中文样式的 styleId 可能是编码后的字符串。

## 段落格式

```xml
<w:pPr>
  <w:pStyle w:val="Heading1"/>       <!-- 样式 -->
  <w:jc w:val="center"/>             <!-- 对齐 -->
  <w:spacing w:line="360" w:lineRule="auto" w:before="0" w:after="100"/>
  <w:ind w:firstLineChars="200" w:firstLine="480"/>  <!-- 首行缩进 -->
</w:pPr>
```

行距值：240=单倍，360=1.5倍，480=双倍（lineRule="auto"时）

## 字符格式

```xml
<w:rPr>
  <w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/>
  <w:sz w:val="24"/>      <!-- 字号：half-point，24=12pt=小四 -->
  <w:b/>                   <!-- 加粗 -->
  <w:i/>                   <!-- 斜体 -->
  <w:color w:val="000000"/>
</w:rPr>
```

## 常见陷阱

1. **页眉横线**：来自 Header 段落样式的 pBdr 定义，不是页眉内容本身
2. **样式ID编码**：中文样式名的 styleId 可能是 "ae"、"ad" 等编码值
3. **numbering 覆盖**：复制 numbering.xml 可能引入不需要的编号前缀
4. **titlePg 副作用**：启用后首页不显示 default 页眉页脚，需要单独设置 first 类型
5. **直接格式残留**：用户手动设置的字体/字号会覆盖样式，必须显式清除
6. **节的 sectPr 位置**：段落级 sectPr 在 pPr 内，body 级在 body 直接子元素
