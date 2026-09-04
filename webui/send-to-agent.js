/**
 * Web UI "Send to Agent / Approve / Reject" 注入脚本
 *
 * 在 Excalidraw Web UI 的连接状态（Connected）左侧插入三个按钮：
 *   - Send to Agent : 发送画布通知给 Pi（蓝色；成功后约 1s 绿色"已发送"）
 *   - Approve       : 批准画布任务（黄色待处理→绿色已批准；未 Send 时不显示）
 *   - Reject        : 回退已发送内容/取消执行中任务（红色；未 Send 时不显示）
 *
 * 另在 Excalidraw 底部右侧浮窗注入语言切换器（中文 / English），并同步
 * 右上角 header 文本语言（写入 localStorage["excalidraw-canvas-lang"] 后
 * 刷新生效；默认英文由 tools/patch-i18n.mjs 注入到 Excalidraw bundle）。
 *
 * 依赖：tools/agent-notify.mjs（监听 5010）运行中。
 * 状态同步：3s 轮询 /health（pending / approved / rejected）。
 * 幂等：重复注入安全。
 */
(function () {
  "use strict";

  var BTN_ID = "send-to-agent-btn";
  var APPROVE_BTN_ID = "approve-btn";
  var REJECT_BTN_ID = "reject-btn";
  var TASKSET_BTN_ID = "send-to-taskset-btn";
  var FRAME_COLOR_BTN_ID = "frame-color-btn";
  var FRAME_COLOR_MENU_ID = "frame-color-menu";
  var NOTIFY_PORT = 5010;

  // frame 边框色：默认蓝（深/浅色主题下都清晰可见）
  var FRAME_DEFAULT_BLUE = "#1971c2";
  // 视为"默认色"（自动改蓝）的 strokeColor；新建 frame 默认 #1e1e1e，深色主题下看不清
  var FRAME_AUTO_FROM = ["#1e1e1e", "#000000", ""];
  var FRAME_PALETTE = [
    { c: "#1971c2", name: "蓝" },
    { c: "#2f9e44", name: "绿" },
    { c: "#f08c00", name: "橙" },
    { c: "#e03131", name: "红" },
    { c: "#9c36b5", name: "紫" },
    { c: "#ced4da", name: "灰白" },
  ];

  var COLOR_BLUE = "#007bff";
  var COLOR_GREEN = "#28a745";
  var COLOR_YELLOW = "#ffb300";
  var COLOR_RED = "#dc3545";

  // ---- 语言（与底部浮窗语言切换器共用；En=zh 双语文案取英文/中文）----
  var LANG_KEY = "excalidraw-canvas-lang";
  var LANG_BTN_ID = "lang-switch-btn";
  var LANG_MENU_ID = "lang-switch-menu";
  var LANGS = [
    { code: "zh-CN", label: "简体中文" },
    { code: "en", label: "English" },
  ];

  function getCurrentLang() {
    try {
      var c = localStorage.getItem(LANG_KEY);
      if (c === "en" || c === "zh-CN") return c;
    } catch (e) {}
    return "en"; // 默认英文（与 patch-i18n 注入的 bundle 默认值一致）
  }

  /** 双语文案：当前语言为 English 时返回 en，否则返回 zh */
  function T(en, zh) {
    return getCurrentLang() === "en" ? en : zh;
  }

  function injectLangSwitch() {
    if (document.getElementById(LANG_BTN_ID)) return;
    var fr = document.querySelector(".layer-ui__wrapper__footer-right");
    if (!fr || !fr.firstChild) return;
    var cur = getCurrentLang();

    var host = document.createElement("div");
    host.id = LANG_BTN_ID;
    host.style.cssText =
      "position:relative;display:inline-flex;align-items:center;margin-right:2px;vertical-align:middle;";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "help-icon";
    btn.title = "界面语言 / Language";
    btn.setAttribute("aria-label", "界面语言 / Language");
    btn.textContent = cur === "zh-CN" ? "中" : "EN";
    btn.style.cssText = "min-width:34px;font-size:13px;font-weight:600;cursor:pointer;";
    host.appendChild(btn);

    var menu = document.createElement("div");
    menu.id = LANG_MENU_ID;
    menu.style.cssText =
      "display:none;position:absolute;bottom:44px;right:0;background:#fff;" +
      "border:1px solid #d0d0d0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.16);" +
      "z-index:100;min-width:130px;overflow:hidden;padding:4px 0;";
    LANGS.forEach(function (l) {
      var item = document.createElement("button");
      item.type = "button";
      item.textContent = l.label;
      item.style.cssText =
        "display:block;width:100%;padding:9px 16px;border:none;font-size:13px;" +
        "cursor:pointer;text-align:left;color:#333;background:" +
        (l.code === cur ? "#eef0ff" : "#fff") + ";";
      item.addEventListener("mouseenter", function () {
        item.style.background = "#eef0ff";
      });
      item.addEventListener("mouseleave", function () {
        item.style.background = l.code === cur ? "#eef0ff" : "#fff";
      });
      item.addEventListener("click", function () {
        try {
          localStorage.setItem(LANG_KEY, l.code);
        } catch (e) {}
        location.reload();
      });
      menu.appendChild(item);
    });
    host.appendChild(menu);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", function () {
      menu.style.display = "none";
    });

    fr.insertBefore(host, fr.firstChild);
  }

  function findStatus() {
    var els = document.querySelectorAll(".controls .status");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.querySelector && el.querySelector(".status-dot")) return el;
    }
    return null;
  }

  function setBtn(btn, state, text, disabled) {
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = !!disabled;
    btn.style.opacity = disabled ? "0.6" : "1";
    btn.dataset.state = state;
  }

  function show(btn, showFlag) {
    if (!btn) return;
    btn.style.display = showFlag ? "" : "none";
  }

  function inject() {
    // 页面标题随语言切换（index.html 静态 title 由 patch-i18n 设为中文默认）
    var t = T("Excalidraw Canvas Workspace", "Excalidraw 画布工作区");
    if (document.title !== t) document.title = t;
    // 语言切换器（footer 浮窗）优先注入，独立于协作按钮状态
    injectLangSwitch();
    if (
      document.getElementById(BTN_ID) &&
      document.getElementById(APPROVE_BTN_ID) &&
      document.getElementById(REJECT_BTN_ID)
    ) {
      return;
    }
    var status = findStatus();
    if (!status || !status.parentElement) return;
    var controls = status.parentElement;

    if (!document.getElementById(BTN_ID)) {
      var btn = document.createElement("button");
      btn.id = BTN_ID;
      btn.className = "btn-primary";
      btn.style.marginRight = "4px";
      btn.textContent = T("Send to Agent", "发送给 Agent");
      btn.title = T("Send canvas to Pi Agent", "将当前画布发送给 Pi Agent 处理");
      btn.addEventListener("click", sendToAgent);
      controls.insertBefore(btn, status);
    }
    var sendBtn = document.getElementById(BTN_ID);

    if (!document.getElementById(FRAME_COLOR_BTN_ID)) {
      injectFrameColor(controls);
    }

    if (!document.getElementById(TASKSET_BTN_ID)) {
      // Send to Task Set：在 Send to Agent 左侧
      var tsBtn = document.createElement("button");
      tsBtn.id = TASKSET_BTN_ID;
      tsBtn.className = "btn-secondary";
      tsBtn.style.marginRight = "4px";
      tsBtn.style.backgroundColor = "#8b5cf6";
      tsBtn.textContent = T("Send to Task Set", "发送到任务集");
      tsBtn.title = T(
        "Write unfinished canvas tasks (grouped by frame) into each project's task_set.json",
        "将画布中各 frame 的未完成任务写入对应项目的 task_set.json（frame 名=项目名或绝对路径；行首 P0-P3 为优先级，✓/已完成 开头跳过）"
      );
      tsBtn.addEventListener("click", sendToTaskSet);
      controls.insertBefore(tsBtn, sendBtn);
    }

    if (!document.getElementById(APPROVE_BTN_ID)) {
      var approveBtn = document.createElement("button");
      approveBtn.id = APPROVE_BTN_ID;
      approveBtn.className = "btn-secondary";
      approveBtn.style.marginRight = "4px";
      approveBtn.textContent = T("Approve", "批准");
      approveBtn.addEventListener("click", approveCanvas);
      approveBtn.disabled = true;
      approveBtn.style.display = "none"; // 未 Send 时不显示
      controls.insertBefore(approveBtn, sendBtn.nextSibling || status);
    }

    if (!document.getElementById(REJECT_BTN_ID)) {
      var rejectBtn = document.createElement("button");
      rejectBtn.id = REJECT_BTN_ID;
      rejectBtn.className = "btn-secondary";
      rejectBtn.style.marginRight = "4px";
      rejectBtn.style.backgroundColor = COLOR_RED;
      rejectBtn.textContent = T("Reject", "拒绝");
      rejectBtn.title = T(
        "Revert sent content / cancel running task",
        "回退已发送内容 / 取消执行中任务"
      );
      rejectBtn.addEventListener("click", rejectCanvas);
      rejectBtn.disabled = false;
      rejectBtn.style.display = "none"; // 未 Send 时不显示
      var approveEl = document.getElementById(APPROVE_BTN_ID);
      controls.insertBefore(rejectBtn, (approveEl || sendBtn).nextSibling || status);
    }
  }

  function approveCanvas() {
    var approveBtn = document.getElementById(APPROVE_BTN_ID);
    setBtn(approveBtn, "sending", T("Approving...", "批准中…"), true);

    fetch("/api/elements")
      .then(function (r) {
        return r.json().then(function (data) {
          var arr = Array.isArray(data) ? data : data.elements || [];
          return { count: arr.length };
        });
      })
      .catch(function () {
        return { count: -1 };
      })
      .then(function (info) {
        var notifyUrl =
          location.protocol + "//" + location.hostname + ":" + NOTIFY_PORT + "/approve";
        return fetch(notifyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "webui",
            elements: info.count,
            approved_at: new Date().toISOString(),
          }),
        });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error("approve http " + resp.status);
        return resp.json();
      })
      .then(function () {
        // 已批准：绿色禁用，等待 Pi 回传结果后轮询隐藏
        approveBtn.disabled = true;
        approveBtn.style.backgroundColor = COLOR_GREEN;
        approveBtn.textContent = T("✓ Approved", "✓ 已批准");
        approveBtn.title = T("Approved, waiting for Pi result", "已批准，等待 Pi 执行结果");
      })
      .catch(function () {
        setBtn(approveBtn, "error", T("Approve failed", "批准失败"), false);
        setTimeout(function () {
          pollHealth(); // 恢复为实际状态（黄色待处理）
        }, 2000);
      });
  }

  function rejectCanvas() {
    var rejectBtn = document.getElementById(REJECT_BTN_ID);
    setBtn(rejectBtn, "sending", T("Reverting...", "回退中…"), true);

    fetch("/api/elements")
      .then(function (r) {
        return r.json().then(function (data) {
          var arr = Array.isArray(data) ? data : data.elements || [];
          return { count: arr.length };
        });
      })
      .catch(function () {
        return { count: -1 };
      })
      .then(function (info) {
        var notifyUrl =
          location.protocol + "//" + location.hostname + ":" + NOTIFY_PORT + "/reject";
        return fetch(notifyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "webui",
            elements: info.count,
            rejected_at: new Date().toISOString(),
          }),
        });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error("reject http " + resp.status);
        return resp.json();
      })
      .then(function () {
        setBtn(rejectBtn, "ok", T("✓ Reverted", "✓ 已回退"), false);
        // 立即隐藏 Approve / Reject（pending/approved 已清除），Send 可重新发送
        setTimeout(function () {
          show(document.getElementById(APPROVE_BTN_ID), false);
          show(document.getElementById(REJECT_BTN_ID), false);
          setBtn(rejectBtn, "idle", T("Reject", "拒绝"), false);
        }, 800);
      })
      .catch(function () {
        setBtn(rejectBtn, "error", T("Revert failed", "回退失败"), false);
        setTimeout(function () {
          setBtn(rejectBtn, "idle", T("Reject", "拒绝"), false);
        }, 2000);
      });
  }

  // ---- Frame 边框色：色板改色 + 新 frame 自动默认蓝 ----
  function apiElements() {
    return fetch("/api/elements")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        return Array.isArray(data) ? data : data.elements || [];
      });
  }

  function putFrameColor(id, color) {
    // 注意：不能传 type:"frame"（UpdateElementSchema 的 type 枚举不含 frame，会被 400 拒绝），
    // 只传 strokeColor；element_updated 广播会让浏览器实时变色
    return fetch("/api/elements/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strokeColor: color }),
    }).then(function (r) {
      if (!r.ok) throw new Error("update " + r.status);
      return r.json();
    });
  }

  /** 更新画布上所有 frame 的边框色（server 广播 element_updated，浏览器实时生效） */
  function setFrameColor(color) {
    return apiElements()
      .then(function (els) {
        var frames = els.filter(function (e) { return e.type === "frame"; });
        if (!frames.length) return { count: 0 };
        return Promise.all(
          frames.map(function (f) { return putFrameColor(f.id, color); })
        ).then(function () { return { count: frames.length }; });
      });
  }

  /** 轮询：新建 frame 为默认黑色时自动改蓝（用户改过的其他颜色不动） */
  function autoFixFrameColors() {
    apiElements()
      .then(function (els) {
        els
          .filter(function (e) {
            return (
              e.type === "frame" &&
              FRAME_AUTO_FROM.indexOf(String(e.strokeColor || "").toLowerCase()) !== -1
            );
          })
          .forEach(function (f) {
            putFrameColor(f.id, FRAME_DEFAULT_BLUE).catch(function () {});
          });
      })
      .catch(function () {});
  }

  function injectFrameColor(controls) {
    var host = document.createElement("div");
    host.id = FRAME_COLOR_BTN_ID;
    host.style.cssText = "position:relative;display:inline-flex;align-items:center;margin-right:4px;";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary";
    btn.textContent = T("Frame color", "Frame 边框色");
    btn.title = T(
      "Set border color for all frames on canvas. New frames default to blue.",
      "设置画布上所有 frame 的边框色；新建 frame 自动为蓝色"
    );
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    });
    host.appendChild(btn);

    var menu = document.createElement("div");
    menu.id = FRAME_COLOR_MENU_ID;
    menu.style.cssText =
      "display:none;position:absolute;top:40px;left:0;background:#fff;" +
      "border:1px solid #d0d0d0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.16);" +
      "z-index:100;padding:8px;display:flex;gap:8px;";
    FRAME_PALETTE.forEach(function (p) {
      var sw = document.createElement("button");
      sw.type = "button";
      sw.title = p.name + " " + p.c;
      sw.style.cssText =
        "width:24px;height:24px;border-radius:6px;cursor:pointer;border:2px solid #fff;" +
        "box-shadow:0 0 0 1px #ccc;background:" + p.c + ";";
      sw.addEventListener("click", function () {
        menu.style.display = "none";
        btn.textContent = T("Applying...", "应用中…");
        setFrameColor(p.c)
          .then(function (res) {
            btn.textContent =
              res.count > 0
                ? T("✓ " + res.count + " frame(s)", "✓ 已更新 " + res.count + " 个")
                : T("No frames", "画布上没有 frame");
            setTimeout(function () {
              btn.textContent = T("Frame color", "Frame 边框色");
            }, 2000);
          })
          .catch(function () {
            btn.textContent = T("Failed", "失败");
            setTimeout(function () {
              btn.textContent = T("Frame color", "Frame 边框色");
            }, 2000);
          });
      });
      menu.appendChild(sw);
    });
    host.appendChild(menu);
    document.addEventListener("click", function () {
      menu.style.display = "none";
    });

    controls.insertBefore(host, controls.firstChild);
  }

  function sendToTaskSet() {
    var btn = document.getElementById(TASKSET_BTN_ID);
    if (!btn) return;
    setBtn(btn, "sending", T("Writing...", "写入中…"), true);
    var notifyUrl =
      location.protocol + "//" + location.hostname + ":" + NOTIFY_PORT + "/task-set";
    fetch(notifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var ps = data.projects || [];
        var added = ps.reduce(function (s, p) { return s + (p.added || 0); }, 0);
        var errs = ps.filter(function (p) { return p.error; });
        if (errs.length && added === 0) {
          throw new Error(errs.map(function (p) { return p.frame + ": " + p.error; }).join("； "));
        }
        var ok = added > 0
          ? T("✓ Written " + added, "✓ 已写入 " + added + " 项")
          : T("✓ No new tasks", "✓ 无新增任务");
        btn.textContent = ok;
        btn.style.backgroundColor = COLOR_GREEN;
        btn.style.opacity = "1";
        btn.disabled = false;
        btn.title = ps
          .map(function (p) {
            return p.frame + " → +" + (p.added || 0) + (p.skipped ? " (跳过" + p.skipped + ")" : "") + (p.error ? " [" + p.error + "]" : "");
          })
          .join("\n") || T("No frames on canvas", "画布上没有 frame");
        setTimeout(function () {
          setBtn(btn, "idle", T("Send to Task Set", "发送到任务集"), false);
          btn.style.backgroundColor = "#8b5cf6";
        }, 3000);
      })
      .catch(function (e) {
        setBtn(btn, "error", T("Write failed", "写入失败"), false);
        btn.title = e && e.message ? e.message : "";
        setTimeout(function () {
          setBtn(btn, "idle", T("Send to Task Set", "发送到任务集"), false);
          btn.style.backgroundColor = "#8b5cf6";
        }, 3000);
      });
  }

  function sendToAgent() {
    var btn = document.getElementById(BTN_ID);
    setBtn(btn, "sending", T("Sending...", "发送中…"), true);

    fetch("/api/elements")
      .then(function (r) {
        return r.json().then(function (data) {
          // 响应格式: { success, elements: [...], count }
          var arr = Array.isArray(data) ? data : data.elements || [];
          return { count: arr.length };
        });
      })
      .catch(function () {
        return { count: -1 };
      })
      .then(function (info) {
        var notifyUrl =
          location.protocol + "//" + location.hostname + ":" + NOTIFY_PORT + "/notify";
        return fetch(notifyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "webui",
            elements: info.count,
            sent_at: new Date().toISOString(),
          }),
        });
      })
      .then(function (resp) {
        if (!resp.ok) throw new Error("notify http " + resp.status);
        return resp.json();
      })
      .then(function () {
        // 保存画布快照（Reject 时恢复画布用）
        fetch(
          location.protocol + "//" + location.hostname + ":" + NOTIFY_PORT + "/snapshot",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "webui" }),
          }
        ).catch(function () {});
        // 短暂约 1s：绿色背景 + "已发送"，随后恢复蓝色
        btn.textContent = T("Sent ✓", "已发送");
        btn.style.backgroundColor = COLOR_GREEN;
        btn.style.opacity = "1";
        btn.disabled = false;
        setTimeout(function () {
          btn.textContent = T("Send to Agent", "发送给 Agent");
          btn.style.backgroundColor = COLOR_BLUE;
        }, 1000);
        // Send 成功后：显示 Approve（黄）与 Reject（红）
        var approveBtn = document.getElementById(APPROVE_BTN_ID);
        var rejectBtn = document.getElementById(REJECT_BTN_ID);
        if (approveBtn) {
          approveBtn.disabled = false;
          approveBtn.style.backgroundColor = COLOR_YELLOW;
          approveBtn.textContent = T("Approve", "批准");
          approveBtn.title = T(
            "Review the canvas carefully before executing",
            "请严肃审查画布内容，再点击执行"
          );
          show(approveBtn, true);
        }
        if (rejectBtn) {
          setBtn(rejectBtn, "idle", T("Reject", "拒绝"), false);
          show(rejectBtn, true);
        }
      })
      .catch(function () {
        setBtn(btn, "error", T("Notify failed", "通知失败"), false);
        setTimeout(function () {
          setBtn(btn, "idle", T("Send to Agent", "发送给 Agent"), false);
        }, 2500);
      });
  }

  var mo = new MutationObserver(inject);
  if (document.body) {
    mo.observe(document.body, { childList: true, subtree: true });
  } else {
    window.addEventListener("DOMContentLoaded", function () {
      mo.observe(document.body, { childList: true, subtree: true });
    });
  }
  inject();

  // ---- Approve / Reject 状态轮询（3s）----
  // 未 Send（pending=false, approved=false）: 两按钮隐藏
  // 待处理（pending=true）                 : Approve 黄 + Reject 红 显示
  // 已批准（approved=true）                : Approve 绿 + Reject 红 显示
  // Pi 回传结果（标记清除）                : 两按钮隐藏
  function pollHealth() {
    var approveBtn = document.getElementById(APPROVE_BTN_ID);
    var rejectBtn = document.getElementById(REJECT_BTN_ID);
    if (!approveBtn && !rejectBtn) return;
    fetch(
      location.protocol + "//" + location.hostname + ":" + NOTIFY_PORT + "/health"
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (h) {
        updateButtonsState(approveBtn, rejectBtn, h);
      })
      .catch(function () {
        // 通知服务不可达：不改变按钮状态
      });
  }

  function updateButtonsState(approveBtn, rejectBtn, h) {
    if (!h) return;
    if (h.approved) {
      if (approveBtn) {
        approveBtn.disabled = true;
        approveBtn.style.backgroundColor = COLOR_GREEN;
        approveBtn.textContent = T("✓ Approved", "✓ 已批准");
        approveBtn.title = T("Approved, waiting for Pi result", "已批准，等待 Pi 执行结果");
        show(approveBtn, true);
      }
      if (rejectBtn) {
        setBtn(rejectBtn, "idle", T("Reject", "拒绝"), false);
        show(rejectBtn, true);
      }
    } else if (h.pending) {
      if (approveBtn) {
        approveBtn.disabled = false;
        approveBtn.style.backgroundColor = COLOR_YELLOW;
        approveBtn.textContent = T("Approve", "批准");
        approveBtn.title = T(
          "Review the canvas carefully before executing",
          "请严肃审查画布内容，再点击执行"
        );
        show(approveBtn, true);
      }
      if (rejectBtn) {
        setBtn(rejectBtn, "idle", T("Reject", "拒绝"), false);
        show(rejectBtn, true);
      }
    } else {
      // 未 Send 或已回传结果：隐藏两按钮
      show(approveBtn, false);
      show(rejectBtn, false);
    }
  }

  setInterval(pollHealth, 3000);
  pollHealth();
  setInterval(autoFixFrameColors, 3000);
  autoFixFrameColors();
})();
