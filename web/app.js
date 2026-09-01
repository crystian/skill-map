// skill-map landing, ESM barrel.
//
// Each module is a self-executing IIFE that wires up one widget on the
// landing page. The imports below run them in the order they need to
// boot (today every module operates on independent DOM selectors, so
// the order is informational, but keep it stable per visual section
// so future cross-module event wiring stays predictable).
//
// All modules ported section by section from the original
// `web/tmp/*.jsx` sketches. See each module file for the full prose
// header documenting the widget it owns.
//
// Index loads this entry as `<script type="module" src="/app.js">`.
// No bundling: every module ships as its own request over HTTP/2.

import './modules/mobile-nav.js';
import './modules/hero-embed.js';
import './modules/roadmap.js';
import './modules/copy-code.js';
import './modules/audio-player.js';
import './modules/peco.js';
import './modules/video-embed.js';
import './modules/drawer-footer.js';
import './modules/cookie-consent.js';
