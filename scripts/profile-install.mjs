/**
 * Profile packaged install footprint (why install feels slow).
 * Run: node scripts/profile-install.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "apps", "desktop", "release");
const unpacked = path.join(release, "win-unpacked");
const resources = path.join(unpacked, "resources");

function walk(dir, acc = { files: 0, bytes: 0, byExt: {}, smallFiles: 0 }) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, acc);
    else {
      acc.files += 1;
      acc.bytes += st.size;
      const ext = path.extname(name).toLowerCase() || "(none)";
      acc.byExt[ext] = (acc.byExt[ext] || 0) + 1;
      if (st.size < 4096) acc.smallFiles += 1;
    }
  }
  return acc;
}

function mb(n) {
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

console.log("=== LOLCallout install profile ===\n");

const installers = [
  "LOLCallout-Setup-0.5.7.exe",
  "LOLCallout.exe",
].map((n) => path.join(release, n));

for (const f of installers) {
  if (fs.existsSync(f)) {
    const st = fs.statSync(f);
    console.log(`Installer: ${path.basename(f)}  ${mb(st.size)}`);
  }
}

if (!fs.existsSync(unpacked)) {
  console.log("\nNo win-unpacked/ — run pack:win first for full tree stats.");
  process.exit(0);
}

const whole = walk(unpacked);
const server = walk(path.join(resources, "server"));
const nm = walk(path.join(resources, "server", "node_modules"));
const ui = walk(path.join(resources, "ui"));
const asar = path.join(resources, "app.asar");

console.log("\n--- Unpacked tree ---");
console.log(`Total: ${whole.files} files, ${mb(whole.bytes)}`);
console.log(`  files < 4KB: ${whole.smallFiles} (${((whole.smallFiles / whole.files) * 100).toFixed(0)}%)`);
console.log(`server/: ${server.files} files, ${mb(server.bytes)}`);
console.log(`  node_modules/: ${nm.files} files, ${mb(nm.bytes)}`);
console.log(`ui/: ${ui.files} files, ${mb(ui.bytes)}`);
if (fs.existsSync(asar)) {
  console.log(`app.asar: ${mb(fs.statSync(asar).size)}`);
}

const topExt = Object.entries(whole.byExt)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12);
console.log("\nTop extensions:");
for (const [ext, n] of topExt) console.log(`  ${ext.padEnd(12)} ${n}`);

console.log(`
--- Why install feels slow (even if download isn't huge) ---
1. NSIS unpacks ${whole.files}+ files (many tiny .js/.map/.ts in node_modules)
2. Windows Defender scans each file on first install
3. Unsigned builds get SmartScreen friction
4. Electron runtime (~100MB class) is fixed cost

--- Why AAA games open fast ---
They stream huge assets AFTER a tiny native boot. They don't unpack
thousands of small modules on every launch.

--- Boot speed tips already applied ---
- UI window starts in parallel with Live Client agent
- Packaged app uses cloud API (no local API spawn in product)
- Boot marks: [boot +Nms] in electron logs

See userData/logs/agent.log after a run for agent timing.
`);
