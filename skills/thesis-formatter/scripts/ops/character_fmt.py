#!/usr/bin/env python3
"""
原子操作：字符格式
功能：设置字体、字号、加粗/斜体、颜色等run级别格式
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from utils import *
from lxml import etree


def set_run_font(run_elem, font_cn=None, font_en=None):
    """
    设置run的字体。

    参数:
        run_elem: run的lxml元素
        font_cn: 中文字体（如'宋体'、'黑体'）
        font_en: 西文字体（如'Times New Roman'）
    """
    rPr = run_elem.find(qn('w:rPr'))
    if rPr is None:
        rPr = etree.SubElement(run_elem, qn('w:rPr'))
        run_elem.insert(0, rPr)

    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = etree.SubElement(rPr, qn('w:rFonts'))

    if font_cn:
        rFonts.set(qn('w:eastAsia'), font_cn)
    if font_en:
        rFonts.set(qn('w:ascii'), font_en)
        rFonts.set(qn('w:hAnsi'), font_en)


def set_run_size(run_elem, size_pt=None, cn_size=None):
    """
    设置run的字号。

    参数:
        run_elem: run的lxml元素
        size_pt: 磅值（如12）
        cn_size: 中文字号名（如'小四'），优先于size_pt
    """
    rPr = run_elem.find(qn('w:rPr'))
    if rPr is None:
        rPr = etree.SubElement(run_elem, qn('w:rPr'))
        run_elem.insert(0, rPr)

    if cn_size:
        half_pt = cn_size_to_half_points(cn_size)
    elif size_pt:
        half_pt = pt_to_half_points(size_pt)
    else:
        return

    if half_pt is None:
        return

    for tag in [qn('w:sz'), qn('w:szCs')]:
        elem = rPr.find(tag)
        if elem is None:
            elem = etree.SubElement(rPr, tag)
        elem.set(qn('w:val'), str(half_pt))


def set_run_bold(run_elem, bold=True):
    """设置run加粗"""
    rPr = run_elem.find(qn('w:rPr'))
    if rPr is None:
        rPr = etree.SubElement(run_elem, qn('w:rPr'))
        run_elem.insert(0, rPr)

    for tag in [qn('w:b'), qn('w:bCs')]:
        elem = rPr.find(tag)
        if bold:
            if elem is None:
                elem = etree.SubElement(rPr, tag)
            # 不设val或val="true"都表示加粗
            elem.attrib.pop(qn('w:val'), None)
        else:
            if elem is not None:
                rPr.remove(elem)


def set_run_italic(run_elem, italic=True):
    """设置run斜体"""
    rPr = run_elem.find(qn('w:rPr'))
    if rPr is None:
        rPr = etree.SubElement(run_elem, qn('w:rPr'))
        run_elem.insert(0, rPr)

    for tag in [qn('w:i'), qn('w:iCs')]:
        elem = rPr.find(tag)
        if italic:
            if elem is None:
                etree.SubElement(rPr, tag)
        else:
            if elem is not None:
                rPr.remove(elem)


def set_run_underline(run_elem, style='single'):
    """
    设置run下划线。
    style: 'single'|'double'|'thick'|'dotted'|'none'
    """
    rPr = run_elem.find(qn('w:rPr'))
    if rPr is None:
        rPr = etree.SubElement(run_elem, qn('w:rPr'))
        run_elem.insert(0, rPr)

    u = rPr.find(qn('w:u'))
    if style == 'none':
        if u is not None:
            rPr.remove(u)
    else:
        if u is None:
            u = etree.SubElement(rPr, qn('w:u'))
        u.set(qn('w:val'), style)


def set_run_color(run_elem, color='000000'):
    """设置run字体颜色（十六进制，如'FF0000'）"""
    rPr = run_elem.find(qn('w:rPr'))
    if rPr is None:
        rPr = etree.SubElement(run_elem, qn('w:rPr'))
        run_elem.insert(0, rPr)

    c = rPr.find(qn('w:color'))
    if c is None:
        c = etree.SubElement(rPr, qn('w:color'))
    c.set(qn('w:val'), color)


def set_run_superscript(run_elem, enabled=True):
    """设置上标"""
    rPr = run_elem.find(qn('w:rPr'))
    if rPr is None:
        rPr = etree.SubElement(run_elem, qn('w:rPr'))
        run_elem.insert(0, rPr)

    vertAlign = rPr.find(qn('w:vertAlign'))
    if enabled:
        if vertAlign is None:
            vertAlign = etree.SubElement(rPr, qn('w:vertAlign'))
        vertAlign.set(qn('w:val'), 'superscript')
    else:
        if vertAlign is not None:
            rPr.remove(vertAlign)


def apply_character_format_to_run(run_elem, char_config):
    """
    根据模板配置中的character_format对象应用字符格式。

    参数:
        run_elem: run的lxml元素
        char_config: 模板中的character_format字典
    """
    if not char_config:
        return

    # 字体
    if 'font_cn' in char_config or 'font_en' in char_config:
        set_run_font(run_elem, char_config.get('font_cn'), char_config.get('font_en'))

    # 字号
    if 'font_size_cn' in char_config:
        set_run_size(run_elem, cn_size=char_config['font_size_cn'])
    elif 'font_size_pt' in char_config:
        set_run_size(run_elem, size_pt=char_config['font_size_pt'])

    # 加粗
    if 'bold' in char_config:
        set_run_bold(run_elem, char_config['bold'])

    # 斜体
    if 'italic' in char_config:
        set_run_italic(run_elem, char_config['italic'])

    # 下划线
    if 'underline' in char_config and char_config['underline']:
        set_run_underline(run_elem, char_config['underline'])

    # 颜色
    if 'color' in char_config and char_config['color']:
        set_run_color(run_elem, char_config['color'])

    # 上标
    if 'superscript' in char_config:
        set_run_superscript(run_elem, char_config['superscript'])


def apply_character_format_to_all_runs(para_elem, char_config):
    """将字符格式应用到段落的所有run"""
    for run in para_elem.findall(qn('w:r')):
        apply_character_format_to_run(run, char_config)


if __name__ == '__main__':
    print("character_fmt.py: 字符格式原子操作模块")
    print("函数: set_run_font, set_run_size, set_run_bold, ...")
