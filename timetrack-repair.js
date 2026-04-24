/**
 * TimeTrack DB Repair Script
 *
 * Fixes existing time entries where department_ids is '[]' (empty) by
 * back-filling it from the legacy department_id column.
 *
 * Usage — run from the timetracker-electron folder:
 *   node timetrack-repair.js
 *
 * Or pass an explicit path to your database:
 *   node timetrack-repair.js "C:\Users\YourName\AppData\Roaming\TimeTrack\data\timetracker.db"
 */

const path = require("path");
const fs   = require("fs");

// ── Locate the database ───────────────────────────────────────────────────────
let dbPath = process.argv[2];
if (!dbPath) {
  const appData = process.env.APPDATA || process.env.HOME;
  dbPath = path.join(appData, "TimeTrack", "data", "timetracker.db");
}
dbPath = path.resolve(dbPath);

if (!fs.existsSync(dbPath)) {
  console.error("ERROR: Database not found at:", dbPath);
  console.error("Pass the path as argument:  node timetrack-repair.js \"C:\\path\\to\\timetracker.db\"");
  process.exit(1);
}
console.log("Database:", dbPath);

// ── Locate sql.js relative to this script ────────────────────────────────────
const scriptDir = __dirname;  // folder this .js file lives in
const wasmDir   = path.join(scriptDir, "app", "dist");
const sqlJsDir  = path.join(scriptDir, "app", "node_modules", "sql.js");

if (!fs.existsSync(sqlJsDir)) {
  console.error("ERROR: Could not find sql.js at:", sqlJsDir);
  console.error("Make sure you are running this script from the timetracker-electron folder");
  console.error("and that you have run  npm run build-app  at least once.");
  process.exit(1);
}

const initSqlJs = require(sqlJsDir);

initSqlJs({ locateFile: f => path.join(wasmDir, f) }).then(SQL => {
  // ── Open the database ─────────────────────────────────────────────────────
  const buf = fs.readFileSync(dbPath);
  const db  = new SQL.Database(buf);

  // ── Check current state ───────────────────────────────────────────────────
  const before = db.exec(
    "SELECT COUNT(*) AS n FROM time_entries WHERE department_ids = '[]'"
  );
  const emptyCount = Number(before[0]?.values[0][0] ?? 0);
  const total = Number(
    (db.exec("SELECT COUNT(*) FROM time_entries")[0]?.values[0][0]) ?? 0
  );
  console.log(`Total time entries  : ${total}`);
  console.log(`Need repair         : ${emptyCount}`);

  if (emptyCount === 0) {
    console.log("\nNothing to fix — all entries already have department_ids populated.");
    db.close();
    return;
  }

  // ── Back up original file ─────────────────────────────────────────────────
  const backupPath = dbPath + ".bak";
  fs.copyFileSync(dbPath, backupPath);
  console.log(`Backup saved to     : ${backupPath}`);

  // ── Run the back-fill ─────────────────────────────────────────────────────
  db.run(
    "UPDATE time_entries" +
    "  SET department_ids = json_array(department_id)" +
    " WHERE department_ids = '[]' AND department_id IS NOT NULL"
  );

  // ── Verify ────────────────────────────────────────────────────────────────
  const after = db.exec(
    "SELECT COUNT(*) AS n FROM time_entries WHERE department_ids = '[]'"
  );
  const stillEmpty = Number(after[0]?.values[0][0] ?? 0);
  const fixed = emptyCount - stillEmpty;
  console.log(`Fixed               : ${fixed} rows`);

  if (stillEmpty > 0) {
    console.warn(`WARNING: ${stillEmpty} rows still empty (department_id may be NULL on those rows).`);
  }

  // ── Write repaired DB back to disk ────────────────────────────────────────
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  db.close();

  console.log("\nDatabase updated successfully.");
  console.log("Relaunch TimeTrack — all entries will now show correctly in the weekly view.");

}).catch(err => {
  console.error("ERROR:", err.message || err);
  process.exit(1);
});
