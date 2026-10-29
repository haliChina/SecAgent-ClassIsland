# ClassIsland SecAgent Connector（ClassIsland联动）

SecAgent 侧的 ClassIsland 联动，两条互补通道：

1. **CI 端联动服务**：连接 ClassIsland 端「SecAgent 联动」插件（classisland.secagent）提供的 `http://127.0.0.1:18789` 普通 HTTP JSON 服务，动态暴露其全部工具与 classisland Skill——课表查询、临时换课（swap_classisland_classes）、占课（change_classisland_class）、调休（schedule_classisland_day_as）、档案/组件/主设置读写。
2. **本机直连**（1.1.0 并入原 ClassIsland 课表插件驱动）：官方 IPC 管道（dotnetCampus.Ipc v2 协议复刻）+ 数据目录结构化编辑——`classisland_status` / `classisland_read` / `classisland_edit` / `classisland_switch_profile` / `classisland_open`。**ClassIsland 运行中也能实时切课表档案与临时层**（联动服务的磁盘写入不具备的能力），全部写入 fail-closed 并自动备份。

插件声明 `agent.prompts`：每次对话把当前课表上下文（当前活动、今日序列、下一活动）注入系统提示词。

## 设置

全部设置在 **SecAgent 设置 → ClassIsland联动** 卡片直接调节，保存即生效（无需重启、无需改文件）：

- CI 端联动服务地址（默认 `http://127.0.0.1:18789`）
- ClassIsland 数据目录（留空自动发现；便携版填程序目录下 `data`，用正斜杠或双反斜杠）
- IPC 管道名 / IPC 通道开关 / 请求超时
- 文件写入守卫（严格：运行中一律拒绝写档案文件；宽松：允许运行中写 Settings.json）

> 1.1.0 起原独立的「ClassIsland 课表」插件（classisland 0.1.1）已并入本插件，可以卸载该插件。
