// SecAgent ClassIsland 联动（CIC）1.1.0
// 由宿主动态 import 并调用 activate(api)。
//
// 两条通道，互补：
// ① CI 端联动服务（companion）：ClassIsland 内「SecAgent 联动」插件提供的
//    HTTP JSON 服务（默认 127.0.0.1:18789），动态暴露工具目录——课表查询、
//    换课/占课/调休、档案/组件/主设置读写。本插件每 5s 轮询 /health+/tools，
//    动态注册/注销其全部工具。
// ② 本机直连（0.1.1 课表驱动并入）：官方 IPC 管道（dotnetCampus.Ipc v2 复刻）
//    + 数据目录结构化编辑——ClassIsland 运行中也能实时切档案/临时层/导航，
//    这是 companion 磁盘级写入不具备的能力。
// 设置全部可在 SecAgent 设置页（ClassIsland联动 卡片）调节，保存即生效。

import { createService } from "./driver/service.mjs";
import { runDoctor, formatDoctorReport } from "./driver/doctor.mjs";
import { createDiscovery } from "./driver/discovery.mjs";
import { createStore } from "./driver/store.mjs";
import { mergeConfig, describeSettings, DEFAULT_CONFIG } from "./settings/config-schema.mjs";

const SKILL_PATH = "skills/classisland";
const SCHEDULE_PROMPT = "classisland_schedule_context";
const SKILL_AUTOLOAD = /classisland|课表|课程表|换课|调课|占课|上什么课|第几节|班级课表|timetable/i;

const entryName = (entry) => {
  if (entry.type === "lesson") return entry.subject || (entry.period ? `第 ${entry.period} 节` : "");
  if (entry.type === "break") return entry.label || "课间";
  if (entry.type === "action") return entry.label || "活动";
  return "";
};

const parseLocal = (text) => {
  const match = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return match ? new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]) : new Date();
};

function structuredError(tool, e) {
  return { ok: false, code: (e && e.code) || "INTERNAL", error: String((e && e.message) || e), tool };
}

function guarded(tool, fn) {
  return async (args = {}) => {
    try {
      const r = await fn(args);
      if (r && typeof r === "object" && !("ok" in r)) r.ok = true;
      return r;
    } catch (e) {
      return structuredError(tool, e);
    }
  };
}

