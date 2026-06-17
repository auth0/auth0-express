export { InvalidConfigurationError } from '@auth0/auth0-server-js';

export class MissingStoreOptionsError extends Error {
  public code: string = 'missing_store_options_error';

  constructor(message?: string) {
    super(message ?? 'The store options are missing, making it impossible to interact with the store.');
    this.name = 'MissingStoreOptionsError';
  }
}
