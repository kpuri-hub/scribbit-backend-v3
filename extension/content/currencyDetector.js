// content/currencyDetector.js
// Scribbit Fairness Scanner - Currency Detector
//
// Lightweight but smarter helper to detect currency markers from text.
// Scanner.js already performs basic detection (symbols + common 3-letter codes).
// This module enhances detection to reduce false positives (e.g., Booking.com)
// and strengthen real FX / DCC detection.
//
// It MUST remain safe and passive: if detection fails,
// scanner.js still works using its own built-in detection.

const ScribbitCurrencyDetector = (() => {
  /**
   * Stronger currency code list.
   * Avoids false positives by only matching known ISO codes.
   */
  const ISO_CODES = [
    "USD", "CAD", "EUR", "GBP", "AUD", "NZD",
    "JPY", "CNY", "INR", "CHF", "SEK", "NOK",
    "DKK", "ZAR", "HKD", "SGD", "KRW", "MXN"
  ];

  /**
   * Currency symbols that ALWAYS represent real money amounts.
   * (e.g., "$" could be decorative, but "¥" is generally monetary.)
   */
  const STRONG_SYMBOLS = [
    "¥", "₪", "₹", "₩", "₱", "₽", "₴"
  ];

  /**
   * Detect actual currency AMOUNTS instead of just symbols or codes.
   * This avoids "multiple currencies detected" false positives
   * where a site merely *shows icons or selectors*.
   *
   * E.g. "Prices shown in USD $129" → real
   * E.g. "Select currency: USD | CAD | EUR" → not real
   */
  function findAmountPatterns(text) {
    const results = new Set();

    // Example matches:
    //   $129
    //   USD 32.50
    //   € 89
    //   45 GBP
    //
    const amountRegexes = [
      /\b(USD|CAD|EUR|GBP|AUD|NZD)\s?\d{1,6}([.,]\d{1,2})?\b/gi,
      /\b\d{1,6}([.,]\d{1,2})?\s?(USD|CAD|EUR|GBP|AUD|NZD)\b/gi,
      /[$€£]\s?\d{1,6}([.,]\d{1,2})?/g
    ];

    for (const rx of amountRegexes) {
      const matches = text.match(rx);
      if (matches) {
        matches.forEach((m) => results.add(m.trim()));
      }
    }

    return Array.from(results);
  }

  /**
   * Main detection function.
   */
  function detect(text) {
    if (!text || typeof text !== "string") return [];

    const found = new Set();
    const upper = text.toUpperCase();

    // 1. Add strong symbols (very unlikely to appear decoratively)
    STRONG_SYMBOLS.forEach((sym) => {
      if (text.includes(sym)) found.add(sym);
    });

    // 2. Detect ISO 4217 codes ONLY if they appear in realistic phrasing.
    // Example: "Total charged in USD" → valid.
    ISO_CODES.forEach((code) => {
      const needle = code;
      const idx = upper.indexOf(needle);
      if (idx === -1) return;

      // Check for context around the code to ensure it's meaningful.
      const context = upper.slice(Math.max(0, idx - 20), idx + 20);
      const contextualWords = ["CHARGE", "PAY", "PRICE", "TOTAL", "FEE", "$", "€", "£"];

      if (contextualWords.some((w) => context.includes(w))) {
        found.add(code);
      }
    });

    // 3. Detect actual amounts (most reliable indicator)
    const amounts = findAmountPatterns(text);
    amounts.forEach((a) => found.add(a));

    return Array.from(found);
  }

  return {
    detect
  };
})();

// Expose globally in content script context
window.ScribbitCurrencyDetector = ScribbitCurrencyDetector;
