# 编辑课表与临时换课

## classisland_edit 的操作集

operations 是数组，按序应用，任何一个失败则整组不落盘（原子）。

### setClassSubject —— 单节换课
```json
{ "op": "setClassSubject", "plan": "周一", "slot": 3, "subject": "自习" }
```
- `plan`：课表名（read 返回的，可只写包含部分）；`slot`：第几节课（1 起算，只数上课时段，不含课间休息）
- `subject` 不存在的科目自动创建；传空字符串 = 该节清空（无科目）
- 用户说「明天第 3 节数学换物理」→ 确认明天是周几 → 定位该周的课表 → setClassSubject

### setTempPlan —— 临时层换课（整套）
```json
{ "op": "setTempPlan", "source": "周一", "changes": [{ "slot": 3, "subject": "物理" }] }
```
- 复刻官方 CreateTempClassPlan 语义：复制源课表为临时层（名字带「（临时层）」），当天 OrderedSchedules 指向它，**跨天自动失效**（ClassIsland 官方清理逻辑）
- `plan` 缺省报错（先 read 确认今天课表名）；`changes` 的 slot 语义同 setClassSubject
- 已存在临时层时再次 setTempPlan 会失败（官方行为：CreateTempClassPlan 幂等拒绝）——先 `clearTempPlan`
- 用户说「今天课表换成 XX 安排，就今天」→ setTempPlan

### clearTempPlan —— 清除临时层
```json
{ "op": "clearTempPlan" }
```

### orderPlan —— 预定某天用某课表
```json
{ "op": "orderPlan", "date": "2026-11-02", "plan": "考试周一" }
```

### 其他
- `addSubject`（name/initial/teacher）、`renameSubject`（from/to）
- `setPlanEnabled`（plan/enabled）—— 暂停某天课表
- `duplicatePlan`（from/name）、`renamePlan`（from/to）

## 写入通道与守卫

- **ClassIsland 未运行**：文件原子写（自动 `.secagent-bak.json` 备份，写后回读校验）。下次启动生效。
- **ClassIsland 运行中**：文件写拒绝（`RUNNING_GUARD`）。此时：
  - 换整套课表 → `classisland_switch_profile`（官方 IPC，实时生效）
  - 临时换课/编辑 → 请用户退出 ClassIsland 后重试，或用 `classisland_open`（profileAdjustment）打开官方换课窗口人肉操作
- `mode:"file_only"` 仅在明确知道 ClassIsland 没在跑而探测误报时使用（例如沙箱环境）。

## 验证

编辑成功后必 `classisland_read`：setClassSubject → day 视图该行 subject 已变；setTempPlan → detail.temp 出现临时层且当天 day 来自临时层。
