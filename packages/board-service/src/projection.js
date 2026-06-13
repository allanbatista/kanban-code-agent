export class BoardProjection {
  constructor({ repository }) {
    this.repository = repository;
    this.cached = null;
    this.dirty = true;
  }

  invalidate() {
    this.dirty = true;
  }

  async snapshot() {
    if (!this.dirty && this.cached) return this.cached;
    this.cached = await this.repository.snapshot();
    this.dirty = false;
    return this.cached;
  }
}
