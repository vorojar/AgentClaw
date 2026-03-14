import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../database.js";
import type { DbAdapter } from "../db-adapter.js";
import { SQLiteMemoryStore } from "../store.js";
import type {
  SessionData,
  ConversationTurn,
} from "@agentclaw/types";

// ── 辅助函数 ──

function createStore(): { db: DbAdapter; store: SQLiteMemoryStore } {
  const db = initDatabase(":memory:");
  const store = new SQLiteMemoryStore(db);
  return { db, store };
}

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  const now = new Date();
  return {
    id: "sess-1",
    conversationId: "conv-1",
    createdAt: now,
    lastActiveAt: now,
    title: "测试会话",
    ...overrides,
  };
}

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    id: "turn-1",
    conversationId: "conv-1",
    role: "user",
    content: "你好",
    createdAt: new Date(),
    ...overrides,
  };
}

// ── 测试 ──

describe("initDatabase — 数据库初始化", () => {
  it("应创建所有必要的表", () => {
    const db = initDatabase(":memory:");

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("conversations");
    expect(tableNames).toContain("turns");
    expect(tableNames).toContain("memories");
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("chat_targets");
    expect(tableNames).toContain("traces");
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("subagents");
    expect(tableNames).toContain("agents");
    expect(tableNames).toContain("memories_fts");

    db.close();
  });

  it("WAL 模式在文件数据库中应启用（:memory: 回退为 memory）", () => {
    const db = initDatabase(":memory:");
    const { journal_mode } = db
      .prepare("PRAGMA journal_mode")
      .get() as { journal_mode: string };
    // :memory: 数据库不支持 WAL，SQLite 会回退为 "memory" journal mode
    expect(journal_mode).toBe("memory");
    db.close();
  });

  it("重复调用不应报错", () => {
    const db = initDatabase(":memory:");
    // 模拟重复执行 schema — 由于 IF NOT EXISTS 不应出错
    expect(() => initDatabase(":memory:")).not.toThrow();
    db.close();
  });
});

