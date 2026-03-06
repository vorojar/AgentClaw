import type { FastifyInstance } from "fastify";
import type { AgentProfile } from "@agentclaw/types";
import type { AppContext } from "../bootstrap.js";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from "fs";
import { resolve } from "path";

const AGENTS_DIR = resolve(process.cwd(), "data", "agents");

/** Read a single agent from data/agents/<id>/ */
function readAgentFromFs(id: string): AgentProfile | null {
  const dir = resolve(AGENTS_DIR, id);
  if (!existsSync(dir)) return null;

  const soulPath = resolve(dir, "SOUL.md");
  const configPath = resolve(dir, "config.json");

  const soul = existsSync(soulPath)
    ? readFileSync(soulPath, "utf-8").trim()
    : "";

  let config: Partial<AgentProfile> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {}
  }

  return {
    id,
    name: config.name ?? id,
    description: config.description ?? "",
    avatar: config.avatar ?? "",
    soul,
    model: config.model,
    tools: config.tools,
    maxIterations: config.maxIterations,
    temperature: config.temperature,
    sortOrder: config.sortOrder ?? 0,
  };
}

/** Read all agents from data/agents/ */
export function loadAgentsFromFs(): AgentProfile[] {
  mkdirSync(AGENTS_DIR, { recursive: true });
  const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
  const agents: AgentProfile[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agent = readAgentFromFs(entry.name);
    if (agent) agents.push(agent);
  }

  // default first, then by sortOrder, then alphabetical
  agents.sort((a, b) => {
    if (a.id === "default") return -1;
    if (b.id === "default") return 1;
    if (a.sortOrder !== b.sortOrder)
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    return a.name.localeCompare(b.name);
  });

  return agents;
}

/** Write an agent profile to data/agents/<id>/ (config.json + SOUL.md) */
function writeAgentToFs(agent: AgentProfile): void {
  const dir = resolve(AGENTS_DIR, agent.id);
  mkdirSync(dir, { recursive: true });

  writeFileSync(resolve(dir, "SOUL.md"), agent.soul || "", "utf-8");

  const config: Record<string, unknown> = {
    name: agent.name,
    description: agent.description,
    avatar: agent.avatar,
  };
  if (agent.model) config.model = agent.model;
  if (agent.tools) config.tools = agent.tools;
  if (agent.temperature !== undefined) config.temperature = agent.temperature;
  if (agent.maxIterations !== undefined)
    config.maxIterations = agent.maxIterations;
  if (agent.sortOrder) config.sortOrder = agent.sortOrder;
  writeFileSync(
    resolve(dir, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );
}

/** Remove agent directory from filesystem */
function removeAgentFromFs(id: string): void {
  const dir = resolve(AGENTS_DIR, id);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function registerAgentRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // GET /api/agents
  app.get("/api/agents", async (_req, reply) => {
    const agents = loadAgentsFromFs();
    return reply.send(agents);
  });

  // POST /api/agents
  app.post<{
    Body: {
      id: string;
      name: string;
      description?: string;
      avatar?: string;
      soul?: string;
      model?: string;
      tools?: string[];
      maxIterations?: number;
      temperature?: number;
      sortOrder?: number;
    };
  }>("/api/agents", async (req, reply) => {
    const body = req.body;
    if (!body?.id || !body?.name) {
      return reply.status(400).send({ error: "id and name are required" });
    }
    if (readAgentFromFs(body.id)) {
      return reply
        .status(409)
        .send({ error: `Agent "${body.id}" already exists` });
    }
    const agent: AgentProfile = {
      id: body.id,
      name: body.name,
      description: body.description ?? "",
      avatar: body.avatar ?? "",
      soul: body.soul ?? "",
      model: body.model,
      tools: body.tools,
      maxIterations: body.maxIterations,
      temperature: body.temperature,
      sortOrder: body.sortOrder ?? 0,
    };
    writeAgentToFs(agent);
    ctx.refreshAgents();
    return reply.status(201).send(agent);
  });

  // PUT /api/agents/:id
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      avatar?: string;
      soul?: string;
      model?: string;
      tools?: string[];
      maxIterations?: number;
      temperature?: number;
      sortOrder?: number;
    };
  }>("/api/agents/:id", async (req, reply) => {
    const existing = readAgentFromFs(req.params.id);
    if (!existing) {
      return reply.status(404).send({ error: "Agent not found" });
    }
    const updated: AgentProfile = {
      ...existing,
      ...req.body,
      id: req.params.id,
    };
    writeAgentToFs(updated);
    ctx.refreshAgents();
    return reply.send(updated);
  });

  // DELETE /api/agents/:id
  app.delete<{ Params: { id: string } }>(
    "/api/agents/:id",
    async (req, reply) => {
      if (req.params.id === "default") {
        return reply
          .status(400)
          .send({ error: "Cannot delete the default agent" });
      }
      removeAgentFromFs(req.params.id);
      ctx.refreshAgents();
      return reply.status(204).send();
    },
  );
}
