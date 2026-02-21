import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

const API_KEY = process.env.API_KEY;

/**
 * Extract credential from request:
 * 1. Authorization: Bearer <key>
 * 2. Query parameter ?api_key=<key> or ?token=<key>
 */
function extractCredential(req: FastifyRequest): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const query = req.query as Record<string, string>;
  return query.api_key || query.token;
}

/**
 * Register API key authentication on a Fastify instance.
 * If API_KEY env var is not set, no auth is enforced.
 */
export function registerAuth(app: FastifyInstance): void {
  if (!API_KEY) {
    console.log("[auth] API_KEY not set — authentication disabled");
    return;
  }

  console.log("[auth] API_KEY set — authentication enabled");

  // Verify endpoint — allows frontend to check if a key is valid
  app.get(
    "/api/auth/verify",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const credential = extractCredential(req);
      if (credential === API_KEY) {
        return reply.send({ ok: true });
      }
      return reply.status(401).send({ error: "Invalid API key" });
    },
  );

  // Global onRequest hook
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url;

    // Allow static assets (SPA shell) without auth
    if (
      url === "/" ||
      url === "/favicon.ico" ||
      url.startsWith("/assets/") ||
      url.startsWith("/chat") ||
      url.startsWith("/plans") ||
      url.startsWith("/memory") ||
      url.startsWith("/settings")
    ) {
      return;
    }

    // Protect /api/*, /ws*, /files/*
    if (
      url.startsWith("/api/") ||
      url.startsWith("/ws") ||
      url.startsWith("/files/")
    ) {
      const credential = extractCredential(req);
      if (credential !== API_KEY) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    }
  });
}
