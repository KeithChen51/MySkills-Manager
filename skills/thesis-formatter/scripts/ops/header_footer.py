#!/usr/bin/env python3
"""
原子操作：页眉页脚
功能：设置页眉内容/边框、设置页脚页码、管理页眉页脚XML文件
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from utils import *
from lxml import etree


HEADER_XML_TEMPLATE = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
       xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
       xmlns:o="urn:schemas-microsoft-com:office:office"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
       xmlns:v="urn:schemas-microsoft-com:vml"
       xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
       xmlns:w10="urn:schemas-microsoft-com:office:word"
       xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml">
  <w:p/>
</w:hdr>'''

FOOTER_XML_TEMPLATE = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
       xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
       xmlns:o="urn:schemas-microsoft-com:office:office"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
       xmlns:v="urn:schemas-microsoft-com:vml"
       xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
       xmlns:w10="urn:schemas-microsoft-com:office:word"
       xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml">
  <w:p/>
</w:ftr>'''


def set_header_text(header_xml_path, text, font_cn='宋体', font_en='Times New Roman',
                    font_size_pt=10.5, alignment='center', style_id=None):
    """
    设置页眉的文本内容。

    参数:
        header_xml_path: header XML文件路径
        text: 页眉文本（空字符串表示清空）
        font_cn: 中文字体
        font_en: 西文字体
        font_size_pt: 字号（磅）
        alignment: 对齐方式 'left'|'center'|'right'
        style_id: 段落样式ID（如 'Header'/'ad' 等）
    """
    root = etree.fromstring(HEADER_XML_TEMPLATE.encode('utf-8'))
    p = root.find(qn('w:p'))

    # 段落属性
    pPr = etree.SubElement(p, qn('w:pPr'))
    if style_id:
        pStyle = etree.SubElement(pPr, qn('w:pStyle'))
        pStyle.set(qn('w:val'), style_id)
    jc = etree.SubElement(pPr, qn('w:jc'))
    jc.set(qn('w:val'), alignment)

    if text:
        # 添加run
        r = etree.SubElement(p, qn('w:r'))
        rPr = etree.SubElement(r, qn('w:rPr'))
        rFonts = etree.SubElement(rPr, qn('w:rFonts'))
        rFonts.set(qn('w:eastAsia'), font_cn)
        rFonts.set(qn('w:ascii'), font_en)
        rFonts.set(qn('w:hAnsi'), font_en)
        sz = etree.SubElement(rPr, qn('w:sz'))
        sz.set(qn('w:val'), str(pt_to_half_points(font_size_pt)))
        szCs = etree.SubElement(rPr, qn('w:szCs'))
        szCs.set(qn('w:val'), str(pt_to_half_points(font_size_pt)))
        t = etree.SubElement(r, qn('w:t'))
        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        t.text = text

    tree = etree.ElementTree(root)
    tree.write(header_xml_path, xml_declaration=True, encoding='UTF-8', standalone=True)


def set_header_border(header_xml_path, border_type='bottom', style='single',
                      size=6, space=1, color='000000'):
    """
    为页眉段落添加边框线。

    参数:
        header_xml_path: header XML文件路径
        border_type: 'bottom'|'top'（通常是底部横线）
        style: 'single'|'double'|'none'
        size: 线宽（half-point，6=0.75pt）
        space: 与文字间距（pt）
        color: 颜色（十六进制）
    """
    tree, root = parse_xml_file(header_xml_path)
    p = root.find(qn('w:p'))
    if p is None:
        return

    pPr = p.find(qn('w:pPr'))
    if pPr is None:
        pPr = etree.SubElement(p, qn('w:pPr'))
        p.insert(0, pPr)

    # 移除已有的pBdr
    old_bdr = pPr.find(qn('w:pBdr'))
    if old_bdr is not None:
        pPr.remove(old_bdr)

    if style != 'none':
        pBdr = etree.SubElement(pPr, qn('w:pBdr'))
        border = etree.SubElement(pBdr, qn(f'w:{border_type}'))
        border.set(qn('w:val'), style)
        border.set(qn('w:sz'), str(size))
        border.set(qn('w:space'), str(space))
        border.set(qn('w:color'), color)

    save_xml_file(tree, header_xml_path)


def remove_header_border(header_xml_path):
    """移除页眉的所有边框"""
    set_header_border(header_xml_path, style='none')


def set_empty_header(header_xml_path, style_id=None, remove_border=True):
    """
    设置空页眉（无文本、可选无边框）。
    用于封面等不需要页眉的节。
    """
    root = etree.fromstring(HEADER_XML_TEMPLATE.encode('utf-8'))
    p = root.find(qn('w:p'))
    pPr = etree.SubElement(p, qn('w:pPr'))
    if style_id:
        pStyle = etree.SubElement(pPr, qn('w:pStyle'))
        pStyle.set(qn('w:val'), style_id)
    if remove_border:
        # 显式设置无边框，覆盖样式中可能定义的边框
        pBdr = etree.SubElement(pPr, qn('w:pBdr'))
        bottom = etree.SubElement(pBdr, qn('w:bottom'))
        bottom.set(qn('w:val'), 'none')
        bottom.set(qn('w:sz'), '0')
        bottom.set(qn('w:space'), '0')
        bottom.set(qn('w:color'), 'auto')

    tree = etree.ElementTree(root)
    tree.write(header_xml_path, xml_declaration=True, encoding='UTF-8', standalone=True)


def set_footer_page_number(footer_xml_path, font_cn='宋体', font_en='Times New Roman',
                           font_size_pt=10.5, alignment='center', style_id=None):
    """
    设置页脚为居中页码。

    参数:
        footer_xml_path: footer XML文件路径
        font_size_pt: 页码字号
        alignment: 对齐方式
    """
    root = etree.fromstring(FOOTER_XML_TEMPLATE.encode('utf-8'))
    p = root.find(qn('w:p'))

    # 段落属性
    pPr = etree.SubElement(p, qn('w:pPr'))
    if style_id:
        pStyle = etree.SubElement(pPr, qn('w:pStyle'))
        pStyle.set(qn('w:val'), style_id)
    jc = etree.SubElement(pPr, qn('w:jc'))
    jc.set(qn('w:val'), alignment)

    # 域代码：PAGE
    half_pt = str(pt_to_half_points(font_size_pt))

    # fldChar begin
    r1 = etree.SubElement(p, qn('w:r'))
    rPr1 = etree.SubElement(r1, qn('w:rPr'))
    sz1 = etree.SubElement(rPr1, qn('w:sz'))
    sz1.set(qn('w:val'), half_pt)
    fld1 = etree.SubElement(r1, qn('w:fldChar'))
    fld1.set(qn('w:fldCharType'), 'begin')

    # instrText
    r2 = etree.SubElement(p, qn('w:r'))
    rPr2 = etree.SubElement(r2, qn('w:rPr'))
    sz2 = etree.SubElement(rPr2, qn('w:sz'))
    sz2.set(qn('w:val'), half_pt)
    instr = etree.SubElement(r2, qn('w:instrText'))
    instr.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    instr.text = ' PAGE  \\* MERGEFORMAT '

    # fldChar separate
    r3 = etree.SubElement(p, qn('w:r'))
    fld2 = etree.SubElement(r3, qn('w:fldChar'))
    fld2.set(qn('w:fldCharType'), 'separate')

    # 占位文本
    r4 = etree.SubElement(p, qn('w:r'))
    rPr4 = etree.SubElement(r4, qn('w:rPr'))
    sz4 = etree.SubElement(rPr4, qn('w:sz'))
    sz4.set(qn('w:val'), half_pt)
    t4 = etree.SubElement(r4, qn('w:t'))
    t4.text = '1'

    # fldChar end
    r5 = etree.SubElement(p, qn('w:r'))
    fld3 = etree.SubElement(r5, qn('w:fldChar'))
    fld3.set(qn('w:fldCharType'), 'end')

    tree = etree.ElementTree(root)
    tree.write(footer_xml_path, xml_declaration=True, encoding='UTF-8', standalone=True)


def set_empty_footer(footer_xml_path):
    """设置空页脚"""
    root = etree.fromstring(FOOTER_XML_TEMPLATE.encode('utf-8'))
    tree = etree.ElementTree(root)
    tree.write(footer_xml_path, xml_declaration=True, encoding='UTF-8', standalone=True)


def add_header_reference(sectPr, rId, ref_type='default'):
    """
    在sectPr中添加headerReference。
    ref_type: 'default'|'first'|'even'
    """
    # 移除已有的同类型引用
    for ref in sectPr.findall(qn('w:headerReference')):
        if ref.get(qn('w:type')) == ref_type:
            sectPr.remove(ref)
    href = etree.SubElement(sectPr, qn('w:headerReference'))
    href.set(qn('w:type'), ref_type)
    href.set(qn('r:id'), rId)


def add_footer_reference(sectPr, rId, ref_type='default'):
    """
    在sectPr中添加footerReference。
    ref_type: 'default'|'first'|'even'
    """
    for ref in sectPr.findall(qn('w:footerReference')):
        if ref.get(qn('w:type')) == ref_type:
            sectPr.remove(ref)
    fref = etree.SubElement(sectPr, qn('w:footerReference'))
    fref.set(qn('w:type'), ref_type)
    fref.set(qn('r:id'), rId)


if __name__ == '__main__':
    print("header_footer.py: 页眉页脚原子操作模块")
    print("函数: set_header_text, set_header_border, set_footer_page_number, ...")
