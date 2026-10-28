// 课表编辑操作（纯数据变换，输入输出都是 Profile 对象）。
// 「临时层换课」完全复刻 ClassIsland ProfileService.CreateTempClassPlan 的文件效果：
//   1. 复制源课表 → IsOverlay=true、Name 加「（临时层）」、OverlaySourceId=源、OverlaySetupTime=now
//   2. Profile.IsOverlayClassPlanEnabled=true、OverlayClassPlanId=新课表
//   3. OrderedSchedules[当天] = {ClassPlanId: 新课表}
// 该机制官方含义：临时层只在当天/次日生效，官方会在跨天后自动清理。
//
// 所有 apply 函数返回 {ok, error?, changed, profile}，不抛异常。

import { randomUUID } from "node:crypto";
import { todayStr } from "./model.mjs";

const dateKey = (d = new Date()) => `${todayStr(d)}T00:00:00`;
const resolveDate = (v) => {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00`;
  if (v instanceof Date) return dateKey(v);
  return dateKey(new Date());
};

function findPlan(p, ref) {
  const plans = p.ClassPlans || (p.ClassPlans = {});
  if (plans[ref]) return ref;
  // 按名字找（精确→包含）
  const exact = Object.entries(plans).find(([, v]) => v.Name === ref);
  if (exact) return exact[0];
  const loose = Object.entries(plans).find(([, v]) => (v.Name || "").includes(ref));
  if (loose) return loose[0];
  return null;
}

function ensureSubject(p, name, { initial = "", teacher = "" } = {}) {
  const subjects = p.Subjects || (p.Subjects = {});
  const hit = Object.entries(subjects).find(([, v]) => v.Name === name);
  if (hit) return { id: hit[0], created: false };
  const id = randomUUID();
  subjects[id] = { Name: name, Initial: initial || name.slice(0, 1), TeacherName: teacher, IsOutDoor: false };
  return { id, created: true };
}

function overlayNowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, "");
}

/** 课表第 N 节（1 起，只数 TimeType=0 的上课时段槽位）换科目。 */
export function applySetClassSubject(p, { plan: planRef, slot, subject, teacher = "", enabled = undefined }) {
  const planId = findPlan(p, planRef);
  if (!planId) return { ok: false, error: `找不到课表：${planRef}`, code: "PLAN_NOT_FOUND" };
  const plan = p.ClassPlans[planId];
  const layout = (p.TimeLayouts || {})[plan.TimeLayoutId];
  if (!layout) return { ok: false, error: `课表 ${plan.Name} 没有关联时间表`, code: "LAYOUT_MISSING" };
  const slots = (layout.Layouts || []).map((x, i) => ({ x, i })).filter(({ x }) => x && x.TimeType === 0);
  if (slot < 1 || slot > slots.length) {
    return { ok: false, error: `节次越界：${slot}（该时间表共 ${slots.length} 个上课时段）`, code: "SLOT_RANGE" };
  }
  const target = slots[slot - 1];
  const classes = plan.Classes || (plan.Classes = []);
  while (classes.length <= target.i) classes.push({ SubjectId: "00000000-0000-0000-0000-000000000000", IsChangedClass: false, IsEnabled: true });
  const ci = classes[target.i] || {};
  if (subject === undefined && enabled === undefined) {
    return { ok: false, error: "subject 与 enabled 至少给一个", code: "EMPTY_OP" };
  }
  if (subject !== undefined) {
    const s = ensureSubject(p, subject, { teacher });
    ci.SubjectId = s.id;
    ci.IsChangedClass = true; // 与官方「临时换课」同样标记已换课
  }
  if (enabled !== undefined) ci.IsEnabled = enabled === true;
  classes[target.i] = ci;
  return { ok: true, changed: true, profile: p, detail: { planId, planName: plan.Name, slot, subject, subjectCreated: subject !== undefined ? undefined : false } };
}

/** 启用/停用课表。 */
export function applySetPlanEnabled(p, { plan: planRef, enabled }) {
  const planId = findPlan(p, planRef);
  if (!planId) return { ok: false, error: `找不到课表：${planRef}`, code: "PLAN_NOT_FOUND" };
  p.ClassPlans[planId].IsEnabled = enabled === true;
  return { ok: true, changed: true, profile: p };
}

/** 新建科目。 */
export function applyAddSubject(p, { name, initial = "", teacher = "" }) {
  if (!name) return { ok: false, error: "科目名不能为空", code: "NAME_EMPTY" };
  const s = ensureSubject(p, name, { initial, teacher });
  if (!s.created) return { ok: false, error: `科目已存在：${name}`, code: "SUBJECT_EXISTS" };
  return { ok: true, changed: true, profile: p };
}

/** 重命名科目（联动所有课表引用）。 */
export function applyRenameSubject(p, { from, to }) {
  const subjects = p.Subjects || {};
  const hit = Object.entries(subjects).find(([, v]) => v.Name === from);
  if (!hit) return { ok: false, error: `找不到科目：${from}`, code: "SUBJECT_NOT_FOUND" };
  hit[1].Name = to;
  return { ok: true, changed: true, profile: p };
}

/** 复制课表（换课表群/备份用）。 */
export function applyDuplicatePlan(p, { plan: planRef, from, name }) {
  const planId = findPlan(p, planRef ?? from);
  if (!planId) return { ok: false, error: `找不到课表：${planRef}`, code: "PLAN_NOT_FOUND" };
  const src = p.ClassPlans[planId];
  const id = randomUUID();
  const copy = JSON.parse(JSON.stringify(src));
  copy.Name = name || `${src.Name}（副本）`;
  copy.IsOverlay = false;
  copy.OverlaySourceId = null;
  p.ClassPlans[id] = copy;
  return { ok: true, changed: true, profile: p, detail: { newPlanId: id, name: copy.Name } };
}

/** 重命名课表。 */
export function applyRenamePlan(p, { plan: planRef, from, to, name }) {
  const newName = to ?? name;
  const planId = findPlan(p, planRef ?? from);
  if (!planId) return { ok: false, error: `找不到课表：${planRef}`, code: "PLAN_NOT_FOUND" };
  p.ClassPlans[planId].Name = newName;
  return { ok: true, changed: true, profile: p };
}

/** 清空临时层（复刻 ClearTempClassPlan：删临时课表+关开关+删当天预定）。 */
export function applyClearTempPlan(p, { date = null, now = null } = {}) {
  const dayKey = resolveDate(date ?? now);
  const overlayId = p.OverlayClassPlanId;
  const changed = [];
  if (overlayId && p.ClassPlans?.[overlayId]?.IsOverlay === true) {
    delete p.ClassPlans[overlayId];
    changed.push(`删除临时层课表 ${overlayId}`);
  }
  p.IsOverlayClassPlanEnabled = false;
  p.OverlayClassPlanId = null;
  if (p.OrderedSchedules) {
    for (const key of Object.keys(p.OrderedSchedules)) {
      if (p.OrderedSchedules[key]?.ClassPlanId === overlayId) {
        delete p.OrderedSchedules[key];
        changed.push(`移除预定 ${key}`);
      }
    }
  }
  return { ok: true, changed: changed.length > 0, profile: p, detail: { removed: changed } };
}

/** 临时层换课（复刻 CreateTempClassPlan 文件效果）；changes 对临时层逐节修改。 */
export function applySetTempPlan(p, { plan: planRef, date = null, now = null, changes = [] }) {
  const dayKey = resolveDate(date ?? now);
  const planId = findPlan(p, planRef);
  if (!planId) return { ok: false, error: `找不到课表：${planRef}`, code: "PLAN_NOT_FOUND" };
  let overlayId;
  const src = p.ClassPlans[planId];
  if (src.IsOverlay === true) {
    if (p.IsOverlayClassPlanEnabled && p.OverlayClassPlanId && p.OverlayClassPlanId !== planId) {
      return { ok: false, error: "已存在别的临时层课表，请先 clearTempPlan", code: "TEMP_EXISTS" };
    }
    overlayId = planId;
  } else {
    if (p.IsOverlayClassPlanEnabled && p.OverlayClassPlanId) {
      return { ok: false, error: "已存在临时层课表，请先 clearTempPlan", code: "TEMP_EXISTS" };
    }
    overlayId = randomUUID();
    const copy = JSON.parse(JSON.stringify(src));
    copy.IsOverlay = true;
    copy.OverlaySourceId = planId;
    copy.Name = `${src.Name}（临时层）`;
    copy.OverlaySetupTime = overlayNowIso();
    copy.IsEnabled = true;
    p.ClassPlans[overlayId] = copy;
    p.IsOverlayClassPlanEnabled = true;
    p.OverlayClassPlanId = overlayId;
  }
  p.OrderedSchedules = p.OrderedSchedules || {};
  p.OrderedSchedules[dayKey] = { ClassPlanId: overlayId };
  // 对临时层逐节修改（复用 setClassSubject 的槽位语义）
  let appliedChanges = 0;
  if (Array.isArray(changes) && changes.length > 0) {
    for (const ch of changes) {
      const r = applySetClassSubject(p, {
        plan: overlayId,
        slot: ch.slot ?? ch.classIndex ?? ch.index,
        subject: ch.subject,
        enabled: ch.enabled
      });
      if (!r.ok) return { ok: false, error: `[setTempPlan.changes] ${r.error}`, code: r.code };
      appliedChanges++;
    }
  }
  return { ok: true, changed: true, profile: p, detail: { overlayId, sourcePlanId: src.IsOverlay === true ? src.OverlaySourceId : planId, sourceName: src.Name, dateKey: dayKey, appliedChanges } };
}

/** 预定某天用某课表（OrderedSchedules，非临时层）。 */
export function applyOrderPlan(p, { plan: planRef, date }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return { ok: false, error: `date 需为 yyyy-mm-dd：${date}`, code: "DATE_FORMAT" };
  const planId = findPlan(p, planRef);
  if (!planId) return { ok: false, error: `找不到课表：${planRef}`, code: "PLAN_NOT_FOUND" };
  p.OrderedSchedules = p.OrderedSchedules || {};
  p.OrderedSchedules[`${date}T00:00:00`] = { ClassPlanId: planId };
  return { ok: true, changed: true, profile: p };
}

/** 操作分发表。 */
export const OPERATIONS = {
  setClassSubject: applySetClassSubject,
  setPlanEnabled: applySetPlanEnabled,
  addSubject: applyAddSubject,
  renameSubject: applyRenameSubject,
  duplicatePlan: applyDuplicatePlan,
  renamePlan: applyRenamePlan,
  setTempPlan: applySetTempPlan,
  clearTempPlan: applyClearTempPlan,
  orderPlan: applyOrderPlan
};

/** 依序应用操作列表；第一个失败即停（fail-closed）。 */
export function applyOperations(profile, ops) {
  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, error: "operations 不能为空", code: "OPS_EMPTY" };
  }
  let p = JSON.parse(JSON.stringify(profile)); // 工作副本
  const applied = [];
  for (const op of ops) {
    const fn = OPERATIONS[op?.op];
    if (!fn) return { ok: false, error: `未知操作：${op?.op}`, code: "OP_UNKNOWN", applied };
    const r = fn(p, op);
    if (!r.ok) return { ok: false, error: `[${op.op}] ${r.error}`, code: r.code, applied };
    if (r.changed) applied.push(op.op);
    p = r.profile;
  }
  return { ok: true, changed: applied.length > 0, profile: p, applied };
}
