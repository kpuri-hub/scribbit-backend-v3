// extension/__tests__/rules.test.js

// Set up a minimal RiskModel so createRiskFromCard can resolve card metadata.
function makeTestCard(id, category = "financial", severity = "MED") {
  return {
    id,
    category,
    title: id,
    defaultDescription: `Test card: ${id}`,
    severity, // we use uppercase to match the way your engine tends to represent severity
    autoPopupWorthy: false,
  };
}

// jsdom gives us `window`, we just attach to it.
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
};

// Requiring rules.js will populate window.ScribbitRules via its IIFE.
require("../content/rules.js");

describe("ScribbitRules", () => {
  test("ScribbitRules is attached to window", () => {
    expect(window.ScribbitRules).toBeDefined();
    expect(typeof window.ScribbitRules.evaluateAll).toBe("function");
  });

  test("detects non-refundable refund language", () => {
    const snapshot = {
      textNormalized:
        "this booking is strictly non-refundable and cannot be canceled.",
      textRaw:
        "This booking is strictly NON-REFUNDABLE and cannot be canceled.",
      url: "https://example.com/booking",
    };

    const risks = window.ScribbitRules.evaluateAll(snapshot);

    expect(Array.isArray(risks)).toBe(true);
    expect(risks.length).toBeGreaterThan(0);

    const refundRisk = risks.find(
      (r) => r.id === "non_refundable_or_final_sale"
    );
    expect(refundRisk).toBeDefined();

    // Be robust to casing: HIGH vs high, etc.
    expect(refundRisk.severity.toLowerCase()).toBe("high");

    expect(Array.isArray(refundRisk.evidence)).toBe(true);
    expect(refundRisk.evidence.length).toBeGreaterThan(0);
  });
});
