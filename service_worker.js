const CACHE_NAME = "guest-the-ulam-v1";
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./style/style.css",
  "./js/javascript.js",
  "./images/icon.jpg"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES_TO_CACHE))
    );

    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();

        await Promise.all(
            keys
                .filter(key => key.startsWith("guest-ulam-") &&
                               key !== CACHE_NAME)
                .map(key => caches.delete(key))
        );

        await self.clients.claim();
    })());
});

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;

    const url = new URL(event.request.url);

    // Only handle requests from this website
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        const cached = await caches.match(event.request);

        if (cached) return cached;

        try {
            return await fetch(event.request);
        } catch (error) {
            if (event.request.mode === "navigate") {
                const fallback = await caches.match("./index.html");
                if (fallback) return fallback;
            }

            return new Response("You are offline and this file is not cached.", {
                status: 503,
                headers: { "Content-Type": "text/plain" }
            });
        }
    })());
});