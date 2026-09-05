# 安全说明（phase_7）

## 当前部署形态

- Canvas server 绑定 `0.0.0.0:5001`（局域网可访问，API **无内置认证**）
- 默认假设为**可信局域网**（`<LAN 网段>`），防火墙仅放行该子网访问 5001
- Android 通过 `http://<LAN-IP>:5001` 访问

## Tailscale 远程访问（公网）

本机可接入 Tailscale（WireGuard 加密隧道，无需公网 IP/端口转发）：

```bash
# 首次：安装 Tailscale 并登录（加入你自己的 tailnet）
tailscale up --hostname=<你的主机名>
tailscale status        # 查看本机主机名与 tailnet IP（100.x.y.z）
```

- 外部设备：安装 Tailscale 并**登录同一 tailnet 账号**后即可访问下表服务
- 防火墙需放行 Tailscale 网段（100.64.0.0/10）→ 5001/5003/5010/22

| 用途 | 访问方式 | 前提 |
|---|---|---|
| 画布 WebUI | `http://<tailscale-主机名>:5001`（或 `http://<tailnet-IP>:5001`） | 外部设备同一 tailnet |
| 公网认证模式 | `http://<tailscale-主机名>:5003`（Basic Auth，start-auth.bat） | 启动 start-auth.bat |
| 连 Pi（远程终端） | `ssh <Windows-用户名>@<tailscale-主机名>`（密码=Windows 登录密码）后运行 `pi` | OpenSSH Server 已启用(:22)，登录用户 PATH 含 pi |

## 认证（公网模式，一键启用）

当画布需要暴露到**公网**或不可信网络时，必须启用认证：

```bash
# 一键启动（推荐）：canvas 绑回 127.0.0.1 + 生成随机强密码(.auth.env) + 认证代理 :5003
start-auth.bat
# 访问 http://<host>:5003，提示输入 .auth.env 中的凭据
```

```bash
# 或手动启动：
# 1. 将 canvas server 绑回本机（start-auth.bat 内部：HOST=127.0.0.1）并重启
# 2. 启动认证代理（Basic Auth + WebSocket 转发）
EXCALIDRAW_AUTH_USER=<用户名> EXCALIDRAW_AUTH_PASS=<强密码> node tools/auth-proxy.mjs
# 3. 对外暴露 http://<host>:5003（含认证）
```

- 代理支持 WebSocket 转发（Excalidraw 实时同步不受影响）
- `start-auth.bat` 首次运行自动生成 `.auth.env`（随机 20 位强密码，已 gitignore，勿提交）
- 默认弱密码已禁止启动（需显式 `EXCALIDRAW_ALLOW_DEFAULT_PASS=1` 才可本地试用）
- 公网暴露必须配合 HTTPS 终止（nginx/Caddy 反向代理 TLS），禁止直连公网 HTTP

## 破坏性操作清单（Review Gate 双重确认）

见 `GATE.md` §5：批量删除、force push、生产变更、系统级配置、删除项目/画布、不可逆操作。

## 原则

- 未授权修改不触发 Pi 执行代码（GATE.md）
- 最小暴露面：防火墙仅放行局域网子网
- 画布数据为项目正式资产，全部进入 Git（architecture/main.excalidraw）