describe("SQLiteMemoryStore — 会话 CRUD", () => {
  let store: SQLiteMemoryStore;
  let _db: DbAdapter;

  beforeEach(() => {
    ({ _db, store } = createStore());
  });

  it("saveSession + getSessionById 应正确保存和读取", async () => {
    const session = makeSession();
    await store.saveSession(session);

    const loaded = await store.getSessionById("sess-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("sess-1");
    expect(loaded!.conversationId).toBe("conv-1");
    expect(loaded!.title).toBe("测试会话");
  });

  it("getSessionById 查询不存在的 ID 应返回 null", async () => {
    const result = await store.getSessionById("nonexistent");
    expect(result).toBeNull();
  });

  it("listSessions 应返回所有非隐藏会话", async () => {
    await store.saveSession(makeSession({ id: "s1", conversationId: "c1" }));
    await store.saveSession(makeSession({ id: "s2", conversationId: "c2" }));
    await store.saveSession(
      makeSession({
        id: "s3",
        conversationId: "c3",
        metadata: { hidden: 1 },
      }),
    );

    const sessions = await store.listSessions();
    // s3 是隐藏的，不应出现
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain("s1");
    expect(ids).toContain("s2");
    expect(ids).not.toContain("s3");
  });

  it("deleteSession 应删除会话及相关数据", async () => {
    const session = makeSession();
    await store.saveSession(session);
    await store.addTurn("conv-1", makeTurn());

    await store.deleteSession("sess-1");

    const loaded = await store.getSessionById("sess-1");
    expect(loaded).toBeNull();

    const turns = await store.getHistory("conv-1");
    expect(turns).toHaveLength(0);
  });

  it("deleteSession 删除不存在的会话不应报错", async () => {
    await expect(store.deleteSession("nonexistent")).resolves.not.toThrow();
  });

  it("saveSession 应支持 INSERT OR REPLACE（更新已有会话）", async () => {
    await store.saveSession(makeSession({ title: "原始标题" }));
    await store.saveSession(makeSession({ title: "新标题" }));

    const loaded = await store.getSessionById("sess-1");
    expect(loaded!.title).toBe("新标题");
  });
});

describe("SQLiteMemoryStore — 对话轮次", () => {
  let store: SQLiteMemoryStore;
  let db: DbAdapter;

  beforeEach(() => {
    ({ db, store } = createStore());
  });

  it("addTurn 应自动创建对应的 conversation", async () => {
    await store.addTurn("auto-conv", makeTurn({ conversationId: "auto-conv" }));

    const row = db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get("auto-conv");
    expect(row).toBeDefined();
  });

  it("addTurn + getHistory 应按时间顺序返回", async () => {
    const convId = "conv-order";
    const t1 = new Date("2024-01-01T00:00:00Z");
    const t2 = new Date("2024-01-01T00:01:00Z");
    const t3 = new Date("2024-01-01T00:02:00Z");

    await store.addTurn(
      convId,
      makeTurn({ id: "t1", content: "第一条", createdAt: t1 }),
    );
    await store.addTurn(
      convId,
      makeTurn({ id: "t2", content: "第二条", createdAt: t2 }),
    );
    await store.addTurn(
      convId,
      makeTurn({ id: "t3", content: "第三条", createdAt: t3 }),
    );

    const turns = await store.getHistory(convId);
    expect(turns).toHaveLength(3);
    expect(turns[0].content).toBe("第一条");
    expect(turns[1].content).toBe("第二条");
    expect(turns[2].content).toBe("第三条");
  });

  it("getHistory 支持 limit 参数", async () => {
    const convId = "conv-limit";
    for (let i = 0; i < 5; i++) {
      await store.addTurn(
        convId,
        makeTurn({
          id: `turn-${i}`,
          content: `消息 ${i}`,
          createdAt: new Date(Date.now() + i * 1000),
        }),
      );
    }

    const turns = await store.getHistory(convId, 3);
    expect(turns).toHaveLength(3);
  });

  it("getHistory 对空对话应返回空数组", async () => {
    const turns = await store.getHistory("nonexistent-conv");
    expect(turns).toEqual([]);
  });

  it("addTurn 应保存 assistant 轮次的 token 信息", async () => {
    await store.addTurn(
      "conv-1",
      makeTurn({
        id: "t-assistant",
        role: "assistant",
        content: "回复内容",
        model: "claude-3",
        tokensIn: 100,
        tokensOut: 50,
        durationMs: 1200,
        toolCallCount: 2,
      }),
    );

    const turns = await store.getHistory("conv-1");
    expect(turns[0].model).toBe("claude-3");
    expect(turns[0].tokensIn).toBe(100);
    expect(turns[0].tokensOut).toBe(50);
    expect(turns[0].durationMs).toBe(1200);
    expect(turns[0].toolCallCount).toBe(2);
  });
});

describe("SQLiteMemoryStore — 记忆 CRUD", () => {
  let store: SQLiteMemoryStore;
  let _db: DbAdapter;

  beforeEach(() => {
    ({ _db, store } = createStore());
  });

  it("add 应创建记忆并返回完整实体", async () => {
    const entry = await store.add({
      type: "fact",
      content: "用户喜欢深色主题",
      importance: 0.8,
    });

    expect(entry.id).toBeDefined();
    expect(entry.type).toBe("fact");
    expect(entry.content).toBe("用户喜欢深色主题");
    expect(entry.importance).toBe(0.8);
    expect(entry.accessCount).toBe(0);
    expect(entry.embedding).toBeDefined();
    expect(entry.embedding!.length).toBeGreaterThan(0);
  });

  it("get 应返回记忆并增加访问计数", async () => {
    const created = await store.add({
      type: "preference",
      content: "偏好 TypeScript",
      importance: 0.7,
    });

    // get() 先 SELECT 再 UPDATE，返回的是 UPDATE 之前的数据
    // 所以第一次 get 返回 accessCount=0（但同时将其更新为 1）
    const fetched = await store.get(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.content).toBe("偏好 TypeScript");
    expect(fetched!.accessCount).toBe(0);

    // 第二次 get 返回 accessCount=1（同时更新为 2）
    const fetched2 = await store.get(created.id);
    expect(fetched2!.accessCount).toBe(1);
  });

  it("get 查询不存在的 ID 应返回 undefined", async () => {
    const result = await store.get("nonexistent-id");
    expect(result).toBeUndefined();
  });

  it("update 应更新记忆字段", async () => {
    const created = await store.add({
      type: "fact",
      content: "原始内容",
      importance: 0.5,
    });

    const updated = await store.update(created.id, {
      content: "更新后的内容",
      importance: 0.9,
    });

    expect(updated.content).toBe("更新后的内容");
    expect(updated.importance).toBe(0.9);
  });

  it("update 不存在的记忆应抛出错误", async () => {
    await expect(
      store.update("nonexistent", { content: "test" }),
    ).rejects.toThrow("Memory entry not found");
  });

  it("delete 应移除记忆", async () => {
    const created = await store.add({
      type: "fact",
      content: "即将删除的记忆",
      importance: 0.5,
    });

    await store.delete(created.id);
    const result = await store.get(created.id);
    expect(result).toBeUndefined();
  });

  it("delete 不存在的记忆不应报错", async () => {
    await expect(store.delete("nonexistent")).resolves.not.toThrow();
  });

  it("add 应支持带 metadata 的记忆", async () => {
    const entry = await store.add({
      type: "entity",
      content: "Claude 是 Anthropic 的 AI 助手",
      importance: 0.9,
      metadata: { source: "conversation", confidence: 0.95 },
    });

    const fetched = await store.get(entry.id);
    expect(fetched!.metadata).toEqual({ source: "conversation", confidence: 0.95 });
  });

  it("search 应返回相关记忆", async () => {
    await store.add({ type: "fact", content: "用户使用 macOS 系统", importance: 0.8 });
    await store.add({ type: "fact", content: "用户喜欢 vim 编辑器", importance: 0.7 });
    await store.add({ type: "preference", content: "偏好深色主题", importance: 0.6 });

    const results = await store.search({ query: "用户使用什么系统", limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    // 每个结果都应有 score
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.entry.content).toBeDefined();
    }
  });

  it("search 空查询应返回按 importance 排序的结果", async () => {
    await store.add({ type: "fact", content: "低重要性", importance: 0.1 });
    await store.add({ type: "fact", content: "高重要性", importance: 0.9 });

    const results = await store.search({ limit: 10 });
    expect(results.length).toBe(2);
  });

  it("search 应支持按 type 过滤", async () => {
    await store.add({ type: "fact", content: "这是一个事实", importance: 0.5 });
    await store.add({ type: "preference", content: "这是一个偏好", importance: 0.5 });

    const results = await store.search({ type: "fact", limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].entry.type).toBe("fact");
  });

  it("search 应支持 minImportance 过滤", async () => {
    await store.add({ type: "fact", content: "不重要的", importance: 0.1 });
    await store.add({ type: "fact", content: "重要的", importance: 0.9 });

    const results = await store.search({ minImportance: 0.5, limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].entry.content).toBe("重要的");
  });

  it("findSimilar 应找到精确匹配的记忆", async () => {
    await store.add({ type: "fact", content: "用户名叫张三", importance: 0.8 });

    const result = await store.findSimilar("用户名叫张三", "fact");
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1.0);
  });

  it("findSimilar 没有相似记忆时应返回 null", async () => {
    await store.add({ type: "fact", content: "完全不相关的内容", importance: 0.5 });

    const result = await store.findSimilar("天气预报明天下雨", "fact", 0.99);
    expect(result).toBeNull();
  });
});

