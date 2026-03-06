import type { FastifyInstance } from "fastify";
import type { AgentProfile } from "@agentclaw/types";
import type { AppContext } from "../bootstrap.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve } from "path";

const AGENTS_DIR = resolve(process.cwd(), "data", "agents");

/** Sync an agent profile to data/agents/<id>/ (config.json + SOUL.md) */
function syncAgentToFs(agent: AgentProfile): void {
  const dir = resolve(AGENTS_DIR, agent.id);
  mkdirSync(dir, { recursive: true });

  // SOUL.md
  writeFileSync(resolve(dir, "SOUL.md"), agent.soul || "", "utf-8");

  // config.json (everything except id and soul)
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
  // GET /api/agents - List available agent profiles
  app.get("/api/agents", async (_req, reply) => {
    const agents = ctx.memoryStore.listAgents();
    return reply.send(
      agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        avatar: a.avatar,
        soul: a.soul,
        model: a.model,
        tools: a.tools,
        maxIterations: a.maxIterations,
        temperature: a.temperature,
        sortOrder: a.sortOrder,
      })),
    );
  });

  // POST /api/agents - Create agent
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
    // Check duplicate
    const existing = ctx.memoryStore.getAgent(body.id);
    if (existing) {
      return reply
        .status(409)
        .send({ error: `Agent "${body.id}" already exists` });
    }
    const agent = {
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
    ctx.memoryStore.saveAgent(agent);
    syncAgentToFs(agent);
    ctx.refreshAgents();
    return reply.status(201).send(agent);
  });

  // PUT /api/agents/:id - Update agent
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
    const existing = ctx.memoryStore.getAgent(req.params.id);
    if (!existing) {
      return reply.status(404).send({ error: "Agent not found" });
    }
    const updated = {
      ...existing,
      ...req.body,
      id: req.params.id, // id cannot change
    };
    ctx.memoryStore.saveAgent(updated);
    syncAgentToFs(updated);
    ctx.refreshAgents();
    return reply.send(updated);
  });

  // DELETE /api/agents/:id - Delete agent
  app.delete<{ Params: { id: string } }>(
    "/api/agents/:id",
    async (req, reply) => {
      if (req.params.id === "default") {
        return reply
          .status(400)
          .send({ error: "Cannot delete the default agent" });
      }
      ctx.memoryStore.deleteAgent(req.params.id);
      removeAgentFromFs(req.params.id);
      ctx.refreshAgents();
      return reply.status(204).send();
    },
  );
}
