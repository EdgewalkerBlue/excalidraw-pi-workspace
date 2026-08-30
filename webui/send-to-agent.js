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
      approveBtn.textContent = "Approve";
      approveBtn.addEventListener("click", approveCanvas);
      // 初始状态：灰色禁用（未 Send 前不可点击）
      approveBtn.disabled = true;
      approveBtn.style.backgroundColor = "#adb5bd";
      approveBtn.title = "请先点击 Send to Agent";
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
        // 已批准：绿色禁用，等待 Pi 回传结果后轮询恢复灰色
        approveBtn.disabled = true;
        approveBtn.style.backgroundColor = "#28a745";
        approveBtn.textContent = "✓ 已批准";
        approveBtn.title = "已批准，等待 Pi 执行结果";
      })
      .catch(function () {
        setBtn(approveBtn, "error", "批准失败", false);
        setTimeout(function () {
          pollHealth(); // 恢复为实际状态（黄色待处理）
        }, 2000);
      });
  }

  function sendToAgent() {
    var btn = document.getElementById(BTN_ID);
    setBtn(btn, "sending", "发送中…", true);
    // Send 成功后即时反馈：Approve 变黄色可点击（与轮询一致）
    var approveBtn = document.getElementById(APPROVE_BTN_ID);
    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.style.backgroundColor = "#ffb300";
      approveBtn.textContent = "Approve";
      approveBtn.title = "请严肃审查画布内容，再点击执行";
    }

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
        // 短暂约 1s：绿色背景 + “已发送”，随后恢复蓝色
        btn.textContent = "已发送";
        btn.style.backgroundColor = "#28a745";
        btn.style.opacity = "1";
        btn.disabled = false;
        setTimeout(function () {
          btn.textContent = "Send to Agent";
          btn.style.backgroundColor = "#007bff";
        }, 1000);
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

  // ---- Approve 状态机轮询（3s）----
  // 灰: 无待处理 / Pi 已回传结果（标记被清除）
  // 黄: 已 Send 待处理（pending=true, approved=false），可点击
  // 绿: 已批准（approved=true），禁用，等待 Pi 回传结果
  function pollHealth() {
    var approveBtn = document.getElementById(APPROVE_BTN_ID);
    if (!approveBtn) return;
    fetch(
      location.protocol + "//" + location.hostname + ":" + NOTIFY_PORT + "/health"
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (h) {
        updateApproveState(approveBtn, h);
      })
      .catch(function () {
        // 通知服务不可达：不改变按钮状态
      });
  }

  function updateApproveState(btn, h) {
    if (!h) return;
    if (h.approved) {
      btn.disabled = true;
      btn.style.backgroundColor = "#28a745";
      btn.textContent = "✓ 已批准";
      btn.title = "已批准，等待 Pi 执行结果";
    } else if (h.pending) {
      btn.disabled = false;
      btn.style.backgroundColor = "#ffb300";
      btn.textContent = "Approve";
      btn.title = "请严肃审查画布内容，再点击执行";
    } else {
      btn.disabled = true;
      btn.style.backgroundColor = "#adb5bd";
      btn.textContent = "Approve";
      btn.title = "请先点击 Send to Agent";
    }
  }

  setInterval(pollHealth, 3000);
  pollHealth();
})();
