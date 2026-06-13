import { logStep } from "@kca/core/log";
import { parseQuery } from "@kca/schemas";

export class QueryBus {
  constructor({ handlers = {} } = {}) {
    this.handlers = new Map(Object.entries(handlers));
  }

  register(type, handler) {
    this.handlers.set(type, handler);
    return this;
  }

  async execute(input, context = {}) {
    const query = parseQuery(input);
    const handler = this.handlers.get(query.type);
    if (!handler) throw new Error(`Unsupported query: ${query.type}`);
    logStep("query-bus", "query.start", { type: query.type });
    const result = await handler(query, context);
    logStep("query-bus", "query.done", { type: query.type });
    return result;
  }
}
