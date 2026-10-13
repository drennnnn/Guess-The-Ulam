import { getQueuedMutations, removeQueuedMutation } from "./db.js";
import "./config.js";

const SYNC_ENDPOINT = globalThis.GUESS_ULAM_CONFIG.syncEndpoint;

let flushPromise;

export async function queueBackgroundSync(registration) {
    if (!registration || !SYNC_ENDPOINT || navigator.onLine || !("sync" in registration)) return;
    if ((await getQueuedMutations()).length === 0) return;
    await registration.sync.register("dish-mutations");
}

export async function flushQueuedMutations() {
    if (!navigator.onLine || !SYNC_ENDPOINT) return 0;
    if (flushPromise) return flushPromise;

    flushPromise = (async () => {
        const endpoint = new URL(SYNC_ENDPOINT, window.location.href);
        if (endpoint.origin !== window.location.origin) {
            throw new Error("The sync endpoint must use this app's origin.");
        }

        const queued = await getQueuedMutations();
        let completed = 0;

        for (const mutation of queued) {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(mutation)
            });
            if (!response.ok) {
                throw new Error(`Sync failed with status ${response.status}.`);
            }
            await removeQueuedMutation(mutation.queueId);
            completed += 1;
        }

        return completed;
    })();

    try {
        return await flushPromise;
    } finally {
        flushPromise = undefined;
    }
}
