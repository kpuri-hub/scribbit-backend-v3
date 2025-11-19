// content/riskEngine.js
// Scribbit Fairness Scanner - Risk Engine (Risk Model v2 compatible)
//
// - Consumes ScribbitRules.evaluateAll(snapshot) for detection
// - Uses RiskModel helpers if available, falls back to local logic otherwise
// - Produces:
//     {
//       risks: [],
//       categoryScores: { financial, data_privacy, content_ip, legal_rights },
//       riskScore: 0–100,
//       overallLevel: "LOW" | "MEDIUM" | "HIGH",
//       overallScore: same as riskScore (legacy),
//       hasMeaningfulContent: boolean,
//       pageMode: "content-rich" | "low-content" | "auth"
//     }
//
// Also logs the full result for debugging.

const ScribbitRiskEngine = (() => {
  const LEVELS = {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH",
  };

  const RiskModel = window.ScribbitRiskModel || {};
  const Rules = window.ScribbitRules || null;

  /************************************************************
   * 1. Category scoring (local fallback)
   ************************************************************/

  function severityToPointsFromRisk(risk) {
    // Prefer explicit severityScore if present.
    if (typeof risk.severityScore === "number") {
      // Map legacy scores 1/2/3 → 25/50/80
      if (risk.severityScore >= 3) return 80;
      if (risk.severityScore >= 2) return 50;
      if (risk.severityScore >= 1) return 25;
      return 0;
    }

    const sevStr = String(risk.severity || "").toUpperCase();
    if (sevStr === "HIGH") return 80;
    if (sevStr === "MEDIUM") return 50;
    if (sevStr === "LOW") return 25;
    return 0;
  }

  function computeCategoryScoresLocal(risks) {
    const scores = {
      financial: 0,
      data_privacy: 0,
      content_ip: 0,
      legal_rights: 0,
    };

    if (!Array.isArray(risks)) return scores;

    for (const r of risks) {
      const cat = r.category || "financial";
      const points = severityToPointsFromRisk(r);

      if (typeof scores[cat] !== "number") {
        scores[cat] = 0;
      }
      if (points > scores[cat]) {
        scores[cat] = points;
      }
    }

    return scores;
  }

  function computeGlobalRiskScoreLocal(categoryScores) {
    const values = Object.values(categoryScores || {});
    if (!values.length) return 0;
    return Math.max.apply(null, values);
  }

  function computeOverallLevel(riskScore) {
    if (riskScore >= 70) return LEVELS.HIGH;
    if (riskScore >= 40) return LEVELS.MEDIUM;
    if (riskScore > 0) return LEVELS.LOW;
    // For a 0 score we still treat as LOW but effectively "safe".
    return LEVELS.LOW;
  }

  /************************************************************
   * 2. Page mode / meaningful content
   ************************************************************/

  function computePageContextAndContent(snapshot) {
    const rawText = snapshot.textRaw || snapshot.textNormalized || "";
    const url =
      snapshot.url ||
      (typeof window !== "undefined" && window.location
        ? window.location.href
        : "");
    const textLength = rawText.length;

    let pageMode = "content-rich";

    if (typeof RiskModel.classifyPageMode === "function") {
      pageMode = RiskModel.classifyPageMode(url, textLength);
    } else {
      // Fallback heuristics if RiskModel isn't available
      const lower = String(url || "").toLowerCase();
      const looksAuth =
        lower.includes("/login") ||
        lower.includes("/signin") ||
        lower.includes("/sign-in") ||
        lower.includes("/auth") ||
        lower.includes("/register") ||
        lower.includes("/signup");

      if (looksAuth) {
        pageMode = "auth";
      } else if (textLength < 800) {
        pageMode = "low-content";
      } else {
        pageMode = "content-rich";
      }
    }

    let hasMeaningfulContent = false;

    if (typeof RiskModel.computeHasMeaningfulContent === "function") {
      hasMeaningfulContent = RiskModel.computeHasMeaningfulContent(
        pageMode,
        textLength
      );
    } else {
      // Fallback: treat content-rich pages as meaningful, others only if long enough
      if (pageMode === "content-rich") {
        hasMeaningfulContent = true;
      } else {
        hasMeaningfulContent = textLength >= 600 && pageMode !== "auth";
      }
    }

    return { pageMode, hasMeaningfulContent };
  }

  /************************************************************
   * 3. Core evaluatePage
   ************************************************************/

  function evaluatePage(snapshot) {
    const safeSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};

    // 1) Run all rules
    let risks = [];
    try {
      if (Rules && typeof Rules.evaluateAll === "function") {
        risks = Rules.evaluateAll(safeSnapshot) || [];
      }
    } catch (err) {
      console.error("[Scribbit] Error evaluating rules:", err);
      risks = [];
    }

    // 2) Compute category scores
    let categoryScores = {
      financial: 0,
      data_privacy: 0,
      content_ip: 0,
      legal_rights: 0,
    };

    try {
      if (typeof RiskModel.computeCategoryScores === "function") {
        categoryScores = RiskModel.computeCategoryScores(risks);
      } else {
        categoryScores = computeCategoryScoresLocal(risks);
      }
    } catch (err) {
      console.error("[Scribbit] Error computing category scores:", err);
      categoryScores = computeCategoryScoresLocal(risks);
    }

    // 3) Global risk score
    let riskScore = 0;
    try {
      if (typeof RiskModel.computeGlobalRiskScore === "function") {
        riskScore = RiskModel.computeGlobalRiskScore(categoryScores);
      } else {
        riskScore = computeGlobalRiskScoreLocal(categoryScores);
      }
    } catch (err) {
      console.error("[Scribbit] Error computing global risk score:", err);
      riskScore = computeGlobalRiskScoreLocal(categoryScores);
    }

    // 4) Overall level + page context
    const { pageMode, hasMeaningfulContent } =
      computePageContextAndContent(safeSnapshot);
    const overallLevel = computeOverallLevel(riskScore);

    const result = {
      // New model fields
      risks,
      categoryScores,
      riskScore,
      overallLevel,
      hasMeaningfulContent,
      pageMode,

      // Legacy alias
      overallScore: riskScore,
    };

    // 🔍 Debug log so you can inspect in DevTools Console
    console.log("[Scribbit] RiskEngine.evaluatePage result:", result);

    return result;
  }

  return {
    LEVELS,
    evaluatePage,
  };
})();

// Expose globally
window.ScribbitRiskEngine = ScribbitRiskEngine;
