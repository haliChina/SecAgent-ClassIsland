// IPC 客户端单测：mock 一个「ClassIsland 服务器」对拍真实协议字节。
// mock 服务器实现：收帧 → 解 PeerRegister → 回连客户端 → 收 Request → 回 Response。
import test from "node:test";
import assert from "node:assert/strict";
import { createIpcClient } from "../driver/ipc/client.mjs";
import { MEMBERS } from "../driver/ipc/api.mjs";
import {
  buildFrame, createFrameReader, CMD, invokeModel, memberSignatureId
} from "../driver/ipc/proto.mjs";

/** 内存双半工 mock：模拟 dotnetCampus.Ipc 服务器侧行为。 */
function createMockServer({ handlers = {} } = {}) {
  // 服务器视角：clientSend 管道（我们只读）；clientListen 管道（服务器写响应）
  const serverReceived = [];       // 服务器读到的帧
  let clientOnData = null;         // 服务器 → 客户端的写入函数
  const state = { registeredName: null, serverAck: 0n };

  const transport = {
    connectSend: async () => ({
      write: async (bytes) => {
        // 服务器读管道：解析帧
        const reader = createFrameReader();
        for (const msg of reader.feed(bytes)) {
          serverReceived.push(msg);
          handleServerFrame(msg);
        }
      },
      close: () => {}
    }),
    listen: async (name, onConnection) => {
      // 客户端本地管道：服务器回连它
      const conn = {
        onData: null,
        onClose: null,
        close: () => {}
      };
      // 服务器立即「回连」并持有写入口
      clientOnData = (bytes) => { if (conn.onData) conn.onData(bytes); };
      onConnection(conn);
      return { pipeName: name, close: async () => {} };
    }
  };

  function sendToClient(commandType, content) {
    state.serverAck += 1n;
    clientOnData(buildFrame(commandType, content, state.serverAck));
  }

  function handleServerFrame(msg) {
    if (msg.commandType === CMD.peerRegister) {
      // 注册：content = 19B 头 + Int32 + 名字
      const name = msg.content.subarray(23).toString("utf8");
      state.registeredName = name;
      // 服务器也会向客户端发自己的 PeerRegister（双向注册），客户端应能忽略
      sendToClient(CMD.peerRegister, (function buildPeerRegister(name) {
        const n = Buffer.from(name, "utf8");
        const len = Buffer.alloc(4); len.writeInt32LE(n.length, 0);
        return Buffer.concat([Buffer.from("PeerRegisterHeader ", "latin1"), len, n]);
      })("mock-server-pipe"));
      return;
    }
    if (msg.commandType === CMD.request) {
      const inner = msg.content.subarray(8);
      const messageId = inner.readBigUInt64LE(0);
      const bodyLen = inner.readUInt32LE(8);
      const body = inner.subarray(12 + 8, 12 + 8 + (bodyLen - 8));
      const model = JSON.parse(body.toString("utf8"));
      const handler = handlers[model.m] || (() => ({ v: "void" }));
      const value = handler(model, state);
      const respBody = Buffer.from(JSON.stringify({ r: value === null ? null : { v: value }, e: null }));
      // 响应 content = "Response" + messageId + bodyLen(+8 业务头) + 业务头 + body
      const resp = Buffer.concat([
        Buffer.from("Response", "latin1"),
        (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(messageId); return b; })(),
        (() => { const b = Buffer.alloc(4); b.writeUInt32LE(respBody.length + 8); return b; })(),
        (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(0x526d4f6an); return b; })(),
        respBody
      ]);
      sendToClient(CMD.response, resp);
    }
  }

  return { transport, serverReceived, state };
}

test("握手+invoke 全链路：get CurrentProfilePath", async () => {
  const mock = createMockServer({ handlers: { "CurrentProfilePath": () => "Default.json" } });
  const client = createIpcClient({ transport: mock.transport, requestTimeoutMs: 1000 });
  const conn = await client.connect();
  assert.equal(conn.ok, true, JSON.stringify(conn));
  assert.equal(mock.state.registeredName, client.status().localPipe);

  const r = await client.invoke("profile.currentPath.get");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.value, "Default.json");

  // 服务器收到的请求帧应携带正确的契约/memberId/callType
  const req = mock.serverReceived.find((m) => m.commandType === CMD.request);
  const inner = req.content.subarray(8);
  const body = inner.subarray(12 + 8);
  const model = JSON.parse(body.toString("utf8"));
  const member = MEMBERS["profile.currentPath.get"];
  assert.equal(model.t, member.contract);
  assert.equal(model.d, member.memberId.toString());
  assert.equal(model.c, 1);
  assert.equal(model.m, "CurrentProfilePath");

  await client.close();
});

