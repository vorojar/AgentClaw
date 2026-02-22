import { FastifyInstance } from "fastify";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";

export async function registerUploadRoutes(
  app: FastifyInstance,
): Promise<void> {
  const uploadDir = join(process.cwd(), "data", "tmp");
  await mkdir(uploadDir, { recursive: true });

  app.post("/api/upload", async (req, reply) => {
    const file = await req.file();
    if (!file) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const ext = extname(file.filename) || "";
    const id = randomBytes(8).toString("hex");
    const savedName = `${id}${ext}`;
    const savedPath = join(uploadDir, savedName);

    await pipeline(file.file, createWriteStream(savedPath));

    const url = `/files/${encodeURIComponent(savedName)}`;
    return {
      url,
      filename: file.filename,
      savedName,
      path: savedPath.replace(/\\/g, "/"),
    };
  });
}
