// extra-menu-links 的纯逻辑单测。
//
// 用一个**最小 DOM 桩**（只实现被用到的几个方法与两种选择器）跑，重点覆盖最容易出错的地方：
// 幂等（MutationObserver 会反复触发）、找不到锚点、以及 href/文本是否正确写入、位置是否紧跟官方项。
// ⚠️ 这验证的是"注入决策逻辑"，真实 DOM 的观感仍需在浏览器里扫一眼。
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORK_SELECTOR, injectForkLink, forkLabel, OFFICIAL_GITHUB } from "./menu-link-inject.mjs";

// ── 最小 DOM 桩 ────────────────────────────────────────────────────────
class El {
  constructor(tag, attrs = {}, text = "") {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this._text = text;
    this.classList = {
      _s: new Set(),
      add: (c) => this.classList._s.add(c),
      remove: (c) => this.classList._s.delete(c),
      contains: (c) => this.classList._s.has(c),
    };
  }
  get className() { return [...this.classList._s].join(" "); }
  set className(v) { v.split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c)); }
  append(node) { node.parent = this; this.children.push(node); }
  get textContent() {
    return this.children.length ? this._text + this.children.map((c) => c.textContent).join("") : this._text;
  }
  set textContent(v) { this._text = v; this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  insertAdjacentElement(pos, node) {
    const i = this.parent.children.indexOf(this);
    node.parent = this.parent;
    this.parent.children.splice(pos === "afterend" ? i + 1 : i, 0, node);
    return node;
  }
  get previousElementSibling() {
    const i = this.parent.children.indexOf(this);
    return i > 0 ? this.parent.children[i - 1] : null;
  }
  cloneNode() {
    const c = new El(this.tagName, { ...this.attrs });
    c._text = this._text;
    [...this.classList._s].forEach((x) => c.classList.add(x));
    this.children.forEach((ch) => c.append(ch.cloneNode()));
    return c;
  }
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  querySelectorAll(sel) {
    if (sel === "*") return this.descendants();
    throw new Error(`桩未实现的选择器: ${sel}`);
  }
  querySelector(sel) {
    if (sel === FORK_SELECTOR) return this.descendants().find((e) => e.attrs["pi-fork-link"]) || null;
    if (sel === OFFICIAL_GITHUB) {
      return this.descendants().find((e) => e.tagName === "A" && e.attrs.href === "https://github.com/excalidraw/excalidraw") || null;
    }
    throw new Error(`桩未实现的选择器: ${sel}`);
  }
}

/** 复刻官方菜单项结构：<a href=github><div icon/><div text>GitHub</div></a> */
function officialMenu() {
  const root = new El("div");
  const a = new El("a", { href: "https://github.com/excalidraw/excalidraw", "data-testid": "github-link" });
  a.className = "dropdown-menu-item dropdown-menu-item-base";
  a.append(new El("div", { class: "icon" }));
  const text = new El("div", {}); text.append(new El("span", {}, "GitHub"));
  a.append(text);
  root.append(a);
  root.append(new El("a", { href: "https://x.com/excalidraw" }));
  return { root, a };
}

const URL_FORK = "https://github.com/EdgewalkerBlue/excalidraw-pi-workspace";

test("把二开链接插到官方 GitHub 之后，并写入 href/文本", () => {
  const { root, a } = officialMenu();
  assert.equal(injectForkLink(root, { url: URL_FORK, label: "二开版 GitHub" }), "injected");
  const fork = root.querySelector(FORK_SELECTOR);
  assert.ok(fork, "应能按标记找到");
  assert.equal(fork.getAttribute("href"), URL_FORK);
  assert.equal(fork.getAttribute("target"), "_blank");
  assert.equal(fork.getAttribute("aria-label"), "二开版 GitHub");
  assert.equal(fork.textContent.trim(), "二开版 GitHub", "文本应被替换");
  assert.equal(fork.previousElementSibling, a, "必须紧跟在官方 GitHub 之后");
  assert.equal(fork.getAttribute("data-testid"), null, "不应沿用官方的 testid");
  assert.ok(fork.className.includes("dropdown-menu-item"), "沿用官方类名以保持样式");
});

test("幂等：重复调用只保留一条（MutationObserver 会反复触发）", () => {
  const { root } = officialMenu();
  assert.equal(injectForkLink(root, { url: URL_FORK, label: "x" }), "injected");
  assert.equal(injectForkLink(root, { url: URL_FORK, label: "x" }), "exists");
  assert.equal(injectForkLink(root, { url: URL_FORK, label: "x" }), "exists");
  const count = root.descendants().filter((e) => e.attrs["pi-fork-link"]).length;
  assert.equal(count, 1, "只能有一条注入项");
});

test("找不到官方锚点时安全返回，不改动 DOM", () => {
  const root = new El("div");
  root.append(new El("a", { href: "https://example.com" }));
  const before = root.descendants().length;
  assert.equal(injectForkLink(root, { url: URL_FORK, label: "x" }), "no-anchor");
  assert.equal(root.descendants().length, before);
});

test("缺少 URL 或根节点时不报错", () => {
  const { root } = officialMenu();
  assert.equal(injectForkLink(root, { url: "", label: "x" }), "no-anchor");
  assert.equal(injectForkLink(null, { url: URL_FORK, label: "x" }), "no-anchor");
});

test("悬停高亮：补上 manual-hover 模式的类名", () => {
  const { root } = officialMenu();
  injectForkLink(root, { url: URL_FORK, label: "x" });
  const fork = root.querySelector(FORK_SELECTOR);
  fork.listeners.mouseenter[0]();
  assert.equal(fork.classList.contains("dropdown-menu-item--hovered"), true);
  fork.listeners.mouseleave[0]();
  assert.equal(fork.classList.contains("dropdown-menu-item--hovered"), false);
});

test("forkLabel 跟随界面语言", () => {
  assert.equal(forkLabel("zh-CN"), "二开版 GitHub");
  assert.equal(forkLabel("en"), "Fork GitHub");
});
