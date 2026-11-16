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

## IMU 管理闭环

IMU 页新增 robotd 型号/驱动与机体对齐管理：配置与运行型号分开，显示驱动版本、完整运行安装旋转、就绪与过期计数；可选择型号、进行立正/前后/左右五姿态标定、保存修正，并在机械安全确认后独立重启生效。标定通过 robotd 的重力状态流完成，计算 IMU 到机体坐标系的三维旋转，不直接读取共享串口；总线 IMU 禁用旧 I2C 标定，不用另一颗传感器的读数冒充。型号目录来自 robotctl，B1 未验证不能启用，状态缺失/模拟运行不能判为硬件生效。

状态规则测试：node --experimental-default-type=module tools/test-imu-management.mjs；控件集成：node --experimental-default-type=module tools/test-imu-management-dom.mjs。测试不连接设备。完整联调见相邻 robotd 仓库 docs/test-plan/imu-unified-acceptance-20261116.md。
