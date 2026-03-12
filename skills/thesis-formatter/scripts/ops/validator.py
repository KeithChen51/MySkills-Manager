#!/usr/bin/env python3
"""
原子操作：验证器
功能：检查格式化后的文档是否符合模板规范，生成格式报告
"""

import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from utils import *
from lxml import etree


def validate_paragraph_style(para_elem, expected_style_id):
    """检查段落是否使用了预期的样式"""
    pPr = para_elem.find(qn('w:pPr'))
    if pPr is None:
        return expected_style_id == 'Normal'
    pStyle = pPr.find(qn('w:pStyle'))
    if pStyle is None:
        return expected_style_id == 'Normal'
    return pStyle.get(qn('w:val')) == expected_style_id


def validate_font_size(run_elem, expected_half_pt):
    """检查run的字号是否正确"""
    rPr = run_elem.find(qn('w:rPr'))
    if rPr is None:
        return False
    sz = rPr.find(qn('w:sz'))
    if sz is None:
        return False  # 依赖样式定义，无法直接验证
    return sz.get(qn('w:val')) == str(expected_half_pt)


def validate_page_margins(sectPr, expected_margins):
    """
    检查节的页边距是否符合预期。
    expected_margins: dict with keys like 'left_twips', 'right_twips', etc.
    返回: (pass, details_dict)
    """
    pgMar = sectPr.find(qn('w:pgMar'))
    if pgMar is None:
        return False, {'error': 'pgMar not found'}

    results = {}
    all_pass = True
    for key in ['top', 'bottom', 'left', 'right', 'header', 'footer']:
        twips_key = f'{key}_twips'
        if twips_key in expected_margins:
            actual = int(pgMar.get(qn(f'w:{key}'), '0'))
            expected = expected_margins[twips_key]
            match = abs(actual - expected) <= 5  # 允许5缇误差
            results[key] = {
                'expected_twips': expected,
                'actual_twips': actual,
                'expected_cm': twips_to_cm(expected),
                'actual_cm': twips_to_cm(actual),
                'pass': match
            }
            if not match:
                all_pass = False

    return all_pass, results


def validate_section_page_number(sectPr, expected_fmt, expected_start=None):
    """检查节的页码格式"""
    pgNumType = sectPr.find(qn('w:pgNumType'))
    if pgNumType is None:
        return expected_fmt == 'decimal' and expected_start is None

    actual_fmt = pgNumType.get(qn('w:fmt'), 'decimal')
    fmt_match = actual_fmt == expected_fmt

    if expected_start is not None:
        actual_start = pgNumType.get(qn('w:start'))
        start_match = actual_start == str(expected_start)
    else:
        start_match = True

    return fmt_match and start_match


def generate_format_report(document_xml_path, template_config, roles_map=None):
    """
    生成完整的格式检查报告。

    参数:
        document_xml_path: document.xml路径
        template_config: 模板JSON配置
        roles_map: {段落索引: 语义角色} 映射

    返回: 报告字典
    """
    tree, root = parse_xml_file(document_xml_path)
    body = root.find(qn('w:body'))
    paragraphs = body.findall(qn('w:p'))

    report = {
        'total_paragraphs': len(paragraphs),
        'checks': [],
        'summary': {
            'total': 0,
            'passed': 0,
            'failed': 0,
            'warnings': 0
        }
    }

    # 检查节设置
    sections_config = template_config.get('sections', [])
    from ops.section_mgr import get_all_sectPrs
    # 注意：这里需要传入document.xml路径
    # 简化版：只检查body级别的sectPr
    body_sectPr = body.find(qn('w:sectPr'))
    if body_sectPr is not None:
        check = {
            'type': 'section',
            'description': '最后一节的sectPr存在',
            'pass': True
        }
        report['checks'].append(check)
        report['summary']['total'] += 1
        report['summary']['passed'] += 1

    # 检查段落样式分配
    if roles_map:
        style_checks = 0
        style_pass = 0
        for idx, role in roles_map.items():
            if idx < len(paragraphs):
                para = paragraphs[idx]
                pPr = para.find(qn('w:pPr'))
                pStyle = pPr.find(qn('w:pStyle')) if pPr is not None else None
                has_style = pStyle is not None and pStyle.get(qn('w:val')) != 'Normal'
                if role not in ['blank', 'unknown', 'body_blank']:
                    style_checks += 1
                    if has_style or role in ['body_text']:
                        style_pass += 1

        report['checks'].append({
            'type': 'styles',
            'description': f'段落样式分配: {style_pass}/{style_checks}',
            'pass': style_pass == style_checks
        })
        report['summary']['total'] += 1
        if style_pass == style_checks:
            report['summary']['passed'] += 1
        else:
            report['summary']['failed'] += 1

    return report


def print_report(report):
    """打印格式化的检查报告"""
    print("\n" + "=" * 60)
    print("格式检查报告")
    print("=" * 60)
    print(f"总段落数: {report['total_paragraphs']}")
    print(f"\n检查项: {report['summary']['total']}")
    print(f"  通过: {report['summary']['passed']}")
    print(f"  失败: {report['summary']['failed']}")
    print(f"  警告: {report['summary']['warnings']}")

    print("\n详细结果:")
    for check in report['checks']:
        status = "PASS" if check['pass'] else "FAIL"
        print(f"  [{status}] {check['description']}")

    print("=" * 60)


if __name__ == '__main__':
    print("validator.py: 验证器原子操作模块")
    print("函数: validate_paragraph_style, validate_page_margins, generate_format_report")
