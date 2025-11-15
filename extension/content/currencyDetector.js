// content/currencyDetector.js
// Scribbit Fairness Scanner - Currency Detector (Stub)
//
// For now, this is a very lightweight helper that can be expanded later.
// It returns an array of detected currency markers (symbols/codes), but
// scanner.js already does basic detection. This module is here to keep
// the architecture pluggable and satisfy the manifest.

const ScribbitCurrencyDetector = (() => {
  /**
   * Detect additional currency markers in text.
   * For now, this is a no-op stub that returns an empty array,
   * but you can extend it later.
   *
   * @param {string} text
   * @returns {string[]} array of currency markers (e.g., ["USD", "$"])
   */
  function detect(text) {
    if (!text || typeof text !== "string") return [];
    // Placeholder: you can add more advanced logic here later.
    return [];
  }

  return {
    detect
  };
})();

// Expose globally in content script context
window.ScribbitCurrencyDetector = ScribbitCurrencyDetector;
