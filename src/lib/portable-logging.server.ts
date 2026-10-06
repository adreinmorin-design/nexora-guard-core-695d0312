import { AsyncLocalStorage } from "node:async_hooks";

export const requestLogContext = new AsyncLocalStorage<{ correlationId: string; sha: string }>();

export function installPortableErrorLogging(): void {
  const output = console.error.bind(console);
  // Existing SSR error capture still records errors internally. Never serialize
  // arbitrary errors, their causes or upstream bodies into production logs.
  console.error = () => {
    output(JSON.stringify({ event: "nexora_server_error", ...requestLogContext.getStore() }));
  };
}
