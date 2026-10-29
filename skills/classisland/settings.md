# CI 设置页专题

## 先区分两类内容

设置页里绑定到 `SettingsService.Settings.<字段>` 的内容通常是 `Settings.json` 的持久化属性；按钮、搜索、同步、预览、安装、备份、更新和重启则是动作，不等同于字段写入。

查询“某个设置叫什么”“有哪些高级设置”时，先调用 `classisland-connector__list_classisland_settings`。它从运行中的 `ClassIsland.Models.Settings` 返回可持久化字段的 CLR 类型、JSON 名、当前值、是否可写和枚举候选。不要根据页面上的中文标签猜属性名。

修改字段时使用：

```json
{"patch":{"字段名":新值}}
```

调用 `classisland-connector__update_classisland_main_config`。**参数键名必须是 `patch`**（不要使用组件工具 `update_classisland_component` 的 `settings_patch`/`common_patch` 键）；`patch` 传 JSON 对象或可解析为对象的 JSON 字符串均可。一次只改用户明确要求的字段；写入前先读取当前值，写入后重新读取验证。工具会做类型反序列化、未知属性检查和运行时 `SaveSettings`。

## 设置页字段索引

下面是根据 CI 源代码页面绑定整理的导航索引。它用于缩小 `list_classisland_settings` 的结果范围；最终字段名和类型仍以运行时工具为准。

### 外观 Appearance

`Theme`、`ColorSource`、`PrimaryColor`、`CustomForegroundColor`、`IsCustomForegroundColorEnabled`、`BackgroundColor`、`IsCustomBackgroundColorEnabled`、`Opacity`、`Scale`、`RadiusX`、`MainWindowFont`、`MainWindowFontWeight2`、`MainWindowSecondaryFontSize`、`MainWindowBodyFontSize`、`MainWindowEmphasizedFontSize`、`MainWindowLargeFontSize`、`MainWindowLineVerticalMargin`、`IsIslandSeperated`、`IsFallbackModeEnabled`、`TargetLightValue`、`SelectedPlatteIndex`、`WallpaperClassName`、`WallpaperColorPlatte`、`IsWallpaperAutoUpdateEnabled`、`WallpaperAutoUpdateIntervalSeconds`、`UseExperimentColorPickingMethod`。

“主界面调大/调小”“界面缩放”对应 `Scale`（界面缩放，默认 1.0，调大=整体放大）；`MainWindowBodyFontSize`、`MainWindowLargeFontSize` 等只改对应文字大小，不是整体缩放。

### 通用 General

`AnimationLevel`、`CriticalSafeModeMethod`、`HideMode`、`HideOnClass`、`HideOnFullscreen`、`HideOnMaxWindow`、`HideRules`、`IsCriticalSafeMode`、`IsSplashEnabled`、`IsWaitForTransientDisabled`、`MultiWeekRotationMaxCycle`、`ReduceProgressAccuracy`、`ShowDetailedStatusOnSplash`、`ShowSellingAnnouncement`、`SingleWeekStartTime`、`SplashCustomLogoSource`、`SplashCustomText`、`TaskBarIconClickBehavior`。

### 窗口 Window

`IsIgnoreWorkAreaEnabled`、`IsMouseClickingEnabled`、`IsMouseInFadingEnabled`、`IsMouseInFadingReversed`、`IsScreenRecordingModeEnabled`、`IsWindowCaptureBlockingEnabled`、`TouchInFadingDurationMs`、`UseRawInput`、`WindowDockingLocation`、`WindowDockingMonitorIndex`、`WindowDockingOffsetX`、`WindowDockingOffsetY`、`WindowLayer`、`WindowTopmostRecheckMode`。

### 时钟 Clock

`IsExactTimeEnabled`、`ExactTimeServer`、`IsTimeAutoAdjustEnabled`、`TimeAutoAdjustSeconds`、`TimeOffsetSeconds`。

`TimeOffsetSeconds` 是时间偏移（单位：秒），叠加在 CI 内部时间基准上：**正值让时间变晚（延迟），负值让时间变早（提前）**。当铃声/提醒比真实时间晚（滞后）时，应把偏移**减小（往负方向调）**来抵消；例如“铃声慢了 5 秒”→ `TimeOffsetSeconds` 从 0 改为 **-5**。注意方向：用户说“慢/滞后”要减小偏移，说“快/提前”要增大偏移。

### 通知 Notification

`IsNotificationEnabled`、`IsNotificationEffectEnabled`、`AllowNotificationEffect`、`IsNotificationSoundEnabled`、`AllowNotificationSound`、`NotificationSoundPath`、`NotificationSoundVolume`、`IsSpeechEnabled`、`AllowNotificationSpeech`、`SelectedSpeechProvider`、`SpeechVolume`、`IsNotificationTopmostEnabled`、`AllowNotificationTopmost`。

### 天气 Weather

`CityId`、`CityName`、`WeatherLongitude`、`WeatherLatitude`、`AutoRefreshWeatherLocation`、`WeatherIconId`、`ExcludedWeatherAlerts`、`NoTLSWeatherRequests`。天气页面的城市搜索、获取当前位置、刷新天气是动作；如果 HTTP 工具目录没有对应工具，不要声称已经执行，只能修改已知字段。

### 自动化 Automation

`CurrentAutomationConfig`、`IsAutomationEnabled`、`IsAutomationWarningVisible` 属于选择/开关状态；自动化方案、触发器和行动组本体见 `automation.md`。

### 插件 Plugins

`PluginIndexes`、`OfficialSelectedMirror`、`IgnoreSslForPluginMirrors`、`IsPluginsAutoUpdateEnabled`、`IsPluginsUpdateNotificationEnabled`、`IsPluginMarketWarningVisible`。安装、卸载、更新、添加/删除源和打开插件目录是动作，见 `plugins-themes.md`。

### 隐私、刷新、存储、更新、调试

- 隐私：`IsSentryEnabled`。
- 刷新提示：`IsRefreshingToastEnabled`、`LeftRefreshingToastCounts`、`MaxRefreshingToastCounts`、`OnboardingToastBody`、`OnboardingToastTitle`、`RefreshingScopes`、`RefreshingToastIsOnboardingGuide`、`RefreshingToastThresholdDays`、`ShowRefreshingToastOnNextStart`。
- 存储：`AutoBackupIntervalDays`、`AutoBackupLimit`、`IsAutoBackupEnabled`；`BackupFilesSize`、`LastAutoBackupTime` 通常是状态值，不要擅自改。
- 更新：`UpdateMode`、`SelectedUpdateChannelV3`；`LastCheckUpdateTime`、`LastUpdateStatus` 是状态值；Debug URL 覆盖字段只有用户明确要求调试时才改。
- 调试：`IsDebugEnabled`、`IsDebugOptionsEnabled`、`IsMainWindowDebugEnabled`、`DebugTimeSpeed` 属于开发/测试开关，写入前必须得到明确意图。

## 不能误做成字段写入的页面操作

CI 设置页还有关于、错误、测试、管理凭据、管理策略、主题加载、插件安装、备份恢复、检查/下载/部署更新、同步时间、天气定位、测试通知/语音等按钮。这些操作需要 CI 服务方法或外部交互；当前连接插件只有目录中声明的 HTTP 工具时才能执行。工具目录没有对应动作时，应明确说明“字段修改可做，按钮动作未暴露”，不能通过 Bash、模拟点击或直接修改缓存文件冒充完成。
