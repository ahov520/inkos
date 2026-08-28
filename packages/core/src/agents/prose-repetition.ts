/**
 * Intra-chapter repeated n-gram detection — deterministic, zero LLM cost.
 *
 * Ported and adapted from NovelWriter's prose check
 * (https://github.com/Hurricane0698/novelwriter, AGPL-3.0).
 *
 * InkOS already detects CROSS-chapter repetition and fixed fatigue-word lists;
 * this fills the remaining gap: the model mechanically reusing the same phrase
 * several times WITHIN one chapter ("他握紧了拳头" ×4). Only the single
 * strongest candidate is reported per chapter so review panels stay readable
 * (every sliding-window rotation of a repeated phrase would otherwise flood
 * the output).
 *
 * Pure functions, no dependencies, no I/O: safe to run on-device (Android).
 */

import type { PostWriteViolation } from "./post-write-validator.js";

/** Flag when an n-gram occurs at least this many times within one chapter. */
const REPEAT_THRESHOLD = 3;
/**
 * CJK n-gram sizes are character-level. NovelWriter uses 3-6; InkOS starts at
 * 4 because common 3-char collocations (e.g. 了一个) repeat naturally in
 * Chinese prose and would produce noisy advisories.
 */
const NGRAM_SIZES_ZH = [6, 5, 4] as const;
/** English n-gram sizes are word-level. */
const NGRAM_SIZES_EN = [5, 4, 3] as const;

const RE_CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff]+/g;
const RE_EN_WORD = /[^\W_]+(?:['\u2019][^\W_]+)*/gu;

interface NgramOccurrence {
  readonly gram: string;
  readonly start: number;
  readonly end: number;
}

interface RepeatedCandidate {
  readonly gram: string;
  readonly count: number;
  readonly firstStart: number;
  readonly firstEnd: number;
}

/** Character-level n-grams that never cross punctuation or paragraph breaks. */
function cjkNgrams(text: string, n: number): NgramOccurrence[] {
  const out: NgramOccurrence[] = [];
  RE_CJK_RUN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_CJK_RUN.exec(text)) !== null) {
    const segment = m[0];
    if (segment.length < n) continue;
    const base = m.index;
    for (let i = 0; i + n <= segment.length; i++) {
      out.push({ gram: segment.slice(i, i + n), start: base + i, end: base + i + n });
    }
  }
  return out;
}

/** Normalized word-level n-grams, ignoring surrounding punctuation. */
function wordNgrams(text: string, n: number): NgramOccurrence[] {
  const tokens: Array<{ word: string; start: number; end: number }> = [];
  RE_EN_WORD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_EN_WORD.exec(text)) !== null) {
    tokens.push({ word: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  if (tokens.length < n) return [];
  const out: NgramOccurrence[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    out.push({
      gram: tokens.slice(i, i + n).map((t) => t.word).join(" "),
      start: tokens[i]!.start,
      end: tokens[i + n - 1]!.end,
    });
  }
  return out;
}

function topRepeatedCandidate(
  text: string,
  sizes: ReadonlyArray<number>,
  gramGetter: (text: string, n: number) => NgramOccurrence[],
): RepeatedCandidate | null {
  const candidates: RepeatedCandidate[] = [];

  for (const n of sizes) {
    const occurrences = gramGetter(text, n);
    const counts = new Map<string, number>();
    const firstSpans = new Map<string, { start: number; end: number }>();
    for (const { gram, start, end } of occurrences) {
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
      if (!firstSpans.has(gram)) firstSpans.set(gram, { start, end });
    }
    for (const [gram, count] of counts) {
      if (count < REPEAT_THRESHOLD) continue;
      const span = firstSpans.get(gram)!;
      candidates.push({ gram, count, firstStart: span.start, firstEnd: span.end });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) =>
      b.count - a.count // more repetitions first
      || b.gram.length - a.gram.length // then the more specific phrase
      || a.firstStart - b.firstStart
      || a.gram.localeCompare(b.gram),
  );
  return candidates[0]!;
}

function evidenceSnippet(text: string, start: number, end: number, window = 30): string {
  const left = Math.max(0, start - window);
  const right = Math.min(text.length, end + window);
  let snippet = text.slice(left, right).replace(/\n/g, " ").trim();
  if (left > 0) snippet = `…${snippet}`;
  if (right < text.length) snippet = `${snippet}…`;
  return snippet;
}

/**
 * Detect the strongest repeated phrase within a single chapter.
 * Returns at most one warning (advisory, never blocks the pipeline).
 */
export function detectRepeatedNgrams(
  content: string,
  language: "zh" | "en" = "zh",
): ReadonlyArray<PostWriteViolation> {
  if (!content || !content.trim()) return [];

  const isEnglish = language === "en";
  const candidate = isEnglish
    ? topRepeatedCandidate(content, NGRAM_SIZES_EN, wordNgrams)
    : topRepeatedCandidate(content, NGRAM_SIZES_ZH, cjkNgrams);

  if (!candidate) return [];

  const evidence = evidenceSnippet(content, candidate.firstStart, candidate.firstEnd);
  return [
    isEnglish
      ? {
          rule: "Repeated phrase",
          severity: "warning" as const,
          description: `Phrase "${candidate.gram}" appears ${candidate.count} times in this chapter (evidence: ${evidence})`,
          suggestion: "Rephrase the repeated occurrences with different actions, imagery, or sentence structure.",
        }
      : {
          rule: "章内重复短语",
          severity: "warning" as const,
          description: `短语「${candidate.gram}」在本章出现 ${candidate.count} 次（上下文：${evidence}）`,
          suggestion: "用不同的动作、意象或句式改写重复处，避免机械复读。",
        },
  ];
}
