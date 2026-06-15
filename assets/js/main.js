import { initHeader } from './header.js';
import { initReveal } from './reveal.js';
import { initParallax } from './parallax.js';
import { initSliders } from './slider.js';
import { initBooking } from './booking.js';
import { initVideo } from './video.js';

// Mark the document as JS-enabled. CSS uses `html:not(.js-on) ...` to hide
// the hamburger toggle (which would be a dead button without JS) and show
// the <noscript> fallback nav strip instead.
document.documentElement.classList.add('js-on');

const run = () => {
  initHeader();
  initReveal();
  initParallax();
  initSliders();
  initBooking();
  initVideo();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run);
} else {
  run();
}
