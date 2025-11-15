// content/riskEngine.js
// Scribbit Fairness Scanner - Risk Engine
//
// Takes a page snapshot, runs all rules, and returns a normalized risk result.
// This is the only module that knows how to translate individual rule hits
// into an overall score / level.

const ScribbitRiskEngine = (() => {
  const LEVELS = {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH"
  };

  /**
   * Compute overall numeric score from rule results.
   * Very simple for now: sum of severityScore, capped at some ceiling.
   */
  function computeOverallScore(risks) {
    if (!risks || risks.length === 0) return 0;
    const raw = risks.reduce((sum, r) => sum + (r.severityScore || 0), 0);
    // Soft cap to keep values reasonable
    return Math.min(raw, 10);
  }

  /**
   * Map numeric score to LOW / MEDIUM / HIGH.
   */
  function scoreToLevel(score) {
    if (score === 0) return LEVELS.LOW;
    if (score <= 3) return LEVELS.LOW;
    if (score <= 6) return LEVELS.MEDIUM;
    return LEVELS.HIGH;
  }

  /**
   * Main entry point: evaluate a page snapshot and return risk result.
   *
   * @param {Object} snapshot
   *  {
   *    url: string,
   *    textRaw: string,
   *    textNormalized: string,
   *    currencySymbolsDetected: string[]
   *  }
   */
  function evaluatePage(snapshot) {
    if (!window.ScribbitRules) {
      console.warn("[Scribbit] ScribbitRules not available in riskEngine.");
      return {
        overallScore: 0,
        overallLevel: LEVELS.LOW,
        risks: []
      };
    }

    const risks = ScribbitRules.evaluateAll(snapshot);
    const overallScore = computeOverallScore(risks);
    const overallLevel = scoreToLevel(overallScore);

    return {
      overallScore,
      overallLevel,
      risks
    };
  }

  return {
    LEVELS,
    evaluatePage
  };
})();

// Expose globally in content script context
window.ScribbitRiskEngine = ScribbitRiskEngine;
