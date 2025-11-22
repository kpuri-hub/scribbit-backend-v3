// content/scanner.js
// Scribbit Fairness Scanner - Page Scanner
//
// Responsibilities:
// - Build a normalized snapshot of the page text
// - Add Airbnb-specific fee extraction
// - Decide WHEN to scan (skip search engines, blocked domains,
//   and search results pages on major travel sites)
// - Detect SPA-style URL changes (Airbnb, OTAs) and re-scan
// - If main page does not have enough meaningful content OR is a
//   high-risk checkout-like page, silently fetch linked policy/ToS/refund
//   pages, evaluate them, and MERGE risks
// - Call ScribbitRiskEngine.evaluatePage(snapshot)
// - Send a single combined riskResult via ScribbitMessaging
//
// NOTE: UI stays unchanged. The panel just receives a richer riskResult.

(function () {
  const MAX_TEXT_LENGTH = 50000;
  const SPA_URL_CHECK_INTERVAL_MS = 500;

  // Linked policy/ToS scanning
  const POLICY_MAX_LINKS = 3;
  const POLICY_FETCH_TIMEOUT_MS = 2500;

  const SEARCH_ENGINE_HOSTS = [
    "www.google.com",
    "google.com",
    "www.bing.com",
    "bing.com",
    "search.yahoo.com",
    "duckduckgo.com",
    "www.duckduckgo.com"
  ];

  // Domains where Scribbit should NEVER scan or show up.
  // These are clearly personal/productivity contexts where a panel feels creepy.
  const BLOCKED_DOMAINS = [
    // Webmail
    "mail.google.com",
    "inbox.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "mail.yahoo.com",
    "mail.aol.com",

    // Docs & storage
    "docs.google.com",
    "drive.google.com",
    "onedrive.live.com",
    "www.dropbox.com",

    // General productivity / collaboration
    "teams.microsoft.com",
    "slack.com",
    "app.slack.com",
    "notion.so",
    "www.notion.so"
  ];

  // Travel-related host groups for search results whitelisting
  const EXPEDIA_FAMILY = [
    "expedia.com",
    "expedia.ca",
    "expedia.co.uk",
    "expedia.com.au",
    "hotels.com",
    "hotwire.com",
    "orbitz.com",
    "travelocity.com",
    "ebookers.com",
    "wotif.com",
    "cheaptickets.com"
  ];

  const META_SEARCH_FAMILY = [
    "kayak.com",
    "kayak.ca",
    "kayak.co.uk",
    "skyscanner.com",
    "skyscanner.ca",
    "momondo.com",
    "momondo.ca",
    "trivago.com",
    "trivago.ca",
    "tripadvisor.com",
    "tripadvisor.ca",
    "agoda.com",
    "agoda.ca"
  ];

  const HOTEL_BRANDS = [
    "marriott.com",
    "hilton.com",
    "ihg.com",
    "hyatt.com",
    "accor.com",
    "choicehotels.com",
    "bestwestern.com",
    "wyndhamhotels.com",
    "radissonhotels.com",
    "shangri-la.com",
    "fourseasons.com",
    "ryanairrooms.com"
  ];

  const AIRLINES = [
    "delta.com",
    "aa.com",
    "united.com",
    "southwest.com",
    "alaskaair.com",
    "westjet.com",
    "aircanada.com",
    "lufthansa.com",
    "ba.com",
    "britishairways.com",
    "ryanair.com",
    "easyjet.com",
    "jetblue.com",
    "spirit.com",
    "frontierairlines.com",
    "qantas.com",
    "emirates.com",
    "qatarairways.com",
    "etihad.com",
    "singaporeair.com"
  ];

  const CAR_RENTAL = [
    "hertz.com",
    "avis.com",
    "budget.com",
    "enterprise.com",
    "alamo.com",
    "nationalcar.com",
    "sixt.com",
    "easirent.com",
    "thrifty.com",
    "dollar.com"
  ];

  const CRUISES = [
    "carnival.com",
    "royalcaribbean.com",
    "norwegiancruiseline.com",
    "ncl.com",
    "celebritycruises.com",
    "princess.com",
    "hollandamerica.com"
  ];

  const REGIONAL_TRAVEL = [
    "tui.com",
    "tui.co.uk",
    "vacationstogo.com",
    "lastminute.com",
    "travelzoo.com",
    "holidaylettings.co.uk",
    "agriturismo.it",
    "homeaway.co.uk",
    "fewo-direkt.de",
    "stayz.com.au"
  ];

  // Keywords for detecting ToS/refund/policy links
  const POLICY_KEYWORDS = [
    "terms",
    "conditions",
    "terms of service",
    "terms & conditions",
    "terms and conditions",
    "refund",
    "refunds",
    "refund policy",
    "return policy",
    "returns",
    "cancellation",
    "cancellations",
    "cancellation policy",
    "payment terms",
    "billing terms",
    "subscription",
    "subscriptions",
    "auto-renew",
    "auto renew",
    "automatic renewal",
    "renewal terms",
    "policy",
    "policies"
  ];

  function isSearchEngineHost(hostname) {
    return SEARCH_ENGINE_HOSTS.includes(hostname);
  }

  function isBlockedDomain(hostname) {
    if (!hostname) return false;
    return BLOCKED_DOMAINS.some((blocked) => {
      return hostname === blocked || hostname.endsWith("." + blocked);
    });
  }

  function getPathname(url) {
    try {
      const u = new URL(url);
      return (u.pathname || "").toLowerCase();
    } catch {
      return "";
    }
  }

  /**
   * Detect search results pages on major travel sites that we NEVER want to scan.
   *
   * Goal:
   * - Skip "browse listings / search results" views where Scribbit would feel spammy.
   * - Still allow Scribbit on details / checkout pages.
   */
  function isSearchResultsPage(hostname, url) {
    const host = (hostname || "").toLowerCase();
    const href = (url || "").toLowerCase();
    const path = getPathname(url);

    function urlContainsAny(substrings) {
      return substrings.some((s) => href.includes(s));
    }

    // ---------------- Airbnb special handling ----------------
    // We explicitly DO NOT treat Airbnb checkout / booking routes as search results,
    // even if they also contain "stays" or other search-like fragments.
    if (host.endsWith("airbnb.com") || host.endsWith("airbnb.ca")) {
      const isCheckoutLike =
        path.includes("/checkout") ||
        path.includes("/book") ||
        path.includes("/reservation") ||
        path.includes("/payments");

      if (isCheckoutLike) {
        // Always allow Scribbit on Airbnb checkout / booking flows.
        return false;
      }

      // Search/explore: /s/, /homes, /stays, /wishlists
      // Listing details: /rooms/ (we DO want Scribbit there)
      if (urlContainsAny(["/s/", "/homes", "/stays", "/wishlists"])) {
        if (!href.includes("/rooms/")) return true;
      }
    }

    // Booking.com searchresults pages
    if (host.endsWith("booking.com")) {
      if (urlContainsAny(["/searchresults", "searchresults.html"])) return true;
    }

    // Vrbo / HomeAway
    if (host.endsWith("vrbo.com") || host.endsWith("homeaway.com")) {
      if (urlContainsAny(["/search/", "/search-results", "search.mvc"])) {
        return true;
      }
    }

    // Expedia Group family
    if (EXPEDIA_FAMILY.some((d) => host === d || host.endsWith("." + d))) {
      if (urlContainsAny([
        "/hotel-search",
        "/hotel/search",
        "/hotel/results",
        "/flights-search",
        "/flight/search",
        "/car-search",
        "/car/search",
        "/vacation-rentals-search",
        "/vacationpackages-search",
        "/packages-search"
      ])) {
        return true;
      }
    }

    // Kayak, Skyscanner, Momondo, Trivago, TripAdvisor, Agoda
    if (META_SEARCH_FAMILY.some((d) => host === d || host.endsWith("." + d))) {
      if (urlContainsAny([
        "/flights/",
        "/flightsearch",
        "/hotels/",
        "/hotels-search",
        "/cars/",
        "/carsearch",
        "/packages",
        "/vacation-rentals",
        "/searchresults",
        "/search/"
      ])) {
        return true;
      }
    }

    // Direct hotel brands
    if (HOTEL_BRANDS.some((d) => host === d || host.endsWith("." + d))) {
      if (urlContainsAny([
        "/search",
        "/reservation/find",
        "/find-reservation",
        "/hotels/search"
      ])) {
        return true;
      }
    }

    // Airlines
    if (AIRLINES.some((d) => host === d || host.endsWith("." + d))) {
      if (urlContainsAny([
        "/flight-search",
        "/book/flights",
        "/book/flight",
        "/flights-search",
        "/search/results",
        "/fares/search"
      ])) {
        return true;
      }
    }

    // Car rental brands
    if (CAR_RENTAL.some((d) => host === d || host.endsWith("." + d))) {
      if (urlContainsAny([
        "/car-rental",
        "/carsearch",
        "/car/search",
        "/search",
        "/locations"
      ])) {
        return true;
      }
    }

    // Cruises
    if (CRUISES.some((d) => host === d || host.endsWith("." + d))) {
      if (urlContainsAny([
        "/cruise-search",
        "/search-cruise",
        "/search-results",
        "/itineraries"
      ])) {
        return true;
      }
    }

    // Regional OTAs & villa / agriturismo style sites
    if (REGIONAL_TRAVEL.some((d) => host === d || host.endsWith("." + d))) {
      if (urlContainsAny([
        "/search",
        "/searchresults",
        "/results",
        "/holidays",
        "/villas",
        "/farmhouses"
      ])) {
        return true;
      }
    }

    // Generic catch-all for travel subdomains:
    if (host.startsWith("travel.")) {
      if (urlContainsAny(["searchresults", "/search?", "/search/"])) {
        return true;
      }
    }

    return false;
  }

  function extractPageText() {
    if (!document.body) return "";
    const raw = document.body.innerText || "";
    return raw.length <= MAX_TEXT_LENGTH ? raw : raw.slice(0, MAX_TEXT_LENGTH);
  }

  function detectCurrencyMarkers(rawText) {
    const markers = new Set();

    const symbolMatches = rawText.match(/[$€£¥]/g);
    if (symbolMatches) symbolMatches.forEach((s) => markers.add(s));

    const codeMatches = rawText.match(/\b(USD|CAD|EUR|GBP|AUD|NZD)\b/gi);
    if (codeMatches) codeMatches.forEach((c) => markers.add(c.toUpperCase()));

    try {
      if (
        window.ScribbitCurrencyDetector &&
        typeof window.ScribbitCurrencyDetector.detect === "function"
      ) {
        const extra = window.ScribbitCurrencyDetector.detect(rawText);
        if (Array.isArray(extra)) extra.forEach((m) => markers.add(m));
      }
    } catch (err) {
      console.warn("[Scribbit] currencyDetector error:", err);
    }

    return Array.from(markers);
  }

  // Airbnb-specific fee extraction (also works reasonably on other OTAs)
  function extractAirbnbFees() {
    const fees = [];

    try {
      const candidateNodes = Array.from(
        document.querySelectorAll("div, span, li")
      ).slice(0, 3000);

      const feePatterns = [
        /cleaning fee/i,
        /service fee/i,
        /airbnb service fee/i,
        /occupancy taxes?/i,
        /tourism fee/i,
        /resort fee/i
      ];

      for (const node of candidateNodes) {
        const text = (node.innerText || "").trim();
        if (!text) continue;

        const lower = text.toLowerCase();

        let matchedPattern = null;
        for (const p of feePatterns) {
          if (p.test(lower)) {
            matchedPattern = p;
            break;
          }
        }
        if (!matchedPattern) continue;

        const amountMatch = text.match(/[$€£¥]\s*\d+[\d.,]*/);
        if (!amountMatch) continue;

        fees.push({
          label: text,
          amountSnippet: amountMatch[0],
          raw: text
        });

        if (fees.length >= 8) break;
      }
    } catch (err) {
      console.warn("[Scribbit] Airbnb fee extraction error:", err);
    }

    return fees;
  }

  function buildSnapshot() {
    const rawText = extractPageText();
    const textNormalized = rawText.toLowerCase();
    const airbnbFees = extractAirbnbFees();

    return {
      url: window.location.href,
      hostname: window.location.hostname,
      text: rawText,           // legacy
      textRaw: rawText,        // preferred for rules
      textNormalized,
      currencySymbolsDetected: detectCurrencyMarkers(rawText),
      airbnbFees
    };
  }

  // ------------------------------
  // Linked policy / ToS detection
  // ------------------------------

  function findPolicyLinks() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const matches = [];

    anchors.forEach((a) => {
      let href = (a.getAttribute("href") || "").trim();
      if (!href) return;
      if (href.startsWith("#")) return;
      const lowerHref = href.toLowerCase();

      // Skip mailto: and javascript:
      if (lowerHref.startsWith("mailto:") || lowerHref.startsWith("javascript:")) {
        return;
      }

      let absoluteUrl;
      try {
        absoluteUrl = new URL(href, window.location.href).href;
      } catch {
        return;
      }

      const text = (a.innerText || a.textContent || "").toLowerCase();
      const haystack = text + " " + lowerHref;

      const matched = POLICY_KEYWORDS.some((kw) =>
        haystack.includes(kw.toLowerCase())
      );
      if (matched) {
        matches.push(absoluteUrl);
      }
    });

    // Deduplicate + cap
    const seen = new Set();
    const deduped = [];
    for (const url of matches) {
      if (!seen.has(url)) {
        seen.add(url);
        deduped.push(url);
      }
    }

    return deduped.slice(0, POLICY_MAX_LINKS);
  }

  async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        credentials: "include"
      });

      if (!resp || !resp.ok) {
        console.warn("[Scribbit] policy fetch non-OK:", url, resp && resp.status);
        return null;
      }

      const text = await resp.text();
      return text;
    } catch (err) {
      console.warn("[Scribbit] policy fetch failed:", url, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function extractTextFromHtml(html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      if (!doc || !doc.body) return "";
      return doc.body.innerText || "";
    } catch (err) {
      console.warn("[Scribbit] extractTextFromHtml failed:", err);
      return "";
    }
  }

  async function evaluatePolicyLinks(urls) {
    if (!window.ScribbitRiskEngine || typeof window.ScribbitRiskEngine.evaluatePage !== "function") {
      return [];
    }

    const tasks = urls.map(async (url) => {
      try {
        const html = await fetchWithTimeout(url, POLICY_FETCH_TIMEOUT_MS);
        if (!html) return null;

        const text = extractTextFromHtml(html);
        if (!text || text.trim().length < 300) {
          // Too short to be meaningful
          return null;
        }

        const snapshot = {
          url,
          hostname: (new URL(url)).hostname,
          text: text,
          textRaw: text,
          textNormalized: text.toLowerCase(),
          currencySymbolsDetected: detectCurrencyMarkers(text),
          airbnbFees: []
        };

        const result = window.ScribbitRiskEngine.evaluatePage(snapshot);
        return result || null;
      } catch (err) {
        console.warn("[Scribbit] evaluatePolicyLinks error for", url, err);
        return null;
      }
    });

    const results = await Promise.all(tasks);
    return results.filter(Boolean);
  }

  function mergeRiskResults(primaryResult, policyResults) {
    if (!primaryResult || !Array.isArray(policyResults) || policyResults.length === 0) {
      return primaryResult;
    }

    // Merge risks (simple concat)
    const mergedRisks = []
      .concat(Array.isArray(primaryResult.risks) ? primaryResult.risks : [])
      .concat(
        ...policyResults.map((r) => (Array.isArray(r.risks) ? r.risks : []))
      );

    // Merge category scores: take max per category across all results
    const mergedCategoryScores = {};

    function includeCategoryScores(cs) {
      if (!cs) return;
      Object.keys(cs).forEach((key) => {
        const val = typeof cs[key] === "number" ? cs[key] : 0;
        if (!Object.prototype.hasOwnProperty.call(mergedCategoryScores, key)) {
          mergedCategoryScores[key] = val;
        } else if (val > mergedCategoryScores[key]) {
          mergedCategoryScores[key] = val;
        }
      });
    }

    includeCategoryScores(primaryResult.categoryScores);
    policyResults.forEach((r) => includeCategoryScores(r.categoryScores));

    // Merge riskScore: take the maximum overall riskScore
    let mergedRiskScore =
      typeof primaryResult.riskScore === "number" ? primaryResult.riskScore : 0;

    policyResults.forEach((r) => {
      if (typeof r.riskScore === "number" && r.riskScore > mergedRiskScore) {
        mergedRiskScore = r.riskScore;
      }
    });

    // Merge overallLevel: pick the highest severity
    const LEVEL_ORDER = { low: 1, medium: 2, high: 3 };

    function normalizeLevel(level) {
      const l = String(level || "").toLowerCase();
      if (l === "high" || l === "medium" || l === "low") return l;
      return "low";
    }

    function pickHigherLevel(a, b) {
      const na = normalizeLevel(a);
      const nb = normalizeLevel(b);
      return (LEVEL_ORDER[nb] || 0) > (LEVEL_ORDER[na] || 0) ? b : a;
    }

    let mergedOverallLevel = primaryResult.overallLevel || "LOW";

    policyResults.forEach((r) => {
      mergedOverallLevel = pickHigherLevel(
        mergedOverallLevel,
        r.overallLevel || "LOW"
      );
    });

    // Merge hasMeaningfulContent
    const hasMeaningful =
      Boolean(primaryResult.hasMeaningfulContent) ||
      policyResults.some((r) => r.hasMeaningfulContent);

    const finalResult = {
      ...primaryResult,
      risks: mergedRisks,
      categoryScores: mergedCategoryScores,
      riskScore: mergedRiskScore,
      overallScore: mergedRiskScore, // keep legacy alias in sync
      overallLevel: mergedOverallLevel,
      hasMeaningfulContent: hasMeaningful
    };

    return finalResult;
  }

  // ------------------------------
  // High-risk checkout-like pages
  // ------------------------------

  function isHighRiskCheckoutLikePage(hostname, url) {
    const host = (hostname || "").toLowerCase();
    const path = getPathname(url);

    // Airbnb checkout / booking / payment flows
    if (host.endsWith("airbnb.com") || host.endsWith("airbnb.ca")) {
      if (
        path.includes("/checkout") ||
        path.includes("/book") ||
        path.includes("/reservation") ||
        path.includes("/payments")
      ) {
        return true;
      }
    }

    // In future: extend to other sites (Booking, Expedia, airlines...) here.

    return false;
  }

  // ---------------------------------------------------------------------------
  // Core scan + enrichment
  // ---------------------------------------------------------------------------

  async function runScan() {
    try {
      const snapshot = buildSnapshot();

      const primaryResult = window.ScribbitRiskEngine
        ? window.ScribbitRiskEngine.evaluatePage(snapshot)
        : null;

      if (!window.ScribbitMessaging || !primaryResult) {
        if (!window.ScribbitMessaging) {
          console.warn("[Scribbit] scanner.js: ScribbitMessaging missing at runScan");
        }
        if (!primaryResult) {
          console.warn("[Scribbit] scanner.js: RiskEngine returned no result");
        }
        return;
      }

      let finalResult = primaryResult;

      const shouldUsePolicyLinks =
        !primaryResult.hasMeaningfulContent ||
        isHighRiskCheckoutLikePage(snapshot.hostname, snapshot.url);

      // If the main page doesn't have enough meaningful content OR is a
      // high-risk checkout-like page (e.g., Airbnb checkout), silently look
      // for linked policy/ToS pages and merge their risks.
      if (shouldUsePolicyLinks) {
        const policyLinks = findPolicyLinks();
        if (policyLinks.length > 0) {
          console.debug(
            "[Scribbit] scanner.js: enriching from policy links:",
            policyLinks
          );
          const policyResults = await evaluatePolicyLinks(policyLinks);
          if (policyResults && policyResults.length > 0) {
            finalResult = mergeRiskResults(primaryResult, policyResults);
          }
        }
      }

      await window.ScribbitMessaging.sendScanComplete({
        url: snapshot.url,
        riskResult: finalResult
      });

      console.log("[Scribbit] scanner.js: scan sent", {
        url: snapshot.url,
        riskScore: finalResult && finalResult.riskScore,
        overallLevel: finalResult && finalResult.overallLevel
      });
    } catch (err) {
      console.error("[Scribbit] scanner.js: error during runScan:", err);
    }
  }

  function waitForDependencies(callback) {
    let tries = 0;
    const max = 50;

    const interval = setInterval(() => {
      if (window.ScribbitMessaging && window.ScribbitRiskEngine) {
        clearInterval(interval);
        callback();
      } else if (tries++ >= max) {
        clearInterval(interval);
        console.warn("[Scribbit] scanner.js: dependencies missing");
      }
    }, 200);
  }

  // --- Dynamic re-scan for SPA + late-loading content ------------------------

  let dynamicObserver = null;
  let mutationScanTimeout = null;
  let spaWatcherStarted = false;
  let lastUrlSeen = null;

  function startDynamicObserver() {
    if (dynamicObserver) {
      dynamicObserver.disconnect();
      dynamicObserver = null;
    }

    try {
      dynamicObserver = new MutationObserver(() => {
        // Throttle re-scans to avoid hammering the engine
        if (mutationScanTimeout) return;
        mutationScanTimeout = setTimeout(() => {
          mutationScanTimeout = null;
          console.debug("[Scribbit] scanner.js: mutation-triggered re-scan");
          runScan();
        }, 500);
      });

      if (document.body) {
        dynamicObserver.observe(document.body, {
          childList: true,
          subtree: true
        });

        // Keep the observer around for a few seconds to catch prices/fees
        setTimeout(() => {
          if (dynamicObserver) {
            dynamicObserver.disconnect();
            dynamicObserver = null;
          }
        }, 5000);
      }
    } catch (err) {
      console.warn("[Scribbit] scanner.js: MutationObserver setup failed:", err);
    }
  }

  function handleSpaUrlChange(newUrl) {
    const hostname = window.location.hostname;

    if (isBlockedDomain(hostname)) {
      console.debug("[Scribbit] scanner: SPA URL change → blocked domain, skipping");
      return;
    }

    if (isSearchEngineHost(hostname)) {
      console.debug("[Scribbit] scanner: SPA URL change → search engine, skipping");
      return;
    }

    if (isSearchResultsPage(hostname, newUrl)) {
      console.debug("[Scribbit] scanner: SPA URL change → search results page, skipping");
      return;
    }

    console.debug("[Scribbit] scanner: SPA URL changed, re-running scan:", newUrl);
    runScan();
    startDynamicObserver();
  }

  function setupSpaUrlWatcher() {
    if (spaWatcherStarted) return;
    spaWatcherStarted = true;
    lastUrlSeen = location.href;

    setInterval(() => {
      const current = location.href;
      if (current !== lastUrlSeen) {
        lastUrlSeen = current;
        handleSpaUrlChange(current);
      }
    }, SPA_URL_CHECK_INTERVAL_MS);
  }

  // --- Init ------------------------------------------------------------------

  function init() {
    const hostname = window.location.hostname;
    const url = window.location.href;

    if (isBlockedDomain(hostname)) {
      console.debug("[Scribbit] scanner: skipping blocked domain:", hostname);
      return;
    }

    if (isSearchEngineHost(hostname)) {
      console.debug("[Scribbit] scanner: skipping search engine:", hostname);
      return;
    }

    if (isSearchResultsPage(hostname, url)) {
      console.debug("[Scribbit] scanner: skipping search results page:", url);
      // Still start SPA watcher: when user clicks into a listing (e.g. Airbnb /rooms/...),
      // we want to begin scanning there.
      setupSpaUrlWatcher();
      return;
    }

    waitForDependencies(() => {
      // Initial scan for the current URL
      runScan();
      startDynamicObserver();
      setupSpaUrlWatcher();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
