// ClassIsland Profile 数据模型：解析校验、紧凑视图、星期/轮换推导。
// 字段依据 ClassIsland.Shared/Models/Profile/*.cs（1.7 与 2.x 同构）。
// JSON 为 PascalCase（System.Text.Json 默认策略）。

export const DEFAULT_GROUP_GUID = "acaf4ef0-e261-4262-b941-34ea93cb4369";
export const GLOBAL_GROUP_GUID = "00000000-0000-0000-0000-000000000000";

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function weekdayName(n) {
  return WEEKDAY_NAMES[n] ?? `周?${n}`;
}

/** 深校验一个 Profile 对象（防脏数据写坏 ClassIsland）。返回 {ok, errors[]}。 */
export function validateProfile(p) {
  const errors = [];
  const push = (m) => errors.push(m);
  if (!p || typeof p !== "object") return { ok: false, errors: ["不是对象"] };
  if (typeof p.Id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(p.Id)) push("Id 缺失或不是 GUID");
  for (const [field, isDict] of [
    ["TimeLayouts", true], ["ClassPlans", true], ["Subjects", true], ["ClassPlanGroups", true]
  ]) {
    const v = p[field];
    if (v === undefined || v === null) continue; // 旧档案可能缺字段，允许（不写入即不破坏）
    if (typeof v !== "object" || Array.isArray(v)) { push(`${field} 不是字典`); continue; }
    for (const [guid, item] of Object.entries(v)) {
      if (!/^[0-9a-fA-F-]{36}$/.test(guid)) push(`${field} 键不是 GUID：${guid}`);
      if (!item || typeof item !== "object") push(`${field}[${guid}] 不是对象`);
    }
  }
  if (p.OrderedSchedules && typeof p.OrderedSchedules !== "object") push("OrderedSchedules 不是字典");
  if (p.IsOverlayClassPlanEnabled && typeof p.OverlayClassPlanId !== "string") {
    push("临时层已启用但 OverlayClassPlanId 缺失");
  }
  return { ok: errors.length === 0, errors };
}

/** 紧凑档案摘要（Agent 可读）。 */
export function summarizeProfile(p, { currentPath } = {}) {
  const plans = p.ClassPlans || {};
  const layouts = p.TimeLayouts || {};
  const subjects = p.Subjects || {};
  const groups = p.ClassPlanGroups || {};
  const subjectName = (id) => subjects[id]?.Name || "(未命名科目)";
  const planItems = Object.entries(plans).map(([guid, plan]) => ({
    id: guid,
    name: plan.Name || "(未命名课表)",
    timeLayout: layouts[plan.TimeLayoutId]?.Name || plan.TimeLayoutId,
    weekday: weekdayName((plan.TimeRule?.WeekDay ?? 7) % 7),
    weekCountDiv: plan.TimeRule?.WeekCountDiv ?? 0,
    classes: (plan.Classes || []).filter((c) => c && c.IsEnabled !== false).length,
    isOverlay: plan.IsOverlay === true,
    overlaySource: plan.OverlaySourceId || null,
    enabled: plan.IsEnabled !== false,
    group: groups[plan.AssociatedGroup || DEFAULT_GROUP_GUID]?.Name || plan.AssociatedGroup || "默认课表群"
  }));
  const overlay = p.IsOverlayClassPlanEnabled === true
    ? { planId: p.OverlayClassPlanId, name: plans[p.OverlayClassPlanId]?.Name || p.OverlayClassPlanId, setupTime: plans[p.OverlayClassPlanId]?.OverlaySetupTime || null }
    : null;
  return {
    file: currentPath || null,
    id: p.Id,
    name: p.Name || "(未命名档案)",
    currentGroup: groups[p.SelectedClassPlanGroupId || DEFAULT_GROUP_GUID]?.Name || p.SelectedClassPlanGroupId || "默认课表群",
    counts: { classPlans: planItems.length, timeLayouts: Object.keys(layouts).length, subjects: Object.keys(subjects).length, groups: Object.keys(groups).length },
    overlayClassPlan: overlay,
    orderedSchedules: Object.keys(p.OrderedSchedules || {}).sort(),
    classPlans: planItems,
    subjects: Object.entries(subjects).map(([guid, s]) => ({
      id: guid, name: s.Name || "", initial: s.Initial || "", teacher: s.TeacherName || ""
    })),
    timeLayouts: Object.entries(layouts).map(([guid, t]) => {
      const items = t.Layouts || [];
      const breakdown = items.filter((x) => x && x.TimeType === 0).length;
      return {
        id: guid, name: t.Name || "(未命名时间表)", items: items.length, classSlots: breakdown,
        isOverlay: t.IsOverlay === true
      };
    })
  };
}

