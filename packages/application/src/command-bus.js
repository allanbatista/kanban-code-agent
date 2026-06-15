import { logStep } from "@kca/core/log";
import { parseCommand } from "@kca/schemas";

export class CommandBus {
  constructor({ handlers = {}, resultStore, eventBus } = {}) {
    this.handlers = new Map(Object.entries(handlers));
    this.resultStore = resultStore;
    this.eventBus = eventBus;
  }

  register(type, handler) {
    this.handlers.set(type, handler);
    return this;
  }

  async execute(input, context = {}) {
    const command = parseCommand(input);
    logStep("command-bus", "command.start", { type: command.type, commandId: command.commandId });
    const cached = await this.resultStore?.get?.(command.commandId);
    if (cached) {
      logStep("command-bus", "command.cache_hit", { type: command.type, commandId: command.commandId });
      return { ...cached, idempotent: true };
    }
    const handler = this.handlers.get(command.type);
    if (!handler) throw new Error(`Unsupported command: ${command.type}`);
    const result = await handler(command, context);
    logStep("command-bus", "command.done", { type: command.type, commandId: command.commandId, ok: result?.ok ?? true });
    const stored = this.resultStore?.put ? await this.resultStore.put(command.commandId, result) : result;
    await this.eventBus?.publish?.({ type: "command.executed", commandType: command.type, commandId: command.commandId, result: stored });
    return stored;
  }
}
