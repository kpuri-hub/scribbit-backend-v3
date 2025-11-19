// extension/__tests__/rules.test.js

// Set up a minimal RiskModel so createRiskFromCard can resolve card metadata.
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

// jsdom gives us `window`, we just attach to it.
window.ScribbitRiskModel = {
  RISK_CARDS: {
    non_refundable_or_final_sale: makeTestCard(
      "non_refundable_or_final_sale",
      "financial",
      "HIGH"
    ),
    ultra_short_refund_window: makeTestCard(
      "ultra_short_refund_window",
      "financial",
      "HIGH"
    ),
    short_refund_or_return_window: makeTestCard(
      "short_refund_or_return_window",
      "financial",
      "MED"
    ),
    delayed_refund_processing: makeTestCard(
      "delayed_refund_processing",
      "financial",
      "MED"
    ),
    trial_converts_to_paid_subscription: makeTestCard(
      "trial_converts_to_paid_subscription",
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

    expect(refundRisk.severity.toLowerCase()).toBe("high");

    expect(Array.isArray(refundRisk.evidence)).toBe(true);
    expect(refundRisk.evidence.length).toBeGreaterThan(0);
  });

  test("returns no risks for harmless marketing copy", () => {
    const snapshot = {
      textNormalized:
        "welcome to our homepage. explore destinations, browse photos, and learn more about our services.",
      textRaw:
        "Welcome to our homepage! Explore destinations, browse photos, and learn more about our services.",
      url: "https://example.com/home",
    };

    const risks = window.ScribbitRules.evaluateAll(snapshot);

    expect(Array.isArray(risks)).toBe(true);
    expect(risks.length).toBe(0);
  });

  test("detects DCC / FX markup language when mixed currencies and DCC text appear", () => {
    const snapshot = {
      textNormalized:
        "you can pay in your card currency or local currency. dynamic currency conversion will apply and a currency conversion fee may be charged.",
      textRaw:
        "You can pay in your card currency or local currency. Dynamic Currency Conversion will apply and a currency conversion fee may be charged.",
      url: "https://example.com/checkout",
      currencySymbolsDetected: ["USD", "EUR"],
    };

    const risks = window.ScribbitRules.evaluateAll(snapshot);

    const dccRisk = risks.find((r) => r.id === "dcc_or_fx_markup");
    expect(dccRisk).toBeDefined();
    expect(Array.isArray(dccRisk.evidence)).toBe(true);
    expect(dccRisk.evidence.length).toBeGreaterThan(0);
  });

  test("detects arbitration / class action waiver language", () => {
    const snapshot = {
      textNormalized:
        "any dispute shall be resolved by binding arbitration and you waive your right to participate in a class action.",
      textRaw:
        "Any dispute shall be resolved by binding arbitration and you waive your right to participate in a class action.",
      url: "https://example.com/terms",
    };

    const risks = window.ScribbitRules.evaluateAll(snapshot);

    const arbRisk = risks.find((r) => r.id === "mandatory_arbitration");
    expect(arbRisk).toBeDefined();
    expect(Array.isArray(arbRisk.evidence)).toBe(true);
    expect(arbRisk.evidence.length).toBeGreaterThan(0);
  });

  test("detects auto-renewing subscription wording", () => {
    const snapshot = {
      textNormalized:
        "your subscription will renew automatically and you will continue to be billed until you cancel.",
      textRaw:
        "Your subscription will renew automatically and you will continue to be billed until you cancel.",
      url: "https://example.com/subscription",
    };

    const risks = window.ScribbitRules.evaluateAll(snapshot);

    const subRisk = risks.find((r) => r.id === "auto_renewing_subscription");
    expect(subRisk).toBeDefined();
    expect(Array.isArray(subRisk.evidence)).toBe(true);
    expect(subRisk.evidence.length).toBeGreaterThan(0);
  });

  test("detects hidden / extra fees language", () => {
    const snapshot = {
      textNormalized:
        "nightly rate does not include resort fee and additional service fees which will be collected at property.",
      textRaw:
        "Nightly rate does not include a resort fee and additional service fees which will be collected at the property.",
      url: "https://example.com/hotel",
    };

    const risks = window.ScribbitRules.evaluateAll(snapshot);

    const feeRisk = risks.find(
      (r) =>
        r.id === "resort_or_facility_fee" ||
        r.id === "extra_fees_not_in_base_price"
    );
    expect(feeRisk).toBeDefined();
    expect(Array.isArray(feeRisk.evidence)).toBe(true);
    expect(feeRisk.evidence.length).toBeGreaterThan(0);
  });

  test("detects 24-hour cancellation windows as ultra_short_refund_window", () => {
    const snapshot = {
      textNormalized:
        "you may cancel your booking within 24 hours of purchase for a full refund.",
      textRaw:
        "You may cancel your booking within 24 hours of purchase for a full refund.",
      url: "https://example.com/booking-24h",
    };

    const risks = window.ScribbitRules.evaluateAll(snapshot);

    const ultraShortRisk = risks.find(
      (r) => r.id === "ultra_short_refund_window"
    );
    expect(ultraShortRisk).toBeDefined();
    expect(Array.isArray(ultraShortRisk.evidence)).toBe(true);
    expect(ultraShortRisk.evidence.length).toBeGreaterThan(0);
  });

  test("detects 7-day cancellation windows as short_refund_or_return_window", () => {
    const snapshot = {
      textNormalized:
        "you may cancel your reservation within 7 days of arrival to receive a refund.",
      textRaw:
        "You may cancel your reservation within 7 days of arrival to receive a refund.",
      url: "https://example.com/booking-7d",
    };

    const risks = window.ScribbitRules.evaluateAll(snapshot);

    const shortWindowRisk = risks.find(
      (r) => r.id === "short_refund_or_return_window"
    );
    expect(shortWindowRisk).toBeDefined();
    expect(Array.isArray(shortWindowRisk.evidence)).toBe(true);
    expect(shortWindowRisk.evidence.length).toBeGreaterThan(0);
  });

  test("flags very slow refund processing windows (e.g., 30–60 days) as a refund friction risk", () => {
    const snapshot = {
      textNormalized:
        "refunds will be processed within 30 to 60 days after your refund request is approved.",
      textRaw:
        "Refunds will be processed within 30 to 60 days after your refund request is approved.",
      url: "https://example.com/slow-refund",
    };

    const risks = window.ScribbitRules.evaluateAll(snapshot);

    const delayRisk = risks.find(
      (r) => r.id === "delayed_refund_processing"
    );
    expect(delayRisk).toBeDefined();
    expect(Array.isArray(delayRisk.evidence)).toBe(true);
    expect(delayRisk.evidence.length).toBeGreaterThan(0);
  });

  test("detects a free trial that converts to a paid, auto-renewing subscription", () => {
    const snapshot = {
      textNormalized:
        "start your 30 day free trial today. after your trial ends, your subscription will renew automatically and you will be charged monthly unless you cancel.",
      textRaw:
        "Start your 30-day free trial today. After your trial ends, your subscription will renew automatically and you will be charged monthly unless you cancel.",
      url: "https://example.com/trial",
    };

    const risks = window.ScribbitRules.evaluateAll(snapshot);

    const trialRisk = risks.find(
      (r) => r.id === "trial_converts_to_paid_subscription"
    );
    expect(trialRisk).toBeDefined();
    expect(Array.isArray(trialRisk.evidence)).toBe(true);
    expect(trialRisk.evidence.length).toBeGreaterThan(0);
  });
});
