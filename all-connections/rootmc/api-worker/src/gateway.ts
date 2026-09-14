/** Rewrite legacy BlockNotes API paths to RootMC (removed worker: rootrecord-api-blocknotes). */
export function rewriteRequestForRealmHandlers(request: Request): Request {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/blocknotes" || path.startsWith("/api/blocknotes/")) {
    url.pathname = path.replace(/^\/api\/blocknotes/, "/api/rootmc");
    return new Request(url, request);
  }
  return request;
}
