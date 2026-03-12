import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
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

/** Generate speech via node-edge-tts (Node.js, no Python) → mp3 file */
async function edgeTts(
  text: string,
  voice: string,
  outPath: string,
): Promise<void> {
  const { EdgeTTS } = await import("node-edge-tts");
  const tts = new EdgeTTS({ voice });
  await tts.ttsPromise(text, outPath);
}

/** Generate speech via vibevoice HTTP service → buffer */
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

/** Convert mp3 file to ogg/opus via ffmpeg */
function toOggOpus(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-i", inputPath, "-c:a", "libopus", "-b:a", "48k", outputPath],
      { timeout: 15_000, windowsHide: true },
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

export type TtsFormat = "mp3" | "ogg";

/**
 * Text-to-speech: returns file path or null.
 * - format "mp3": direct output, no ffmpeg
 * - format "ogg": mp3 → ffmpeg → ogg/opus
 */
export async function textToSpeech(
  text: string,
  format: TtsFormat = "ogg",
): Promise<string | null> {
  const cleaned = cleanForSpeech(text);
  if (!cleaned || cleaned.length > MAX_TTS_LENGTH) return null;

  const provider = process.env.TTS_PROVIDER || "edge";
  const voice = process.env.TTS_VOICE || "zh-CN-XiaoxiaoNeural";

  const tmpDir = resolvePath(process.cwd(), "data", "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const ts = Date.now();

  try {
    if (provider === "vibevoice") {
      const buf = await vibevoiceTts(cleaned, voice);
      const mp3Path = join(tmpDir, `tts_${ts}.mp3`);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(mp3Path, buf);
      if (format === "mp3") return mp3Path;
      const oggPath = join(tmpDir, `tts_${ts}.ogg`);
      await toOggOpus(mp3Path, oggPath);
      return oggPath;
    }

    // edge-tts (default)
    const mp3Path = join(tmpDir, `tts_${ts}.mp3`);
    await edgeTts(cleaned, voice, mp3Path);

    if (format === "mp3") return mp3Path;

    // Convert to ogg/opus for Telegram/WhatsApp voice notes
    const oggPath = join(tmpDir, `tts_${ts}.ogg`);
    await toOggOpus(mp3Path, oggPath);
    return oggPath;
  } catch (err: any) {
    console.error("[tts] Failed:", err.message);
    return null;
  }
}
