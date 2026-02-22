import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import "./SearchDialog.css";

interface SearchDialogProps {
  messages: Array<{ role: string; content: string; key: string }>;
  onNavigate: (messageKey: string) => void;
  onClose: () => void;
}

export function SearchDialog({
  messages,
  onNavigate,
  onClose,
}: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    return messages.filter((m) => m.content.toLowerCase().includes(lower));
  }, [query, messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset index when matches change
  useEffect(() => {
    setCurrentIndex(0);
  }, [matches.length]);

  // Navigate to current match
  useEffect(() => {
    if (matches.length > 0 && matches[currentIndex]) {
      onNavigate(matches[currentIndex].key);
    }
  }, [currentIndex, matches, onNavigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (matches.length > 0) {
          if (e.shiftKey) {
            setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
          } else {
            setCurrentIndex((i) => (i + 1) % matches.length);
          }
        }
      }
    },
    [matches.length, onClose],
  );

  const goPrev = useCallback(() => {
    if (matches.length > 0) {
      setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
    }
  }, [matches.length]);

  const goNext = useCallback(() => {
    if (matches.length > 0) {
      setCurrentIndex((i) => (i + 1) % matches.length);
    }
  }, [matches.length]);

  return (
    <div className="search-dialog-backdrop">
      <div className="search-dialog-container">
        <input
          ref={inputRef}
          className="search-dialog-input"
          type="text"
          placeholder="Search messages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <span className="search-dialog-count">
          {query.trim()
            ? matches.length > 0
              ? `${currentIndex + 1}/${matches.length}`
              : "0/0"
            : ""}
        </span>
        <button
          className="search-dialog-nav"
          onClick={goPrev}
          disabled={matches.length === 0}
          type="button"
          title="Previous match (Shift+Enter)"
        >
          &#x2191;
        </button>
        <button
          className="search-dialog-nav"
          onClick={goNext}
          disabled={matches.length === 0}
          type="button"
          title="Next match (Enter)"
        >
          &#x2193;
        </button>
        <button
          className="search-dialog-close"
          onClick={onClose}
          type="button"
          title="Close (Escape)"
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
}
