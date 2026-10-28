# SecAgent ClassIsland 插件

让 SecAgent Agent 用自然语言操作 [ClassIsland](https://github.com/ClassIsland/ClassIsland) 课表：连接测试、读课表、单节换课、临时层换课（当天生效自动过期）、切换课表档案、打开官方换课窗口。

## 安装

1. 装好 ClassIsland（1.5.3+ 或 2.x）并至少配置过一次课表。
2. SecAgent 插件管理安装本 zip，然后对 Agent 说「**运行 classisland_status**」——它会自动发现 `%APPDATA%\ClassIsland\Data`（安装版）并做全套自检；找不到时在插件设置里填 dataDir。

## 能力

| 工具 | 作用 |
| --- | --- |
| `classisland_status` | 连接测试：数据目录发现、档案清单与解析校验、ClassIsland 运行探测、IPC 实连握手 |
| `classisland_read` | 读档案/指定日期课表（紧凑视图：科目、时间、课表、临时层、当天行） |
| `classisland_edit` | 结构化编辑：`setClassSubject`（单节换课）、`setTempPlan`（官方语义临时层）、`clearTempPlan`、`orderPlan`（预定某天）、科目管理、课表启停/复制/改名。原子应用+自动备份 |
| `classisland_switch_profile` | 换课表（切档案）：ClassIsland 运行中走官方 IPC `set_CurrentProfilePath` 实时生效；未运行改 `Settings.json` |
| `classisland_open` | 打开 ClassIsland 页面（设置/临时换课窗口等，classisland:// URI） |
| `classisland_ipc` | 高级：直调官方 IPC 成员（诊断/实验） |

## 通道与安全

- **读**：任何时刻直读档案文件。
- **写（文件）**：仅在 ClassIsland 未运行时（原子写：`.secagent-bak.json` 备份 → 临时文件 → 回读校验 → rename）。运行中写文件会被拒绝（`RUNNING_GUARD`）——ClassIsland 不监视档案文件且会用内存态覆盖磁盘，这是防数据丢失的 fail-closed。
- **写（IPC）**：运行中换课表走官方 `IPublicProfileService`（dotnetCampus.Ipc 命名管道 `ClassIsland.IPC.v2.Server`，协议细节见 docs/PROTOCOL.md）。

## 自然语言示例

- 「看下今天课表」→ status + read(day)
- 「明天第 3 节数学换成物理」→ read 定位 → edit(setClassSubject)
- 「今天全天用自习安排，就今天」→ edit(setTempPlan)
- 「取消临时换课」→ edit(clearTempPlan)
- 「切换到考试周课表档案」→ switch_profile

## 开发

```
npm test          # node --test（协议层用 mock 传输对拍，无需 Windows）
npm run check     # node --check 全部源文件
npm run pack      # 打包 zip 到 download/
```

协议推导与来源：`docs/PROTOCOL.md`；Agent 操作指南：`skills/classisland/`。
