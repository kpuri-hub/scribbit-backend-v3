// extension/__tests__/rules.test.js

// Set up a minimal RiskModel so createRiskFromCard can resolve card metadata.
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

// jsdom gives us `window`, we just attach to it.
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
    expect(refundRisk.severity).toBe("high"); // from our test card stub
    expect(Array.isArray(refundRisk.evidence)).toBe(true);
    expect(refundRisk.evidence.length).toBeGreaterThan(0);
  });
});

