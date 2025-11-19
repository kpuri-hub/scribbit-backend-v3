const { test, expect } = require("@jest/globals");
const ScribbitRules = require("../content/rules.js");

describe("ScribbitRules", () => {
  test("detects non-refundable refund language", () => {
    const snapshot = {
      textNormalized:
        "THIS BOOKING IS STRICTLY NON-REFUNDABLE AND YOU CANNOT CANCEL.",
    };

    const result = ScribbitRules.evaluateAll(snapshot);
    const refundRisk = result.find(
      (r) => r.id === "non_refundable_or_final_sale"
    );

    expect(refundRisk).toBeDefined();
    expect(refundRisk.severity).toBe("high");
    expect(Array.isArray(refundRisk.evidence)).toBe(true);
    expect(refundRisk.evidence.length).toBeGreaterThan(0);
  });

  test("detects auto-renewing subscriptions", () => {
    const snapshot = {
      textNormalized:
        "Your subscription will renew automatically every month until you cancel.",
    };

    const result = ScribbitRules.evaluateAll(snapshot);
    const auto = result.find((r) => r.id === "auto_renewing_subscription");

    expect(auto).toBeDefined();
    expect(auto.category).toBe("financial");
    expect(auto.severity).toBe("high");
  });

  test("detects trial conversions to paid subscriptions", () => {
    const snapshot = {
      textNormalized:
        "Start your 30-day free trial today. After your trial ends, your subscription will renew automatically and you will be charged monthly unless you cancel.",
    };

    const result = ScribbitRules.evaluateAll(snapshot);
    const trial = result.find(
      (r) => r.id === "trial_converts_to_paid_subscription"
    );

    expect(trial).toBeDefined();
    expect(trial.category).toBe("financial");
    expect(trial.severity).toBe("medium");
  });
});
