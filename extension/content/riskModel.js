// content/riskModel.js
// Scribbit Risk Model v2 – Categories, Risk Cards, Scoring, Auto-Popup Logic

(function () {
  /************************************************************
   * 1. CATEGORY TYPES (4 pillars)
   ************************************************************/
  const RISK_CATEGORIES = {
    financial: "financial",
    data_privacy: "data_privacy",
    content_ip: "content_ip",
    legal_rights: "legal_rights"
  };

  /************************************************************
   * 2. RISK CARD CATALOG (all definitions)
   ************************************************************/
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

    ultra_short_refund_window: {
      id: "ultra_short_refund_window",
      category: "financial",
      title: "Ultra-Short Cancellation Window",
      defaultDescription:
        "Cancellation or refund is only allowed within a very short period (typically 24–72 hours).",
      severity: "high",
      autoPopupWorthy: true
    },

    short_refund_or_return_window: {
      id: "short_refund_or_return_window",
      category: "financial",
      title: "Short Refund / Return Window",
      defaultDescription:
        "You only have a limited time (up to about 7 days) after purchase or before arrival to cancel or return for a refund.",
      severity: "med",
      autoPopupWorthy: true
    },

    delayed_refund_processing: {
      id: "delayed_refund_processing",
      category: "financial",
      title: "Slow Refund Processing",
      defaultDescription:
        "Refunds may take a long time to be processed (for example, 30–60 days or more) after your request is approved.",
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

    trial_converts_to_paid_subscription: {
      id: "trial_converts_to_paid_subscription",
      category: "financial",
      title: "Trial Converts to Paid Subscription",
      defaultDescription:
        "A free or discounted trial will automatically convert into a paid, recurring subscription unless you cancel before the trial ends.",
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

  /************************************************************
   * 3. PAGE CONTEXT
   ************************************************************/
  function classifyPageMode(url, textLength) {
    const lower = (url || "").toLowerCase();

    const looksAuth =
      lower.includes("/login") ||
      lower.includes("/signin") ||
      lower.includes("/sign-in") ||
      lower.includes("/auth") ||
      lower.includes("/register") ||
      lower.includes("/signup");

    if (looksAuth) return "auth";

    const LOW_CONTENT_THRESHOLD = 800;
    if (textLength < LOW_CONTENT_THRESHOLD) return "low-content";

    return "content-rich";
  }

  function computeHasMeaningfulContent(pageMode, textLength) {
    if (pageMode === "content-rich") return true;

    // fallback threshold
    return textLength >= 600 && pageMode !== "auth";
  }

  /************************************************************
   * 4. SCORING
   ************************************************************/
  function severityToScore(sev) {
    switch (sev) {
      case "high":
        return 80;
      case "med":
        return 50;
      case "low":
        return 25;
    }
    return 0;
  }

  function computeCategoryScores(risks) {
    const base = {
      financial: 0,
      data_privacy: 0,
      content_ip: 0,
      legal_rights: 0
    };

    for (const r of risks) {
      const s = severityToScore(r.severity);
      if (s > base[r.category]) {
        base[r.category] = s;
      }
    }

    return base;
  }

  function computeGlobalRiskScore(categoryScores) {
    return Math.max(...Object.values(categoryScores));
  }

  /************************************************************
   * 5. AUTO POPUP LOGIC
   ************************************************************/
  const AUTO_POPUP_SCORE_THRESHOLD = 50;

  function hasAutoPopupWorthyRisk(risks) {
    return risks.some((r) => r.autoPopupWorthy);
  }

  function shouldAutoPopup(result, context) {
    const noContent =
      context.pageMode === "auth" || !result.hasMeaningfulContent;

    const significantRisk =
      result.riskScore >= AUTO_POPUP_SCORE_THRESHOLD &&
      result.risks.length > 0 &&
      hasAutoPopupWorthyRisk(result.risks);

    if (noContent) return false;
    if (!significantRisk) return false;

    return true;
  }

  /************************************************************
   * EXPORT GLOBAL
   ************************************************************/
  window.ScribbitRiskModel = {
    RISK_CARDS,
    RISK_CATEGORIES,

    classifyPageMode,
    computeHasMeaningfulContent,

    computeCategoryScores,
    computeGlobalRiskScore,

    shouldAutoPopup
  };
})();
