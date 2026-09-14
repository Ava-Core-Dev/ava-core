const mysql = require("D:/RootMC Workspace/Web Files/rootmc-api/node_modules/mysql2/promise");

(async () => {
  const c = await mysql.createConnection({
    host: "mysql.shockbyte.hil2.shockbyte.host",
    port: 3306,
    user: "49cc9f4e50-gen3-admin",
    password: "6ba274e22a155a82",
    database: "49cc9f4e50-gen3",
    ssl: false,
  });
  const [pt] = await c.query(
    `SELECT uuid, scope, username, seconds FROM root_rootmc_playtime
     WHERE LOWER(username) LIKE '%alex%' OR LOWER(username) LIKE '%melee%'
     ORDER BY username, scope`
  );
  console.log("player scopes", JSON.stringify(pt, null, 2));
  const [star] = await c.query(
    "SELECT COUNT(*) AS c, COALESCE(SUM(seconds),0) AS s FROM root_rootmc_playtime WHERE scope = ?"
  , ["*"]);
  console.log("star totals", star[0]);
  const [sample] = await c.query(
    "SELECT username, seconds FROM root_rootmc_playtime WHERE scope = ? ORDER BY seconds DESC LIMIT 5",
    ["*"]
  );
  console.log("top *", sample);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
