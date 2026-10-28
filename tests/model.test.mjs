// 数据模型单测：validateProfile / summarizeProfile / resolvePlanForDate / describePlan。
import test from "node:test";
import assert from "node:assert/strict";
import { validateProfile, summarizeProfile, resolvePlanForDate, describePlan, normalizeTimeSpan, weekdayName, todayStr } from "../driver/model.mjs";

const guidA = "11111111-1111-1111-1111-111111111111";
const guidB = "22222222-2222-2222-2222-222222222222";
const subj = "33333333-3333-3333-3333-333333333333";

function sampleProfile() {
  return {
    Id: "aaaaaaaa-1111-2222-3333-444444444444",
    Name: "Default",
    TimeLayouts: {
      [guidA]: {
        Name: "上午",
        Layouts: [
          { StartTime: "08:00:00", EndTime: "08:45:00", TimeType: 0 },
          { StartTime: "08:45:00", EndTime: "08:55:00", TimeType: 1 },
          { StartTime: "08:55:00", EndTime: "09:40:00", TimeType: 0 }
        ]
      }
    },
    ClassPlans: {
      [guidB]: {
        Name: "周一",
        TimeLayoutId: guidA,
        TimeRule: { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 2 },
        Classes: [{ SubjectId: subj, IsEnabled: true }, null, { SubjectId: subj }]
      }
    },
    Subjects: { [subj]: { Name: "数学", Initial: "数", TeacherName: "张三" } }
  };
}

test("validateProfile：合法档案通过，缺 Id/坏结构失败", () => {
  assert.equal(validateProfile(sampleProfile()).ok, true);
  const bad = sampleProfile();
  delete bad.Id;
  assert.equal(validateProfile(bad).ok, false);
  const bad2 = sampleProfile();
  bad2.ClassPlans = ["x"];
  assert.equal(validateProfile(bad2).ok, false);
  // 实测放宽：IsOverlayClassPlanEnabled=true + Id 空是历史残留（ClassIsland 可容忍）
  const overlay = sampleProfile();
  overlay.IsOverlayClassPlanEnabled = true;
  overlay.OverlayClassPlanId = null;
  const vr = validateProfile(overlay);
  assert.equal(vr.ok, true); // 不再 fail
  assert.equal(vr.warnings.length, 1); // 降为 warning
  const overlayBad = sampleProfile();
  overlayBad.IsOverlayClassPlanEnabled = true;
  overlayBad.OverlayClassPlanId = 12345; // 非字符串仍 fail
  assert.equal(validateProfile(overlayBad).ok, false);
});

test("summarizeProfile：科目/课表/临时层视图", () => {
  const c = summarizeProfile(sampleProfile(), { currentPath: "Default.json" });
  assert.equal(c.file, "Default.json");
  assert.equal(c.subjects.length, 1);
  assert.equal(c.subjects[0].name, "数学");
  assert.equal(c.classPlans.length, 1);
  assert.equal(c.classPlans[0].name, "周一");
  assert.equal(c.classPlans[0].weekday, "周一");
  assert.equal(c.classPlans[0].isOverlay, false);
  assert.equal(c.overlayClassPlan, null);
});

test("resolvePlanForDate：按周几命中；预定优先；无匹配返回 none", () => {
  const p = sampleProfile();
  // 2026-10-26 是周一
  const r = resolvePlanForDate(p, "2026-10-26");
  assert.equal(r.source.startsWith("weekday:"), true);
  assert.equal(r.plan.Name, "周一");
  const none = resolvePlanForDate(p, "2026-10-27"); // 周二
  assert.equal(none.source, "none");
  // 预定覆盖：10-27（周二）指到周一课表
  p.OrderedSchedules = { "2026-10-27T00:00:00": { ClassPlanId: guidB } };
  const ord = resolvePlanForDate(p, "2026-10-27");
  assert.match(ord.source, /^ordered:/);
  assert.equal(ord.plan.Name, "周一");
});

test("describePlan：只列上课行，index=第几节课", () => {
  const p = sampleProfile();
  const plan = p.ClassPlans[guidB];
  plan._id = guidB;
  const d = describePlan(p, plan);
  assert.equal(d.rows.length, 2); // 课间行不进入 rows
  assert.equal(d.rows[0].index, 1);
  assert.equal(d.rows[0].subject, "数学");
  assert.equal(d.rows[1].index, 2);
  assert.equal(d.rows[1].start, "08:55");
});

test("normalizeTimeSpan / weekdayName / todayStr", () => {
  assert.equal(normalizeTimeSpan("08:05:00"), "08:05");
  assert.equal(normalizeTimeSpan("26:30:00"), "26:30");
  assert.equal(normalizeTimeSpan("bad"), "bad");
  assert.equal(normalizeTimeSpan(null), null);
  assert.equal(weekdayName(3), "周三");
  assert.match(todayStr(new Date(2026, 9, 28)), /^2026-10-28$/);
});
