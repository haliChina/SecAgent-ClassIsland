// 环境自检：数据目录 → 档案解析 → 运行探测 → IPC 实连 ping。
// 逐项给出 pass/fail + 修复建议；install 后第一件事就是跑它。

import { validateProfile } from "./model.mjs";

export async function runDoctor({ service, discovery, store, platform = process.platform }) {
  const checks = [];
  const add = (id, title, fn) => checks.push((async () => {
    try {
      const r = await fn();
      return { id, title, ...r };
    } catch (e) {
      return { id, title, ok: false, error: String(e && e.message || e) };
    }
  })());

  add("platform", "平台", async () => {
    const ok = platform === "win32";
    return {
      ok,
      detail: platform === "win32" ? "Windows（全功能）" : `${platform}：文件读与数据检查可用，写入与 IPC 仅 Windows`,
      fix: ok ? null : "在 Windows 上运行 SecAgent 以启用完整功能。"
    };
  });

  add("data-dir", "数据目录", async () => {
    const d = await discovery.discover();
    return {
      ok: d.ok,
      detail: d.ok ? `${d.dataRoot}（${d.source}）` : (d.detail || "未找到"),
      fix: d.ok ? null : "在插件设置中手动指定 dataDir（ClassIsland 安装版默认 %APPDATA%\\ClassIsland\\Data，便携版为程序旁 data\\）。"
    };
  });

  add("profiles", "课表档案", async () => {
    const d = await discovery.discover();
    if (!d.ok) return { ok: false, skipped: true, detail: "无数据目录" };
    const files = await discovery.listProfiles(d.profilesDir);
    if (files.length === 0) return { ok: false, detail: "Profiles 目录为空", fix: "先在 ClassIsland 里创建课表。" };
    const bad = [];
    for (const f of files) {
      const r = await store.readProfile(f.path);
      if (!r.ok) { bad.push(`${f.file}: ${r.error}`); continue; }
      const v = validateProfile(r.data);
      if (!v.ok) bad.push(`${f.file}: ${v.errors.join(";")}`);
    }
    return {
      ok: bad.length === 0,
      detail: bad.length === 0 ? `${files.length} 个档案全部解析通过` : `异常：${bad.join(" | ")}`,
      fix: bad.length ? "用 ClassIsland 自带备份恢复，或删除损坏档案重建。" : null
    };
  });

  add("settings", "当前档案设置", async () => {
    const d = await discovery.discover();
    if (!d.ok) return { ok: false, skipped: true, detail: "无数据目录" };
    const s = await discovery.readSelectedProfile(d.dataRoot);
    return {
      ok: s.ok,
      detail: s.ok ? `当前档案：${s.selectedProfile}` : s.error,
      fix: s.ok ? null : "首次启动 ClassIsland 生成 Settings.json 后重试。"
    };
  });

  add("running", "ClassIsland 进程/管道", async () => {
    const r = await service.probeRunning();
    return {
      ok: r.checked,
      detail: r.running === true ? "运行中（IPC 管道存在）" : r.running === false ? "未运行" : (r.error || "未知"),
      fix: null
    };
  });

  add("ipc", "IPC 通道（官方接口）", async () => {
    const st = await service.status();
    if (st.running !== true) {
      return { ok: true, skipped: true, detail: "ClassIsland 未运行，跳过 IPC 实连（status 工具里会自动探测）" };
    }
    const ipc = st.ipc;
    if (!ipc) return { ok: false, detail: "未执行", fix: "重跑 classisland_status。" };
    return {
      ok: ipc.ok,
      detail: ipc.ok ? `已握手成功，当前档案 = ${ipc.currentProfilePath}` : (ipc.error || "握手失败"),
      fix: ipc.ok ? null : "确认 ClassIsland ≥ 1.5.3（IPC v2）；杀毒软件拦截 Node 管道访问时信任 SecAgent。"
    };
  });

  const results = await Promise.all(checks);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  return { ok: failed.length === 0, checks: results };
}

export function formatDoctorReport(result) {
  const lines = ["ClassIsland 插件自检："];
  for (const c of result.checks) {
    const mark = c.skipped ? "—" : c.ok ? "✓" : "✗";
    lines.push(`[${mark}] ${c.title}：${c.detail || ""}`);
    if (!c.ok && !c.skipped && c.fix) lines.push(`      建议：${c.fix}`);
    if (c.error) lines.push(`      错误：${c.error}`);
  }
  lines.push(result.ok ? "全部通过。" : "存在失败项，按建议修复后重试。");
  return lines.join("\n");
}
