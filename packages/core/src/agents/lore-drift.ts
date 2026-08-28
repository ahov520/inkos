/**
 * Deterministic lore-drift detection — zero LLM cost, offline-friendly.
 *
 * Ported and adapted from NovelWriter's continuation postcheck
 * (https://github.com/Hurricane0698/novelwriter, AGPL-3.0):
 * scan generated chapter text for signals of NEWLY INVENTED proper nouns
 * (quoted terms, bracketed terms, naming cues, dialogue address tokens) and
 * flag any term that does not appear in the known-world sources (truth files,
 * recent chapters, user-provided context).
 *
 * The LLM-based ContinuityAuditor catches semantic contradictions; this module
 * is a cheap deterministic pre-filter that catches "the model just made up a
 * sect / artifact / person name" — the most common long-run drift failure.
 *
 * Pure functions, no dependencies, no I/O: safe to run on-device (Android).
 */

import type { PostWriteViolation } from "./post-write-validator.js";

export type LoreDriftCode =
  | "unknown_term_quoted"
  | "unknown_term_bracketed"
  | "unknown_term_named"
  | "unknown_address_token";

export interface LoreDriftWarning {
  readonly code: LoreDriftCode;
  /** The suspicious term extracted from generated text. */
  readonly term: string;
  /** Text snippet around the first occurrence, for review UI. */
  readonly evidence: string;
}

export interface DetectLoreDriftInput {
  /** Generated chapter content to scan. */
  readonly content: string;
  /**
   * Known-world corpus: truth files, outline, recent chapters, user
   * instructions. A term found in ANY source is considered known.
   */
  readonly knownSources: ReadonlyArray<string | undefined | null>;
  readonly language?: "zh" | "en";
  /** Cap the number of warnings to keep review panels readable. */
  readonly maxWarnings?: number;
}

const DEFAULT_MAX_WARNINGS = 10;

const CJK = "\\u4e00-\\u9fff";

// --- Chinese extraction patterns ---

/** 《X》 book-title quotes — new technique/book/artifact names. */
const RE_ZH_BOOK_QUOTES = new RegExp(`《([${CJK}]{2,20})》`, "g");
/** 【X】 lenticular brackets — new system/skill/item names. */
const RE_ZH_BRACKETS = new RegExp(`【([${CJK}]{2,20})】`, "g");
/** ‘X’ single smart quotes — emphasized new terms. */
const RE_ZH_SINGLE_QUOTES = new RegExp(`\u2018([${CJK}]{2,20})\u2019`, "g");
/** Naming cues: 名为X / 称为X / 唤作X … */
const RE_ZH_NAMING_CUE = new RegExp(
  `(?:名为|称为|其名|名曰|号称|被称为|唤作|唤为)[\u201c\u0022\u300a\u3010\u2018]?([${CJK}]{2,20})[\u201d\u0022\u300b\u3011\u2019]?`,
  "g",
);
/** Dialogue address: “XX！ / “XX， — a character being addressed by name. */
const RE_ZH_DIALOGUE_ADDRESS = new RegExp(`\u201c([${CJK}]{2,6})[！!，,：:]`, "g");

const ZH_ADDRESS_STOPWORDS = new Set([
  "太好了", "好了", "快点", "等等", "别怕", "不必", "住手",
  "不好", "小心", "走吧", "来人", "什么", "可恶", "混账",
  "多谢", "遵命", "属下", "弟子", "前辈", "先生", "大人",
]);

// --- English extraction patterns ---

