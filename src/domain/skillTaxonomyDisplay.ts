const EXACT_TAXONOMY_ZH: Record<string, string> = {
  "mcp enhancement": "MCP 增强",
  "workflow automation": "工作流自动化",
  "document and asset creation": "文档与资产创建",
  "document asset creation": "文档与资产创建",
  "natural language": "自然语言",
  "prompt chaining": "提示链式",
  "tool invocation": "工具调用",
  "workflow orchestration": "工作流编排",
  "skill invocation boundary": "技能调用边界",
  "software engineering": "软件工程",
  "data analysis": "数据分析",
  "content creation": "内容创作",
  "knowledge management": "知识管理",
  core: "核心",
  extended: "扩展",
  extreme: "极限",
  easy: "简单",
  medium: "中等",
  hard: "困难",
  agent: "代理",
  "agent hybrid": "代理混合",
  hybrid: "混合",
  scripted: "脚本型",
  resource: "资源型",
  "markdown only": "纯 Markdown",
};

const TOKEN_TAXONOMY_ZH: Record<string, string> = {
  mcp: "MCP",
  workflow: "工作流",
  automation: "自动化",
  document: "文档",
  asset: "资产",
  creation: "创建",
  natural: "自然",
  language: "语言",
  prompt: "提示",
  chaining: "链式",
  tool: "工具",
  invocation: "调用",
  orchestration: "编排",
  skill: "技能",
  boundary: "边界",
  software: "软件",
  engineering: "工程",
  data: "数据",
  analysis: "分析",
  content: "内容",
  knowledge: "知识",
  management: "管理",
  core: "核心",
  extended: "扩展",
  extreme: "极限",
  easy: "简单",
  medium: "中等",
  hard: "困难",
  agent: "代理",
  hybrid: "混合",
  scripted: "脚本",
  resource: "资源",
  markdown: "Markdown",
  only: "纯",
  and: "与",
};

const TAXONOMY_PREFIX_LABELS: Record<string, { zh: string; en: string }> = {
  "anthropic-category": {
    zh: "Anthropic 分类",
    en: "Anthropic Category",
  },
  shape: {
    zh: "形态",
    en: "Shape",
  },
  "sok-group": {
    zh: "SoK 分组",
    en: "SoK Group",
  },
  "sok-representation": {
    zh: "SoK 表示形式",
    en: "SoK Representation",
  },
  "sok-scope": {
    zh: "SoK 作用范围",
    en: "SoK Scope",
  },
  "skillsbench-domain": {
    zh: "SkillsBench 领域",
    en: "SkillsBench Domain",
  },
  "skillsbench-difficulty-core": {
    zh: "SkillsBench 难度核心",
    en: "SkillsBench Difficulty Core",
  },
  "skillsbench-difficulty-level": {
    zh: "SkillsBench 难度级别",
    en: "SkillsBench Difficulty Level",
  },
};

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function normalizeEnglishText(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function prettyEnglishToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "mcp") return "MCP";
  if (normalized === "ui") return "UI";
  if (normalized === "api") return "API";
  if (normalized === "llm") return "LLM";
  if (normalized === "sok") return "SoK";
  if (normalized === "and") return "&";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function normalizeToEnglishLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (containsCjk(trimmed)) return trimmed;
  const tokens = trimmed
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(prettyEnglishToken)
    .filter(Boolean);
  return tokens.join(" ");
}

function translateEnglishToChinese(value: string): string | null {
  const normalized = normalizeEnglishText(value);
  if (!normalized) return null;
  const exact = EXACT_TAXONOMY_ZH[normalized];
  if (exact) return exact;
  const tokens = normalized.split(" ").filter(Boolean);
  let translatedCount = 0;
  const translated = tokens.map((token) => {
    const mapped = TOKEN_TAXONOMY_ZH[token];
    if (mapped) {
      translatedCount += 1;
      return mapped;
    }
    return token;
  });
  if (translatedCount === 0) return null;
  return translated.join(" ");
}

function formatBilingualLabel(rawValue: string, preferChinese: boolean): string {
  const english = normalizeToEnglishLabel(rawValue);
  if (!english || containsCjk(english)) {
    return rawValue.trim();
  }
  const chinese = translateEnglishToChinese(english);
  if (!chinese || chinese === english) {
    return english;
  }
  return preferChinese ? `${chinese} (${english})` : `${english} (${chinese})`;
}

export function formatTaxonomyValueLabel(rawValue: string, preferChinese: boolean): string {
  return formatBilingualLabel(rawValue, preferChinese);
}

export function formatTaxonomyGroupLabel(rawValue: string, preferChinese: boolean): string {
  const trimmed = rawValue.trim();
  if (!trimmed || containsCjk(trimmed)) {
    return trimmed;
  }
  const segments = trimmed.split(/\s*[×x]\s*/).filter(Boolean);
  if (segments.length > 1) {
    return segments
      .map((segment) => formatTaxonomyValueLabel(segment, preferChinese))
      .join(" × ");
  }
  return formatTaxonomyValueLabel(trimmed, preferChinese);
}

export function formatTaxonomyTagLabel(rawTag: string, preferChinese: boolean): string {
  const trimmed = rawTag.trim();
  const matched = /^taxonomy:([^:]+):(.+)$/i.exec(trimmed);
  if (!matched) {
    return trimmed;
  }
  const taxonomyKey = matched[1].toLowerCase();
  const rawValue = matched[2];
  const labelMeta = TAXONOMY_PREFIX_LABELS[taxonomyKey];
  const prefix = labelMeta
    ? preferChinese
      ? labelMeta.zh
      : labelMeta.en
    : formatBilingualLabel(taxonomyKey, preferChinese);
  const valueLabel = formatTaxonomyValueLabel(rawValue, preferChinese);
  const separator = preferChinese ? "：" : ": ";
  return `${prefix}${separator}${valueLabel}`;
}
