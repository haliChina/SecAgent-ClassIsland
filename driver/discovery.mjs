// ClassIsland 数据目录发现：配置 > 环境变量 > 常见安装位置。
// fs 与 env 均可注入（测试友好，Windows 下由真实模块传真实实现）。

import { promises as fsp } from "node:fs";
import path from "node:path";

export function createDiscovery({ config = {}, env = process.env, platform = process.platform, fs = fsp, home = null } = {}) {
  const candidates = [];

  function add(label, dir, note = "") {
    candidates.push({ label, dir, note });
  }

  async function exists(p) {
    try { await fs.access(p); return true; } catch { return false; }
  }

  async function profileDirOf(dataRoot) {
    const dir = path.join(dataRoot, "Profiles");
    const ok = await exists(dir);
    return { dir, ok };
  }

  /** 返回 {ok, dataRoot, profilesDir, source, detail}。 */
  async function discover() {
    candidates.length = 0;
    // 1) 显式配置
    if (config.dataDir) {
      const { dir, ok } = await profileDirOf(config.dataDir);
      add("config", path.join(config.dataDir, "Profiles"), "用户在设置中指定");
      if (ok) return result("config", dir);
      return { ok: false, dataRoot: config.dataDir, profilesDir: dir, source: "config", detail: "配置的 dataDir 下没有 Profiles 目录", candidates };
    }
    // 2) 环境变量
    if (env.CLASSISLAND_DATA_DIR) {
      const root = env.CLASSISLAND_DATA_DIR;
      const { dir, ok } = await profileDirOf(root);
      add("env", path.join(root, "Profiles"), "CLASSISLAND_DATA_DIR");
      if (ok) return result("env", dir);
    }
    // 3) 常见位置（Windows 安装版 = %APPDATA%\ClassIsland\Data；便携版 = exe 旁 data）
    if (platform === "win32") {
      const roaming = env.APPDATA || path.join(home || env.USERPROFILE || "C:\\Users\\Public", "AppData", "Roaming");
      add("appdata", path.join(roaming, "ClassIsland", "Data", "Profiles"), "安装版默认（Roaming）");
      const local = env.LOCALAPPDATA || path.join(home || env.USERPROFILE || "C:\\Users\\Public", "AppData", "Local");
      add("localappdata", path.join(local, "ClassIsland", "Data", "Profiles"), "部分版本使用 Local");
    } else {
      const h = home || env.HOME || "/home";
      add("linux-roaming", path.join(h, ".config", "ClassIsland", "Data", "Profiles"), "Linux 变体路径");
      add("linux-local", path.join(h, ".local", "share", "ClassIsland", "Data", "Profiles"), "Linux 变体路径");
    }
    for (const c of candidates) {
      if (await exists(c.dir)) return result(c.label, c.dir);
    }
    return { ok: false, dataRoot: null, profilesDir: null, source: "none", detail: "未找到 ClassIsland 数据目录，请在设置中指定 dataDir", candidates };
  }

  function result(source, dir) {
    return { ok: true, dataRoot: path.dirname(dir), profilesDir: dir, source, detail: null, candidates };
  }

  /** 列出档案（*.json，排除 _management-profile）。 */
  async function listProfiles(dir) {
    const entries = await fs.readdir(dir);
    const files = entries.filter((f) => f.endsWith(".json") && !f.startsWith("_management-profile"));
    const out = [];
    for (const f of files) {
      const full = path.join(dir, f);
      let size = null;
      try { const st = await fs.stat(full); size = st.size; } catch {}
      out.push({ file: f, path: full, size });
    }
    return out;
  }

  /** 读取设置里的当前档案（Config/Settings.json → SelectedProfile）。 */
  async function readSelectedProfile(dataRoot) {
    const settingsPath = path.join(dataRoot, "Config", "Settings.json");
    try {
      const text = await fs.readFile(settingsPath, "utf8");
      const settings = JSON.parse(text);
      return { ok: true, settingsPath, selectedProfile: settings.SelectedProfile ?? "Default.json", settings };
    } catch (e) {
      return { ok: false, settingsPath, selectedProfile: null, error: String(e && e.message || e) };
    }
  }

  return { discover, listProfiles, readSelectedProfile };
}
