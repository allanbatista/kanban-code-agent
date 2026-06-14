import { refreshOpenRouterModelCache } from "../packages/fsdb/src/index.js";

const rootArgIndex = process.argv.indexOf("--root");
const root = rootArgIndex >= 0 ? process.argv[rootArgIndex + 1] : process.env.KCA_STORAGE_ROOT;
const result = await refreshOpenRouterModelCache(root);
if (!result.ok) {
  console.error(result.error);
  process.exit(result.stale ? 0 : 1);
}
console.log(JSON.stringify({
  ok: true,
  providerId: result.cache.providerId,
  fetchedAt: result.cache.fetchedAt,
  models: result.cache.models.length
}, null, 2));