/**
 * 推导「某天会上什么课」：临时层优先，再 OrderedSchedules 预定，再按 TimeRule 匹配。
 * 返回 {source, plan} 描述对象。
 */
export function resolvePlanForDate(p, dateStr, { weekCount = null } = {}) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { source: "invalid-date", plan: null };
  const weekday = d.getDay(); // 0=周日
  // ClassIsland TimeRule.WeekDay：0=周日?——查证：ClassIsland 用 DayOfWeek 枚举（0=周日）
  const plans = p.ClassPlans || {};
  // 1) 预定课表（OrderedSchedules 按天覆盖）
  for (const dayKey of Object.keys(p.OrderedSchedules || {})) {
    if (dayKey.startsWith(dateStr)) {
      const planId = p.OrderedSchedules[dayKey]?.ClassPlanId;
      if (plans[planId] && plans[planId].IsOverlay !== true) {
        return { source: `ordered:${dayKey}`, plan: { ...plans[planId], _id: planId } };
      }
    }
  }
  // 2) 按周几 + 轮换匹配（非临时层、已启用、默认群或当前选中群）
  const candidates = [];
  for (const [guid, plan] of Object.entries(plans)) {
    if (plan.IsOverlay === true || plan.IsEnabled === false) continue;
    const wd = plan.TimeRule?.WeekDay;
    if (wd === undefined || wd === null || wd !== weekday) continue;
    const div = plan.TimeRule?.WeekCountDiv ?? 0;
    if (div > 0 && weekCount !== null && weekCount !== undefined && div !== weekCount) continue;
    candidates.push({ ...plan, _id: guid });
  }
  if (candidates.length === 0) return { source: "none", plan: null, weekday: weekdayName(weekday) };
  if (candidates.length === 1) return { source: `weekday:${weekday}`, plan: candidates[0] };
  return { source: "ambiguous", plan: null, candidates: candidates.map((c) => ({ id: c._id, name: c.Name })) };
}

/** 某课表的可读课节序列（科目名+时间）。 */
export function describePlan(p, plan) {
  const layout = (p.TimeLayouts || {})[plan.TimeLayoutId];
  if (!layout) return { error: "课表未关联有效时间表" };
  const slots = (layout.Layouts || []).filter((x) => x && x.TimeType === 0);
  const classes = plan.Classes || [];
  const rows = slots.map((slot, i) => {
    const ci = classes[i];
    const subjectId = ci?.SubjectId;
    const subject = (p.Subjects || {})[subjectId];
    return {
      index: i + 1,
      start: normalizeTimeSpan(slot.StartTime),
      end: normalizeTimeSpan(slot.EndTime),
      subject: subject?.Name || "(空)",
      changed: ci?.IsChangedClass === true,
      disabled: ci?.IsEnabled === false
    };
  });
  return { planId: plan._id || null, name: plan.Name, layout: layout.Name, rows };
}

/** ClassIsland TimeSpan JSON（ISO 8601 "c" 格式 hh:mm:ss）→ "hh:mm" 展示。 */
export function normalizeTimeSpan(v) {
  if (typeof v !== "string" || !v) return null;
  const m = v.match(/^(\d+):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (!m) return v;
  const h = String(parseInt(m[1], 10)).padStart(2, "0");
  return `${h}:${m[2]}`;
}

/** 今天（本地时区）的 yyyy-mm-dd。 */
export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
