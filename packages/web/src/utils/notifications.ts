/**
 * 请求浏览器通知权限。
 * 首次调用时弹出授权框，之后返回缓存的权限状态。
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * 当页面不在前台时发送浏览器通知。
 * @param title 通知标题
 * @param body 通知内容（截取前 100 字符）
 */
export function notifyIfHidden(title: string, body: string): void {
  if (document.visibilityState === "visible") return;
  if (Notification.permission !== "granted") return;

  new Notification(title, {
    body: body.slice(0, 100),
    icon: "/favicon.ico",
    tag: "agentclaw-response", // 同 tag 会替换旧通知
  });
}
