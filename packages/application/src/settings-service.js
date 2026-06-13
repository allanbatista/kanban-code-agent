export class SettingsService {
  constructor({ repository }) {
    this.repository = repository;
  }

  readScope(scope = "app") {
    return this.repository.readScope(scope);
  }

  updateScope(scope, patch) {
    return this.repository.updateScope(scope, patch);
  }
}
