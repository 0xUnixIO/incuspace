import { getCurrentUser } from "./auth";

// 把实际 Incus 名 `u<uid>-display` 还原成给当前用户看的 display_name。
// admin 看到原名（含前缀），普通用户看到去掉自己前缀的部分。
export function displayInstanceName(actual: string): string {
  const me = getCurrentUser();
  if (!me) return actual;
  if (me.role === "admin") return actual;
  const prefix = `u${me.id}-`;
  return actual.startsWith(prefix) ? actual.slice(prefix.length) : actual;
}
