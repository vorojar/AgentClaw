#!/usr/bin/env bun
/**
 * 桌面版 Sidecar 构建脚本
 *
 * 策略：用 Bun bundler 一步打包+编译。
 * 对 native addon / 不需要的可选依赖创建空 shim，避免编译报错。
 *
 * 用法：bun run packages/desktop/build-sidecar.ts [--target=bun-windows-x64]
 */
import { $ } from "bun";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(import.meta.dir, "../..");
const GATEWAY_ENTRY = resolve(ROOT, "packages/gateway/dist/index.js");
const BIN_DIR = resolve(import.meta.dir, "src-tauri/binaries");
const SHIM_DIR = resolve(import.meta.dir, ".shims");

// Bun --compile 的 target triple → Tauri sidecar 文件名后缀映射
const TARGET_MAP: Record<string, string> = {
  "bun-windows-x64": "agentclaw-server-x86_64-pc-windows-msvc.exe",
  "bun-darwin-arm64": "agentclaw-server-aarch64-apple-darwin",
  "bun-darwin-x64": "agentclaw-server-x86_64-apple-darwin",
  "bun-linux-x64": "agentclaw-server-x86_64-unknown-linux-gnu",
  "bun-linux-arm64": "agentclaw-server-aarch64-unknown-linux-gnu",
};

/**
 * 需要 shim 的模块：native addon 或桌面版不需要的可选依赖。
 * Shim 会创建一个空的 package + index.js，让 bundler 解析成功但运行时为空操作。
 */
const SHIM_MODULES: Record<string, string> = {
  // better-sqlite3：桌面版用 bun:sqlite，这个不会被调用（createRequire 动态加载）
  "better-sqlite3": `
    class Database { constructor() { throw new Error("better-sqlite3 not available in Bun desktop build"); } }
    module.exports = Database;
    module.exports.default = Database;
  `,
  // sherpa-onnx：语音识别，桌面版 v1 不支持
  "sherpa-onnx-node": "module.exports = {};",
  "sherpa-onnx-win-x64": "module.exports = {};",
  // playwright：browser 工具的可选依赖，桌面版通过系统 Chrome CDP 交互
  "playwright-core": `
    module.exports = { chromium: {}, firefox: {}, webkit: {} };
    module.exports.default = module.exports;
  `,
  "chromium-bidi/lib/cjs/bidiMapper/BidiMapper": "module.exports = {};",
  "chromium-bidi/lib/cjs/cdp/CdpConnection": "module.exports = {};",
  // electron：playwright 内部可选依赖
  electron: "module.exports = {};",
};

/** 创建 shim 模块 */
function createShims() {
  mkdirSync(SHIM_DIR, { recursive: true });

  for (const [name, code] of Object.entries(SHIM_MODULES)) {
    const dir = join(SHIM_DIR, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.js"), code);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name, version: "0.0.0", main: "index.js" }),
    );
  }
}

/** 清理 shim 模块 */
function cleanShims() {
  try {
    rmSync(SHIM_DIR, { recursive: true, force: true });
  } catch {}
}

async function main() {
  // 解析参数
  const targetArg = process.argv.find((a) => a.startsWith("--target="));
  const target = targetArg?.split("=")[1] || "bun-windows-x64";

  const outName = TARGET_MAP[target];
  if (!outName) {
    console.error(`不支持的 target: ${target}`);
    console.error(`支持: ${Object.keys(TARGET_MAP).join(", ")}`);
    process.exit(1);
  }

  const outFile = resolve(BIN_DIR, outName);
  mkdirSync(BIN_DIR, { recursive: true });

  // 确保 gateway 已构建
  if (!existsSync(GATEWAY_ENTRY)) {
    console.log("[0] Gateway 未构建，先执行 npm run build...");
    await $`cd ${ROOT} && npm run build`.quiet();
  }

  // 创建 shim 模块
  console.log("[1/2] 创建 shim 模块...");
  createShims();

  try {
    // 编译：通过 NODE_PATH 让 Bun 优先查找 shim 目录
    console.log(`[2/2] 编译 ${target}...`);
    const shimNodeModules = join(SHIM_DIR, "node_modules");
    await $`bun build ${GATEWAY_ENTRY} --compile --target=${target} --outfile=${outFile}`.env({
      ...process.env,
      NODE_PATH: shimNodeModules,
    });

    console.log(`\n✓ Sidecar 构建完成: ${outFile}`);
  } finally {
    cleanShims();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
