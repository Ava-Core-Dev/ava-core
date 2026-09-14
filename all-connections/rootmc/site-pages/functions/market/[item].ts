/** Legacy /market/ITEM paths → /market/?item=ITEM */
export const onRequest: PagesFunction = async (context) => {
  const raw = context.params.item;
  const item = Array.isArray(raw) ? raw[0] : String(raw || "");
  if (!item || item.toLowerCase() === "index.html" || item.startsWith(":")) {
    return context.next();
  }
  const url = new URL(context.request.url);
  url.pathname = "/market/";
  url.search = "";
  try {
    url.searchParams.set(
      "item",
      decodeURIComponent(item).trim().toUpperCase().replace(/\s+/g, "_"),
    );
  } catch {
    url.searchParams.set("item", item.trim().toUpperCase().replace(/\s+/g, "_"));
  }
  return Response.redirect(url.toString(), 301);
};
