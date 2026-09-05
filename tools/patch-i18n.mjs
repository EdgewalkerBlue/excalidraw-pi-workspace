#!/usr/bin/env node
/**
 * i18n 补丁脚本
 *
 * 让 mcp-excalidraw-server Web UI（:5001）默认使用中文界面，并提供语言切换：
 *
 *   1. 修改 Excalidraw bundle（index-DBs1chWU.js）：
 *      - 默认语言 en → zh-CN（与 excalidraw.com 使用相同的官方翻译包）
 *      - 支持 localStorage["excalidraw-canvas-lang"] 覆盖（语言切换器写入，
 *        值为 "zh-CN" 时显示中文，否则默认英文）
 *      - 右上角 header 文本随语言切换（渲染时读 localStorage 动态选择
 *        中/英文；"清除画布"用官方 zh-CN 条目，其余自译）
 *      - 补齐官方 zh-CN 翻译缺失组（画布查找/箭头类型/元素链接/图片裁剪/
 *        框架/流程图/AI 文字转图表等 0.18 新功能，约 50 条，译法随语言切换）
 *   1b. 页面标题（index.html <title>）→ "Excalidraw 画布工作区"
 *   2. 同步 webui/send-to-agent.js → dist/frontend/send-to-agent.js
 *      （send-to-agent.js 内含底部浮窗语言切换器）
 *
 * 幂等：重复执行安全；升级 mcp-excalidraw-server 后需重跑本脚本
 * （start-canvas.bat 启动时也会自动执行）。
 *
 * 用法：node tools/patch-i18n.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FRONTEND = path.resolve(
  ROOT,
  "node_modules",
  "mcp-excalidraw-server",
  "dist",
  "frontend"
);

// ---------- 1. Excalidraw bundle 默认语言 → zh-CN + 右上角 UI 文本中文化 ----------
const BUNDLE = path.join(FRONTEND, "assets", "index-DBs1chWU.js");
const OLD_VH = `vh={code:"en",label:"English"}`;
const NEW_VH =
  `vh=(localStorage.getItem("excalidraw-canvas-lang")!=="zh-CN"` +
  `?{code:"en",label:"English"}:{code:"zh-CN",label:"简体中文"})`;

// 右上角 header 文本（React bundle 内硬编码英文，非 Excalidraw i18n 管理）：
// 每次渲染时读 localStorage 判断语言（与底部语言切换器联动），
// "清除画布"取官方 zh-CN 条目（clearCanvas dialog title），其余自译。
// Q：运行时语言判断表达式（默认英文：未存或存非 zh-CN 值均显示英文，
// 显式存 "zh-CN" 才显示中文）
const Q = `"zh-CN"!==localStorage.getItem("excalidraw-canvas-lang")`;
// 翻译缺失组：Excalidraw 0.18 新功能官方 zh-CN 未跟进，运行时回退英文。
// 替换为动态三元（键:(Q?"EN":"中文")），与语言切换器联动。
// 所有 oldStr 均已验证在 bundle 内唯一（zoomToFit 两处同文案，统一替换）。
const UI_TEXT_PATCHES = [
  // ---- 主菜单：画布查找（PL 对象，官方 zh-CN 缺失） ----
  [`PL={title:"Find on canvas",noMatch:"No matches found...",singleResult:"result",multipleResults:"results",placeholder:"Find text on canvas..."}`,
   `PL={title:${Q}?"Find on canvas":"画布内查找",noMatch:${Q}?"No matches found...":"未找到匹配项",singleResult:${Q}?"result":"个匹配项",multipleResults:${Q}?"results":"个匹配项",placeholder:${Q}?"Find text on canvas...":"在画布中查找文本..."}`],
  [`dismissSearch:"Escape to dismiss search"`, `dismissSearch:${Q}?"Escape to dismiss search":"按 Esc 退出搜索"`],

  // ---- 主菜单：链接分组与社交（官方 zh-CN 缺失；GitHub 专名保留） ----
  [`title:"Excalidraw links"`, `title:${Q}?"Excalidraw links":"Excalidraw 链接"`],
  [`followUs:"Follow us"`, `followUs:${Q}?"Follow us":"关注我们"`],
  [`discordChat:"Discord chat"`, `discordChat:${Q}?"Discord chat":"Discord 聊天"`],

  // ---- 箭头 ----
  [`editArrow:"Edit arrow"`, `editArrow:${Q}?"Edit arrow":"编辑箭头"`],
  [`arrowtypes:"Arrow type"`, `arrowtypes:${Q}?"Arrow type":"箭头类型"`],
  [`arrowtype_sharp:"Sharp arrow"`, `arrowtype_sharp:${Q}?"Sharp arrow":"尖角箭头"`],
  [`arrowtype_round:"Curved arrow"`, `arrowtype_round:${Q}?"Curved arrow":"弧形箭头"`],
  [`arrowtype_elbowed:"Elbow arrow"`, `arrowtype_elbowed:${Q}?"Elbow arrow":"折线箭头"`],

  // ---- 元素链接 ----
  [`linkToElement:"Link to object"`, `linkToElement:${Q}?"Link to object":"链接到对象"`],
  [`copyElementLink:"Copy link to object"`, `copyElementLink:${Q}?"Copy link to object":"复制对象链接"`],
  [`desc:"Click on a shape on canvas or paste a link."`, `desc:${Q}?"Click on a shape on canvas or paste a link.":"点击画布上的形状或粘贴链接。"`],
  [`notFound:"Linked object wasn't found on canvas."`, `notFound:${Q}?"Linked object wasn't found on canvas.":"未在画布中找到链接的对象。"`],
  [`elementLinkCopied:"Link copied to clipboard"`, `elementLinkCopied:${Q}?"Link copied to clipboard":"对象链接已复制到剪贴板"`],
  [`hint:"Type or paste your link here"`, `hint:${Q}?"Type or paste your link here":"在此输入或粘贴链接"`],

  // ---- 图片裁剪 ----
  [`imageCropping:"Image cropping"`, `imageCropping:${Q}?"Image cropping":"图片裁剪"`],
  [`cropStart:"Crop image"`, `cropStart:${Q}?"Crop image":"裁剪图片"`],
  [`cropFinish:"Finish image cropping"`, `cropFinish:${Q}?"Finish image cropping":"完成图片裁剪"`],
  [`enterCropEditor:"Double click the image or press ENTER to crop the image"`, `enterCropEditor:${Q}?"Double click the image or press ENTER to crop the image":"双击图片或按 Enter 进入图片裁剪"`],
  [`unCroppedDimension:"Uncropped dimension"`, `unCroppedDimension:${Q}?"Uncropped dimension":"原始尺寸"`],

  // ---- 框架 ----
  [`wrapSelectionInFrame:"Wrap selection in frame"`, `wrapSelectionInFrame:${Q}?"Wrap selection in frame":"将选中内容封装为框架"`],
  [`removeAllElementsFromFrame:"Remove all elements from frame"`, `removeAllElementsFromFrame:${Q}?"Remove all elements from frame":"移除框架内所有元素"`],

  // ---- 流程图 ----
  [`createFlowchart:"Hold CtrlOrCmd and Arrow key to create a flowchart"`, `createFlowchart:${Q}?"Hold CtrlOrCmd and Arrow key to create a flowchart":"按住 Ctrl/Cmd 和方向键创建流程图"`],
  [`navigateFlowchart:"Navigate a flowchart"`, `navigateFlowchart:${Q}?"Navigate a flowchart":"在流程图中导航"`],

  // ---- AI 文字转图表 ----
  [`textToDiagram:"Text to diagram"`, `textToDiagram:${Q}?"Text to diagram":"文字转图表"`],
  [`prompt:"Prompt"`, `prompt:${Q}?"Prompt":"提示词"`],
  [`children:"Generate"`, `children:${Q}?"Generate":"生成"`],
  [`message:"No generation data"`, `message:${Q}?"No generation data":"暂无生成数据"`],

  // ---- 取色 / 缩放 ----
  [`eyeDropper:"Pick color from canvas"`, `eyeDropper:${Q}?"Pick color from canvas":"从画布中取色"`],
  [`zoomToFit:"Zoom to fit all elements"`, `zoomToFit:${Q}?"Zoom to fit all elements":"缩放以适配所有元素"`],
  [`zoomToFitViewport:"Zoom to fit in viewport"`, `zoomToFitViewport:${Q}?"Zoom to fit in viewport":"缩放至视口"`],
  [`zoomToFitSelection:"Zoom to fit selection"`, `zoomToFitSelection:${Q}?"Zoom to fit selection":"缩放至选中内容"`],

  // ---- 通用菜单/面板 ----
  [`more_options:"More options"`, `more_options:${Q}?"More options":"更多选项"`],
  [`toggleGrid:"Toggle grid"`, `toggleGrid:${Q}?"Toggle grid":"切换网格"`],
  [`theme:"Theme"`, `theme:${Q}?"Theme":"主题"`],
  [`systemMode:"System mode"`, `systemMode:${Q}?"System mode":"跟随系统"`],
  [`autoResize:"Enable text auto-resizing"`, `autoResize:${Q}?"Enable text auto-resizing":"启用文字自动调整大小"`],
  [`showFonts:"Show font picker"`, `showFonts:${Q}?"Show font picker":"显示字体选择器"`],
  [`goToElement:"Go to target element"`, `goToElement:${Q}?"Go to target element":"跳转到目标元素"`],
  [`generalStats:"General"`, `generalStats:${Q}?"General":"常规"`],
  [`elementProperties:"Shape properties"`, `elementProperties:${Q}?"Shape properties":"形状属性"`],
  [`sceneFonts:"In this scene"`, `sceneFonts:${Q}?"In this scene":"当前场景"`],
  [`availableFonts:"Available fonts"`, `availableFonts:${Q}?"Available fonts":"可用字体"`],
  [`select:"Select"`, `select:${Q}?"Select":"选择"`],
  [`recents:"Recently used"`, `recents:${Q}?"Recently used":"最近使用"`],
  [`itemNotAvailable:"Command is not available..."`, `itemNotAvailable:${Q}?"Command is not available...":"该命令不可用…"`],
  [`paletteName:"Change canvas background color"`, `paletteName:${Q}?"Change canvas background color":"更改画布背景颜色"`],
  [`links:"Links"`, `links:${Q}?"Links":"链接"`],
  [`changeStroke:"Change stroke color"`, `changeStroke:${Q}?"Change stroke color":"修改描边颜色"`],
  [`changeBackground:"Change background color"`, `changeBackground:${Q}?"Change background color":"修改背景颜色"`],
  [`clearCanvas:"Clear canvas"`, `clearCanvas:${Q}?"Clear canvas":"清空画布"`],
  [`loadScene:"Load scene from file"`, `loadScene:${Q}?"Load scene from file":"从文件加载场景"`],

  // ---- 实时协作语音（本项目暂不用，一并补齐） ----
  [`followStatus:"You're currently following this user"`, `followStatus:${Q}?"You're currently following this user":"你正在跟随该用户"`],
  [`inCall:"User is in a voice call"`, `inCall:${Q}?"User is in a voice call":"该用户正在进行语音通话"`],
  [`micMuted:"User's microphone is muted"`, `micMuted:${Q}?"User's microphone is muted":"该用户的麦克风已静音"`],
  [`isSpeaking:"User is speaking"`, `isSpeaking:${Q}?"User is speaking":"该用户正在讲话"`],
  [`action:"UNFOLLOW"`, `action:${Q}?"UNFOLLOW":"取消跟随"`],

  // ---- 右上角 header（上一轮已补） ----
  [`children:"Excalidraw Canvas"`, `children:${Q}?"Excalidraw Canvas":"Excalidraw 画布"`],
  [`c==="syncing"?"Syncing...":"Sync to Backend"`, `c==="syncing"?(${Q}?"Syncing...":"同步中…"):(${Q}?"Sync to Backend":"同步到后端")`],
  [`children:"✅ Synced"`, `children:${Q}?"✅ Synced":"✅ 已同步"`],
  [`children:"❌ Sync Failed"`, `children:${Q}?"❌ Sync Failed":"❌ 同步失败"`],
  [`children:["Last sync: ",k(l)]`, `children:[${Q}?"Last sync: ":"上次同步：",k(l)]`],
  [`children:"Clear Canvas"`, `children:${Q}?"Clear Canvas":"清除画布"`],
  [`children:r?"Connected":"Disconnected"`, `children:r?(${Q}?"Connected":"已连接"):(${Q}?"Disconnected":"已断开")`],
];

// 页面标题（index.html 静态 <title>，始终可见）
const INDEX_HTML = path.join(FRONTEND, "index.html");
const OLD_TITLE = "<title>Excalidraw POC - Backend API Integration</title>";
const NEW_TITLE = "<title>Excalidraw Canvas Workspace</title>"; // 默认英文；页面加载后由 send-to-agent.js 按语言动态覆盖
function patchTitle() {
  if (!fs.existsSync(INDEX_HTML)) {
    console.error(`[patch-i18n] 未找到 index.html: ${INDEX_HTML}`);
    return false;
  }
  let html = fs.readFileSync(INDEX_HTML, "utf8");
  if (html.includes(NEW_TITLE)) {
    console.log("[patch-i18n] 页面标题已更新过，跳过");
    return true;
  }
  if (!html.includes(OLD_TITLE)) {
    console.error("[patch-i18n] 未找到 title 标记，请人工检查: " + OLD_TITLE);
    return false;
  }
  fs.writeFileSync(INDEX_HTML, html.replace(OLD_TITLE, NEW_TITLE), "utf8");
  console.log("[patch-i18n] 页面标题已设为中文（浏览器标签页）");
  return true;
}

function patchBundle() {
  if (!fs.existsSync(BUNDLE)) {
    console.error(`[patch-i18n] 未找到 bundle: ${BUNDLE}`);
    return false;
  }
  let src = fs.readFileSync(BUNDLE, "utf8");
  let changed = false;

  // 1a. 默认语言
  if (src.includes(NEW_VH)) {
    console.log("[patch-i18n] bundle 默认语言已打过补丁，跳过");
  } else if (src.includes(OLD_VH)) {
    src = src.replace(OLD_VH, NEW_VH);
    changed = true;
    console.log("[patch-i18n] bundle 默认语言已设为英文 (en)");
  } else {
    console.error(
      "[patch-i18n] 未找到 vh 默认值标记，可能版本已变更，请人工检查: " + OLD_VH
    );
    return false;
  }

  // 1c. 前端心跳 sync 降频：变化后防抖全量上传 1200ms → 5000ms（实时性由 WS 逐元素广播保证；
  //     服务端 noop/合并已挡等价上传）—— 大画布/多端下显著减少网络与写盘
  const OLD_NVE = `Nve=1200`;
  const NEW_NVE = `Nve=5000`;
  if (src.includes(NEW_NVE)) {
    console.log("[patch-i18n] 心跳 sync 已降频(5s)，跳过");
  } else if (src.includes(OLD_NVE)) {
    src = src.split(OLD_NVE).join(NEW_NVE);
    changed = true;
    console.log("[patch-i18n] 前端心跳 sync 降频 1200ms → 5000ms");
  } else {
    console.error("[patch-i18n] 未找到 Nve 标记，请人工检查 bundle");
    return false;
  }

  // 1b. 右上角 UI 文本（逐条幂等替换）
  for (const [oldStr, newStr] of UI_TEXT_PATCHES) {
    if (src.includes(newStr)) continue; // 已替换
    if (!src.includes(oldStr)) {
      console.error(`[patch-i18n] 未找到文本标记，请人工检查: ${oldStr}`);
      return false;
    }
    src = src.split(oldStr).join(newStr);
    changed = true;
    console.log(`[patch-i18n] 已替换: ${oldStr} → ${newStr}`);
  }

  if (changed) fs.writeFileSync(BUNDLE, src, "utf8");
  return true;
}

// ---------- 2. 同步 send-to-agent.js（含语言切换器） ----------
function syncInjection() {
  const src = path.join(ROOT, "webui", "send-to-agent.js");
  const dst = path.join(FRONTEND, "send-to-agent.js");
  if (!fs.existsSync(src)) {
    console.error(`[patch-i18n] 缺少源文件: ${src}`);
    return false;
  }
  const a = fs.readFileSync(src, "utf8");
  const b = fs.existsSync(dst) ? fs.readFileSync(dst, "utf8") : null;
  if (a === b) {
    console.log("[patch-i18n] send-to-agent.js 已同步，跳过");
    return true;
  }
  fs.writeFileSync(dst, a, "utf8");
  console.log("[patch-i18n] send-to-agent.js 已同步到 dist/frontend/");
  return true;
}

// ---------- 3. 升级 PWA 缓存版本（已安装客户端强制刷新 bundle/注入脚本） ----------
// 每次 patch 内容变更（文本替换/注入脚本更新）后需提升目标版本
const TARGET_SW_VER = 11;
function bumpSwCache() {
  const sw = path.join(FRONTEND, "sw.js");
  if (!fs.existsSync(sw)) return true; // 未启用 PWA 则跳过
  const src = fs.readFileSync(sw, "utf8");
  const m = src.match(/excalidraw-workspace-v(\d+)/);
  if (!m) return true;
  const cur = parseInt(m[1], 10);
  if (cur >= TARGET_SW_VER) {
    console.log(`[patch-i18n] sw.js 缓存版本已为 v${cur}，无需升级`);
    return true;
  }
  fs.writeFileSync(
    sw,
    src.replace(/excalidraw-workspace-v\d+/g, `excalidraw-workspace-v${TARGET_SW_VER}`),
    "utf8"
  );
  console.log(`[patch-i18n] sw.js 缓存版本 v${cur} → v${TARGET_SW_VER}（已安装 PWA 将强制刷新缓存）`);
  return true;
}

const ok1 = patchBundle();
const ok2 = syncInjection();
const ok3 = bumpSwCache();
const ok4 = patchTitle();
if (!ok1 || !ok2 || !ok3 || !ok4) process.exit(1);
console.log("[patch-i18n] 完成");
