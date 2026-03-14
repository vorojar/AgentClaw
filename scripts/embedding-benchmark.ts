/**
 * Embedding 质量对比 Benchmark
 *
 * 对比三种 embedding 方案的记忆检索质量：
 *   1. SimpleBagOfWords（纯 JS 词袋模型，零成本）
 *   2. OpenAI Compatible embedding（text-embedding-3-small 或兼容 API）
 *   3. Volcano Engine embedding（doubao-embedding）
 *
 * 用法：npx tsx scripts/embedding-benchmark.ts
 */

import "dotenv/config";
import {
  cosineSimilarity,
  SimpleBagOfWords,
} from "../packages/memory/src/embeddings.js";
import { OpenAICompatibleProvider } from "../packages/providers/src/openai-compatible.js";
import { VolcanoEmbedding } from "../packages/providers/src/volcano-embedding.js";

// ── 测试数据：模拟真实记忆条目 ──

const memories = [
  "用户偏好使用 PowerShell 而不是 cmd",
  "项目使用 pnpm workspaces + Turborepo 作为 monorepo 管理工具",
  "ComfyUI 运行在 localhost:8188，用于图片生成和处理",
  "Telegram bot token 存储在 TELEGRAM_BOT_TOKEN 环境变量中",
  "用户喜欢极简主义架构设计，减少不必要的抽象",
  "shell 工具在 Windows 上使用 PowerShell，需要 UTF-8 编码",
  "前端使用 React 19 + Vite，深色主题",
  "SearXNG 自托管搜索引擎替代 Serper API，零成本",
  "数据库使用 SQLite (better-sqlite3)，存储对话、记忆、计划",
  "用户要求所有回答必须使用中文",
  "Claude provider 使用 cache_control ephemeral 标记缓存点",
  "浏览器工具通过 CDP 连接用户真实 Chrome，保留登录态",
  "定时任务使用 croner 库，触发时运行完整 orchestrator 循环",
  "文件生成路径统一用 data/tmp/，通过 /files/ 路由对外提供",
  "WhatsApp bot 仅响应自聊模式，凭证持久化在 data/whatsapp-auth/",
];

// ── 测试查询 + 预期最相关的记忆索引（ground truth） ──

const queries: Array<{
  query: string;
  expected: number[]; // 预期 top-3 相关记忆的索引
}> = [
  {
    query: "Windows 终端用什么",
    expected: [0, 5], // PowerShell 相关
  },
  {
    query: "怎么搜索网页",
    expected: [7], // SearXNG
  },
  {
    query: "图片怎么生成",
    expected: [2], // ComfyUI
  },
  {
    query: "项目用什么构建工具",
    expected: [1], // pnpm + Turborepo
  },
  {
    query: "机器人在哪个平台",
    expected: [3, 14], // Telegram, WhatsApp
  },
  {
    query: "数据存在哪里",
    expected: [8, 13], // SQLite, data/tmp
  },
  {
    query: "网页前端技术栈",
    expected: [6], // React + Vite
  },
  {
    query: "用户有什么偏好习惯",
    expected: [4, 9, 0], // 极简主义、中文、PowerShell
  },
  {
    query: "浏览器自动化怎么做",
    expected: [11], // CDP Chrome
  },
  {
    query: "定时任务怎么运行",
    expected: [12], // croner
  },
];

// ── Embedding 方案接口 ──

interface EmbeddingMethod {
  name: string;
  embed: (texts: string[]) => Promise<number[][]>;
}

// ── 评估函数 ──

