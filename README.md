# ZELUX Studio

独立的 ZELUX 设备控制界面。当前使用原生 ESM，无需 Node.js 构建即可运行。

```powershell
python tools/serve.py
# 打开 http://127.0.0.1:8080
```

当前 1.x 仍使用设备同源 Cookie 鉴权，因此正式部署有两种方式：

1. 将本仓库产物作为独立组件安装到设备，由 Device Agent 反向代理；
2. 使用支持跨域令牌的 Agent 2.x（后续协议阶段实现）。

Studio-Agent 契约由 `zelux-protocol` 仓库维护，本仓库不定义设备驱动细节。
