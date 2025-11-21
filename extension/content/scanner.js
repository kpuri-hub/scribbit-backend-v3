// content/scanner.js
// Scribbit Fairness Scanner - Page Scanner
//
// Responsibilities:
// - Decide *where* and *when* to run Scribbit scans
// - Build a lightweight snapshot of the page
// - Call ScribbitRiskEngine.evaluatePage(snapshot)
// - Send results via ScribbitMessaging.sendScanComplete
//
// Phase 1 focus:
// - Add domain guard so Scribbit never runs on inbox/docs/etc.
// - Keep search engine guard
// - Keep architecture simple and deterministic

(function () {
  const MAX_TEXT_LENGTH = 50000;

  // Search engines where we generally do NOT want to run Scribbit
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

    // General productivity / collaboration (safe default)
    "teams.microsoft.com",
    "slack.com",
    "app.slack.com",
    "notion.so",
    "www.notion.so"
  ];

  function isSearchEngineHost(hostname) {
    return SEARCH_ENGINE_HOSTS.includes(hostname);
  }

  function isBlockedDomain(hostname) {
    // Exact match or subdomain of a blocked domain
    return BLOCKED_DOMAINS.some((blocked) => {
      return (
        hostname === blocked ||
        hostname.endsWith("." + blocked)
      );
    });
  }

  // Build a lightweight snapshot for the risk engine.
  // Keep it deterministic and capped in size.
  function buildPageSnapshot() {
    let text = "";
    if (document.body) {
      // innerText gives us the user-visible text; trim and cap length
      text = (document.body.innerText || "").trim();
    }

    if (text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH);
    }

    return {
      url: window.location.href,
      hostname: window.location.hostname,
      title: document.title || "",
      text,
    };
  }

  // Wait until both ScribbitMessaging and ScribbitRiskEngine are available
  function waitForDependencies(callback, maxTries = 30, delayMs = 200) {
    let tries = 0;
    const interval = setInterval(() => {
      if (window.ScribbitMessaging && window.ScribbitRiskEngine) {
        clearInterval(interval);
        callback();
        return;
      }

      if (tries++ >= maxTries) {
        clearInterval(interval);
        console.warn(
          "[Scribbit] scanner.js: dependencies not available after retries"
        );
        return;
      }
    }, delayMs);
  }

  // Core scan routine: snapshot → risk engine → messaging
  function runScan() {
    try {
      const snapshot = buildPageSnapshot();
      const riskResult = window.ScribbitRiskEngine.evaluatePage(snapshot);

      // Send results to background / popup / panel via messaging helper
      window.ScribbitMessaging.sendScanComplete({
        url: snapshot.url,
        riskResult,
      });
    } catch (err) {
      console.error("[Scribbit] scanner.js: error during runScan:", err);
    }
  }

  // Initialize Scribbit on this page, respecting domain + search engine guards.
  function init() {
    const hostname = window.location.hostname;

    // 1) Hard blocklist: never run on these domains.
    if (isBlockedDomain(hostname)) {
      console.debug(
        "[Scribbit] scanner.js: Skipping scan on blocked domain:",
        hostname
      );
      return;
    }

    // 2) Skip generic search engine results pages.
    if (isSearchEngineHost(hostname)) {
      console.debug(
        "[Scribbit] scanner.js: Skipping scan on search engine host:",
        hostname
      );
      return;
    }

    // 3) Wait for messaging + risk engine, then scan once.
    waitForDependencies(() => {
      runScan();

      // Optional: light SPA support (e.g., Booking/Airbnb dynamic updates).
      // We set up a short-lived MutationObserver that can trigger ONE extra scan
      // if the DOM changes significantly right after initial load.
      let hasRescanned = false;
      const observerTimeoutMs = 3000;

      try {
        const observer = new MutationObserver((mutations) => {
          if (hasRescanned) return;

          let significantChange = false;
          for (const m of mutations) {
            if (m.addedNodes && m.addedNodes.length > 0) {
              significantChange = true;
              break;
            }
          }

          if (significantChange) {
            hasRescanned = true;
            runScan();
          }
        });

        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
          });

          // Disconnect after a short window so we don't watch forever.
          setTimeout(() => observer.disconnect(), observerTimeoutMs);
        }
      } catch (err) {
        console.warn(
          "[Scribbit] scanner.js: MutationObserver setup failed:",
          err
        );
      }
    });
  }

  // DOMContentLoaded guard
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