describe("SQLiteMemoryStore — FTS5 全文搜索", () => {
  let store: SQLiteMemoryStore;
  let db: DbAdapter;

  beforeEach(() => {
    ({ db, store } = createStore());
  });

  it("添加记忆后应同步到 FTS 索引", async () => {
    await store.add({ type: "fact", content: "Python 是一门编程语言", importance: 0.7 });

    const ftsRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM memories_fts")
      .get() as { cnt: number };
    expect(ftsRow.cnt).toBe(1);
  });

  it("删除记忆后应从 FTS 索引中移除", async () => {
    const entry = await store.add({
      type: "fact",
      content: "将被删除的内容",
      importance: 0.5,
    });
    await store.delete(entry.id);

    const ftsRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM memories_fts")
      .get() as { cnt: number };
    expect(ftsRow.cnt).toBe(0);
  });

  it("更新记忆 content 后应同步 FTS 索引", async () => {
    const entry = await store.add({
      type: "fact",
      content: "原始搜索内容",
      importance: 0.5,
    });

    await store.update(entry.id, { content: "更新后的搜索内容" });

    const ftsRows = db
      .prepare("SELECT content FROM memories_fts WHERE id = ?")
      .all(entry.id) as Array<{ content: string }>;

    expect(ftsRows).toHaveLength(1);
    expect(ftsRows[0].content).toBe("更新后的搜索内容");
  });

  it("BM25 搜索应能匹配关键词", async () => {
    await store.add({
      type: "fact",
      content: "JavaScript is a programming language",
      importance: 0.5,
    });
    await store.add({
      type: "fact",
      content: "Python is used for data science",
      importance: 0.5,
    });

    // 搜索 JavaScript 相关
    const results = await store.search({
      query: "JavaScript programming",
      limit: 5,
      bm25Weight: 1.0,
      semanticWeight: 0,
      recencyWeight: 0,
      importanceWeight: 0,
    });

    expect(results.length).toBeGreaterThan(0);
    // JavaScript 相关的应排在前面
    expect(results[0].entry.content).toContain("JavaScript");
  });
});

