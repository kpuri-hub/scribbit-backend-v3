// extension/__tests__/currencyDetector.test.js

require("../content/currencyDetector.js"); // attaches window.ScribbitCurrencyDetector

describe("ScribbitCurrencyDetector.detect", () => {
  test("handles empty or non-string input gracefully", () => {
    expect(window.ScribbitCurrencyDetector.detect("")).toEqual([]);
    expect(window.ScribbitCurrencyDetector.detect(null)).toEqual([]);
    expect(window.ScribbitCurrencyDetector.detect(123)).toEqual([]);
  });

  test("detects real currency amounts and codes with context", () => {
    const sample = "Total charged in USD $129 for your booking.";
    const result = window.ScribbitCurrencyDetector.detect(sample);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain("USD");
    // Should also pick up something like "$129"
    const hasAmount = result.some((x) => /\$\s?129/.test(x));
    expect(hasAmount).toBe(true);
  });

  test("does NOT flag bare currency selector text as real currencies", () => {
    const sample = "Select currency: USD | CAD | EUR";
    const result = window.ScribbitCurrencyDetector.detect(sample);

    // No context words like CHARGE, PRICE, TOTAL, FEE, etc.
    expect(result).toEqual([]);
  });
});

