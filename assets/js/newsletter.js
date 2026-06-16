// Newsletter — "Stay with us" stub handler (#10).
//
// v1 behaviour: validate email + consent + honeypot, then open the
// "Thank you" .modal. NO network request goes anywhere.
//
// TODO: wire to real ESP — see follow-up issue #14.
//
// The submit button is rendered `disabled` in HTML and only enabled by
// this module on init. That's the JS-disabled fallback (negative test #7):
// without JS, the button stays disabled and the <noscript> mailto block
// below the form is the call-to-action instead. With JS, the button
// enables and full validation runs.

// RFC-5322-ish email check. Deliberately stricter than HTML5's `type=email`
// (which accepts e.g. "a@b" with no TLD) but still permissive enough not to
// reject anything real users would type. The HTML5 `required` + browser
// validation runs first as a cheap pre-check; this is the JS belt-and-braces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Cap email length BEFORE regex evaluation. Without this, a pasted-in
// pathological string could exercise the regex's backtracking. The regex
// above is non-backtracking (no nested quantifiers) so this is belt-and-
// braces, but cheap to enforce and useful when we wire to a real ESP that
// will reject overlong values anyway.
const MAX_EMAIL_LEN = 254;

export function initNewsletter() {
  const form = document.querySelector('[data-newsletter-form]');
  if (!form) return;

  const email = form.querySelector('[data-newsletter-email]');
  const honeypot = form.querySelector('[data-newsletter-honeypot]');
  const submit = form.querySelector('[data-newsletter-submit]');
  const errorEl = form.querySelector('[data-newsletter-error]');
  // Consent lives outside the <form> in the markup (it sits below as a
  // separate <label class="newsletter__consent">), so query the document.
  const consentLabel = document.querySelector('.newsletter__consent');
  const consentInput = consentLabel?.querySelector('input[type="checkbox"]');
  const modal = document.getElementById('newsletter-modal');

  if (!email || !submit || !consentInput || !modal) return;

  // Enable the submit button only once JS has wired up validation.
  // The HTML ships it disabled (negative test #7 fallback).
  submit.disabled = false;

  const showError = (msg) => {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };
  const clearError = () => {
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.hidden = true;
  };
  const flagConsent = (flag) => {
    consentLabel?.classList.toggle('is-error', flag);
  };

  // Clear errors as soon as the user starts fixing things, so the form
  // doesn't keep yelling after the problem's gone.
  email.addEventListener('input', clearError);
  consentInput.addEventListener('change', () => {
    if (consentInput.checked) flagConsent(false);
  });

  form.addEventListener('submit', (e) => {
    // ALWAYS preventDefault first — even on bot/honeypot trips. Default
    // submit would attempt a same-origin POST to the page URL, which a)
    // 404s under Vite dev and b) leaks the email to the URL on GH Pages
    // (no server, request silently fails but referrers carry the data).
    e.preventDefault();
    clearError();
    flagConsent(false);

    // Honeypot: any non-empty value = bot. Silently swallow — don't tell the
    // bot what tripped it, just no-op so the bot's logs say "submitted OK".
    // This is intentionally NOT showing the success modal either; a real
    // user can't reach this field, so a non-empty value is unambiguous bot
    // signal and we don't want to feed back ANY signal to retry against.
    if (honeypot && honeypot.value.trim() !== '') {
      // No modal, no error — pure no-op.
      return;
    }

    const value = (email.value || '').trim();

    if (value.length === 0) {
      showError('Please enter an email address.');
      email.focus();
      return;
    }
    if (value.length > MAX_EMAIL_LEN) {
      showError('That email address is too long.');
      email.focus();
      return;
    }
    if (!EMAIL_RE.test(value)) {
      showError('Please enter a valid email address.');
      email.focus();
      return;
    }
    if (!consentInput.checked) {
      showError('Please accept the Privacy Policy to subscribe.');
      flagConsent(true);
      consentInput.focus();
      return;
    }

    // Stub: open the "Thank you" modal. NO fetch, NO XHR, NO sendBeacon.
    // (Confirmed by negative test #5 — DevTools network tab must show no
    // outgoing request after submit in v1.)
    openModal(modal);

    // Reset form so the same browser session can subscribe again (e.g. a
    // family member on the same machine) without leaving the email field
    // pre-filled with someone else's address.
    form.reset();
  });

  // Modal close wiring — same pattern as booking.js (.modal__backdrop,
  // .modal__close, .btn[data-modal-close]).
  modal.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(modal));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal(modal);
  });
}

function openModal(modal) {
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  // Focus the close button — same convention as the booking modal: the
  // first [data-modal-close] is the .modal__backdrop <div> (not focusable),
  // so prefer the explicit .modal__close button.
  const focusable = modal.querySelector('.modal__close')
    || modal.querySelector('button[data-modal-close]')
    || modal.querySelector('.btn');
  focusable?.focus();
}

function closeModal(modal) {
  modal.hidden = true;
  document.body.style.overflow = '';
}
