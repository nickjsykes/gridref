// Optional settings. To show what3words inside the app, paste a what3words API key here
// (developer.what3words.com) and restrict it to nickjsykes.github.io in their dashboard.
// Left blank, the what3words row opens what3words at the crosshair instead.
window.GRIDREF_CONFIG = {
  what3wordsKey: "",
  // OS Outdoor map. Best: osProxy, the address of our Cloudflare Worker (proxy/README.md),
  // which holds a Premium key and gives full detail to zoom 20. Once that's set, empty osKey
  // and delete that key in the Data Hub: on a Premium account it would unlock premium too.
  osProxy: "",
  // Fallback: an OS Data Hub OpenData key (osdatahub.os.uk), sharp only to zoom 16
  osKey: "L7yA8JJqGy9G0qIVctJdkNlca6ashTzg",
  // Where "Report bug to Nick…" sends (type "nick" in the search box)
  feedbackTo: "nick.sykes@naturalengland.org.uk",
};
