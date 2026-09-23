// 后台自检判定逻辑的纯逻辑单测（不碰网络）。
// 覆盖真实环境里很难复现的分支：限流、已发布新构建、以及「本地 pin 比已发布还新」的误报防护。
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, formatReset, pickLatestBuild } from "./upstream-core.mjs";

const BASELINE = { commit: "c0ad61c", date: "2026-09-16", version: "0.18.0-c0ad61c" };

test("pickLatestBuild 显式优先 next，即使它不是键顺序里的第一个", () => {
  const tags = { preview: "0.18.0-1234567", next: "0.18.0-abcdef0", latest: "0.18.1" };
  assert.deepEqual(pickLatestBuild(tags), { version: "0.18.0-abcdef0", sha: "abcdef0", tag: "next" });
});

test("pickLatestBuild 无 next 时取第一个 canary 形式标签", () => {
  const tags = { preview: "0.18.0-1234567", latest: "0.18.1" };
  assert.deepEqual(pickLatestBuild(tags), { version: "0.18.0-1234567", sha: "1234567", tag: "preview" });
});

test("pickLatestBuild 没有 canary 时回退 latest 且 sha 为 null", () => {
  assert.deepEqual(pickLatestBuild({ latest: "0.18.1", rc: "0.18.0-rc.7" }), {
    version: "0.18.1",
    sha: null,
    tag: "latest",
  });
});

test("assess：master HEAD 等于基线 → up-to-date", () => {
  const r = assess(BASELINE, {
    master: { sha: "c0ad61c0000", date: "2026-09-16T17:50:39Z" },
    compare: { total_commits: 0, commits: [] },
    tags: { next: "0.18.0-c0ad61c" },
  });
  assert.equal(r.state, "up-to-date");
  assert.equal(r.masterSha, "c0ad61c");
});

test("assess：master 领先但已发布构建不含这些提交 → source-only", () => {
  const r = assess(BASELINE, {
    master: { sha: "2b9da9600", date: "2026-09-22T20:02:13Z" },
    compare: { total_commits: 4, commits: [{ sha: "14e1c6100" }, { sha: "2b9da9600" }] },
    tags: { next: "0.18.0-c0ad61c" },
  });
  assert.equal(r.state, "source-only");
  assert.equal(r.behindBy, 4);
  assert.equal(r.command, "");
});

test("assess：已发布构建的 commit 落在基线之后 → build-available 且给出升级命令", () => {
  const r = assess(BASELINE, {
    master: { sha: "2b9da9600", date: "2026-09-22T20:02:13Z" },
    compare: { total_commits: 2, commits: [{ sha: "4e758db00" }, { sha: "2b9da9600" }] },
    tags: { next: "0.18.0-4e758db" },
  });
  assert.equal(r.state, "build-available");
  assert.match(r.command, /@excalidraw\/excalidraw@0\.18\.0-4e758db/);
});

test("assess：本地 pin 比已发布构建更新时，不得误报可升级", () => {
  const r = assess(BASELINE, {
    master: { sha: "bbbbbbb00", date: "2026-09-22T20:02:13Z" },
    compare: { total_commits: 1, commits: [{ sha: "bbbbbbb00" }] },
    tags: { next: "0.18.0-ccccccc" },
  });
  assert.equal(r.state, "source-only");
  assert.equal(r.command, "");
});

test("assess：GitHub 限流（无 master + blocked）→ rate-limited 且带可读重试时间", () => {
  const resetSec = 1780000000;
  const r = assess(BASELINE, {
    blocked: { status: 403, resetAt: resetSec },
    tags: { next: "0.18.0-c0ad61c" },
  });
  assert.equal(r.state, "rate-limited");
  assert.equal(r.resetAt, resetSec * 1000);
  assert.match(r.resetLabel, /^\d{2}:\d{2}$/);
  assert.equal(r.short.zh, "自检被限流");
  assert.ok(r.title.zh.includes("60 次"));
});

test("assess：既无 master 也无 blocked（真离线）→ unknown，保持静默", () => {
  const r = assess(BASELINE, { tags: { next: "0.18.0-c0ad61c" } });
  assert.equal(r.state, "unknown");
  assert.equal(r.title.zh, "");
});

test("formatReset：兼容 epoch 秒 / 毫秒 / 空值", () => {
  assert.equal(formatReset(undefined), "");
  assert.equal(formatReset(""), "");
  assert.match(formatReset(1780000000), /^\d{2}:\d{2}$/);
  assert.equal(formatReset(1780000000), formatReset(1780000000000));
});
