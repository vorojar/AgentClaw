import { useState, useRef, useEffect } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "./ThemeProvider";
import "./CodeBlock.css";

const PREVIEWABLE = new Set(["html", "svg", "mermaid", "jsx", "tsx"]);

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

/* ── React (JSX/TSX) preview ── */

const REACT_CDN = "https://cdn.jsdelivr.net/npm";

function ReactPreview({ code }: { code: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Babel = (await import("@babel/standalone")).default;
        const result = Babel.transform(code, {
          presets: [["react", { runtime: "classic" }], "typescript"],
          filename: "component.tsx",
        });

        let compiled = result.code || "";
        // Strip import statements (React/ReactDOM are globals in iframe)
        compiled = compiled.replace(
          /^import\s+.*?from\s+['"].*?['"];?\s*$/gm,
          "",
        );
        // Convert export default to window assignment
        const hasDefault = /export\s+default\s+/.test(compiled);
        compiled = compiled.replace(
          /export\s+default\s+/g,
          "window.__COMPONENT__ = ",
        );
        // Remove remaining export keywords
        compiled = compiled.replace(/^export\s+/gm, "");
        // If no default export, detect PascalCase function/const as component
        if (!hasDefault) {
          const m = compiled.match(/(?:function|const|class)\s+([A-Z]\w*)/);
          if (m) compiled += `\nwindow.__COMPONENT__ = ${m[1]};`;
        }

        const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;padding:16px;background:#fff;color:#1a1a1a}#__err{color:#e53e3e;font-family:monospace;font-size:13px;white-space:pre-wrap;padding:12px;background:#fff5f5;border-radius:4px}</style>
<script crossorigin src="${REACT_CDN}/react@19/umd/react.production.min.js"><\/script>
<script crossorigin src="${REACT_CDN}/react-dom@19/umd/react-dom.production.min.js"><\/script>
</head><body><div id="root"></div><script>
try{
var {useState,useEffect,useRef,useMemo,useCallback,useReducer,useContext,createContext,Fragment}=React;
${compiled}
var C=window.__COMPONENT__;
if(C){ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(C))}
else{document.getElementById("root").innerHTML='<div id="__err">No component found. Use: export default function App() { ... }<\\/div>'}
}catch(e){document.getElementById("root").innerHTML='<div id="__err">'+e.message+'<\\/div>'}
<\/script></body></html>`;

        if (!cancelled) {
          setHtml(doc);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setHtml(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) return <pre className="code-preview-error">{error}</pre>;
  if (!html) return <div className="code-preview-loading">Compiling…</div>;
  return (
    <iframe
      srcDoc={html}
      sandbox="allow-scripts"
      className="code-preview-iframe"
      title="React preview"
    />
  );
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
  const [preview, setPreview] = useState(false);
  const { theme } = useTheme();

  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const code = String(children).replace(/\n$/, "");
  const canPreview = PREVIEWABLE.has(language);

  /* Inline code (`backtick`) */
  if (inline) {
    return (
      <code className="code-block-inline" {...props}>
        {children}
      </code>
    );
  }

  /* Single-line code block without preview → lightweight render */
  if (!code.includes("\n") && !canPreview) {
    return (
      <div className="code-block-single">
        <code>{code}</code>
      </div>
    );
  }

  return (
    <div className="code-block-wrapper">
      {canPreview && (
        <div className="code-block-actions">
          <button
            className={`code-block-btn${preview ? " active" : ""}`}
            onClick={() => setPreview(!preview)}
            type="button"
          >
            {preview ? "Code" : "Preview"}
          </button>
        </div>
      )}
      {preview ? (
        <div className="code-preview-container">
          {language === "mermaid" ? (
            <MermaidPreview code={code} />
          ) : language === "jsx" || language === "tsx" ? (
            <ReactPreview code={code} />
          ) : (
            <HtmlPreview code={code} language={language} />
          )}
        </div>
      ) : (
        <SyntaxHighlighter
          style={theme === "dark" ? oneDark : oneLight}
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
