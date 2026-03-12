import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve as resolvePath, join } from "node:path";

/** Strip markdown formatting for speech output */
function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MAX_TTS_LENGTH = 1000;

/** Generate speech via @bestcodes/edge-tts (Node.js, no Python) */
async function edgeTts(text: string, voice: string): Promise<Buffer> {
  const { generateSpeech } = await import("@bestcodes/edge-tts");
  return generateSpeech({ text, voice }) as Promise<Buffer>;
}

/** Generate speech via vibevoice HTTP service */
async function vibevoiceTts(text: string, voice: string): Promise<Buffer> {
  const url = process.env.VIBEVOICE_URL || "http://localhost:8001";
  const res = await fetch(`${url}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) throw new Error(`vibevoice: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Convert mp3/wav buffer to ogg/opus via ffmpeg (pipe, no temp files) */
function toOggOpus(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      "ffmpeg",
      ["-i", "pipe:0", "-c:a", "libopus", "-b:a", "48k", "-f", "ogg", "pipe:1"],
      { encoding: "buffer" as any, timeout: 15_000, windowsHide: true },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout as unknown as Buffer);
      },
    );
    proc.stdin!.end(input);
  });
}

export type TtsFormat = "mp3" | "ogg";

/**
 * Text-to-speech: returns file path or null.
 * - format "mp3": direct output, no ffmpeg (~300-600ms)
 * - format "ogg": mp3 → ffmpeg pipe → ogg/opus (~500-800ms)
 */
export async function textToSpeech(
  text: string,
  format: TtsFormat = "ogg",
): Promise<string | null> {
  const cleaned = cleanForSpeech(text);
  if (!cleaned || cleaned.length > MAX_TTS_LENGTH) return null;

  const provider = process.env.TTS_PROVIDER || "edge";
  const voice = process.env.TTS_VOICE || "zh-CN-XiaoxiaoNeural";

  try {
    const raw =
      provider === "vibevoice"
        ? await vibevoiceTts(cleaned, voice)
        : await edgeTts(cleaned, voice);

    const tmpDir = resolvePath(process.cwd(), "data", "tmp");
    mkdirSync(tmpDir, { recursive: true });

    if (format === "mp3") {
      const outPath = join(tmpDir, `tts_${Date.now()}.mp3`);
      writeFileSync(outPath, raw);
      return outPath;
    }

    // ogg/opus
    const ogg = await toOggOpus(raw);
    const outPath = join(tmpDir, `tts_${Date.now()}.ogg`);
    writeFileSync(outPath, ogg);
    return outPath;
  } catch (err: any) {
    console.error("[tts] Failed:", err.message);
    return null;
  }
}
