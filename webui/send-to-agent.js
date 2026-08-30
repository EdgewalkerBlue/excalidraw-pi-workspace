/**
 * Web UI "Send to Agent / Approve / Reject" 注入脚本
 *
 * 在 Excalidraw Web UI 的连接状态（Connected）左侧插入三个按钮：
 *   - Send to Agent : 发送画布通知给 Pi（蓝色；成功后约 1s 绿色"已发送"）
 *   - Approve       : 批准画布任务（黄色待处理→绿色已批准；未 Send 时不显示）
 *   - Reject        : 回退已发送内容/取消执行中任务（红色；未 Send 时不显示）
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
  var NOTIFY_PORT = 5010;

  var COLOR_BLUE = "#007bff";
  var COLOR_GREEN = "#28a745";
  var COLOR_YELLOW = "#ffb300";
  var COLOR_RED = "#dc3545";

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
      btn.textContent = "Send to Agent";
      btn.title = "将当前画布发送给 Pi Agent 处理";
      btn.addEventListener("click", sendToAgent);
      controls.insertBefore(btn, status);
    }
    var sendBtn = document.getElementById(BTN_ID);

    if (!document.getElementById(APPROVE_BTN_ID)) {
      var approveBtn = document.createElement("button");
      approveBtn.id = APPROVE_BTN_ID;
      approveBtn.className = "btn-secondary";
      approveBtn.style.marginRight = "4px";
      approveBtn.textContent = "Approve";
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
      rejectBtn.textContent = "Reject";
      rejectBtn.title = "回退已发送内容 / 取消执行中任务";
      rejectBtn.addEventListener("click", rejectCanvas);
      rejectBtn.disabled = false;
      rejectBtn.style.display = "none"; // 未 Send 时不显示
      var approveEl = document.getElementById(APPROVE_BTN_ID);
      controls.insertBefore(rejectBtn, (approveEl || sendBtn).nextSibling || status);
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
        // 已批准：绿色禁用，等待 Pi 回传结果后轮询隐藏
        approveBtn.disabled = true;
        approveBtn.style.backgroundColor = COLOR_GREEN;
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

  function rejectCanvas() {
    var rejectBtn = document.getElementById(REJECT_BTN_ID);
    setBtn(rejectBtn, "sending", "回退中…", true);

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
        setBtn(rejectBtn, "ok", "✓ 已回退", false);
        // 立即隐藏 Approve / Reject（pending/approved 已清除），Send 可重新发送
        setTimeout(function () {
          show(document.getElementById(APPROVE_BTN_ID), false);
          show(document.getElementById(REJECT_BTN_ID), false);
          setBtn(rejectBtn, "idle", "Reject", false);
        }, 800);
      })
      .catch(function () {
        setBtn(rejectBtn, "error", "回退失败", false);
        setTimeout(function () {
          setBtn(rejectBtn, "idle", "Reject", false);
        }, 2000);
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
        // 短暂约 1s：绿色背景 + "已发送"，随后恢复蓝色
        btn.textContent = "已发送";
        btn.style.backgroundColor = COLOR_GREEN;
        btn.style.opacity = "1";
        btn.disabled = false;
        setTimeout(function () {
          btn.textContent = "Send to Agent";
          btn.style.backgroundColor = COLOR_BLUE;
        }, 1000);
        // Send 成功后：显示 Approve（黄）与 Reject（红）
        var approveBtn = document.getElementById(APPROVE_BTN_ID);
        var rejectBtn = document.getElementById(REJECT_BTN_ID);
        if (approveBtn) {
          approveBtn.disabled = false;
          approveBtn.style.backgroundColor = COLOR_YELLOW;
          approveBtn.textContent = "Approve";
          approveBtn.title = "请严肃审查画布内容，再点击执行";
          show(approveBtn, true);
        }
        if (rejectBtn) {
          setBtn(rejectBtn, "idle", "Reject", false);
          show(rejectBtn, true);
        }
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
        approveBtn.textContent = "✓ 已批准";
        approveBtn.title = "已批准，等待 Pi 执行结果";
        show(approveBtn, true);
      }
      if (rejectBtn) {
        setBtn(rejectBtn, "idle", "Reject", false);
        show(rejectBtn, true);
      }
    } else if (h.pending) {
      if (approveBtn) {
        approveBtn.disabled = false;
        approveBtn.style.backgroundColor = COLOR_YELLOW;
        approveBtn.textContent = "Approve";
        approveBtn.title = "请严肃审查画布内容，再点击执行";
        show(approveBtn, true);
      }
      if (rejectBtn) {
        setBtn(rejectBtn, "idle", "Reject", false);
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
})();
