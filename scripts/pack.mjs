// 打包：阶段目录 → zip → download/。
// 用法：node scripts/pack.mjs [version]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = process.argv[2] || JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const stage = path.join(root, "pack-stage", "classisland");
const dist = path.resolve(root, "../../download");
const name = `classisland-${version}.zip`;

fs.rmSync(path.join(root, "pack-stage"), { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

for (const d of ["driver", "skills", "settings", "docs"]) {
  const src = path.join(root, d);
  if (!fs.existsSync(src)) throw new Error(`缺少目录：${d}`);
  fs.cpSync(src, path.join(stage, d), { recursive: true });
}
for (const f of ["main.mjs", "secagent-plugin.json", "package.json", "README.md"]) {
  fs.copyFileSync(path.join(root, f), path.join(stage, f));
}
// 资产目录（图标）可选
const assets = path.join(root, "assets");
if (fs.existsSync(assets)) fs.cpSync(assets, path.join(stage, "assets"), { recursive: true });

fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, name);
if (fs.existsSync(out)) fs.rmSync(out);
execFileSync("zip", ["-r", "-q", out, "."], { cwd: stage });

const sha = createHash("sha256").update(fs.readFileSync(out)).digest("hex");
console.log(JSON.stringify({ ok: true, file: out, bytes: fs.statSync(out).size, sha256: sha }, null, 2));
