import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellTool } from "../builtin/shell.js";

/**
 * Shell 安全沙箱测试。
 *
 * validateCommand 是 shell.ts 的私有函数，无法直接导入。
 * 测试策略：调用 shellTool.execute() 传入危险命令，
 * 验证返回结果包含"沙箱拦截"错误信息（不会真正执行命令）。
 *
 * 为防止意外执行，我们 mock child_process.execFile。
 */

// Mock child_process 以防万一有命令通过验证时不会真正执行
vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const child = {
        pid: 9999,
        on: vi.fn(),
        kill: vi.fn(),
      };
      // 模拟立即成功返回
      if (cb) {
        setTimeout(() => cb(null, Buffer.from("mocked"), Buffer.from("")), 0);
      }
      return child;
    },
  ),
  execFileSync: vi.fn(() => ""),
}));

describe("Shell 沙箱验证 (validateCommand)", () => {
  const originalEnv = process.env.SHELL_SANDBOX;

  beforeEach(() => {
    delete process.env.SHELL_SANDBOX;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SHELL_SANDBOX = originalEnv;
    } else {
      delete process.env.SHELL_SANDBOX;
    }
  });

  /** 辅助函数：执行命令并返回结果 */
  async function execCommand(command: string) {
    return shellTool.execute({ command });
  }

  /** 辅助函数：验证命令被沙箱拦截 */
  async function expectBlocked(command: string, keyword?: string) {
    const result = await execCommand(command);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("沙箱拦截");
    if (keyword) {
      expect(result.content).toContain(keyword);
    }
  }

  /** 辅助函数：验证命令被允许通过 */
  async function expectAllowed(command: string) {
    const result = await execCommand(command);
    // 通过验证的命令不应包含沙箱拦截
    expect(result.content).not.toContain("沙箱拦截");
  }

  describe("rm -rf 危险操作拦截", () => {
    it("应拦截 rm -rf /（根目录删除）", async () => {
      await expectBlocked("rm -rf / ", "根目录递归删除");
    });

    it("应拦截 rm -rf /（紧跟行尾）", async () => {
      await expectBlocked("rm -rf /", "根目录递归删除");
    });

    it("应拦截 rm -rf /etc（系统目录）", async () => {
      await expectBlocked("rm -rf /etc", "系统目录");
    });

    it("应拦截 rm -rf /boot", async () => {
      await expectBlocked("rm -rf /boot", "系统目录");
    });

    it("应拦截 rm -rf /usr", async () => {
      await expectBlocked("rm -rf /usr", "系统目录");
    });

    it("应拦截 rm -rf /var", async () => {
      await expectBlocked("rm -rf /var", "系统目录");
    });

    it("应拦截 rm -fr /etc（-fr 变体）", async () => {
      await expectBlocked("rm -fr /etc", "系统目录");
    });
  });

  describe("磁盘格式化拦截", () => {
    it("应拦截 format C:", async () => {
      await expectBlocked("format C:", "format 磁盘");
    });

    it("应拦截 format D:（大小写不敏感）", async () => {
      await expectBlocked("Format D:", "format 磁盘");
    });

    it("应拦截 mkfs 命令", async () => {
      await expectBlocked("mkfs.ext4 /dev/sda1", "mkfs");
    });
  });

  describe("系统控制命令拦截", () => {
    it("应拦截 shutdown", async () => {
      await expectBlocked("shutdown -h now", "shutdown");
    });

    it("应拦截 reboot", async () => {
      await expectBlocked("reboot", "reboot");
    });

    it("应拦截 halt", async () => {
      await expectBlocked("halt", "halt");
    });

    it("应拦截 init 0", async () => {
      await expectBlocked("init 0", "init 0");
    });
  });

  describe("Fork bomb 拦截", () => {
    it("应拦截 bash fork bomb :(){ :|:& };:", async () => {
      await expectBlocked(":(){ :|:& };:", "fork bomb");
    });
  });

  describe("dd 写入磁盘设备拦截", () => {
    it("应拦截 dd if=/dev/zero of=/dev/sda", async () => {
      await expectBlocked(
        "dd if=/dev/zero of=/dev/sda bs=1M",
        "dd 写入磁盘设备",
      );
    });

    it("应拦截 dd of=/dev/hda", async () => {
      await expectBlocked("dd if=/dev/random of=/dev/hda", "dd 写入磁盘设备");
    });
  });

  describe("Windows 注册表删除拦截", () => {
    it("应拦截 reg delete HKLM", async () => {
      await expectBlocked(
        "reg delete HKLM\\SOFTWARE\\Test",
        "reg delete 系统注册表",
      );
    });

    it("应拦截 reg delete HKCR", async () => {
      await expectBlocked(
        "reg delete HKCR\\SomeClass",
        "reg delete 系统注册表",
      );
    });
  });

  describe("fdisk 拦截", () => {
    it("应拦截 fdisk /dev/sda", async () => {
      await expectBlocked("fdisk /dev/sda", "fdisk");
    });
  });

  describe("写入 System32 拦截", () => {
    it("应拦截写入 C:\\Windows\\System32", async () => {
      await expectBlocked(
        "echo malware > C:\\Windows\\System32\\evil.exe",
        "写入 System32",
      );
    });
  });

  describe("正常命令应允许通过", () => {
    it("应允许 ls", async () => {
      await expectAllowed("ls -la");
    });

    it("应允许 cat", async () => {
      await expectAllowed("cat /etc/hosts");
    });

    it("应允许 git status", async () => {
      await expectAllowed("git status");
    });

    it("应允许 npm install", async () => {
      await expectAllowed("npm install");
    });

    it("应允许 echo hello", async () => {
      await expectAllowed("echo hello");
    });

    it("应允许在用户目录下的 rm -rf", async () => {
      await expectAllowed("rm -rf ./node_modules");
    });

    it("应允许 rm 不带 -rf 的形式", async () => {
      await expectAllowed("rm file.txt");
    });
  });

  describe("跨平台 shell 策略", () => {
    it("应拦截普通任务中的 PowerShell 方言，要求改用通用命令", async () => {
      const result = await execCommand("Get-ChildItem -Force");

      expect(result.isError).toBe(true);
      expect(result.content).toContain("跨平台");
      expect(result.content).toContain("ls");
    });

    it("应拦截 powershell -Command 包装的普通文件操作", async () => {
      const result = await execCommand(
        'powershell -NoProfile -Command "Get-Content package.json"',
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain("跨平台");
      expect(result.content).toContain("file_read");
    });

    it("应允许注册表读取等 Windows 专项 PowerShell 场景", async () => {
      await expectAllowed(
        'powershell -NoProfile -Command "Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion"',
      );
    });
  });

  describe("命令退出码语义", () => {
    it("非 0 退出即使有 stdout 也应标记为错误", async () => {
      vi.mocked(execFile).mockImplementationOnce(((
        _cmd: string,
        _args: unknown,
        _opts: unknown,
        cb: Function,
      ) => {
        const child = {
          pid: 9999,
          on: vi.fn(),
          kill: vi.fn(),
        };
        const error = new Error("Command failed") as Error & { code: number };
        error.code = 1;
        setTimeout(
          () =>
            cb(error, Buffer.from("partial stdout"), Buffer.from("bad stderr")),
          0,
        );
        return child as never;
      }) as never);

      const result = await execCommand("echo partial && exit 1");

      expect(result.isError).toBe(true);
      expect(result.metadata?.exitCode).toBe(1);
      expect(result.content).toContain("partial stdout");
      expect(result.content).toContain("bad stderr");
    });
  });

  describe("后台任务闭环", () => {
    it("启动后台任务时应记录 running，完成后更新状态并通知用户", async () => {
      const recordBackgroundJob = vi.fn().mockResolvedValue(undefined);
      const updateBackgroundJob = vi.fn().mockResolvedValue(undefined);
      const notifyUser = vi.fn().mockResolvedValue(undefined);
      const backgroundQueue: NonNullable<
        Parameters<typeof shellTool.execute>[1]
      >["backgroundQueue"] = [];

      const context = {
        backgroundQueue,
        recordBackgroundJob,
        updateBackgroundJob,
        notifyUser,
        conversationId: "conv-1",
        traceId: "trace-1",
        agentId: "agent-1",
      } as never;

      const result = await shellTool.execute(
        { command: "echo done", background: true },
        context,
      );

      expect(result.isError).toBe(false);
      expect(result.metadata?.backgroundId).toMatch(/^bg_/);
      expect(result.metadata?.pid).toBe(9999);
      expect(recordBackgroundJob).toHaveBeenCalledWith(
        expect.objectContaining({
          id: result.metadata?.backgroundId,
          command: "echo done",
          status: "running",
          pid: 9999,
          conversationId: "conv-1",
          traceId: "trace-1",
          agentId: "agent-1",
        }),
      );

      await vi.waitFor(() => {
        expect(updateBackgroundJob).toHaveBeenCalledWith(
          result.metadata?.backgroundId,
          expect.objectContaining({
            status: "completed",
            exitCode: 0,
            output: "mocked",
          }),
        );
      });
      expect(notifyUser).toHaveBeenCalledWith(
        expect.stringContaining(
          `Background task ${result.metadata?.backgroundId} completed`,
        ),
      );
      expect(backgroundQueue).toHaveLength(1);
    });
  });

  describe("文件发送副作用", () => {
    it("未设置 auto_send 时不应发送命令参数里的文件路径", async () => {
      const root = join(tmpdir(), `agentclaw-shell-${Date.now()}`);
      const workDir = join(root, "data", "tmp", "trace-1");
      const outputPath = join(workDir, "final.txt");
      await mkdir(workDir, { recursive: true });
      await writeFile(outputPath, "done", "utf-8");
      const sendFile = vi.fn().mockResolvedValue(undefined);

      try {
        const result = await shellTool.execute(
          { command: `echo done > '${outputPath}'` },
          { workDir, sendFile } as never,
        );

        expect(result.isError).toBe(false);
        expect(sendFile).not.toHaveBeenCalled();
        expect(result.autoComplete).not.toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("SHELL_SANDBOX=false 禁用沙箱", () => {
    it("设置 SHELL_SANDBOX=false 时应跳过所有验证", async () => {
      process.env.SHELL_SANDBOX = "false";

      // 这些危险命令在禁用沙箱时不应被拦截
      await expectAllowed("rm -rf /");
      await expectAllowed("shutdown -h now");
      await expectAllowed("format C:");
    });
  });
});
