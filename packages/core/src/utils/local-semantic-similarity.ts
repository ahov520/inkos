/**
 * On-device lightweight semantic similarity.
 *
 * Ported from wkbin/zaomeng's LocalSemanticVector (AGPL-3.0, Kotlin):
 * weighted multi-order character N-Gram frequency features (unigram /
 * bigram / trigram) compared with cosine similarity. Zero external model
 * dependency, deterministic, millisecond-level, and fully offline — the same
 * math runs identically on servers, CI, and mobile-class runtimes.
 *
 * Why InkOS needs this: the retrieval layer's exact-substring matching misses
 * paraphrases ("师徒矛盾" never literally appears in "师父与徒弟的争执"), but
 * character n-grams still overlap in that case. This similarity is therefore a
 * secondary retrieval signal — it never replaces exact term hits, it only
 * rescues near-misses that share sub-word surface forms.
 */

export type NgramWeights = ReadonlyMap<string, number>;

// zaomeng's original feature weights: higher-order n-grams carry more meaning.
const UNIGRAM_WEIGHT = 0.6;
const BIGRAM_WEIGHT = 1.2;
const TRIGRAM_WEIGHT = 1.8;
const WORD_WEIGHT = 1.2;
const WORD_PAIR_WEIGHT = 1.8;

// Han runs get character n-grams; latin/digit runs are one token per word.
const TOKEN_PATTERN = /[\u3400-\u9fff]+|[a-z0-9]+/gu;

/**
 * Extract the weighted feature map for a text.
 *
 * CJK runs use zaomeng's multi-order character n-grams:
 * - 1-gram (single char): base character meaning, weight 0.6
 * - 2-gram: core word-building / intent unit, weight 1.2
 * - 3-gram: higher-order semantic collocation, weight 1.8
 *
 * Latin/digit runs deviate from the original on purpose: character n-grams
 * give unrelated English sentences a nonzero similarity baseline (shared
 * letters and letter pairs), so ASCII words are treated as atomic tokens
 * (weight 1.2) plus adjacent-word pairs (weight 1.8) instead.
 */
export function extractNgramWeights(text: string): NgramWeights {
  const normalized = text.toLowerCase().trim();
  const weights = new Map<string, number>();
  if (!normalized) return weights;

  const bump = (key: string, weight: number): void => {
    weights.set(key, (weights.get(key) ?? 0) + weight);
  };

  let previousWord: string | null = null;
  for (const match of normalized.matchAll(TOKEN_PATTERN)) {
    const token = match[0]!;
    if (/^[\u3400-\u9fff]/.test(token)) {
      previousWord = null;
      for (let index = 0; index < token.length; index += 1) {
        bump(token[index]!, UNIGRAM_WEIGHT);
      }
      for (let index = 0; index < token.length - 1; index += 1) {
        bump(token.slice(index, index + 2), BIGRAM_WEIGHT);
      }
      for (let index = 0; index < token.length - 2; index += 1) {
        bump(token.slice(index, index + 3), TRIGRAM_WEIGHT);
      }
      continue;
    }
    // Single-letter ASCII tokens ("a", "i") carry no retrievable meaning.
    if (token.length < 2) {
      previousWord = null;
      continue;
    }
    bump(token, WORD_WEIGHT);
    if (previousWord) {
      bump(`${previousWord} ${token}`, WORD_PAIR_WEIGHT);
    }
    previousWord = token;
  }
  return weights;
}

/**
 * Cosine similarity between two precomputed n-gram weight maps, strictly in
 * [0, 1]. Texts with no shared n-grams return exactly 0 — there is no hash
 * projection, so there are no collision-induced false recalls.
 *
 * Accepting precomputed weights lets callers extract the query features once
 * and score many candidates without re-tokenizing the query.
 */
export function ngramCosineSimilarity(left: NgramWeights, right: NgramWeights): number {
  if (left.size === 0 || right.size === 0) return 0;

  let magnitudeSquaredLeft = 0;
  for (const value of left.values()) {
    magnitudeSquaredLeft += value * value;
  }
  let magnitudeSquaredRight = 0;
  for (const value of right.values()) {
    magnitudeSquaredRight += value * value;
  }

  // Iterate the smaller map for the dot product.
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let dot = 0;
  for (const [ngram, weight] of smaller) {
    const other = larger.get(ngram);
    if (other !== undefined) {
      dot += weight * other;
    }
  }

  const denominator = Math.sqrt(magnitudeSquaredLeft) * Math.sqrt(magnitudeSquaredRight);
  if (denominator <= 1e-6) return 0;
  return Math.min(1, Math.max(0, dot / denominator));
}

/** Convenience one-shot similarity between two raw texts. */
export function localSemanticSimilarity(text1: string, text2: string): number {
  if (!text1.trim() || !text2.trim()) return 0;
  return ngramCosineSimilarity(extractNgramWeights(text1), extractNgramWeights(text2));
}

/**
 * Asymmetric retrieval signal: how much of the query's weighted n-gram mass
 * the candidate covers, in [0, 1].
 *
 * Cosine is the wrong shape for retrieval when the query is a short focus
 * phrase and the candidate is a long summary row — the candidate's many
 * unrelated n-grams inflate the denominator and drown genuine overlap.
 * Coverage only asks "is this query gram present in the candidate", so it is
 * invariant to candidate length while still returning exactly 0 for disjoint
 * texts.
 */
export function ngramQueryCoverage(query: NgramWeights, candidate: NgramWeights): number {
  if (query.size === 0 || candidate.size === 0) return 0;

  let total = 0;
  let covered = 0;
  for (const [ngram, weight] of query) {
    const mass = weight * weight;
    total += mass;
    if (candidate.has(ngram)) {
      covered += mass;
    }
  }
  if (total <= 1e-6) return 0;
  return Math.min(1, Math.max(0, covered / total));
}
