import {
    clearAll,
    create,
    readAll,
    remove,
    seedInitialDishes,
    update
} from "./db.js";
import { flushQueuedMutations, queueBackgroundSync } from "./sync.js";

const dishList = document.querySelector(".dish-list");
const dishCount = document.querySelector(".total-dishes");
const dishInput = document.querySelector("[name='dish']");
const notice = document.querySelector(".notice");
const editDialog = document.querySelector("#edit-dialog");
const editForm = document.querySelector("#edit-form");
let dishes = [];
let noticeTimeout;
let deferredInstallPrompt;

function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle("is-error", isError);
    notice.hidden = false;
    window.clearTimeout(noticeTimeout);
    noticeTimeout = window.setTimeout(() => { notice.hidden = true; }, 4200);
}

function renderDishes() {
    const fragment = document.createDocumentFragment();

    for (const dish of dishes) {
        const item = document.createElement("article");
        item.className = "panel dish-item";

        const name = document.createElement("div");
        name.className = "dish-name";
        name.textContent = dish.name;

        const buttons = document.createElement("div");
        buttons.className = "dish-button";

        const editButton = document.createElement("button");
        editButton.className = "dish-edit";
        editButton.type = "button";
        editButton.dataset.action = "edit";
        editButton.dataset.id = dish.id;
        editButton.setAttribute("aria-label", `Edit ${dish.name}`);
        editButton.textContent = "Edit";

        const deleteButton = document.createElement("button");
        deleteButton.className = "dish-delete";
        deleteButton.type = "button";
        deleteButton.dataset.action = "delete";
        deleteButton.dataset.id = dish.id;
        deleteButton.setAttribute("aria-label", `Delete ${dish.name}`);
        deleteButton.textContent = "Delete";

        buttons.append(editButton, deleteButton);
        item.append(name, buttons);
        fragment.append(item);
    }

    dishList.replaceChildren(fragment);
    dishCount.textContent = String(dishes.length);
    dishList.setAttribute("aria-busy", "false");
}

function snapshotDishes() {
    return dishes.map(dish => ({ ...dish }));
}

function requestBackgroundSync() {
    if (navigator.onLine || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
        .then(queueBackgroundSync)
        .catch(error => console.warn("Background sync could not be scheduled:", error));
}

function syncAfterMutation() {
    if (navigator.onLine) {
        flushQueuedMutations().catch(error => showNotice(error.message, true));
    } else {
        requestBackgroundSync();
    }
}

function getDishId(button) {
    const id = Number(button.dataset.id);
    if (!Number.isSafeInteger(id)) throw new Error("Could not identify that dish.");
    return id;
}

async function handleAdd() {
    const name = dishInput.value.trim();
    if (!name) {
        showNotice("Type a dish name first.", true);
        dishInput.focus();
        return;
    }

    const previous = snapshotDishes();
    const temporaryId = `pending-${Date.now()}`;
    dishes = [...dishes, { id: temporaryId, name, createdAt: Date.now() }];
    renderDishes();
    dishInput.value = "";

    try {
        const createdDish = await create(name);
        dishes = dishes.map(dish => dish.id === temporaryId ? createdDish : dish);
        renderDishes();
        syncAfterMutation();
        showNotice("Dish saved on this device.");
    } catch (error) {
        dishes = previous;
        renderDishes();
        dishInput.value = name;
        showNotice(error.message || "Could not save that dish.", true);
    }
}

document.querySelector(".add-dish").addEventListener("click", handleAdd);
dishInput.addEventListener("keydown", event => {
    if (event.key === "Enter") handleAdd();
});

document.querySelector(".choose-dish").addEventListener("click", () => {
    if (dishes.length === 0) {
        showNotice("Add a dish to your list first.", true);
        return;
    }
    const selected = dishes[Math.floor(Math.random() * dishes.length)];
    document.querySelector(".chosen-dish p").textContent = "TODAY'S PICK";
    document.querySelector(".chosen-dish h2").textContent = selected.name;
});

dishList.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    try {
        const id = getDishId(button);
        const dish = dishes.find(item => item.id === id);
        if (!dish) return;

        if (button.dataset.action === "edit") {
            editForm.elements.dish.value = dish.name;
            editForm.dataset.id = String(dish.id);
            editDialog.showModal();
            editForm.elements.dish.focus();
            return;
        }

        const previous = snapshotDishes();
        dishes = dishes.filter(item => item.id !== id);
        renderDishes();
        try {
            await remove(id);
            syncAfterMutation();
            showNotice("Dish deleted.");
        } catch (error) {
            dishes = previous;
            renderDishes();
            throw error;
        }
    } catch (error) {
        showNotice(error.message || "Could not update the dish list.", true);
    }
});

