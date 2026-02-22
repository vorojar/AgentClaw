import { useState, useCallback } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "./CodeBlock.css";

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
  inline?: boolean;
  [key: string]: unknown;
}

export function CodeBlock({
  className,
  children,
  inline,
  ...props
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const code = String(children).replace(/\n$/, "");

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
      <button
        className={`code-block-copy${copied ? " copied" : ""}`}
        onClick={handleCopy}
        type="button"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <SyntaxHighlighter
        style={oneDark}
        language={language || "text"}
        customStyle={{ background: "transparent", margin: 0 }}
        PreTag="pre"
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
