#!/usr/bin/env python3
"""
原子操作：段落格式
功能：设置行距、缩进、对齐、段前段后间距
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from utils import *
from lxml import etree


def set_line_spacing(para_elem, rule='oneAndHalf', value=None):
    """
    设置段落行距。

    参数:
        para_elem: 段落lxml元素
        rule: 'single'|'oneAndHalf'|'double'|'exact'|'atLeast'|'multiple'
        value: multiple时为倍数（如1.25），exact/atLeast时为磅值
    """
    pPr = para_elem.find(qn('w:pPr'))
    if pPr is None:
        pPr = etree.SubElement(para_elem, qn('w:pPr'))
        para_elem.insert(0, pPr)

    spacing = pPr.find(qn('w:spacing'))
    if spacing is None:
        spacing = etree.SubElement(pPr, qn('w:spacing'))

    line_val, line_rule = line_spacing_to_value(rule, value)
    spacing.set(qn('w:line'), str(line_val))
    spacing.set(qn('w:lineRule'), line_rule)


def set_paragraph_spacing(para_elem, before_pt=None, after_pt=None):
    """
    设置段前段后间距。

    参数:
        para_elem: 段落lxml元素
        before_pt: 段前间距（磅），None不设置
        after_pt: 段后间距（磅），None不设置
    """
    pPr = para_elem.find(qn('w:pPr'))
    if pPr is None:
        pPr = etree.SubElement(para_elem, qn('w:pPr'))
        para_elem.insert(0, pPr)

    spacing = pPr.find(qn('w:spacing'))
    if spacing is None:
        spacing = etree.SubElement(pPr, qn('w:spacing'))

    if before_pt is not None:
        spacing.set(qn('w:before'), str(pt_to_twips(before_pt)))
    if after_pt is not None:
        spacing.set(qn('w:after'), str(pt_to_twips(after_pt)))


def set_first_line_indent(para_elem, chars=2, twips=None):
    """
    设置首行缩进。

    参数:
        para_elem: 段落lxml元素
        chars: 缩进字符数（如2表示两个中文字符宽度）
        twips: 直接指定缇值（优先于chars）
    """
    pPr = para_elem.find(qn('w:pPr'))
    if pPr is None:
        pPr = etree.SubElement(para_elem, qn('w:pPr'))
        para_elem.insert(0, pPr)

    ind = pPr.find(qn('w:ind'))
    if ind is None:
        ind = etree.SubElement(pPr, qn('w:ind'))

    if twips is not None:
        ind.set(qn('w:firstLine'), str(twips))
        ind.attrib.pop(qn('w:firstLineChars'), None)
    else:
        ind.set(qn('w:firstLineChars'), str(int(chars * 100)))
        ind.set(qn('w:firstLine'), str(int(chars * 240)))

    # 清除可能冲突的悬挂缩进
    ind.attrib.pop(qn('w:hanging'), None)
    ind.attrib.pop(qn('w:hangingChars'), None)


def set_hanging_indent(para_elem, chars=None, twips=None):
    """设置悬挂缩进（用于参考文献等）"""
    pPr = para_elem.find(qn('w:pPr'))
    if pPr is None:
        pPr = etree.SubElement(para_elem, qn('w:pPr'))
        para_elem.insert(0, pPr)

    ind = pPr.find(qn('w:ind'))
    if ind is None:
        ind = etree.SubElement(pPr, qn('w:ind'))

    if twips is not None:
        ind.set(qn('w:hanging'), str(twips))
    elif chars is not None:
        ind.set(qn('w:hangingChars'), str(int(chars * 100)))
        ind.set(qn('w:hanging'), str(int(chars * 240)))

    # 清除首行缩进
    ind.attrib.pop(qn('w:firstLine'), None)
    ind.attrib.pop(qn('w:firstLineChars'), None)


def set_left_indent(para_elem, twips=None, cm=None):
    """设置左缩进"""
    pPr = para_elem.find(qn('w:pPr'))
    if pPr is None:
        pPr = etree.SubElement(para_elem, qn('w:pPr'))
        para_elem.insert(0, pPr)

    ind = pPr.find(qn('w:ind'))
    if ind is None:
        ind = etree.SubElement(pPr, qn('w:ind'))

    val = twips if twips is not None else cm_to_twips(cm) if cm is not None else 0
    ind.set(qn('w:left'), str(val))


def set_alignment(para_elem, alignment='justify'):
    """
    设置段落对齐方式。

    参数:
        alignment: 'left'|'center'|'right'|'justify'|'both'
    """
    pPr = para_elem.find(qn('w:pPr'))
    if pPr is None:
        pPr = etree.SubElement(para_elem, qn('w:pPr'))
        para_elem.insert(0, pPr)

    jc = pPr.find(qn('w:jc'))
    if jc is None:
        jc = etree.SubElement(pPr, qn('w:jc'))
    jc.set(qn('w:val'), alignment)


def apply_paragraph_format_from_config(para_elem, fmt_config):
    """
    根据模板配置中的paragraph_format对象应用段落格式。

    参数:
        para_elem: 段落lxml元素
        fmt_config: 模板中的paragraph_format字典
    """
    if not fmt_config:
        return

    # 对齐
    if 'alignment' in fmt_config:
        set_alignment(para_elem, fmt_config['alignment'])

    # 行距
    ls = fmt_config.get('line_spacing')
    if ls:
        set_line_spacing(para_elem, ls.get('rule', 'single'), ls.get('value'))

    # 段前段后
    if 'space_before_pt' in fmt_config or 'space_after_pt' in fmt_config:
        set_paragraph_spacing(
            para_elem,
            before_pt=fmt_config.get('space_before_pt'),
            after_pt=fmt_config.get('space_after_pt')
        )

    # 首行缩进
    if 'first_line_indent_chars' in fmt_config:
        set_first_line_indent(para_elem, chars=fmt_config['first_line_indent_chars'])
    elif 'first_line_indent_twips' in fmt_config:
        set_first_line_indent(para_elem, twips=fmt_config['first_line_indent_twips'])


if __name__ == '__main__':
    print("paragraph_fmt.py: 段落格式原子操作模块")
    print("函数: set_line_spacing, set_first_line_indent, set_alignment, ...")
