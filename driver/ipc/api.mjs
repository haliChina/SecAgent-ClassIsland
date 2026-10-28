// ClassIsland IPC 对外服务与成员签名表。
// 契约全名 = typeof(T).FullName（无程序集名）；MemberId = SHA256(签名) 前 8 字节小端。
// 有参数的方法因 Roslyn 参数类型字符串存在歧义（Nullable 展示），本表只收录
// 属性与无参/低风险参数方法；有参方法通过实测确认后再扩充。

import { memberSignatureId } from "./proto.mjs";

export const SERVICES = {
  profile: "ClassIsland.Shared.IPC.Abstractions.Services.IPublicProfileService",
  uriNavigation: "ClassIsland.Shared.IPC.Abstractions.Services.IPublicUriNavigationService",
  lessons: "ClassIsland.Shared.IPC.Abstractions.Services.IPublicLessonsService"
};

export const DEFAULT_PIPE = "ClassIsland.IPC.v2.Server";

function prop(service, name, type) {
  const accessor = type === "get" ? "get" : "set";
  const signature = `${accessor}_${name}()`;
  return {
    service,
    contract: SERVICES[service],
    memberName: name,
    callType: type === "get" ? 1 : 2,
    signature,
    memberId: memberSignatureId(signature)
  };
}

function method(service, name, paramTypes = []) {
  const signature = `${name}(${paramTypes.join(",")})`;
  return {
    service,
    contract: SERVICES[service],
    memberName: name,
    callType: 3,
    signature,
    memberId: memberSignatureId(signature)
  };
}

/** 支持的调用目录：key → 成员描述（signature 即 memberId 推导源，自洽可查）。 */
export const MEMBERS = {
  // IPublicProfileService —— 档案
  "profile.currentPath.get": prop("profile", "CurrentProfilePath", "get"),
  "profile.currentPath.set": prop("profile", "CurrentProfilePath", "set"),
  "profile.get": prop("profile", "Profile", "get"),
  "profile.set": prop("profile", "Profile", "set"),
  "profile.save": method("profile", "SaveProfile"),
  "profile.saveTo": method("profile", "SaveProfile", ["System.String"]),
  "profile.clearTemp": method("profile", "ClearTempClassPlan"),
  "profile.convertTemp": method("profile", "ConvertToStdClassPlan"),
  "profile.clearTempGroup": method("profile", "ClearTempClassPlanGroup"),
  "profile.trusted.get": prop("profile", "IsCurrentProfileTrusted", "get"),
  // IPublicUriNavigationService —— 导航
  "uri.navigate": method("uriNavigation", "Navigate", ["System.Uri"]),
  "uri.navigateWrapped": method("uriNavigation", "NavigateWrapped", ["System.Uri"]),
  // IPublicLessonsService —— 当前课程状态（只读有价值）
  "lessons.currentSubject.get": prop("lessons", "CurrentSubject", "get"),
  "lessons.currentLayoutItem.get": prop("lessons", "CurrentTimeLayoutItem", "get"),
  "lessons.onClassLeftTime.get": prop("lessons", "OnClassLeftTime", "get"),
  "lessons.onBreakingTimeLeftTime.get": prop("lessons", "OnBreakingTimeLeftTime", "get"),
  "lessons.currentState.get": prop("lessons", "CurrentState", "get")
};

/** 常用 URI 页面（classisland:// 协议，1.7 与 2.x 均支持外部唤起）。 */
export const URI_PAGES = {
  settings: "classisland://app/settings",
  profileAdjustment: "classisland://app/profile/adjustment", // 临时换课窗口
  notification: "classisland://app/settings/notification",
  automation: "classisland://app/settings/automation",
  about: "classisland://app/settings/about",
  plugins: "classisland://app/settings/classisland.plugins"
};

export function describeMembers() {
  return Object.entries(MEMBERS).map(([key, m]) => ({
    key,
    contract: m.contract,
    member: m.memberName,
    callType: m.callType,
    memberId: "0x" + m.memberId.toString(16).toUpperCase()
  }));
}
