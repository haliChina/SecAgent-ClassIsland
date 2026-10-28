# 数据格式与协议参考

## 文件层（ClassIsland 1.7 与 2.x 同构）

- 安装版数据根：`%APPDATA%\ClassIsland\Data`；便携版：程序目录 `data\`
- 档案：`Data\Profiles\*.json`（PascalCase JSON，System.Text.Json 默认策略）
- 当前档案：`Data\Config\Settings.json` 的 `SelectedProfile`（文件名）
- 档案内核心字典（key 均为 GUID）：
  - `TimeLayouts`：时间表 → `Layouts`[]（`StartTime/EndTime` ISO 时长 "08:00:00"、`TimeType` 0=上课/1=课间/2=分割线/3=行动）
  - `ClassPlans`：课表 → `TimeLayoutId`、`Classes`[]（`SubjectId`/`IsChangedClass`/`IsEnabled`）、`TimeRule`（`WeekDay` 0=周日、`WeekCountDiv/WeekCountDivTotal` 单双周）、`IsOverlay/OverlaySourceId/OverlaySetupTime`、`IsEnabled`
  - `Subjects`：科目（`Name/Initial/TeacherName`）
  - `ClassPlanGroups`：课表群 + `SelectedClassPlanGroupId`
  - 临时层开关：`IsOverlayClassPlanEnabled` + `OverlayClassPlanId`
  - 预定：`OrderedSchedules` {"yyyy-MM-ddT00:00:00": {"ClassPlanId": …}}
- **ClassIsland 运行中不监视这些文件，且任何内存变更都会整体重写档案**——外部写文件只在没有运行时安全。

## IPC 层（官方对外接口，1.5.3+）

- 命名管道：`ClassIsland.IPC.v2.Server`（底层库 dotnetCampus.Ipc 2.0.0-alpha410，双半工：客户端连对方管道写，对方回连本地随机管道回发）
- 官方服务（`IPublicProfileService` 等，本插件已封装在 `classisland_ipc` 的 key 表）：
  - `profile.currentPath.get/set` —— 当前档案路径（**换课表=改它**，set 实时生效）
  - `profile.get` —— 读运行中内存态整档案（注意：Newtonsoft 序列化会带出运行时字段，只读参考）
  - `profile.save` / `profile.clearTemp` / `profile.convertTempToStd` / `profile.clearTempGroup`
  - `uri.navigate`（classisland:// 导航）、`lessons.*`（当前节/状态）
- URI 协议：`classisland://app/settings`、`classisland://app/profile/adjustment`（换课窗口）等；外部 `start classisland://...` 唤起（单实例转发）。

## 本插件协议实现（Node 复刻要点）

- 帧：小端 `[UInt16 头长13]["dotnet campus"][UInt32 ver=1][UInt64 ack][UInt32 0][Int16 cmd][UInt32 长][content]`；cmd：-1 注册/3 请求/5 响应
- RemoteObject content：`"Request\0"/"Response"` 标记 + messageId + 业务头 `0x526D4F6A` + Newtonsoft JSON `{i,t,d,m,c,a}`（`d`=memberId、`c`=1 get/2 set/3 method）
- memberId = SHA256(成员签名) 前 8 字节小端 UInt64；属性 `get_X()/set_X()`，方法 `Name(参数类型列表)`
- 完整推导记录：仓库 `docs/PROTOCOL.md`
