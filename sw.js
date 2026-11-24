// Offline support: keeps the app files on the device so it opens without a connection.
const VERSION = "my365-v5";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "db.js", "cutout.js", "export.js",
  "vendor/background-removal.js", "vendor/exifr-lite.umd.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "my365-runtime").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // app files: network first (so updates arrive), cache as fallback
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
  } else if (/fonts\.(googleapis|gstatic)\.com$|staticimgly\.com$/.test(url.hostname)) {
    // fonts and the cut-out model: cache first (they never change)
    e.respondWith(caches.open("my365-runtime").then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res;
    }));
  }
});
