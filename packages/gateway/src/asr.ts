/**
 * ASR (Automatic Speech Recognition) module — Node-native via sherpa-onnx.
 *
 * Lazy-loads Whisper model on first call, auto-unloads after idle timeout.
 * Replaces the previous Python faster-whisper approach for zero cold-start
 * on consecutive calls.
 */

import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";

/* ── Config ── */

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MODEL_DIR_NAME = "sherpa-onnx-whisper-small";
const MODEL_PREFIX = "small"; // matches file names: small-encoder.int8.onnx, etc.

/* ── pnpm-compatible sherpa-onnx loader ── */

let _sherpa: SherpaOnnx | null = null;

interface SherpaOnnx {
  OfflineRecognizer: new (config: unknown) => OfflineRecognizerInstance;
  readWave: (filename: string, enableExternalBuffer?: boolean) => WaveObject;
}

interface OfflineRecognizerInstance {
  createStream: () => OfflineStreamInstance;
  decode: (stream: OfflineStreamInstance) => void;
  getResult: (stream: OfflineStreamInstance) => { text: string; lang?: string };
}

interface OfflineStreamInstance {
  acceptWaveform: (obj: { samples: Float32Array; sampleRate: number }) => void;
}

interface WaveObject {
  samples: Float32Array;
  sampleRate: number;
}

function loadSherpa(): SherpaOnnx {
  if (_sherpa) return _sherpa;

  // Workaround: pnpm virtual store prevents sherpa-onnx-node from finding
  // its platform-specific native addon via relative paths. We pre-populate
  // the require cache for addon-static-import.js with the resolved binary.
  const platform = os.platform() === "win32" ? "win" : os.platform();
  const nativePkg = `sherpa-onnx-${platform}-${os.arch()}`;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nativePath = require.resolve(`${nativePkg}/sherpa-onnx.node`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nativeAddon = require(nativePath);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const addonStaticPath =
    require.resolve("sherpa-onnx-node/addon-static-import.js");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cache = require.cache as Record<string, unknown>;
  cache[addonStaticPath] = {
    id: addonStaticPath,
    filename: addonStaticPath,
    loaded: true,
    exports: nativeAddon,
    children: [],
    paths: [],
    path: require("node:path").dirname(addonStaticPath),
  };

  // Now sherpa-onnx-node will find the addon
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _sherpa = require("sherpa-onnx-node") as SherpaOnnx;
  return _sherpa;
}

/* ── Lazy model state ── */

let recognizer: OfflineRecognizerInstance | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function getModelDir(): string {
  return join(process.cwd(), "data", "models", MODEL_DIR_NAME);
}

function loadRecognizer(): OfflineRecognizerInstance {
  const sherpa = loadSherpa();
  const modelDir = getModelDir();
  // Prefer int8 quantized models; fall back to full-precision if not available
  const encoderInt8 = join(modelDir, `${MODEL_PREFIX}-encoder.int8.onnx`);
  const encoderFull = join(modelDir, `${MODEL_PREFIX}-encoder.onnx`);
  const decoderInt8 = join(modelDir, `${MODEL_PREFIX}-decoder.int8.onnx`);
  const decoderFull = join(modelDir, `${MODEL_PREFIX}-decoder.onnx`);
  const encoder = existsSync(encoderInt8) ? encoderInt8 : encoderFull;
  const decoder = existsSync(decoderInt8) ? decoderInt8 : decoderFull;
  const tokens = join(modelDir, `${MODEL_PREFIX}-tokens.txt`);

  if (!existsSync(encoder)) {
    throw new Error(
      `ASR model not found at ${modelDir}. Download with:\n` +
        `  cd data/models && curl -L https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_DIR_NAME}.tar.bz2 | tar xjf -`,
    );
  }

  const config = {
    modelConfig: {
      whisper: {
        encoder,
        decoder,
        language: "", // auto-detect
        task: "transcribe",
        tailPaddings: -1,
      },
      tokens,
      numThreads: Math.min(os.cpus().length, 4),
      debug: 0,
      provider: "cpu",
    },
    decodingMethod: "greedy_search",
  };

  console.log("[ASR] Loading Whisper model...");
  const rec = new sherpa.OfflineRecognizer(config);
  console.log("[ASR] Model loaded.");
  return rec;
}

function getRecognizer(): OfflineRecognizerInstance {
  if (!recognizer) {
    recognizer = loadRecognizer();
  }
  resetIdleTimer();
  return recognizer;
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log("[ASR] Idle timeout — unloading model.");
    recognizer = null; // let GC reclaim
    idleTimer = null;
  }, IDLE_TIMEOUT_MS);
}

