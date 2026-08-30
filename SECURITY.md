# 安全说明（phase_7）

## 当前部署形态

- Canvas server 绑定 `0.0.0.0:5001`（局域网可访问，API **无内置认证**）
- 默认假设为**可信局域网**（192.168.0.0/23），防火墙仅放行该子网访问 5001
- Android 通过 `http://192.168.0.1:5001` 访问

## 认证（按需启用）

当画布需要暴露到**公网**或不可信网络时，必须启用认证：

```bash
# 1. 将 canvas server 绑回本机（修改 start-canvas.bat：set HOST=127.0.0.1）并重启
# 2. 启动认证代理（Basic Auth + WebSocket 转发）
EXCALIDRAW_AUTH_USER=admin EXCALIDRAW_AUTH_PASS=<强密码> node tools/auth-proxy.mjs
# 3. 对外暴露 http://<host>:5002（含认证）
```

- 代理支持 WebSocket 转发（Excalidraw 实时同步不受影响）
- 生产环境**必须**通过环境变量设置强密码，禁止使用默认凭据
- 公网暴露还应配合 HTTPS（反向代理如 nginx/Caddy 终止 TLS）

## 破坏性操作清单（Review Gate 双重确认）

见 `GATE.md` §5：批量删除、force push、生产变更、系统级配置、删除项目/画布、不可逆操作。

## 原则

- 未授权修改不触发 Pi 执行代码（GATE.md）
- 最小暴露面：防火墙仅放行局域网子网
- 画布数据为项目正式资产，全部进入 Git（architecture/main.excalidraw）
