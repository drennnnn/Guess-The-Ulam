import "./config.js";

/**
 * @typedef {{ id: number, name: string, createdAt: number, updatedAt: number }} Dish
 * @typedef {{ queueId: number, entity: string, entityId: number, operation: string, payload: Dish, queuedAt: number }} QueuedMutation
 */

const DATABASE_NAME = "guess-the-ulam";
const DATABASE_VERSION = 2;
const DISHES_STORE = "dishes";
const QUEUE_STORE = "syncQueue";
const META_STORE = "metadata";

const SEED_DISHES = ["Adobo", "Sinigang", "Tinola", "Kare-kare", "Pancit"];

let databasePromise;

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("A local storage request failed."));
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error("A local storage transaction failed."));
        transaction.onerror = () => reject(transaction.error || new Error("A local storage transaction failed."));
    });
}

function openDatabase() {
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

        request.onupgradeneeded = event => {
            const database = request.result;
            const transaction = request.transaction;

            if (event.oldVersion < 1) {
                const dishes = database.createObjectStore(DISHES_STORE, {
                    keyPath: "id",
                    autoIncrement: true
                });
                dishes.createIndex("name", "name", { unique: false });
                dishes.createIndex("updatedAt", "updatedAt", { unique: false });
            }

            if (event.oldVersion < 2) {
                const queue = database.createObjectStore(QUEUE_STORE, {
                    keyPath: "queueId",
                    autoIncrement: true
                });
                queue.createIndex("queuedAt", "queuedAt", { unique: false });
                queue.createIndex("entityId", "entityId", { unique: false });
                database.createObjectStore(META_STORE, { keyPath: "key" });
            }

        };

        request.onsuccess = () => {
            const database = request.result;
            database.onversionchange = () => database.close();
            resolve(database);
        };

        request.onerror = () => {
            databasePromise = undefined;
            reject(request.error || new Error("Could not open local dish storage."));
        };

        request.onblocked = () => {
            databasePromise = undefined;
            reject(new Error("Local storage is busy in another tab. Close it and try again."));
        };
    });

    return databasePromise;
}

