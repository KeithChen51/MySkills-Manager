# 常见问题排查指南

## 目录

1. [页眉横线无法移除](#页眉横线无法移除)
2. [样式应用后格式不生效](#样式应用后格式不生效)
3. [页码显示异常](#页码显示异常)
4. [标题出现多余编号前缀](#标题出现多余编号前缀)
5. [封面出现页眉页脚](#封面出现页眉页脚)
6. [中文字体不生效](#中文字体不生效)

## 页眉横线无法移除

**症状**：封面或摘要页顶部出现横线，即使页眉内容为空。

**原因**：Header 段落样式（如 styleId="ad"）在 styles.xml 中定义了底部边框 `<w:pBdr><w:bottom>`。空段落仍继承此样式。

**解决**：在空页眉的段落中显式覆盖边框为 none：
```xml
<w:pPr>
  <w:pBdr>
    <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  </w:pBdr>
</w:pPr>
```

使用 `header_footer.py` 的 `set_empty_header()` 函数，它会自动处理。

## 样式应用后格式不生效

**症状**：已为段落设置了 Heading1 样式，但字体/字号仍是旧的。

**原因**：段落或 run 上有直接格式覆盖（手动设置的字体/字号优先级高于样式）。

**解决**：应用样式后，必须清除直接格式：
```python
from ops.style_mgr import clear_all_direct_format_for_paragraph
clear_all_direct_format_for_paragraph(para_elem)
```

## 页码显示异常

**症状**：页码显示为 "1X"、"X" 等奇怪字符。

**原因**：域代码中的 instrText 格式不正确，或 fldChar 的 separate/end 配对错误。

**解决**：使用 `header_footer.py` 的 `set_footer_page_number()` 函数重新生成完整的域代码。确保 begin → instrText → separate → 占位文本 → end 的完整序列。

## 标题出现多余编号前缀

**症状**：二级标题前出现 "第一节" 等不需要的编号。

**原因**：从模板复制了 numbering.xml，其中的 abstractNum 定义了自动编号格式，而 Heading 样式关联了这些编号。

**解决**：
1. 不复制 numbering.xml（`copy_styles_xml(also_copy_numbering=False)`）
2. 或者修改 numbering.xml 中对应 abstractNum 的 lvlText 为空

## 封面出现页眉页脚

**症状**：封面页顶部有横线或底部有页码。

**原因**：
1. 封面节没有独立的 headerReference/footerReference
2. 封面节的页眉链接到了后续节（linkToPrevious）

**解决**：
1. 为封面节创建独立的空 header/footer XML 文件
2. 在 sectPr 中添加对应的 headerReference
3. 使用 `set_empty_header()` 确保空页眉无边框

## 中文字体不生效

**症状**：设置了宋体/黑体但文档中显示为其他字体。

**原因**：`<w:rFonts>` 需要同时设置 `w:eastAsia`（中文）和 `w:ascii`/`w:hAnsi`（西文），否则中文字符可能使用默认字体。

**解决**：
```python
from ops.character_fmt import set_run_font
set_run_font(run_elem, font_cn='宋体', font_en='Times New Roman')
```
