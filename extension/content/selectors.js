// content/selectors.js
// Scribbit Fairness Scanner - Site-specific Selectors (Stub)
//
// This file will hold DOM selectors for platforms like Airbnb, Booking,
// Ryanair, etc. For now it's just a placeholder object.

const ScribbitSelectors = (() => {
  const SITES = {
    airbnb: {
      // Example:
      // priceContainer: '._tyxjp1',
      // feeSection: '._1k1o08v'
    },
    booking: {
      // Example:
      // priceContainer: '.prco-valign-middle-helper',
      // feeSection: '.hp_nav_breadcrumb'
    },
    generic: {
      // Fallback selectors if needed later
    }
  };

  /**
   * Get selectors for a given hostname (very basic mapping).
   *
   * @param {string} hostname - e.g., "www.airbnb.ca"
   * @returns {object} selectors config
   */
  function getSelectorsForHost(hostname) {
    if (!hostname || typeof hostname !== "string") return SITES.generic;

    const host = hostname.toLowerCase();
    if (host.includes("airbnb")) return SITES.airbnb;
    if (host.includes("booking")) return SITES.booking;

    return SITES.generic;
  }

  return {
    SITES,
    getSelectorsForHost
  };
})();

// Expose globally in content script context
window.ScribbitSelectors = ScribbitSelectors;
