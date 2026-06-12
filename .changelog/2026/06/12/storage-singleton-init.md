# Storage Singleton Init

Date: 2026-06-12

## Changed

- Made `initStorage` cache the initialization promise per storage root so the storage bootstrap runs once per root in-process.
- Kept the stdout init logs on the real bootstrap path only.

## Files

- `packages/fsdb/src/index.js`: added per-root singleton cache for storage initialization.

## Validation

- `rtk node --check packages/fsdb/src/index.js`
- `rtk env KCA_STDOUT_LOGS=1 node --input-type=module -e "import { initStorage } from './packages/fsdb/src/index.js'; const root = '/tmp/kca-init-singleton-' + Date.now(); await initStorage(root); await initStorage(root);"`
- `rtk pnpm test:unit`
