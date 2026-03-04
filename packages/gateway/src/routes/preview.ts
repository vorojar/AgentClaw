import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, extname, basename, dirname, relative } from "node:path";
import { execFile } from "node:child_process";
import { marked } from "marked";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { FastifyInstance } from "fastify";

/* ── LibreOffice detection ──────────────────────────── */

const SOFFICE_PATHS = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
];

function findSoffice(): string | null {
  for (const p of SOFFICE_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

const SOFFICE = findSoffice();

/* ── LRU Cache ──────────────────────────────────────── */

interface CacheEntry {
  data: Buffer;
  contentType: string;
  mtime: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE = 50;

function getCached(filePath: string, mtime: number): CacheEntry | null {
  const entry = cache.get(filePath);
  if (entry && entry.mtime === mtime) return entry;
  return null;
}

function setCache(filePath: string, entry: CacheEntry): void {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(filePath, entry);
}

/* ── HTML wrapper ───────────────────────────────────── */

function wrapHtml(title: string, body: string, extraStyles = ""): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    max-width: 860px; margin: 0 auto; padding: 24px 20px 60px;
    color: #1a1a1a; background: #fff; line-height: 1.7;
  }
  body { padding-top: 12px; }
  h1 { font-size: 1.8em; border-bottom: 2px solid #e5e5e5; padding-bottom: 8px; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 2em; }
  h3 { font-size: 1.15em; margin-top: 1.5em; }
  pre { background: #f6f8fa; border-radius: 6px; padding: 16px; overflow-x: auto; font-size: 14px; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; }
  img { max-width: 100%; border-radius: 6px; }
  a { color: #2563eb; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a2e; color: #e0e0e0; }
    pre { background: #16213e; }
    code { background: #1a1a3a; }
    th { background: #16213e; }
    th, td { border-color: #333; }
    h1, h2 { border-color: #333; }
    blockquote { border-color: #444; color: #aaa; }
  }
  ${extraStyles}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/* ── Converter result type ──────────────────────────── */

interface ConvertResult {
  data: Buffer;
  contentType: string;
}

/* ── Converters ─────────────────────────────────────── */

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_XLSX_ROWS = 1000;

const SPREADSHEET_STYLES = `
  body { max-width: none; padding: 12px; }
  table { font-size: 13px; }
  td, th { white-space: nowrap; max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
`;

function htmlResult(html: string): ConvertResult {
  return {
    data: Buffer.from(html, "utf-8"),
    contentType: "text/html; charset=utf-8",
  };
}

async function convertMarkdown(filePath: string): Promise<ConvertResult> {
  const md = readFileSync(filePath, "utf-8");
  const htmlBody = await marked.parse(md);
  const title = basename(filePath);
  return htmlResult(wrapHtml(title, htmlBody));
}

/** Fallback docx converter when LibreOffice is not available */
async function convertDocxFallback(filePath: string): Promise<ConvertResult> {
  const buf = readFileSync(filePath);
  const result = await mammoth.convertToHtml({ buffer: buf });
  const title = basename(filePath);
  return htmlResult(wrapHtml(title, result.value));
}

function convertXlsx(filePath: string): ConvertResult {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const title = basename(filePath);
  const parts: string[] = [];

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;

    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
    const rowCount = range.e.r - range.s.r + 1;
    let truncated = false;

    if (rowCount > MAX_XLSX_ROWS) {
      sheet["!ref"] = XLSX.utils.encode_range({
        s: range.s,
        e: { r: range.s.r + MAX_XLSX_ROWS - 1, c: range.e.c },
      });
      truncated = true;
    }

    const tableHtml = XLSX.utils.sheet_to_html(sheet);
    if (wb.SheetNames.length > 1) {
      parts.push(`<h2>${name}</h2>`);
    }
    parts.push(tableHtml);
    if (truncated) {
      parts.push(
        `<p style="color:#888;font-style:italic;">仅显示前 ${MAX_XLSX_ROWS} 行（共 ${rowCount} 行），请下载查看完整内容。</p>`,
      );
    }
  }

  return htmlResult(wrapHtml(title, parts.join("\n"), SPREADSHEET_STYLES));
}

function convertCsv(filePath: string): ConvertResult {
  const text = readFileSync(filePath, "utf-8");
  const wb = XLSX.read(text, { type: "string" });
  const title = basename(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) return htmlResult(wrapHtml(title, "<p>Empty file</p>"));

  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const rowCount = range.e.r - range.s.r + 1;
  let truncated = false;

  if (rowCount > MAX_XLSX_ROWS) {
    sheet["!ref"] = XLSX.utils.encode_range({
      s: range.s,
      e: { r: range.s.r + MAX_XLSX_ROWS - 1, c: range.e.c },
    });
    truncated = true;
  }

  const tableHtml = XLSX.utils.sheet_to_html(sheet);
  let body = tableHtml;
  if (truncated) {
    body += `<p style="color:#888;font-style:italic;">仅显示前 ${MAX_XLSX_ROWS} 行（共 ${rowCount} 行），请下载查看完整内容。</p>`;
  }

  return htmlResult(wrapHtml(title, body, SPREADSHEET_STYLES));
}

/* LibreOffice mutex — soffice headless only allows one instance at a time on Windows */
let sofficeLock: Promise<void> = Promise.resolve();

/** Kill stale soffice.bin processes that block new headless instances */
function killStaleSoffice(): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();
  return new Promise((res) => {
    execFile(
      "taskkill",
      ["/F", "/IM", "soffice.bin"],
      { timeout: 5000, windowsHide: true },
      () => res(),
    );
  });
}

/** Convert office files to PDF via LibreOffice headless (docx, pptx, etc.) */
async function convertViaPdf(
  filePath: string,
  dataTmpDir: string,
): Promise<ConvertResult> {
  if (!SOFFICE) {
    // DOCX has a JS fallback; others don't
    if (extname(filePath).toLowerCase() === ".docx") {
      return convertDocxFallback(filePath);
    }
    return htmlResult(
      wrapHtml(
        basename(filePath),
        "<p>LibreOffice is not installed. Cannot preview this file.</p>",
      ),
    );
  }

  const outDir = dirname(filePath);
  const name = basename(filePath, extname(filePath));
  const pdfPath = resolve(outDir, `${name}.pdf`);

  // Skip conversion if PDF already exists (from previous run)
  if (!existsSync(pdfPath)) {
    // Serialize soffice calls
    const prev = sofficeLock;
    let unlock!: () => void;
    sofficeLock = new Promise<void>((r) => (unlock = r));
    await prev;

    try {
      // Isolated user profile avoids conflicts with user's open LO instance.
      // Stale soffice processes from previous runs can block new instances,
      // causing a "waiting for printer" dialog on Windows. Kill them first.
      const loProfile = resolve(process.cwd(), "data", "lo-profile");
      const profileUrl = `file:///${loProfile.replace(/\\/g, "/")}`;
      await killStaleSoffice();
      await new Promise<void>((res, rej) => {
        execFile(
          SOFFICE!,
          [
            `-env:UserInstallation=${profileUrl}`,
            "--headless",
            "--norestore",
            "--nofirststartwizard",
            "--convert-to",
            "pdf",
            "--outdir",
            outDir,
            filePath,
          ],
          { timeout: 60_000, windowsHide: true },
          (err) => (err ? rej(err) : res()),
        );
      });
    } finally {
      unlock();
    }
  }

  if (!existsSync(pdfPath)) {
    return htmlResult(
      wrapHtml(basename(filePath), "<p>LibreOffice conversion failed.</p>"),
    );
  }

  // Compute correct relative path: dataTmpDir → pdfPath
  const pdfRelPath = relative(dataTmpDir, pdfPath).replace(/\\/g, "/");
  const pdfUrl = `/files/${encodeURI(pdfRelPath)}`;
  const title = basename(filePath);
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;overflow:hidden}embed{width:100%;height:100%}</style>
</head><body><embed src="${pdfUrl}" type="application/pdf"></body></html>`;
  return htmlResult(html);
}

/* ── Extension → converter map ──────────────────────── */

type Converter = (
  filePath: string,
  dataTmpDir: string,
) => ConvertResult | Promise<ConvertResult>;

const CONVERTERS: Record<string, Converter> = {
  ".md": convertMarkdown,
  ".docx": convertViaPdf,
  ".xlsx": convertXlsx,
  ".xls": convertXlsx,
  ".csv": convertCsv,
  ".pptx": convertViaPdf,
};

/* ── Route registration ─────────────────────────────── */

export function registerPreviewRoutes(
  app: FastifyInstance,
  dataTmpDir: string,
): void {
  if (SOFFICE) {
    console.log("[preview] LibreOffice found:", SOFFICE);
  } else {
    console.log("[preview] LibreOffice not found — PPTX preview disabled");
  }

  app.get("/preview/*", async (request, reply) => {
    const relPath = decodeURIComponent(
      (request.params as { "*": string })["*"],
    );
    // Security: block path traversal
    if (relPath.includes("..")) {
      return reply.code(400).send("Invalid path");
    }

    const filePath = resolve(dataTmpDir, relPath);
    if (!existsSync(filePath)) {
      return reply.code(404).send("File not found");
    }

    const ext = extname(filePath).toLowerCase();
    const converter = CONVERTERS[ext];
    if (!converter) {
      return reply.code(400).send(`Unsupported format: ${ext}`);
    }

    const stat = statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return reply.code(413).send("File too large for preview (max 20MB)");
    }

    // Check cache
    const mtime = stat.mtimeMs;
    let cached = getCached(filePath, mtime);
    if (!cached) {
      const result = await converter(filePath, dataTmpDir);
      cached = { ...result, mtime };
      setCache(filePath, cached);
    }

    // Bypass @fastify/compress (Brotli content-length:0 bug)
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": cached.contentType,
      "content-length": cached.data.length.toString(),
    });
    reply.raw.end(cached.data);
  });
}
