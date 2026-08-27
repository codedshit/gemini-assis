/* ==========================================================================
 * config.js  —  Gemini Web Assistant configuration
 * --------------------------------------------------------------------------
 * This file is safe to host publicly on GitHub.
 * It contains NO secrets. The Gemini API key is NEVER stored here —
 * users enter it in the assistant's Settings -> AI panel (stored locally
 * in their own browser), or you provide a secure backend proxy.
 * ========================================================================== */

window.GEMINI_ASSISTANT_CONFIG = {
  /* ----------------------------------------------------------------------
   * REQUIRED: Where the bookmarklet loads assistant.js from.
   *
   * After you enable GitHub Pages, your URL will look like:
   *   https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/assistant.js
   *
   * Replace the placeholder below with your real GitHub Pages base URL.
   * The bookmarklet builds the final assistant.js URL from GITHUB_SCRIPT_URL.
   * -------------------------------------------------------------------- */
  GITHUB_SCRIPT_URL: "YOUR_GITHUB_PAGES_URL_HERE", // e.g. "https://ash.github.io/gemini-web-assistant"

  /* Current assistant version. Bump this on each release so the
   * "Check for Updates" feature and cache-busting query param stay in sync. */
  VERSION: "1.0.4",

  /* ----------------------------------------------------------------------
   * OPTIONAL: Secure backend proxy.
   * If set, the assistant sends requests to your proxy instead of calling
   * Gemini directly, so the API key can stay server-side. Leave empty to
   * use the user-provided key from Settings.
   * Example: "https://your-app.vercel.app/api/gemini"
   * -------------------------------------------------------------------- */
  PROXY_URL: "",

  /* Supported models. These appear in Settings -> AI -> Model. */
  MODELS: [
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  ],

  /* Default model used until the user picks another one. */
  DEFAULT_MODEL: "gemini-3.6-flash",

  /* Default assistant mode on startup. */
  DEFAULT_MODE: "game", // "general" | "game" | "study" | "analyze"

  /* Update checking. If true, the assistant compares its running VERSION
   * against config.js on GitHub and offers a manual reload when newer. */
  ENABLE_UPDATE_CHECK: true,

  /* Cache busting for GitHub-hosted files. The bookmarklet/assistant append
   * ?v=VERSION so browsers fetch fresh files after a release without
   * hammering the network on every single load. */
  CACHE_BUSTING: true,
};
