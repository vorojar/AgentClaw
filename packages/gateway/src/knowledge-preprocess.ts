/**
 * Knowledge source content extraction & preprocessing.
 *
 * Handles different file types:
 * - PDF: extract text via pdf-parse, detect scan-only PDFs
 * - HTML: Readability + Turndown → clean Markdown (same as web_fetch)
 * - Plain text (.txt, .md, .csv, .json, .xml, .yaml, etc.): read as-is
 */
import { readFileSync } from "node:fs";
import { htmlToMarkdown } from "@agentclaw/tools";

/** Minimum chars threshold to consider a PDF as having a text layer */
const PDF_TEXT_THRESHOLD = 50;

/**
 * Extract and preprocess file content for RAG chunking.
 * Returns { content, error }. If error is set, content is empty.
 */
export async function extractFileContent(
  filePath: string,
  ext: string,
): Promise<{ content: string; error?: string }> {
  const lowerExt = ext.toLowerCase();

  // ─── PDF ───────────────────────────────────────────
  if (lowerExt === ".pdf") {
    return extractPdfContent(filePath);
  }

  // ─── HTML ──────────────────────────────────────────
  if (lowerExt === ".html" || lowerExt === ".htm") {
    return { content: extractHtmlContent(filePath) };
  }

  // ─── Plain text (all other types) ──────────────────
  try {
    const raw = readFileSync(filePath, "utf-8");
    return { content: raw };
  } catch {
    return { content: "", error: "Failed to read file as UTF-8 text" };
  }
}

/**
 * Extract text from PDF using pdf-parse.
 * If the extracted text is too short, it's likely a scanned document.
 */
async function extractPdfContent(
  filePath: string,
): Promise<{ content: string; error?: string }> {
  try {
    // Import from lib/ to avoid pdf-parse v1 index.js loading a test PDF on import
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import("pdf-parse/lib/pdf-parse.js" as any);
    const pdfParse = typeof mod.default === "function" ? mod.default : mod;
    const buffer = readFileSync(filePath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await (pdfParse as any)(buffer);

    const text = data.text?.trim() || "";

    if (text.length < PDF_TEXT_THRESHOLD) {
      return {
        content: "",
        error:
          "This PDF appears to be a scanned document (image-only). Text extraction requires OCR which is not yet supported. Please upload a PDF with a text layer, or convert to text first.",
      };
    }

    return { content: text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: "", error: `PDF parsing failed: ${msg}` };
  }
}

/**
 * Extract clean text from HTML using Readability + Turndown.
 * Same pipeline as the web_fetch tool — removes scripts, styles, nav,
 * then extracts main article content.
 */
function extractHtmlContent(filePath: string): string {
  const html = readFileSync(filePath, "utf-8");
  return htmlToMarkdown(html, {
    stripTags: ["script", "style", "nav", "header", "footer"],
  });
}
