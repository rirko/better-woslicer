/**
 * Browser entry point: starts the application with the pure-browser host.
 * The Electron entry (src/renderer/main.ts) injects the preload bridge
 * instead, so each bundle contains exactly one host.
 */

import { provideHost } from "../renderer/api.js";
import { browserHost } from "../renderer/host-browser.js";
// Static import only: dynamic import() performs a CORS fetch and fails on
// non-HTTP pages. The import is hoisted, so app.js evaluates first; its
// module body defers every host access to the DOMContentLoaded handler,
// which fires after provideHost below.
import "../renderer/app.js";

provideHost(browserHost);
