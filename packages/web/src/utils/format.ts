/**
 * 共享的格式化工具函数。
 * 多个页面（TracesPage, SubagentsPage, TokenLogsPage, SettingsPage 等）都需要这些函数。
 */

/** 格式化 ISO 时间戳为本地日期+时间 */
export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** 格式化 ISO 时间戳为仅时间 (HH:MM) */
export function formatTimeOnly(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** 数字千分位格式化 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/** 格式化毫秒时长为人类可读字符串 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
