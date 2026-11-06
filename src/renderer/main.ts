/**
 * Electron renderer entry point: injects the preload bridge as the platform
 * host, then starts the application. Browser builds use src/web/main.ts with
 * their own host instead, so this bundle stays free of browser-only code.
 */

import { provideHost, type WoslicerApi } from "./api.js";
// Static import only: dynamic import() performs a CORS fetch, which fails on
// file:// pages (the Electron dev entry). The import statement is hoisted, so
// app.js evaluates first; its module body defers every host access to the
// DOMContentLoaded handler, which fires after provideHost below.
import "./app.js";

const w = window as unknown as { woslicer?: WoslicerApi };
if (!w.woslicer) {
  throw new Error("preload bridge unavailable: window.woslicer is missing");
}
provideHost(w.woslicer);
