# CI 主界面组件专题

## 数据模型

主界面组件不在课表档案中，而在 `Config/ComponentLayouts/<方案名>.json`。根对象是 `Lines` 数组；每个元素是一行，行内是 `Children` 数组；容器组件的 `Settings` 还可以继续提供 `Children`。

组件对象的关键字段：

- `Id`：组件注册 GUID，也是唯一可靠的写入目标。
- `NameCache`：未加载组件时的旧名称缓存，不能把它当作当前真实名称。
- `Settings`：组件专属设置；字段必须以 `list_classisland_components` 返回的 `settings_fields` 为准。
- 其余字段是 `ComponentSettings` 通用设置，设置页里的“高级设置”就在这里。

## 发现真实组件

询问“有哪些组件”、按名称找组件、询问组件类型，必须先调用：

```json
{"config_name":"可选，默认当前方案"}
```

使用 `classisland-connector__list_classisland_components`。结果中的 `name`、`description`、`type`、`settings_type`、`settings_fields` 来自 CI 运行时组件注册表；不要从 `NameCache`、`Settings` 的 JSON 形状或自己的记忆推断名称和类型。

`settings_fields` 会给出专属字段名、CLR 类型、当前值和枚举候选。先用它确认字段，再写 `settings_patch`。

## 通用高级设置

这些字段属于组件对象本身，不属于 `Settings`：

### 显示规则

`HideOnRule`、`HidingRules`。如果用户说“满足条件时隐藏”，先修改 `HideOnRule`，规则内容要通过完整的 `HidingRules` 结构写入；不要只写一个自然语言字符串。

### 资源与外观

`IsResourceOverridingEnabled`、`MainWindowSecondaryFontSize`、`MainWindowBodyFontSize`、`MainWindowEmphasizedFontSize`、`MainWindowLargeFontSize`、`IsCustomForegroundColorEnabled`、`ForegroundColor`、`BackgroundOpacity`、`IsCustomBackgroundOpacityEnabled`、`BackgroundColor`、`IsCustomBackgroundColorEnabled`、`CustomCornerRadius`、`IsCustomCornerRadiusEnabled`、`Opacity`。

颜色使用 CI 当前 JSON 能接受的颜色表示；写颜色前先读取同类字段的现值作为格式样例。透明度、字号、圆角使用数值。

主界面的**整体缩放**（“主界面调大/调小”）不在组件字段里，对应主配置的 `Scale`（见 `settings.md` 外观段落）；这里的字号字段只影响单个组件的文字大小。

### 布局

`RelativeLineNumber`、`IsMinWidthEnabled`、`MinWidth`、`IsMaxWidthEnabled`、`MaxWidth`、`IsFixedWidthEnabled`、`FixedWidth`、`HorizontalAlignment`、`IsCustomMarginEnabled`、`MarginLeft`、`MarginTop`、`MarginRight`、`MarginBottom`。

启用某项后才写对应的值：例如固定宽度要同时设置 `IsFixedWidthEnabled:true` 和 `FixedWidth`；自定义边距要同时设置 `IsCustomMarginEnabled:true` 以及边距字段。`HorizontalAlignment` 使用 CI 的枚举值。

## 修改组件

优先使用 `classisland-connector__update_classisland_component`：

```json
{
  "config_name":"Default.json",
  "component_id":"从 list_classisland_components 得到的 UUID",
  "common_patch":{"IsFixedWidthEnabled":true,"FixedWidth":240},
  "settings_patch":{"某个专属字段":"新值"}
}
```

`common_patch` 与 `settings_patch` 可以同时存在。禁止用 `common_patch` 改 `Id`、`NameCache`、`Settings` 或 `Children`。

需要查看完整原始 JSON 或修改未被高级工具覆盖的已知字段时，才使用 `read_classisland_component_config` / `write_classisland_component_config`。修改后重新调用 `list_classisland_components` 或 `read_classisland_component_config` 验证。

## 组件方案和结构操作

`list_classisland_component_configs` 只能列出方案和当前激活方案；当前 HTTP 工具已经覆盖“创建/复制/删除方案”以外的字段读写，但组件设置页还包含以下结构动作：新增行、删除行、移动行、从组件库添加、移入容器、移出容器、上移/下移、复制组件、删除组件、编辑行规则集和组件规则集。

在这些动作对应的结构工具尚未出现在 `/tools` 之前，不要伪造成功，也不要直接改文件；可以使用 `read_classisland_component_config` 读取结构并明确告诉用户当前连接端只能做字段级修改。组件库中的新组件必须由 CI 按注册类型创建默认 Settings，不能凭空拼一个 `Id` JSON。

## 安全约束

- 写入前必须确认方案名和 UUID；同名组件也必须按 UUID 区分。
- 不要用完整配置覆盖单字段；不要删除未知字段。
- 写入会创建 `.bak`，并尝试调用 CI 的 `RefreshConfigs`；若返回 `runtime_refreshed:false`，说明已落盘但需要重启/重新加载。
