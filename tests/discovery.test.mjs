// 发现层单测：内存 mock fs。
import test from "node:test";
import assert from "node:assert/strict";
import { createDiscovery } from "../driver/discovery.mjs";
import path from "node:path";

function memFs(files = new Set()) {
  return {
    async access(p) { if (!files.has(p)) throw new Error("ENOENT"); },
    async readdir(dir) {
      const out = new Set();
      for (const f of files) {
        if (path.dirname(f) === dir) out.add(path.basename(f));
      }
      if (out.size === 0 && !files.has(dir)) throw new Error("ENOENT");
      return [...out];
    },
    async stat(p) {
      if (!files.has(p)) throw new Error("ENOENT");
      return { size: 100 };
    },
    async readFile(p) {
      if (!files.has(p)) throw new Error("ENOENT");
      return "{}";
    }
  };
}

// 与实现相同的构造方式（win32 上 path.join 用反斜杠；Linux 测试环境两边构造一致即可对拍）
const WIN = path.join("C:\\Users\\u\\AppData\\Roaming", "ClassIsland", "Data");
const winProfile = path.join(WIN, "Profiles");

test("配置指定优先", async () => {
  const fs = memFs(new Set([winProfile, path.join(winProfile, "Default.json")]));
  const d = createDiscovery({ config: { dataDir: WIN }, env: {}, platform: "win32", fs });
  const r = await d.discover();
  assert.equal(r.ok, true);
  assert.equal(r.source, "config");
  assert.equal(r.profilesDir, winProfile);
});

test("Windows 常见路径兜底（APPDATA 环境变量）", async () => {
  const fs = memFs(new Set([winProfile, path.join(winProfile, "Default.json")]));
  const d = createDiscovery({ config: {}, env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, platform: "win32", fs });
  const r = await d.discover();
  assert.equal(r.ok, true);
  assert.equal(r.source, "appdata");
  assert.equal(r.profilesDir, winProfile);
});

test("找不到时给出候选与建议", async () => {
  const fs = memFs(new Set());
  const d = createDiscovery({ config: {}, env: { APPDATA: "C:\\nope" }, platform: "win32", fs });
  const r = await d.discover();
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.candidates));
  assert.ok(r.detail);
});

test("listProfiles 排除 _management-profile，readSelectedProfile 读 Settings", async () => {
  const files = new Set([
    winProfile,
    path.join(winProfile, "Default.json"),
    path.join(winProfile, "Exam.json"),
    path.join(winProfile, "_management-profile.json")
  ]);
  const fs = memFs(files);
  const fs2 = { ...fs, async readFile(p) { return JSON.stringify({ SelectedProfile: "Exam.json" }); } };
  const d = createDiscovery({ config: { dataDir: WIN }, env: {}, platform: "win32", fs: fs2 });
  const list = await d.listProfiles(winProfile);
  assert.deepEqual(list.map((x) => x.file).sort(), ["Default.json", "Exam.json"]);
  const sel = await d.readSelectedProfile(WIN);
  assert.equal(sel.ok, true);
  assert.equal(sel.selectedProfile, "Exam.json");
});
