import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
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

const MAX_TTS_LENGTH = 500;

export async function textToSpeech(text: string): Promise<string | null> {
  const cleaned = cleanForSpeech(text);
  if (!cleaned || cleaned.length > MAX_TTS_LENGTH) return null;

  const tmpDir = resolvePath(process.cwd(), "data", "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const outPath = join(tmpDir, `tts_${Date.now()}.ogg`);
  const scriptPath = resolvePath(process.cwd(), "scripts", "tts.py");

  return new Promise((res) => {
    execFile(
      "python",
      [scriptPath, cleaned, outPath],
      { timeout: 30_000, windowsHide: true },
      (err) => {
        if (err) {
          console.error("[tts] Failed:", err.message);
          res(null);
        } else {
          res(outPath);
        }
      },
    );
  });
}
