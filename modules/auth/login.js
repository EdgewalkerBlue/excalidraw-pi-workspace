/**
 * 登录模块（phase_5 演示任务 task-A）
 * 基于画布节点 task-A 实现的最小登录功能。
 */
export const VALID_USERS = {
  admin: "admin123",
  demo: "demo123",
};

/**
 * 校验用户名/密码。
 * @param {string} username
 * @param {string} password
 * @returns {{ok: boolean, user?: string, reason?: string}}
 */
export function login(username, password) {
  if (!username || !password) {
    return { ok: false, reason: "用户名或密码不能为空" };
  }
  if (!(username in VALID_USERS)) {
    return { ok: false, reason: "用户不存在" };
  }
  if (VALID_USERS[username] !== password) {
    return { ok: false, reason: "密码错误" };
  }
  return { ok: true, user: username };
}