function isQuotaError(error) {
    return error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

function reportWriteError(error) {
    if (isQuotaError(error)) {
        const quotaError = new Error("Your device is low on storage. Free some space and try again.");
        quotaError.name = "QuotaExceededError";
        throw quotaError;
    }
    throw error;
}

async function appendOfflineMutation(transaction, operation, dish) {
    if (navigator.onLine && !globalThis.GUESS_ULAM_CONFIG.syncEndpoint) return;
    transaction.objectStore(QUEUE_STORE).add({
        entity: DISHES_STORE,
        entityId: dish.id,
        operation,
        payload: dish,
        queuedAt: Date.now()
    });
}

export async function seedInitialDishes() {
    const database = await openDatabase();
    const transaction = database.transaction([DISHES_STORE, META_STORE], "readwrite");
    const done = transactionDone(transaction);
    done.catch(() => {});
    const dishes = transaction.objectStore(DISHES_STORE);
    const metadata = transaction.objectStore(META_STORE);
    const seeded = await requestResult(metadata.get("seeded"));

    if (!seeded && await requestResult(dishes.count()) === 0) {
        const now = Date.now();
        for (const name of SEED_DISHES) {
            dishes.add({ name, createdAt: now, updatedAt: now });
        }
    }

    if (!seeded) metadata.put({ key: "seeded", value: true });
    await done;
}

/** @param {string} name @returns {Promise<Dish>} */
export async function create(name) {
    const database = await openDatabase();
    const now = Date.now();
    const dish = { name, createdAt: now, updatedAt: now };
    const transaction = database.transaction([DISHES_STORE, QUEUE_STORE], "readwrite");
    const done = transactionDone(transaction);
    done.catch(() => {});

    try {
        dish.id = await requestResult(transaction.objectStore(DISHES_STORE).add(dish));
        await appendOfflineMutation(transaction, "create", dish);
        await done;
        return dish;
    } catch (error) {
        await done.catch(() => {});
        reportWriteError(error);
    }
}

/** @param {number} id @returns {Promise<Dish | undefined>} */
export async function read(id) {
    const database = await openDatabase();
    return requestResult(database.transaction(DISHES_STORE).objectStore(DISHES_STORE).get(id));
}

/** @returns {Promise<Dish[]>} */
export async function readAll() {
    const database = await openDatabase();
    return requestResult(database.transaction(DISHES_STORE).objectStore(DISHES_STORE).getAll());
}

/** @param {number} id @param {Partial<Pick<Dish, "name">>} changes @returns {Promise<Dish>} */
export async function update(id, changes) {
    const database = await openDatabase();
    const transaction = database.transaction([DISHES_STORE, QUEUE_STORE], "readwrite");
    const done = transactionDone(transaction);
    done.catch(() => {});
    const dishes = transaction.objectStore(DISHES_STORE);

    try {
        const existing = await requestResult(dishes.get(id));
        if (!existing) throw new Error("That dish no longer exists.");
        const dish = { ...existing, ...changes, id, updatedAt: Date.now() };
        await requestResult(dishes.put(dish));
        await appendOfflineMutation(transaction, "update", dish);
        await done;
        return dish;
    } catch (error) {
        await done.catch(() => {});
        reportWriteError(error);
    }
}

/** @param {number} id @returns {Promise<void>} */
export async function remove(id) {
    const database = await openDatabase();
    const transaction = database.transaction([DISHES_STORE, QUEUE_STORE], "readwrite");
    const done = transactionDone(transaction);
    done.catch(() => {});
    const dishes = transaction.objectStore(DISHES_STORE);

    try {
        const existing = await requestResult(dishes.get(id));
        if (!existing) {
            await done;
            return;
        }
        await requestResult(dishes.delete(id));
        await appendOfflineMutation(transaction, "delete", existing);
        await done;
    } catch (error) {
        await done.catch(() => {});
        reportWriteError(error);
    }
}

export { remove as delete };

/** @param {Array<Partial<Dish> & Pick<Dish, "name">>} records @returns {Promise<Dish[]>} */
export async function bulkUpsert(records) {
    const database = await openDatabase();
    const transaction = database.transaction([DISHES_STORE, QUEUE_STORE], "readwrite");
    const done = transactionDone(transaction);
    done.catch(() => {});
    const dishes = transaction.objectStore(DISHES_STORE);
    const saved = [];

    try {
        for (const record of records) {
            const now = Date.now();
            const dish = {
                ...record,
                name: record.name.trim(),
                createdAt: record.createdAt || now,
                updatedAt: now
            };
            if (dish.id === undefined) dish.id = await requestResult(dishes.add(dish));
            else await requestResult(dishes.put(dish));
            await appendOfflineMutation(transaction, record.id === undefined ? "create" : "update", dish);
            saved.push(dish);
        }
        await done;
        return saved;
    } catch (error) {
        await done.catch(() => {});
        reportWriteError(error);
    }
}

/** @returns {Promise<void>} */
export async function clearAll() {
    const database = await openDatabase();
    const transaction = database.transaction([DISHES_STORE, QUEUE_STORE], "readwrite");
    const done = transactionDone(transaction);
    done.catch(() => {});
    const dishes = transaction.objectStore(DISHES_STORE);

    try {
        const existing = await requestResult(dishes.getAll());
        await requestResult(dishes.clear());
        for (const dish of existing) {
            await appendOfflineMutation(transaction, "delete", dish);
        }
        await done;
    } catch (error) {
        await done.catch(() => {});
        reportWriteError(error);
    }
}

/** @returns {Promise<QueuedMutation[]>} */
export async function getQueuedMutations() {
    const database = await openDatabase();
    return requestResult(database.transaction(QUEUE_STORE).objectStore(QUEUE_STORE).getAll());
}

export async function removeQueuedMutation(queueId) {
    const database = await openDatabase();
    const transaction = database.transaction(QUEUE_STORE, "readwrite");
    const done = transactionDone(transaction);
    done.catch(() => {});
    transaction.objectStore(QUEUE_STORE).delete(queueId);
    await done;
}
