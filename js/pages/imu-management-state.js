/* Pure presentation rules: never interpret missing runtime as applied. */
export function managementView(data = {}) {
  const runtime = data.runtime;
  const configured = data.catalog?.config?.imu || {};
  const available = data.available === true;
  const simulated = data.simulated === true;
  const pending = data.pending_restart;
  return {
    configured: configured.model || configured.source || '未知',
    effective: available && runtime ? (runtime.model || runtime.source || '未知') : '未知 / 未连接',
    driver: available && runtime?.driver_id ? runtime.driver_id + ' · ' + (runtime.driver_version || '版本未知') : '未知',
    mount: available && runtime?.mount_profile
      ? runtime.mount_profile + (Array.isArray(runtime.mount_wxyz)
        ? ' · 运行传感器→机体 WXYZ [' + runtime.mount_wxyz.map(v => Number(v).toFixed(4)).join(', ') + ']'
        : ' · 运行旋转未报告')
      : '未报告固定安装配置',
    application: !available ? '状态不可用' : simulated ? '模拟运行，不能作为硬件生效证据'
      : pending === true ? '已保存，待重启生效' : pending === false ? '运行配置一致' : '尚未确认生效',
    health: !available ? '未知' : simulated ? '模拟数据' : data.ready === true ? '就绪' : '未就绪 / 启动中 / 数据过期',
    canSave: available && !simulated,
    canRestart: available && !simulated && data.restart_safe === true && pending === true,
    agentCalibration: data.calibration === 'agent',
  };
}

