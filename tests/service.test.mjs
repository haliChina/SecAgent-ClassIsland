// 总装服务层单测：mock discovery/store + 模拟平台，验证分流纪律。
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createService } from "../driver/service.mjs";

const DATA = "/data";
const PROFILES = path.join(DATA, "Profiles");

function makeEnv({ platform = "linux", profileJson = defaultProfileJson, settingsJson = { SelectedProfile: "Default.json" }, running = false } = {}) {
  const files = new Map(Object.entries({
    [path.join(PROFILES, "Default.json")]: JSON.stringify(profileJson()),
    [path.join(PROFILES, "Exam.json")]: JSON.stringify(profileJson("Exam")),
    [path.join(DATA, "Config", "Settings.json")]: JSON.stringify(settingsJson)
  }));
  const discovery = {
    async discover() { return { ok: true, dataRoot: DATA, profilesDir: PROFILES, source: "test" }; },
    async listProfiles() { return [{ file: "Default.json", path: path.join(PROFILES, "Default.json") }, { file: "Exam.json", path: path.join(PROFILES, "Exam.json") }]; },
    async readSelectedProfile() { return { ok: true, selectedProfile: settingsJson.SelectedProfile || "Default.json" }; }
  };
  const store = {
    async readProfile(f) { const t = files.get(f); return t ? { ok: true, data: JSON.parse(t), file: f } : { ok: false, error: "ENOENT", code: "READ_FAIL" }; },
    async writeProfile(f, data) { files.set(f, JSON.stringify(data)); return { ok: true, backup: f + ".bak", file: f }; },
    async readSelected(f) { return { ok: true, settings: settingsJson, selected: settingsJson.SelectedProfile }; },
    async writeSelected(f, next) { settingsJson.SelectedProfile = next; files.set(f, JSON.stringify(settingsJson)); return { ok: true, settingsFile: f }; }
  };
  const service = createService({
    config: { dataDir: DATA },
    discovery, store,
    platform,
    now: () => new Date(2026, 9, 26, 10, 0, 0), // 2026-10-26 周一
    logger: () => {}
  });
  const origProbe = service.probeRunning.bind(service);
  if (platform === "win32") {
    // 替换探测（service 内部闭包拿不到，这里从外部行为侧面控制：仅测非 win 路径）
  }
  return { service, files, discovery, store };
}

function defaultProfileJson(name = "Default") {
  return {
    Id: "aaaaaaaa-1111-2222-3333-444444444444",
    Name: name,
    TimeLayouts: {
      "11111111-1111-1111-1111-111111111111": {
        Name: "全天",
        Layouts: [{ StartTime: "08:00:00", EndTime: "08:45:00", TimeType: 0 }]
      }
    },
    ClassPlans: {
      "22222222-2222-2222-2222-222222222222": {
        Name: "周一",
        TimeLayoutId: "11111111-1111-1111-1111-111111111111",
        TimeRule: { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 2 },
        Classes: [{ SubjectId: "33333333-3333-3333-3333-333333333333" }]
      }
    },
    Subjects: { "33333333-3333-3333-3333-333333333333": { Name: "数学", Initial: "数" } }
  };
}

test("read：默认读当前档案 + day 视图（周一）", async () => {
  const { service } = makeEnv();
  const r = await service.read({ day: "2026-10-26" });
  assert.equal(r.ok, true);
  assert.equal(r.profile, "Default.json");
  assert.equal(r.view.file, "Default.json");
  assert.equal(r.day.name, "周一");
  assert.match(r.day.source, /^weekday:/);
  assert.equal(r.day.rows[0].subject, "数学");
});

test("edit（非 Windows）：文件通道直写并回读验证", async () => {
  const { service } = makeEnv({ platform: "linux" });
  const r = await service.edit({ operations: [{ op: "setClassSubject", plan: "周一", slot: 1, subject: "物理" }] });
  assert.equal(r.ok, true);
  assert.equal(r.file, path.join(PROFILES, "Default.json"));
  assert.deepEqual(r.applied, ["setClassSubject"]);
  const v = await service.read({ day: "2026-10-26" });
  assert.equal(v.day.rows[0].subject, "物理");
});

test("edit：坏 operations 原子失败（文件不动）", async () => {
  const { service, files } = makeEnv({ platform: "linux" });
  const before = files.get(path.join(PROFILES, "Default.json"));
  const r = await service.edit({ operations: [{ op: "setClassSubject", plan: "周一", slot: 99, subject: "化学" }] });
  assert.equal(r.ok, false);
  assert.equal(files.get(path.join(PROFILES, "Default.json")), before);
});

test("switchProfile（非 Windows）：写 Settings.json", async () => {
  const { service } = makeEnv({ platform: "linux" });
  const r = await service.switchProfile({ to: "Exam.json" });
  assert.equal(r.ok, true);
  assert.equal(r.profile, "Exam.json");
  assert.equal(r.via, "file");
  const after = await service.read({});
  assert.equal(after.profile, "Exam.json");
});

test("switchProfile：目标档案必须存在", async () => {
  const { service } = makeEnv({ platform: "linux" });
  const r = await service.switchProfile({ to: "Nope.json" });
  assert.equal(r.ok, false);
  assert.match(r.error, /不存在/);
});

test("status：非 Windows 汇总（目录/档案/运行探测跳过）", async () => {
  const { service } = makeEnv({ platform: "linux" });
  const r = await service.status();
  assert.equal(r.ok, true);
  assert.equal(r.dataRoot, "/data");
  assert.equal(r.running, null); // 非 win 未探测
  assert.equal(r.ipc, null);
  assert.equal(r.currentProfile, "Default.json");
  assert.ok(Array.isArray(r.profiles) && r.profiles.length === 2);
});
