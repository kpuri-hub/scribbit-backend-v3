// extension/__tests__/riskEngine.test.js

function makeTestCard(id, category = "financial", severity = "MED") {
  return {
    id,
    category,
    title: id,
    defaultDescription: `Test card: ${id}`,
    severity,
    autoPopupWorthy: false,
  };
}

// Provide a RiskModel stub so riskEngine has everything it expects.
window.ScribbitRiskModel = {
  RISK_CARDS: {
    non_refundable_or_final_sale: makeTestCard(
      "non_refundable_or_final_sale",
      "financial",
      "HIGH"
    ),
    short_refund_or_return_window: makeTestCard(
      "short_refund_or_return_window",
      "financial",
      "MED"
    ),
    dcc_or_fx_markup: makeTestCard("dcc_or_fx_markup", "financial", "HIGH"),
    mandatory_arbitration: makeTestCard(
      "mandatory_arbitration",
      "legal_rights",
      "HIGH"
    ),
    auto_renewing_subscription: makeTestCard(
      "auto_renewing_subscription",
      "financial",
      "HIGH"
    ),
    unilateral_terms_changes: makeTestCard(
      "unilateral_terms_changes",
      "legal_rights",
      "MED"
    ),
    extra_fees_not_in_base_price: makeTestCard(
      "extra_fees_not_in_base_price",
      "financial",
      "MED"
    ),
    resort_or_facility_fee: makeTestCard(
      "resort_or_facility_fee",
      "financial",
      "HIGH"
    ),
  },
  // Simple stubs for pageMode/content helpers
  classifyPageMode: () => "content-rich",
  computeHasMeaningfulContent: () => true,
};

// Load rules first (so window.ScribbitRules exists), then riskEngine.
require("../content/rules.js");
require("../content/riskEngine.js");

describe("ScribbitRiskEngine.evaluatePage", () => {
  test("returns safe defaults when given minimal snapshot", () => {
    const snapshot = {
      textRaw: "",
      textNormalized: "",
      url: "https://example.com/empty",
    };

    const result = window.ScribbitRiskEngine.evaluatePage(snapshot);

    expect(result).toHaveProperty("overallScore");
    expect(result).toHaveProperty("overallLevel");
    expect(result).toHaveProperty("risks");
    expect(Array.isArray(result.risks)).toBe(true);
    expect(result.overallScore).toBe(0);
    expect(result.risks.length).toBe(0);

    // Risk v2 additions
    expect(result).toHaveProperty("riskScore");
    expect(result).toHaveProperty("categoryScores");
    expect(result).toHaveProperty("hasMeaningfulContent");

    // We don't enforce true/false here; we just require a boolean.
    expect(typeof result.hasMeaningfulContent).toBe("boolean");
  });

  test("detects risks and computes scores for a risky snapshot", () => {
    const snapshot = {
      url: "https://example.com/risky",
      textRaw:
        "This booking is strictly NON-REFUNDABLE. Service fee may apply. We apply our own exchange rate via dynamic currency conversion.",
      textNormalized:
        "this booking is strictly non-refundable. service fee may apply. we apply our own exchange rate via dynamic currency conversion.",
      currencySymbolsDetected: ["$", "USD"],
    };

    const result = window.ScribbitRiskEngine.evaluatePage(snapshot);

    expect(Array.isArray(result.risks)).toBe(true);
    expect(result.risks.length).toBeGreaterThan(0);

    expect(typeof result.overallScore).toBe("number");
    expect(result.overallScore).toBeGreaterThan(0);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(result.overallLevel);

    // Risk v2 fields
    expect(typeof result.riskScore).toBe("number");
    expect(result.riskScore).toBeGreaterThan(0);

    const cs = result.categoryScores;
    expect(cs).toBeDefined();
    expect(cs).toHaveProperty("financial");
    expect(cs).toHaveProperty("data_privacy");
    expect(cs).toHaveProperty("content_ip");
    expect(cs).toHaveProperty("legal_rights");

    // All category scores are non-negative
    Object.values(cs).forEach((v) => {
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThanOrEqual(0);
    });

    // At least one category score should be > 0 when we have risks
    const maxCategoryScore = Math.max(...Object.values(cs));
    expect(maxCategoryScore).toBeGreaterThan(0);

    // Global riskScore should equal the max of category scores
    expect(result.riskScore).toBe(maxCategoryScore);

    // Our stub says this page has meaningful content; engine should respect that.
    expect(result.hasMeaningfulContent).toBe(true);

    // pageMode comes from our stub classifyPageMode
    expect(typeof result.pageMode).toBe("string");
    expect(result.pageMode).toBe("content-rich");
  });

  test("does not throw and returns a sane shape for arbitrary text", () => {
    const snapshot = {
      url: "https://example.com/random",
      textRaw:
        "Some random legal text about your experience, loyalty points, and optional services.",
      textNormalized:
        "some random legal text about your experience, loyalty points, and optional services.",
    };

    const result = window.ScribbitRiskEngine.evaluatePage(snapshot);

    expect(result).toHaveProperty("overallScore");
    expect(result).toHaveProperty("overallLevel");
    expect(result).toHaveProperty("risks");
    expect(result).toHaveProperty("riskScore");
    expect(result).toHaveProperty("categoryScores");
    expect(result).toHaveProperty("hasMeaningfulContent");

    expect(Array.isArray(result.risks)).toBe(true);
    expect(typeof result.overallScore).toBe("number");
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(result.overallLevel);
    expect(typeof result.hasMeaningfulContent).toBe("boolean");
  });
});
