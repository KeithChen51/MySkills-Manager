#!/usr/bin/env python3
"""
原子操作：样式管理
功能：复制模板样式、应用样式到段落、清除直接格式
"""

import sys, os, shutil, zipfile, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from utils import *
from lxml import etree


def copy_styles_xml(template_docx, target_docx, output_docx=None,
                    also_copy_numbering=True):
    """
    将模板的styles.xml（和可选的numbering.xml）复制到目标文件中。
    这是确保目标文件拥有模板定义的所有样式的基础步骤。

    参数:
        template_docx: 模板Word文件路径
        target_docx: 目标Word文件路径
        output_docx: 输出路径（None则覆盖target_docx）
        also_copy_numbering: 是否同时复制numbering.xml
    """
    if output_docx is None:
        output_docx = target_docx

    # 先复制目标文件
    if output_docx != target_docx:
        shutil.copy2(target_docx, output_docx)

    # 从模板提取需要的XML
    with zipfile.ZipFile(template_docx, 'r') as tz:
        template_styles = tz.read('word/styles.xml')
        template_numbering = None
        if also_copy_numbering and 'word/numbering.xml' in tz.namelist():
            template_numbering = tz.read('word/numbering.xml')

    # 替换目标文件中的XML
    temp_path = output_docx + '.tmp'
    with zipfile.ZipFile(output_docx, 'r') as zin:
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.namelist():
                if item == 'word/styles.xml':
                    zout.writestr(item, template_styles)
                elif item == 'word/numbering.xml' and template_numbering:
                    zout.writestr(item, template_numbering)
                else:
                    zout.writestr(item, zin.read(item))
            # 如果目标没有numbering.xml但模板有
            if template_numbering and 'word/numbering.xml' not in zin.namelist():
                zout.writestr('word/numbering.xml', template_numbering)

    os.replace(temp_path, output_docx)
    return output_docx


def apply_style_to_paragraph(para_elem, style_id):
    """
    为段落元素设置样式ID。

    参数:
        para_elem: 段落的lxml元素 (<w:p>)
        style_id: Word样式ID字符串（如 'Heading1', '正文-缩进'）
    """
    pPr = para_elem.find(qn('w:pPr'))
    if pPr is None:
        pPr = etree.SubElement(para_elem, qn('w:pPr'))
        # 确保pPr是第一个子元素
        para_elem.insert(0, pPr)
    pStyle = pPr.find(qn('w:pStyle'))
    if pStyle is None:
        pStyle = etree.SubElement(pPr, qn('w:pStyle'))
        pPr.insert(0, pStyle)
    pStyle.set(qn('w:val'), style_id)


def clear_direct_paragraph_format(para_elem, keep_alignment=False):
    """
    清除段落的直接格式覆盖，让样式定义生效。

    参数:
        para_elem: 段落的lxml元素
        keep_alignment: 是否保留对齐设置
    """
    pPr = para_elem.find(qn('w:pPr'))
    if pPr is None:
        return

    # 需要清除的段落格式属性
    tags_to_remove = [
        qn('w:spacing'),   # 行距
        qn('w:ind'),       # 缩进
    ]
    if not keep_alignment:
        tags_to_remove.append(qn('w:jc'))  # 对齐

    for tag in tags_to_remove:
        elem = pPr.find(tag)
        if elem is not None:
            pPr.remove(elem)


def clear_direct_run_format(run_elem, clear_font=True, clear_size=True,
                            clear_bold=True, clear_italic=False):
    """
    清除run的直接字符格式覆盖。

    参数:
        run_elem: run的lxml元素 (<w:r>)
        clear_font: 是否清除字体覆盖
        clear_size: 是否清除字号覆盖
        clear_bold: 是否清除加粗覆盖
        clear_italic: 是否清除斜体覆盖
    """
    rPr = run_elem.find(qn('w:rPr'))
    if rPr is None:
        return

    if clear_size:
        for tag in [qn('w:sz'), qn('w:szCs')]:
            elem = rPr.find(tag)
            if elem is not None:
                rPr.remove(elem)

    if clear_bold:
        for tag in [qn('w:b'), qn('w:bCs')]:
            elem = rPr.find(tag)
            if elem is not None:
                rPr.remove(elem)

    if clear_italic:
        for tag in [qn('w:i'), qn('w:iCs')]:
            elem = rPr.find(tag)
            if elem is not None:
                rPr.remove(elem)

    if clear_font:
        rFonts = rPr.find(qn('w:rFonts'))
        if rFonts is not None:
            rPr.remove(rFonts)


def clear_all_direct_format_for_paragraph(para_elem, keep_alignment=False):
    """清除段落及其所有run的直接格式"""
    clear_direct_paragraph_format(para_elem, keep_alignment)
    for run in para_elem.findall(qn('w:r')):
        clear_direct_run_format(run)


def get_style_id_by_name(styles_xml_path, style_name):
    """
    根据样式名称查找样式ID。
    Word中样式有name（显示名）和styleId（内部ID），两者可能不同。
    """
    tree, root = parse_xml_file(styles_xml_path)
    for style in root.findall(qn('w:style')):
        name_elem = style.find(qn('w:name'))
        if name_elem is not None and name_elem.get(qn('w:val')) == style_name:
            return style.get(qn('w:styleId'))
    return None


def list_all_styles(styles_xml_path):
    """列出所有样式的ID和名称"""
    tree, root = parse_xml_file(styles_xml_path)
    styles = []
    for style in root.findall(qn('w:style')):
        style_id = style.get(qn('w:styleId'), '')
        name_elem = style.find(qn('w:name'))
        name = name_elem.get(qn('w:val'), '') if name_elem is not None else ''
        style_type = style.get(qn('w:type'), '')
        styles.append({
            'id': style_id,
            'name': name,
            'type': style_type
        })
    return styles


if __name__ == '__main__':
    print("style_mgr.py: 样式管理原子操作模块")
    print("函数: copy_styles_xml, apply_style_to_paragraph, clear_direct_format, ...")
