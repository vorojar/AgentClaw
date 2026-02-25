/* SVG icon components — no emoji */

const D = {
  size: 18,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function I({ size, children }: { size?: number; children: React.ReactNode }) {
  const s = size ?? D.size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill={D.fill}
      stroke={D.stroke}
      strokeWidth={D.strokeWidth}
      strokeLinecap={D.strokeLinecap}
      strokeLinejoin={D.strokeLinejoin}
    >
      {children}
    </svg>
  );
}

export function IconChat({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </I>
  );
}

export function IconMemory({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M12 2a7 7 0 0 1 7 7c0 3-2 5.5-4 7.5L12 22l-3-5.5C7 14.5 5 12 5 9a7 7 0 0 1 7-7z" />
      <circle cx="12" cy="9" r="2" />
    </I>
  );
}

export function IconTraces({ size }: { size?: number }) {
  return (
    <I size={size}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </I>
  );
}

export function IconTokens({ size }: { size?: number }) {
  return (
    <I size={size}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v12M8 10h8M8 14h8" />
    </I>
  );
}

export function IconSettings({ size }: { size?: number }) {
  return (
    <I size={size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </I>
  );
}

export function IconApi({ size }: { size?: number }) {
  return (
    <I size={size}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </I>
  );
}

export function IconPlus({ size }: { size?: number }) {
  return (
    <I size={size}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </I>
  );
}

export function IconSearch({ size }: { size?: number }) {
  return (
    <I size={size}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </I>
  );
}

export function IconPanelLeft({ size }: { size?: number }) {
  return (
    <I size={size}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </I>
  );
}

export function IconMenu({ size }: { size?: number }) {
  return (
    <I size={size}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </I>
  );
}

export function IconDownload({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </I>
  );
}

export function IconPaperclip({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </I>
  );
}

export function IconArrowUp({ size }: { size?: number }) {
  return (
    <I size={size}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </I>
  );
}

export function IconSquare({ size }: { size?: number }) {
  return (
    <svg
      width={size ?? 16}
      height={size ?? 16}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

export function IconX({ size }: { size?: number }) {
  return (
    <I size={size}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </I>
  );
}

export function IconRefresh({ size }: { size?: number }) {
  return (
    <I size={size}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </I>
  );
}

export function IconWarning({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </I>
  );
}

export function IconCheck({ size }: { size?: number }) {
  return (
    <I size={size}>
      <polyline points="20 6 9 17 4 12" />
    </I>
  );
}

export function IconXCircle({ size }: { size?: number }) {
  return (
    <I size={size}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </I>
  );
}

export function IconClock({ size }: { size?: number }) {
  return (
    <I size={size}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </I>
  );
}

export function IconChevronRight({ size }: { size?: number }) {
  return (
    <I size={size}>
      <polyline points="9 18 15 12 9 6" />
    </I>
  );
}

export function IconSun({ size }: { size?: number }) {
  return (
    <I size={size}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </I>
  );
}

export function IconMoon({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </I>
  );
}

export function IconSkills({ size }: { size?: number }) {
  return (
    <I size={size}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </I>
  );
}

export function IconChevronDown({ size }: { size?: number }) {
  return (
    <I size={size}>
      <polyline points="6 9 12 15 18 9" />
    </I>
  );
}

export function IconEdit({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </I>
  );
}

export function IconArrowLeft({ size }: { size?: number }) {
  return (
    <I size={size}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </I>
  );
}

export function IconMoreHorizontal({ size }: { size?: number }) {
  return (
    <I size={size}>
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
    </I>
  );
}

export function IconTrash({ size }: { size?: number }) {
  return (
    <I size={size}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </I>
  );
}

export function IconMic({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </I>
  );
}

export function IconExternalLink({ size }: { size?: number }) {
  return (
    <I size={size}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </I>
  );
}