editForm.addEventListener("submit", async event => {
    event.preventDefault();
    const name = editForm.elements.dish.value.trim();
    const id = Number(editForm.dataset.id);
    if (!name) {
        showNotice("Dish name cannot be empty.", true);
        editForm.elements.dish.focus();
        return;
    }

    const previous = snapshotDishes();
    dishes = dishes.map(dish => dish.id === id ? { ...dish, name } : dish);
    renderDishes();
    editDialog.close();

    try {
        const saved = await update(id, { name });
        dishes = dishes.map(dish => dish.id === id ? saved : dish);
        renderDishes();
        syncAfterMutation();
        showNotice("Dish updated.");
    } catch (error) {
        dishes = previous;
        renderDishes();
        showNotice(error.message || "Could not update that dish.", true);
    }
});
editForm.querySelector(".cancel-edit").addEventListener("click", () => editDialog.close());

document.querySelector(".clear-dish").addEventListener("click", async () => {
    if (dishes.length === 0) return;
    if (!window.confirm("Remove every dish from your list?")) return;

    const previous = snapshotDishes();
    dishes = [];
    renderDishes();
    try {
        await clearAll();
        syncAfterMutation();
        showNotice("Dish list cleared.");
    } catch (error) {
        dishes = previous;
        renderDishes();
        showNotice(error.message || "Could not clear the dish list.", true);
    }
});

const offlineStatus = document.querySelector(".offline-status");
function updateConnectionStatus() {
    const offline = !navigator.onLine;
    offlineStatus.hidden = !offline;
    offlineStatus.textContent = offline
        ? "You’re offline. Changes are saved on this device."
        : "Back online. Your dishes are saved on this device.";
    offlineStatus.classList.toggle("is-online", !offline);
    if (!offline) window.setTimeout(() => { offlineStatus.hidden = true; }, 2500);
}
window.addEventListener("online", () => {
    updateConnectionStatus();
    flushQueuedMutations().catch(error => showNotice(error.message, true));
});
window.addEventListener("offline", updateConnectionStatus);

const installButton = document.querySelector("#install-button");
if (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    installButton.hidden = false;
}
window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = undefined;
        installButton.hidden = true;
    } else {
        showNotice("To install on iPhone/iPad, use Share, then Add to Home Screen.");
    }
});
window.addEventListener("appinstalled", () => {
    installButton.hidden = true;
    showNotice("Guess The Ulam was installed.");
});

document.querySelector("#reload-button").addEventListener("click", () => window.location.reload());

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
        const registration = await navigator.serviceWorker.register("./service_worker.js");
        await queueBackgroundSync(registration);

        registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener("statechange", () => {
                if (worker.state === "installed" && navigator.serviceWorker.controller) {
                    document.querySelector(".update-notice").hidden = false;
                }
            });
        });
    } catch (error) {
        console.error("Service worker setup failed:", error);
        showNotice("Offline app setup failed. You can still use the app while this page is open.", true);
    }
}

window.addEventListener("error", event => {
    console.error("Unexpected application error:", event.error || event.message);
});
window.addEventListener("unhandledrejection", event => {
    console.error("Unexpected asynchronous error:", event.reason);
    showNotice("Something went wrong. Please try that again.", true);
});

async function startApp() {
    dishList.setAttribute("aria-busy", "true");
    try {
        await seedInitialDishes();
        dishes = await readAll();
        renderDishes();
        updateConnectionStatus();
        await registerServiceWorker();
        flushQueuedMutations().catch(error => showNotice(error.message, true));
    } catch (error) {
        dishList.setAttribute("aria-busy", "false");
        showNotice(error.message || "Could not load your saved dishes.", true);
    }
}

startApp();
