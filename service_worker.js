importScripts("./js/config.js");

const BUILD_VERSION = "2026-10-13-v1";
const SHELL_CACHE = `guess-ulam-shell-${BUILD_VERSION}`;
const STATIC_CACHE = `guess-ulam-static-${BUILD_VERSION}`;
const DATA_CACHE = `guess-ulam-data-${BUILD_VERSION}`;
const CACHE_PREFIXES = ["guess-ulam-", "guest-the-ulam-"];
const STATIC_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const APP_SHELL = [
    "./",
    "./index.html",
    "./offline.html",
    "./manifest.json",
    "./style/style.css",
    "./js/javascript.js",
    "./js/db.js",
    "./js/sync.js",
    "./js/config.js",
    "./images/icon-no-background.png",
    "./images/icon-192.png",
    "./images/icon-512.png"
];

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(APP_SHELL);
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames
            .filter(name => CACHE_PREFIXES.some(prefix => name.startsWith(prefix)) &&
                ![SHELL_CACHE, STATIC_CACHE, DATA_CACHE].includes(name))
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

function isStaticAsset(request) {
    return ["image", "font"].includes(request.destination) ||
        /\.(?:css|js|woff2?|ttf|otf|png|jpe?g|svg|webp|ico)$/i.test(new URL(request.url).pathname);
}

async function cacheStaticAsset(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) {
        const cachedAt = Number(cached.headers.get("x-sw-cached-at"));
        if (cachedAt && Date.now() - cachedAt < STATIC_MAX_AGE) return cached;
        await cache.delete(request);
    }

    try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
            const headers = new Headers(response.headers);
            headers.set("x-sw-cached-at", String(Date.now()));
            await cache.put(request, new Response(response.clone().body, {
                status: response.status,
                statusText: response.statusText,
                headers
            }));
        }
        return response;
    } catch (error) {
        const shellResponse = await caches.match(request);
        if (shellResponse) return shellResponse;
        throw error;
    }
}

async function networkFirst(request) {
    const cache = await caches.open(DATA_CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
    }
}

async function appShellFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        return await fetch(request);
    } catch (error) {
        if (request.mode === "navigate") {
            const fallback = await caches.match("./offline.html");
            if (fallback) return fallback;
        }
        throw error;
    }
}

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    if (url.pathname.includes("/api/")) {
        event.respondWith(networkFirst(event.request).catch(() => new Response(
            JSON.stringify({ error: "You are offline and this data is not cached." }),
            { status: 503, headers: { "Content-Type": "application/json" } }
        )));
    } else if (isStaticAsset(event.request)) {
        event.respondWith(cacheStaticAsset(event.request).catch(() => new Response(
            "This file is not available offline.",
            { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        )));
    } else {
        event.respondWith(appShellFirst(event.request).catch(async () => {
            if (event.request.mode === "navigate") {
                const fallback = await caches.match("./offline.html");
                if (fallback) return fallback;
            }
            return new Response("This page is not available offline.", {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8" }
            });
        }));
    }
});

self.addEventListener("sync", event => {
    if (event.tag === "dish-mutations") {
        event.waitUntil(flushMutationsInBackground());
    }
});

function databaseRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not read the sync queue."));
    });
}

function openSyncDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("guess-the-ulam", 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open local dish storage."));
        request.onblocked = () => reject(new Error("Local dish storage is blocked by another tab."));
    });
}

async function flushMutationsInBackground() {
    const endpointValue = self.GUESS_ULAM_CONFIG.syncEndpoint;
    if (!endpointValue) return;

    const endpoint = new URL(endpointValue, self.location.href);
    if (endpoint.origin !== self.location.origin) {
        throw new Error("The sync endpoint must use this app's origin.");
    }

    const database = await openSyncDatabase();
    try {
        const queued = await databaseRequest(
            database.transaction("syncQueue").objectStore("syncQueue").getAll()
        );
        for (const mutation of queued) {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(mutation)
            });
            if (!response.ok) throw new Error(`Sync failed with status ${response.status}.`);

            const transaction = database.transaction("syncQueue", "readwrite");
            transaction.objectStore("syncQueue").delete(mutation.queueId);
            await new Promise((resolve, reject) => {
                transaction.oncomplete = resolve;
                transaction.onabort = () => reject(transaction.error || new Error("Could not clear a synced mutation."));
                transaction.onerror = () => reject(transaction.error || new Error("Could not clear a synced mutation."));
            });
        }
    } finally {
        database.close();
    }
}
