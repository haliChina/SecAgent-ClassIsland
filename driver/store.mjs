// 文件通道：ClassIsland Profile / Settings 的安全读写。
// 纪律：
//  - 读：JSON.parse 容错（写一半的文件报结构化错误，不崩）
//  - 写：先备份（.bak）→ 写临时文件 → 校验回读 → 原子 rename
//  - 运行中的 ClassIsland 不监视 Profile 文件且会用内存覆盖磁盘 →
//    所有写入口必须先过 runningGuard（service 层负责，本层不检查）

import { promises as fsp } from "node:fs";
import path from "node:path";

export function createStore({ fs = fsp } = {}) {

  async function readJson(file) {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (e) {
      return { ok: false, error: `读取失败：${e && e.message || e}`, code: "READ_FAIL" };
    }
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch (e) {
      return { ok: false, error: `JSON 解析失败（文件可能被写坏）：${e && e.message || e}`, code: "PARSE_FAIL", raw: text.slice(0, 300) };
    }
  }

  /** 原子写 JSON：备份 → tmp → 回读 → rename。 */
  async function writeJsonAtomic(file, data, { indent = 2 } = {}) {
    const tmp = `${file}.secagent-tmp`;
    const bak = `${file}.secagent-bak.json`;
    const text = JSON.stringify(data, null, indent) + "\n";
    try {
      // 备份现有文件（存在才备）
      try {
        await fs.copyFile(file, bak);
      } catch (e) {
        if (e && e.code !== "ENOENT") throw e;
      }
      await fs.writeFile(tmp, text, "utf8");
      // 回读校验
      const check = await fs.readFile(tmp, "utf8");
      const reparsed = JSON.parse(check);
      if (JSON.stringify(reparsed) !== JSON.stringify(data)) {
        throw new Error("回读校验不一致");
      }
      await fs.rename(tmp, file);
      return { ok: true, backup: bak };
    } catch (e) {
      try { await fs.unlink(tmp); } catch {}
      return { ok: false, error: `原子写失败：${e && e.message || e}`, code: "WRITE_FAIL" };
    }
  }

  /** 读档案并校验结构。 */
  async function readProfile(file) {
    const r = await readJson(file);
    if (!r.ok) return r;
    return { ok: true, data: r.data, file };
  }

  /** 写档案（外部已做完运行守卫与业务校验）。 */
  async function writeProfile(file, data) {
    return writeJsonAtomic(file, data);
  }

  /** 读/写 Settings.json 的 SelectedProfile。 */
  async function readSelected(settingsFile) {
    const r = await readJson(settingsFile);
    if (!r.ok) return r;
    return { ok: true, settings: r.data, selected: r.data.SelectedProfile ?? null };
  }

  async function writeSelected(settingsFile, nextProfile) {
    const r = await readJson(settingsFile);
    if (!r.ok) return r;
    const settings = r.data;
    settings.SelectedProfile = nextProfile;
    const w = await writeJsonAtomic(settingsFile, settings);
    if (!w.ok) return w;
    return { ok: true, backup: w.backup, settingsFile };
  }

  return { readJson, writeJsonAtomic, readProfile, writeProfile, readSelected, writeSelected };
}
