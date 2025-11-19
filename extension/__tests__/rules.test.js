// extension/__tests__/rules.test.js
// Basic integration tests for ScribbitRules.evaluateAll

function makeTestCard(id, category = "financial", severity = "high") {
  return {
    id,
    category,
    title: id,
    defaultDescription: `Test card: ${id}`,
    severity, // "high", "med", "low"
    autoPopupWorthy: false
  };
}

// Provide a minimal RiskModel so rules.js can create risks
window.ScribbitRiskModel = {
  RISK_CARDS: {
    // Refund / cancellation cards
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
    ultra_short_cancellation_window: makeTestCard(
      "ultra_short_cancellation_window",
      "financial",
      "high"
    ),

    // Fees / pricing
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

    // FX / DCC
    dcc_or_fx_markup: makeTestCard("dcc_or_fx_markup", "financial", "high"),

    // Legal
    mandatory_arbitration: makeTestCard(
      "mandatory_arbitration",
      "legal_rights",
      "high"
    )
  }
};

// Load rules after stubbing RiskModel
require("../content/rules.js");

const ScribbitRules = window.ScribbitRules;

function makeSnapshot(text) {
  return {
    textNormalized: (text || "").toLowerCase(),
    textRaw: text || "",
    currencySymbolsDetected: [],
    url: "https://example.com/test"
  };
}

describe("ScribbitRules", () => {
  test("detects non-refundable / final sale language", () => {
    const text =
      "This booking is strictly NON-REFUNDABLE and cannot be cancelled.";
    const snapshot = makeSnapshot(text);

    const results = ScribbitRules.evaluateAll(snapshot);

    const refundRisk = results.find(
      (r) => r && r.id === "non_refundable_or_final_sale"
    );

    expect(refundRisk).toBeDefined();
    expect(refundRisk.severity).toBe("HIGH"); // uppercase from createRiskFromCard
    expect(Array.isArray(refundRisk.evidence)).toBe(true);
    expect(refundRisk.evidence.length).toBeGreaterThan(0);
  });

  test("detects short / ultra-short refund window language", () => {
    const text =
      "You may cancel within 7 days of purchase for a full refund; after that, all sales are final.";
    const snapshot = makeSnapshot(text);

    const results = ScribbitRules.evaluateAll(snapshot);

    const timeWindowRisk = results.find(
      (r) =>
        r &&
        (r.id === "short_refund_or_return_window" ||
          r.id === "ultra_short_cancellation_window")
    );

    expect(timeWindowRisk).toBeDefined();
    expect(Array.isArray(timeWindowRisk.evidence)).toBe(true);
    expect(timeWindowRisk.evidence.length).toBeGreaterThan(0);
  });

  test("detects mandatory arbitration language", () => {
    const text =
      "Any dispute shall be resolved by binding arbitration and you waive your right to a jury trial.";
    const snapshot = makeSnapshot(text);

    const results = ScribbitRules.evaluateAll(snapshot);

    const arbRisk = results.find(
      (r) => r && r.id === "mandatory_arbitration"
    );

    expect(arbRisk).toBeDefined();
    expect(arbRisk.severity).toBe("HIGH");
    expect(Array.isArray(arbRisk.evidence)).toBe(true);
    expect(arbRisk.evidence.length).toBeGreaterThan(0);
  });
});
