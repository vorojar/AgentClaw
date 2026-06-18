export function isEvidenceTableAnalysisIntent(inputText: string): boolean {
  const wantsTable = /表格|table/i.test(inputText);
  const hasAnalysisVerb =
    /检查|检测|测评|查验|审计|分析|评估|诊断|体检|audit|check|inspect|test|analy[sz]e|review/i.test(
      inputText,
    );
  const hasResearchableTarget =
    /https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}|官网|网站|网页|站点|安全|性能|转化|\bseo\b|搜索引擎优化|收录|sitemap|robots|响应头|headers?/i.test(
      inputText,
    );

  return wantsTable && hasAnalysisVerb && hasResearchableTarget;
}

export function isDeepEvidenceTableAuditIntent(inputText: string): boolean {
  return (
    isEvidenceTableAnalysisIntent(inputText) &&
    /全面|详细|详尽|完整|深度|深入|专家级|顶级|comprehensive|detailed|exhaustive|expert/i.test(
      inputText,
    )
  );
}
