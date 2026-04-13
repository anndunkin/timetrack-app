import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, copyFile, mkdir } from "fs/promises";
import { createRequire } from "module";
import path from "path";

// Packages to bundle inline (rather than leave as external require() calls).
// sql.js must be bundled so its JS is included in the server bundle.
const allowlist = [
  "sql.js",
  "axios",
  "cors",
  "date-fns",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // Copy the sql.js WASM file next to the server bundle so it can be
  // loaded at runtime without needing node_modules.
  await mkdir("dist", { recursive: true });
  try {
    const req = createRequire(import.meta.url);
    // require.resolve("sql.js") → .../node_modules/sql.js/dist/sql-wasm.js
    // path.dirname(...)         → .../node_modules/sql.js/dist
    const sqlJsEntry = req.resolve("sql.js");
    const sqlJsDistDir = path.dirname(sqlJsEntry);
    const wasmSrc = path.join(sqlJsDistDir, "sql-wasm.wasm");
    const wasmDest = path.join("dist", "sql-wasm.wasm");
    await copyFile(wasmSrc, wasmDest);
    console.log(`copied ${wasmSrc} → ${wasmDest}`);
  } catch (e) {
    console.error("Could not copy sql-wasm.wasm:", e);
    process.exit(1); // Fail the build — the app won't work without the WASM
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
