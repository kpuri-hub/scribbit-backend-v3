// extension/__tests__/currencyDetector.test.js
// Basic tests for ScribbitCurrencyDetector.detect

require("../content/currencyDetector.js");

const ScribbitCurrencyDetector = window.ScribbitCurrencyDetector;

describe("ScribbitCurrencyDetector.detect", () => {
  test("returns empty array for non-string or empty input", () => {
    expect(ScribbitCurrencyDetector.detect("")).toEqual([]);
    expect(ScribbitCurrencyDetector.detect(null)).toEqual([]);
    expect(ScribbitCurrencyDetector.detect(undefined)).toEqual([]);
  });

  test("detects ISO codes in realistic phrases", () => {
    const text = "Your total will be charged in USD 129 plus applicable taxes.";
    const detected = ScribbitCurrencyDetector.detect(text);

    expect(detected).toContain("USD");
  });

  test("detects strong currency symbols", () => {
    const text = "Total price: €89 for your stay.";
    const detected = ScribbitCurrencyDetector.detect(text);

    // Depending on implementation we may see "€" or an amount pattern
    expect(detected.length).toBeGreaterThan(0);
  });

  test("detects amount patterns with codes", () => {
    const text = "You will pay CAD 45.99 in total.";
    const detected = ScribbitCurrencyDetector.detect(text);

    expect(detected.some((d) => /CAD|45\.99/.test(String(d)))).toBe(true);
  });
});
