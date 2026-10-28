// 协议层单测：帧编解码、流式解析、PeerRegister、请求/响应模型。
import test from "node:test";
import assert from "node:assert/strict";
import {
  FRAME_HEADER, buildFrame, buildPeerRegisterContent, createFrameReader,
  buildRequestFrame, parseResponseContent, invokeModel, parseReturnModel,
  CMD, memberSignatureId
} from "../driver/ipc/proto.mjs";
import { createHash } from "node:crypto";

test("帧头常量", () => {
  assert.equal(FRAME_HEADER.length, 13);
  assert.equal(FRAME_HEADER.toString("latin1"), "dotnet campus");
});

test("buildFrame 可被 createFrameReader 精确回读", () => {
  const content = Buffer.from("hello 课表");
  const frame = buildFrame(CMD.request, content, 7n);
  const reader = createFrameReader();
  const frames = reader.feed(frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].commandType, CMD.request);
  assert.equal(frames[0].ack, 7n);
  assert.equal(frames[0].content.toString("utf8"), "hello 课表");
});

test("流式解析：跨多次 feed 的半帧拼接", () => {
  const frame = buildFrame(CMD.response, Buffer.alloc(300, 0xab), 2n);
  const reader = createFrameReader();
  const a = reader.feed(frame.subarray(0, 10));
  const b = reader.feed(frame.subarray(10, 25));
  assert.equal(a.length, 0);
  assert.equal(b.length, 0);
  const c = reader.feed(frame.subarray(25));
  assert.equal(c.length, 1);
  assert.equal(c[0].content.length, 300);
  assert.equal(c[0].ack, 2n);
});

test("流式解析：粘包两帧一次 feed", () => {
  const f1 = buildFrame(CMD.peerRegister, buildPeerRegisterContent("abc"));
  const f2 = buildFrame(CMD.request, Buffer.from("{}"));
  const reader = createFrameReader();
  const out = reader.feed(Buffer.concat([f1, f2]));
  assert.equal(out.length, 2);
  assert.equal(out[0].commandType, CMD.peerRegister);
  assert.equal(out[1].commandType, CMD.request);
});

test("PeerRegister content 布局：19 字节头 + Int32 + UTF8", () => {
  const c = buildPeerRegisterContent("ClassIsland.Node.Client");
  assert.equal(c.subarray(0, 19).toString("latin1"), "PeerRegisterHeader ");
  const len = c.readInt32LE(19);
  assert.equal(len, Buffer.byteLength("ClassIsland.Node.Client"));
  assert.equal(c.subarray(23).toString("utf8"), "ClassIsland.Node.Client");
});

test("请求帧：Request\\0 + messageId + bodyLen + 业务头 + body", () => {
  const frame = buildRequestFrame({ messageId: 0n, body: { i: "", t: "x", d: 1n, m: "M", c: 3, a: [] }, ack: 5n });
  const reader = createFrameReader();
  const [msg] = reader.feed(frame);
  assert.equal(msg.commandType, CMD.request);
  assert.equal(msg.ack, 5n);
  const r = parseResponseContent(msg.content); // 不是响应帧 → null
  assert.equal(r, null);
  const inner = msg.content.subarray(8); // 跳过 "Request\0"
  const messageId = inner.readBigUInt64LE(0);
  const bodyLen = inner.readUInt32LE(8);
  const bizHeader = inner.subarray(12, 20);
  const body = inner.subarray(20);
  assert.equal(messageId, 0n);
  assert.equal(bodyLen, 8 + Buffer.byteLength(JSON.stringify({ i: "", t: "x", d: "1", m: "M", c: 3, a: [] })));
  assert.equal(bizHeader.readBigUInt64LE(0), 0x526d4f6an);
  assert.equal(body.toString("utf8"), JSON.stringify({ i: "", t: "x", d: "1", m: "M", c: 3, a: [] }));
});

test("响应解析：Response + messageId + 业务头 + body", () => {
  const body = Buffer.from(JSON.stringify({ r: { v: "Default.json" }, e: null }));
  const inner = Buffer.concat([
    Buffer.from("Response", "latin1"),
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(42n); return b; })(),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(body.length + 8); return b; })(),
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(0x526d4f6an); return b; })(),
    body
  ]);
  const frame = buildFrame({ commandType: CMD.response, content: inner, ack: 9n });
  const reader = createFrameReader();
  const [msg] = reader.feed(frame);
  const r = parseResponseContent(msg.content);
  assert.ok(r);
  assert.equal(r.messageId, 42n);
  const ret = parseReturnModel(r.body);
  assert.equal(ret.ok, true);
  assert.equal(ret.value, "Default.json");
});

test("invokeModel：DataMember 短名与 ulong 字符串", () => {
  const m = invokeModel({
    contract: "ClassIsland.Shared.IPC.Abstractions.Services.IPublicProfileService",
    memberId: 123456789012345678n,
    memberName: "SaveProfile",
    callType: 3,
    args: []
  });
  const j = JSON.parse(JSON.stringify(m));
  assert.equal(j.i, "");
  assert.equal(j.m, "SaveProfile");
  assert.equal(j.c, 3);
  assert.equal(j.d, "123456789012345678");
  assert.deepEqual(j.a, []);
});

test("parseReturnModel：异常透传与 null 语义", () => {
  const e = parseReturnModel(Buffer.from(JSON.stringify({ r: null, e: { Message: "无法对接 Id 为 123 的… 方法" } })));
  assert.equal(e.ok, false);
  assert.match(e.error, /无法对接/);
  const n = parseReturnModel(Buffer.from(JSON.stringify({ r: null, e: null })));
  assert.equal(n.ok, true);
  assert.equal(n.value, null);
  const bad = parseReturnModel(Buffer.from("not-json"));
  assert.equal(bad.ok, false);
});

test("memberId 算法与独立实现一致（防手滑）", () => {
  // 独立重算：sha256 前 8 字节小端（对应 C# BitConverter.ToInt64(hash,0) 的位模式）
  const expected = (sig) => {
    const h = createHash("sha256").update(sig, "utf8").digest();
    return h.readBigUInt64LE(0);
  };
  assert.equal(memberSignatureId("get_Profile()"), expected("get_Profile()"));
  assert.equal(memberSignatureId("set_CurrentProfilePath()"), expected("set_CurrentProfilePath()"));
  assert.equal(memberSignatureId("SaveProfile()"), expected("SaveProfile()"));
  // 简单交叉：不同签名不同 id
  assert.notEqual(memberSignatureId("get_Profile()"), memberSignatureId("set_Profile()"));
});
