// Affiliate configuration
//
// When you sign an affiliate deal with a studio, add its tracking URL here
// keyed by studio name (exact match with studios.json). If a studio isn't
// listed here, its "Book now" button points to the studio website with
// a utm_source tag so you can still see the traffic in their analytics.

window.PILATES_CONFIG = {
  // Example:
  // "Heartcore": "https://weareheartcore.com/?via=pilateszn",
  // "Ten Health & Fitness": "https://ten.co.uk/?ref=pilateszn",
  affiliates: {},

  // Default UTM params appended to every outbound link without an affiliate URL
  utm: {
    utm_source: 'pilateszn',
    utm_medium: 'directory',
    utm_campaign: 'studio-card',
  },

  // Contact email — used for the "Report incorrect listing" link and the
  // About-page email. Change to a custom domain address once you have one.
  contact: 'sieyin1997@gmail.com',
};
