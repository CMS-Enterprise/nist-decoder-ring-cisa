/**
 * Types the value the integration globalSetup publishes through vitest's
 * provide/inject channel, so `inject("databaseUrl")` is a `string` in tests
 * rather than `unknown`.
 */
declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export {};
