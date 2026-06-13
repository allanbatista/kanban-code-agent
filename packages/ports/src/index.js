/**
 * Repository port contracts used by application services.
 *
 * TaskRepository: findById(taskId), list(), save(taskId, patch, eventType), create(input), move(taskId, column), exists(taskId)
 * TaskArtifactRepository: readFile(taskId, path), writeFile(taskId, path, content), listFiles(taskId), readTaskFiles(taskId)
 * BoardRepository: getDefaultBoard(), snapshot(), saveBoard(board)
 * SettingsRepository: readScope(scope), updateScope(scope, patch), readAll()
 * EventStore: appendTaskEvent(taskId, event), appendRuntimeEvent(event), listTaskEvents(taskId), listRuntimeEvents()
 * CommandResultStore: get(commandId), put(commandId, result)
 * SemaphoreRepository: readState(), acquire(requests, holder), release(filter)
 */
export const repositoryPorts = Object.freeze({
  TaskRepository: ["findById", "list", "save", "create", "move", "exists"],
  TaskArtifactRepository: ["readFile", "writeFile", "listFiles", "readTaskFiles"],
  BoardRepository: ["getDefaultBoard", "snapshot", "saveBoard"],
  SettingsRepository: ["readScope", "updateScope", "readAll"],
  EventStore: ["appendTaskEvent", "appendRuntimeEvent", "listTaskEvents", "listRuntimeEvents"],
  CommandResultStore: ["get", "put"],
  SemaphoreRepository: ["readState", "acquire", "release"]
});

export function assertPort(name, implementation) {
  const methods = repositoryPorts[name];
  if (!methods) throw new Error(`Unknown port: ${name}`);
  const missing = methods.filter((method) => typeof implementation?.[method] !== "function");
  if (missing.length) throw new Error(`${name} missing methods: ${missing.join(", ")}`);
  return implementation;
}
