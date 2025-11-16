// content/riskEngine.js
// Scribbit Fairness Scanner - Risk Engine (Risk v2 aware)

const ScribbitRiskEngine = (() => {
  const LEVELS = {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH"
  };

  const RiskModel = window.ScribbitRiskModel || {};

  /************************************************************
   * Legacy scoring (kept for backward compatibility)
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
   * Risk v2 Extras: Page Mode, Meaningful Content, Category Scores
   ************************************************************/
  function computeRiskV2Extras(snapshot, risks) {
    const rawText = snapshot.textRaw || snapshot.textNormalized || "";
    const url = snapshot.url || window.location.href;
    const textLength = rawText.length;

    let pageMode = "content-rich";
    if (RiskModel.classifyPageMode) {
      pageMode = RiskModel.classifyPageMode(url, textLength);
    }

    let hasMeaningfulContent = true;
    if (RiskModel.computeHasMeaningfulContent) {
      hasMeaningfulContent = RiskModel.computeHasMeaningfulContent(
        pageMode,
        textLength
      );
    }

    let categoryScores = {
      financial: 0,
      data_privacy: 0,
      content_ip: 0,
      legal_rights: 0
    };

    if (RiskModel.computeCategoryScores) {
      categoryScores = RiskModel.computeCategoryScores(risks);
    }

    let riskScore = 0;
    if (RiskModel.computeGlobalRiskScore) {
      riskScore = RiskModel.computeGlobalRiskScore(categoryScores);
    }

    return {
      pageMode,
      hasMeaningfulContent,
      categoryScores,
      riskScore
    };
  }

  /************************************************************
   * MAIN ENTRY: Evaluate a page snapshot
   ************************************************************/
  function evaluatePage(snapshot) {
    if (!window.ScribbitRules) {
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

    // Run rules
    const risks = ScribbitRules.evaluateAll(snapshot);

    // Legacy score for current UI
    const overallScore = computeLegacyOverallScore(risks);
    const overallLevel = scoreToLevel(overallScore);

    // Extended metrics for next-gen model
    const { hasMeaningfulContent, categoryScores, riskScore } =
      computeRiskV2Extras(snapshot, risks);

    return {
      overallScore,
      overallLevel,
      risks,
      riskScore,
      categoryScores,
      hasMeaningfulContent
    };
  }

  return {
    LEVELS,
    evaluatePage
  };
})();

window.ScribbitRiskEngine = ScribbitRiskEngine;
