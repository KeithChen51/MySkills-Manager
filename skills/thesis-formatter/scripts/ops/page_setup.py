#!/usr/bin/env python3
"""
原子操作：页面设置
功能：设置指定节的页边距、纸张大小、页眉页脚距离
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from utils import *


def set_page_margins(sectPr, top_cm=None, bottom_cm=None, left_cm=None, right_cm=None,
                     header_cm=None, footer_cm=None, gutter_cm=None):
    """设置节的页边距（单位：厘米）"""
    pgMar = get_or_create_element(sectPr, qn('w:pgMar'))
    if top_cm is not None:
        pgMar.set(qn('w:top'), str(cm_to_twips(top_cm)))
    if bottom_cm is not None:
        pgMar.set(qn('w:bottom'), str(cm_to_twips(bottom_cm)))
    if left_cm is not None:
        pgMar.set(qn('w:left'), str(cm_to_twips(left_cm)))
    if right_cm is not None:
        pgMar.set(qn('w:right'), str(cm_to_twips(right_cm)))
    if header_cm is not None:
        pgMar.set(qn('w:header'), str(cm_to_twips(header_cm)))
    if footer_cm is not None:
        pgMar.set(qn('w:footer'), str(cm_to_twips(footer_cm)))
    if gutter_cm is not None:
        pgMar.set(qn('w:gutter'), str(cm_to_twips(gutter_cm)))


def set_page_size(sectPr, width_cm=21.0, height_cm=29.7, orientation='portrait'):
    """设置纸张大小和方向"""
    pgSz = get_or_create_element(sectPr, qn('w:pgSz'))
    pgSz.set(qn('w:w'), str(cm_to_twips(width_cm)))
    pgSz.set(qn('w:h'), str(cm_to_twips(height_cm)))
    if orientation == 'landscape':
        pgSz.set(qn('w:orient'), 'landscape')
    else:
        # portrait时移除orient属性
        pgSz.attrib.pop(qn('w:orient'), None)


def apply_page_setup_from_template(sectPr, section_config, global_page_setup):
    """
    根据模板配置应用页面设置
    section_config: 模板中该节的配置
    global_page_setup: 模板中的全局页面设置
    """
    # 使用节级别覆盖或全局默认
    override = section_config.get('page_setup_override', {})
    margins = override.get('margins', global_page_setup.get('margins', {}))
    paper = override.get('paper_size', global_page_setup.get('paper_size', {}))

    # 纸张大小
    if paper:
        w_twips = paper.get('width_twips', cm_to_twips(21.0))
        h_twips = paper.get('height_twips', cm_to_twips(29.7))
        orient = paper.get('orientation', 'portrait')
        pgSz = get_or_create_element(sectPr, qn('w:pgSz'))
        pgSz.set(qn('w:w'), str(w_twips))
        pgSz.set(qn('w:h'), str(h_twips))
        if orient == 'landscape':
            pgSz.set(qn('w:orient'), 'landscape')

    # 页边距
    if margins:
        pgMar = get_or_create_element(sectPr, qn('w:pgMar'))
        for key in ['top', 'bottom', 'left', 'right', 'header', 'footer', 'gutter']:
            twips_key = f'{key}_twips'
            if twips_key in margins:
                pgMar.set(qn(f'w:{key}'), str(margins[twips_key]))


if __name__ == '__main__':
    print("page_setup.py: 页面设置原子操作模块")
    print("函数: set_page_margins, set_page_size, apply_page_setup_from_template")
