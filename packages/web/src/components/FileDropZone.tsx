import { useState, useCallback, useRef } from "react";
import "./FileDropZone.css";

interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

export function FileDropZone({
  onFiles,
  disabled,
  children,
}: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounter.current++;
      if (e.dataTransfer.types.includes("Files")) {
        setDragging(true);
      }
    },
    [disabled],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onFiles(files);
      }
    },
    [disabled, onFiles],
  );

  return (
    <div
      className="file-drop-container"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragging && (
        <div className="file-drop-overlay">
          <div className="file-drop-prompt">
            <div className="file-drop-icon">+</div>
            <div className="file-drop-text">Drop files here</div>
          </div>
        </div>
      )}
    </div>
  );
}
