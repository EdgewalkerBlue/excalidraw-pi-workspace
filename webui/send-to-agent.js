/**
 * Web UI "Send to Agent" 注入脚本
 *
 * 在 Excalidraw Web UI 的连接状态（Connected）左侧插入按钮，
 * 点击后将当前画布快照通知 Pi Agent（写入 .agent/pending.json 标记）。
 *
 * 依赖：tools/agent-notify.mjs（监听 5010）运行中。
 * 幂等：重复注入安全。
 */
(function () {
  "use strict";

  var BTN_ID = "send-to-agent-btn";
  var APPROVE_BTN_ID = "approve-btn";
  var NOTIFY_PORT = 5010;

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

  function inject() {
    if (document.getElementById(BTN_ID) && document.getElementById(APPROVE_BTN_ID)) return;
    var status = findStatus();
    if (!status || !status.parentElement) return;
    var controls = status.parentElement;

    if (!document.getElementById(BTN_ID)) {
      var btn = document.createElement("button");
      btn.id = BTN_ID;
      btn.className = "btn-primary";
      btn.style.marginRight = "4px";
      btn.textContent = "Send to Agent";
      btn.title = "将当前画布发送给 Pi Agent 处理";
      btn.addEventListener("click", sendToAgent);
      // 放在 Connected 状态左侧
      controls.insertBefore(btn, status);
    }

    if (!document.getElementById(APPROVE_BTN_ID)) {
      var approveBtn = document.createElement("button");
      approveBtn.id = APPROVE_BTN_ID;
      approveBtn.className = "btn-secondary";
      approveBtn.style.marginRight = "4px";
      approveBtn.style.backgroundColor = "#28a745";
      approveBtn.textContent = "Approve";
      approveBtn.title = "批准当前画布，通知 Pi 执行（与 Pi 内回复 approve 等效）";
      approveBtn.addEventListener("click", approveCanvas);
      // 放在 Send to Agent 右侧（Connected 左侧）
      var sendBtn = document.getElementById(BTN_ID);
      if (sendBtn) {
        controls.insertBefore(approveBtn, sendBtn.nextSibling || status);
      } else {
        controls.insertBefore(approveBtn, status);
      }
    }
  }

  function approveCanvas() {
    var approveBtn = document.getElementById(APPROVE_BTN_ID);
    setBtn(approveBtn, "sending", "批准中…", true);

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
        setBtn(approveBtn, "ok", "✓ 已批准", false);
        setTimeout(function () {
          setBtn(approveBtn, "idle", "Approve", false);
        }, 2500);
      })
      .catch(function () {
        setBtn(approveBtn, "error", "批准失败", false);
        setTimeout(function () {
          setBtn(approveBtn, "idle", "Approve", false);
        }, 2500);
      });
  }

  function sendToAgent() {
    var btn = document.getElementById(BTN_ID);
    setBtn(btn, "sending", "发送中…", true);

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
        setBtn(btn, "ok", "✓ 已发送", false);
        setTimeout(function () {
          setBtn(btn, "idle", "Send to Agent", false);
        }, 2500);
      })
      .catch(function () {
        setBtn(btn, "error", "通知失败", false);
        setTimeout(function () {
          setBtn(btn, "idle", "Send to Agent", false);
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
})();
