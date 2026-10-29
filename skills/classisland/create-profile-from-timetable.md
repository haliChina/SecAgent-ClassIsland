# 按课程表创建新的 CI 档案

当用户给出 CSV、表格或自然语言课程表，并要求“新建/导入一个档案”时，先读取本文件，再调用 `classisland-connector__create_classisland_profile_from_timetable`。不要先调用 `write_classisland_profile`：它只能修改已经存在的档案，不能创建新文件。

## 必须使用的输入形式

工具只接收课程表语义数据，不接收模型手工拼出的完整 CI JSON：

```json
{
  "profile_name": "2026春季课表.json",
  "display_name": "2026春季课表",
  "days": [
    {
      "weekday": 1,
      "name": "周一",
      "rows": [
        {"start": "07:30", "end": "07:50", "label": "早读", "type": "break"},
        {"start": "08:00", "end": "08:40", "subject": "语文", "type": "lesson"},
        {"start": "08:40", "end": "08:50", "label": "课间", "type": "break"}
      ]
    }
  ]
}
```

`weekday` 使用 CI 的 `DayOfWeek` 数字：周日 `0`，周一 `1`，周二 `2`，周三 `3`，周四 `4`，周五 `5`，周六 `6`。每个星期只放一个对象；没有安排的星期不要伪造空课表。

从 CSV 转换时：

1. 将每一行的时间范围拆为 `start` 和 `end`，统一为 `HH:mm` 或 `HH:mm:ss`。
2. 将星期列转换为 `days[].rows[]`。单元格是科目名时填 `subject` 并使用 `type: "lesson"`。
3. 早读、课间、午休、晚自习、课后服务等没有科目引用的行使用 `type: "break"`，并把显示文字放在 `label`。如果“自习”是用户希望显示为一节可点名的课程，则明确填 `subject: "自习"` 和 `type: "lesson"`。
4. 所有星期的行按当天时间顺序排列。若不同星期的时间段或行类型不同，工具会自动生成多个时间表并为每个课表选择正确的时间表。
5. 课程表是周循环安排时，不要创建 `OrderedSchedules`。工具会为每个星期生成一个 `ClassPlan.TimeRule`。`OrderedSchedules` 只用于用户明确指定某个日期临时/预定启用哪一个课表的场景。

## 哪些 ID 由谁负责

模型不需要生成或猜测下面任何 ID。工具服务器会使用合法的新 GUID，并在对象之间写入引用：

| CI 字段 | 含义 | 处理方式 |
|---|---|---|
| `TimeLayouts.<id>` | 时间表字典键 | 服务端生成 |
| `ClassPlans.<id>` | 课表字典键 | 服务端生成 |
| `Subjects.<id>` | 科目字典键 | 已有同名科目复用；新科目由服务端生成 |
| `ClassPlan.TimeLayoutId` | 课表引用时间表 | 服务端写入对应时间表 ID |
| `ClassPlan.AssociatedGroup` | 课表群引用 | 使用 CI 默认课表群的保留 ID |
| `ClassInfo.SubjectId` | 课程引用科目 | 服务端根据科目名写入 |
| `TimeLayoutItem.DefaultClassId` | 默认课程引用 | 服务端写入空 GUID；不要写 `null` |
| `OrderedSchedules.<date>.ClassPlanId` | 日期预定课表引用 | 只有用户明确要求日期预定时才由服务端/后续工具写入，值必须是对象而不是字符串 |
| `Profile.Id` | 档案自身 ID | 服务端生成 |

不要把科目中文名直接写进 `Classes`，不要把 `TimeLayoutId` 写成时间表名称，也不要把 `OrderedSchedules` 的值写成裸字符串。

## 创建后的检查

工具会从当前档案复制科目和课表群的基础结构，生成新档案，检查所有引用，并以原子方式写入 `Profiles/<profile_name>`。返回结果中的 `time_layouts`、`class_plans` 和 `subjects_created` 是服务端实际生成/复用的映射；不要自行改写这些 ID。

创建后必须检查工具返回的：

- `written: true`；
- `runtime_reloaded`。新建的非当前档案通常为 `false`，这表示文件已经创建，但尚未切换为当前档案；
- `next_step`。需要用户在 CI 档案选择器中切换，或重启 CI 后选择新档案。

如果工具报“档案已存在”，不要擅自覆盖；只有用户明确要求覆盖时才传 `overwrite: true`。如果用户要的是“把当前档案改成课程表”，才使用 `read_classisland_profile` + `write_classisland_profile`，并遵循 `profiles.md` 的读后写和复读验证规则。