test("invoke 带参数：uri.navigate 传 URI 字符串", async () => {
  const calls = [];
  const mock = createMockServer({ handlers: { "Navigate": (m) => { calls.push(m); return "void"; } } });
  const client = createIpcClient({ transport: mock.transport, requestTimeoutMs: 1000 });
  await client.connect();
  const r = await client.invoke("uri.navigate", ["classisland://app/settings"]);
  assert.equal(r.ok, true);
  assert.equal(calls[0].a[0].v, "classisland://app/settings");
  await client.close();
});

test("服务器异常透传为 ok:false", async () => {
  const mock = createMockServer({
    handlers: { "SaveProfile": () => { throw new Error("无法对接 Id 为 123 的方法"); } }
  });
  const client = createIpcClient({ transport: mock.transport, requestTimeoutMs: 1000 });
  await client.connect();
  const r = await client.invoke("profile.save");
  assert.equal(r.ok, false);
  assert.match(r.error, /无法对接/);
  await client.close();
});

test("服务器发来的 PeerRegister 帧不影响客户端（忽略非业务帧）", async () => {
  const mock = createMockServer({ handlers: { "CurrentProfilePath": () => "x.json" } });
  const client = createIpcClient({ transport: mock.transport, requestTimeoutMs: 1000 });
  await client.connect();
  // mock 服务器在注册时已发送了自己的 PeerRegister 帧；客户端没崩，invoke 正常
  const r = await client.invoke("profile.currentPath.get");
  assert.equal(r.ok, true);
  await client.close();
});

test("invoke 未知 key 报 KEY_UNKNOWN 并给出可用清单", async () => {
  const mock = createMockServer({});
  const client = createIpcClient({ transport: mock.transport, requestTimeoutMs: 200 });
  await client.connect();
  const r = await client.invoke("profile.nope");
  assert.equal(r.ok, false);
  assert.equal(r.code, "KEY_UNKNOWN");
  assert.ok(Array.isArray(r.available));
  await client.close();
});

test("connect 之前 invoke 报 NOT_CONNECTED", async () => {
  const mock = createMockServer({});
  const client = createIpcClient({ transport: mock.transport, requestTimeoutMs: 200 });
  const r = await client.invoke("profile.save");
  assert.equal(r.ok, false);
  assert.equal(r.code, "NOT_CONNECTED");
});

test("MEMBERS：契约与 memberId 与签名表自洽", () => {
  for (const [key, m] of Object.entries(MEMBERS)) {
    assert.ok(m.contract.startsWith("ClassIsland.Shared.IPC."), key);
    assert.equal(typeof m.memberId, "bigint");
    assert.equal(m.memberId, memberSignatureId(m.signature), key);
    assert.equal(m.callType >= 1 && m.callType <= 3, true, key);
  }
  // 关键成员存在
  for (const k of ["profile.currentPath.get", "profile.currentPath.set", "profile.get", "profile.save", "profile.clearTemp", "uri.navigate", "lessons.currentSubject.get"]) {
    assert.ok(MEMBERS[k], `缺 ${k}`);
  }
});

test("invokeModel 的 args 映射：undefined → null 占位", () => {
  const m = invokeModel({ contract: "c", memberId: 1n, memberName: "X", callType: 3, args: [undefined, "s"] });
  assert.equal(m.a[0], null);
  assert.deepEqual(m.a[1], { v: "s" });
});

// —— R77：管道名归一化（connectSend 裸名坑——EPERM 根修） ——
test("normalizePipeName：裸名加 \\.\pipe\ 前缀、带前缀不动（R77 实测 EPERM 根因）", async () => {
  const { normalizePipeName } = await import("../driver/ipc/transport-win.mjs");
  assert.equal(normalizePipeName("ClassIsland.IPC.v2.Server"), "\\\\.\\pipe\\ClassIsland.IPC.v2.Server", "裸名（配置默认形态）必须加前缀");
  assert.equal(normalizePipeName("\\\\.\\pipe\\ClassIsland.IPC.v2.Server"), "\\\\.\\pipe\\ClassIsland.IPC.v2.Server", "带前缀不重复加");
  // 旧 bug 形态回归断言：归一化结果绝不能是裸名（fs.open 会当 cwd 相对路径 → EPERM）
  assert.ok(normalizePipeName("ClassIsland.IPC.v2.Server").startsWith("\\\\.\\pipe\\"), "结果必须带前缀");
});

test("normalizePipeName：空值防御", async () => {
  const { normalizePipeName } = await import("../driver/ipc/transport-win.mjs");
  assert.equal(normalizePipeName(""), "\\\\.\\pipe\\");
  assert.equal(normalizePipeName(null), "\\\\.\\pipe\\");
});
