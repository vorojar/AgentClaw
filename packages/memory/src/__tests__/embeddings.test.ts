import { describe, it, expect, beforeEach } from "vitest";
import { cosineSimilarity, SimpleBagOfWords } from "../embeddings.js";

describe("cosineSimilarity — 余弦相似度计算", () => {
  it("相同向量的相似度应为 1", () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("正交向量的相似度应为 0", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  it("反方向向量的相似度应为 -1", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it("零向量应返回 0", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("两个零向量应返回 0", () => {
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("空向量应返回 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("长度不同的向量应返回 0", () => {
    const a = [1, 2, 3];
    const b = [1, 2];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("缩放向量的相似度应为 1（方向不变）", () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
  });
});

describe("SimpleBagOfWords — 词袋嵌入", () => {
  let bow: SimpleBagOfWords;

  beforeEach(() => {
    bow = new SimpleBagOfWords(512);
  });

  it("embed 应返回数值向量", () => {
    const vec = bow.embed("hello world test");
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBeGreaterThan(0);
    // 所有元素应为数字
    for (const v of vec) {
      expect(typeof v).toBe("number");
    }
  });

  it("embed 结果应是 L2 归一化的", () => {
    const vec = bow.embed("hello world testing");
    // L2 norm 应约等于 1
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      expect(norm).toBeCloseTo(1.0, 4);
    }
  });

  it("相同文本的嵌入应产生高相似度", () => {
    const v1 = bow.embed("hello world");
    const v2 = bow.embed("hello world");
    // 需要 pad 到相同长度
    const maxLen = Math.max(v1.length, v2.length);
    const padded1 = [...v1, ...new Array(maxLen - v1.length).fill(0)];
    const padded2 = [...v2, ...new Array(maxLen - v2.length).fill(0)];
    expect(cosineSimilarity(padded1, padded2)).toBeCloseTo(1.0);
  });

  it("不同文本的嵌入应产生较低相似度", () => {
    const v1 = bow.embed("programming javascript code");
    const v2 = bow.embed("cooking recipe kitchen");
    const maxLen = Math.max(v1.length, v2.length);
    const padded1 = [...v1, ...new Array(maxLen - v1.length).fill(0)];
    const padded2 = [...v2, ...new Array(maxLen - v2.length).fill(0)];
    const sim = cosineSimilarity(padded1, padded2);
    expect(sim).toBeLessThan(0.5);
  });

  it("CJK 字符应被分为单个 token", () => {
    const bow2 = new SimpleBagOfWords(512);
    const _vec = bow2.embed("你好世界");
    // 4 个中文字符应产生 4 个不同的 token
    expect(bow2.vocabSize).toBe(4);
  });

  it("CJK 和拉丁文混合文本应正确处理", () => {
    const bow2 = new SimpleBagOfWords(512);
    bow2.embed("hello 你好 world 世界");
    // "hello" + "world" (2 个拉丁词) + "你" + "好" + "世" + "界" (4 个 CJK 字符) = 6
    expect(bow2.vocabSize).toBe(6);
  });

  it("单字符拉丁文应被忽略（不足 2 字符）", () => {
    const bow2 = new SimpleBagOfWords(512);
    bow2.embed("I am a test");
    // "am" 和 "test" 满足 2 字符以上，"I" 和 "a" 被忽略
    expect(bow2.vocabSize).toBe(2);
  });

  it("空字符串应返回全零向量（或只有一个零）", () => {
    const vec = bow.embed("");
    // 没有 token，词汇表为空，dim = max(0, 1) = 1
    expect(vec.length).toBeGreaterThanOrEqual(1);
    // 所有值应为 0
    for (const v of vec) {
      expect(v).toBe(0);
    }
  });

  it("maxDim 应限制词汇表大小", () => {
    const smallBow = new SimpleBagOfWords(3);
    smallBow.embed("alpha beta gamma delta epsilon");
    expect(smallBow.vocabSize).toBe(3);
  });

  it("embedBatch 应返回每个文本的嵌入", () => {
    const vecs = bow.embedBatch(["hello world", "foo bar"]);
    expect(vecs).toHaveLength(2);
    expect(vecs[0].length).toBeGreaterThan(0);
    expect(vecs[1].length).toBeGreaterThan(0);
  });

  it("vocabSize 应反映累计词汇量", () => {
    const bow2 = new SimpleBagOfWords(512);
    expect(bow2.vocabSize).toBe(0);

    bow2.embed("hello world");
    expect(bow2.vocabSize).toBe(2);

    bow2.embed("hello universe");
    expect(bow2.vocabSize).toBe(3); // "universe" 是新词
  });
});
