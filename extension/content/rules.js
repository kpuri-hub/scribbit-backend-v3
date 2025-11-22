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
      // NOTE: sevLower is conceptually the normalized severity,
      // but legacy engine expects sevUpper in severity field.
      severity: sevUpper,
      autoPopupWorthy: !!def.autoPopupWorthy,

      // Legacy fields
      ruleId: def.id,
      label: def.title,
      severityScore: severityScoreLegacy,
      tags: [],
      evidence: Array.isArray(evidence) ? evidence : []
    };

    if (extras && typeof extras === "object") {
      Object.assign(base, extras);
    }

    return base;
  }

  /**
   * Clean a raw evidence snippet into a readable, single-sentence fragment.
   */
  function cleanEvidenceSnippet(snippet, maxLen = 220) {
    if (!snippet || typeof snippet !== "string") return "";

    let txt = snippet.replace(/\s+/g, " ").trim();

    // Strip obvious Scribbit artifacts if they somehow sneak in
    txt = txt.replace(/Scribbit\s+Multi-Risk\s+Test\s+Terms/gi, "");
    txt = txt.replace(/Scribbit\b/gi, "");
    txt = txt.replace(/rail risk\s*\(\s*\d+\/\d+\s*\)/gi, "");

    txt = txt.replace(/\s+/g, " ").trim();
    if (!txt) return "";

    if (txt.length > maxLen) {
      let cut = txt.slice(0, maxLen - 1);
      const lastPeriod = cut.lastIndexOf(".");
      const lastSpace = cut.lastIndexOf(" ");
      const boundary =
        lastPeriod > 80 ? lastPeriod + 1 : lastSpace > 80 ? lastSpace : cut.length;
      txt = cut.slice(0, boundary).trim() + "…";
    }

    return txt;
  }

  /**
   * Find keyword matches and return sentence-level evidence snippets.
   *
   * - Uses rawText for slicing, to preserve case / punctuation.
   * - Expands to the sentence containing the keyword (prev/next . ? ! or newline).
   */
  function findKeywordEvidence(textNormalized, rawText, keywords, maxSnippets = 3) {
    const snippets = [];
    if (!rawText || !keywords || !keywords.length) return snippets;

    const lowerRaw = rawText.toLowerCase();
    const added = new Set();

    for (const keyword of keywords) {
      const needle = keyword.toLowerCase();
      let index = lowerRaw.indexOf(needle);
      while (index !== -1 && snippets.length < maxSnippets) {
        // Find sentence boundaries around the keyword
        let start = index;
        while (start > 0) {
          const ch = lowerRaw[start - 1];
          if (ch === "." || ch === "!" || ch === "?" || ch === "\n" || ch === "\r") break;
          start--;
        }

        let end = index + needle.length;
        while (end < lowerRaw.length) {
          const ch = lowerRaw[end];
          if (ch === "." || ch === "!" || ch === "?" || ch === "\n" || ch === "\r") {
            end++; // include the punctuation
            break;
          }
          end++;
        }

        if (end <= start) {
          end = Math.min(lowerRaw.length, index + needle.length + 80);
        }

        const rawSnippet = rawText.slice(start, end);
        const cleaned = cleanEvidenceSnippet(rawSnippet);
        if (cleaned && !added.has(cleaned.toLowerCase())) {
          snippets.push(cleaned);
          added.add(cleaned.toLowerCase());
        }

        index = lowerRaw.indexOf(needle, index + needle.length);
      }
      if (snippets.length >= maxSnippets) break;
    }

    return snippets;
  }

  /**
   * Format a currency exposure line when we know bookingTotalAmount.
   */
  function buildExposureLine(totalAmount, lostPercent, symbol) {
    if (
      typeof totalAmount !== "number" ||
      !isFinite(totalAmount) ||
      totalAmount <= 0 ||
      typeof lostPercent !== "number" ||
      !isFinite(lostPercent) ||
      lostPercent <= 0
    ) {
      return null;
    }

    const currencySymbol = symbol || "$";
    const lostAmountRaw = (totalAmount * lostPercent) / 100;
    const lostAmount = Math.round(lostAmountRaw * 100) / 100;

    const formattedTotal = totalAmount.toLocaleString(undefined, {
      maximumFractionDigits: 2
    });
    const formattedExposure = lostAmount.toLocaleString(undefined, {
      maximumFractionDigits: 2
    });

    return `If your total booking is around ${currencySymbol}${formattedTotal}, losing ${lostPercent}% means roughly ${currencySymbol}${formattedExposure} at risk if you cancel after this point.`;
  }

  /************************************************************
   * Rule 1: Refund / cancellation language
   *  - non_refundable_or_final_sale
   *  - short_refund_or_return_window (keyword-based)
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
   * Rule 1b: Time-based refund / cancellation windows
   *
   * Distinguishes between:
   *  - Ultra Short: <= 72 hours  → ultra_short_refund_window (HIGH)
   *  - Short:      > 72h to 7d   → short_refund_or_return_window (MED)
   *
   * Only fires when cancellation/refund context is present.
   ************************************************************/
  const REFUND_SHORT_WINDOW_RULE = {
    id: "refund_short_window_time_based",

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

      const raw = snapshot.textRaw || "";
      const lower = text.toLowerCase();

      // Require cancellation / refund context so we don't flag random "7 days".
      const contextKeywords = ["cancel", "cancellation", "refund", "refundable"];
      const hasContext = contextKeywords.some((kw) => lower.includes(kw));
      if (!hasContext) return null;

      // Ultra-short windows: 24–72 hours
      const ultraShortPhrases = [
        "within 24 hours",
        "within 48 hours",
        "within 72 hours",
        "24 hours of purchase",
        "48 hours of purchase",
        "72 hours of purchase",
        "24 hours of booking",
        "48 hours of booking",
        "72 hours of booking"
      ];

      // Short windows: >72h up to 7 days
      const shortPhrases = [
        "within 7 days",
        "up to 7 days",
        "7 days of purchase",
        "7 days of booking",
        "7 days before arrival",
        "7 days before check-in",
        "seven days before arrival",
        "seven days before check in"
      ];

      const hasUltraShort = ultraShortPhrases.some((p) => lower.includes(p));
      const hasShort = shortPhrases.some((p) => lower.includes(p));

      if (!hasUltraShort && !hasShort) return null;

      // Decide which card to fire:
      // Ultra Short has priority if both types appear.
      let cardId;
      let phrasesForEvidence;

      if (hasUltraShort) {
        cardId = "ultra_short_refund_window";
        phrasesForEvidence = ultraShortPhrases;
      } else {
        cardId = "short_refund_or_return_window";
        phrasesForEvidence = shortPhrases;
      }

      const evidence = findKeywordEvidence(text, raw, phrasesForEvidence, 3);
      if (!evidence.length) return null;

      return createRiskFromCard(cardId, evidence, {
        tags: ["refunds", "cancellation", hasUltraShort ? "ultra_short" : "short_window"]
      });
    }
  };

  /************************************************************
   * Rule 1c: Slow refund processing (30–60 days)
   *  - delayed_refund_processing
   ************************************************************/
  const REFUND_DELAY_RULE = {
    id: "refund_delay_processing_basic",

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

      const raw = snapshot.textRaw || "";
      const lower = text.toLowerCase();

      // Require refund context (to avoid "30 days" in random contexts).
      const contextKeywords = ["refund", "refunded", "refunds", "reimbursement", "credited"];
      const hasContext = contextKeywords.some((kw) => lower.includes(kw));
      if (!hasContext) return null;

      // Phrases suggesting long refund processing times.
      const delayPhrases = [
        "within 30 days",
        "within 45 days",
        "within 60 days",
        "30 days of the refund request",
        "30 days of your refund request",
        "30 days after your request",
        "30 days after the request",
        "30 to 60 days",
        "30-60 days",
        "30 – 60 days",
        "may take 30 days",
        "may take up to 30 days",
        "may take up to 60 days",
        "processing time of 30 days",
        "processing time of 60 days",
        "4-6 weeks",
        "4 to 6 weeks",
        "four to six weeks"
      ];

      const hasDelayLanguage = delayPhrases.some((p) => lower.includes(p));
      if (!hasDelayLanguage) return null;

      const evidence = findKeywordEvidence(text, raw, delayPhrases, 3);
      if (!evidence.length) return null;

      return createRiskFromCard("delayed_refund_processing", evidence, {
        tags: ["refunds", "delay", "cashflow"]
      });
    }
  };

  /************************************************************
   * Rule 1d: Percentage-based partial refunds (e.g., "50% refund")
   *
   * Goal:
   *  - Detect sentences like "you'll receive a 50% refund"
   *  - Combine with bookingTotalAmount (if present) to show $ exposure.
   *  - Uses existing short_refund_or_return_window card (no model change).
   ************************************************************/
  const REFUND_PERCENTAGE_EXPOSURE_RULE = {
    id: "refund_percentage_exposure",

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

      const raw = snapshot.textRaw || "";
      const lower = text.toLowerCase();

      // Require cancellation/refund context globally.
      const contextKeywords = ["cancel", "cancellation", "refund", "refundable"];
      const hasContext = contextKeywords.some((kw) => lower.includes(kw));
      if (!hasContext) return null;

      const percentRegex = /(\d{1,2})\s*%/g;
      const candidates = [];

      let match;
      while ((match = percentRegex.exec(lower)) !== null) {
        const percentNum = parseInt(match[1], 10);
        if (!isFinite(percentNum) || percentNum <= 0 || percentNum >= 100) {
          continue;
        }

        const idx = match.index;
        const windowStart = Math.max(0, idx - 80);
        const windowEnd = Math.min(lower.length, idx + 80);
        const windowText = lower.slice(windowStart, windowEnd);

        // Only keep percentages that clearly relate to refunds/cancellation.
        if (!/(refund|refunded|refunds|cancel|cancellation|fee|charge)/.test(windowText)) {
          continue;
        }

        candidates.push({
          percent: percentNum,
          keyword: match[1] + "%"
        });
      }

      if (!candidates.length) return null;

      // Prefer the case with the largest loss (smallest refund %).
      let chosen = candidates[0];
      for (const c of candidates) {
        const currentLoss = 100 - c.percent;
        const bestLoss = 100 - chosen.percent;
        if (currentLoss > bestLoss) {
          chosen = c;
        }
      }

      const evidence = [];
      const snippetEvidence = findKeywordEvidence(
        text,
        raw,
        [chosen.keyword],
        2
      );
      if (snippetEvidence.length) {
        evidence.push(...snippetEvidence);
      }

      const total = snapshot.bookingTotalAmount;
      const symbol = snapshot.bookingCurrencySymbol || "$";

      if (typeof total === "number" && isFinite(total) && total > 0) {
        const lostPercent = 100 - chosen.percent;
        const exposureLine = buildExposureLine(total, lostPercent, symbol);
        if (exposureLine) {
          evidence.push(exposureLine);
        }
      }

      if (!evidence.length) return null;

      return createRiskFromCard("short_refund_or_return_window", evidence, {
        tags: ["refunds", "cancellation", "partial_refund", "percentage"]
      });
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
        "pay in your card currency",
        "pay in your currency",
        "pay in card currency",
        "you will be charged in",
        "will be charged in",
        "charged in your currency",
        "currency conversion fee",
        "currency conversion",
        "conversion fee",
        "conversion rate applies",
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
   * Rule 4b: Free trial that converts to paid, likely auto-renew
   *  - trial_converts_to_paid_subscription
   ************************************************************/
  const TRIAL_AUTO_RENEW_RULE = {
    id: "trial_auto_renew_basic",

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

      const raw = snapshot.textRaw || "";
      const lower = text.toLowerCase();

      const trialKeywords = [
        "free trial",
        "trial period",
        "trial offer",
        "start your trial",
        "sign up for your trial",
        "30-day trial",
        "14-day trial",
        "7-day trial",
        "30 day trial",
        "14 day trial",
        "7 day trial"
      ];

      const trialContext = trialKeywords.some((kw) => lower.includes(kw));
      if (!trialContext) return null;

      const postTrialKeywords = [
        "after your trial",
        "after the trial",
        "at the end of your trial",
        "at the end of the trial",
        "once the trial ends",
        "once your trial ends",
        "when your trial ends",
        "after the trial period",
        "after your trial period"
      ];

      const billingKeywords = [
        "you will be charged",
        "you will be billed",
        "we will charge",
        "we will bill",
        "your card will be charged",
        "your credit card will be charged",
        "subscription will renew automatically",
        "renews automatically",
        "will renew automatically",
        "will automatically renew",
        "recurring subscription",
        "recurring billing",
        "recurring charges",
        "charged on a recurring basis",
        "until you cancel",
        "unless you cancel"
      ];

      const hasPostTrial = postTrialKeywords.some((kw) => lower.includes(kw));
      const hasBilling = billingKeywords.some((kw) => lower.includes(kw));

      if (!hasPostTrial && !hasBilling) {
        // We only want "trial converts to paid" if there is some hint
        // that billing or recurring behaviour happens AFTER the trial.
        return null;
      }

      const evidence = findKeywordEvidence(
        text,
        raw,
        trialKeywords.concat(postTrialKeywords, billingKeywords),
        3
      );
      if (!evidence.length) return null;

      return createRiskFromCard("trial_converts_to_paid_subscription", evidence, {
        tags: ["trial", "subscription", "auto_renew"]
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
   * Rule 6: Hidden / extra fees (Airbnb/Booking-friendly)
   *  - extra_fees_not_in_base_price
   *  - resort_or_facility_fee
   *
   * NOTE: To avoid confusing users with noisy price-breakdown text
   * (e.g., Booking.com discounts mixed with taxes), we use generic,
   * human-friendly evidence sentences instead of raw slices.
   ************************************************************/
  const HIDDEN_FEES_RULE = {
    id: "hidden_fees_basic",

    evaluate(snapshot) {
      const text = snapshot.textNormalized || "";
      if (!text) return null;

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

      const lower = text.toLowerCase();

      let hasStrong = strongFeeTerms.some((kw) => lower.includes(kw));
      let hasGeneral = generalFeeTerms.some((kw) => lower.includes(kw));

      // Airbnb-specific phrases that often indicate extra line items
      if (!hasStrong && !hasGeneral && url.toLowerCase().includes("airbnb.")) {
        const airbnbPhrases = [
          "airbnb service fee",
          "occupancy taxes and fees",
          "taxes may be collected",
          "taxes and fees may apply"
        ];
        hasGeneral = airbnbPhrases.some((kw) => lower.includes(kw));
      }

      if (!hasStrong && !hasGeneral) return null;

      let cardId = "extra_fees_not_in_base_price";
      let evidence;

      if (hasStrong) {
        cardId = "resort_or_facility_fee";
        evidence = [
          "Nightly rate may not include resort or facility fees that are collected separately at the property."
        ];
      } else {
        // Generic but accurate wording for extra fees / taxes
        evidence = [
          "The displayed price may exclude taxes, cleaning fees, or other mandatory charges that are added at checkout or collected at the property."
        ];
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
    REFUND_SHORT_WINDOW_RULE,
    REFUND_DELAY_RULE,
    REFUND_PERCENTAGE_EXPOSURE_RULE,
    DCC_MIXED_CURRENCY_RULE,
    ARBITRATION_CLAUSE_RULE,
    AUTO_RENEWAL_RULE,
    TRIAL_AUTO_RENEW_RULE,
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
