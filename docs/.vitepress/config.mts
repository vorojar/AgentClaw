import { defineConfig } from "vitepress";

const base = process.env.DOCS_BASE ?? "/";

export default defineConfig({
  title: "Agent Engineering",
  description:
    "A publication for global agent engineers and teams learning from real failures, mechanisms, and production methods.",
  base,
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: [
    "HIVE.md",
    "AUDIT-FIX-REPORT.md",
    "vsopenclawtask.md",
    "__pycache__/**",
    "从零到一造Agent/**",
  ],
  head: [
    ["link", { rel: "icon", href: `${base}logo.svg`, type: "image/svg+xml" }],
    ["meta", { name: "theme-color", content: "#101820" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "Agent Engineering" }],
    [
      "meta",
      {
        property: "og:description",
        content:
          "A publication for global agent engineers and teams learning from real failures, mechanisms, and production methods.",
      },
    ],
  ],
  themeConfig: {
    logo: { src: "/logo.svg", alt: "Agent Engineering" },
    nav: [
      { text: "Blog", link: "/blog/" },
      { text: "Series", link: "/blog/building-ai-agents/" },
      { text: "Field Guides", link: "/guide/" },
      { text: "Systems", link: "/compare/" },
      { text: "Papers", link: "/papers/" },
    ],
    sidebar: {
      "/blog/building-ai-agents/": [
        {
          text: "Series",
          items: [
            { text: "Series Home", link: "/blog/building-ai-agents/" },
            { text: "Agent Loop Safety", link: "/blog/building-ai-agents/01-the-agent-loop" },
            { text: "Tool System Design", link: "/blog/building-ai-agents/02-tool-system-design" },
            { text: "Context Management", link: "/blog/building-ai-agents/03-context-management" },
            { text: "Memory Architecture", link: "/blog/building-ai-agents/04-memory-architecture" },
            { text: "Token Economy", link: "/blog/building-ai-agents/05-the-token-economy" },
            { text: "LLM Failure Handling", link: "/blog/building-ai-agents/06-when-llms-fail" },
            { text: "Security", link: "/blog/building-ai-agents/07-security" },
            { text: "Browser Automation", link: "/blog/building-ai-agents/08-browser-automation" },
            { text: "Multi-Channel Agents", link: "/blog/building-ai-agents/09-multi-channel" },
            { text: "Production Readiness", link: "/blog/building-ai-agents/10-production-readiness" },
          ],
        },
      ],
      "/blog/": [
        {
          text: "Blog",
          items: [
            { text: "Blog Home", link: "/blog/" },
            { text: "Memory Control System", link: "/blog/memory-control-system" },
            { text: "Trace Replay Testing", link: "/blog/trace-replay-testing" },
            { text: "Last-Mile Delivery", link: "/blog/last-mile-delivery" },
            { text: "Skill Runtime Contracts", link: "/blog/skills-runtime-contracts" },
            { text: "Context Compression", link: "/blog/context-compression" },
            { text: "Building AI Agent Frameworks", link: "/blog/building-ai-agents/" },
          ],
        },
      ],
      "/guide/": [
        {
          text: "Field Guides",
          items: [
            { text: "Field Guides Home", link: "/guide/" },
            { text: "Architecture", link: "/guide/architecture" },
            { text: "Roadmap", link: "/guide/roadmap" },
            { text: "Engineering Lessons", link: "/guide/engineering-lessons" },
          ],
        },
      ],
      "/compare/": [
        {
          text: "Systems",
          items: [
            { text: "Systems Home", link: "/compare/" },
            { text: "Assistant Presence vs Control Planes", link: "/compare/agentclaw-vs-openclaw" },
          ],
        },
      ],
      "/papers/": [
        {
          text: "Papers",
          items: [
            { text: "Papers Home", link: "/papers/" },
            { text: "Memory as a Control System", link: "/papers/memory-control-system" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/vorojar/AgentClaw" },
    ],
    search: {
      provider: "local",
    },
    outline: {
      level: [2, 3],
    },
    footer: {
      message: "A publication built from production traces, not imagined happy paths.",
      copyright: "Agent Engineering",
    },
  },
});
