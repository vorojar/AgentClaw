/**
 * 服务健康检查模块
 *
 * 检查各外部依赖服务的可用性，将结果格式化后注入系统提示词，
 * 让 LLM 知道哪些能力当前可用/不可用。
 *
 * 只检查配置了环境变量的服务，未配置的跳过。
 * 所有检查并发执行，单项失败不影响其他。
 */

import { createConnection } from "node:net";
import { isExtensionConnected } from "./routes/browser-ext.js";

export interface HealthCheckResult {
  name: string;
  ok: boolean;
  message: string;
}

/** 所有检查的超时时间（毫秒） */
const CHECK_TIMEOUT = 3_000;

/**
 * 检查 IMAP 邮件服务器 TCP 连接
 * 条件：EMAIL_IMAP_HOST 环境变量已设置
 */
async function checkIMAP(): Promise<HealthCheckResult | null> {
  const host = process.env.EMAIL_IMAP_HOST;
  if (!host) return null;

  const port = parseInt(process.env.EMAIL_IMAP_PORT || "993", 10);

  return new Promise<HealthCheckResult>((resolve) => {
    const socket = createConnection({ host, port, timeout: CHECK_TIMEOUT });

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.on("connect", () => {
      cleanup();
      resolve({
        name: "IMAP 邮件",
        ok: true,
        message: `${host}:${port} 连接成功`,
      });
    });

    socket.on("timeout", () => {
      cleanup();
      resolve({
        name: "IMAP 邮件",
        ok: false,
        message: `${host}:${port} 连接超时`,
      });
    });

    socket.on("error", (err) => {
      cleanup();
      resolve({
        name: "IMAP 邮件",
        ok: false,
        message: `${host}:${port} 连接失败: ${err.message}`,
      });
    });
  });
}

/**
 * 检查 SearXNG 搜索引擎
 * 条件：SEARXNG_URL 环境变量已设置，或默认 http://localhost:8888
 */
async function checkSearXNG(): Promise<HealthCheckResult | null> {
  // 只有明确配置了 SEARXNG_URL 才检查
  const url = process.env.SEARXNG_URL;
  if (!url) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT);

    // SearXNG 可能没有 /healthz，先尝试根路径
    const resp = await fetch(`${url}/healthz`, {
      signal: controller.signal,
    }).catch(() => fetch(url, { signal: controller.signal }));

    clearTimeout(timer);

    if (resp.ok) {
      return { name: "SearXNG 搜索引擎", ok: true, message: "可用" };
    }

    return {
      name: "SearXNG 搜索引擎",
      ok: false,
      message: `HTTP ${resp.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "SearXNG 搜索引擎",
      ok: false,
      message: msg.includes("abort") ? "连接超时" : `连接失败: ${msg}`,
    };
  }
}

/**
 * 检查 Chrome 浏览器扩展 WebSocket 连接状态
 * 始终检查（扩展是否连接取决于运行时状态，不需要环境变量）
 */
function checkChromeExtension(): HealthCheckResult {
  const connected = isExtensionConnected();
  return {
    name: "Chrome 浏览器扩展",
    ok: connected,
    message: connected ? "已连接" : "未连接",
  };
}

/**
 * 检查 ComfyUI 图片生成服务
 * 条件：COMFYUI_URL 环境变量已设置，或默认 http://127.0.0.1:8000
 */
async function checkComfyUI(): Promise<HealthCheckResult | null> {
  const url = process.env.COMFYUI_URL || "http://127.0.0.1:8000";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT);

    const resp = await fetch(`${url}/system_stats`, {
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (resp.ok) {
      return { name: "ComfyUI 图片生成", ok: true, message: "可用" };
    }

    return {
      name: "ComfyUI 图片生成",
      ok: false,
      message: `HTTP ${resp.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "ComfyUI 图片生成",
      ok: false,
      message: msg.includes("abort") ? "连接超时" : `连接失败`,
    };
  }
}

/**
 * 运行所有健康检查，并发执行
 * 返回所有已配置服务的检查结果
 */
export async function runHealthChecks(): Promise<HealthCheckResult[]> {
  // 收集所有需要执行的检查（null 表示未配置，跳过）
  const checks = await Promise.allSettled([
    checkIMAP(),
    checkSearXNG(),
    Promise.resolve(checkChromeExtension()),
    checkComfyUI(),
  ]);

  const results: HealthCheckResult[] = [];
  for (const check of checks) {
    if (check.status === "fulfilled" && check.value !== null) {
      results.push(check.value);
    }
    // rejected 的检查已在各函数内 try/catch，不会走到这里
  }

  return results;
}

/**
 * 将检查结果格式化为系统提示词注入文本
 * 策略：只显示不正常的项（节省 token）；全部正常时返回空字符串
 */
export function formatHealthResults(results: HealthCheckResult[]): string {
  const failed = results.filter((r) => !r.ok);

  if (failed.length === 0) {
    return "";
  }

  const items = failed.map((r) => `${r.name}（${r.message}）`).join("、");

  return `[注意] 以下服务当前不可用：${items}。涉及这些服务的请求请告知用户。\n`;
}
