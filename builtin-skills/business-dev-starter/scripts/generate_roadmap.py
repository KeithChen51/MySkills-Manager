#!/usr/bin/env python3
"""
路线图生成器 - 根据用户诊断结果生成个性化HTML路线图

用法:
    python3.11 generate_roadmap.py \
        --answers '{"q1_scenario":"aftersales","q2_output":"webapp","q3_tech_level":"prompt","q4_system_relation":"standalone","q5_constraint":"team"}' \
        --pathway '01_webapp_dev.md' \
        --cases '["webapp_01_service_dashboard.md"]'

输入:
    --answers: 用户回答的JSON字符串
    --pathway: 匹配到的路径文件名
    --cases: 匹配到的案例文件名列表（JSON数组字符串）

输出:
    在当前目录生成 roadmap_YYYYMMDD.html 文件
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Skill根目录（脚本所在目录的上一级）
SKILL_DIR = Path(__file__).parent.parent
REFERENCES_DIR = SKILL_DIR / "references"
TEMPLATES_DIR = SKILL_DIR / "templates"

# 问题ID到中文标签的映射
QUESTION_LABELS = {
    "q1_scenario": "业务领域",
    "q2_output": "产出形态",
    "q3_tech_level": "技术水平",
    "q4_system_relation": "系统关系",
    "q5_constraint": "组织约束"
}

# 选项值到中文标签的映射
OPTION_LABELS = {
    # q1_scenario
    "aftersales": "售后服务",
    "crm": "客户关系",
    "inventory": "配件与库存管理",
    "marketing": "营销与活动管理",
    "internal": "内部管理与效率提升",
    "other": "其他",
    # q2_output
    "webapp": "独立Web应用",
    "plugin": "浏览器插件",
    "script": "自动化脚本",
    "demo": "Demo转PRD",
    "unsure": "待确定",
    # q3_tech_level
    "zero": "零基础（会使用AI对话工具）",
    "prompt": "有Prompt工程经验",
    "basic_code": "有一定编程基础",
    "advanced": "编程能力较强",
    # q4_system_relation
    "standalone": "完全独立的新工具",
    "read_data": "需要从现有系统读取数据",
    "enhance": "嵌入或增强现有系统",
    "replace": "对现有功能的改进/替代",
    # q5_constraint
    "personal": "个人使用，无需正式部署",
    "team": "团队内部使用",
    "formal": "需要正式上线部署",
    "production": "需要接入生产数据"
}

# 路径文件名到标题的映射
PATHWAY_TITLES = {
    "01_webapp_dev.md": "独立Web应用开发",
    "02_plugin_dev.md": "浏览器插件增强",
    "03_automation_script.md": "自动化脚本开发",
    "04_demo_to_prd.md": "Demo转PRD交付"
}


def read_file_content(filepath: Path) -> str:
    """读取文件内容，如果文件不存在则返回提示信息"""
    if filepath.exists():
        return filepath.read_text(encoding="utf-8")
    return f"（文件 {filepath.name} 尚未创建，请补充内容后重新生成路线图）"


def markdown_to_html_simple(md_text: str) -> str:
    """简单的Markdown转HTML（处理标题、列表、表格、加粗等基本语法）"""
    try:
        import markdown
        return markdown.markdown(
            md_text,
            extensions=["tables", "fenced_code", "nl2br"]
        )
    except ImportError:
        # 如果没有markdown库，做最基本的转换
        lines = md_text.split("\n")
        html_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("# "):
                html_lines.append(f"<h2>{stripped[2:]}</h2>")
            elif stripped.startswith("## "):
                html_lines.append(f"<h3>{stripped[3:]}</h3>")
            elif stripped.startswith("### "):
                html_lines.append(f"<h4>{stripped[4:]}</h4>")
            elif stripped.startswith("- "):
                html_lines.append(f"<li>{stripped[2:]}</li>")
            elif stripped == "":
                html_lines.append("<br>")
            else:
                html_lines.append(f"<p>{stripped}</p>")
        return "\n".join(html_lines)


def generate_roadmap(answers: dict, pathway: str, cases: list) -> str:
    """生成路线图HTML内容"""

    # 读取HTML模板
    template_path = TEMPLATES_DIR / "roadmap_template.html"
    if not template_path.exists():
        print(f"错误：模板文件不存在: {template_path}", file=sys.stderr)
        sys.exit(1)

    template = template_path.read_text(encoding="utf-8")

    # 构建用户画像HTML
    profile_rows = ""
    for qid, label in QUESTION_LABELS.items():
        value = answers.get(qid, "未回答")
        display_value = OPTION_LABELS.get(value, value)
        profile_rows += f"<tr><td>{label}</td><td>{display_value}</td></tr>\n"

    # 读取路径指南内容
    pathway_path = REFERENCES_DIR / "pathways" / pathway
    pathway_content = read_file_content(pathway_path)
    pathway_html = markdown_to_html_simple(pathway_content)
    pathway_title = PATHWAY_TITLES.get(pathway, pathway)

    # 读取案例内容
    cases_html = ""
    if cases:
        for case_file in cases:
            case_path = REFERENCES_DIR / "cases" / case_file
            case_content = read_file_content(case_path)
            case_html = markdown_to_html_simple(case_content)
            cases_html += f'<div class="case-card">{case_html}</div>\n'
    else:
        cases_html = '<p class="empty-note">暂无匹配的案例。随着案例库的不断扩充，未来会有更多参考。</p>'

    # 生成日期
    today = datetime.now().strftime("%Y年%m月%d日")

    # 填充模板
    html = template
    html = html.replace("{{date}}", today)
    html = html.replace("{{profile_rows}}", profile_rows)
    html = html.replace("{{pathway_title}}", pathway_title)
    html = html.replace("{{pathway_content}}", pathway_html)
    html = html.replace("{{cases_content}}", cases_html)

    return html


def main():
    parser = argparse.ArgumentParser(description="生成个性化开发路线图")
    parser.add_argument("--answers", required=True, help="用户回答的JSON字符串")
    parser.add_argument("--pathway", required=True, help="匹配到的路径文件名")
    parser.add_argument("--cases", required=True, help="匹配到的案例文件名列表（JSON数组）")

    args = parser.parse_args()

    # 解析参数
    try:
        answers = json.loads(args.answers)
    except json.JSONDecodeError as e:
        print(f"错误：answers参数不是有效的JSON: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        cases = json.loads(args.cases)
    except json.JSONDecodeError as e:
        print(f"错误：cases参数不是有效的JSON: {e}", file=sys.stderr)
        sys.exit(1)

    # 生成路线图
    html_content = generate_roadmap(answers, args.pathway, cases)

    # 写入文件
    output_filename = f"roadmap_{datetime.now().strftime('%Y%m%d')}.html"
    output_path = Path.cwd() / output_filename

    output_path.write_text(html_content, encoding="utf-8")
    print(f"路线图已生成: {output_path}")


if __name__ == "__main__":
    main()
