# CI 编辑档案专题

## 档案边界

编辑档案页操作的是 `Profiles/<profile_name>.json`，不是 `Settings.json`，也不是 `Config/ComponentLayouts`。先调用 `list_classisland_profiles`，再用 `read_classisland_profile` 读取目标档案的完整结构或目标分支。

档案根对象主要包括：

- `Name`：档案名称。
- `TimeLayouts`：时间表字典，键是 GUID。
- `ClassPlans`：课表字典，键是 GUID。
- `Subjects`：科目字典，键是 GUID。
- `ClassPlanGroups`：课表群字典，键是 GUID。
- `OrderedSchedules`：按日期预定启用的课表，键是日期时间。
- `IsOverlayClassPlanEnabled`、`OverlayClassPlanId`：临时层课表状态。
- `TempClassPlanId`、`TempClassPlanSetupTime`：临时课表状态。
- `SelectedClassPlanGroupId`、`TempClassPlanGroupId`、`TempClassPlanGroupExpireTime`、`IsTempClassPlanGroupEnabled`、`TempClassPlanGroupType`：临时/选中课表群状态。

`EditingSubjects`、计算属性和运行时关联对象不是持久化字段，不要写入。

## 课表群

`ClassPlanGroups.<groupGuid>` 的值至少包含 `Name` 和 `IsGlobal`。默认群与全局群有 CI 保留 GUID，不要删除或改成普通群。新建、重命名、解散、删除课表群时还要同步检查 `ClassPlans.*.AssociatedGroup`；若用户要求删除群，应先确认群内课表的处理方式。

## 课表

`ClassPlans.<classPlanGuid>` 常用字段：

- `Name`、`TimeLayoutId`、`AssociatedGroup`、`IsEnabled`。
- `TimeRule`：自动启用规则；需要按当前 JSON 结构整体读取后再 patch。
- `Classes`：按时间点保存课程信息，课程中的 `SubjectId` 指向 `Subjects` 的 GUID。
- 临时层相关字段只在 CI 生成的 overlay 课表中使用，不能把普通课表随意改成 overlay。

新建/复制/删除课表时要检查引用：课表删除后对应的 `OrderedSchedules` 不能继续指向已删除 GUID；变更 `TimeLayoutId` 前要确认 `Classes` 与新时间表的时间点数量和顺序。

## 时间表

`TimeLayouts.<timeLayoutGuid>` 包含 `Name` 和 `Layouts` 数组。每个时间点来自 `TimeLayoutItem`：

- `TimeType: 0` 上课：使用 `StartTime`、`EndTime`、`DefaultClassId`。
- `TimeType: 1` 课间：使用 `StartTime`、`EndTime`、`BreakName`。
- `TimeType: 2` 分割线：使用 `StartTime`，通常 `EndTime` 与开始时间一致。
- `TimeType: 3` 行动：使用 `StartTime` 和 `ActionSet`。
- `IsHideDefault`：是否默认隐藏。

时间使用 CI 当前档案 JSON 的 `TimeSpan` 格式；修改时间点时先读取同一时间表的现有格式，不要凭记忆混用秒数、字符串和 ISO 时间。

编辑时间表的“新增上课/课间/分割线/行动、复制、删除、撤销/重做、刷新、覆盖课程”是对数组和关联课程的组合操作。没有专门结构工具时，必须先读取整个 `Layouts` 与相关 `Classes`，再用一次数组 patch，并在写入后复读校验。

## 科目

`Subjects.<subjectGuid>` 常用字段为 `Name`、`Initial`、`TeacherName`、`IsOutDoor`。课程只保存 `SubjectId`，不要把课程名直接写到 `Classes` 中代替科目引用。新增或删除科目时，先搜索 `ClassPlans.*.Classes.*.SubjectId` 的引用。

## 临时状态和预定课表

临时课表、临时层、课表群临时状态只应在用户明确要求“今天临时启用/清除/设置临时层”时修改。不要把 UI 当前选中项当成长期配置。`OrderedSchedules.<date>.ClassPlanId` 是预定启用关系，日期键格式以现有 JSON 为准。

## 写入规则

使用 `write_classisland_profile` 的 `path + value` 修改单字段，或使用 `patch` 做对象级递归合并；数组会整体替换，不能用小数组 patch 假装追加。

每次写入前后都保留以下检查：

1. 所有 `ClassPlans.*.TimeLayoutId` 存在于 `TimeLayouts`。
2. 所有课程 `SubjectId` 存在于 `Subjects`，或明确是 CI 允许的空值/特殊值。
3. 所有 `AssociatedGroup` 存在于 `ClassPlanGroups`。
4. `OrderedSchedules.*.ClassPlanId` 存在于 `ClassPlans`。
5. 写入返回 `.bak` 后，重新读取目标路径确认值。

连接插件的新版本在写入当前正在使用的档案后，会调用 CI 的内部档案加载流程重新载入并重新挂接保存事件；写入结果会返回 `runtime_reloaded`。它不会模拟档案编辑窗口的撤销栈、确认对话框或导入提供程序。若返回 `runtime_reloaded:false` 或 `runtime_reload_error`，提示用户重新打开编辑器或重启 CI。
