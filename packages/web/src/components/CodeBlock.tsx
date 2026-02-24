import { useState, useCallback, useRef, useEffect } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "./CodeBlock.css";

const PREVIEWABLE = new Set(["html", "svg", "mermaid"]);

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
  inline?: boolean;
  [key: string]: unknown;
}

/* ── Mermaid renderer ── */

function MermaidPreview({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark" });
        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) return <pre className="code-preview-error">{error}</pre>;
  return <div ref={ref} className="code-preview-mermaid" />;
}

/* ── HTML / SVG iframe preview ── */

function HtmlPreview({ code, language }: { code: string; language: string }) {
  const html =
    language === "svg"
      ? `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100%;background:transparent}</style></head><body>${code}</body></html>`
      : code;

  return (
    <iframe
      srcDoc={html}
      sandbox="allow-scripts"
      className="code-preview-iframe"
      title="preview"
    />
  );
}

/* ── CodeBlock ── */

export function CodeBlock({
  className,
  children,
  inline,
  ...props
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);

  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const code = String(children).replace(/\n$/, "");
  const canPreview = PREVIEWABLE.has(language);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  if (inline) {
    return (
      <code className="code-block-inline" {...props}>
        {children}
      </code>
    );
  }

  return (
    <div className="code-block-wrapper">
      {language && <span className="code-block-lang">{language}</span>}
      <div className="code-block-actions">
        {canPreview && (
          <button
            className={`code-block-btn${preview ? " active" : ""}`}
            onClick={() => setPreview(!preview)}
            type="button"
          >
            {preview ? "Code" : "Preview"}
          </button>
        )}
        <button
          className={`code-block-btn${copied ? " copied" : ""}`}
          onClick={handleCopy}
          type="button"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      {preview ? (
        <div className="code-preview-container">
          {language === "mermaid" ? (
            <MermaidPreview code={code} />
          ) : (
            <HtmlPreview code={code} language={language} />
          )}
        </div>
      ) : (
        <SyntaxHighlighter
          style={oneDark}
          language={language || "text"}
          customStyle={{ background: "transparent", margin: 0 }}
          PreTag="pre"
        >
          {code}
        </SyntaxHighlighter>
      )}
    </div>
  );
}
