import React, { useState, useEffect, useCallback, useRef } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  listChannels,
  startChannel,
  stopChannel,
  type ChannelInfo,
} from "../api/client";
import "./ChannelsPage.css";

/** Shared SVG props for all channel icons */
const svgProps = {
  viewBox: "0 0 24 24",
  width: 24,
  height: 24,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function TelegramIcon() {
  return (
    <svg {...svgProps}>
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg {...svgProps}>
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
      <path d="M9.5 10.5a1 1 0 001 1h3a1 1 0 001-1v-1a1 1 0 00-1-1h-3a1 1 0 00-1 1v1z" />
    </svg>
  );
}

function DingTalkIcon() {
  return (
    <svg {...svgProps}>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function FeishuIcon() {
  return (
    <svg {...svgProps}>
      <path d="M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5l6.74-6.76z" />
      <line x1="16" y1="8" x2="2" y2="22" />
      <line x1="17.5" y1="15" x2="9" y2="15" />
    </svg>
  );
}

function WebSocketIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 2v6" />
      <path d="M8 4h8" />
      <rect x="7" y="8" width="10" height="8" rx="2" />
      <path d="M9 16v2" />
      <path d="M15 16v2" />
      <path d="M6 20h12" />
    </svg>
  );
}

const CHANNEL_ICONS: Record<string, () => React.ReactElement> = {
  telegram: TelegramIcon,
  whatsapp: WhatsAppIcon,
  dingtalk: DingTalkIcon,
  feishu: FeishuIcon,
  websocket: WebSocketIcon,
};

function getChannelIcon(id: string) {
  const normalized = id.toLowerCase();
  for (const [key, Icon] of Object.entries(CHANNEL_ICONS)) {
    if (normalized.includes(key)) return <Icon />;
  }
  // Fallback: generic plug icon
  return <WebSocketIcon />;
}

/** Relative time display, e.g. "2h ago" */
function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

const STATUS_COLORS: Record<ChannelInfo["status"], string> = {
  connected: "var(--success)",
  disconnected: "var(--text-secondary)",
  error: "var(--error)",
  not_configured: "var(--text-secondary)",
};

export function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchChannels = useCallback(async () => {
    try {
      const data = await listChannels();
      setChannels(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    intervalRef.current = setInterval(fetchChannels, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchChannels]);

  const handleToggle = async (channel: ChannelInfo) => {
    // Cannot toggle not_configured or websocket channels
    if (channel.status === "not_configured") return;
    if (channel.id.toLowerCase().includes("websocket")) return;

    const action = channel.status === "connected" ? stopChannel : startChannel;
    setTogglingIds((prev) => new Set(prev).add(channel.id));

    try {
      const updated = await action(channel.id);
      setChannels((prev) =>
        prev.map((c) => (c.id === channel.id ? updated : c)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle channel");
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(channel.id);
        return next;
      });
    }
  };

  const isWebSocket = (ch: ChannelInfo) =>
    ch.id.toLowerCase().includes("websocket");

  const isToggleDisabled = (ch: ChannelInfo) =>
    ch.status === "not_configured" || isWebSocket(ch) || togglingIds.has(ch.id);

  const isToggleOn = (ch: ChannelInfo) => ch.status === "connected";

  if (loading) {
    return (
      <>
        <PageHeader>Channels</PageHeader>
        <div className="page-body">
          <div className="channels-loading">Loading channels...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader>Channels</PageHeader>
      <div className="page-body">
        {error && (
          <div className="channels-error">
            {error}
            <button onClick={() => setError(null)}>dismiss</button>
          </div>
        )}

        {channels.length === 0 ? (
          <div className="channels-empty">No channels available</div>
        ) : (
          <div className="channels-grid">
            {channels.map((ch) => (
              <div
                key={ch.id}
                className={`channels-card${ch.status === "not_configured" ? " channels-card-dimmed" : ""}`}
              >
                {/* Left: icon + name */}
                <div className="channels-card-left">
                  <span className="channels-icon">{getChannelIcon(ch.id)}</span>
                  <span className="channels-name">{ch.name}</span>
                </div>

                {/* Middle: status */}
                <div className="channels-card-middle">
                  <div className="channels-status-row">
                    <span
                      className="channels-status-dot"
                      style={{ background: STATUS_COLORS[ch.status] }}
                    />
                    <span
                      className={`channels-status-text${ch.status === "not_configured" ? " channels-status-notconfigured" : ""}`}
                    >
                      {ch.status === "not_configured"
                        ? "Not configured"
                        : ch.status}
                    </span>
                  </div>
                  {ch.status === "connected" && ch.connectedAt && (
                    <span className="channels-connected-time">
                      {relativeTime(ch.connectedAt)}
                    </span>
                  )}
                  {ch.status === "error" && ch.statusMessage && (
                    <span className="channels-error-msg">
                      {ch.statusMessage}
                    </span>
                  )}
                </div>

                {/* Right: toggle */}
                <div className="channels-card-right">
                  <span
                    className={[
                      "channels-toggle",
                      isToggleOn(ch) && "on",
                      isToggleDisabled(ch) && "disabled",
                      togglingIds.has(ch.id) && "loading",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => !isToggleDisabled(ch) && handleToggle(ch)}
                    role="switch"
                    aria-checked={isToggleOn(ch)}
                    aria-disabled={isToggleDisabled(ch)}
                  >
                    <span className="channels-toggle-knob" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
