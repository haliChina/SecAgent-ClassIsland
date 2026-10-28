// dotnetCampus.Ipc 客户端的协议逻辑层（与具体传输解耦）。
// 传输接口（transport）：
//   connectSend(): Promise<{ write(bytes): Promise<void>, close(): void }>
//     —— 连接对方管道（仅发送方向；对方管道为 In-only）
//   listen(pipeName, onConnection): Promise<{ pipeName, close(): Promise<void> }>
//     —— 在本地起管道服务端，等对方回连；onConnection(conn) 中
//        conn.onData(bytes)、conn.onClose() 回调注入
// 生产实现见 transport-win.mjs（fs.open 写 + net server 读）；
// 测试用内存 mock 对拍协议。
//
// 生命周期：
//   1. listen 本地随机名管道
//   2. connectSend 对方管道，发 PeerRegister（带本地管道名）
//   3. 对方回连本地管道；此连接上收到 ResponseMessage/PeerRegister
//   4. invoke(key, args) → RequestMessage(messageId 自增, 首条=0)
//      → 等待相同 messageId 的响应（超时）→ 解析 {r,e}

import { buildFrame, buildPeerRegisterContent, createFrameReader, buildRequestFrame, parseResponseContent, invokeModel, parseReturnModel, CMD } from "./proto.mjs";
import { MEMBERS, DEFAULT_PIPE } from "./api.mjs";
import { randomUUID } from "node:crypto";

export function createIpcClient({ pipeName = DEFAULT_PIPE, transport, requestTimeoutMs = 8000, logger = () => {} }) {
  let ack = 0;
  let messageId = 0;
  let send = null; // { write, close }
  let server = null; // { pipeName, close }
  let conn = null; // 接收连接（对方回连）
  const pending = new Map(); // messageId → {resolve, reject, timer}
  let state = "idle"; // idle | connecting | connected | closed
  let lastError = null;

  const nextAck = () => ++ack;
  const nextMessageId = () => messageId++;

  function handleInbound(chunk) {
    for (const frame of reader.feed(chunk)) {
      if (frame.commandType === CMD.response) {
        const parsed = parseResponseContent(frame.content);
        if (parsed) {
          const waiter = pending.get(parsed.messageId.toString());
          if (waiter) {
            clearTimeout(waiter.timer);
            pending.delete(parsed.messageId.toString());
            const ret = parseReturnModel(parsed.body);
            if (ret.ok) waiter.resolve({ ok: true, value: ret.value });
            else waiter.resolve({ ok: false, error: ret.error });
          }
        }
      } else if (frame.commandType === CMD.request) {
        // 服务器也可能主动发请求（通知类）；当前忽略
        logger(`inbound request frame ack=${frame.ack}，忽略`);
      } else if (frame.commandType === CMD.peerRegister) {
        logger(`对方发来 PeerRegister（双向注册），忽略`);
      }
    }
  }

  let reader = createFrameReader();

  async function connect() {
    if (state === "connected" || state === "connecting") return { ok: true, state };
    state = "connecting";
    try {
      // 本地管道名：随机 32 hex（对应 .NET Guid.NewGuid().ToString("N")）
      const localName = randomUUID().replaceAll("-", "");
      server = await transport.listen(localName, (c) => {
        // 对方回连（应只发生一次）：注入数据/断开回调
        conn = c;
        c.onData = handleInbound;
        c.onClose = () => {
          conn = null;
          state = "closed";
          failAll("连接已断开");
        };
        state = "connected";
      });
      send = await transport.connectSend();
      // 注册自己
      const frame = buildFrame({ ack: nextAck(), commandType: CMD.peerRegister, content: buildPeerRegisterContent(server.pipeName) });
      await send.write(frame);
      // 不等对方回连就绪——惰性等待（首个 invoke 时等待）
      state = "connected";
      return { ok: true, state, localPipe: server.pipeName };
    } catch (e) {
      state = "closed";
      lastError = String(e && e.message || e);
      await close().catch(() => {});
      return { ok: false, state, error: lastError };
    }
  }

  function ensureReady() {
    if (state === "connected") return null;
    return `IPC 未连接（state=${state}${lastError ? "，" + lastError : ""}）`;
  }

  /** 调用 ClassIsland IPC 成员。key 见 api.mjs MEMBERS。 */
  async function invoke(key, args = []) {
    const err = ensureReady();
    if (err) return { ok: false, code: "NOT_CONNECTED", error: err };
    const m = MEMBERS[key];
    if (!m) {
      return { ok: false, code: "KEY_UNKNOWN", error: `未知成员：${key}`, available: Object.keys(MEMBERS) };
    }
    const mid = nextMessageId();
    const body = invokeModel({ contract: m.contract, memberId: m.memberId, memberName: m.memberName, callType: m.callType, args });
    const frame = buildRequestFrame({ ack: nextAck(), messageId: mid, body });
    const waitPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (pending.has(mid.toString())) {
          pending.delete(mid.toString());
          resolve({ ok: false, error: `IPC 调用超时（${requestTimeoutMs}ms）：${key}` });
        }
      }, requestTimeoutMs);
      pending.set(mid.toString(), { resolve, timer });
    });
    try {
      await send.write(frame);
    } catch (e) {
      const w = pending.get(mid.toString());
      if (w) { clearTimeout(w.timer); pending.delete(mid.toString()); }
      return { ok: false, error: `发送失败：${e && e.message || e}` };
    }
    return waitPromise;
  }

  function failAll(msg) {
    for (const [k, w] of pending) {
      clearTimeout(w.timer);
      w.resolve({ ok: false, error: msg });
    }
    pending.clear();
  }

  async function close() {
    state = "closed";
    failAll("客户端已关闭");
    try { if (send) send.close(); } catch {}
    try { if (conn) conn.close(); } catch {}
    try { if (server) await server.close(); } catch {}
    send = null; conn = null; server = null;
    return true;
  }

  function status() {
    return { state, pipe: pipeName, localPipe: server?.pipeName ?? null, pending: pending.size, lastError };
  }

  return { connect, invoke, close, status };
}
