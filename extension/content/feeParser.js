// content/feeParser.js
// Scribbit Fairness Scanner - Fee Parser (Stub)
//
// This module is reserved for Airbnb/Booking.com fee extraction,
// but for now it's a stub to keep the architecture intact.

const ScribbitFeeParser = (() => {
  /**
   * Parse fees from a raw text or structured snippet.
   * Currently returns an empty list; extend later.
   *
   * @param {string} text
   * @returns {Array<{ label: string, amount: string | number }>}
   */
  function parseFees(text) {
    if (!text || typeof text !== "string") return [];
    // Future: extract "cleaning fee", "service fee", etc.
    return [];
  }

  return {
    parseFees
  };
})();

// Expose globally in content script context
window.ScribbitFeeParser = ScribbitFeeParser;