describe("SQLiteMemoryStore — Token 日志", () => {
  let store: SQLiteMemoryStore;
  let _db: DbAdapter;

  beforeEach(() => {
    ({ _db, store } = createStore());
  });

  it("getTokenLogs 应返回 assistant 轮次的 token 信息", async () => {
    await store.addTurn(
      "conv-1",
      makeTurn({
        id: "t1",
        role: "assistant",
        content: "回复 1",
        model: "claude-3",
        tokensIn: 100,
        tokensOut: 50,
        createdAt: new Date("2024-01-01T00:00:00Z"),
      }),
    );
    await store.addTurn(
      "conv-1",
      makeTurn({
        id: "t2",
        role: "user",
        content: "用户消息",
        createdAt: new Date("2024-01-01T00:01:00Z"),
      }),
    );
    await store.addTurn(
      "conv-1",
      makeTurn({
        id: "t3",
        role: "assistant",
        content: "回复 2",
        model: "gpt-4",
        tokensIn: 200,
        tokensOut: 100,
        createdAt: new Date("2024-01-01T00:02:00Z"),
      }),
    );

    const logs = store.getTokenLogs(10, 0);
    // 只有 assistant 且有 model 的轮次
    expect(logs.total).toBe(2);
    expect(logs.items).toHaveLength(2);
    // 按时间倒序，最新的在前
    expect(logs.items[0].model).toBe("gpt-4");
    expect(logs.items[1].model).toBe("claude-3");
  });

  it("getTokenLogs 支持分页", async () => {
    for (let i = 0; i < 5; i++) {
      await store.addTurn(
        "conv-1",
        makeTurn({
          id: `t-${i}`,
          role: "assistant",
          content: `回复 ${i}`,
          model: "claude-3",
          tokensIn: 10 * i,
          tokensOut: 5 * i,
          createdAt: new Date(Date.now() + i * 1000),
        }),
      );
    }

    const page1 = store.getTokenLogs(2, 0);
    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);

    const page2 = store.getTokenLogs(2, 2);
    expect(page2.items).toHaveLength(2);

    // 不重叠
    expect(page1.items[0].id).not.toBe(page2.items[0].id);
  });

  it("getTokenLogs 无数据时应返回空", () => {
    const logs = store.getTokenLogs();
    expect(logs.total).toBe(0);
    expect(logs.items).toEqual([]);
  });
});

