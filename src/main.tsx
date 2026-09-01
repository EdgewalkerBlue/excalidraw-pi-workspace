import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Excalidraw 自身样式（工具栏/菜单/主题变量）必须显式引入，否则 UI 全部流式堆叠、比例错乱
import "@excalidraw/excalidraw/index.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
