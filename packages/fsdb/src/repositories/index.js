import { join } from "node:path";
import {
  appendJsonl,
  boardSnapshot,
  createTask,
  getTask,
  listTaskFiles,
  listTasks,
  moveTask,
  paths,
  readCommandResult,
  readJsonl,
  readSettings,
  readSettingsScope,
  readYaml,
  recordCommandResult,
  updateSettings,
  updateTask,
  writeTaskFile,
  writeTaskAttachment,
  writeYaml
} from "../index.js";
import { acquireSemaphoreLeases, readSemaphoreState, releaseSemaphoreLeases } from "../runtime-store.js";

export class FsdbTaskRepository {
  constructor(root) {
    this.root = root;
  }

  findById(taskId) {
    return getTask(taskId, this.root);
  }

  list() {
    return listTasks(this.root);
  }

  async exists(taskId) {
    return Boolean(await this.findById(taskId));
  }

  create(input) {
    return createTask(input, this.root);
  }

  save(taskId, patch, eventType = "task.updated") {
    return updateTask(taskId, patch, this.root, eventType);
  }

  move(taskId, column) {
    return moveTask(taskId, column, this.root);
  }
}

export class FsdbTaskArtifactRepository {
  constructor(root) {
    this.root = root;
  }

  async readFile(taskId, path) {
    const p = paths(this.root);
    return readYaml(join(p.tasks, taskId, path), null);
  }

  writeFile(taskId, path, content) {
    return writeTaskFile(taskId, path, content, this.root);
  }

  writeAttachment(taskId, fileName, data) {
    return writeTaskAttachment(taskId, fileName, data, this.root);
  }

  listFiles(taskId) {
    return listTaskFiles(taskId, this.root);
  }

  async readTaskFiles(taskId) {
    const p = paths(this.root);
    const fs = await import("node:fs/promises");
    const taskDir = join(p.tasks, taskId);
    return {
      taskId,
      acceptance: await fs.readFile(join(taskDir, "acceptance.md"), "utf8").catch(() => ""),
      description: await fs.readFile(join(taskDir, "description.md"), "utf8").catch(() => ""),
      planning: await readYaml(join(taskDir, "planning.yaml"), null),
      subtasks: await readYaml(join(taskDir, "subtasks.yaml"), null),
      events: await readJsonl(join(taskDir, "events.jsonl")),
      files: await this.listFiles(taskId)
    };
  }
}

export class FsdbBoardRepository {
  constructor(root) {
    this.root = root;
  }

  async getDefaultBoard() {
    const p = paths(this.root);
    return readYaml(join(p.settings, "boards", "default.yaml"), { columns: [] });
  }

  snapshot() {
    return boardSnapshot(this.root);
  }

  async saveBoard(board) {
    const p = paths(this.root);
    await writeYaml(join(p.settings, "boards", "default.yaml"), board);
    return board;
  }
}

export class FsdbSettingsRepository {
  constructor(root) {
    this.root = root;
  }

  readScope(scope = "app") {
    return readSettingsScope(scope, this.root);
  }

  updateScope(scope, patch) {
    return updateSettings(scope, patch, this.root);
  }

  readAll() {
    return readSettings(this.root);
  }
}

export class FsdbEventStore {
  constructor(root) {
    this.root = root;
  }

  appendTaskEvent(taskId, event) {
    return appendJsonl(`${paths(this.root).tasks}/${taskId}/events.jsonl`, event);
  }

  appendRuntimeEvent(event) {
    return appendJsonl(`${paths(this.root).runtime}/logs/events.jsonl`, event);
  }

  listTaskEvents(taskId) {
    return readJsonl(`${paths(this.root).tasks}/${taskId}/events.jsonl`);
  }

  listRuntimeEvents() {
    return readJsonl(`${paths(this.root).runtime}/logs/events.jsonl`);
  }
}

export class FsdbCommandResultStore {
  constructor(root) {
    this.root = root;
  }

  get(commandId) {
    return readCommandResult(commandId, this.root);
  }

  put(commandId, result) {
    return recordCommandResult(commandId, result, this.root);
  }
}

export class FsdbSemaphoreRepository {
  constructor(root) {
    this.root = root;
  }

  readState() {
    return readSemaphoreState(this.root);
  }

  acquire(requests, holder) {
    return acquireSemaphoreLeases(requests, { ...holder, root: this.root });
  }

  release(filter) {
    return releaseSemaphoreLeases({ ...filter, root: this.root });
  }
}

export function createFsdbRepositories(root) {
  return {
    tasks: new FsdbTaskRepository(root),
    artifacts: new FsdbTaskArtifactRepository(root),
    board: new FsdbBoardRepository(root),
    settings: new FsdbSettingsRepository(root),
    events: new FsdbEventStore(root),
    commandResults: new FsdbCommandResultStore(root),
    semaphores: new FsdbSemaphoreRepository(root)
  };
}
