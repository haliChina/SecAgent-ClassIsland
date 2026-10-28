// 设置参数的单一事实源。

export const SETTING_FIELDS = [
  { key: "dataDir", group: "connection", type: "string", default: "",
    label: "ClassIsland 数据目录（留空自动发现）",
    placeholder: "%APPDATA%\\ClassIsland\\Data",
    help: "安装版默认 %APPDATA%\\ClassIsland\\Data；便携版填程序目录下的 data。自动发现失败时必填。" },
  { key: "pipeName", group: "connection", type: "string", default: "ClassIsland.IPC.v2.Server",
    label: "IPC 管道名",
    help: "官方固定值 ClassIsland.IPC.v2.Server（1.5.3+ 与 2.x 相同），一般不要改。" },
  { key: "ipcEnabled", group: "connection", type: "bool", default: true,
    label: "启用 IPC 通道（运行中换课表/实时读取）" },
  { key: "requestTimeoutMs", group: "connection", type: "number", default: 8000, min: 2000, max: 60000, step: 500,
    label: "IPC 请求超时（毫秒）" },
  { key: "writeGuard", group: "safety", type: "select", default: "strict",
    options: [
      { value: "strict", label: "严格（ClassIsland 运行中一律拒绝文件写入）" },
      { value: "file_only", label: "宽松（允许运行中写 Settings.json，Profile 仍拒绝）" }
    ],
    label: "文件写入守卫" }
];

export const SETTING_GROUPS = [
  { id: "connection", title: "连接", description: "数据目录与 IPC 通道。" },
  { id: "safety", title: "安全", description: "写入守卫与备份策略。" }
];

export const DEFAULT_CONFIG = Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, f.default]));

export function mergeConfig(raw = {}) {
  const out = { ...DEFAULT_CONFIG };
  for (const f of SETTING_FIELDS) {
    const v = raw?.[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "bool") out[f.key] = Boolean(v);
    else if (f.type === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[f.key] = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));
    } else if (f.type === "select") {
      if (f.options.some((o) => o.value === v)) out[f.key] = v;
    } else {
      out[f.key] = String(v);
    }
  }
  return out;
}

export function describeSettings() {
  return {
    groups: SETTING_GROUPS,
    fields: SETTING_FIELDS.map(({ key, group, type, label, help, placeholder, default: def, options, min, max, step }) =>
      ({ key, group, type, label, help, placeholder, default: def, options, min, max, step }))
  };
}
