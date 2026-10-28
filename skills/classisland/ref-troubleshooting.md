# 常见故障

| 症状 | 原因与处置 |
| --- | --- |
| `DATA_DIR_NOT_FOUND` | ClassIsland 未安装/便携版位置特殊。让用户在插件设置填 dataDir，或 status 看 candidates 列表里哪个像。 |
| dataDir 提示「没有路径分隔符/被转义吞掉」 | 用户填了单反斜杠被配置层吃掉。让用户改用正斜杠 `D:/.../data` 或双反斜杠重填（Status 输出里会原样显示被吞后的值）。 |
| Settings.json 未找到（warning） | 版本差异（实测便携版可能不在 Config\ 下）。插件会自动探测三处位置并兜底 Default.json；status 的 warnings 会说明探测详情。 |
| `PARSE_FAIL` 读档案 | 档案 JSON 损坏（磁盘/写坏）。看 `.secagent-bak.json` 是否存在；ClassIsland 自身有备份机制，让用户在 ClassIsland 里用「档案-从备份恢复」。 |
| `RUNNING_GUARD` 写入被拒 | 预期行为：ClassIsland 正在运行。换课表用 switch_profile；单节改课请用户退出 ClassIsland 再重试。 |
| IPC `PLATFORM` | 只在 Windows 有命名管道。Linux/macOS 是开发/演示环境。 |
| IPC 握手失败但管道存在 | 版本过老（<1.5.3 无 v2 管道名也会连不上）；或杀软拦截。让用户升级 ClassIsland / 信任 SecAgent。 |
| `profile.get` 返回字段很怪 | 正常：Newtonsoft 会带出运行时字段（IsActivated 等）。只读参考，勿整包回写。 |
| 换档案后 UI 没变 | set 成功但 ClassIsland 2.x 某些版本对 CurrentProfilePath set 的即时刷新有限——让用户看主界面/重开设置窗确认；1.7 实测为准。 |
| `OP_UNKNOWN` | operations 里的 op 名拼错。用 route-edit.md 的清单。 |
| setTempPlan 报已存在 | 先 clearTempPlan（官方幂等语义）。 |
| 用户说「第 N 节」对不上 | 数的是上课行（TimeType=0），不含课间/分割线。见 route-read.md。 |

## 升级路径

- 实测 IPC 稳定后，运行中编辑可走 `get → 改 → set_Profile → SaveProfile()` 一条龙（`classisland_ipc` 可先行实验）。
- CreateTempClassPlan（带参）签名存在 Roslyn 类型字符串歧义，实测响应确认后可加入 key 表。
