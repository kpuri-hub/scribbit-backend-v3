// extension/__tests__/riskEngine.test.js

function makeTestCard(id, category = "financial", severity = "med") {
  return {
    id,
    category,
    title: id,
    defaultDescription: `Test card: ${id}`,
    severity,
    autoPopupWorthy: false,
  };
}

window.ScribbitRiskModel = {
  RISK_CARDS: {
    non_refundable_or_final_sale: makeTestCard(
      "non_refundable_or_final_sale",
      "financial",
      "high"
    ),
    short_refund_or_return_window: makeTestCard(
      "short_refund_or_return_window",
      "financial",
      "med"
    ),
    dcc_or_fx_markup: makeTestCard("dcc_or_fx_markup", "financial", "high"),
    mandatory_arbitration: makeTestCard(
      "mandatory_arbitration",
      "legal_rights",
      "high"
    ),
    auto_renewing_subscription: makeTestCard(
      "auto_renewing_subscription",
      "financial",
      "high"
    ),
    unilateral_terms_changes: makeTestCard(
      "unilateral_terms_changes",
      "legal_rights",
      "med"
    ),
    extra_fees_not_in_base_price: makeTestCard(
      "extra_fees_not_in_base_price",
      "financial",
      "med"
    ),
    resort_or_facility_fee: makeTestCard(
      "resort_or_facility_fee",
      "financial",
      "high"
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
  });

  test("detects risks and computes scores for a risky snapshot", () => {
    const snapshot = {
      url: "https://example.com/risky",
      textRaw:
        "This booking is strictly NON-REFUNDABLE. Service fee may apply. We apply our own exchange rate.",
      textNormalized:
        "this booking is strictly non-refundable. service fee may apply. we apply our own exchange rate.",
      currencySymbolsDetected: ["$", "USD"],
    };

    const result = window.ScribbitRiskEngine.evaluatePage(snapshot);

    expect(result.risks.length).toBeGreaterThan(0);
    expect(result.overallScore).toBeGreaterThan(0);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(result.overallLevel);

    expect(result).toHaveProperty("riskScore");
    expect(result).toHaveProperty("categoryScores");
    expect(result).toHaveProperty("hasMeaningfulContent");

    expect(typeof result.riskScore).toBe("number");
    expect(result.categoryScores).toHaveProperty("financial");
    expect(result.categoryScores).toHaveProperty("data_privacy");
    expect(result.categoryScores).toHaveProperty("content_ip");
    expect(result.categoryScores).toHaveProperty("legal_rights");
  });
});

