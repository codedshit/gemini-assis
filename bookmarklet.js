/* ==========================================================================
 * bookmarklet.js  —  Tiny loader / launcher for Gemini Web Assistant
 * --------------------------------------------------------------------------
 * The bookmarklet is intentionally SMALL. It does NOT contain the app.
 * It only:
 *   1. Checks whether the assistant is already running on this page.
 *   2. If running  -> focuses / re-opens the existing assistant.
 *   3. If not      -> loads the latest assistant.js from your GitHub Pages URL.
 *   4. Injects the assistant into the current page (no navigation / reload).
 *
 * >>> ONE THING TO EDIT <<<
 * Replace  YOUR_GITHUB_PAGES_URL_HERE  with your GitHub Pages base URL, e.g.
 *   https://YOUR-USERNAME.github.io/YOUR-REPOSITORY
 * (No trailing slash, no "/assistant.js" — the loader adds that for you.)
 * ========================================================================== */

/* ==========================================================================
 * 1) DEVELOPMENT VERSION (readable) — for editing / understanding.
 *    This is the same logic that gets minified into the production one-liner.
 * ========================================================================== */
(function () {
  "use strict";

  // ---- EDIT THIS LINE ONLY -------------------------------------------------
  var GITHUB_SCRIPT_URL = "https://codedshit.github.io/gemini-assis/";
  // -------------------------------------------------------------------------

  var VERSION = "1.0.4"; // used for cache-busting the loaded assistant.js

  // If the assistant is already on the page, just focus/re-open it.
  // assistant.js registers window.__GEMINI_ASSISTANT__ with an open() method.
  if (window.__GEMINI_ASSISTANT__) {
    try {
      window.__GEMINI_ASSISTANT__.open();
    } catch (e) {
      console.error("[GeminiAssistant] focus failed:", e);
    }
    return;
  }

  // Guard against double-clicks racing while assistant.js is still loading.
  if (window.__GEMINI_ASSISTANT_LOADING__) return;
  window.__GEMINI_ASSISTANT_LOADING__ = true;

  if (!GITHUB_SCRIPT_URL || GITHUB_SCRIPT_URL === "YOUR_GITHUB_PAGES_URL_HERE") {
    window.__GEMINI_ASSISTANT_LOADING__ = false;
    alert(
      "Gemini Assistant: set GITHUB_SCRIPT_URL in the bookmarklet to your GitHub Pages URL first."
    );
    return;
  }

  // Normalize: strip trailing slash, then build the assistant.js URL.
  var base = GITHUB_SCRIPT_URL.replace(/\/+$/, "");
  var src = base + "/assistant.js?v=" + encodeURIComponent(VERSION);

  // Expose the base URL so assistant.js can locate config.js / styles.css.
  window.__GEMINI_ASSISTANT_BASE__ = base;
  window.__GEMINI_ASSISTANT_VERSION__ = VERSION;

  var s = document.createElement("script");
  s.src = src;
  s.async = true;
  s.onload = function () {
    window.__GEMINI_ASSISTANT_LOADING__ = false;
  };
  s.onerror = function () {
    window.__GEMINI_ASSISTANT_LOADING__ = false;
    alert(
      "Gemini Assistant: failed to load assistant.js from:\n" +
        src +
        "\nCheck that GitHub Pages is enabled and the URL is correct."
    );
  };
  (document.head || document.documentElement).appendChild(s);
})();

/* ==========================================================================
 * 2) PRODUCTION BOOKMARKLET (single line) — paste this as the bookmark URL.
 *    Replace YOUR_GITHUB_PAGES_URL_HERE, then copy the WHOLE javascript: line.
 * --------------------------------------------------------------------------
 *
 * javascript:(function(){var U="YOUR_GITHUB_PAGES_URL_HERE",V="1.0.4";if(window.__GEMINI_ASSISTANT__){try{window.__GEMINI_ASSISTANT__.open()}catch(e){}return}if(window.__GEMINI_ASSISTANT_LOADING__)return;window.__GEMINI_ASSISTANT_LOADING__=1;if(!U||U==="YOUR_GITHUB_PAGES_URL_HERE"){window.__GEMINI_ASSISTANT_LOADING__=0;alert("Set your GitHub Pages URL in the bookmarklet.");return}var b=U.replace(/\/+$/,"");window.__GEMINI_ASSISTANT_BASE__=b;window.__GEMINI_ASSISTANT_VERSION__=V;var s=document.createElement("script");s.src=b+"/assistant.js?v="+encodeURIComponent(V);s.async=1;s.onload=function(){window.__GEMINI_ASSISTANT_LOADING__=0};s.onerror=function(){window.__GEMINI_ASSISTANT_LOADING__=0;alert("Failed to load assistant.js from "+s.src)};(document.head||document.documentElement).appendChild(s)})();
 *
 * ========================================================================== */
