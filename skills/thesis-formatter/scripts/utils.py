#!/usr/bin/env python3
"""
公共工具函数：Word文档操作的基础设施
"""

import json
import os
import shutil
import tempfile
import zipfile
from lxml import etree

# OOXML命名空间
NS = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    'ct': 'http://schemas.openxmlformats.org/package/2006/content-types',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
}

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def qn(tag):
    """将简写标签转为完整命名空间标签。如 qn('w:sz') -> '{http://...}sz'"""
    prefix, local = tag.split(':')
    return f'{{{NS[prefix]}}}{local}'


def load_template(template_path):
    """加载预设模板JSON"""
    with open(template_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def extract_docx(docx_path, extract_dir):
    """解压docx到指定目录"""
    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir)
    with zipfile.ZipFile(docx_path, 'r') as z:
        z.extractall(extract_dir)
    return extract_dir


def repack_docx(extract_dir, output_path):
    """将解压目录重新打包为docx"""
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for root_dir, dirs, files in os.walk(extract_dir):
            for f in files:
                full_path = os.path.join(root_dir, f)
                arcname = os.path.relpath(full_path, extract_dir)
                zout.write(full_path, arcname)
    return output_path


def parse_xml_file(xml_path):
    """解析XML文件并返回tree和root"""
    tree = etree.parse(xml_path)
    return tree, tree.getroot()


def save_xml_file(tree, xml_path):
    """保存XML tree到文件"""
    tree.write(xml_path, xml_declaration=True, encoding='UTF-8', standalone=True)


def get_or_create_element(parent, tag):
    """获取或创建子元素"""
    elem = parent.find(tag, NS)
    if elem is None:
        elem = etree.SubElement(parent, tag if '{' in tag else qn(tag))
    return elem


def set_element_attr(elem, attr, value):
    """设置元素属性（自动处理命名空间）"""
    if ':' in attr and not attr.startswith('{'):
        attr = qn(attr)
    elem.set(attr, str(value))


def remove_element(parent, tag):
    """移除子元素（如果存在）"""
    elem = parent.find(tag, NS) if ':' not in tag or '{' in tag else parent.find(tag)
    if elem is not None:
        parent.remove(elem)
    return elem


# 中文字号 -> 磅值 -> half-point 对照表
CN_FONT_SIZES = {
    '初号': (42, 84),
    '小初': (36, 72),
    '一号': (26, 52),
    '小一': (24, 48),
    '二号': (22, 44),
    '小二': (18, 36),
    '三号': (16, 32),
    '小三': (15, 30),
    '四号': (14, 28),
    '小四': (12, 24),
    '五号': (10.5, 21),
    '小五': (9, 18),
    '六号': (7.5, 15),
    '小六': (6.5, 13),
    '七号': (5.5, 11),
    '八号': (5, 10),
}


def cn_size_to_half_points(cn_size):
    """中文字号转half-point值（Word内部单位）"""
    if cn_size in CN_FONT_SIZES:
        return CN_FONT_SIZES[cn_size][1]
    return None


def cn_size_to_pt(cn_size):
    """中文字号转磅值"""
    if cn_size in CN_FONT_SIZES:
        return CN_FONT_SIZES[cn_size][0]
    return None


def pt_to_half_points(pt):
    """磅值转half-point"""
    return int(pt * 2)


def cm_to_twips(cm):
    """厘米转缇（twips）"""
    return int(cm * 567)


def twips_to_cm(twips):
    """缇转厘米"""
    return round(twips / 567, 2)


def pt_to_twips(pt):
    """磅转缇"""
    return int(pt * 20)


def line_spacing_to_value(rule, value):
    """
    行距转Word内部值
    rule: 'single'|'oneAndHalf'|'double'|'exact'|'atLeast'|'multiple'
    value: 倍数（multiple时）或磅值（exact/atLeast时）
    返回: (line_value, line_rule)
    """
    if rule == 'single':
        return (240, 'auto')
    elif rule == 'oneAndHalf':
        return (360, 'auto')
    elif rule == 'double':
        return (480, 'auto')
    elif rule == 'multiple':
        return (int(value * 240), 'auto')
    elif rule == 'exact':
        return (pt_to_twips(value), 'exact')
    elif rule == 'atLeast':
        return (pt_to_twips(value), 'atLeast')
    return (240, 'auto')


def print_result(success, message):
    """统一的结果输出格式"""
    status = "OK" if success else "FAIL"
    print(f"  [{status}] {message}")
    return success
