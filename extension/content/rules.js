// content/rules.js
// Scribbit Fairness Scanner - Rule Definitions
//
// Each rule inspects a normalized page snapshot and returns either:
//   - null (no issue detected), or
//   - a risk object with metadata + evidence
//
// This file stays PURE: no DOM, no messaging, just logic.

const ScribbitRules = (() => {
  // Map severity labels to numeric weight for scoring
  const SEVERITY_SCORE = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3
  };

  /**
   * Helper to find keyword matches and return small evidence snippets.
   */
  function findKeywordEvidence(textNormalized, rawText, keywords, maxSnippets = 3) {
    const snippets = [];
    const lowerRaw = rawText.toLowerCase();

    for (const keyword of keywords) {
      let index = lowerRaw.indexOf(keyword.toLowerCase());
      while (index !== -1 && snippets.length < maxSnippets) {
        const start = Math.max(0, index - 60);
        const end = Math.min(rawText.length, index + keyword.length + 60);
        const snippet = rawText.slice(start, end).trim();
        snippets.push(snippet);
        index = lowerRaw.indexOf(keyword.toLowerCase(), index + keyword.length);
      }
      if (snippets.length >= maxSnippets) break;
    }

    return snippets;
  }

  /**
   * Rule 1: Refund / cancellation language may be restrictive or unclear.
   */
  const REFUND_KEYWORDS_RULE = {
    id: "refund_keywords_basic",
    label: "Refund and cancellation terms may be restrictive or unclear",
    description: "Detects mentions of non-refundable or strict cancellation windows.",
    severity: "MEDIUM",
    tags: ["refunds", "cancellation"],

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

      const strongTerms = [
        "non-refundable",
        "nonrefundable",
        "no refund",
        "no refunds",
        "no cancellations",
        "cannot be cancelled",
        "cannot be canceled" // US spelling
      ];

      const weakerSignals = [
        "cancellation fee",
        "cancellation policy",
        "refund policy",
        "change fee",
        "amendment fee"
      ];

      const hasStrong = strongTerms.some((kw) => text.includes(kw));
      const hasWeak = weakerSignals.some((kw) => text.includes(kw));

      if (!hasStrong && !hasWeak) return null;

      const evidence = findKeywordEvidence(
        text,
        snapshot.textRaw || "",
        hasStrong ? strongTerms : weakerSignals
      );

      // Slightly higher severity if strong "non-refundable" style terms are present
      const severity = hasStrong ? "HIGH" : "MEDIUM";

      return {
        ruleId: this.id,
        label: this.label,
        description: this.description,
        severity,
        severityScore: SEVERITY_SCORE[severity],
        tags: this.tags,
        evidence
      };
    }
  };

  /**
   * Rule 2: Possible DCC / FX confusion (local vs foreign currencies).
   * This is intentionally simple for now, based on currency symbol mix.
   */
  const DCC_MIXED_CURRENCY_RULE = {
    id: "dcc_mixed_currency_basic",
    label: "Multiple currencies detected - possible DCC / FX confusion",
    description: "Detects when page text includes more than one currency symbol or code.",
    severity: "MEDIUM",
    tags: ["dcc", "fx", "currency"],

    evaluate(snapshot) {
      const symbols = snapshot.currencySymbolsDetected || [];
      if (!Array.isArray(symbols) || symbols.length <= 1) return null;

      const distinct = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
      if (distinct.length <= 1) return null;

      const evidence = [
        `Detected currency markers: ${distinct.join(", ")}`
      ];

      return {
        ruleId: this.id,
        label: this.label,
        description: this.description,
        severity: this.severity,
        severityScore: SEVERITY_SCORE[this.severity],
        tags: this.tags,
        evidence
      };
    }
  };

  const ALL_RULES = [REFUND_KEYWORDS_RULE, DCC_MIXED_CURRENCY_RULE];

  /**
   * Run all rules against a snapshot and return an array of risk objects.
   */
  function evaluateAll(snapshot) {
    const risks = [];
    for (const rule of ALL_RULES) {
      try {
        const result = rule.evaluate(snapshot);
        if (result) {
          risks.push(result);
        }
      } catch (err) {
        console.error("[Scribbit] Rule evaluation error:", rule.id, err);
      }
    }
    return risks;
  }

  return {
    ALL_RULES,
    evaluateAll,
    SEVERITY_SCORE
  };
})();

// Expose globally in content script context
window.ScribbitRules = ScribbitRules;
