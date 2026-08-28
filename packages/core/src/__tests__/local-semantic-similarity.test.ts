import { describe, expect, it } from "vitest";
import {
  extractNgramWeights,
  localSemanticSimilarity,
  ngramCosineSimilarity,
  ngramQueryCoverage,
} from "../utils/local-semantic-similarity.js";

describe("extractNgramWeights", () => {
  it("returns an empty map for blank input", () => {
    expect(extractNgramWeights("").size).toBe(0);
    expect(extractNgramWeights("   ").size).toBe(0);
  });

  it("accumulates weighted multi-order n-grams", () => {
    const weights = extractNgramWeights("师徒");
    expect(weights.get("师")).toBeCloseTo(0.6);
    expect(weights.get("徒")).toBeCloseTo(0.6);
    expect(weights.get("师徒")).toBeCloseTo(1.2);
  });

  it("does not span n-grams across whitespace or punctuation", () => {
    const weights = extractNgramWeights("旧伤，复发");
    expect(weights.has("伤复")).toBe(false);
    expect(weights.has("伤，")).toBe(false);
    expect(weights.get("旧伤")).toBeCloseTo(1.2);
    expect(weights.get("复发")).toBeCloseTo(1.2);
  });

  it("tokenizes ASCII words atomically with adjacent-word pairs", () => {
    const weights = extractNgramWeights("vanished mentor");
    expect(weights.get("vanished")).toBeCloseTo(1.2);
    expect(weights.get("mentor")).toBeCloseTo(1.2);
    expect(weights.get("vanished mentor")).toBeCloseTo(1.8);
    // Single-letter tokens carry no retrievable meaning.
    expect(extractNgramWeights("a b").size).toBe(0);
  });
});

describe("localSemanticSimilarity", () => {
  it("returns 1 for identical text and 0 for disjoint text", () => {
    expect(localSemanticSimilarity("旧伤复发", "旧伤复发")).toBeCloseTo(1);
    expect(localSemanticSimilarity("师徒矛盾", "码头装卸")).toBe(0);
    expect(localSemanticSimilarity("", "师徒矛盾")).toBe(0);
  });

  it("stays within [0, 1]", () => {
    const value = localSemanticSimilarity("师徒矛盾再度爆发", "师父与徒弟的争执");
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("scores paraphrases above unrelated text", () => {
    const paraphrase = localSemanticSimilarity(
      "师徒矛盾 旧伤",
      "师父与徒弟的争执再度爆发，旧伤隐隐作痛",
    );
    const unrelated = localSemanticSimilarity(
      "师徒矛盾 旧伤",
      "港口的货轮在夜里靠岸，water rushed the pier",
    );
    expect(unrelated).toBe(0);
    // Calibrated rescue zone: zh paraphrases land around 0.07-0.10, single
    // shared common chars stay near 0.02 (see memory-retrieval thresholds).
    expect(paraphrase).toBeGreaterThan(0.065);
  });

  it("keeps single-shared-character overlap below the paraphrase zone", () => {
    const weak = localSemanticSimilarity("师徒矛盾 旧伤", "他受了新伤");
    expect(weak).toBeGreaterThan(0);
    expect(weak).toBeLessThan(0.05);
  });

  it("treats ASCII words as atomic tokens so unrelated English scores zero", () => {
    const related = localSemanticSimilarity(
      "vanished mentor debt",
      "the mentor who vanished left a debt behind",
    );
    const unrelated = localSemanticSimilarity(
      "vanished mentor debt",
      "crimson skyline over quartz",
    );
    expect(unrelated).toBe(0);
    expect(related).toBeGreaterThan(0.1);
  });

  it("is symmetric", () => {
    const forward = localSemanticSimilarity("血衣线索", "带血的衣角是关键线索");
    const backward = localSemanticSimilarity("带血的衣角是关键线索", "血衣线索");
    expect(forward).toBeCloseTo(backward);
  });
});

describe("ngramCosineSimilarity", () => {
  it("supports precomputed query weights across many candidates", () => {
    const query = extractNgramWeights("账本证据");
    const hit = ngramCosineSimilarity(query, extractNgramWeights("她终于拿到了账本，那是唯一的证据"));
    const miss = ngramCosineSimilarity(query, extractNgramWeights("清晨的雾气漫过山脊"));
    expect(hit).toBeGreaterThan(miss);
    expect(miss).toBe(0);
  });
});

describe("ngramQueryCoverage", () => {
  it("is invariant to candidate length, unlike cosine", () => {
    const query = extractNgramWeights("誓令碎玉");
    const short = extractNgramWeights("碎裂的誓令残玉");
    const long = extractNgramWeights(
      "林月摩挲碎裂的誓令残玉，旧疾隐隐作痛，窗外的雨一直下到了后半夜，她想起师门旧事",
    );
    const coverageShort = ngramQueryCoverage(query, short);
    const coverageLong = ngramQueryCoverage(query, long);
    // Cosine collapses as the candidate grows; coverage holds steady.
    expect(ngramCosineSimilarity(query, long)).toBeLessThan(ngramCosineSimilarity(query, short));
    expect(coverageLong).toBeCloseTo(coverageShort);
    expect(coverageLong).toBeGreaterThan(0.1);
  });

  it("returns 0 for disjoint texts and 1 for full containment", () => {
    const query = extractNgramWeights("账本");
    expect(ngramQueryCoverage(query, extractNgramWeights("清晨的雾气"))).toBe(0);
    expect(ngramQueryCoverage(query, extractNgramWeights("她把账本藏进了夹层"))).toBe(1);
  });
});