export async function activate(api) {
  let config = mergeConfig(typeof api.getConfig === "function" ? api.getConfig() : {});

  // —— 本机直连引擎（换课实时生效）——
  let localEngine = null;
  const engine = () => {
    if (!localEngine) {
      const discovery = createDiscovery({ config });
      const store = createStore({});
      localEngine = { discovery, store, service: createService({ config, discovery, store }) };
    }
    return localEngine;
  };
  const statusBase = () => {
    const e = engine();
    return { config, discovery: e.discovery, store: e.store, service: e.service };
  };

  // —— companion 桥 ——
  let scheduleContext = "";
  const baseUrl = () => {
    const u = String(config.baseUrl || "").trim().replace(/\/+$/, "");
    return u || "http://127.0.0.1:18789";
  };

  const refreshScheduleContext = async (request) => {
    try {
      const schedule = await request("/tools/get_classisland_schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      if (schedule?.ok !== true) throw new Error(schedule?.error?.message || schedule?.error || "获取课表失败");
      const data = schedule.result;
      if (!data?.has_schedule || !Array.isArray(data.entries)) { scheduleContext = "今天没有安排课表。"; return; }
      const now = parseLocal(data.now_local || data.now);
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const toMinutes = (time) => { const [h, m] = String(time || "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
      let currentIndex = -1;
      for (let i = 0; i < data.entries.length; i++) {
        const entry = data.entries[i];
        const start = toMinutes(entry.start);
        const end = toMinutes(entry.end);
        if (end <= start) continue;
        if (nowMinutes >= start && nowMinutes < end) { currentIndex = i; break; }
      }
      let currentName = "";
      let nextName = "";
      if (currentIndex >= 0) {
        currentName = entryName(data.entries[currentIndex]);
        for (let i = currentIndex + 1; i < data.entries.length; i++) {
          const name = entryName(data.entries[i]);
          if (name) { nextName = name; break; }
        }
      }
      const dayNames = data.entries.map(entryName).filter(Boolean);
      const parts = [];
      if (currentName) parts.push(`当前活动：${currentName}`);
      if (nextName) parts.push(`下个活动：${nextName}`);
      if (dayNames.length) parts.push(`今日活动：${dayNames.join(" → ")}`);
      parts.push(`（来源：ClassIsland 课表 ${data.date} ${data.weekday || ""}；以上上下文仅供参考，回答前请调用 get_classisland_schedule 等工具确认。）`);
      scheduleContext = parts.join("\n");
    } catch {
      scheduleContext = "";
    }
  };

  let connected = false;
  let registeredTools = [];

  const request = async (path, init = {}) => {
    const response = await api.fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init.headers || {}) },
      signal: AbortSignal.timeout(3000)
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error(`ClassIsland 返回了无效服务响应（${response.status}）`); }
    if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `ClassIsland 服务请求失败（${response.status}）`);
    return payload;
  };

  const unregister = () => {
    for (const name of registeredTools) api.unregisterTool(name);
    registeredTools = [];
    scheduleContext = "";
    connected = false;
  };

  // Skill 由本插件持有且独立于 companion 在线状态（本地直连工具章节始终有效）：
  // activate 注册一次，dispose 注销一次；companion 掉线只影响它的动态工具。
  let skillRegistered = false;
  const ensureSkill = () => {
    if (!skillRegistered) { api.registerSkill(SKILL_PATH, SKILL_AUTOLOAD); skillRegistered = true; }
  };

  const refresh = async () => {
    try {
      const health = await request("/health");
      const catalog = await request("/tools");
      if (health?.apiVersion !== 1 || catalog?.apiVersion !== 1 || health?.status !== "ok" || !Array.isArray(catalog?.tools)) throw new Error("ClassIsland 服务响应不完整");

      unregister();
      for (const tool of catalog.tools) {
        if (!tool || typeof tool.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(tool.name)) continue;
        api.registerTool({
          name: tool.name,
          description: tool.description || `调用 ClassIsland 工具 ${tool.name}`,
          inputSchema: tool.inputSchema || { type: "object", additionalProperties: false },
          hidden: tool.hidden ?? true
        }, async (args) => {
          const result = await request(`/tools/${encodeURIComponent(tool.name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args || {})
          });
          if (result?.ok !== true) throw new Error(result?.error?.message || result?.error || "ClassIsland 工具调用失败");
          return result.result;
        });
        registeredTools.push(tool.name);
      }
      connected = true;
      await refreshScheduleContext(request);
      api.setStatus(`已连接 ClassIsland（联动 ${registeredTools.length} 个工具；本机直连换课就绪）`);
    } catch (error) {
      unregister();
      // The connector itself is healthy; the companion service may simply be offline.
      api.setStatus(`CI 端联动服务离线（${error instanceof Error ? error.message : String(error)}）。本机直连换课工具仍可用；如需联动工具，请在 ClassIsland 设置页安装并启动「SecAgent 联动」。`);
    }
  };

  // —— 本地工具（官方 IPC 实时 + 结构化文件编辑，来自 0.1.1 课表驱动）——
  api.registerTool(
    {
      name: "classisland_status",
      description:
        "ClassIsland 本机直连诊断：自动发现数据目录、列出课表档案、解析校验、探测 ClassIsland 是否运行（IPC 管道），运行中则实测官方 IPC 通道（握手+读取当前档案）。首次安装、找不到课表、任何本直连工具报错时先运行本工具。CI 端联动服务状态用 get_classisland_version_status。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          full: { type: "boolean", description: "附完整自检明细（默认 true）" }
        }
      },
      hidden: false
    },
    guarded("classisland_status", async ({ full = true } = {}) => {
      const st = await engine().service.status();
      let doctor = null;
      if (full) {
        const d = await runDoctor(statusBase());
        doctor = { ok: d.ok, report: formatDoctorReport(d), checks: d.checks };
      }
      return { ok: st.ok, status: st, doctor, companion: { connected, tools: registeredTools.length, baseUrl: baseUrl() } };
    })
  );

  api.registerTool(
    {
      name: "classisland_read",
      description:
        "读取 ClassIsland 课表（本机直连）：档案列表与详情（科目/时间表/课表群/临时层状态）、可按日期看当天课程表。日常查课优先用 get_classisland_schedule（联动服务）；要档案结构/课表群/时间表细节或联动服务离线时用本工具。day 参数用 yyyy-mm-dd。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          profile: { type: "string", description: "档案文件名（缺省=当前档案）" },
          day: { type: "string", description: "查看某天课程表（yyyy-mm-dd，按星期规则推导）" },
          live: { type: "boolean", description: "附加 IPC 实时读取（运行中内存态与当前档案路径）" }
        }
      },
      hidden: false
    },
    guarded("classisland_read", (args) => engine().service.read(args))
  );

  api.registerTool(
    {
      name: "classisland_edit",
      description:
        "编辑 ClassIsland 课表（本机直连，operations 数组，逐个应用、失败即停不写盘）。可用操作：setClassSubject（单节换课）、setPlanEnabled、addSubject、renameSubject、duplicatePlan、renamePlan、setTempPlan（临时层换课：复制源课表+当天生效，官方临时层语义）、clearTempPlan（清除临时层）、orderPlan（预定某天用某课表）。写入前做结构校验并原子落盘（自动备份）。ClassIsland 运行中会拒绝文件写入（RUNNING_GUARD）——运行中的临时换课优先用联动工具 swap_classisland_classes / change_classisland_class（temporary 默认 true），或退出 ClassIsland 后改档案文件。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["operations"],
        properties: {
          profile: { type: "string", description: "目标档案文件名（缺省=当前档案）" },
          mode: { type: "string", enum: ["auto", "file_only"], description: "auto=按设置页写入守卫；file_only=运行状态未知时仍写文件" },
          operations: {
            type: "array",
            description: "要应用的操作列表",
            items: {
              type: "object",
              additionalProperties: true,
              required: ["op"],
              properties: {
                op: {
                  type: "string",
                  enum: ["setClassSubject", "setPlanEnabled", "addSubject", "renameSubject", "duplicatePlan", "renamePlan", "setTempPlan", "clearTempPlan", "orderPlan"]
                }
              }
            }
          }
        }
      },
      hidden: false
    },
    guarded("classisland_edit", (args) => {
      const mode = args.mode || (config.writeGuard === "file_only" ? "file_only" : "auto");
      return engine().service.edit({ ...args, mode });
    })
  );

  api.registerTool(
    {
      name: "classisland_switch_profile",
      description:
        "切换课表档案（=换整套课表，如平时/考试/放假）：ClassIsland 运行中走官方 IPC set_CurrentProfilePath 立即生效（这是联动服务不具备的实时能力）；未运行则写 Settings.json（下次启动生效）。to 传档案文件名（classisland_read/status 可列出）。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["to"],
        properties: {
          to: { type: "string", description: "目标档案文件名，如 exam.json" },
          mode: { type: "string", enum: ["auto", "file_only"] }
        }
      },
      hidden: false
    },
    guarded("classisland_switch_profile", (args) => {
      const mode = args.mode || (config.writeGuard === "file_only" ? "file_only" : "auto");
      return engine().service.switchProfile({ ...args, mode });
    })
  );

  api.registerTool(
    {
      name: "classisland_open",
      description:
        "打开 ClassIsland 页面（运行中经官方 IPC 导航，未运行返回可 shell 打开的 URI）。page 可选：settings/profileAdjustment（临时换课窗口）/notification/automation/about/plugins；或直接传 uri。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          page: { type: "string", enum: ["settings", "profileAdjustment", "notification", "automation", "about", "plugins"] },
          uri: { type: "string", description: "自定义 classisland:// URI" }
        }
      },
      hidden: false
    },
    guarded("classisland_open", (args) => engine().service.open(args))
  );

  api.registerTool(
    {
      name: "classisland_ipc",
      description:
        "高级：直接调用 ClassIsland 官方 IPC 成员（key 见返回的 available 列表）。用于诊断协议兼容性/实验 set_Profile 等未封装能力。普通课表操作不需要本工具。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["key"],
        properties: {
          key: { type: "string", description: "成员 key，如 profile.currentPath.get" },
          args: { type: "array", description: "调用参数（JSON 值）" }
        }
      },
      hidden: true
    },
    guarded("classisland_ipc", (args) => engine().service.ipcCall(args))
  );

  // —— 设置页（SecAgent 设置 → ClassIsland联动）：describe/set，保存即生效 ——
  if (typeof api.registerSettingsHandler === "function") {
    api.registerSettingsHandler("connection", async (action, args = {}) => {
      if (action === "describe") {
        return { ok: true, ...describeSettings(), values: mergeConfig(typeof api.getConfig === "function" ? api.getConfig() : {}) };
      }
      if (action === "set") {
        const merged = mergeConfig({ ...config, ...args });
        if (typeof api.setConfig === "function") await api.setConfig(merged);
        config = merged;
        localEngine = null; // 数据目录/管道/超时/守卫下次调用即按新值重建
        await refresh();     // 联动地址变更立即重连
        return { ok: true, values: merged };
      }
      if (action === "test") {
        // 手动自检：联动服务 + 本机直连各报一声
        let companion = { ok: false, error: "未连接" };
        try {
          const health = await request("/health");
          companion = { ok: health?.status === "ok", tools: registeredTools.length, baseUrl: baseUrl() };
        } catch (e) {
          companion = { ok: false, error: String(e?.message || e) };
        }
        const st = await engine().service.status();
        return { ok: true, companion, local: { ok: st.ok, dataRoot: st.dataRoot, running: st.running, ipc: st.ipc && st.ipc.ok, profiles: st.profiles.length } };
      }
      return { ok: false, error: `未知 action：${action}` };
    });
  }

  api.registerPrompt(SCHEDULE_PROMPT, () => scheduleContext);
  ensureSkill();
  await refresh();
  const timer = setInterval(refresh, 5000);
  timer.unref?.();
  return () => { clearInterval(timer); api.unregisterPrompt(SCHEDULE_PROMPT); unregister(); if (skillRegistered) api.unregisterSkill(SKILL_PATH); };
}
