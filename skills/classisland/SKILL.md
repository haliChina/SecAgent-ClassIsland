---
name: classisland
description: 查询和修改 ClassIsland 课表与设置：换课、占课、调休、切档案、改组件。两条通道——CI 端联动服务的 HTTP 工具 + 本机直连官方 IPC（运行中实时生效）；先读取专题说明和当前数据，再执行最小范围写入。（ClassIsland 简称 CI）
---

# ClassIsland Agent 操作入口

本 Skill 由 SecAgent ClassIsland Connector 提供。ClassIsland 端是普通 HTTP JSON 服务，不使用 MCP。所有 CI 操作都使用带 `classisland-connector__` 前缀的工具；不要用 Bash、PowerShell 或直接编辑 CI 文件来替代这些工具。

## 两条通道怎么选

| 意图 | 用哪条 |
| --- | --- |
| 查今天/某天上什么课 | `get_classisland_schedule`（联动，最省事） |
| 临时换课/占课/调休（运行中，立即生效） | 联动：`swap_classisland_classes` / `change_classisland_class` / `schedule_classisland_day_as` |
| 切整套课表档案（运行中，立即生效） | 本机直连：`classisland_switch_profile`（官方 IPC set_CurrentProfilePath） |
| 改档案结构（科目/时间表/课表群，长期生效） | 联动：`write_classisland_profile` / `create_classisland_profile_from_timetable`；或退出 CI 后用本机直连 `classisland_edit` |
| 打开 CI 的某个页面给用户看 | 本机直连：`classisland_open`（运行中 IPC 导航） |
| 诊断连接 | 本机直连：`classisland_status`（数据目录/IPC 自检）；联动服务：`get_classisland_version_status` |

联动服务离线时，本机直连工具（`classisland_status` / `classisland_read` / `classisland_edit` / `classisland_switch_profile` / `classisland_open`）仍然可用——它们直接走官方 IPC 管道 `ClassIsland.IPC.v2.Server` 和数据目录文件。

## 专题说明

需要某一类操作时，先调用 `secagent__read_skill`，参数使用本 Skill 名称和对应的专题文件：

- `components.md`：主界面组件、组件方案、行/容器、专属 Settings 和通用高级设置。
- `settings.md`：设置页字段、字段类型发现、持久化主设置修改和动作型设置的边界。
- `profiles.md`：编辑档案页的档案、课表群、课表、时间表、时间点、科目和临时状态。
- `create-profile-from-timetable.md`：根据 CSV/自然语言课程表创建新档案；优先使用语义化创建工具，不要手工拼 GUID 和引用。
- `automation.md`：自动化、触发器、行动组以及与组件规则集的关系。
- `plugins-themes.md`：插件、主题、通知/语音等设置页涉及的配置与当前 HTTP 能力边界。
- `coverage.md`：根据 ClassIsland 源代码整理的覆盖矩阵；遇到“能不能做”时先看这里。

`secagent__read_skill` 的 `file` 参数填上面列出的文件名，例如 `components.md`。如果当前 SecAgent 版本不支持 `file` 参数，先读取本 Skill 正文，再按专题文件名使用工作区的 `read` 工具读取；不可退化为 Bash 搜索。

## 时间使用准则（重要）

"现在几点""下节课""今天第几节"等问题中，当前时刻以 CI 工具返回的时间为准，而不是系统时间：

- `get_classisland_schedule` 的返回中包含 `now`（ISO）和 `now_local`（`yyyy-MM-dd HH:mm:ss`）字段，这就是 CI 内部当前时刻（可能被模拟时间覆盖）。判断"当前在哪个时间段"时直接比较 `now_local` 与各节次的起止时间即可。
- `get_classisland_version_status` 的 `localDateTime`/`localDate` 也是 CI 内部时间。
- 禁止使用 bash 的 `date` 命令获取时间：那会得到真实系统时间，与 CI 的模拟环境不一致，导致错误答案。

## 总体工作流

1. 先确认 CI 服务：调用 `classisland-connector__get_classisland_version_status`。
2. 根据请求读取对应专题说明。
3. 先列出或读取当前数据，确认档案名、组件方案名、组件真实名称、组件类型、UUID 和目标字段当前值。
4. 只提交用户明确要求的最小 patch；不要用完整 JSON 覆盖单个字段。
5. 写入后重新读取验证。组件写入会请求运行时刷新；档案写入是磁盘 JSON 更新，若运行中的 CI 没有热加载，则提示用户重新加载或重启。