/** Quoted capitalized terms: “Ember Court” / "Hollow King". */
const RE_EN_QUOTED_TERMS = /[\u201c"]((?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*))[\u201d"]/g;
/** Naming cues: named X / called X / known as X … */
const RE_EN_NAMING_CUE =
  /(?:named|called|known as|dubbed|titled|christened)\s+["\u201c']?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)["\u201d']?/g;
/** Dialogue address: “John!” / "John," at the start of speech. */
const RE_EN_DIALOGUE_ADDRESS = /[\u201c"]([A-Z][a-z]+)[!,:]/g;

const EN_ADDRESS_STOPWORDS = new Set([
  "Well", "Look", "Listen", "Wait", "Stop", "Come", "Help",
  "Please", "Thanks", "Hello", "Hey", "Yes", "Yeah", "Okay",
  "Sure", "Right", "Fine", "Good", "Great", "God", "Dear",
  "Damn", "Wow", "Hmm", "Huh", "Shh", "Hush", "Alas",
  "Oh", "No", "Ah", "Now", "There", "Here", "Easy", "Careful",
]);

interface TermMatch {
  readonly code: LoreDriftCode;
  readonly term: string;
  readonly start: number;
  readonly end: number;
}

function collectMatches(
  text: string,
  regex: RegExp,
  code: LoreDriftCode,
  stopwords?: ReadonlySet<string>,
): TermMatch[] {
  const out: TermMatch[] = [];
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const term = (m[1] ?? "").trim();
    if (!term) continue;
    if (stopwords?.has(term)) continue;
    const start = m.index + m[0].indexOf(m[1]!);
    out.push({ code, term, start, end: start + m[1]!.length });
  }
  return out;
}

function extractZhMatches(text: string): TermMatch[] {
  return [
    ...collectMatches(text, RE_ZH_BOOK_QUOTES, "unknown_term_quoted"),
    ...collectMatches(text, RE_ZH_SINGLE_QUOTES, "unknown_term_quoted"),
    ...collectMatches(text, RE_ZH_BRACKETS, "unknown_term_bracketed"),
    ...collectMatches(text, RE_ZH_NAMING_CUE, "unknown_term_named"),
    ...collectMatches(text, RE_ZH_DIALOGUE_ADDRESS, "unknown_address_token", ZH_ADDRESS_STOPWORDS),
  ];
}

function extractEnMatches(text: string): TermMatch[] {
  return [
    ...collectMatches(text, RE_EN_QUOTED_TERMS, "unknown_term_quoted"),
    ...collectMatches(text, RE_EN_NAMING_CUE, "unknown_term_named"),
    ...collectMatches(text, RE_EN_DIALOGUE_ADDRESS, "unknown_address_token", EN_ADDRESS_STOPWORDS),
  ];
}

/** Extract candidate new-term matches from generated text. Exported for testing. */
export function extractNewTermCandidates(
  text: string,
  language: "zh" | "en" = "zh",
): ReadonlyArray<{ code: LoreDriftCode; term: string }> {
  const matches = language === "en" ? extractEnMatches(text) : extractZhMatches(text);
  return matches.map(({ code, term }) => ({ code, term }));
}

function evidenceSnippet(text: string, start: number, end: number, window = 18): string {
  const left = Math.max(0, start - window);
  const right = Math.min(text.length, end + window);
  let snippet = text.slice(left, right).replace(/\n/g, " ").trim();
  if (left > 0) snippet = `…${snippet}`;
  if (right < text.length) snippet = `${snippet}…`;
  return snippet;
}

/**
 * Detect potential lore drift: terms surfaced by naming signals in generated
 * text that appear in none of the known-world sources.
 *
 * A term is "known" when it appears as a substring of any source — the same
 * conservative rule NovelWriter uses, which errs toward silence: a false
 * negative costs nothing (auditor may still catch it), a false positive
 * erodes trust in the panel.
 */
export function detectLoreDrift(input: DetectLoreDriftInput): ReadonlyArray<LoreDriftWarning> {
  const content = input.content ?? "";
  if (!content.trim()) return [];

  const language = input.language ?? "zh";
  const maxWarnings = Math.max(1, input.maxWarnings ?? DEFAULT_MAX_WARNINGS);
  const sources = input.knownSources
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0 && s !== "(文件尚未创建)");

  const matches = language === "en" ? extractEnMatches(content) : extractZhMatches(content);
  if (matches.length === 0) return [];

  const warnings: LoreDriftWarning[] = [];
  const seen = new Set<string>();

  // Stable order: first occurrence in text wins.
  matches.sort((a, b) => a.start - b.start || a.code.localeCompare(b.code));

  for (const match of matches) {
    const sig = `${match.code}\u0000${match.term}`;
    if (seen.has(sig)) continue;
    seen.add(sig);

    const known = sources.some((source) => source.includes(match.term));
    if (known) continue;

    warnings.push({
      code: match.code,
      term: match.term,
      evidence: evidenceSnippet(content, match.start, match.end),
    });
    if (warnings.length >= maxWarnings) break;
  }

  return warnings;
}

const ZH_CODE_LABELS: Record<LoreDriftCode, string> = {
  unknown_term_quoted: "引号新词",
  unknown_term_bracketed: "括号新词",
  unknown_term_named: "命名线索新词",
  unknown_address_token: "对话称呼新词",
};

const EN_CODE_LABELS: Record<LoreDriftCode, string> = {
  unknown_term_quoted: "Quoted new term",
  unknown_term_bracketed: "Bracketed new term",
  unknown_term_named: "Naming-cue new term",
  unknown_address_token: "Dialogue-address new term",
};

/** Adapt lore-drift warnings to the pipeline's PostWriteViolation shape. */
export function loreDriftToPostWriteViolations(
  warnings: ReadonlyArray<LoreDriftWarning>,
  language: "zh" | "en" = "zh",
): ReadonlyArray<PostWriteViolation> {
  const isEnglish = language === "en";
  return warnings.map((warning) => ({
    rule: isEnglish ? "Lore drift" : "设定漂移",
    severity: "warning" as const,
    description: isEnglish
      ? `${EN_CODE_LABELS[warning.code]}: "${warning.term}" is not found in truth files, recent chapters, or the chapter brief (evidence: ${warning.evidence})`
      : `${ZH_CODE_LABELS[warning.code]}：「${warning.term}」未见于真值文件、近期章节或章节指令（上下文：${warning.evidence}）`,
    suggestion: isEnglish
      ? "If this is intentional new lore, record it in the truth files; otherwise replace it with an established name."
      : "如果这是有意引入的新设定，请把它登记进真值文件；否则改用已有的名称。",
  }));
}
