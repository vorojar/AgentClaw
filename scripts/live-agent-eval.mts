import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootstrap } from "../packages/gateway/src/bootstrap.js";

type EvalCase = {
  name: string;
  input: string;
};

function currentDateString(date = new Date()): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const today = currentDateString();

const cases: EvalCase[] = [
  {
    name: "ai-news",
    input: `今天是 ${today}。请获取今天最新的 AI 新闻，必须使用 web_search 或 web_fetch 获取实时信息。请用中文列出 3 条新闻，每条包含来源、日期、要点和链接；如果无法获取实时信息，请明确说明原因。`,
  },
  {
    name: "shanghai-weather",
    input: `今天是 ${today}。请查询上海今天的实时天气，必须使用 web_search 或 web_fetch 获取实时信息。请给出温度、天气状况、降水/风力信息和来源链接；如果无法获取实时信息，请明确说明原因。`,
  },
  {
    name: "stock-market-news",
    input: `今天是 ${today}。请查询今天美股科技股/AI 芯片方向的主要市场新闻，必须使用 web_search 或 web_fetch 获取实时信息。请给出 3 条要点、来源链接，并说明哪些信息仍需以行情软件为准。`,
  },
  {
    name: "tool-free-reasoning",
    input:
      "不用搜索。请解释一下为什么 agent 在拿到工具结果后仍可能答错，并给出 3 个工程改进方向。",
  },
];

const selectedArgs: string[] = [];
let resume = false;
let outPathArg: string | undefined;
for (let i = 0; i < process.argv.slice(2).length; i++) {
  const arg = process.argv.slice(2)[i];
  if (arg === "--resume") {
    resume = true;
  } else if (arg === "--out" && process.argv.slice(2)[i + 1]) {
    outPathArg = process.argv.slice(2)[++i];
  } else {
    selectedArgs.push(arg);
  }
}

const outDir = resolve("data", "eval-reports");
mkdirSync(outDir, { recursive: true });
const outPath = outPathArg
  ? resolve(outPathArg)
  : join(outDir, `live-agent-eval-${Date.now()}.json`);

type EvalResult = Record<string, unknown> & { name: string };
const results: EvalResult[] =
  resume && existsSync(outPath)
    ? (JSON.parse(readFileSync(outPath, "utf-8")) as EvalResult[])
    : [];
const completedCaseNames = new Set(results.map((result) => result.name));

const selectedCaseNames = new Set(selectedArgs);
const casesToRun =
  selectedCaseNames.size > 0
    ? cases.filter((item) => selectedCaseNames.has(item.name))
    : cases;

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === "object" && "text" in block
          ? String((block as { text?: unknown }).text ?? "")
          : JSON.stringify(block),
      )
      .join("");
  }
  return JSON.stringify(content);
}

function short(value: string, max = 1600): string {
  return value.length > max
    ? `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`
    : value;
}

function scoreCase(
  name: string,
  response: string,
  toolCalls: string[],
  toolResultText: string,
): {
  score: number;
  notes: string[];
} {
  const notes: string[] = [];
  let score = 0;

  if (name === "tool-free-reasoning") {
    if (toolCalls.length === 0) score += 3;
    else notes.push(`不该用工具但调用了 ${toolCalls.join(", ")}`);
    if (/工具结果|tool_result|抽取|综合|验证/.test(response)) score += 2;
    else notes.push("解释没有覆盖工具结果到最终回答的链路");
    return { score, notes };
  }

  const usedRealtimeTool = toolCalls.some(
    (name) => name === "web_search" || name === "web_fetch",
  );

  if (usedRealtimeTool) {
    score += 2;
  } else {
    notes.push("实时查询没有调用 web_search/web_fetch");
  }

  if (/https?:\/\//.test(response)) score += 1;
  else notes.push("最终回答缺少来源链接");

  if (name.includes("weather")) {
    if (/℃|°C|华氏|°F|温度|气温/.test(response)) score += 1;
    else notes.push("天气回答缺少温度");
    if (/小雨|晴|阴|多云|雨|雪|天气/.test(response)) score += 1;
    else notes.push("天气回答缺少天气状况");
    if (/风|降水|湿度/.test(response)) score += 1;
    else notes.push("天气回答缺少风力/降水/湿度信息");
    if (/未能获取|没有获取|无法获取/.test(response) && /小雨|℃|风/.test(response)) {
      notes.push("回答中仍有疑似否认已获取事实的表述");
      score -= 1;
    }
  } else {
    const links = response.match(/https?:\/\//g)?.length ?? 0;
    if (links >= 2) score += 1;
    else notes.push("新闻/市场回答来源数量偏少");
    if (/来源|Reuters|路透|纽约时报|新华社|日期|要点/.test(response)) score += 1;
    else notes.push("新闻/市场回答结构化程度不足");
  }

  return { score, notes };
}

async function main() {
  const ctx = await bootstrap();

  for (const item of casesToRun) {
    if (resume && completedCaseNames.has(item.name)) {
      continue;
    }
    const session = await ctx.orchestrator.createSession({
      agentId: "default",
      channel: "eval",
    });
    const events = [];
    const started = Date.now();

    for await (const event of ctx.orchestrator.processInputStream(
      session.id,
      item.input,
      { originalUserText: item.input },
    )) {
      events.push(event);
    }

    const complete = events.find((event) => event.type === "response_complete");
    const message = (complete?.data as { message?: Record<string, unknown> })
      ?.message;
    const response = short(extractText(message?.content));
    const toolCalls = events
      .filter((event) => event.type === "tool_call")
      .map((event) => (event.data as { name?: string }).name ?? "unknown");
    const toolResults = events
      .filter((event) => event.type === "tool_result")
      .map((event) => {
        const data = event.data as {
          name?: string;
          result?: { content?: string; isError?: boolean };
          durationMs?: number;
        };
        return {
          name: data.name,
          isError: data.result?.isError ?? false,
          durationMs: data.durationMs,
          content: short(data.result?.content ?? "", 500),
        };
      });

    const traceResult = await ctx.memoryStore.getTraces(
      5,
      0,
      undefined,
      session.conversationId,
    );
    const toolResultText = toolResults.map((result) => result.content).join("\n");
    const scoring = scoreCase(item.name, response, toolCalls, toolResultText);

    results.push({
      name: item.name,
      sessionId: session.id,
      conversationId: session.conversationId,
      elapsedMs: Date.now() - started,
      score: scoring.score,
      notes: scoring.notes,
      toolCalls,
      toolResults,
      response,
      usage: {
        model: message?.model,
        tokensIn: message?.tokensIn,
        tokensOut: message?.tokensOut,
        cacheCreationTokens: message?.cacheCreationTokens,
        cacheReadTokens: message?.cacheReadTokens,
        durationMs: message?.durationMs,
        toolCallCount: message?.toolCallCount,
      },
      traces: traceResult.items.map((trace) => ({
        id: trace.id,
        error: trace.error,
        model: trace.model,
        tokensIn: trace.tokensIn,
        tokensOut: trace.tokensOut,
        cacheCreationTokens: trace.cacheCreationTokens,
        cacheReadTokens: trace.cacheReadTokens,
        durationMs: trace.durationMs,
        stepCount: trace.steps.length,
      })),
    });
    completedCaseNames.add(item.name);
    writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  }

  ctx.scheduler?.stopAll?.();
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(JSON.stringify({ outPath, results }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
