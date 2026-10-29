// 总装服务层：把 discovery/store/plan-ops/ipc-client 组装成工具后端。
// 核心纪律：
//  - fail-closed：运行中的 ClassIsland 不监视 Profile 文件且会用内存覆盖磁盘，
//    所以「文件写」仅在未运行时允许；运行中的变更走 IPC 通道（官方 API），
//    IPC 不可用则结构化报错并给出建议，绝不盲写。
//  - 管道存在 ≈ ClassIsland 运行中（进程退出管道即消失）——运行探测即管道探测。

import { createIpcClient } from "./ipc/client.mjs";
import { MEMBERS, DEFAULT_PIPE } from "./ipc/api.mjs";
import { createWinTransport } from "./ipc/transport-win.mjs";
import { validateProfile, summarizeProfile, resolvePlanForDate, describePlan } from "./model.mjs";
import path from "node:path";

export function createService({ config, discovery, store, platform = process.platform, now = () => new Date(), requestTimeoutMs = 8000, logger = () => {} } = {}) {
  const pipeOf = () => config.pipeName || DEFAULT_PIPE; // 管道名热读（设置页改完立即生效）

  function isWin() { return platform === "win32"; }

  // —— 运行探测：尝试打开发送管道（连上即运行中，随即关闭，不发注册帧） ——
  async function probeRunning() {
    if (!isWin()) return { running: false, checked: false, reason: "非 Windows 平台" };
    try {
      const transport = createWinTransport({ logger });
      const send = await transport.connectSend(pipeOf());
      send.close();
      return { running: true, checked: true };
    } catch (e) {
      const msg = String(e && e.message || e);
      const notFound = /ENOENT|pipe/i.test(e?.code || "") || /找不到|not exist|No such/i.test(msg);
      if (notFound) return { running: false, checked: true };
      return { running: null, checked: true, error: msg };
    }
  }

  // —— IPC ——
  async function withIpc(fn, opts = {}) {
    if (!isWin()) return { ok: false, error: "IPC 仅 Windows 可用", code: "PLATFORM" };
    // 设置页可整体关闭 IPC 通道（排查环境问题时用）：写路径随之全部 fail-closed。
    if (config.ipcEnabled === false) return { ok: false, error: "IPC 通道已在设置中关闭", code: "IPC_DISABLED" };
    const transport = createWinTransport({ logger });
    // 超时从 config 热读（设置页改完立即生效），requestTimeoutMs 参数仅作缺省兜底
    const timeout = opts.timeoutMs || Number(config.requestTimeoutMs) || requestTimeoutMs;
    const client = createIpcClient({ pipeName: pipeOf(), transport, requestTimeoutMs: timeout, logger });
    try {
      const conn = await client.connect();
      if (!conn.ok) return conn;
      return await fn(client);
    } finally {
      await client.close().catch(() => {});
    }
  }

  async function ipcPing() {
    return withIpc(async (client) => {
      const r = await client.invoke("profile.currentPath.get");
      if (r.ok) return { ok: true, currentProfilePath: r.value, latencyMs: r.latencyMs };
      return { ok: false, error: r.error, code: r.code || "IPC_FAIL" };
    });
  }

  // —— 状态/连接测试 ——
  async function status() {
    const d = await discovery.discover();
    const out = {
      ok: d.ok,
      platform: platform,
      dataRoot: d.dataRoot ?? null,
      profilesDir: d.profilesDir ?? null,
      discoverySource: d.source || null,
      discoveryDetail: d.detail || null,
      running: null,
      ipc: null,
      profiles: [],
      currentProfile: null,
      settingsPath: null,
      warnings: [],
      errors: []
    };
    if (d.ok) {
      out.profiles = await discovery.listProfiles(d.profilesDir);
      const sel = await discovery.readSelectedProfile(d.dataRoot);
      if (sel.ok) {
        out.currentProfile = sel.selectedProfile;
        out.settingsPath = sel.settingsPath;
      } else if (sel.warningOnly) {
        out.warnings.push(`Settings.json：${sel.error}`);
        out.currentProfile = "Default.json"; // 兜底
      } else {
        out.errors.push(`Settings.json：${sel.error}`);
      }
    } else {
      out.errors.push(d.detail || d.error || "数据目录未找到");
    }
    const run = await probeRunning();
    out.running = run.checked ? run.running : null;
    if (run.error) out.errors.push(`运行探测：${run.error}`);
    if (run.running) {
      out.ipc = await ipcPing();
    }
    out.ok = Boolean(out.ok && d.ok);
    return out;
  }

  // —— 读 ——
  async function read({ profile = null, live = false, day = null } = {}) {
    const d = await discovery.discover();
    if (!d.ok) return { ok: false, error: `数据目录未找到：${d.detail || ""}`, code: "NO_DATA_DIR" };
    const sel = await discovery.readSelectedProfile(d.dataRoot);
    const file = profile || sel.selectedProfile || "Default.json";
    const full = `${d.profilesDir}${d.profilesDir.endsWith("/") ? "" : "/"}${file}`;
    const r = await store.readProfile(full);
    if (!r.ok) return { ok: false, error: `读取档案失败：${r.error}`, code: r.code, file: full };
    const v = validateProfile(r.data);
    if (!v.ok) return { ok: false, error: `档案结构异常：${v.errors.join("；")}`, code: "PROFILE_INVALID", file: full };
    const view = summarizeProfile(r.data, { currentPath: file });
    const result = { ok: true, file: full, profile: file, view, warnings: v.warnings || [] };
    if (day) {
      const resolved = resolvePlanForDate(r.data, day);
      const dayOut = { date: day, source: resolved.source, weekday: resolved.weekday || null };
      if (resolved.plan) Object.assign(dayOut, describePlan(r.data, resolved.plan));
      if (resolved.candidates) dayOut.candidates = resolved.candidates;
      result.day = dayOut;
      if (view.overlayClassPlan && day === todayLocal()) {
        const op = view.overlayClassPlan;
        const overlayPlan = (r.data.ClassPlans || {})[op.planId];
        if (overlayPlan) {
          result.day = { date: day, source: `overlay:${op.planId}`, ...describePlan(r.data, overlayPlan) };
        }
      }
    }
    if (live) {
      result.live = await withIpc(async (client) => {
        const r2 = await client.invoke("profile.currentPath.get");
        if (!r2.ok) return { ok: false, error: r2.error };
        const r3 = await client.invoke("profile.get");
        if (!r3.ok) return { ok: false, error: r3.error };
        return { ok: true, currentProfilePath: r2.value, memoryProfile: r3.value };
      });
    }
    return result;
  }

  function todayLocal() {
    const n = now();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, "0");
    const dd = String(n.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  // —— 编辑 ——
  async function edit({ profile = null, operations = [], mode = "auto" } = {}) {
    const d = await discovery.discover();
    if (!d.ok) return { ok: false, error: `数据目录未找到：${d.detail || ""}`, code: "NO_DATA_DIR" };
    const run = await probeRunning();
    if (run.running && mode !== "file_only") {
      return {
        ok: false,
        code: "RUNNING_GUARD",
        error: "ClassIsland 正在运行：它不监视档案文件，且任何界面操作都会用内存数据覆盖磁盘。为避免改动丢失，请先退出 ClassIsland 再执行文件写入，或改用 IPC 通道（classisland_ipc 工具，官方 set_Profile 试验通道）。",
        suggestion: "退出 ClassIsland 后重试，或 classisland_status 查看 IPC 能力。"
      };
    }
    if (run.running === null && mode === "auto") {
      return { ok: false, code: "RUN_UNKNOWN", error: `无法确认 ClassIsland 是否运行（${run.error}）。为安全起见拒绝写入；确认未运行后可用 mode:"file_only"。` };
    }
    const sel = await discovery.readSelectedProfile(d.dataRoot);
    const file = profile || sel.selectedProfile || "Default.json";
    const full = `${d.profilesDir}${d.profilesDir.endsWith("/") ? "" : "/"}${file}`;
    const r = await store.readProfile(full);
    if (!r.ok) return { ok: false, error: `读取失败：${r.error}`, code: r.code, file: full };
    const applied = await import("./plan-ops.mjs").then((m) => m.applyOperations(r.data, operations));
    if (!applied.ok) return { ok: false, error: applied.error, code: applied.code, applied: applied.applied, file: full };
    const v = validateProfile(applied.profile);
    if (!v.ok) return { ok: false, error: `编辑后档案未通过结构校验（已放弃写入）：${v.errors.join("；")}`, code: "PROFILE_INVALID", file: full };
    const w = await store.writeProfile(full, applied.profile);
    if (!w.ok) return { ok: false, error: `写入失败：${w.error}`, code: "WRITE_FAIL", file: full };
    return { ok: true, file: full, profile: file, applied: applied.applied, backup: w.backup, changed: applied.changed, note: "已原子写入（旧版本备份于 .secagent-bak.json）。下次 ClassIsland 启动生效。" };
  }

  // —— 换课表（档案） ——
  async function switchProfile({ to, mode = "auto" } = {}) {
    if (!to || !/^[^\\/]+\.json$/i.test(to)) {
      return { ok: false, error: `档案名不合法（应为文件名如 my.json）：${to}`, code: "NAME_INVALID" };
    }
    const d = await discovery.discover();
    if (!d.ok) return { ok: false, error: `数据目录未找到：${d.detail || ""}`, code: "NO_DATA_DIR" };
    const files = (await discovery.listProfiles(d.profilesDir)).map((x) => x.file);
    if (!files.includes(to)) {
      return { ok: false, error: `档案不存在：${to}（可用：${files.join(", ")}）`, code: "PROFILE_NOT_FOUND", available: files };
    }
    const run = await probeRunning();
    if (run.running) {
      const r = await withIpc(async (client) => client.invoke("profile.currentPath.set", [to]));
      if (r.ok) {
        return { ok: true, via: "ipc", profile: to, note: "已通过官方 IPC set_CurrentProfilePath 切换，运行中的 ClassIsland 立即生效。" };
      }
      if (mode !== "file_only") {
        return { ok: false, code: "IPC_FAIL", error: `IPC 切换失败：${r.error}`, suggestion: "可退出 ClassIsland 后重试（将写 Settings.json）。" };
      }
    }
    if (run.running === true && mode === "file_only") {
      // 用户明确要求文件直写：提示风险但仍执行（写 Settings 而非 Profile，冲突面小）
      // —— Settings 的内存覆盖风险同样存在，警告里说清。
    }
    const sel = await discovery.readSelectedProfile(d.dataRoot);
    // 找不到既有 Settings.json 时，写标准位置 Config/Settings.json（新建）
    const settingsFile = sel.ok ? sel.settingsPath : path.join(d.dataRoot, "Config", "Settings.json");
    const w = await store.writeSelected(settingsFile, to);
    if (!sel.ok && w.ok) w.created = true;
    if (!w.ok) return { ok: false, error: w.error, code: "WRITE_FAIL" };
    return {
      ok: true, via: "file", profile: to, backup: w.backup,
      note: run.running ? "已写入 Settings.json（ClassIsland 运行中，界面里再次保存设置可能覆盖此值；建议退出后切换）。" : "已写入 Settings.json，下次启动 ClassIsland 生效。"
    };
  }

  // —— 打开页面（URI） ——
  async function open({ page = "settings", uri = null } = {}) {
    const { URI_PAGES } = await import("./ipc/api.mjs");
    const target = uri || URI_PAGES[page];
    if (!target) return { ok: false, error: `未知页面：${page}`, code: "PAGE_UNKNOWN", pages: Object.keys(URI_PAGES) };
    const run = await probeRunning();
    let ipcResult = null;
    if (run.running) {
      ipcResult = await withIpc(async (client) => client.invoke("uri.navigate", [target]));
      if (ipcResult.ok) return { ok: true, uri: target, via: "ipc" };
    }
    return {
      ok: true,
      uri: target,
      via: "shell-open",
      hint: ipcResult
        ? `IPC 导航失败（${ipcResult.error}），改用系统 URI 唤起。`
        : "ClassIsland 未运行：URI 将在它启动时被导航（单实例转发机制）。请用系统 shell 打开此 URI（start/cmd /c start）。"
    };
  }

  // —— 高级 IPC 直调 ——
  async function ipcCall({ key, args = [], timeoutMs } = {}) {
    if (!MEMBERS[key]) {
      return { ok: false, error: `未知 IPC 成员：${key}`, code: "KEY_UNKNOWN", available: Object.keys(MEMBERS) };
    }
    return withIpc(async (client) => client.invoke(key, args), { timeoutMs });
  }

  return { status, read, edit, switchProfile, open, ipcCall, probeRunning };
}
