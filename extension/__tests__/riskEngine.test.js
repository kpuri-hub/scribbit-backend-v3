// extension/__tests__/riskEngine.test.js
// Contract tests for ScribbitRiskEngine.evaluatePage
//
// Goal: make sure evaluatePage always returns a well-formed object
// (risks array, categoryScores, riskScore, overallLevel, flags, etc.)
// We do NOT assert a specific number of risks here, because that depends
// on the active rule set and wiring, which is better tested in-browser.

//
// 1) Provide minimal globals BEFORE loading riskEngine.js
//
window.ScribbitRules = {
  // In these tests we just say "no risks"
  evaluateAll: () => []
};

window.ScribbitRiskModel = window.ScribbitRiskModel || {};

// Now load the engine
require("../content/riskEngine.js");
const ScribbitRiskEngine = window.ScribbitRiskEngine;

describe("ScribbitRiskEngine.evaluatePage", () => {
  function snapshot(text = "") {
    return {
      textNormalized: text.toLowerCase(),
      textRaw: text,
      url: "https://example.com/test"
    };
  }

  test("returns a well-formed result object even when there are no risks", () => {
    const result = ScribbitRiskEngine.evaluatePage(snapshot(""));

    // Core shape
    expect(result).toHaveProperty("risks");
    expect(Array.isArray(result.risks)).toBe(true);

    expect(result).toHaveProperty("categoryScores");
    expect(result.categoryScores).toHaveProperty("financial");
    expect(result.categoryScores).toHaveProperty("data_privacy");
    expect(result.categoryScores).toHaveProperty("content_ip");
    expect(result.categoryScores).toHaveProperty("legal_rights");

    expect(result).toHaveProperty("riskScore");
    expect(typeof result.riskScore).toBe("number");

    expect(result).toHaveProperty("overallLevel");
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(result.overallLevel);

    expect(result).toHaveProperty("hasMeaningfulContent");
    expect(typeof result.hasMeaningfulContent).toBe("boolean");

    expect(result).toHaveProperty("pageMode");
    expect(typeof result.pageMode).toBe("string");
  });
});
