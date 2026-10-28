# dotnetCampus.Ipc 2.0.0-alpha410 协议规格（Node 复刻依据）

ClassIsland 1.5.3+～2.x 全部使用 dotnetCampus.Ipc **2.0.0-alpha410**（1.7 与 master 的 `ClassIsland.Shared.IPC.csproj` 同版本号），协议稳定。以下字段全部对照源码逐条核对（源码库：github.com/dotnet-campus/dotnetCampus.Ipc，tag `2.0.0-alpha410`）。

## 1. 底层帧（`src/dotnetCampus.Ipc/Internals/IpcMessageConverter.cs`）

```
小端序：
UInt16  headerLen   = 13
byte[13] "dotnet campus"          （IpcConfiguration.MessageHeader 默认）
UInt32  version     = 1           （恒为 1；旧版本无独立 ack 回帧）
UInt64  ack                      （发送方向内自增，首条 = 1；AckManager.GetAck）
UInt32  empty       = 0
Int16   commandType
UInt32  contentLen
byte[]  content
```

`IpcMessageCommandType`（`IpcMessageCommandType.cs`）：`PeerRegister = -1`，`Business = 1`，`RequestMessage = 3`，`ResponseMessage = 5`。

## 2. 双半工模型（`IpcPipeServerMessageProvider.cs` / `IpcClientService.cs`）

- 服务器管道（如 `ClassIsland.IPC.v2.Server`）为 `PipeDirection.In`（只收）。
- 客户端连它发送；随后**服务器回连客户端自己的管道**回发响应。
- 客户端本地管道名 = `Guid.NewGuid().ToString("N")`（`IpcProvider` 无参构造）。
- 握手帧（cmd=-1）content：`"PeerRegisterHeader "`（19 字节）+ `Int32 名长` + `UTF8(本端管道名)`（`PeerRegisterProvider.BuildPeerRegisterMessage`）。
- 对方回连后也可能向我们发 PeerRegister（双向注册）——忽略非业务帧即可。

## 3. RemoteObject 业务消息（GeneratedProxies）

`KnownMessageHeaders.RemoteObjectMessageHeader = 0x526D4F6A`（"RmOj"），作为 **content 的业务头**前置 8 字节小端。

请求（cmd=3，`IpcMessageManagerBase.CreateRequestMessageInner`）：

```
"Request\0"(8B) | UInt64 messageId(自增,首条=0) | UInt32 bodyLen(+8 若有业务头) | [UInt64 0x526D4F6A] | body
```

响应（cmd=5）：`"Response"(8B) | UInt64 messageId(=请求) | UInt32 bodyLen | [UInt64 0x526D4F6A] | body`。请求-响应按 content 里的 messageId 配对（帧头 ack 不参与）。

body 是 **Newtonsoft.Json** 序列化（`JsonIpcMessageSerializer`）的 DataContract 模型（DataMember 短名）：

```
请求  GeneratedProxyMemberInvokeModel:
  {"i":"", "t":契约全名, "d":memberId, "m":成员名, "c":callType, "a":[{"v":值}, …]}
响应  GeneratedProxyMemberReturnModel:
  {"r":{"v":返回值}|null, "e":{…异常}|null}
```

`MemberInvokingType`：0=Unknown，1=GetProperty，2=SetProperty，3=Method，4=AsyncMethod。

## 4. MemberId（`MemberIdGenerator.cs`，注意「请勿修改」注释）

```
memberId = UInt64( SHA256(UTF8(签名))[0..8] 小端 )
属性 get：  "get_属性名()"
属性 set：  "set_属性名()"
方法：      "方法名(参数类型1,参数类型2)"   ← 参数类型为 Roslyn ITypeSymbol.ToString()
```

C# 侧经 `BitConverter.ToInt64(hash,0).ToString("X")` 转 `"0x…"` 字符串常量再 parse 成 ulong，位模式等价于小端前 8 字节。

**风险**：带参数方法的 Roslyn 类型字符串（尤其 `Nullable<T>` 的显示）无文档保证——本插件只使用属性与无参方法（`SaveProfile()`、`ClearTempClassPlan()`、`Navigate(System.Uri)` 这类无歧义签名）；实测确认后再扩充。

## 5. ClassIsland 对外服务（`IPublicProfileService` 等接口，1.7 与 2.x 相同）

- 契约全名（`t`）= `typeof(T).FullName`，如 `ClassIsland.Shared.IPC.Abstractions.Services.IPublicProfileService`；服务器按 `(ContractFullTypeName, Id)` 查 Joint（`PublicIpcJointManager`）。
- 常用成员见 `driver/ipc/api.mjs` 的 MEMBERS 表。
- 属性 set（如 `CurrentProfilePath`）会触发 ClassIsland 内部 PropertyChanged → 保存+刷新（实时生效的基础）。

## 6. Node 落地要点

- 打开对方的 In-only 管道：`fs.open(path, "w")`（GENERIC_WRITE）；Node 默认读写模式会被拒。失败再 koffi `CreateFileW` 兜底。
- 收响应：`net.Server` 监听 `\\.\pipe\<随机名>`（libuv 原生支持）。
- 裸开管道后立即关闭（不发 PeerRegister）= 轻量运行探测：进程在管道即在，进程退管道消。服务器对「连上又断」有明确容错（源码注释：注册写入中途对方挂掉符合预期）。
