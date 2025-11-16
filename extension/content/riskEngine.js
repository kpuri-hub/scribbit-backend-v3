// content/riskEngine.js
// Scribbit Fairness Scanner - Risk Engine (Risk v2 aware)
//
// Takes a page snapshot, runs all rules, and returns a normalized risk result.
//
// For backward compatibility, this still returns:
//   - overallScore  (legacy 0–10 style score)
//   - overallLevel  ("LOW" | "MEDIUM" | "HIGH")
//   - risks         (array of rule/card hits)
//
// With Risk v2, it also returns:
//   - riskScore       (0–100 global score, based on categories)
//   - categoryScores  ({ financial, data_privacy, content_ip, legal_rights })
//   - hasMeaningfulContent (boolean)

const ScribbitRiskEngine = (() => {
  const LEVELS = {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH"
  };

  // Risk v2 model (catalog + scoring helpers)
  const RiskModel = window.ScribbitRiskModel || {};

  /**
   * Legacy overall numeric score from rule results.
   * Very simple for now: sum of severityScore, capped at some ceiling.
   */
  function computeLegacyOverallScore(risks) {
    if (!risks || risks.length === 0) return 0;
    const raw = risks.reduce((sum, r) => sum + (r.severityScore || 0), 0);
    // Soft cap to keep values reasonable
    return Math.min(raw, 10);
  }

  /**
   * Map numeric score to LOW / MEDIUM / HIGH.
   * (Legacy mapping, used for the current panel badge.)
   */
  function scoreToLevel(score) {
    if (score === 0) return LEVELS.LOW;
    if (score <= 3) return LEVELS.LOW;
    if (score <= 6) return LEVELS.MEDIUM;
    return LEVELS.HIGH;
  }

  /**
   * Compute Risk v2 scores (category + global) and hasMeaningfulContent.
   */
  function computeRiskV2Extras(snapshot, risks) {
    const textRaw = snapshot.textRaw || snapshot.textNormalized || "";
    const url = snapshot.url || window.location.href || "";
    const textLength = textRaw.length;

    let pageMode = "content-rich";
    if (typeof RiskModel.classifyPageMode === "function") {
      pageMode = RiskModel.classifyPageMode(url, textLength);
    }

    let hasMeaningfulContent = true;
    if (typeof RiskModel.computeHasMeaningfulContent === "function") {
      hasMeaningfulContent = RiskModel.computeHasMeaningfulContent(
        pageMode,
        textLength
      );
    } else {
      // Fallback heuristic
      hasMeaningfulContent = textLength >= 600 && pageMode !== "auth";
    }

    let categoryScores = {
      financial: 0,
      data_privacy: 0,
      content_ip: 0,
      legal_rights: 0
    };

    if (typeof RiskModel.computeCategoryScores === "function") {
      categoryScores = RiskModel.computeCategoryScores(risks);
    }

    let riskScore = 0;
    if (typeof RiskModel.computeGlobalRiskScore === "function") {
      riskScore = RiskModel.computeGlobalRiskScore(categoryScores);
    }

    return {
      pageMode,
      hasMeaningfulContent,
      categoryScores,
      riskScore
    };
  }

  /**
   * Main entry point: evaluate a page snapshot and return risk result.
   *
   * @param {Object} snapshot
   *  {
   *    url: string,
   *    textRaw: string,
   *    textNormalized: string,
   *    currencySymbolsDetected: string[],
   *    airbnbFees?: string[]
   *  }
   */
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

    const risks = ScribbitRules.evaluateAll(snapshot);

    // Legacy overall score/level (used by current UI)
    const overallScore = computeLegacyOverallScore(risks);
    const overallLevel = scoreToLevel(overallScore);

    // Risk v2 extras
    const {
      hasMeaningfulContent,
      categoryScores,
      riskScore
    } = computeRiskV2Extras(snapshot, risks);

    return {
      // Legacy fields (current panel/popup use these)
      overallScore,
      overallLevel,
      risks,

      // Risk v2 fields (for the next-gen UI + background logic)
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

// Expose globally in content script context
window.ScribbitRiskEngine = ScribbitRiskEngine;
