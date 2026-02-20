/**
 * Lightweight embedding utilities — pure JS, zero dependencies.
 *
 * Provides:
 *  - cosineSimilarity() for comparing vectors
 *  - SimpleBagOfWords: a fallback embedding generator when no LLM embed() is available
 */

/** Cosine similarity between two vectors. Returns a value in [-1, 1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Simple bag-of-words embedding generator.
 *
 * Builds a vocabulary from all texts seen so far and produces fixed-dimension
 * TF vectors. This is a *fallback* — real LLM embeddings are much better.
 * Dimension is capped at `maxDim` to keep vectors manageable.
 */
export class SimpleBagOfWords {
  private vocab = new Map<string, number>();
  private maxDim: number;

  constructor(maxDim = 512) {
    this.maxDim = maxDim;
  }

  /** Tokenize text into lowercase word tokens */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  /** Generate an embedding vector for a piece of text */
  embed(text: string): number[] {
    const tokens = this.tokenize(text);

    // Expand vocabulary with new tokens (up to maxDim)
    for (const token of tokens) {
      if (!this.vocab.has(token) && this.vocab.size < this.maxDim) {
        this.vocab.set(token, this.vocab.size);
      }
    }

    const dim = Math.max(this.vocab.size, 1);
    const vec = new Array<number>(dim).fill(0);

    // Term frequency
    for (const token of tokens) {
      const idx = this.vocab.get(token);
      if (idx !== undefined) {
        vec[idx] += 1;
      }
    }

    // L2 normalize
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }

    return vec;
  }

  /** Batch embed multiple texts */
  embedBatch(texts: string[]): number[][] {
    return texts.map((t) => this.embed(t));
  }

  /** Current vocabulary size */
  get vocabSize(): number {
    return this.vocab.size;
  }
}
