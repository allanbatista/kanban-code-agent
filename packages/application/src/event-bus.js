export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  subscribe(type, handler) {
    const handlers = this.handlers.get(type) || new Set();
    handlers.add(handler);
    this.handlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  async publish(event) {
    const handlers = [...(this.handlers.get(event.type) || []), ...(this.handlers.get("*") || [])];
    for (const handler of handlers) await handler(event);
    return event;
  }
}

export function createEventBus() {
  return new EventBus();
}
