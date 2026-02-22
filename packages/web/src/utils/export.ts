export interface ExportMessage {
  role: string;
  content: string;
  createdAt?: string;
  model?: string;
}

/**
 * 将对话消息导出为 Markdown 文件并触发浏览器下载。
 * 纯函数，不依赖 React。
 */
export function exportAsMarkdown(
  messages: ExportMessage[],
  title?: string,
): void {
  const heading = title || "Chat Export";
  const exportDate = new Date().toLocaleString();

  const lines: string[] = [
    `# ${heading}`,
    "",
    `_Exported on ${exportDate}_`,
    "",
  ];

  for (const msg of messages) {
    const roleLabel = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
    lines.push(`## ${roleLabel}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");

    if (msg.createdAt) {
      lines.push(`_${msg.createdAt}_`);
      lines.push("");
    }
  }

  const markdown = lines.join("\n");

  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(title || "chat").replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