## 工具速查

- `get_classisland_version_status`：CI 版本、运行状态和 CI 本地日期/时间；涉及周日、日期或时间时使用它，不要调用 Bash。
- `get_classisland_schedule`：查询今天或指定 `YYYY-MM-DD` 的课程安排；这是日常查询的快捷工具，返回课程、课间、时间和科目信息，优先使用它回答“今天/某天上什么课”。
- `list_classisland_profiles` / `read_classisland_profile` / `write_classisland_profile`：档案文件及点号路径读写。
- `create_classisland_profile_from_timetable`：根据星期、时间段和科目创建新档案；服务器自动生成并连接档案、时间表、课表和科目 GUID。
- `read_classisland_main_config` / `list_classisland_settings` / `update_classisland_main_config`：主配置读取、可持久化字段目录和增量更新。`update_classisland_main_config` 的参数键名必须是 `patch`（不是组件工具用的 `settings_patch`/`common_patch`），`patch` 传 JSON 对象或 JSON 字符串均可，例如 `{"patch":{"Scale":1.2}}`。
- `list_classisland_component_configs` / `list_classisland_components`：组件方案和当前组件运行时目录。
- `read_classisland_component_config` / `write_classisland_component_config`：组件 JSON 路径级读写。
- `update_classisland_component`：按组件 UUID 更新通用高级设置或专属 Settings。
- `swap_classisland_classes`：交换两节课（支持跨天）。参数 `date_a`/`class_a`/`date_b`/`class_b`（节次序号 1=第1节），`temporary` 默认 true（写入临时层，不影响原课表）。
- `change_classisland_class`：把某一天某一节临时改成指定科目（占课）。参数 `date`/`class`/`subject_name`，`temporary` 默认 true。
- `schedule_classisland_day_as`：把某一天设为使用另一天/另一星期几的课表（调休）。参数 `date` + `source_date` 或 `source_weekday`（0=周日…6=周六）。

## 本机直连工具（官方 IPC + 结构化文件编辑）

纪律（继承自 0.1.1 课表驱动）：

0. **设置入口**：本插件的配置（联动地址、数据目录、IPC 开关、写入守卫）在 **SecAgent 设置 → ClassIsland联动 卡片**里改，保存即生效，不要改任何配置文件。让用户填数据目录时叮嘱：**用正斜杠 `D:/...` 或双反斜杠**，单反斜杠会被转义吞掉。
1. **先 status 后操作**：首次接触、找不到数据、任何本直连工具报错——先 `classisland_status`。
2. **运行中不写档案文件**：CI 运行时改磁盘档案会被内存覆盖。`classisland_edit` 收到 `RUNNING_GUARD` 是预期行为——此时临时换课改用联动工具（swap/change，temporary 层实时生效），整套换课用 `classisland_switch_profile`（IPC 实时）。
3. **改前读、改后验**：编辑前 `classisland_read` 定位，编辑后再 read / `get_classisland_schedule` 验证。
4. **fail-closed**：工具返回 `ok:false` 就停下向用户说明，绝不基于旧数据继续叠加操作。

`classisland_edit` 的 operations：`setClassSubject`（单节换课）、`setTempPlan`（临时层换课，当天生效自动过期）、`clearTempPlan`、`orderPlan`（预定某天用某课表）、`addSubject` / `renameSubject`、`duplicatePlan` / `renamePlan`、`setPlanEnabled`。一次编辑一组相关 operations（原子应用、失败整组不落盘）。

协议与排障参考：`ref-protocol.md`（dotnetCampus.Ipc v2 帧格式与成员表）、`ref-troubleshooting.md`（常见故障）。

## 临时层与调休

ClassIsland 用“临时层”课表承载临时换课/占课，改动写入临时层后**不影响原课表**：

- `swap_classisland_classes` / `change_classisland_class` 的 `temporary=true`（默认）会把改动写入当天临时层课表并标记 `IsChangedClass`。
- 调休（如“这周日上周一的课”）使用 `schedule_classisland_day_as`：`date` 填目标日期，`source_weekday` 填源星期几（1=周一），或 `source_date` 填源日期；服务端会创建预定课表生效。
- 任何写操作后调用 `get_classisland_schedule` 重新验证当天课表已生效；不要仅凭口头“已完成”收尾。

任何写操作都必须先读后写；若用户只说“改一下组件”但没有明确字段，先询问目标组件和字段，不要猜测。
