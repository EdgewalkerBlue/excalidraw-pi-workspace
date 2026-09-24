// 外观纯逻辑单测（不碰 DOM，也不导入任何浏览器包）。
// 覆盖：主题三态循环与解析、色值规范化、色块数量与"含黑色"、非法输入回退。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS_BG_SWATCHES,
  isDarkTheme,
  nextThemeMode,
  normalizeHex,
  parseThemeMode,
  resolveTheme,
} from "./appearance.mjs";

test("主题模式按 浅色 → 深色 → 跟随系统 循环", () => {
  assert.equal(nextThemeMode("light"), "dark");
  assert.equal(nextThemeMode("dark"), "system");
  assert.equal(nextThemeMode("system"), "light");
});

test("resolveTheme：显式模式不受系统影响，system 跟随系统", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("parseThemeMode：非法值回退 system，避免旧数据把界面锁死", () => {
  assert.equal(parseThemeMode("dark"), "dark");
  assert.equal(parseThemeMode(""), "system");
  assert.equal(parseThemeMode(undefined), "system");
  assert.equal(parseThemeMode("DARK"), "system");
});

test("isDarkTheme 等价于官方 THEME.DARK", () => {
  assert.equal(isDarkTheme("dark"), true);
  assert.equal(isDarkTheme("light"), false);
});

test("normalizeHex 接受 #rgb / #rrggbb（# 可省）并统一小写 #rrggbb", () => {
  assert.equal(normalizeHex("#FFF"), "#ffffff");
  assert.equal(normalizeHex("1E1E1E"), "#1e1e1e");
  assert.equal(normalizeHex("#f8f9fa"), "#f8f9fa");
  assert.equal(normalizeHex("#12345"), null);
  assert.equal(normalizeHex("rgb(0,0,0)"), null);
  assert.equal(normalizeHex(""), null);
});

test("画布底色色块：7 种浅色 + 末位纯黑，色值规范且不重复", () => {
  assert.equal(CANVAS_BG_SWATCHES.length, 8);
  // 末位必须是黑色
  assert.equal(CANVAS_BG_SWATCHES[7].hex, "#000000", "最后一个是黑色");
  // 其余 7 个必须是浅色（三通道均值 >= 200，即接近白）
  const lights = CANVAS_BG_SWATCHES.slice(0, 7);
  for (const s of lights) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.hex.slice(i, i + 2), 16));
    const avg = (r + g + b) / 3;
    assert.ok(avg >= 200, `${s.hex} 应为浅色（当前均值 ${avg.toFixed(0)}）`);
  }
  // 色值本身规范且无重复
  for (const s of CANVAS_BG_SWATCHES) {
    assert.equal(normalizeHex(s.hex), s.hex, `${s.hex} 应已是规范形式`);
  }
  assert.equal(new Set(CANVAS_BG_SWATCHES.map((s) => s.hex)).size, 8, "色块不应重复");
});
