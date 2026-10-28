// 文件通道单测：原子写（备份/回读/损坏回滚）。
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fsp from "node:fs/promises";
import { createStore } from "../driver/store.mjs";

const SANDBOX = path.resolve("../../../6ae0251727b551de6f60ff75_store-test");
// 注：本测试由仓库根 npm test 运行，工作目录在仓库根；沙盒放项目 tmp 下（会话前缀）

const SB = process.env.STORE_SB || path.join(process.cwd(), ".store-test-sb");

test.before(async () => {
  await fsp.mkdir(SB, { recursive: true });
});
test.after(async () => {
  await fsp.rm(SB, { recursive: true, force: true });
});

function profileJson(name = "Default") {
  return { Id: "aaaaaaaa-1111-2222-3333-444444444444", Name: name, ClassPlans: {}, Subjects: {}, TimeLayouts: {} };
}

test("writeJsonAtomic：写后可读回，备份生成", async () => {
  const store = createStore();
  const file = path.join(SB, "p1.json");
  const w = await store.writeJsonAtomic(file, profileJson("A"));
  assert.equal(w.ok, true);
  const r = await store.readJson(file);
  assert.equal(r.ok, true);
  assert.equal(r.data.Name, "A");
  // 首写无旧文件 → 备份不存在是正确行为
  await assert.rejects(() => fsp.readFile(w.backup, "utf8"), /ENOENT/);
});

test("writeJsonAtomic：二次写备份保留旧内容", async () => {
  const store = createStore();
  const file = path.join(SB, "p2.json");
  await store.writeJsonAtomic(file, profileJson("旧"));
  const w = await store.writeJsonAtomic(file, profileJson("新"));
  assert.equal(w.ok, true);
  const bak = JSON.parse(await fsp.readFile(w.backup, "utf8"));
  assert.equal(bak.Name, "旧");
  const cur = JSON.parse(await fsp.readFile(file, "utf8"));
  assert.equal(cur.Name, "新");
});

test("readJson：损坏 JSON 报 PARSE_FAIL 不抛", async () => {
  const file = path.join(SB, "broken.json");
  await fsp.writeFile(file, "{oops", "utf8");
  const store = createStore();
  const r = await store.readJson(file);
  assert.equal(r.ok, false);
  assert.equal(r.code, "PARSE_FAIL");
});

test("writeSelected：Settings.json 只动 SelectedProfile 字段", async () => {
  const store = createStore();
  const file = path.join(SB, "Settings.json");
  await fsp.writeFile(file, JSON.stringify({ SelectedProfile: "A.json", Language: "zh-CN", SomeBig: { x: 1 } }), "utf8");
  const r = await store.writeSelected(file, "B.json");
  assert.equal(r.ok, true);
  const after = JSON.parse(await fsp.readFile(file, "utf8"));
  assert.equal(after.SelectedProfile, "B.json");
  assert.equal(after.Language, "zh-CN");
  assert.equal(after.SomeBig.x, 1);
});
