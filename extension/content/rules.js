// content/rules.js
// Scribbit Fairness Scanner - Rule Definitions (Risk v2 aware)
//
// Each rule inspects a normalized page snapshot and returns either:
//   - null (no issue detected), or
//   - a DetectedRisk-like object with metadata + evidence.
//
// This file stays PURE: no DOM, no messaging, just logic.

const ScribbitRules = (() => {
  const SEVERITY_SCORE_LEGACY = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3
  };

  // Pull from risk model (if available)
  const RiskModel = window.ScribbitRiskModel || {};
  const RISK_CARDS = RiskModel.RISK_CARDS || {};

  /**
   * Helper to create a DetectedRisk object from a cardId + evidence.
   * Keeps backward-compatible fields (label, severityScore, tags).
   *
   * @param {string} cardId
   * @param {string[]} evidence
   * @param {Object} extras
   */
  function createRiskFromCard(cardId, evidence, extras) {
    const def = RISK_CARDS[cardId];
    if (!def) {
      console.warn("[Scribbit] Unknown risk card id:", cardId);
      return null;
    }

    const severityUpper =
      def.severity === "high"
        ? "HIGH"
        : def.severity === "med"
        ? "MEDIUM"
        : "LOW";

    const severityScoreLegacy = SEVERITY_SCORE_LEGACY[severityUpper] || 0;

    const base = {
      // New model fields
      id: def.id,
      category: def.category,
      title: def.title,
      description: def.defaultDescription,
      severity: def.severity, // "low" | "med" | "high"
      autoPopupWorthy: !!def.autoPopupWorthy,

      // Legacy fields used by current engine/UI
      ruleId: def.id,
      label: def.title,
      severityScore: severityScoreLegacy,
      severity: severityUpper,
      tags: [],
      evidence: Array.isArray(evidence) ? evidence : []
    };

    if (extras && typeof extras === "object") {
      Object.assign(base, extras);
    }

    return base;
  }

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
   * Rule: Refund / cancellation language.
   * Maps to:
   *  - non_refundable_or_final_sale (strong terms)
   *  - short_refund_or_return_window (weaker signals)
   */
  const REFUND_KEYWORDS_RULE = {
    id: "refund_keywords_basic",

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
        "cannot be canceled"
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

      const raw = snapshot.textRaw || "";
      const evidence = findKeywordEvidence(
        text,
        raw,
        hasStrong ? strongTerms : weakerSignals
      );

      if (hasStrong) {
        const risk = createRiskFromCard(
          "non_refundable_or_final_sale",
          evidence,
          {
            tags: ["refunds", "cancellation"]
          }
        );
        return risk;
      } else {
        const risk = createRiskFromCard(
          "short_refund_or_return_window",
          evidence,
          {
            tags: ["refunds", "cancellation"]
          }
        );
        return risk;
      }
    }
  };

  /**
   * Rule: Possible DCC / FX confusion.
   * Maps to:
   *  - dcc_or_fx_markup
   */
  const DCC_MIXED_CURRENCY_RULE = {
    id: "dcc_mixed_currency_basic",

    evaluate(snapshot) {
      const text = (snapshot.textNormalized || "").trim();
      if (!text) return null;

      const symbols = snapshot.currencySymbolsDetected || [];
      if (!Array.isArray(symbols) || symbols.length <= 1) return null;

      const distinct = Array.from(new Set(symbols.map((s) => String(s).toUpperCase())));
      if (distinct.length <= 1) return null;

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
        return null;
      }

      const raw = snapshot.textRaw || "";
      const evidenceSnippets = findKeywordEvidence(text, raw, dccPhrases);

      const evidence = [
        `Detected currency markers: ${distinct.join(", ")}`
      ];
      if (evidenceSnippets.length) {
        evidence.push(...evidenceSnippets);
      }

      const risk = createRiskFromCard("dcc_or_fx_markup", evidence, {
        tags: ["dcc", "fx", "currency"]
      });

      return risk;
    }
  };

  /**
   * Rule: Arbitration & class action waiver.
   * For now we surface a single card:
   *  - mandatory_arbitration
   * (we may later split out class_action_waiver as a separate card)
   */
  const ARBITRATION_CLAUSE_RULE = {
    id: "arbitration_clause_basic",

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

      const raw = snapshot.textRaw || "";
      const evidence = findKeywordEvidence(text, raw, keywords);

      if (!evidence.length) return null;

      const risk = createRiskFromCard("mandatory_arbitration", evidence, {
        tags: ["arbitration", "dispute_resolution"]
      });

      return risk;
    }
  };

  /**
   * Rule: Auto-renew / subscription trap.
   * Maps to:
   *  - auto_renewing_subscription
   */
  const AUTO_RENEWAL_RULE = {
    id: "auto_renewal_basic",

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

      const raw = snapshot.textRaw || "";
      const evidence = findKeywordEvidence(text, raw, keywords);

      if (!evidence.length) return null;

      const risk = createRiskFromCard("auto_renewing_subscription", evidence, {
        tags: ["subscription", "auto_renew"]
      });

      return risk;
    }
  };

  /**
   * Rule: Unilateral changes to terms.
   * Maps to:
   *  - unilateral_terms_changes
   */
  const UNILATERAL_CHANGES_RULE = {
    id: "unilateral_changes_basic",

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

      const raw = snapshot.textRaw || "";
      const evidence = findKeywordEvidence(text, raw, keywords);

      if (!evidence.length) return null;

      const risk = createRiskFromCard("unilateral_terms_changes", evidence, {
        tags: ["unilateral_changes", "terms_updates"]
      });

      return risk;
    }
  };

  /**
   * Rule: Price anchoring / possibly misleading discounts.
   * Maps to:
   *  - price_anchoring_or_reference_prices
   */
  const PRICE_ANCHORING_RULE = {
    id: "price_anchoring_basic",

    evaluate(snapshot) {
      const raw = snapshot.textRaw || "";
      if (!raw) return null;

      const lower = raw.toLowerCase();

      const patterns = [
        "was $",
        "was&nbsp;$",
        "regular price $",
        "list price $",
        "you save $",
        "% off"
      ];

      const hasHit = patterns.some((kw) => lower.includes(kw));
      if (!hasHit) return null;

      const evidence = findKeywordEvidence(lower, raw, patterns);
      if (!evidence.length) return null;

      const risk = createRiskFromCard(
        "price_anchoring_or_reference_prices",
        evidence,
        {
          tags: ["pricing", "anchoring", "discounts"]
        }
      );

      return risk;
    }
  };

  /**
   * Rule: Hidden fees (expanded, Airbnb-aware).
   * Maps primarily to:
   *  - extra_fees_not_in_base_price
   * and escalates to:
   *  - resort_or_facility_fee
   * when resort/facility/amenity-style words are found.
   */
  const HIDDEN_FEES_RULE = {
    id: "hidden_fees_basic",

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      const feesFromDom = (snapshot.airbnbFees || []).join(" ").toLowerCase();

      if (!text && !feesFromDom) return null;

      const keywords = [
        "service fee",
        "booking fee",
        "processing fee",
        "handling fee",
        "convenience fee",
        "cleaning fee",
        "administration fee",
        "admin fee",
        "resort fee",
        "resort fees",
        "property fee",
        "property fees",
        "facility fee",
        "facility fees",
        "amenity fee",
        "amenity fees",
        "tourism fee",
        "tourist fee",
        "occupancy fee",
        "destination fee",
        "local fee",
        "local fees",
        "extra charges",
        "extra charge",
        "extra fees",
        "additional charges",
        "additional charge",
        "mandatory fee",
        "mandatory fees",
        "fees not included",
        "before taxes and fees",
        "collected at property",
        "paid at property",
        "charged by the property"
      ];

      const textHit = keywords.some((kw) => text.includes(kw));
      const airbnbHit = feesFromDom
        ? /(resort|property|facility|amenity|tourism|occupancy|extra fee|local fee|additional charge|additional fee)/.test(
            feesFromDom
          )
        : false;

      if (!textHit && !airbnbHit) return null;

      const evidence = [];

      if (textHit) {
        const fromText = findKeywordEvidence(
          text,
          snapshot.textRaw || "",
          keywords
        );
        evidence.push(...fromText);
      }

      if (airbnbHit && Array.isArray(snapshot.airbnbFees)) {
        evidence.push(...snapshot.airbnbFees.slice(0, 3));
      }

      if (!evidence.length) return null;

      // If resort/facility-like wording is present, use the resort-specific card.
      let cardId = "extra_fees_not_in_base_price";
      if (airbnbHit || text.includes("resort fee") || text.includes("facility fee")) {
        cardId = "resort_or_facility_fee";
      }

      const risk = createRiskFromCard(cardId, evidence, {
        tags: ["fees", "pricing"]
      });

      return risk;
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
    SEVERITY_SCORE: SEVERITY_SCORE_LEGACY
  };
})();

// Expose globally in content script context
window.ScribbitRules = ScribbitRules;
