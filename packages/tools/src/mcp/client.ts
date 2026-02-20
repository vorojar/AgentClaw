import { spawn, type ChildProcess } from "node:child_process";
import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline";
import type {
  MCPServerConfig,
  Tool,
  ToolParameterSchema,
  ToolResult,
} from "@agentclaw/types";

// ---------- JSON-RPC 2.0 types ----------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ---------- MCP protocol types ----------

interface MCPToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<
      string,
      {
        type?: string;
        description?: string;
        enum?: string[];
        default?: unknown;
      }
    >;
    required?: string[];
  };
}

interface MCPToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

// ---------- Pending request tracking ----------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---------- Constants ----------

const REQUEST_TIMEOUT_MS = 30_000;
const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "agentclaw", version: "0.1.0" };

// ---------- MCPClient ----------

export class MCPClient {
  private config: MCPServerConfig;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private _connected = false;
  private cachedTools: Tool[] = [];

  // stdio transport
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  /** Whether the client is currently connected to the server. */
  get connected(): boolean {
    return this._connected;
  }

  // ================================================================
  // Public API
  // ================================================================

  /** Connect to the MCP server. */
  async connect(): Promise<void> {
    if (this._connected) return;

    if (this.config.transport === "stdio") {
      await this.connectStdio();
    } else if (this.config.transport === "http") {
      await this.connectHttp();
    } else {
      throw new Error(
        `Unsupported transport: ${(this.config as MCPServerConfig).transport}`,
      );
    }

    this._connected = true;
  }

  /** Disconnect from the MCP server. */
  async disconnect(): Promise<void> {
    if (!this._connected) return;

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Client disconnected"));
      this.pending.delete(id);
    }

    if (this.config.transport === "stdio") {
      this.disconnectStdio();
    }

