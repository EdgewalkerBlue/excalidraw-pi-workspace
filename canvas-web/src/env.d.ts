declare const __CANVAS_BASELINE__: {
  /** 基线 commit 短 sha（7 位），对应上游 excalidraw/excalidraw master 的快照点 */
  commit: string;
  /** 基线 commit 日期 YYYY-MM-DD */
  date: string;
  /** 该快照对应的官方 npm 构建版本号，如 0.18.0-c0ad61c */
  version?: string;
};

/** 二开仓库地址（构建期由 canvas-web/vite.config.ts 注入），用于官方菜单里的自建链接 */
declare const __FORK_REPO_URL__: string;
