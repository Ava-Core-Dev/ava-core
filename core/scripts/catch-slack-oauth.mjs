/**
 * Tiny catcher for Slack OAuth redirect to https://localhost (or http://127.0.0.1).
 * Prefer: paste the full localhost/?code=... URL into finish-slack-install.mjs
 *
 * Usage: node scripts/catch-slack-oauth.mjs
 * Then re-run Allow, or paste code from the address bar.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.AVA_OAUTH_CATCH_PORT || 80);

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", "http://localhost");
    const code = u.searchParams.get("code");
    if (!code) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<p>No code — waiting for Slack redirect.</p>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h1>Got Slack code</h1><p>Exchanging… you can close this tab.</p>",
    );
    console.log("code received, exchanging…");
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "finish-slack-install.mjs"), code],
      { stdio: "inherit", cwd: path.join(__dirname, "..") },
    );
    child.on("exit", (c) => {
      server.close();
      process.exit(c || 0);
    });
  } catch (err) {
    res.writeHead(500);
    res.end(String(err.message));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Listening http://127.0.0.1:${PORT}/ for Slack ?code=`);
  console.log(
    "Note: redirect is https://localhost — if browser used https, paste the full URL instead:",
  );
  console.log('  node scripts/finish-slack-install.mjs "https://localhost/?code=..."');
});
