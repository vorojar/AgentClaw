/**
 * useBackClose — unified mobile back-button handler for overlays.
 *
 * Manages a global stack so multiple overlays (sidebar, preview, modals)
 * share a single `popstate` listener.  Pressing back always closes the
 * topmost overlay; programmatic close removes the entry without navigating.
 */

import { useEffect, useRef } from "react";

/* ── Global stack (module-level singleton) ── */

interface StackEntry {
  id: number;
  close: () => void;
}

let nextId = 0;
const stack: StackEntry[] = [];

function onPopState() {
  const top = stack.pop();
  if (top) {
    top.close();
  }
}

// Single global listener — registered once, never removed
if (typeof window !== "undefined") {
  window.addEventListener("popstate", onPopState);
}

export function pushOverlay(close: () => void): number {
  const id = nextId++;
  stack.push({ id, close });
  history.pushState({ _overlay: id }, "");
  return id;
}

export function removeOverlay(id: number) {
  const idx = stack.findIndex((e) => e.id === id);
  if (idx === -1) return; // already removed (by popstate)
  stack.splice(idx, 1);
  // Clean up the dummy history entry without triggering popstate
  // We go back and suppress the listener by temporarily removing the entry
  // A simpler approach: just replaceState — this doesn't perfectly fix the
  // history length, but avoids the complexity of history.back() races.
  // Since overlays are transient, one extra history entry is acceptable.
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

/* ── React hook ── */

/**
 * Call this hook when an overlay is visible.
 * It pushes a history entry on mount and cleans up on unmount.
 * Pressing browser-back calls `onClose`.
 *
 * @param onClose - callback to close the overlay (must be stable or wrapped in useCallback)
 */
export function useBackClose(onClose: () => void) {
  const idRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = pushOverlay(() => onCloseRef.current());
    idRef.current = id;
    return () => {
      if (idRef.current !== null) {
        removeOverlay(idRef.current);
        idRef.current = null;
      }
    };
  }, []); // mount/unmount only — onClose tracked via ref
}
