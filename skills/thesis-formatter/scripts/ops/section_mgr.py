#!/usr/bin/env python3
"""
原子操作：节管理
功能：获取节信息、设置节类型、设置titlePg、插入分节符
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from utils import *


def get_all_sectPrs(document_xml_path):
    """获取document.xml中所有sectPr元素，返回列表"""
    tree, root = parse_xml_file(document_xml_path)
    body = root.find(qn('w:body'))
    sectPrs = []
    # 段落级别的sectPr（节分隔符）
    for pPr in body.findall(f'.//{qn("w:pPr")}'):
        sp = pPr.find(qn('w:sectPr'))
        if sp is not None:
            sectPrs.append(sp)
    # body级别的最后一个sectPr
    body_sectPr = body.find(qn('w:sectPr'))
    if body_sectPr is not None:
        sectPrs.append(body_sectPr)
    return tree, sectPrs


def set_section_type(sectPr, section_type='nextPage'):
    """
    设置节的起始方式
    section_type: 'nextPage'|'evenPage'|'oddPage'|'continuous'
    """
    stype = get_or_create_element(sectPr, qn('w:type'))
    stype.set(qn('w:val'), section_type)


def set_title_page(sectPr, enabled=True):
    """设置该节是否启用首页不同（titlePg）"""
    if enabled:
        tp = get_or_create_element(sectPr, qn('w:titlePg'))
        # titlePg存在即表示启用，无需设置val
    else:
        remove_element(sectPr, qn('w:titlePg'))


def set_page_number_format(sectPr, fmt='decimal', start=None):
    """
    设置页码格式
    fmt: 'decimal'|'upperRoman'|'lowerRoman'|'upperLetter'|'lowerLetter'
    start: 起始页码（整数），None表示不设置
    """
    pgNumType = get_or_create_element(sectPr, qn('w:pgNumType'))
    pgNumType.set(qn('w:fmt'), fmt)
    if start is not None:
        pgNumType.set(qn('w:start'), str(start))
    else:
        pgNumType.attrib.pop(qn('w:start'), None)


def get_section_info(sectPr):
    """获取节的基本信息，返回字典"""
    info = {}
    # 节类型
    stype = sectPr.find(qn('w:type'))
    info['type'] = stype.get(qn('w:val')) if stype is not None else 'nextPage'
    # titlePg
    info['title_page'] = sectPr.find(qn('w:titlePg')) is not None
    # 页码格式
    pgNumType = sectPr.find(qn('w:pgNumType'))
    if pgNumType is not None:
        info['page_num_fmt'] = pgNumType.get(qn('w:fmt'), 'decimal')
        start = pgNumType.get(qn('w:start'))
        info['page_num_start'] = int(start) if start else None
    # 页边距
    pgMar = sectPr.find(qn('w:pgMar'))
    if pgMar is not None:
        info['margins'] = {
            'top': twips_to_cm(int(pgMar.get(qn('w:top'), '0'))),
            'bottom': twips_to_cm(int(pgMar.get(qn('w:bottom'), '0'))),
            'left': twips_to_cm(int(pgMar.get(qn('w:left'), '0'))),
            'right': twips_to_cm(int(pgMar.get(qn('w:right'), '0'))),
        }
    # header/footer引用
    info['headers'] = []
    info['footers'] = []
    for ref in sectPr.findall(qn('w:headerReference')):
        info['headers'].append({
            'type': ref.get(qn('w:type')),
            'rId': ref.get(qn('r:id'))
        })
    for ref in sectPr.findall(qn('w:footerReference')):
        info['footers'].append({
            'type': ref.get(qn('w:type')),
            'rId': ref.get(qn('r:id'))
        })
    return info


def apply_section_config(sectPr, section_config):
    """根据模板配置应用节设置"""
    # 节类型
    if 'section_type' in section_config:
        set_section_type(sectPr, section_config['section_type'])
    # titlePg
    if 'title_page' in section_config:
        set_title_page(sectPr, section_config['title_page'])
    # 页码
    pn = section_config.get('page_number', {})
    if pn:
        fmt = pn.get('format', 'decimal')
        start = pn.get('start')
        set_page_number_format(sectPr, fmt, start)


if __name__ == '__main__':
    print("section_mgr.py: 节管理原子操作模块")
    print("函数: get_all_sectPrs, set_section_type, set_title_page, set_page_number_format")
