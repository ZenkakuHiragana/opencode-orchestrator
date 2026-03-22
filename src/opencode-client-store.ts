/**
 * Module-level store for the OpencodeClient instance.
 *
 * The plugin factory in index.ts receives the client via PluginInput
 * and calls setOpencodeClient() to make it available to tools that
 * need to call the OpenCode API directly (e.g. tui.showToast).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setOpencodeClient(client: any): void {
  _client = client;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOpencodeClient(): any {
  return _client;
}
