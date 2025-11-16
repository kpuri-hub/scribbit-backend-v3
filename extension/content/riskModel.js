// content/riskModel.js
// Scribbit Risk v2 - Data model, catalog, and scoring helpers
//
// Plain JS version (no TypeScript), exposed as window.ScribbitRiskModel.

(function () {
  /**
   * Risk categories (user-facing groups).
   *
   * financial      - money, fees, refunds, FX
   * data_privacy   - personal data, tracking, retention
   * content_ip     - images, uploads, IP & reuse
   * legal_rights   - arbitration, waivers, liability, account control
   */

  /** @typedef {"financial" | "data_privacy" | "content_ip" | "legal_rights"} RiskCategoryId */
  /** @typedef {"low" | "med" | "high"} Severity */

  /**
   * @typedef {Object} RiskCardDefinition
   * @property {string} id
   * @property {RiskCategoryId} category
   * @property {string} title
   * @property {string} defaultDescription
   * @property {Severity} severity
   * @property {boolean} autoPopupWorthy
   */

  /** @type {Record<string, RiskCardDefinition>} */
  const RISK_CARDS = {
    // ======================
    // A. Financial Exposure
    // ======================

    extra_fees_not_in_base_price: {
      id: "extra_fees_not_in_base_price",
      category: "financial",
      title: "Extra Fees Not in Base Price",
      defaultDescription:
        "The advertised price may not include mandatory fees such as cleaning, service, booking, or facility fees.",
      severity: "med",
      autoPopupWorthy: true
    },

    resort_or_facility_fee: {
      id: "resort_or_facility_fee",
      category: "financial",
      title: "Daily Resort / Facility Fee",
      defaultDescription:
        "A daily resort, amenity, or facility fee may be charged on top of the advertised price.",
      severity: "high",
      autoPopupWorthy: true
    },

    taxes_not_included: {
      id: "taxes_not_included",
      category: "financial",
      title: "Taxes Not Included in Price",
      defaultDescription:
        "Taxes such as VAT, sales tax, or occupancy tax may not be included in the displayed price.",
      severity: "med",
      autoPopupWorthy: false
    },

    short_refund_or_return_window: {
      id: "short_refund_or_return_window",
      category: "financial",
      title: "Short Refund / Return Window",
      defaultDescription:
        "You only have a limited time after purchase or delivery to cancel or return for a refund.",
      severity: "med",
      autoPopupWorthy: true
    },

    non_refundable_or_final_sale: {
      id: "non_refundable_or_final_sale",
      category: "financial",
      title: "Non-Refundable / Final Sale",
      defaultDescription:
        "Some or all purchases are non-refundable or final sale, with no option to get your money back.",
      severity: "high",
      autoPopupWorthy: true
    },

    buyer_pays_return_shipping: {
      id: "buyer_pays_return_shipping",
      category: "financial",
      title: "You Pay Return Shipping",
      defaultDescription:
        "You may be responsible for the cost of shipping items back if you return them.",
      severity: "med",
      autoPopupWorthy: true
    },

    partial_refund_only: {
      id: "partial_refund_only",
      category: "financial",
      title: "Only Partial Refunds",
      defaultDescription:
        "Refunds may be reduced by fees, restocking charges, or deductions for used portions.",
      severity: "med",
      autoPopupWorthy: true
    },

    auto_renewing_subscription: {
      id: "auto_renewing_subscription",
      category: "financial",
      title: "Auto-Renewing Subscription",
      defaultDescription:
        "Your subscription may renew automatically and charge you again unless you cancel in time.",
      severity: "med",
      autoPopupWorthy: true
    },

    dcc_or_fx_markup: {
      id: "dcc_or_fx_markup",
      category: "financial",
      title: "Currency Conversion Markup (DCC)",
      defaultDescription:
        "You may be charged in a non-local currency or at a marked-up exchange rate, leading to extra FX costs.",
      severity: "high",
      autoPopupWorthy: true
    },

    charged_in_different_currency: {
      id: "charged_in_different_currency",
      category: "financial",
      title: "Charged in a Different Currency",
      defaultDescription:
        "You may be billed in a different currency than expected, which can add extra fees or FX charges.",
      severity: "med",
      autoPopupWorthy: true
    },

    // A.1 – Extra card for price anchoring / reference prices
    price_anchoring_or_reference_prices: {
      id: "price_anchoring_or_reference_prices",
      category: "financial",
      title: "Possibly Misleading Discounts",
      defaultDescription:
        "The page uses 'Was $X, Now $Y' or similar reference prices that may exaggerate your true savings.",
      severity: "med",
      autoPopupWorthy: false
    },

    // ===========================
    // B. Personal Data & Privacy
    // ===========================

    extensive_data_collection: {
      id: "extensive_data_collection",
      category: "data_privacy",
      title: "Extensive Data Collection",
      defaultDescription:
        "The service collects a broad range of personal, device, or behavioral data about you.",
      severity: "med",
      autoPopupWorthy: false
    },

    sensitive_data_collection: {
      id: "sensitive_data_collection",
      category: "data_privacy",
      title: "Sensitive Data Collected",
      defaultDescription:
        "The service may collect sensitive data such as biometrics, face data, government IDs, or precise location.",
      severity: "high",
      autoPopupWorthy: true
    },

    images_used_for_analysis_or_improvement: {
      id: "images_used_for_analysis_or_improvement",
      category: "data_privacy",
      title: "Your Images May Be Analyzed or Used",
      defaultDescription:
        "Images or media you upload may be stored and used for analysis, moderation, or service improvement.",
      severity: "med",
      autoPopupWorthy: true
    },

    data_shared_with_third_parties: {
      id: "data_shared_with_third_parties",
      category: "data_privacy",
      title: "Data Shared with Third Parties",
      defaultDescription:
        "Your data may be shared with partners, advertisers, or analytics providers.",
      severity: "med",
      autoPopupWorthy: false
    },

    data_used_to_train_ai: {
      id: "data_used_to_train_ai",
      category: "data_privacy",
      title: "Your Data May Train AI Models",
      defaultDescription:
        "Your content or usage data may be used to train machine learning or AI systems.",
      severity: "high",
      autoPopupWorthy: true
    },

    precise_location_tracking: {
      id: "precise_location_tracking",
      category: "data_privacy",
      title: "Precise Location Tracking",
      defaultDescription:
        "The service may collect precise or continuous location data from your device.",
      severity: "high",
      autoPopupWorthy: true
    },

    data_retention_after_deletion: {
      id: "data_retention_after_deletion",
      category: "data_privacy",
      title: "Data Kept After Account Deletion",
      defaultDescription:
        "Your data may be retained even after you close or delete your account.",
      severity: "high",
      autoPopupWorthy: true
    },

    cross_site_or_cross_device_tracking: {
      id: "cross_site_or_cross_device_tracking",
      category: "data_privacy",
      title: "Cross-Site / Cross-Device Tracking",
      defaultDescription:
        "Your activity may be tracked across different websites, apps, or devices.",
      severity: "med",
      autoPopupWorthy: false
    },

    // ===========================
    // C. Content & Image Rights
    // ===========================

    broad_license_to_user_content: {
      id: "broad_license_to_user_content",
      category: "content_ip",
      title: "Broad License to Your Content",
      defaultDescription:
        "You grant the company a broad license to use, reproduce, or adapt your content.",
      severity: "high",
      autoPopupWorthy: true
    },

    irrevocable_or_perpetual_license: {
      id: "irrevocable_or_perpetual_license",
      category: "content_ip",
      title: "Perpetual / Irrevocable Rights to Your Content",
      defaultDescription:
        "The company may keep rights to your content indefinitely, even if you delete it.",
      severity: "high",
      autoPopupWorthy: true
    },

    content_may_be_used_in_marketing_or_publicly: {
      id: "content_may_be_used_in_marketing_or_publicly",
      category: "content_ip",
      title: "Your Content May Be Used Publicly",
      defaultDescription:
        "Your content or images may be displayed publicly or used in marketing materials.",
      severity: "high",
      autoPopupWorthy: true
    },

    uploads_may_be_public_or_searchable: {
      id: "uploads_may_be_public_or_searchable",
      category: "content_ip",
      title: "Uploads May Be Publicly Visible",
      defaultDescription:
        "Content you upload may be visible to anyone or appear in search results.",
      severity: "high",
      autoPopupWorthy: true
    },

    // ===========================
    // D. Legal Rights & Control
    // ===========================

    mandatory_arbitration: {
      id: "mandatory_arbitration",
      category: "legal_rights",
      title: "Mandatory Arbitration",
      defaultDescription:
        "Disputes must be resolved through private arbitration instead of court.",
      severity: "high",
      autoPopupWorthy: true
    },

    class_action_waiver: {
      id: "class_action_waiver",
      category: "legal_rights",
      title: "No Class Actions",
      defaultDescription:
        "You may waive the right to participate in class-action lawsuits.",
      severity: "high",
      autoPopupWorthy: true
    },

    unilateral_terms_changes: {
      id: "unilateral_terms_changes",
      category: "legal_rights",
      title: "Terms Can Change Unilaterally",
      defaultDescription:
        "The company can change terms at any time, and continued use counts as acceptance.",
      severity: "med",
      autoPopupWorthy: false
    },

    strong_liability_limitations: {
      id: "strong_liability_limitations",
      category: "legal_rights",
      title: "Strong Liability Limitations",
      defaultDescription:
        "The company heavily limits its responsibility for losses or damages.",
      severity: "med",
      autoPopupWorthy: true
    },

    account_termination_at_discretion: {
      id: "account_termination_at_discretion",
      category: "legal_rights",
      title: "Account Can Be Terminated at Company’s Discretion",
      defaultDescription:
        "Your account can be suspended or terminated at any time, sometimes without clear reason.",
      severity: "med",
      autoPopupWorthy: false
    },

    loss_of_content_or_balance_on_termination: {
      id: "loss_of_content_or_balance_on_termination",
      category: "legal_rights",
      title: "Loss of Content or Balance on Termination",
      defaultDescription:
        "If your account is closed, you may lose access to purchased content, credits, or balances.",
      severity: "high",
      autoPopupWorthy: true
    },

    weak_security_commitments: {
      id: "weak_security_commitments",
      category: "legal_rights",
      title: "Limited Security Commitments",
      defaultDescription:
        "The company does not strongly guarantee the security of your data.",
      severity: "med",
      autoPopupWorthy: false
    },

    no_liability_for_data_breach: {
      id: "no_liability_for_data_breach",
      category: "legal_rights",
      title: "Limited Responsibility for Data Breaches",
      defaultDescription:
        "The company may disclaim responsibility for unauthorized access or data breaches.",
      severity: "high",
      autoPopupWorthy: true
    }
  };

  /** @typedef {"auth" | "low-content" | "content-rich"} PageMode */

  /**
   * @typedef {Object} PageContext
   * @property {string} url
   * @property {PageMode} pageMode
   * @property {number} textLength
   */

  /** Classify page mode from URL + text length. */
  function classifyPageMode(url, textLength) {
    const lowerUrl = (url || "").toLowerCase();

    const looksAuth =
      lowerUrl.includes("/login") ||
      lowerUrl.includes("/signin") ||
      lowerUrl.includes("/sign-in") ||
      lowerUrl.includes("/auth") ||
      lowerUrl.includes("/register") ||
      lowerUrl.includes("/signup");

    if (looksAuth) return "auth";

    const LOW_CONTENT_THRESHOLD = 800; // characters, tunable

    if (textLength < LOW_CONTENT_THRESHOLD) return "low-content";

    return "content-rich";
  }

  /** Whether the page has “meaningful” content to analyze. */
  function computeHasMeaningfulContent(pageMode, textLength) {
    if (pageMode === "content-rich") return true;

    const MIN_MEANINGFUL_TEXT = 600; // tunable
    if (pageMode === "auth") return false;

    return textLength >= MIN_MEANINGFUL_TEXT;
  }

  /** Map severity label to numeric score (0–100). */
  function severityToScore(sev) {
    switch (sev) {
      case "high":
        return 80;
      case "med":
        return 50;
      case "low":
        return 25;
      default:
        return 0;
    }
  }

  /** Compute per-category scores (0–100) from detected risks. */
  function computeCategoryScores(risks) {
    const base = {
      financial: 0,
      data_privacy: 0,
      content_ip: 0,
      legal_rights: 0
    };

    if (!Array.isArray(risks)) return base;

    for (const r of risks) {
      if (!r || !r.category || !r.severity) continue;
      const s = severityToScore(r.severity);
      if (s > base[r.category]) {
        base[r.category] = s;
      }
    }
    return base;
  }

  /** Global = max of category scores. */
  function computeGlobalRiskScore(categoryScores) {
    const values = Object.values(categoryScores || {});
    if (!values.length) return 0;
    return Math.max.apply(null, values);
  }

  const AUTO_POPUP_SCORE_THRESHOLD = 50; // “medium” and up

  function hasAutoPopupWorthyRisk(risks) {
    return Array.isArray(risks) && risks.some((r) => r && r.autoPopupWorthy);
  }

  /**
   * Decide whether to auto-pop panel for this page.
   *
   * @param {Object} analysisResult
   * @param {Array} analysisResult.risks
   * @param {number} analysisResult.riskScore
   * @param {boolean} analysisResult.hasMeaningfulContent
   * @param {PageContext} context
   */
  function shouldAutoPopup(analysisResult, context) {
    const isAuthOrLowContent =
      context.pageMode === "auth" || !analysisResult.hasMeaningfulContent;

    const hasRealRisk =
      (analysisResult.riskScore || 0) >= AUTO_POPUP_SCORE_THRESHOLD &&
      Array.isArray(analysisResult.risks) &&
      analysisResult.risks.length > 0 &&
      hasAutoPopupWorthyRisk(analysisResult.risks);

    if (isAuthOrLowContent) return false;
    if (!hasRealRisk) return false;

    return true;
  }

  const ScribbitRiskModel = {
    RISK_CARDS,
    classifyPageMode,
    computeHasMeaningfulContent,
    severityToScore,
    computeCategoryScores,
    computeGlobalRiskScore,
    shouldAutoPopup
  };

  window.ScribbitRiskModel = ScribbitRiskModel;
})();
