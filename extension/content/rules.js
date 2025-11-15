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
      const needle = keyword.toLowerCase();
      let index = lowerRaw.indexOf(needle);
      while (index !== -1 && snippets.length < maxSnippets) {
        const start = Math.max(0, index - 60);
        const end = Math.min(rawText.length, index + needle.length + 60);
        const snippet = rawText.slice(start, end).trim();
        snippets.push(snippet);
        index = lowerRaw.indexOf(needle, index + needle.length);
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
   *
   * IMPORTANT: To avoid false positives (like Booking.com showing a currency picker),
   * this rule now requires BOTH:
   *  - multiple currencies detected, AND
   *  - language that looks like DCC / currency conversion behavior.
   */
  const DCC_MIXED_CURRENCY_RULE = {
    id: "dcc_mixed_currency_basic",
    label: "Possible DCC / FX confusion",
    description: "Multiple currencies plus language about conversion or card currency.",
    severity: "MEDIUM",
    tags: ["dcc", "fx", "currency"],

    evaluate(snapshot) {
      const text = (snapshot.textNormalized || "").trim();
      if (!text) return null;

      const symbols = snapshot.currencySymbolsDetected || [];
      if (!Array.isArray(symbols) || symbols.length <= 1) return null;

      const distinct = Array.from(new Set(symbols.map((s) => String(s).toUpperCase())));
      if (distinct.length <= 1) return null;

      // DCC-ish phrases we expect to see when there's a real conversion choice
      const dccPhrases = [
        "dynamic currency conversion",
        "dcc",
        "pay in your currency",
        "pay in card currency",
        "pay in your card currency",
        "you will be charged in",
        "will be charged in",
        "charged in your currency",
        "currency conversion fee",
        "currency conversion",
        "conversion fee",
        "conversion rate",
        "exchange rate applies",
        "exchange rate will be",
        "we convert",
        "we may convert",
        "local currency",
        "card currency",
        "foreign transaction fee",
        "fx fee"
      ];

      const hasDccLanguage = dccPhrases.some((p) => text.includes(p));
      if (!hasDccLanguage) {
        // Multiple currencies but no DCC/conversion language:
        // Likely just a currency selector (e.g. Booking.com homepage) → no risk.
        return null;
      }

      const evidenceSnippets = findKeywordEvidence(
        text,
        snapshot.textRaw || "",
        dccPhrases
      );

      const evidence = [
        `Detected currency markers: ${distinct.join(", ")}`
      ];

      if (evidenceSnippets.length) {
        evidence.push(...evidenceSnippets);
      }

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

  /**
   * Rule 3: Arbitration & class action waiver.
   * Detects binding arbitration, waiver of right to sue / class action.
   */
  const ARBITRATION_CLAUSE_RULE = {
    id: "arbitration_clause_basic",
    label: "Binding arbitration and class action waiver",
    description:
      "Detects language that may require disputes to be resolved via arbitration and limit your right to sue or join a class action.",
    severity: "HIGH",
    tags: ["arbitration", "dispute_resolution"],

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

      const keywords = [
        "binding arbitration",
        "mandatory arbitration",
        "arbitrate",
        "arbitration administered by",
        "american arbitration association",
        "aaa arbitration",
        "jams arbitration",
        "class action waiver",
        "waive your right to sue",
        "waive your right to a jury trial",
        "waive the right to participate in a class action",
        "waiver of class or representative actions",
        "disputes will be resolved by arbitration",
        "any dispute shall be resolved by arbitration",
        "you agree to submit to arbitration"
      ];

      const hasHit = keywords.some((kw) => text.includes(kw));
      if (!hasHit) return null;

      const evidence = findKeywordEvidence(
        text,
        snapshot.textRaw || "",
        keywords
      );

      if (!evidence.length) return null;

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

  /**
   * Rule 4: Auto-renew / subscription trap.
   * Detects recurring billing and "until you cancel" style terms.
   */
  const AUTO_RENEWAL_RULE = {
    id: "auto_renewal_basic",
    label: "Automatic renewal and recurring charges",
    description:
      "Detects subscription terms that renew automatically and may continue charging you until you cancel.",
    severity: "MEDIUM",
    tags: ["subscription", "auto_renew"],

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

      const keywords = [
        "auto-renew",
        "autorenew",
        "auto renew",
        "automatically renews",
        "automatic renewal",
        "recurring fee",
        "recurring charge",
        "recurring payment",
        "continuous subscription",
        "until you cancel",
        "continue to be billed",
        "charged on a recurring basis",
        "subscription will renew automatically"
      ];

      const hasHit = keywords.some((kw) => text.includes(kw));
      if (!hasHit) return null;

      const evidence = findKeywordEvidence(
        text,
        snapshot.textRaw || "",
        keywords
      );

      if (!evidence.length) return null;

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

  /**
   * Rule 5: Unilateral changes to terms.
   * Company reserves the right to modify terms without meaningful notice.
   */
  const UNILATERAL_CHANGES_RULE = {
    id: "unilateral_changes_basic",
    label: "Company can change terms unilaterally",
    description:
      "Detects language that lets the company change terms at any time, which may reduce your protections over time.",
    severity: "MEDIUM",
    tags: ["unilateral_changes", "terms_updates"],

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

      const keywords = [
        "we may change these terms at any time",
        "we may modify these terms at any time",
        "we reserve the right to modify or update these terms",
        "we may update this agreement from time to time",
        "we may amend these terms without prior notice",
        "changes will be effective when posted",
        "we may change this policy at any time"
      ];

      const hasHit = keywords.some((kw) => text.includes(kw));
      if (!hasHit) return null;

      const evidence = findKeywordEvidence(
        text,
        snapshot.textRaw || "",
        keywords
      );

      if (!evidence.length) return null;

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

  /**
   * Rule 6: Price anchoring / possibly misleading discounts.
   * Detects "Was $X, Now $Y", "List price", "% off" style anchors.
   */
  const PRICE_ANCHORING_RULE = {
    id: "price_anchoring_basic",
    label: "Potentially misleading discount framing",
    description:
      "Detects 'Was $X, Now $Y' or similar discount language which may exaggerate the true savings.",
    severity: "MEDIUM",
    tags: ["pricing", "anchoring", "discounts"],

    evaluate(snapshot) {
      const raw = snapshot.textRaw || "";
      if (!raw) return null;

      const patterns = [
        "was $",
        "was&nbsp;$",
        "regular price $",
        "list price $",
        "you save $",
        "% off"
      ];

      const lower = raw.toLowerCase();
      const hasHit = patterns.some((kw) => lower.includes(kw));
      if (!hasHit) return null;

      const evidence = findKeywordEvidence(
        lower,
        raw,
        patterns
      );

      if (!evidence.length) return null;

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

  /**
   * Rule 7: Hidden fees (basic).
   * Detects mention of service/booking/processing/cleaning/resort/etc. fees.
   */
  const HIDDEN_FEES_RULE = {
    id: "hidden_fees_basic",
    label: "Possible extra fees",
    description:
      "Detects mentions of additional service, booking, or other fees that may not be obvious upfront.",
    severity: "MEDIUM",
    tags: ["fees", "pricing"],

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

      const keywords = [
        "service fee",
        "booking fee",
        "processing fee",
        "handling fee",
        "convenience fee",
        "resort fee",
        "cleaning fee",
        "administration fee",
        "admin fee"
      ];

      const hasHit = keywords.some((kw) => text.includes(kw));
      if (!hasHit) return null;

      const evidence = findKeywordEvidence(
        text,
        snapshot.textRaw || "",
        keywords
      );

      if (!evidence.length) return null;

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

  const ALL_RULES = [
    REFUND_KEYWORDS_RULE,
    DCC_MIXED_CURRENCY_RULE,
    ARBITRATION_CLAUSE_RULE,
    AUTO_RENEWAL_RULE,
    UNILATERAL_CHANGES_RULE,
    PRICE_ANCHORING_RULE,
    HIDDEN_FEES_RULE
  ];

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
