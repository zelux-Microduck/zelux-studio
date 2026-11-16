import assert from 'node:assert/strict';
import { managementView } from '../js/pages/imu-management-state.js';
assert.equal(managementView().canRestart, false);
assert.equal(managementView().application, '状态不可用');
const state = { available: true, runtime: { model: 'qingmu-a1', driver_id: 'adapter', driver_version: '1' },
  catalog: { config: { imu: { model: 'qingmu-a1' } } }, pending_restart: true, restart_safe: true, ready: false };
assert.equal(managementView(state).canRestart, true);
assert.equal(managementView(state).health, '未就绪 / 启动中 / 数据过期');
assert.equal(managementView({ ...state, available: false }).effective, '未知 / 未连接');
assert.equal(managementView({ ...state, simulated: true }).canRestart, false);
assert.equal(managementView({ ...state, simulated: true }).canSave, false);
assert.equal(managementView({ ...state, pending_restart: null }).canRestart, false);
assert.equal(managementView({ ...state, pending_restart: false }).application, '运行配置一致');
console.log('PASS: 9 IMU presentation assertions');

