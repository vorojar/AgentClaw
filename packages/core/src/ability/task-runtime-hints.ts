import { currentLocalDateString } from "../completion-policies/common.js";

interface RuntimeTaskClassification {
  isNewsBriefTask: boolean;
  isAiNewsTask: boolean;
  isPptxGenerationTask: boolean;
}

export function classifyRuntimeTask(inputText: string): RuntimeTaskClassification {
  const isNewsBriefTask = /新闻|简报|news|brief/i.test(inputText);
  const isPptxMention =
    /\b(pptx|ppt|powerpoint)\b|PPT|幻灯片|演示文稿|slide deck|presentation deck/i.test(
      inputText,
    );
  const isPptxGenerationTask =
    isPptxMention &&
    /生成|制作|做成|做(?:个|一个|一份|一套)?|创建|导出|发送|发给|直接|produce|create|make|build|export|send/i.test(
      inputText,
    ) &&
    !isPptxNonGenerationRequest(inputText);

  return {
    isNewsBriefTask,
    isAiNewsTask: isAiNewsLikeTask(inputText),
    isPptxGenerationTask,
  };
}

export function buildTaskRuntimeHints(
  inputText: string,
  classification = classifyRuntimeTask(inputText),
  now = new Date(),
): string[] {
  const hints: string[] = [];

  if (classification.isPptxGenerationTask) {
    hints.push(
      "[PPTX视觉决策]必须先根据本次用途选择视觉风格。长期记忆里的视觉偏好只作为可选参考，不是默认强制主题；用户没有明确要求暗色时，不要因为记忆里的暗色偏好就全 deck 使用暗色。",
    );
    if (isCommercialPptxTask(inputText)) {
      hints.push(
        "[PPTX商业提案风格]当前是拉赞助/招商/商业合作类 PPTX。默认使用明亮、干净、商业提案风：白底或浅灰底、品牌色点缀、少量深色封面/章节页可以，但正文页应以高可读、可信、专业为主。不要因为长期记忆里的暗色偏好就全 deck 使用暗色。",
      );
    }
  }

  if (classification.isNewsBriefTask) {
    hints.push(
      "[新闻任务约束]优先在3轮以内完成：第1轮并行 web_search 搜索并筛选，第2轮只在必要时用 web_fetch 抓取少量原文，第3轮必须合成最终答复。只采用高可信来源：官方公告/公司博客/监管机构/学术机构/Reuters/AP/Bloomberg/FT/The Verge/TechCrunch/MIT Technology Review/Stanford HAI等。不要使用Reddit、YouTube、低质量SEO聚合站或个人博客作为事实来源，除非用户明确要求。无法用可信来源交叉确认的新闻点直接跳过或标注未确认。已有搜索结果足够时不要继续抓取原文。",
    );
  }

  if (classification.isAiNewsTask) {
    hints.push(
      `[news-task] Today is ${currentLocalDateString(now)}. Finish in about 3 LLM turns. Use parallel web_search first, then web_fetch only for missing key facts, then final answer. Prefer primary/trusted sources only: official company blogs, regulator/government/university sources, Reuters, AP, Bloomberg, FT, The Verge, TechCrunch, MIT Technology Review, Stanford HAI. Explicitly reject Reddit, YouTube, Yahoo Finance, SEO aggregators, random blogs, and unsourced claims. Recent news only: if the item is not from today or the last 7 days, include it only when it is clearly still developing and mark the exact date. Output no more than 5 high-confidence items. Do not fetch raw pages when snippets already contain enough facts.`,
    );
  }

  return hints;
}

function isCommercialPptxTask(inputText: string): boolean {
  return /拉赞助|赞助|招商|商业合作|合作方案|商务|提案|proposal|sponsor|sponsorship|pitch deck|sales deck/i.test(
    inputText,
  );
}

function isPptxNonGenerationRequest(inputText: string): boolean {
  return /不用生成|先不用生成|不要生成|别生成|无需生成|不用做|先别做|不实际生成|不要实际生成|无需实际生成|不要创建文件|不用创建文件|不创建文件|不要实际创建|只回答|只说明|只说|only answer|do not generate|don't generate|no file/i.test(
    inputText,
  );
}

function isAiNewsLikeTask(inputText: string): boolean {
  const hasAiTopic =
    /\bAI\b|人工智能|artificial intelligence|machine learning|LLM|大模型/i.test(
      inputText,
    );
  const hasNewsIntent =
    /新闻|简报|资讯|快讯|日报|周报|动态|最新|今日|今天|近期|本周|这周|news|brief|daily|weekly|roundup|latest|recent/i.test(
      inputText,
    );
  return hasAiTopic && hasNewsIntent;
}
