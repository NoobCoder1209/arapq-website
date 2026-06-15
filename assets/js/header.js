// Sticky header — toggle .is-scrolled when the sentinel leaves the viewport.
// Also owns the mobile two-tap dance for the Call-me-back link (#7): on a
// touch device, the first tap reveals the number (matches the desktop hover
// state) and the second tap dials. Keeps the markup as a real <a href="tel:...">
// so JS-disabled / right-click / keyboard all keep working — we only intercept
// the FIRST tap on coarse pointers.
//
// Also owns the hamburger drawer (#8): open/close, focus trap, body scroll
// lock, Esc/backdrop/link/× close paths, focus restoration to the toggle.
export function initHeader() {
  const header = document.getElementById('site-header');
  const sentinel = document.getElementById('header-sentinel');
  if (header && sentinel) {
    const io = new IntersectionObserver(
      ([entry]) => {
        header.classList.toggle('is-scrolled', !entry.isIntersecting);
      },
      { threshold: 0 }
    );
    io.observe(sentinel);
  }

  initCallTwoTap();
  initDrawer();
}

// Two-tap state machine for .site-header__call on touch devices.
// Window between taps: 5s (resets on outside-tap or timeout — `blur` doesn't
// reliably fire on `<a>` taps in mobile Safari, so we don't lean on it).
function initCallTwoTap() {
  const call = document.querySelector('[data-call-cta]');
  if (!call) return;
  // Idempotency guard — a second initHeader() (HMR, re-init, future SPA-style
  // route change) must not stack a second click handler / document listener.
  if (call.dataset.twoTapInit === '1') return;
  call.dataset.twoTapInit = '1';

  // Hover-capable pointers (desktop mouse) get the CSS :hover reveal — no JS
  // intercept. We gate on the PRIMARY pointer being coarse + non-hovering so
  // that hybrid devices (iPad with trackpad, Surface, a Windows laptop with a
  // touchscreen) keep the desktop CSS-hover path: their primary pointer is
  // fine, the first mouse-click dials directly, and CSS :hover handles the
  // reveal. The trade-off is that on those hybrids, if the user reaches up
  // and taps the screen, the very first tap will dial (no two-tap gate).
  // That's a minor wart on a niche platform; preventing the regression on
  // mouse-driven hybrids matters more.
  const isTouch =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!isTouch) return;

  const REVEAL_TIMEOUT_MS = 5000;
  let resetTimer = null;

  const reset = () => {
    call.classList.remove('is-revealed');
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  };

  call.addEventListener('click', (e) => {
    // Treat keyboard activation (Enter / Space on a focused link, which the
    // browser also dispatches as a click) as a direct dial — the user can
    // already see the number via :focus-visible's reveal, so the "first
    // press shows the number" half of the two-tap gate would just be an
    // extra keystroke they don't need.
    if (call.matches(':focus-visible')) {
      reset();
      return;
    }
    if (call.classList.contains('is-revealed')) {
      // Second tap — let the browser follow the tel: href.
      reset();
      return;
    }
    // First tap — reveal the number, don't dial.
    e.preventDefault();
    call.classList.add('is-revealed');
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(reset, REVEAL_TIMEOUT_MS);
  });

  // Tap anywhere else → collapse.
  document.addEventListener('click', (e) => {
    if (!call.classList.contains('is-revealed')) return;
    if (call.contains(e.target)) return;
    reset();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Hamburger drawer (#8). Side panel that slides in from the left, with a
// dimmed backdrop, body scroll-lock, focus trap and 5 close paths:
//   1. click any link inside the drawer
//   2. press Esc
//   3. click the backdrop
//   4. click the hamburger toggle a second time
//   5. click the explicit × close button
// On close, focus returns to the hamburger toggle.
//
// Idempotent: dataset.drawerInit guards against double-binding under HMR /
// repeat initHeader() calls. The drawer itself remains closed-by-default —
// page reload always starts collapsed (no localStorage of state).

// Length of the slide+fade. Matches the inline 250ms in layout.css for
// .primary-nav__panel / .primary-nav__backdrop; the safety timeout that
// re-applies [hidden] post-close uses this + buffer.
const DRAWER_TRANSITION_MS = 250;
const DRAWER_TRANSITION_FALLBACK_MS = DRAWER_TRANSITION_MS + 150;

// Background regions taken out of the focus order while the drawer is open.
// Using inert (and a stale-attribute cleanup on close) is the one-line
// guarantee the focus trap actually wants — boundary checks alone don't
// help if focus ever lands on a non-drawer element.
//
// Note: we inert .site-logo and .site-header__cta (the two non-toggle
// slots) rather than the whole #site-header — the hamburger toggle MUST
// remain interactive so close-path #4 (second-click) keeps working.
const INERT_SELECTORS = ['.site-logo', '.site-header__cta', 'main', '.site-footer', '.primary-nav__noscript'];

function initDrawer() {
  const toggle = document.querySelector('[data-nav-toggle]');
  const panel = document.getElementById('primary-nav');
  const backdrop = document.querySelector('[data-nav-backdrop]');
  const closeBtn = panel ? panel.querySelector('[data-nav-close]') : null;
  if (!toggle || !panel || !backdrop) return;
  if (toggle.dataset.drawerInit === '1') return;
  toggle.dataset.drawerInit = '1';

  // Defensive: if the user reaches a page mid-load with the drawer somehow
  // left open in the DOM (shouldn't happen — server renders [hidden] —
  // but a future SSR or a stray HMR could), close it before we wire up.
  setClosedAttrs();

  let isOpen = false;
  // The most recently focused element OUTSIDE the drawer, restored on close.
  // We anchor on the toggle by spec, but stash the live activeElement too
  // in case some other surface opened the drawer programmatically.
  let lastFocusBeforeOpen = null;
  // Saved scroll position so position:fixed body-lock doesn't jump the page.
  let lockedScrollY = 0;
  // Increments on every close. The `transitionend` / safety-timeout cleanup
  // closure captures the token at schedule time and bails if it's stale —
  // so a rapid open-close-open can't have the prior close's cleanup hide
  // the panel mid-second-slide.
  let closeToken = 0;
  // Stash the scrollbar gutter measured at open-time so close() can clear
  // exactly the padding it added (multiple resizes mid-open can't leave
  // residue).
  let lockedGutter = 0;
  // Elements we marked [inert] so we know exactly which ones to clear.
  let inertedEls = [];

  // ── Open ──────────────────────────────────────────────────────────────
  function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocusBeforeOpen = document.activeElement;

    // Compensate for the disappearing scrollbar BEFORE flipping body to
    // position:fixed — measuring after the swap reads 0. Apply matching
    // padding-right to <body> AND the sticky <header> (otherwise the
    // header's right-anchored CTA pill jumps when the body widens).
    lockedGutter = window.innerWidth - document.documentElement.clientWidth;
    if (lockedGutter > 0) {
      document.body.style.paddingRight = `${lockedGutter}px`;
      const header = document.getElementById('site-header');
      if (header) header.style.paddingRight = `${lockedGutter}px`;
    }

    // Body scroll lock. position:fixed leaks the current scroll position,
    // so we offset top by the saved Y and restore it on close.
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.classList.add('body--scroll-locked');

    // Take everything outside the drawer out of the tab order + AT
    // announcement. This makes the focus trap robust to focus drifting
    // onto a non-drawer element (devtools, programmatic .focus(), future
    // changes that add inert-aware UI). Cleared on close.
    inertedEls = [];
    INERT_SELECTORS.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (el === panel || el.contains(panel)) return;
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
        inertedEls.push(el);
      });
    });

    // Reveal first (clear `hidden`), then in the next frame flip the
    // [data-state] attribute so the CSS transition actually animates from
    // the hidden→visible starting state. Without the rAF, browsers
    // collapse the two state changes and the slide skips.
    panel.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      panel.dataset.state = 'open';
      backdrop.dataset.state = 'open';
    });

    panel.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');

    // Move focus into the panel — close button first, falling back to the
    // panel itself (tabindex=-1 makes it programmatically focusable).
    (closeBtn || panel).focus({ preventScroll: true });

    document.addEventListener('keydown', onKeyDown);
  }

  // ── Close ─────────────────────────────────────────────────────────────
  function close() {
    if (!isOpen) return;
    isOpen = false;
    closeToken += 1;
    const myToken = closeToken;

    panel.dataset.state = 'closed';
    backdrop.dataset.state = 'closed';
    toggle.setAttribute('aria-expanded', 'false');

    // Restore body scroll BEFORE setting the page back to its prior Y.
    document.body.classList.remove('body--scroll-locked');
    document.body.style.top = '';
    if (lockedGutter > 0) {
      document.body.style.paddingRight = '';
      const header = document.getElementById('site-header');
      if (header) header.style.paddingRight = '';
      lockedGutter = 0;
    }
    window.scrollTo(0, lockedScrollY);

    // Clear inert + aria-hidden from background regions before moving
    // focus, so the restore target (typically the toggle, which lives
    // inside #site-header) is reachable.
    inertedEls.forEach((el) => {
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
    });
    inertedEls = [];

    document.removeEventListener('keydown', onKeyDown);

    // Restore focus to the hamburger BEFORE setting aria-hidden on the
    // panel. Setting aria-hidden=true on an element while a descendant
    // still has focus is an a11y violation that Chrome devtools / axe
    // both flag.
    const restoreTarget =
      (lastFocusBeforeOpen
        && lastFocusBeforeOpen !== document.body
        && document.contains(lastFocusBeforeOpen))
        ? lastFocusBeforeOpen
        : toggle;
    restoreTarget.focus({ preventScroll: true });
    lastFocusBeforeOpen = null;

    panel.setAttribute('aria-hidden', 'true');

    // Wait for the transition to finish before re-applying [hidden] so the
    // panel doesn't disappear mid-slide. Two safeguards:
    //   1. filter `transitionend` by propertyName === 'transform' so a
    //      future second transitioned property doesn't fire cleanup early
    //   2. closeToken guard — if a re-open beat us, the captured token is
    //      stale and we skip
    const cleanup = (e) => {
      if (e && e.propertyName && e.propertyName !== 'transform') return;
      panel.removeEventListener('transitionend', cleanup);
      if (myToken !== closeToken) return;
      if (isOpen) return;
      panel.hidden = true;
      backdrop.hidden = true;
    };
    panel.addEventListener('transitionend', cleanup);
    setTimeout(() => cleanup(null), DRAWER_TRANSITION_FALLBACK_MS);
  }

  function setClosedAttrs() {
    panel.dataset.state = 'closed';
    backdrop.dataset.state = 'closed';
    panel.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    backdrop.hidden = true;
  }

  // ── Event wiring ──────────────────────────────────────────────────────
  // Toggle: same button opens AND closes (close path #4).
  toggle.addEventListener('click', () => {
    if (isOpen) close();
    else open();
  });

  // Explicit × button (close path #5).
  if (closeBtn) closeBtn.addEventListener('click', close);

  // Backdrop click (close path #3).
  backdrop.addEventListener('click', close);

  // Click any link in the drawer (close path #1). Default navigation
  // proceeds normally — closing first just makes the drawer feel
  // responsive on the way out (it doesn't actually visibly transition
  // before unload, but the state-transition is correct and clean).
  // Modifier-clicks (Cmd/Ctrl/middle/Shift/Alt) open the link in a new
  // tab — the current tab doesn't navigate, so we leave the drawer open
  // instead of yanking the user's context.
  panel.querySelectorAll('[data-nav-link]').forEach((link) => {
    link.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== undefined && e.button !== 0) return;
      close();
    });
  });

  // Close on viewport rotation/resize that crosses the mobile breakpoint
  // (480px). iOS in particular has long-standing bugs where position:fixed
  // body-lock + an orientation change can paint the page offscreen — the
  // safest mitigation is to close the drawer on orientationchange and
  // let the user reopen it cleanly.
  let resizeTimer = null;
  let lastWasNarrow = window.innerWidth <= 480;
  window.addEventListener('resize', () => {
    if (!isOpen) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const isNarrow = window.innerWidth <= 480;
      if (isNarrow !== lastWasNarrow) {
        lastWasNarrow = isNarrow;
        close();
      }
    }, 100);
  });
  window.addEventListener('orientationchange', () => {
    if (isOpen) close();
  });

  // Esc + Tab focus trap (close path #2 + spec focus trap requirement).
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;

    const focusables = getFocusable(panel);
    if (focusables.length === 0) {
      // Nothing tabbable in the drawer (shouldn't happen — the close
      // button is always rendered — but if a future change empties the
      // panel, pin focus to the panel itself rather than letting it
      // escape into the inert background). The user won't see a focus
      // ring on tabindex=-1, but they're contained.
      e.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    // If focus is somehow OUTSIDE the panel (a stray script, devtools,
    // future programmatic shift), pull it back in. The inert+aria-hidden
    // on background regions makes this unreachable in normal use, but
    // this is the belt to that braces.
    if (!panel.contains(active)) {
      e.preventDefault();
      first.focus({ preventScroll: true });
      return;
    }

    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    }
  }
}

// Returns the focusable elements inside `root` in tab order. Excludes
// elements that are disabled, hidden via [hidden], or inert. Used by the
// drawer's focus trap.
function getFocusable(root) {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(root.querySelectorAll(selector)).filter((el) => {
    if (el.hasAttribute('hidden') || el.closest('[hidden]')) return false;
    // offsetParent === null catches display:none ancestors. The panel itself
    // is fixed-positioned so it has an offsetParent of <body>, fine.
    if (el.offsetParent === null && el !== root) return false;
    return true;
  });
}
