// content/scanner.js
// Scribbit Fairness Scanner - Page Scanner
//
// Responsibilities:
// - Build a normalized snapshot of the page text
// - Add Airbnb-specific fee extraction & currency markers
// - Decide WHEN to scan (skip search engines, blocked domains,
//   and search results pages on major travel sites)
// - Detect SPA-style URL changes (Airbnb, OTAs) and re-scan
// - Call ScribbitRiskEngine.evaluatePage(snapshot)
// - Send results via ScribbitMessaging.sendScanComplete
//
// This file runs as a content script on matching pages.

(function () {
  const MAX_TEXT_LENGTH = 50000;
  const SPA_URL_CHECK_INTERVAL_MS = 500;

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

  // Expedia group / meta, etc.
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

  function isSearchEngineHost(hostname) {
    return SEARCH_ENGINE_HOSTS.includes(hostname);
  }

  function isBlockedDomain(hostname) {
    if (!hostname) return false;
    return BLOCKED_DOMAINS.some((blocked) => {
      return hostname === blocked || hostname.endsWith("." + blocked);
    });
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

    function urlContainsAny(substrings) {
      return substrings.some((s) => href.includes(s));
    }

    // Booking.com (classic searchresults pages)
    if (host.endsWith("booking.com")) {
      if (urlContainsAny(["/searchresults", "searchresults.html"])) return true;
    }

    // Airbnb
    // - Search/explore: /s/, /homes, /stays, /wishlists
    // - Listing details: /rooms/ (we DO want Scribbit there)
    if (host.endsWith("airbnb.com") || host.endsWith("airbnb.ca")) {
      if (urlContainsAny(["/s/", "/homes", "/stays", "/wishlists"])) {
        if (!href.includes("/rooms/")) return true;
      }
    }

    // Vrbo / HomeAway (vrbo.com, homeaway.com)
    if (host.endsWith("vrbo.com") || host.endsWith("homeaway.com")) {
      if (urlContainsAny(["/search/", "/search-results", "Search.mvc"])) {
        return true;
      }
    }

    // Expedia Group family
    if (EXPEDIA_FAMILY.some((d) => host === d || host.endsWith("." + d))) {
      if (urlContainsAny([
        "/Hotel-Search",
        "/hotel/search",
        "/Flights-Search",
        "/flight/search",
        "/Car-Search",
        "/car/search",
        "/Vacation-Rentals-Search",
        "/VacationPackages-Search",
        "/Packages-Search"
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

    const codeMatches = rawText.match(/\b(USD|CAD|EUR|EUR|GBP|AUD|NZD)\b/gi);
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

  async function runScan() {
    try {
      const snapshot = buildSnapshot();
      const riskResult = window.ScribbitRiskEngine
        ? window.ScribbitRiskEngine.evaluatePage(snapshot)
        : null;

      if (!window.ScribbitMessaging || !riskResult) {
        if (!window.ScribbitMessaging) {
          console.warn("[Scribbit] scanner.js: ScribbitMessaging missing at runScan");
        }
        if (!riskResult) {
          console.warn("[Scribbit] scanner.js: RiskEngine returned no result");
        }
        return;
      }

      await window.ScribbitMessaging.sendScanComplete({
        url: snapshot.url,
        riskResult
      });

      console.log("[Scribbit] scanner.js: scan sent", {
        url: snapshot.url,
        riskScore: riskResult && riskResult.riskScore,
        overallLevel: riskResult && riskResult.overallLevel
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
        // Throttle re-scans to avoid hammering the backend
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
      // Still start the SPA watcher so that when user clicks into a listing
      // (e.g., Airbnb /rooms/...), we can start scanning there.
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