describe("SQLiteMemoryStore — 使用统计", () => {
  let store: SQLiteMemoryStore;
  let _db: DbAdapter;

  beforeEach(() => {
    ({ _db, store } = createStore());
  });

  it("getUsageStats 应按模型聚合 token 使用量", async () => {
    await store.addTurn(
      "conv-1",
      makeTurn({
        id: "t1",
        role: "assistant",
        model: "claude-3",
        tokensIn: 100,
        tokensOut: 50,
      }),
    );
    await store.addTurn(
      "conv-1",
      makeTurn({
        id: "t2",
        role: "assistant",
        model: "claude-3",
        tokensIn: 200,
        tokensOut: 100,
      }),
    );
    await store.addTurn(
      "conv-1",
      makeTurn({
        id: "t3",
        role: "assistant",
        model: "gpt-4",
        tokensIn: 300,
        tokensOut: 150,
      }),
    );

    const stats = store.getUsageStats();
    expect(stats.totalIn).toBe(600);
    expect(stats.totalOut).toBe(300);
    expect(stats.totalCalls).toBe(3);
    expect(stats.byModel).toHaveLength(2);
  });
});

describe("SQLiteMemoryStore — Traces", () => {
  let store: SQLiteMemoryStore;

  beforeEach(() => {
    ({ store } = createStore());
  });

  it("addTrace + getTrace 应正确存储和读取", async () => {
    const trace = {
      id: "trace-1",
      conversationId: "conv-1",
      userInput: "你好",
      systemPrompt: "你是助手",
      steps: [{ type: "llm_call" as const, model: "claude-3" }],
      response: "你好！有什么可以帮您的？",
      model: "claude-3",
      tokensIn: 50,
      tokensOut: 20,
      durationMs: 800,
      createdAt: new Date(),
    };

    await store.addTrace(trace);
    const loaded = await store.getTrace("trace-1");

    expect(loaded).not.toBeNull();
    expect(loaded!.userInput).toBe("你好");
    expect(loaded!.response).toBe("你好！有什么可以帮您的？");
    expect(loaded!.steps).toHaveLength(1);
    expect(loaded!.steps[0].type).toBe("llm_call");
  });

  it("getTrace 查询不存在的 ID 应返回 null", async () => {
    const result = await store.getTrace("nonexistent");
    expect(result).toBeNull();
  });

  it("getTraces 应支持分页", async () => {
    for (let i = 0; i < 5; i++) {
      await store.addTrace({
        id: `trace-${i}`,
        conversationId: "conv-1",
        userInput: `输入 ${i}`,
        steps: [],
        tokensIn: 10,
        tokensOut: 5,
        durationMs: 100,
        createdAt: new Date(Date.now() + i * 1000),
      });
    }

    const result = await store.getTraces(2, 0);
    expect(result.total).toBe(5);
    expect(result.items).toHaveLength(2);
  });
});

describe("SQLiteMemoryStore — 边界情况", () => {
  let store: SQLiteMemoryStore;

  beforeEach(() => {
    ({ store } = createStore());
  });

  it("search 无任何记忆时应返回空数组", async () => {
    const results = await store.search({ query: "测试", limit: 10 });
    expect(results).toEqual([]);
  });

  it("add 记忆内容包含特殊字符应正常工作", async () => {
    const content = `包含"引号"、'单引号'、\\反斜杠、换行\n和tab\t的内容`;
    const entry = await store.add({
      type: "fact",
      content,
      importance: 0.5,
    });

    const fetched = await store.get(entry.id);
    expect(fetched!.content).toBe(content);
  });

  it("add 空字符串 content 应正常工作", async () => {
    const entry = await store.add({
      type: "fact",
      content: "",
      importance: 0.5,
    });
    expect(entry.id).toBeDefined();
  });

  it("search 带中文查询应正常工作", async () => {
    await store.add({ type: "fact", content: "用户在北京工作", importance: 0.8 });
    await store.add({ type: "fact", content: "用户喜欢喝咖啡", importance: 0.7 });

    const results = await store.search({ query: "北京", limit: 5 });
    expect(results.length).toBeGreaterThan(0);
  });

  it("reindexEmbeddings 应重建所有嵌入向量", async () => {
    await store.add({ type: "fact", content: "记忆一", importance: 0.5 });
    await store.add({ type: "fact", content: "记忆二", importance: 0.6 });

    const result = await store.reindexEmbeddings();
    expect(result.total).toBe(2);
    expect(result.updated).toBe(2);
  });
});
