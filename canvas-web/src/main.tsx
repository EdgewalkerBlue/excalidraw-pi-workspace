import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// 官方底层样式表：必须用官方入口引入（Excalidraw package exports ./index.css，
// dist JS 不会自动注入样式）。缺此行画布将无任何官方 UI 样式。
import "@excalidraw/excalidraw/index.css";
import CanvasApp from "./CanvasApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CanvasApp />
  </StrictMode>,
);
