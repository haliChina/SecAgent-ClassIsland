// Windows 生产传输：dotnetCampus.Ipc 双半工管道的 Node 落地。
//   发送：fs.open(对方管道, 'w')——GENERIC_WRITE，兼容对方的 In-only 管道；
//         失败时（权限异常等）koffi CreateFileW 兜底（动态加载，不强制依赖）。
//   接收：net.Server 监听 \\.\pipe\<随机名>，等 ClassIsland 回连收响应。
// 传输契约（与 client.mjs / mock 测试传输一致）：
//   connectSend(): Promise<{write(bytes), close()}>
//   listen(name, onConnection): Promise<{pipeName, close()}>
//     onConnection(conn)：conn = {onData, onClose, close()}（由调用方注入回调）
// 仅 win32 可用；测试从不 import 本模块。

import { promises as fsp } from "node:fs";
import net from "node:net";
import { randomUUID } from "node:crypto";

const PIPE_PREFIX = "\\\\.\\pipe\\";

/** R77：管道名归一化（裸名 → \\.\pipe\ 裸名）。导出供测试。 */
export function normalizePipeName(name) {
  return String(name || "").startsWith(PIPE_PREFIX) ? String(name) : PIPE_PREFIX + String(name || "");
}

export function createWinTransport({ logger = () => {} } = {}) {

  async function connectSend(target) {
    // 实测坑（R77）：裸名不加 \\.\pipe\ 前缀时，fs.open 把它当相对路径在
    // cwd（C:\Program Files\SecAgent）下解析 → EPERM，且错误信息里没有
    // "pipe" 字样 → probeRunning 的 notFound 分类失效 → RUNNING 探测
    // 死路（用户换课被「无法确认是否运行」拒绝）。listen 侧一直有前缀，
    // connect 侧漏了。
    const full = normalizePipeName(target);
    try {
      const fh = await fsp.open(full, "w");
      return {
        write: async (bytes) => { await fh.write(bytes, 0, bytes.length, null); },
        close: () => { fh.close().catch(() => {}); }
      };
    } catch (primaryError) {
      // ERROR_FILE_NOT_FOUND（管道不存在 = ClassIsland 未运行）等场景直接抛原错误，
      // 只有权限类失败才值得 koffi 兜底。
      const code = primaryError?.code || "";
      if (code === "ENOENT" || /找不到文件|pipe/i.test(primaryError?.message || "")) {
        throw primaryError;
      }
      let koffi;
      try {
        koffi = (await import("koffi")).default || (await import("koffi"));
      } catch {
        throw primaryError;
      }
      try {
        const kernel32 = koffi.load("kernel32.dll");
        const CreateFileW = kernel32.func("__stdcall", "CreateFileW", "void*", ["str16", "uint32", "uint32", "void*", "uint32", "uint32", "void*"]);
        const WriteFile = kernel32.func("__stdcall", "WriteFile", "bool", ["void*", "void*", "uint32", "void*", "void*"]);
        const CloseHandle = kernel32.func("__stdcall", "CloseHandle", "bool", ["void*"]);
        const GENERIC_WRITE = 0x40000000;
        const OPEN_EXISTING = 3;
        const handle = CreateFileW(full, GENERIC_WRITE, 0, null, OPEN_EXISTING, 0, null);
        if (!handle) throw primaryError;
        return {
          write: async (bytes) => {
            const okFlag = WriteFile(handle, koffi.as(bytes, "uint8_t *"), bytes.length, null, null);
            if (!okFlag) throw new Error("WriteFile 失败");
          },
          close: () => { try { CloseHandle(handle); } catch {} }
        };
      } catch (e) {
        throw primaryError;
      }
    }
  }

  function listen(name, onConnection) {
    const pipeName = name || `secagent.ci.${randomUUID().slice(0, 13)}`.replace(/-/g, "");
    const full = PIPE_PREFIX + pipeName;
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      let settled = false;
      const queue = [];
      let waiter = onConnection || null;
      const dispatch = (conn) => { if (waiter) { const w = waiter; waiter = null; w(conn); } else queue.push(conn); };
      server.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
      server.on("connection", (socket) => {
        const conn = { onData: null, onClose: null, close: () => socket.destroy() };
        socket.on("data", (chunk) => { if (conn.onData) conn.onData(chunk); });
        socket.on("close", () => { if (conn.onClose) conn.onClose(); });
        socket.on("error", () => {});
        dispatch(conn);
      });
      server.listen(full, () => {
        if (settled) return;
        settled = true;
        resolve({
          pipeName,
          close: () => new Promise((res) => {
            try { server.close(() => res(true)); } catch { res(true); }
          })
        });
      });
    });
  }

  // 统一签名包装：listener = listen(name, onConnection)
  return { connectSend, listen };
}
