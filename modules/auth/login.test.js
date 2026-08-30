import { test } from "node:test";
import assert from "node:assert/strict";
import { login } from "./login.js";

test("正确凭据登录成功", () => {
  const r = login("admin", "admin123");
  assert.equal(r.ok, true);
  assert.equal(r.user, "admin");
});

test("错误密码被拒绝", () => {
  const r = login("admin", "wrong");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "密码错误");
});

test("不存在用户被拒绝", () => {
  const r = login("nobody", "x");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "用户不存在");
});

test("空凭据被拒绝", () => {
  assert.equal(login("", "").ok, false);
  assert.equal(login(null, null).ok, false);
});
