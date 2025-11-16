// content/riskEngine.js
// Scribbit Fairness Scanner - Risk Engine (robust Risk v2 scoring)
//
// - Keeps legacy fields: overallScore, overallLevel, risks
// - Adds Risk v2 fields: riskScore (0–100), categoryScores, hasMeaningfulContent
// - Does NOT rely on RiskModel.computeCategoryScores, so it's robust even if
//   some risk objects are missing category.

const ScribbitRiskEngine = (() => {
  const LEVELS = {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH"
  };

  const RiskModel = window.ScribbitRiskModel || {};

  /************************************************************
   * Legacy scoring (for existing UI)
   ************************************************************/
  function computeLegacyOverallScore(risks) {
    if (!risks || risks.length === 0) return 0;
    const total = risks.reduce((sum, r) => sum + (r.severityScore || 0), 0);
    return Math.min(total, 10);
  }

  function scoreToLevel(score) {
    if (score === 0) return LEVELS.LOW;
    if (score <= 3) return LEVELS.LOW;
    if (score <= 6) return LEVELS.MEDIUM;
    return LEVELS.HIGH;
  }

  /************************************************************
   * Helpers for Risk v2 scoring
   ************************************************************/

  function severityToScore(sev, severityScoreLegacy) {
    if (sev) {
      const s = String(sev).toLowerCase();
      if (s === "high") return 80;
      if (s === "med" || s === "medium") return 50;
      if (s === "low") return 25;
    }
    // Fallback based on old numeric severityScore
    if (typeof severityScoreLegacy === "number") {
      if (severityScoreLegacy >= 3) return 80;
      if (severityScoreLegacy === 2) return 50;
      if (severityScoreLegacy === 1) return 25;
    }
    return 0;
  }

  // Try to infer category from the risk object if category is missing.
  function inferCategory(risk) {
    if (!risk) return "financial"; // safe default

    if (risk.category) return risk.category;

    const title = (risk.title || risk.label || "").toLowerCase();
    const tags = Array.isArray(risk.tags) ? risk.tags.join(" ").toLowerCase() : "";

    const text = title + " " + tags;

    // Financial
    if (
      /refund|fee|fees|price|pricing|charge|charges|currency|exchange|fx|dcc|subscription|auto-?renew/.test(
        text
      )
    ) {
      return "financial";
    }

    // Data privacy
    if (
      /data|privacy|tracking|cookie|cookies|personal information|location|gps|analytics|third[- ]parties/.test(
        text
      )
    ) {
      return "data_privacy";
    }

    // Content/IP
    if (
      /content|image|photo|photos|pictures|upload|uploads|license|licence|marketing|publicly/.test(
        text
      )
    ) {
      return "content_ip";
    }

    // Legal rights
    if (
      /arbitration|class action|lawsuit|liability|indemnity|jurisdiction|governing law|termination|suspend your account/.test(
        text
      )
    ) {
      return "legal_rights";
    }

    // Default bucket if nothing matched
    return "financial";
  }

  function computeCategoryScoresLocal(risks) {
    const base = {
      financial: 0,
      data_privacy: 0,
      content_ip: 0,
      legal_rights: 0
    };

    if (!Array.isArray(risks)) return base;

    for (const r of risks) {
      const category = inferCategory(r);
      const score = severityToScore(r.severity, r.severityScore);
      if (score > base[category]) {
        base[category] = score;
      }
    }

    return base;
  }

  function computeGlobalRiskScoreLocal(categoryScores) {
    const values = Object.values(categoryScores || {});
    if (!values.length) return 0;
    return Math.max.apply(null, values);
  }

  /************************************************************
   * Page mode / meaningful content (uses RiskModel if available)
   ************************************************************/
  function computePageContextAndContent(snapshot) {
    const rawText = snapshot.textRaw || snapshot.textNormalized || "";
    const url = snapshot.url || window.location.href || "";
    const textLength = rawText.length;

    let pageMode = "content-rich";
    if (typeof RiskModel.classifyPageMode === "function") {
      pageMode = RiskModel.classifyPageMode(url, textLength);
    } else {
      // Fallback
      const lower = url.toLowerCase();
      const looksAuth =
        lower.includes("/login") ||
        lower.includes("/signin") ||
        lower.includes("/sign-in") ||
        lower.includes("/auth") ||
        lower.includes("/register") ||
        lower.includes("/signup");

      if (looksAuth) pageMode = "auth";
      else if (textLength < 800) pageMode = "low-content";
      else pageMode = "content-rich";
    }

    let hasMeaningfulContent = true;
    if (typeof RiskModel.computeHasMeaningfulContent === "function") {
      hasMeaningfulContent = RiskModel.computeHasMeaningfulContent(
        pageMode,
        textLength
      );
    } else {
      hasMeaningfulContent = pageMode === "content-rich" || textLength >= 600;
    }

    return { pageMode, hasMeaningfulContent, textLength, url };
  }

  /************************************************************
   * MAIN ENTRY: Evaluate a page snapshot
   ************************************************************/
  function evaluatePage(snapshot) {
    if (!window.ScribbitRules) {
      console.warn("[Scribbit] ScribbitRules not available in riskEngine.");
      return {
        overallScore: 0,
        overallLevel: LEVELS.LOW,
        risks: [],
        riskScore: 0,
        categoryScores: {
          financial: 0,
          data_privacy: 0,
          content_ip: 0,
          legal_rights: 0
        },
        hasMeaningfulContent: false
      };
    }

    const risks = ScribbitRules.evaluateAll(snapshot) || [];

    // Legacy score for existing UI bits
    const overallScore = computeLegacyOverallScore(risks);
    const overallLevel = scoreToLevel(overallScore);

    // Page context + content
    const { pageMode, hasMeaningfulContent } =
      computePageContextAndContent(snapshot);

    // Robust local category scoring
    const categoryScores = computeCategoryScoresLocal(risks);
    const riskScore = computeGlobalRiskScoreLocal(categoryScores);

    return {
      overallScore,
      overallLevel,
      risks,
      riskScore,
      categoryScores,
      hasMeaningfulContent,
      pageMode
    };
  }

  return {
    LEVELS,
    evaluatePage
  };
})();

// Expose globally
window.ScribbitRiskEngine = ScribbitRiskEngine;
