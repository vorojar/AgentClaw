export const WECHAT_PUBLISH_SCRIPT =
  "skills/wechat-publish/scripts/wechat_publish.py";

function normalizeCliPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function projectRootForWechatPublish(root = process.cwd()): string {
  return normalizeCliPath(root);
}

export function buildWechatPublishCommand(
  subcommand: "capabilities" | "inspect" | "publish",
  args = "",
  root = process.cwd(),
): string {
  const normalizedRoot = projectRootForWechatPublish(root);
  const trimmedArgs = args.trim();
  return `cd "${normalizedRoot}" && python ${WECHAT_PUBLISH_SCRIPT} ${subcommand}${trimmedArgs ? ` ${trimmedArgs}` : ""} --json`;
}

export function isAnchoredWechatPublishCommand(
  command: string,
  root = process.cwd(),
): boolean {
  const normalizedCommand = normalizeCliPath(command);
  const normalizedRoot = projectRootForWechatPublish(root);
  return (
    normalizedCommand.includes(normalizedRoot) &&
    normalizedCommand.includes(WECHAT_PUBLISH_SCRIPT)
  );
}
