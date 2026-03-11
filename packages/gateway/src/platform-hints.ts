/**
 * 渠道格式提示 — 注入到系统提示词，帮助 LLM 适配不同渠道的输出格式。
 */
export const PLATFORM_HINTS: Record<string, string> = {
  telegram:
    "你在 Telegram 渠道。不要使用 Markdown 格式（不会渲染）。发送媒体文件时设 auto_send: true。",
  discord: "你在 Discord 渠道。可以使用 Markdown 格式。",
  whatsapp: "你在 WhatsApp 渠道。不要使用 Markdown 格式。消息请简短。",
  qq: "你在 QQ Bot 渠道。支持少量 Markdown。消息请简短。",
  dingtalk: "你在钉钉渠道。支持 Markdown 格式。",
  feishu: "你在飞书渠道。支持富文本和 Markdown。",
  wecom: "你在企业微信渠道。不要使用 Markdown 格式。消息请简短。",
  ws: "", // WebSocket 客户端（Web UI），不需要特殊提示
  cli: "你在命令行终端。使用纯文本输出，避免过多 Markdown 格式。",
};

/**
 * 根据渠道名获取格式提示文本。
 * 未知渠道或 ws 返回空字符串。
 */
export function getPlatformHint(channel?: string): string {
  if (!channel) return "";
  return PLATFORM_HINTS[channel] ?? "";
}
