// extension/__tests__/feeParser.test.js

require("../content/feeParser.js"); // attaches window.ScribbitFeeParser

describe("ScribbitFeeParser", () => {
  test("is attached to window", () => {
    expect(window.ScribbitFeeParser).toBeDefined();
    expect(typeof window.ScribbitFeeParser.parseFees).toBe("function");
  });

  test("parseFees returns an array for normal text", () => {
    const sample = `
      Nightly rate: $100
      Cleaning fee: $40
      Service fee: $20
    `;
    const result = window.ScribbitFeeParser.parseFees(sample);
    expect(Array.isArray(result)).toBe(true);
  });

  test("parseFees returns empty array for non-string input", () => {
    expect(window.ScribbitFeeParser.parseFees(null)).toEqual([]);
    expect(window.ScribbitFeeParser.parseFees(123)).toEqual([]);
  });
});

