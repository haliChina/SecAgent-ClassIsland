// dotnetCampus.Ipc 2.0.0-alpha410 帧协议 + RemoteObject 调用模型的 Node 实现。
// 依据 ClassIsland 官方仓库（1.7 与 2.x 均使用 dotnetCampus.Ipc 2.0.0-alpha410）
// 与 dotnetCampus.Ipc 源码逐条核对，详见 docs/PROTOCOL.md。
//
// 帧结构（小端序）：
//   UInt16 headerLen(=13) | byte[13] "dotnet campus" | UInt32 version(=1)
//   UInt64 ack(发送方向内自增,首条=1) | UInt32 empty(=0) | Int16 commandType
//   UInt32 contentLen | byte[contentLen] content
// commandType: -1=PeerRegister, 3=RequestMessage, 5=ResponseMessage
//
// RequestMessage content: "Request\0"(8B) | UInt64 messageId | UInt32 bodyLen | [UInt64 业务头] | body
// ResponseMessage content: "Response"(8B) | UInt64 messageId | UInt32 bodyLen | [UInt64 业务头] | body
// PeerRegister content: "PeerRegisterHeader "(19B) | Int32 nameLen | UTF8(本端管道名)

import { createHash } from "node:crypto";

export const FRAME_HEADER = Buffer.from("dotnet campus", "latin1");
export const BUSINESS_HEADER = 0x526d4f6an; // "RmOj" RemoteObject
export const REQUEST_MARK = Buffer.from([0x52, 0x65, 0x71, 0x75, 0x65, 0x73, 0x74, 0x00]); // "Request\0"
export const RESPONSE_MARK = Buffer.from([0x52, 0x65, 0x73, 0x70, 0x6f, 0x6e, 0x73, 0x65]); // "Response"
export const PEER_REGISTER_HEADER = Buffer.from(
  [0x50, 0x65, 0x65, 0x72, 0x52, 0x65, 0x67, 0x69, 0x73, 0x74, 0x65, 0x72, 0x48, 0x65, 0x61, 0x64, 0x65, 0x72, 0x20]
); // "PeerRegisterHeader "

export const CMD = {
  peerRegister: -1,
  request: 3,
  response: 5
};

/** MemberInvokingType 枚举（dotnetCampus.Ipc）。 */
export const CALL = {
  get: 1,
  set: 2,
  method: 3,
  asyncMethod: 4
};

/** 构造底层帧。ack 由发送方维护（首条=1，每帧自增）。
 *  兼容两种调用：buildFrame({ack, commandType, content}) 与 buildFrame(commandType, content, ack=1)。 */
export function buildFrame(...args) {
  const { ack, commandType, content } = args[0] && typeof args[0] === "object" && !Buffer.isBuffer(args[0])
    ? args[0]
    : { commandType: args[0], content: args[1], ack: args[2] ?? 1 };
  const header = Buffer.alloc(2 + 13 + 4 + 8 + 4 + 2 + 4);
  let o = 0;
  header.writeUInt16LE(FRAME_HEADER.length, o); o += 2;
  FRAME_HEADER.copy(header, o); o += FRAME_HEADER.length;
  header.writeUInt32LE(1, o); o += 4; // version 恒为 1
  header.writeBigUInt64LE(BigInt(ack), o); o += 8;
  header.writeUInt32LE(0, o); o += 4; // 预留
  header.writeInt16LE(commandType, o); o += 2;
  header.writeUInt32LE(content.length, o);
  return Buffer.concat([header, content]);
}

/** 构造 PeerRegister 帧 content。.NET 顺序：Header bytes + Int32 len + UTF8 名字。 */
export function buildPeerRegisterContent(pipeName) {
  const name = Buffer.from(pipeName, "utf8");
  const len = Buffer.alloc(4);
  len.writeInt32LE(name.length, 0);
  return Buffer.concat([PEER_REGISTER_HEADER, len, name]);
}

/**
 * 流式帧解析器：feed(bytes) 返回解析出的帧数组 [{ack, commandType, content}]。
 * 半帧缓存内部持有，跨 feed 拼接。
 */
