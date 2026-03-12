---
name: thesis-formatter
description: Format academic theses/dissertations in Word (.docx) to match university-specific templates. Use when users need to apply formatting standards (fonts, headings, margins, headers/footers, page numbers, captions, bibliography) to thesis documents. Supports Chinese university thesis formats. Triggers on thesis formatting, paper formatting, 论文格式, 格式规范, 毕业论文排版.
---

# Thesis Formatter

Format Word thesis documents to match university-specific templates using a three-layer architecture: AI orchestration, atomic operation scripts, and preset template definitions.

## Architecture Overview

| Layer | Role | Location |
|-------|------|----------|
| AI Orchestration | Understand thesis structure, diagnose format gaps, dispatch operations | This SKILL.md |
| Atomic Operations | Parameterized scripts for each Word format operation | `scripts/ops/*.py` |
| Preset Templates | University-specific format specifications in JSON | `templates/*.json` |

## Workflow

Formatting a thesis involves these steps:

1. **Load template** — Read the preset JSON template for the target university
2. **Analyze source document** — Extract and read the user's Word file via OOXML
3. **Identify paragraph roles** — Use AI to classify each paragraph's semantic role (heading, body, caption, etc.)
4. **Generate fix plan** — Compare current formatting against template specs
5. **Execute fixes** — Run atomic operations in the correct order
6. **Validate output** — Check the result and generate a format report

## Step 1: Load Template

Read the template JSON from `templates/`:

```
templates/xiamen_university_mba.json  — 厦门大学MBA
```

If no matching template exists, create one by:
- Reading the user's university format guide (Word/PDF)
- Extracting format specs into the JSON schema defined in `references/`
- Saving to `templates/` for reuse

Key template sections: `meta`, `page_setup`, `sections`, `styles`, `heading_numbering`, `semantic_roles`, `style_role_mapping`.

## Step 2: Analyze Source Document

```python
from scripts.utils import extract_docx, parse_xml_file, qn
extract_docx('input.docx', './work_dir')
tree, root = parse_xml_file('./work_dir/word/document.xml')
body = root.find(qn('w:body'))
paragraphs = body.findall(qn('w:p'))
```

For each paragraph, extract: text content, current style, font/size overrides, spacing, indentation.

## Step 3: Identify Paragraph Roles

Use AI to classify each paragraph into a semantic role from the template's `semantic_roles` list. The template provides `heading_numbering.patterns` with regex patterns to assist identification:

| Role | Detection Hints |
|------|----------------|
| `heading1` | Matches `^[一二三四五六七八九十]+[、．]` |
| `heading2` | Matches `^（[一二三四五六七八九十]+）` |
| `heading3` | Matches `^\d+[\.\．]` |
| `body_text` | Normal paragraphs with substantial text |
| `figure_caption` | Contains "图" + number pattern |
| `table_caption` | Contains "表" + number pattern |
| `abstract_zh_title` | Contains "摘要" or "摘 要" |
| `keywords_zh` | Starts with "关键词" |
| `reference_entry` | Starts with `[数字]` |
| `blank` | Empty or whitespace only |

Output: a mapping `{paragraph_index: role_id}`.

## Step 4: Generate Fix Plan

Compare each paragraph's current format against the template's `style_role_mapping` and `styles` definitions. The fix plan is a list of operations to execute.

## Step 5: Execute Fixes

**CRITICAL: Execute in this exact order to avoid conflicts.**

### 5.1 Copy Template Styles

```python
from scripts.ops.style_mgr import copy_styles_xml
copy_styles_xml('template.docx', 'work.docx', also_copy_numbering=False)
```

Set `also_copy_numbering=False` to avoid unwanted heading number prefixes. Only copy numbering if the template's numbering definitions are confirmed correct.

### 5.2 Set Section Structure

Use `scripts/ops/section_mgr.py` to insert section breaks at the boundaries identified in Step 3 (e.g., between cover and declaration, between abstract and body).

```python
from scripts.ops.section_mgr import insert_section_break, set_section_type, set_title_page
```

Refer to template `sections` array for section types (`nextPage`, `oddPage`, `continuous`).

### 5.3 Set Page Layout

```python
from scripts.ops.page_setup import set_page_margins, set_paper_size
```

Apply per-section margins from template. Cover sections often have different margins than body sections.

### 5.4 Apply Paragraph Styles

```python
from scripts.ops.style_mgr import apply_style_to_paragraph, clear_all_direct_format_for_paragraph
```

For each paragraph, use `style_role_mapping` to find the correct Word style ID, then:
1. Apply the style via `apply_style_to_paragraph()`
2. Clear direct formatting via `clear_all_direct_format_for_paragraph()`

**Key insight**: Direct formatting (manually set fonts/sizes) overrides styles. Always clear it after applying styles.

### 5.5 Set Headers and Footers

```python
from scripts.ops.header_footer import (
    set_header_text, set_header_border, set_empty_header,
    set_footer_page_number, set_empty_footer
)
```

Per-section header/footer setup from template `sections[].header` and `sections[].footer`:
- Cover: empty header (no border), no page number
- Front matter: header text + border, Roman numeral page numbers
- Body: chapter title header + border, Arabic page numbers

**Common pitfall**: Empty headers still show border lines from the Header paragraph style. Always use `set_empty_header(remove_border=True)`.

### 5.6 Handle Special Elements

For figure/table captions, footnotes, bibliography entries — apply format from the corresponding template `styles` section using `character_fmt.py` and `paragraph_fmt.py`.

### 5.7 Repack Document

```python
from scripts.utils import repack_docx
repack_docx('./work_dir', 'output.docx')
```

## Step 6: Validate

Use `scripts/ops/validator.py` to check key format properties. Also visually inspect the output by viewing the docx file.

## Reference Files

Read these as needed:

| File | When to Read |
|------|-------------|
| `references/ooxml_guide.md` | When working with raw XML or debugging format issues |
| `references/chinese_font_sizes.md` | When converting between Chinese font size names and pt/half-point values |
| `references/troubleshooting.md` | When encountering header borders, style conflicts, or page number issues |

## Script Reference

All scripts in `scripts/ops/`:

| Script | Key Functions |
|--------|--------------|
| `page_setup.py` | `set_page_margins()`, `set_paper_size()` |
| `section_mgr.py` | `insert_section_break()`, `set_section_type()`, `set_title_page()`, `set_page_number_format()` |
| `style_mgr.py` | `copy_styles_xml()`, `apply_style_to_paragraph()`, `clear_direct_format()` |
| `header_footer.py` | `set_header_text()`, `set_header_border()`, `set_empty_header()`, `set_footer_page_number()` |
| `paragraph_fmt.py` | `set_line_spacing()`, `set_first_line_indent()`, `set_alignment()`, `set_paragraph_spacing()` |
| `character_fmt.py` | `set_run_font()`, `set_run_size()`, `set_run_bold()`, `apply_character_format_to_all_runs()` |
| `validator.py` | `validate_page_margins()`, `generate_format_report()` |

Utility: `scripts/utils.py` — `extract_docx()`, `repack_docx()`, `parse_xml_file()`, `qn()`, unit conversion functions.

## Creating New Templates

To add a new university template:

1. Obtain the university's format specification document (Word or PDF)
2. Analyze it to extract all format dimensions (page setup, styles, headers/footers, numbering)
3. Create a JSON file following the schema in existing templates
4. Key sections to define: `meta`, `page_setup`, `sections` (with header/footer per section), `styles` (all semantic roles), `heading_numbering`, `style_role_mapping`
5. Save to `templates/{university}_{program}.json`
6. Test with a sample thesis document
