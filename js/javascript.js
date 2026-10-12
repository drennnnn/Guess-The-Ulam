if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        try {
            const registration =
                await navigator.serviceWorker.register(
                    "./service_worker.js"
                );

            console.log("Service Worker registered:", registration.scope);
        } catch (error) {
            console.error("Service Worker error:", error);
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    const body = document.querySelector("body");
    const date = new Date();
    body.append(` ${date.toLocaleDateString('en-US', { 
  weekday: 'long', 
  year: 'numeric', 
  month: 'short', 
  day: 'numeric' 
})}`);
});