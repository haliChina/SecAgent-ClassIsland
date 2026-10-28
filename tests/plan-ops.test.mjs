// 编辑操作单测：setClassSubject / setTempPlan（官方临时层语义）/ orderPlan 等。
import test from "node:test";
import assert from "node:assert/strict";
import { applyOperations } from "../driver/plan-ops.mjs";
import { validateProfile, describePlan } from "../driver/model.mjs";

const layoutGuid = "11111111-1111-1111-1111-111111111111";
const planGuid = "22222222-2222-2222-2222-222222222222";
const mathSubj = "33333333-3333-3333-3333-333333333333";
const physSubj = "44444444-4444-4444-4444-444444444444";

function baseProfile() {
  return {
    Id: "aaaaaaaa-1111-2222-3333-444444444444",
    Name: "Default",
    TimeLayouts: {
      [layoutGuid]: {
        Name: "全天",
        Layouts: [
          { StartTime: "08:00:00", EndTime: "08:45:00", TimeType: 0 },
          { StartTime: "08:45:00", EndTime: "08:55:00", TimeType: 1 },
          { StartTime: "08:55:00", EndTime: "09:40:00", TimeType: 0 },
          { StartTime: "09:40:00", EndTime: "09:50:00", TimeType: 1 },
          { StartTime: "09:50:00", EndTime: "10:35:00", TimeType: 0 }
        ]
      }
    },
    ClassPlans: {
      [planGuid]: {
        Name: "周一",
        TimeLayoutId: layoutGuid,
        TimeRule: { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 2 },
        IsEnabled: true,
        Classes: [
          { SubjectId: mathSubj },
          { SubjectId: mathSubj },
          { SubjectId: mathSubj }
        ]
      }
    },
    Subjects: {
      [mathSubj]: { Name: "数学", Initial: "数" },
      [physSubj]: { Name: "物理", Initial: "物" }
    },
    ClassPlanGroups: {},
    IsOverlayClassPlanEnabled: false,
    OrderedSchedules: {}
  };
}

test("setClassSubject：第 2 节换成物理（新科目自动创建）", () => {
  const p = baseProfile();
  const r = applyOperations(p, [{ op: "setClassSubject", plan: "周一", slot: 2, subject: "物理" }]);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  const plan = r.profile.ClassPlans[planGuid];
  const d = describePlan(r.profile, plan);
  assert.equal(d.rows[2].subject, "物理");
  assert.equal(d.rows[0].subject, "数学");
  const v = validateProfile(r.profile);
  assert.equal(v.ok, true);
});

test("setClassSubject：科目不存在时自动创建（initial 取首字）", () => {
  const p = baseProfile();
  const r = applyOperations(p, [{ op: "setClassSubject", plan: "周一", slot: 3, subject: "自习" }]);
  assert.equal(r.ok, true);
  const created = Object.values(r.profile.Subjects).find((s) => s.Name === "自习");
  assert.ok(created);
  assert.equal(created.Initial, "自");
});

test("setClassSubject：越界/找不到课表报错且不改原对象", () => {
  const p = baseProfile();
  const r1 = applyOperations(p, [{ op: "setClassSubject", plan: "不存在的课表", slot: 1, subject: "物理" }]);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /找不到课表/);
  const r2 = applyOperations(p, [{ op: "setClassSubject", plan: "周一", slot: 99, subject: "物理" }]);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /越界/);
  assert.equal(p.ClassPlans[planGuid].Classes[0].SubjectId, mathSubj); // 原对象未被污染
});

test("setTempPlan：复刻官方临时层（overlay + OrderedSchedules 当天 + 名字标记）", () => {
  const p = baseProfile();
  const before = new Date("2026-10-27T08:00:00");
  const r = applyOperations(p, [{ op: "setTempPlan", plan: "周一", changes: [{ slot: 1, subject: "物理" }], date: "2026-10-27" }]);
  assert.equal(r.ok, true);
  const entry = Object.entries(r.profile.ClassPlans).find(([, c]) => c.IsOverlay === true);
  assert.ok(entry, "应存在临时层课表");
  const [overlayId, overlay] = entry;
  assert.equal(overlay.OverlaySourceId, planGuid);
  assert.equal(overlay.Name, "周一（临时层）");
  assert.equal(r.profile.IsOverlayClassPlanEnabled, true);
  assert.equal(r.profile.OverlayClassPlanId, overlayId);
  assert.deepEqual(r.profile.OrderedSchedules["2026-10-27T00:00:00"], { ClassPlanId: overlayId });
  const d = describePlan(r.profile, overlay);
  assert.equal(d.rows[0].subject, "物理"); // changes 已应用
  assert.equal(d.rows[2].subject, "数学");
  const v = validateProfile(r.profile);
  assert.equal(v.ok, true);
});

test("setTempPlan：已存在临时层时失败（官方幂等语义），提示先 clear", () => {
  const p = baseProfile();
  const r1 = applyOperations(p, [{ op: "setTempPlan", plan: "周一", now: new Date() }]);
  assert.equal(r1.ok, true);
  const r2 = applyOperations(r1.profile, [{ op: "setTempPlan", plan: "周一", now: new Date() }]);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /clearTempPlan/);
});

test("clearTempPlan：清开关/引用/预定/临时层课表本体", () => {
  const p = baseProfile();
  const now = new Date("2026-10-27T08:00:00");
  const r1 = applyOperations(p, [{ op: "setTempPlan", plan: "周一", now }]);
  assert.equal(r1.ok, true);
  const r2 = applyOperations(r1.profile, [{ op: "clearTempPlan" }]);
  assert.equal(r2.ok, true);
  assert.equal(r2.profile.IsOverlayClassPlanEnabled, false);
  assert.equal(r2.profile.OverlayClassPlanId, null);
  assert.equal(Object.values(r2.profile.ClassPlans).some((c) => c.IsOverlay), false);
  assert.deepEqual(r2.profile.OrderedSchedules, {});
});

test("orderPlan：预定某天用某课表（可指定未来日期）", () => {
  const p = baseProfile();
  const r = applyOperations(p, [{ op: "orderPlan", date: "2026-11-02", plan: "周一" }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.profile.OrderedSchedules["2026-11-02T00:00:00"], { ClassPlanId: planGuid });
});

test("applyOperations：原子性——第二个操作失败整组不生效", () => {
  const p = baseProfile();
  const r = applyOperations(p, [
    { op: "setClassSubject", plan: "周一", slot: 1, subject: "物理" },
    { op: "setClassSubject", plan: "周一", slot: 99, subject: "化学" }
  ]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.applied, ["setClassSubject"]); // 已应用的仅作诊断；整组工作副本被丢弃
  // 返回失败时 profile 字段不应被消费；再验证一次原档案未受影响
  assert.equal(p.ClassPlans[planGuid].Classes[0].SubjectId, mathSubj);
});

test("renameSubject / setPlanEnabled / duplicatePlan / renamePlan", () => {
  const p = baseProfile();
  const r = applyOperations(p, [
    { op: "renameSubject", from: "数学", to: "高等数学" },
    { op: "setPlanEnabled", plan: "周一", enabled: false },
    { op: "duplicatePlan", from: "周一", name: "周一(备)" },
    { op: "renamePlan", from: "周一(备)", to: "周一备用" }
  ]);
  assert.equal(r.ok, true);
  assert.equal(Object.values(r.profile.Subjects)[0].Name, "高等数学");
  assert.equal(p.ClassPlans[planGuid].IsEnabled, true); // 原对象未动（baseProfile 本就 true）
  assert.ok(Object.values(r.profile.ClassPlans).some((c) => c.Name === "周一备用"));
});
