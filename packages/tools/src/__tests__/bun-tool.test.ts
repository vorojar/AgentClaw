import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBuiltinTools } from "../builtin/index.js";
import { bunTool } from "../builtin/bun.js";

type ExecFileCallback = (
  error: Error | null,
  stdout: Buffer,
  stderr: Buffer,
) => void;

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: ExecFileCallback,
    ) => {
      const child = {
        pid: 4242,
        on: vi.fn(),
        kill: vi.fn(),
      };
      setTimeout(() => cb(null, Buffer.from("ok\n"), Buffer.from("")), 0);
      return child;
    },
  ),
}));

describe("bun tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is registered without replacing file and shell tools", () => {
    const names = createBuiltinTools().map((tool) => tool.name);

    expect(names).toContain("bun");
    expect(names).toContain("file_read");
    expect(names).toContain("file_write");
    expect(names).toContain("file_edit");
    expect(names).toContain("bash");
  });

  it("executes code through bun without shell interpolation and honors workDir", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentclaw-bun-"));

    const result = await bunTool.execute(
      {
        code: 'console.log(JSON.stringify({ name: "agentclaw", ok: true }))',
      },
      { workDir: root } as never,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toBe("ok\n");
    expect(result.effect).toMatchObject({
      kind: "read",
      reversible: false,
      verified: true,
    });
    expect(execFile).toHaveBeenCalledWith(
      "bun",
      ["--eval", 'console.log(JSON.stringify({ name: "agentclaw", ok: true }))'],
      expect.objectContaining({
        cwd: root,
        windowsHide: true,
        shell: false,
      }),
      expect.any(Function),
    );
  });

  it("marks obvious file writes as write effects", async () => {
    const result = await bunTool.execute({
      code: 'await Bun.write("report.json", JSON.stringify({ ok: true }))',
    });

    expect(result.isError).toBe(false);
    expect(result.effect).toMatchObject({
      kind: "write",
      reversible: false,
      verified: true,
    });
  });

  it("blocks destructive code before invoking bun", async () => {
    const result = await bunTool.execute({
      code: 'import { $ } from "bun"; await $`rm -rf /`',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("沙箱拦截");
    expect(execFile).not.toHaveBeenCalled();
    expect(result.effect).toMatchObject({
      kind: "delete",
      reversible: false,
      verified: true,
    });
  });

  it("returns a clear error when bun is not installed", async () => {
    vi.mocked(execFile).mockImplementationOnce(
      ((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        const child = {
          pid: 4242,
          on: vi.fn(),
          kill: vi.fn(),
        };
        const error = new Error("spawn bun ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        setTimeout(() => cb(error, Buffer.from(""), Buffer.from("")), 0);
        return child as never;
      }) as never,
    );

    const result = await bunTool.execute({ code: "console.log(1)" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Bun runtime not found");
    expect(result.metadata?.exitCode).toBe(127);
  });
});