    this._connected = false;
    this.cachedTools = [];
  }

  /** List available tools from the MCP server. */
  async listTools(): Promise<Tool[]> {
    this.ensureConnected();

    const response = (await this.sendRequest("tools/list", {})) as {
      tools?: MCPToolSchema[];
    };

    const mcpTools: MCPToolSchema[] = response.tools ?? [];
    this.cachedTools = mcpTools.map((t) => this.convertTool(t));
    return this.cachedTools;
  }

  /** Call a tool on the MCP server. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    this.ensureConnected();

    const response = (await this.sendRequest("tools/call", {
      name,
      arguments: args,
    })) as MCPToolCallResult;

    return this.convertToolResult(response);
  }

  // ================================================================
  // stdio transport
  // ================================================================

  private async connectStdio(): Promise<void> {
    const { command, args = [], env } = this.config;

    if (!command) {
      throw new Error(
        `MCPServerConfig "${this.config.name}": command is required for stdio transport`,
      );
    }

    const childEnv = env ? { ...process.env, ...env } : process.env;

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv as NodeJS.ProcessEnv,
      shell: false,
    });

    // Guard: ensure stdio streams are available
    if (!this.process.stdin || !this.process.stdout) {
      this.process.kill();
      this.process = null;
      throw new Error(
        `Failed to open stdio streams for MCP server "${this.config.name}"`,
      );
    }

    // Read newline-delimited JSON from stdout
    this.readline = createInterface({ input: this.process.stdout });
    this.readline.on("line", (line: string) => {
      this.handleLine(line);
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      if (this._connected) {
        this._connected = false;
        // Reject all pending requests
        const reason = new Error(
          `MCP server "${this.config.name}" exited unexpectedly (code=${code}, signal=${signal})`,
        );
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(reason);
          this.pending.delete(id);
        }
      }
    });

    this.process.on("error", (err) => {
      if (this._connected) {
        this._connected = false;
        const reason = new Error(
          `MCP server "${this.config.name}" process error: ${err.message}`,
        );
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(reason);
          this.pending.delete(id);
        }
      }
    });

    // Perform MCP handshake
    await this.handshake();
  }

  private disconnectStdio(): void {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    if (this.process) {
      // Close stdin first so the child can gracefully exit
      if (this.process.stdin && !this.process.stdin.destroyed) {
        this.process.stdin.end();
      }
      this.process.kill();
      this.process = null;
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      // Ignore non-JSON output (e.g. server logs on stdout)
      return;
    }

    // We only care about responses (messages with an id that we are waiting for)
    if (msg.id == null) return; // notification from server; ignore

    const pending = this.pending.get(msg.id);
    if (!pending) return; // unknown id; ignore

    clearTimeout(pending.timer);
    this.pending.delete(msg.id);

    if (msg.error) {
      pending.reject(
        new Error(`MCP error ${msg.error.code}: ${msg.error.message}`),
      );
    } else {
      pending.resolve(msg.result);
    }
  }

  // ================================================================
  // HTTP transport (simplified)
  // ================================================================

  private async connectHttp(): Promise<void> {
    if (!this.config.url) {
      throw new Error(
        `MCPServerConfig "${this.config.name}": url is required for http transport`,
      );
    }

    // Perform handshake via HTTP
    await this.handshake();
  }

  // ================================================================
  // JSON-RPC helpers
  // ================================================================

  /** Send a JSON-RPC request and wait for the matching response. */
  private sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const id = this.nextId++;

    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP request "${method}" (id=${id}) timed out after ${REQUEST_TIMEOUT_MS}ms`,
          ),
        );
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      if (this.config.transport === "stdio") {
        this.writeStdio(message);
      } else {
        // HTTP: fire-and-forget style; we resolve through the HTTP response
        this.sendHttpRequest(message)
          .then((result) => {
            // If the pending entry is still there, resolve it
            const p = this.pending.get(id);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(id);
              p.resolve(result);
            }
          })
          .catch((err) => {
            const p = this.pending.get(id);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(id);
              p.reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
      }
    });
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  private sendNotification(
    method: string,
    params?: Record<string, unknown>,
  ): void {
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      ...(params ? { params } : {}),
    };

    if (this.config.transport === "stdio") {
      this.writeStdio(message);
    } else {
      // For HTTP we just fire a POST and do not await a result
      this.sendHttpNotification(message).catch(() => {
        // Best effort; ignore errors on notifications
      });
    }
  }

  /** Write a JSON-RPC message to the child process's stdin. */
  private writeStdio(message: JsonRpcRequest): void {
    if (!this.process?.stdin || this.process.stdin.destroyed) {
      throw new Error("Cannot write to MCP server: stdin is not available");
    }
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }

  /** Send a JSON-RPC request over HTTP and return the result. */
  private async sendHttpRequest(message: JsonRpcRequest): Promise<unknown> {
    const url = this.config.url!;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(
        `MCP HTTP request failed: ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as JsonRpcResponse;

    if (body.error) {
      throw new Error(`MCP error ${body.error.code}: ${body.error.message}`);
    }

    return body.result;
  }

  /** Send a JSON-RPC notification over HTTP (fire-and-forget). */
  private async sendHttpNotification(message: JsonRpcRequest): Promise<void> {
    const url = this.config.url!;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  }

  // ================================================================
  // MCP handshake
  // ================================================================

  private async handshake(): Promise<void> {
    // Step 1: Send initialize request
    const initResult = (await this.sendRequest("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })) as {
      protocolVersion?: string;
      capabilities?: Record<string, unknown>;
      serverInfo?: { name?: string; version?: string };
    };

    if (!initResult) {
      throw new Error(
        `MCP server "${this.config.name}" returned empty initialize response`,
      );
    }

    // Step 2: Send initialized notification
    this.sendNotification("notifications/initialized");
  }

  // ================================================================
  // Conversions
  // ================================================================

  /** Convert an MCP tool schema into an AgentClaw Tool object. */
  private convertTool(mcpTool: MCPToolSchema): Tool {
    const parameters = this.convertParameters(mcpTool.inputSchema);
    const serverName = this.config.name;
    const toolName = `${serverName}__${mcpTool.name}`;

    const client = this; // capture for closure

    return {
      name: toolName,
      description:
        mcpTool.description ??
        `MCP tool "${mcpTool.name}" from server "${serverName}"`,
      category: "mcp",
      parameters,
      async execute(input: Record<string, unknown>): Promise<ToolResult> {
        return client.callTool(mcpTool.name, input);
      },
    };
  }

  /** Convert MCP inputSchema to AgentClaw ToolParameterSchema. */
  private convertParameters(
    inputSchema?: MCPToolSchema["inputSchema"],
  ): ToolParameterSchema {
    if (!inputSchema?.properties) {
      return { type: "object", properties: {} };
    }

    const properties: ToolParameterSchema["properties"] = {};

    for (const [key, prop] of Object.entries(inputSchema.properties)) {
      properties[key] = {
        type: prop.type ?? "string",
        description: prop.description ?? "",
        ...(prop.enum ? { enum: prop.enum } : {}),
        ...(prop.default !== undefined ? { default: prop.default } : {}),
      };
    }

    return {
      type: "object",
      properties,
      ...(inputSchema.required ? { required: inputSchema.required } : {}),
    };
  }

  /** Convert an MCP tool call result into an AgentClaw ToolResult. */
  private convertToolResult(mcpResult: MCPToolCallResult): ToolResult {
    // MCP results contain an array of content blocks; we concatenate text blocks.
    const textParts: string[] = [];

    if (mcpResult.content) {
      for (const block of mcpResult.content) {
        if (block.text != null) {
          textParts.push(block.text);
        }
      }
    }

    return {
      content: textParts.join("\n") || "",
      isError: mcpResult.isError ?? false,
    };
  }

  // ================================================================
  // Utilities
  // ================================================================

  private ensureConnected(): void {
    if (!this._connected) {
      throw new Error(
        `MCPClient "${this.config.name}" is not connected. Call connect() first.`,
      );
    }
  }
}
