# Offline-first migration notes

- The app now stores dishes in the `guess-the-ulam` IndexedDB database. Schema
  version 1 created the indexed `dishes` store; version 2 added `syncQueue` and
  `metadata`. Future schema changes should increment `DATABASE_VERSION` and add
  conditional migrations in `js/db.js`.
- Existing data was previously only present in the HTML example, so there is no
  legacy user store to import. On first launch, five sample Filipino dishes are
  added only when the dish store is empty. IndexedDB persists independently per
  browser/device; clearing site data removes it.
- The `db.js` module exports `create`, `read`, `readAll`, `update`, `delete`
  (also named `remove` for the UI), `bulkUpsert`, and `clearAll`. Offline mutations are saved locally and added
  to the versioned outbox in the same IndexedDB transaction.
- There is no server/API in the original project, so the app does not claim
  device-local data has synchronized to an account or another device. To enable
  remote sync, set `syncEndpoint` in `js/config.js` to a same-origin endpoint
  that accepts the serialized mutation records, and provide that endpoint's
  authentication/conflict policy. Both offline and online writes then enter
  the outbox. The service worker flushes it with Background Sync where
  supported; browsers without it retry when the app is open and comes online.
- The service worker keeps the existing `service_worker.js` URL so existing
  installations update their current registration. Bump `BUILD_VERSION` there
  for every release; the new shell is precached and prior `guess-ulam-*`
  caches are removed on activation.
- Serve the site over HTTPS (or `localhost`) for service workers and install
  support. The first online visit is required to download the shell; after that,
  dish selection and edits work offline.
