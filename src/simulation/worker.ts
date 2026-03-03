// ============================================
// WebWorker - 模拟引擎入口
// 在独立线程中运行模拟逻辑，不阻塞主线程渲染
// ============================================

import { WorkerMessageType, DEFAULT_WORLD_CONFIG } from '../types';
import type { WorkerMessage, WorldConfig } from '../types';
import { World } from './World';

let world: World | null = null;
let running = false;
let speed = 1; // 每帧执行的 tick 数
let tickInterval: ReturnType<typeof setTimeout> | null = null;
let targetTPS = DEFAULT_WORLD_CONFIG.ticksPerSecond;

function startLoop(): void {
  if (tickInterval) return;

  const msPerTick = 1000 / targetTPS;

  const loop = () => {
    if (!running || !world) return;

    const startTime = performance.now();

    for (let i = 0; i < speed; i++) {
      world.step();
    }

    // 发送渲染帧数据
    const frameData = world.getFrameData();
    (self as unknown as Worker).postMessage({
      type: WorkerMessageType.Frame,
      data: frameData,
    });

    const elapsed = performance.now() - startTime;
    const nextDelay = Math.max(1, msPerTick - elapsed);

    tickInterval = setTimeout(loop, nextDelay);
  };

  tickInterval = setTimeout(loop, 0);
}

function stopLoop(): void {
  if (tickInterval) {
    clearTimeout(tickInterval);
    tickInterval = null;
  }
}

// Worker 消息处理
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, data } = e.data;

  switch (type) {
    case WorkerMessageType.Init: {
      const config: WorldConfig = data?.config || DEFAULT_WORLD_CONFIG;
      targetTPS = config.ticksPerSecond;
      world = new World(config);
      world.initialize();

      (self as unknown as Worker).postMessage({
        type: WorkerMessageType.Ready,
      });
      break;
    }

    case WorkerMessageType.Start: {
      running = true;
      startLoop();
      break;
    }

    case WorkerMessageType.Pause: {
      running = false;
      stopLoop();
      break;
    }

    case WorkerMessageType.Resume: {
      running = true;
      startLoop();
      break;
    }

    case WorkerMessageType.SetSpeed: {
      speed = data?.speed || 1;
      break;
    }
  }
};
