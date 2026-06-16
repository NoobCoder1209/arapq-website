// Location section — map iframe load detection (#10).
//
// The HTML ships the iframe with opacity:0 and a fallback paragraph
// rendered by default. This module:
//   1. Hydrates the iframe src + the get-directions href + the plus-code
//      text from SITE_CONFIG, keeping the same SSOT pattern the rest of
//      the site uses (data-site-config-* attributes are unsafe to use for
//      <iframe src=> because the SAFE_HREF allowlist is intentionally
//      restrictive — handle src here in a scoped, audited way).
//   2. Listens for the iframe's `load` event and adds .is-loaded to the
//      .location__map wrapper. CSS fades the iframe in at that point, so
//      until the load fires the fallback paragraph is what the user sees.
//   3. If load doesn't fire within MAP_LOAD_TIMEOUT_MS (e.g. *.google.com
//      blocked, ad-blocker abort, network drop), the fallback stays
//      visible — that's negative test #4 in the issue.
//
// Note on the load event: the iframe's `load` event fires for cross-origin
// frames as long as the response was received and a document was committed,
// even if the document body itself is empty or 4xx/5xx. This means the
// "blocked by extension" path (fetch fully aborted) reliably leaves the
// iframe blank → fallback visible. The "DNS / connection refused / 5xx"
// path may fire `load` against a browser-rendered error page in some
// browsers — in those cases the user sees the browser's chrome instead
// of our fallback. That's a known limitation of cross-origin iframes;
// short of a heartbeat probe to maps.google.com first (which has its own
// privacy implications), we accept it.

import { SITE_CONFIG } from './site-config.js';

const MAP_LOAD_TIMEOUT_MS = 5000;

// Allowlist for iframe src — must be HTTPS and host must end in
// google.com. This is a defense-in-depth check on top of SITE_CONFIG
// being dev-controlled: if a future config edit fat-fingers the URL,
// we don't end up loading e.g. a `javascript:` or `data:` URL into the
// iframe. The check runs against the parsed URL, not a regex, so things
// like `https://google.com.evil.com` are correctly rejected (host is
// `google.com.evil.com`, not endsWith `google.com` after the suffix
// match — we check exact suffix with leading dot).
function isSafeMapEmbed(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // host must equal "google.com" or end in ".google.com" (subdomain)
  return url.hostname === 'google.com' || url.hostname.endsWith('.google.com');
}

export function initLocation() {
  const wrap = document.querySelector('.location__map');
  if (!wrap) return;
  const iframe = wrap.querySelector('iframe');
  if (!iframe) return;

  // SSOT hydrate: if SITE_CONFIG.address.mapEmbed differs from the inline
  // iframe src, override (so `site-config.js` is the single edit point).
  // The HTML still ships a canonical inline src so the page works without
  // JS — same pattern as the rest of the site-config wiring.
  const cfgSrc = SITE_CONFIG?.address?.mapEmbed;
  if (typeof cfgSrc === 'string' && isSafeMapEmbed(cfgSrc) && iframe.src !== cfgSrc) {
    iframe.src = cfgSrc;
  } else if (typeof cfgSrc === 'string' && !isSafeMapEmbed(cfgSrc)) {
    console.warn('[location] SITE_CONFIG.address.mapEmbed rejected: not an https://*.google.com URL');
  }

  let settled = false;
  const markLoaded = () => {
    if (settled) return;
    settled = true;
    wrap.classList.add('is-loaded');
  };

  // The iframe might already have fired `load` before this script ran
  // (race: lazy-load triggers on scroll, this script is a deferred module
  // imported by main.js → DOMContentLoaded). The `complete`-style probe
  // doesn't exist for iframes, but `contentDocument`-readyState check is
  // blocked cross-origin, so we just attach the listener and ALSO start
  // the timeout immediately. If load already fired, the listener won't
  // fire again — we'll fall back to the timeout to leave the fallback
  // visible. That's the correct safe-default.
  iframe.addEventListener('load', markLoaded, { once: true });

  // No `error` listener: cross-origin iframes don't fire `error` reliably
  // when the URL is blocked by an extension (Firefox/Chrome both stay
  // silent), so we rely on the timeout instead of a positive failure
  // signal.

  // Belt-and-braces: if neither load nor error fires within the window,
  // do nothing — the fallback stays visible (which is what we want).
  setTimeout(() => {
    if (!settled) {
      // Optional dev hint; harmless in prod.
      console.debug('[location] iframe did not fire load within', MAP_LOAD_TIMEOUT_MS, 'ms — keeping fallback visible');
    }
  }, MAP_LOAD_TIMEOUT_MS);

  // Hydrate plus code + directions URL — keeping these here with the rest
  // of the location-section SSOT instead of stretching the generic
  // site-config-inject contract to a third attribute kind.
  const plusEl = document.querySelector('[data-location-plus-code]');
  if (plusEl && typeof SITE_CONFIG?.address?.plusCode === 'string') {
    if (plusEl.textContent !== SITE_CONFIG.address.plusCode) {
      plusEl.textContent = SITE_CONFIG.address.plusCode;
    }
  }
  const dirEl = document.querySelector('[data-location-directions]');
  if (dirEl && typeof SITE_CONFIG?.address?.directionsUrl === 'string') {
    const v = SITE_CONFIG.address.directionsUrl;
    // Same allowlist tier as SAFE_HREF for https links — keep it tight here
    // since this is also a cross-origin nav surface.
    if (/^https:\/\//i.test(v) && dirEl.getAttribute('href') !== v) {
      dirEl.setAttribute('href', v);
    }
  }
}
