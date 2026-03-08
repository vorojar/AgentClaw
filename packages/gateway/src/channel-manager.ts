import type { AppContext } from "./bootstrap.js";
import { startTelegramBot } from "./telegram.js";
import { startWhatsAppBot } from "./whatsapp.js";
import { startDingTalkBot } from "./dingtalk.js";
import { startFeishuBot } from "./feishu.js";
import { startQQBot } from "./qqbot.js";
import { startWeComBot } from "./wecom.js";

export interface ChannelInfo {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "error" | "not_configured";
  statusMessage?: string;
  connectedAt?: string;
  botIdentity?: string;
}

interface BotHandle {
  stop: () => void;
  broadcast: (text: string) => Promise<void>;
}

interface ChannelState {
  id: string;
  name: string;
  configured: boolean;
  handle?: BotHandle;
  connectedAt?: Date;
  statusMessage?: string;
  error?: string;
}

export class ChannelManager {
  private channels = new Map<string, ChannelState>();
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;

    // Register all known channels
    this.channels.set("telegram", {
      id: "telegram",
      name: "Telegram",
      configured: !!process.env.TELEGRAM_BOT_TOKEN,
    });
    this.channels.set("whatsapp", {
      id: "whatsapp",
      name: "WhatsApp",
      configured: process.env.WHATSAPP_ENABLED === "true",
    });
    this.channels.set("dingtalk", {
      id: "dingtalk",
      name: "DingTalk",
      configured:
        !!process.env.DINGTALK_APP_KEY && !!process.env.DINGTALK_APP_SECRET,
    });
    this.channels.set("feishu", {
      id: "feishu",
      name: "Feishu",
      configured:
        !!process.env.FEISHU_APP_ID && !!process.env.FEISHU_APP_SECRET,
    });
    this.channels.set("qqbot", {
      id: "qqbot",
      name: "QQ Bot",
      configured:
        !!process.env.QQ_BOT_APP_ID && !!process.env.QQ_BOT_APP_SECRET,
    });
    this.channels.set("wecom", {
      id: "wecom",
      name: "WeCom",
      configured:
        !!process.env.WECOM_BOT_TOKEN &&
        !!process.env.WECOM_BOT_ENCODING_AES_KEY,
    });
    this.channels.set("websocket", {
      id: "websocket",
      name: "WebSocket",
      configured: true, // Always available
      connectedAt: new Date(),
    });
  }

  list(): ChannelInfo[] {
    return Array.from(this.channels.values(), (ch) => this.toInfo(ch));
  }

  getInfo(id: string): ChannelInfo | undefined {
    const ch = this.channels.get(id);
    return ch ? this.toInfo(ch) : undefined;
  }

  async start(id: string): Promise<void> {
    const ch = this.channels.get(id);
    if (!ch) throw new Error(`Unknown channel: ${id}`);
    if (!ch.configured) throw new Error(`Channel ${id} is not configured`);
    if (ch.handle) throw new Error(`Channel ${id} is already running`);

    if (id === "websocket") {
      // WebSocket is always running via Fastify
      ch.connectedAt = new Date();
      return;
    }

    try {
      ch.handle = await this.startBot(id);
      ch.connectedAt = new Date();
      ch.error = undefined;
      console.log(`[channel-manager] Started ${ch.name}`);
    } catch (err) {
      ch.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async stop(id: string): Promise<void> {
    const ch = this.channels.get(id);
    if (!ch) throw new Error(`Unknown channel: ${id}`);
    if (id === "websocket") throw new Error("Cannot stop WebSocket channel");
    if (!ch.handle) return;

    try {
      ch.handle.stop();
    } catch {}
    ch.handle = undefined;
    ch.connectedAt = undefined;
    console.log(`[channel-manager] Stopped ${ch.name}`);
  }

  /** Start all configured channels */
  async startAll(): Promise<void> {
    for (const [id, ch] of this.channels) {
      if (ch.configured && id !== "websocket" && !ch.handle) {
        try {
          await this.start(id);
        } catch (err) {
          console.error(`[channel-manager] Failed to start ${ch.name}:`, err);
        }
      }
    }
  }

  /** Stop all channels */
  stopAll(): void {
    for (const [id, ch] of this.channels) {
      if (ch.handle && id !== "websocket") {
        try {
          ch.handle.stop();
        } catch {}
        ch.handle = undefined;
        ch.connectedAt = undefined;
      }
    }
  }

  /** Broadcast to all connected channels */
  async broadcast(text: string): Promise<void> {
    for (const ch of this.channels.values()) {
      if (ch.handle) {
        await ch.handle
          .broadcast(text)
          .catch((err) => console.error(`[broadcast] ${ch.name} failed:`, err));
      }
    }
  }

  /** Set handle for a channel directly (used during migration from index.ts) */
  setHandle(id: string, handle: BotHandle): void {
    const ch = this.channels.get(id);
    if (ch) {
      ch.handle = handle;
      ch.connectedAt = new Date();
    }
  }

  private toInfo(ch: ChannelState): ChannelInfo {
    if (!ch.configured) {
      return {
        id: ch.id,
        name: ch.name,
        status: "not_configured",
        statusMessage: "Environment variables not set",
      };
    }
    if (ch.error) {
      return {
        id: ch.id,
        name: ch.name,
        status: "error",
        statusMessage: ch.error,
      };
    }
    if (ch.handle || ch.id === "websocket") {
      return {
        id: ch.id,
        name: ch.name,
        status: "connected",
        connectedAt: ch.connectedAt?.toISOString(),
      };
    }
    return {
      id: ch.id,
      name: ch.name,
      status: "disconnected",
    };
  }

  private async startBot(id: string): Promise<BotHandle> {
    switch (id) {
      case "telegram": {
        const token = process.env.TELEGRAM_BOT_TOKEN!;
        return startTelegramBot(token, this.ctx);
      }
      case "whatsapp":
        return startWhatsAppBot(this.ctx);
      case "dingtalk":
        return startDingTalkBot(
          {
            clientId: process.env.DINGTALK_APP_KEY!,
            clientSecret: process.env.DINGTALK_APP_SECRET!,
            allowedUsers: process.env.DINGTALK_ALLOWED_USERS,
          },
          this.ctx,
        );
      case "feishu":
        return startFeishuBot(
          {
            appId: process.env.FEISHU_APP_ID!,
            appSecret: process.env.FEISHU_APP_SECRET!,
            allowedUsers: process.env.FEISHU_ALLOWED_USERS,
          },
          this.ctx,
        );
      case "qqbot":
        return startQQBot(
          {
            appId: process.env.QQ_BOT_APP_ID!,
            appSecret: process.env.QQ_BOT_APP_SECRET!,
            sandbox: process.env.QQ_BOT_SANDBOX === "true",
          },
          this.ctx,
        );
      case "wecom":
        return startWeComBot(
          {
            token: process.env.WECOM_BOT_TOKEN!,
            encodingAesKey: process.env.WECOM_BOT_ENCODING_AES_KEY!,
          },
          this.ctx,
        );
      default:
        throw new Error(`Unknown channel: ${id}`);
    }
  }
}
