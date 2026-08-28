import { describe, expect, it } from "vitest";
import {
  detectLoreDrift,
  extractNewTermCandidates,
  loreDriftToPostWriteViolations,
} from "../agents/lore-drift.js";

describe("extractNewTermCandidates (zh)", () => {
  it("extracts book-quoted, bracketed, naming-cue, and address terms", () => {
    const text = "他翻开《九幽真经》，袖中滑出一枚【离火令】。那老者被称为玄冥子。“林小满，你来了。”";
    const candidates = extractNewTermCandidates(text, "zh");
    const terms = candidates.map((c) => c.term);
    expect(terms).toContain("九幽真经");
    expect(terms).toContain("离火令");
    expect(terms).toContain("玄冥子");
    expect(terms).toContain("林小满");
  });

  it("skips dialogue-address stopwords", () => {
    const text = "“等等！”她喊道。“住手！”";
    const candidates = extractNewTermCandidates(text, "zh");
    expect(candidates).toHaveLength(0);
  });
});

describe("extractNewTermCandidates (en)", () => {
  it("extracts quoted terms, naming cues, and dialogue address", () => {
    const text = 'They called it the "Ember Court". The blade was named Duskfang. "Marlow, wait."';
    const candidates = extractNewTermCandidates(text, "en");
    const terms = candidates.map((c) => c.term);
    expect(terms).toContain("Ember Court");
    expect(terms).toContain("Duskfang");
    expect(terms).toContain("Marlow");
  });

  it("skips English address stopwords", () => {
    const text = '"Wait, we have to go." "Look, over there!"';
    const candidates = extractNewTermCandidates(text, "en");
    expect(candidates).toHaveLength(0);
  });
});

describe("detectLoreDrift", () => {
  it("flags terms absent from all known sources", () => {
    const warnings = detectLoreDrift({
      content: "他手中出现一枚【离火令】，喃喃自语。",
      knownSources: ["主角张三在青云宗修行。", "第一章：张三拜师。"],
      language: "zh",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.term).toBe("离火令");
    expect(warnings[0]!.code).toBe("unknown_term_bracketed");
    expect(warnings[0]!.evidence).toContain("离火令");
  });

  it("suppresses terms found in any known source", () => {
    const warnings = detectLoreDrift({
      content: "他手中出现一枚【离火令】。",
      knownSources: ["宗门至宝离火令由掌门保管。"],
      language: "zh",
    });
    expect(warnings).toHaveLength(0);
  });

  it("ignores placeholder sources and blank sources", () => {
    const warnings = detectLoreDrift({
      content: "那人名为独孤残。",
      knownSources: ["(文件尚未创建)", "", undefined, null],
      language: "zh",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.term).toBe("独孤残");
  });

  it("deduplicates repeated matches of the same term", () => {
    const content = "【血魔幡】展开。他再度举起【血魔幡】。";
    const warnings = detectLoreDrift({ content, knownSources: [], language: "zh" });
    expect(warnings).toHaveLength(1);
  });

  it("respects maxWarnings cap", () => {
    const content = "【甲一】【乙二】【丙三】【丁四】";
    const warnings = detectLoreDrift({
      content,
      knownSources: [],
      language: "zh",
      maxWarnings: 2,
    });
    expect(warnings).toHaveLength(2);
  });

  it("flags unknown English quoted terms but not known ones", () => {
    const warnings = detectLoreDrift({
      content: 'She whispered about the "Hollow King" and the "Ember Court".',
      knownSources: ["The Ember Court rules the southern reach."],
      language: "en",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.term).toBe("Hollow King");
  });

  it("returns empty for empty content", () => {
    expect(detectLoreDrift({ content: "  ", knownSources: [], language: "zh" })).toHaveLength(0);
  });
});

describe("loreDriftToPostWriteViolations", () => {
  it("adapts warnings to PostWriteViolation warning severity (zh)", () => {
    const warnings = detectLoreDrift({
      content: "他被称为夜行者。",
      knownSources: [],
      language: "zh",
    });
    const violations = loreDriftToPostWriteViolations(warnings, "zh");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("warning");
    expect(violations[0]!.rule).toBe("设定漂移");
    expect(violations[0]!.description).toContain("夜行者");
  });

  it("localizes to English", () => {
    const warnings = detectLoreDrift({
      content: 'The sword was named Duskfang.',
      knownSources: [],
      language: "en",
    });
    const violations = loreDriftToPostWriteViolations(warnings, "en");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule).toBe("Lore drift");
    expect(violations[0]!.description).toContain("Duskfang");
  });
});