export function createFrameReader() {
  let buf = Buffer.alloc(0);
  return {
    feed(chunk) {
      buf = Buffer.concat([buf, chunk]);
      const frames = [];
      for (;;) {
        if (buf.length < 2) break;
        const headerLen = buf.readUInt16LE(0);
        const minLen = 2 + headerLen + 4 + 8 + 4 + 2 + 4;
        if (buf.length < minLen) break;
        let o = 2;
        const magic = buf.subarray(o, o + headerLen);
        if (!magic.equals(FRAME_HEADER)) {
          // 流脏了：丢弃到下一帧头（极少发生；防御性处理）
          const idx = buf.indexOf(FRAME_HEADER);
          if (idx < 0) { buf = Buffer.alloc(0); break; }
          buf = buf.subarray(idx);
          continue;
        }
        o += headerLen;
        const version = buf.readUInt32LE(o); o += 4;
        if (version !== 1) {
          const idx = buf.indexOf(FRAME_HEADER, 2);
          if (idx < 0) { buf = Buffer.alloc(0); break; }
          buf = buf.subarray(idx);
          continue;
        }
        const ack = buf.readBigUInt64LE(o); o += 8;
        o += 4; // empty
        const commandType = buf.readInt16LE(o); o += 2;
        const contentLen = buf.readUInt32LE(o); o += 4;
        if (buf.length < o + contentLen) break;
        const content = buf.subarray(o, o + contentLen);
        buf = buf.subarray(o + contentLen);
        frames.push({ ack, commandType, content: Buffer.from(content) });
      }
      return frames;
    },
    pending() { return buf.length; }
  };
}

/** 构造 RequestMessage 帧（含业务头与 RemoteObject body）。
 *  body 里的 BigInt 一律序列化为数字字符串（Newtonsoft 支持字符串→ulong 的读取；
 *  JS number 会在 2^53 以上丢精度，绝不能转 number）。 */
export function buildRequestFrame({ ack, messageId, body }) {
  const json = Buffer.from(
    JSON.stringify(body, (k, v) => (typeof v === "bigint" ? v.toString() : v)),
    "utf8"
  );
  const business = Buffer.alloc(8);
  business.writeBigUInt64LE(BigInt(BUSINESS_HEADER));
  const lenField = 8 + 8 + 4 + 8 + json.length; // mark+id+len+business+json
  const content = Buffer.alloc(8 + 8 + 4);
  REQUEST_MARK.copy(content, 0);
  content.writeBigUInt64LE(BigInt(messageId), 8);
  content.writeUInt32LE(8 + json.length, 16); // bodyLen（含 8B 业务头）
  return buildFrame({ ack, commandType: CMD.request, content: Buffer.concat([content, business, json]) });
}

/** 解析 ResponseMessage 帧 content → {messageId, body(JSON 字符串)}；不匹配返回 null。 */
export function parseResponseContent(content) {
  if (content.length < 20 || !content.subarray(0, 8).equals(RESPONSE_MARK)) return null;
  const messageId = content.readBigUInt64LE(8);
  const bodyLen = content.readUInt32LE(16);
  let o = 20;
  if (content.length < o + bodyLen) return null;
  const business = content.subarray(o, o + 8);
  o += 8;
  const expected = Buffer.alloc(8);
  expected.writeBigUInt64LE(BigInt(BUSINESS_HEADER));
  const hasBusiness = business.equals(expected);
  const body = content.subarray(o, o + bodyLen - (hasBusiness ? 8 : 0));
  return { messageId, body: Buffer.from(body) };
}

/**
 * 计算成员 MemberId。
 * dotnetCampus.Ipc Analyzers（MemberIdGenerator.CalculateHash）：
 *   SHA256(UTF8(签名)) 前 8 字节 → BitConverter.ToInt64（小端）→ "0x"+X → ulong
 * Node 等价：sha256.digest() 前 8 字节按小端读 UInt64（位模式一致）。
 */
export function memberSignatureId(signature) {
  const h = createHash("sha256").update(signature, "utf8").digest();
  return h.readBigUInt64LE(0);
}

/** 构造 RemoteObject invoke 模型（Newtonsoft DataMember 短名）。 */
export function invokeModel({ contract, memberId, memberName, callType, args = [] }) {
  return {
    i: "",
    t: contract,
    d: memberId.toString(), // Newtonsoft ulong → 数字字符串
    m: memberName,
    c: callType,
    a: args.map((v) => (v === undefined ? null : { v }))
  };
}

/** 解析响应模型 {"r":{"v":…}|null,"e":{…}|null} → {ok, value, error}。 */
export function parseReturnModel(body) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return { ok: false, error: `响应不是合法 JSON：${body.subarray(0, 200).toString("utf8")}` };
  }
  if (parsed && parsed.e) {
    const e = parsed.e;
    return { ok: false, error: e.Message || e.message || (typeof e.toString === "function" ? e.toString() : JSON.stringify(e)) };
  }
  if (parsed === null || parsed === undefined || parsed.r === null || parsed.r === undefined) {
    return { ok: true, value: null };
  }
  return { ok: true, value: parsed.r.v ?? null };
}