function evaluate(
  _method: string,
  memoryVectors: number[][],
  queryVectors: number[][],
): { recall3: number; mrr: number; details: string[] } {
  let totalRecall = 0;
  let totalMRR = 0;
  const details: string[] = [];

  for (let qi = 0; qi < queries.length; qi++) {
    const { query, expected } = queries[qi];
    const qVec = queryVectors[qi];

    // 计算与所有记忆的相似度
    const scores = memoryVectors.map((mVec, mi) => ({
      index: mi,
      score: cosineSimilarity(qVec, mVec),
    }));
    scores.sort((a, b) => b.score - a.score);

    // Top-3
    const top3 = scores.slice(0, 3).map((s) => s.index);

    // Recall@3：预期记忆中有多少出现在 top-3
    const hits = expected.filter((e) => top3.includes(e));
    const recall = hits.length / expected.length;
    totalRecall += recall;

    // MRR：第一个预期记忆出现的位置的倒数
    let rr = 0;
    for (let rank = 0; rank < scores.length; rank++) {
      if (expected.includes(scores[rank].index)) {
        rr = 1 / (rank + 1);
        break;
      }
    }
    totalMRR += rr;

    const topStr = top3
      .map((i) => `[${i}] ${memories[i].slice(0, 30)}...`)
      .join(" | ");
    const status = recall >= 0.5 ? "OK" : "MISS";
    details.push(
      `  ${status} Q: "${query}" → Top3: ${topStr} (recall=${recall.toFixed(2)})`,
    );
  }

  return {
    recall3: totalRecall / queries.length,
    mrr: totalMRR / queries.length,
    details,
  };
}

// ── 主函数 ──

async function main() {
  const methods: EmbeddingMethod[] = [];

  // 1. SimpleBagOfWords（永远可用）
  const bow = new SimpleBagOfWords(512);
  methods.push({
    name: "SimpleBagOfWords (local, free)",
    embed: async (texts) => texts.map((t) => bow.embed(t)),
  });

  // 2. OpenAI Compatible embedding
  // Only enable if we have a real OpenAI key or an explicit embedding model override.
  // Skip if OPENAI_BASE_URL points to a non-OpenAI service that doesn't support /v1/embeddings.
  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiBase = process.env.OPENAI_BASE_URL;
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL;
  // If base URL points to a service that supports the standard /v1/embeddings endpoint
  const isStandardOpenAI = !openaiBase || openaiBase.includes("openai.com");
  if (openaiKey && (isStandardOpenAI || embeddingModel)) {
    const provider = new OpenAICompatibleProvider({
      apiKey: openaiKey,
      baseURL: openaiBase,
    });
    methods.push({
      name: `OpenAI Compatible (${embeddingModel ?? "text-embedding-3-small"})`,
      embed: (texts) => provider.embed!(texts),
    });
  }

  // 3. Volcano Engine
  const volcanoKey = process.env.VOLCANO_EMBEDDING_KEY;
  if (volcanoKey) {
    const volcano = new VolcanoEmbedding({
      apiKey: volcanoKey,
      model: process.env.VOLCANO_EMBEDDING_MODEL,
    });
    methods.push({
      name: `Volcano Engine (${process.env.VOLCANO_EMBEDDING_MODEL ?? "doubao-embedding"})`,
      embed: (texts) => volcano.embed(texts),
    });
  }

  console.log(`\n=== Embedding 质量对比 Benchmark ===`);
  console.log(`记忆条目: ${memories.length} 条`);
  console.log(`测试查询: ${queries.length} 条`);
  console.log(`评估方法: ${methods.length} 种\n`);

  const results: Array<{ name: string; recall3: number; mrr: number }> = [];

  for (const method of methods) {
    console.log(`--- ${method.name} ---`);
    try {
      const t0 = Date.now();
      const memoryVectors = await method.embed(memories);
      const queryVectors = await method.embed(queries.map((q) => q.query));
      const elapsed = Date.now() - t0;

      console.log(
        `  向量维度: ${memoryVectors[0].length}, 耗时: ${elapsed}ms`,
      );

      const { recall3, mrr, details } = evaluate(
        method.name,
        memoryVectors,
        queryVectors,
      );

      for (const d of details) console.log(d);
      console.log(
        `  Recall@3: ${(recall3 * 100).toFixed(1)}%  MRR: ${(mrr * 100).toFixed(1)}%\n`,
      );

      results.push({ name: method.name, recall3, mrr });
    } catch (err) {
      console.log(
        `  ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  // 总结
  console.log("=== 总结 ===");
  console.log(
    "方法".padEnd(55) +
      "Recall@3".padEnd(12) +
      "MRR",
  );
  console.log("-".repeat(75));
  for (const r of results) {
    console.log(
      r.name.padEnd(55) +
        `${(r.recall3 * 100).toFixed(1)}%`.padEnd(12) +
        `${(r.mrr * 100).toFixed(1)}%`,
    );
  }
}

main().catch(console.error);
