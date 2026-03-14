/**
 * 数据库适配器接口 — 屏蔽 better-sqlite3 / bun:sqlite 差异
 *
 * Node.js 环境使用 better-sqlite3，Bun 桌面版使用 bun:sqlite。
 * 两者 API 高度相似但有细微差异，本模块提供统一抽象。
 */

import { createRequire } from "node:module";

// Bun 运行时全局变量声明（仅用于运行时检测）
declare const Bun: unknown;

// ESM 环境下 require 不可用，需通过 createRequire 构造
const _require = createRequire(import.meta.url);

// ── 统一接口 ──

export interface DbStatement {
  run(...params: unknown[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

export interface DbAdapter {
  prepare(sql: string): DbStatement;
  exec(sql: string): void;
  pragma(directive: string, value?: unknown): unknown;
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  close(): void;
}

// ── BetterSqliteAdapter（Node.js 环境）──

class BetterSqliteAdapter implements DbAdapter {
  private db: any; // better-sqlite3 Database 实例

  constructor(db: any) {
    this.db = db;
  }

  prepare(sql: string): DbStatement {
    return this.db.prepare(sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(directive: string, value?: unknown): unknown {
    if (value !== undefined) {
      return this.db.pragma(directive, value);
    }
    return this.db.pragma(directive);
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }
}

// ── BunSqliteAdapter（Bun 环境）──

/**
 * 将 bun:sqlite 查询结果中的 Uint8Array 字段统一转为 Buffer，
 * 保持与 better-sqlite3 一致的行为。
 */
function normalizeRow(row: any): any {
  if (row == null || typeof row !== "object") return row;
  for (const key of Object.keys(row)) {
    if (row[key] instanceof Uint8Array && !Buffer.isBuffer(row[key])) {
      row[key] = Buffer.from(row[key]);
    }
  }
  return row;
}

/**
 * 包装 bun:sqlite 的 Statement，适配 DbStatement 接口。
 *
 * bun:sqlite 的 stmt.run() 不返回 changes/lastInsertRowid，
 * 需要额外查询 changes() 和 last_insert_rowid()。
 */
class BunStatementWrapper implements DbStatement {
  private db: any; // bun:sqlite Database 实例
  private stmt: any; // bun:sqlite Statement 实例

  constructor(db: any, stmt: any) {
    this.db = db;
    this.stmt = stmt;
  }

  run(...params: unknown[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  } {
    this.stmt.run(...params);
    // bun:sqlite 的 run() 返回 undefined，需用内置属性获取元信息
    const info = this.db
      .query(
        "SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid",
      )
      .get();
    return {
      changes: info.changes as number,
      lastInsertRowid: info.lastInsertRowid as number | bigint,
    };
  }

  get(...params: unknown[]): any {
    return normalizeRow(this.stmt.get(...params));
  }

  all(...params: unknown[]): any[] {
    const rows = this.stmt.all(...params);
    return rows.map(normalizeRow);
  }
}

class BunSqliteAdapter implements DbAdapter {
  private db: any; // bun:sqlite Database 实例

  constructor(db: any) {
    this.db = db;
  }

  prepare(sql: string): DbStatement {
    return new BunStatementWrapper(this.db, this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(directive: string, _value?: unknown): unknown {
    // bun:sqlite 没有 .pragma() 方法，用 query("PRAGMA ...") 替代
    const result = this.db.query(`PRAGMA ${directive}`).get();
    // PRAGMA 返回值通常是 { journal_mode: "wal" } 之类的对象，取第一个值
    if (result && typeof result === "object") {
      const values = Object.values(result);
      return values.length === 1 ? values[0] : result;
    }
    return result;
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }
}

// ── 工厂函数 ──

/**
 * 根据运行时环境创建数据库适配器。
 *
 * - Bun 环境（typeof Bun !== "undefined"）：使用 bun:sqlite
 * - Node.js 环境：使用 better-sqlite3
 *
 * 无论哪种后端，都会执行初始化 PRAGMA（WAL 模式 + 外键约束）。
 */
export function createDatabase(path: string): DbAdapter {
  const isBun = typeof Bun !== "undefined";

  if (isBun) {
    // 动态 import bun:sqlite — 不能被打包工具静态分析
    const { Database } = _require("bun:sqlite");
    const raw = new Database(path);
    const adapter = new BunSqliteAdapter(raw);
    adapter.pragma("journal_mode = WAL");
    adapter.pragma("foreign_keys = ON");
    return adapter;
  }

  // Node.js：使用 better-sqlite3
  const BetterSqlite3 = _require("better-sqlite3");
  const raw = new BetterSqlite3(path);
  const adapter = new BetterSqliteAdapter(raw);
  adapter.pragma("journal_mode = WAL");
  adapter.pragma("foreign_keys = ON");
  return adapter;
}
