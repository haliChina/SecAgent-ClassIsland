// SecAgent ClassIsland 插件入口。
// 由宿主动态 import 并调用 activate(api)。
// 功能：连接测试（数据目录/运行探测/IPC 实连）、读课表、结构化编辑课表
//（含官方语义的临时层换课）、切换课表档案（运行中走官方 IPC 实时生效）、
// URI 导航、高级 IPC 直调。

import { createService } from "./driver/service.mjs";
import { runDoctor, formatDoctorReport } from "./driver/doctor.mjs";
import { createDiscovery } from "./driver/discovery.mjs";
import { createStore } from "./driver/store.mjs";
import { mergeConfig, describeSettings, DEFAULT_CONFIG } from "./settings/config-schema.mjs";

function structuredError(tool, e) {
  return {
    ok: false,
    code: (e && e.code) || "INTERNAL",
    error: String((e && e.message) || e),
    tool
  };
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
  const raw = typeof api.getConfig === "function" ? api.getConfig() : {};
  const config = mergeConfig(raw);

  const discovery = createDiscovery({ config });
  const store = createStore({});
  const service = createService({ config, discovery, store });

  const statusBase = () => ({ config, discovery, store, service });

  api.registerTool(
    {
      name: "classisland_status",
      description:
        "ClassIsland 连接测试与现状诊断：自动发现数据目录、列出课表档案、解析校验、探测 ClassIsland 是否运行（IPC 管道），运行中则实测官方 IPC 通道（握手+读取当前档案）。首次安装、找不到课表、任何工具报错时先运行本工具。",
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
      const st = await service.status();
      let doctor = null;
      if (full) {
        const d = await runDoctor(statusBase());
        doctor = { ok: d.ok, report: formatDoctorReport(d), checks: d.checks };
      }
      return { ok: st.ok, status: st, doctor };
    })
  );

  api.registerTool(
    {
      name: "classisland_read",
      description:
        "读取 ClassIsland 课表：档案列表与详情（科目/时间表/课表群/临时层状态）、可按日期看当天课程表。回复用户“今天有什么课/课表长什么样/现在上到哪”先调用本工具。day 参数用 yyyy-mm-dd。",
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
    guarded("classisland_read", (args) => service.read(args))
  );

  api.registerTool(
    {
      name: "classisland_edit",
      description:
        "编辑 ClassIsland 课表（operations 数组，逐个应用、失败即停不写盘）。可用操作：setClassSubject（单节换课）、setPlanEnabled、addSubject、renameSubject、duplicatePlan、renamePlan、setTempPlan（临时层换课：复制源课表+当天生效，官方临时层语义）、clearTempPlan（清除临时层）、orderPlan（预定某天用某课表）。写入前做结构校验并原子落盘（自动备份）。ClassIsland 运行中会拒绝文件写入（RUNNING_GUARD）——先让用户退出，或用临时换课/切换档案替代。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["operations"],
        properties: {
          profile: { type: "string", description: "目标档案文件名（缺省=当前档案）" },
          mode: { type: "string", enum: ["auto", "file_only"], description: "auto=默认守卫；file_only=运行状态未知时仍写文件" },
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
    guarded("classisland_edit", (args) => service.edit(args))
  );

  api.registerTool(
    {
      name: "classisland_switch_profile",
      description:
        "切换课表档案（=换整套课表，如平时/考试/放假）：ClassIsland 运行中走官方 IPC set_CurrentProfilePath 立即生效；未运行则写 Settings.json（下次启动生效）。to 传档案文件名（classisland_read/status 可列出）。",
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
    guarded("classisland_switch_profile", (args) => service.switchProfile(args))
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
    guarded("classisland_open", (args) => service.open(args))
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
      hidden: false
    },
    guarded("classisland_ipc", (args) => service.ipcCall(args))
  );

  // Skill：命中 ClassIsland/课表相关话题时自动加载总纲。
  api.registerSkill(
    "skills/classisland",
    /classisland|课表|课程表|换课|调课|上什么课|第几节|班级课表|timetable/i
  );

  // 设置页（宿主设置 UI）。
  if (typeof api.registerSettingsHandler === "function") {
    api.registerSettingsHandler("classisland-settings", async (action, args = {}) => {
      if (action === "describe") {
        return { ok: true, ...describeSettings(), values: mergeConfig(typeof api.getConfig === "function" ? api.getConfig() : {}) };
      }
      if (action === "set") {
        const merged = mergeConfig({ ...config, ...args });
        if (typeof api.setConfig === "function") await api.setConfig(merged);
        Object.assign(config, merged);
        return { ok: true, values: merged };
      }
      return { ok: false, error: `未知 action：${action}` };
    });
  }

  if (process.platform !== "win32") {
    api.setStatus("ClassIsland 插件已加载：读/诊断可用，写入与 IPC 需 Windows", "ready");
  } else {
    api.setStatus("ClassIsland 插件已就绪");
  }

  return async () => {};
}
