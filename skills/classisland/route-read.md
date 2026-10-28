# 读课表与定位

## 什么时候读

- 回答「今天/明天/周三有什么课」：`classisland_read({day:"2026-10-29"})`
- 编辑前定位：必须先 read 拿到准确的课表名（plan）、科目名（subject）、节次（index）
- 编辑后验证：再 read 一次，比对目标行已变更

## 返回结构

`classisland_read` 返回：
- `profiles`：档案列表（file/名字/当前档案标记/临时层状态）
- `profile.detail`：紧凑视图（subjects 科目、layouts 时间表、plans 课表：名称/星期/单双周/启用/临时层标记、temp 当前临时层）
- `profile.day`：请求 day 时返回该天课表行（第几节/起止时间/科目/换课标记/停用标记）

## 定位规则

1. **节次**：day 视图的 `index` 字段（1 起算）= 用户说的「第 N 节」。注意课间休息行没有科目，用户口中的「第 3 节」默认指 day 视图中第 3 个 `kind=上课` 的行——数上课行，不是数所有行。
2. **课表名**：plans 列表里 `Name` 含「（临时层）」的是临时层（overlay），正常编辑目标是非临时层课表；setTempPlan 会自动建临时层。
3. **星期**：plan 的 WeekDay 0=周日 1=周一…6=周六；用户说「周三的课表」→ WeekDay=3 的 plan。
4. **科目**：setClassSubject 的 `subject` 直接传科目名（不存在会自动创建，initial 取首字）。
5. **单双周**：WeekCountDiv=0 不轮换；>0 时第 N 周生效（总周期 WeekCountDivTotal）。「这周的单周课」类需求先看 plans 的轮换字段再选择目标。

## 今天「实际在上什么课」

ClassIsland 的实际显示 = 临时层（overlay）优先 > OrderedSchedules 预定 > 星期规则。read 返回的 `detail.temp` 有临时层时，当天以临时层为准；向用户解释换课时说明这一点。
