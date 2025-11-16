// content/rules.js
// Scribbit Fairness Scanner - Rule Definitions (Risk v2)
//
// Each rule inspects a normalized page snapshot and returns either:
//   - null (no issue detected), or
//   - a DetectedRisk-like object with metadata + evidence.
//
// PURE logic: no direct DOM access (only uses the snapshot from scanner.js).

const ScribbitRules = (() => {
  // Legacy numeric mapping used by the existing engine badge (LOW/MEDIUM/HIGH)
  const SEVERITY_SCORE = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3
  };

  // Pull risk cards from the Risk Model
  const RiskModel = window.ScribbitRiskModel || {};
  const RISK_CARDS = RiskModel.RISK_CARDS || {};

  /************************************************************
   * Helpers
   ************************************************************/

  /**
   * Create a DetectedRisk object from a risk card definition.
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

    const sevLower = String(def.severity || "med").toLowerCase();
    const sevUpper =
      sevLower === "high"
        ? "HIGH"
        : sevLower === "low"
        ? "LOW"
        : "MEDIUM";

    const severityScoreLegacy = SEVERITY_SCORE[sevUpper] || 0;

    const base = {
      // New model fields
      id: def.id,
      category: def.category,
      title: def.title,
      description: def.defaultDescription,
      severity: sevLower, // "low" | "med" | "high"
      autoPopupWorthy: !!def.autoPopupWorthy,

      // Legacy fields
      ruleId: def.id,
      label: def.title,
      severityScore: severityScoreLegacy,
      severity: sevUpper,
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

  /************************************************************
   * Rule 1: Refund / cancellation language
   *  - non_refundable_or_final_sale
   *  - short_refund_or_return_window
   ************************************************************/
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

      if (!evidence.length) return null;

      if (hasStrong) {
        return createRiskFromCard("non_refundable_or_final_sale", evidence, {
          tags: ["refunds", "cancellation"]
        });
      } else {
        return createRiskFromCard("short_refund_or_return_window", evidence, {
          tags: ["refunds", "cancellation"]
        });
      }
    }
  };

  /************************************************************
   * Rule 2: DCC / FX confusion
   *  - dcc_or_fx_markup
   ************************************************************/
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
      if (!hasDccLanguage) return null;

      const raw = snapshot.textRaw || "";
      const evidenceSnippets = findKeywordEvidence(text, raw, dccPhrases);

      const evidence = [
        `Detected currency markers: ${distinct.join(", ")}`
      ];
      if (evidenceSnippets.length) {
        evidence.push(...evidenceSnippets);
      }

      return createRiskFromCard("dcc_or_fx_markup", evidence, {
        tags: ["dcc", "fx", "currency"]
      });
    }
  };

  /************************************************************
   * Rule 3: Arbitration / class-action waiver
   *  - mandatory_arbitration
   ************************************************************/
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

      return createRiskFromCard("mandatory_arbitration", evidence, {
        tags: ["arbitration", "dispute_resolution"]
      });
    }
  };

  /************************************************************
   * Rule 4: Auto-renewing subscriptions
   *  - auto_renewing_subscription
   ************************************************************/
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

      return createRiskFromCard("auto_renewing_subscription", evidence, {
        tags: ["subscription", "auto_renew"]
      });
    }
  };

  /************************************************************
   * Rule 5: Unilateral changes to terms
   *  - unilateral_terms_changes
   ************************************************************/
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

      return createRiskFromCard("unilateral_terms_changes", evidence, {
        tags: ["unilateral_changes", "terms_updates"]
      });
    }
  };

  /************************************************************
   * Rule 6: Hidden / extra fees (Airbnb-friendly)
   *  - extra_fees_not_in_base_price
   *  - resort_or_facility_fee (when resort-style language present)
   ************************************************************/
  const HIDDEN_FEES_RULE = {
    id: "hidden_fees_basic",

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

      const raw = snapshot.textRaw || "";
      const url = snapshot.url || "";

      // Strong resort/facility-style fees
      const strongFeeTerms = [
        "resort fee",
        "resort fees",
        "facility fee",
        "facility fees",
        "amenity fee",
        "amenity fees",
        "destination fee",
        "destination fees",
        "property fee",
        "property fees"
      ];

      // General booking/cleaning/service fees & taxes
      const generalFeeTerms = [
        "service fee",
        "service fees",
        "booking fee",
        "booking fees",
        "processing fee",
        "processing fees",
        "handling fee",
        "handling fees",
        "convenience fee",
        "convenience fees",
        "cleaning fee",
        "cleaning fees",
        "extra fees",
        "extra fee",
        "additional fees",
        "additional fee",
        "extra charges",
        "extra charge",
        "additional charges",
        "additional charge",
        "mandatory fee",
        "mandatory fees",
        "fees not included",
        "taxes and fees",
        "before taxes and fees",
        "occupancy taxes",
        "occupancy tax",
        "tourist tax",
        "tourism tax",
        "local taxes and fees",
        "collected at property",
        "paid at property",
        "charged by the property"
      ];

      let hasStrong = strongFeeTerms.some((kw) => text.includes(kw));
      let hasGeneral = generalFeeTerms.some((kw) => text.includes(kw));

      // Airbnb-specific phrases that often indicate extra line items
      if (!hasStrong && !hasGeneral && url.toLowerCase().includes("airbnb.")) {
        const airbnbPhrases = [
          "airbnb service fee",
          "occupancy taxes and fees",
          "taxes may be collected",
          "taxes and fees may apply"
        ];
        hasGeneral = airbnbPhrases.some((kw) => text.includes(kw));
      }

      if (!hasStrong && !hasGeneral) return null;

      const evidence = findKeywordEvidence(
        text,
        raw,
        strongFeeTerms.concat(generalFeeTerms)
      );

      if (!evidence.length) return null;

      let cardId = "extra_fees_not_in_base_price";
      if (hasStrong) {
        cardId = "resort_or_facility_fee";
      }

      return createRiskFromCard(cardId, evidence, {
        tags: ["fees", "pricing"]
      });
    }
  };

  /************************************************************
   * Aggregate
   ************************************************************/
  const ALL_RULES = [
    REFUND_KEYWORDS_RULE,
    DCC_MIXED_CURRENCY_RULE,
    ARBITRATION_CLAUSE_RULE,
    AUTO_RENEWAL_RULE,
    UNILATERAL_CHANGES_RULE,
    HIDDEN_FEES_RULE
  ];

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

// Expose globally
window.ScribbitRules = ScribbitRules;
