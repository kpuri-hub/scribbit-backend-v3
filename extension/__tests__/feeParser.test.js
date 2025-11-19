// extension/__tests__/feeParser.test.js
// Tests for ScribbitFeeParser (currently a stub)

require("../content/feeParser.js");

const ScribbitFeeParser = window.ScribbitFeeParser;

describe("ScribbitFeeParser.parseFees", () => {
  test("returns empty array for non-string or empty input", () => {
    expect(ScribbitFeeParser.parseFees("")).toEqual([]);
    expect(ScribbitFeeParser.parseFees(null)).toEqual([]);
    expect(ScribbitFeeParser.parseFees(undefined)).toEqual([]);
  });

  test("returns empty array for basic fee text (stub behavior)", () => {
    const text =
      "Room price $100 per night plus cleaning fee and service fee at checkout.";
    const fees = ScribbitFeeParser.parseFees(text);

    // Stub currently does not parse fees; just ensure it's an array and empty.
    expect(Array.isArray(fees)).toBe(true);
    expect(fees.length).toBe(0);
  });
});