/* ── SILK detection (QQ/WeChat voice) ── */

function isSilk(filePath: string): boolean {
  try {
    const fd = openSync(filePath, "r");
    const buf = Buffer.alloc(10);
    readSync(fd, buf, 0, 10, 0);
    closeSync(fd);
    return (
      buf.includes(Buffer.from("SILK_V3")) ||
      buf.includes(Buffer.from("#!SILK"))
    );
  } catch {
    return false;
  }
}

/* ── Audio format conversion ── */

async function decodeSilk(inputPath: string): Promise<string> {
  // silk-wasm decodes SILK to PCM (s16le, 24000 Hz mono)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const silk = require("silk-wasm") as {
    decode: (
      input: Buffer,
      sampleRate: number,
    ) => Promise<{ data: Uint8Array; duration: number }>;
  };
  const silkBuf = readFileSync(inputPath);
  const { data: pcmBuf } = await silk.decode(silkBuf, 24000);
  // Write raw PCM, then use ffmpeg to wrap as 16kHz WAV
  const pcmPath = inputPath + ".asr.pcm";
  const wavPath = inputPath + ".asr.wav";
  writeFileSync(pcmPath, pcmBuf);
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "s16le",
        "-ar",
        "24000",
        "-ac",
        "1",
        "-i",
        pcmPath,
        "-ar",
        "16000",
        "-f",
        "wav",
        wavPath,
      ],
      { timeout: 15000, windowsHide: true },
    );
  } finally {
    try {
      unlinkSync(pcmPath);
    } catch {
      /* ignore */
    }
  }
  return wavPath;
}

function convertToWav(inputPath: string): string {
  const wavPath = inputPath + ".asr.wav";
  execFileSync(
    "ffmpeg",
    ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-f", "wav", wavPath],
    { timeout: 15000, windowsHide: true },
  );
  return wavPath;
}

/* ── Public API ── */

/**
 * Transcribe an audio file to text.
 * Supports WAV, OGG, MP3, SILK (QQ/WeChat voice), and any ffmpeg-supported format.
 *
 * @param filePath - Absolute path to the audio file
 * @returns Transcribed text, or empty string on failure
 */
export async function transcribe(filePath: string): Promise<string> {
  const sherpa = loadSherpa();
  const rec = getRecognizer();

  let wavPath = filePath;
  let cleanup: string | null = null;

  // SILK → decode via silk-wasm + ffmpeg resample
  // Non-WAV → convert via ffmpeg
  if (isSilk(filePath)) {
    try {
      wavPath = await decodeSilk(filePath);
      cleanup = wavPath;
    } catch (err) {
      console.error("[ASR] SILK decode failed:", err);
      return "";
    }
  } else if (!filePath.toLowerCase().endsWith(".wav")) {
    try {
      wavPath = convertToWav(filePath);
      cleanup = wavPath;
    } catch (err) {
      console.error("[ASR] ffmpeg conversion failed:", err);
      return "";
    }
  }

  try {
    const wave = sherpa.readWave(wavPath, true);
    const stream = rec.createStream();
    stream.acceptWaveform({
      samples: wave.samples,
      sampleRate: wave.sampleRate,
    });
    rec.decode(stream);
    const result = rec.getResult(stream);
    return (result.text || "").trim();
  } catch (err) {
    console.error("[ASR] Transcription failed:", err);
    return "";
  } finally {
    if (cleanup) {
      try {
        unlinkSync(cleanup);
      } catch {
        /* ignore */
      }
    }
  }
}
