import type { FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  rmSync,
  readdirSync,
  renameSync,
  rmdirSync,
} from "node:fs";
import path from "node:path";
import type { AppContext } from "../bootstrap.js";

export function registerToolRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // GET /api/tools - List tools
  app.get("/api/tools", async (_req, reply) => {
    try {
      const tools = ctx.toolRegistry.list();
      const result = tools.map((t) => ({
        name: t.name,
        description: t.description,
        category: t.category,
      }));
      return reply.send(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/skills - List skills
  app.get("/api/skills", async (_req, reply) => {
    try {
      const skills = ctx.skillRegistry.list();
      const result = skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        enabled: s.enabled,
      }));
      return reply.send(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // PUT /api/skills/:id/enabled - Toggle skill enabled state
  app.put<{ Params: { id: string }; Body: { enabled: boolean } }>(
    "/api/skills/:id/enabled",
    async (req, reply) => {
      try {
        const { id } = req.params;
        const { enabled } = req.body;
        const skill = ctx.skillRegistry.get(id);
        if (!skill) {
          return reply.status(404).send({ error: "Skill not found" });
        }
        ctx.skillRegistry.setEnabled(id, enabled);
        return reply.send({ id, enabled });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // POST /api/skills/import/github - Import skill from GitHub repository
  app.post<{ Body: { url: string } }>(
    "/api/skills/import/github",
    async (req, reply) => {
      const { url } = req.body;
      if (!url) return reply.status(400).send({ error: "Missing url" });

      // Extract repo name from URL for skill directory name
      const repoName = url
        .replace(/\.git$/, "")
        .split("/")
        .pop();
      if (!repoName)
        return reply.status(400).send({ error: "Invalid GitHub URL" });

      const skillsDir = ctx.config.skillsDir || "./skills/";
      const targetDir = path.join(skillsDir, repoName);

      if (existsSync(targetDir)) {
        return reply
          .status(409)
          .send({ error: `Skill '${repoName}' already exists` });
      }

      try {
        execFileSync("git", ["clone", "--depth", "1", url, targetDir], {
          timeout: 30000,
        });
      } catch (err) {
        return reply.status(500).send({
          error:
            "Git clone failed: " +
            (err instanceof Error ? err.message : String(err)),
        });
      }

      // Verify SKILL.md exists
      const skillMdPath = path.join(targetDir, "SKILL.md");
      if (!existsSync(skillMdPath)) {
        rmSync(targetDir, { recursive: true, force: true });
        return reply
          .status(400)
          .send({ error: "No SKILL.md found in repository" });
      }

      // fs.watch will auto-detect, wait briefly for it to pick up
      await new Promise((r) => setTimeout(r, 500));
      const skill = ctx.skillRegistry.get(repoName);

      return reply.send({
        success: true,
        skill: skill
          ? {
              id: skill.id,
              name: skill.name,
              description: skill.description,
              enabled: skill.enabled,
            }
          : { id: repoName },
      });
    },
  );

  // POST /api/skills/import/zip - Import skill from uploaded zip file
  app.post("/api/skills/import/zip", async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: "No file uploaded" });

    const skillsDir = ctx.config.skillsDir || "./skills/";

    // Save to temp file
    const tmpDir = path.join(process.cwd(), "data", "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const tmpZip = path.join(tmpDir, `skill-import-${Date.now()}.zip`);
    const buf = await data.toBuffer();
    writeFileSync(tmpZip, buf);

    // Get skill name from filename (without .zip extension)
    const skillName = data.filename.replace(/\.zip$/i, "");
    const targetDir = path.join(skillsDir, skillName);

    if (existsSync(targetDir)) {
      unlinkSync(tmpZip);
      return reply
        .status(409)
        .send({ error: `Skill '${skillName}' already exists` });
    }

    // Extract zip — try tar first (Windows 10+ built-in), fallback to PowerShell
    try {
      mkdirSync(targetDir, { recursive: true });
      try {
        execFileSync("tar", ["-xf", tmpZip, "-C", targetDir], { timeout: 15000 });
      } catch {
        // Fallback: PowerShell Expand-Archive (Windows)
        execFileSync("powershell", ["-Command", `Expand-Archive -Path '${tmpZip}' -DestinationPath '${targetDir}'`], {
          timeout: 15000,
        });
      }
    } catch (err) {
      rmSync(targetDir, { recursive: true, force: true });
      unlinkSync(tmpZip);
      return reply.status(500).send({ error: "Extraction failed" });
    }

    unlinkSync(tmpZip);

    // Check for SKILL.md — it might be in a subdirectory (common zip wrapping)
    let skillMdPath = path.join(targetDir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      const entries = readdirSync(targetDir);
      if (entries.length === 1) {
        const nested = path.join(targetDir, entries[0], "SKILL.md");
        if (existsSync(nested)) {
          // Move contents up one level
          const nestedDir = path.join(targetDir, entries[0]);
          for (const f of readdirSync(nestedDir)) {
            renameSync(path.join(nestedDir, f), path.join(targetDir, f));
          }
          rmdirSync(nestedDir);
          skillMdPath = path.join(targetDir, "SKILL.md");
        }
      }
    }

    if (!existsSync(skillMdPath)) {
      rmSync(targetDir, { recursive: true, force: true });
      return reply.status(400).send({ error: "No SKILL.md found in archive" });
    }

    await new Promise((r) => setTimeout(r, 500));
    const skill = ctx.skillRegistry.get(skillName);

    return reply.send({
      success: true,
      skill: skill
        ? {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            enabled: skill.enabled,
          }
        : { id: skillName },
    });
  });

  // DELETE /api/skills/:id - Delete a skill
  app.delete<{ Params: { id: string } }>(
    "/api/skills/:id",
    async (req, reply) => {
      const { id } = req.params;
      const skill = ctx.skillRegistry.get(id);
      if (!skill) return reply.status(404).send({ error: "Skill not found" });

      // Remove the skill directory (skill.path points to SKILL.md)
      const skillDir = path.dirname(skill.path);
      try {
        rmSync(skillDir, { recursive: true, force: true });
      } catch {
        return reply
          .status(500)
          .send({ error: "Failed to delete skill directory" });
      }

      // fs.watch will auto-detect removal
      return reply.send({ success: true });
    },
  );
}
