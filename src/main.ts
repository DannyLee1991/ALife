// ============================================
// ALife 模拟器 - 主入口
// 串联 WebWorker 模拟层和 Three.js 渲染层
// ============================================

import * as THREE from 'three';
import { Renderer } from './renderer/Renderer';
import {
  WorkerMessageType,
  DEFAULT_WORLD_CONFIG,
  RenderFrameData,
  SimulationStats,
  OrganismRenderData,
  OrganismType,
  Gene,
  Gender,
  GENE_RANGES,
  getSubSpeciesLabel,
  createRNG,
} from './types';
import type { WorkerMessage, WorldConfig } from './types';

class ALifeApp {
  private renderer: Renderer;
  private worker: Worker | null = null;
  private paused = false;
  private currentSpeed = 1;
  private lastStats: SimulationStats | null = null;
  private tpsCounter = 0;
  private lastTpsTime = 0;
  private currentTps = 0;
  private config: WorldConfig;
  private isRunning = false;

  // ---- 物种数量走势图 ----
  private chartCanvas: HTMLCanvasElement | null = null;
  private chartCtx: CanvasRenderingContext2D | null = null;
  private populationHistory: {
    microbes: number[];
    plants: number[];
    insects: number[];
    animals: number[];
  } = { microbes: [], plants: [], insects: [], animals: [] };
  private readonly MAX_HISTORY = 600;
  private historyFrameCounter = 0;
  private readonly HISTORY_SAMPLE_INTERVAL = 3; // 每 3 帧采样一次
  private chartDirty = false;

  // ---- 3D 模型预览 ----
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewScene: THREE.Scene | null = null;
  private previewCamera: THREE.PerspectiveCamera | null = null;
  private previewMesh: THREE.Mesh | null = null;
  private previewVisible = false;
  private lastPreviewOrgId: number = -1; // 追踪当前预览的生命体ID，避免重复创建

  constructor() {
    // 初始化渲染器（3D 场景在启动画面时就作为背景渲染）
    const container = document.getElementById('canvas-container')!;
    this.renderer = new Renderer(container);
    this.config = { ...DEFAULT_WORLD_CONFIG };

    // 设置启动画面、设置弹窗、面板折叠、走势图、控制按钮
    this.setupStartScreen();
    this.setupSettingsModal();
    this.setupPanelToggle();
    this.setupChartPanel();
    this.setupControls();
    this.setupDnaToggle();
    this.setupPreviewRenderer();

    // 启动渲染循环（仅渲染 3D 场景，模拟尚未开始）
    this.renderLoop();
  }

  // ================================================================
  //  启动画面
  // ================================================================

  private setupStartScreen(): void {
    document.getElementById('btn-start-sim')!.addEventListener('click', () => {
      this.hideStartScreen();
      this.startSimulation();
    });

    document.getElementById('btn-open-settings')!.addEventListener('click', () => {
      this.populateSettingsForm();
      document.getElementById('settings-modal')!.style.display = 'flex';
    });
  }

  private hideStartScreen(): void {
    const screen = document.getElementById('start-screen')!;
    screen.classList.add('hidden');
    setTimeout(() => { screen.style.display = 'none'; }, 500);
  }

  private showStartScreen(): void {
    const screen = document.getElementById('start-screen')!;
    screen.style.display = 'flex';
    // 强制重排以确保过渡动画生效
    void screen.offsetHeight;
    screen.classList.remove('hidden');
  }

  // ================================================================
  //  设置弹窗
  // ================================================================

  private setupSettingsModal(): void {
    document.getElementById('btn-settings-ok')!.addEventListener('click', () => {
      this.applySettingsForm();
      document.getElementById('settings-modal')!.style.display = 'none';
    });

    document.getElementById('btn-settings-cancel')!.addEventListener('click', () => {
      document.getElementById('settings-modal')!.style.display = 'none';
    });
  }

  /** 用当前配置填充设置表单 */
  private populateSettingsForm(): void {
    const cfg = this.config;
    this.setInputValue('cfg-seed', cfg.seed);
    this.setInputValue('cfg-initialMicrobes', cfg.initialMicrobes);
    this.setInputValue('cfg-initialPlants', cfg.initialPlants);
    this.setInputValue('cfg-initialInsects', cfg.initialInsects);
    this.setInputValue('cfg-initialAnimals', cfg.initialAnimals);
    this.setInputValue('cfg-worldSize', cfg.width);
    this.setInputValue('cfg-terrainHeight', cfg.terrainHeight);
    this.setInputValue('cfg-terrainRoughness', cfg.terrainRoughness);
    this.setInputValue('cfg-waterLevel', cfg.waterLevel);
    this.setInputValue('cfg-riverWidth', cfg.riverWidth);
    this.setInputValue('cfg-maxMicrobes', cfg.maxMicrobes);
    this.setInputValue('cfg-maxPlants', cfg.maxPlants);
    this.setInputValue('cfg-microbeGrowthRate', cfg.microbeGrowthRate);
    this.setInputValue('cfg-plantGrowthRate', cfg.plantGrowthRate);
    this.setInputValue('cfg-plantEnergy', cfg.plantEnergy);
    this.setInputValue('cfg-ticksPerSecond', cfg.ticksPerSecond);
  }

  /** 从设置表单读取值并应用到配置 */
  private applySettingsForm(): void {
    this.config.seed = this.getInputValue('cfg-seed', -1);
    this.config.initialMicrobes = this.getInputValue('cfg-initialMicrobes', 400);
    this.config.initialPlants = this.getInputValue('cfg-initialPlants', 600);
    this.config.initialInsects = this.getInputValue('cfg-initialInsects', 200);
    this.config.initialAnimals = this.getInputValue('cfg-initialAnimals', 80);
    const worldSize = this.getInputValue('cfg-worldSize', 500);
    this.config.width = worldSize;
    this.config.height = worldSize;
    this.config.terrainHeight = this.getInputValue('cfg-terrainHeight', 1.0);
    this.config.terrainRoughness = this.getInputValue('cfg-terrainRoughness', 1.0);
    this.config.waterLevel = this.getInputValue('cfg-waterLevel', 1.5);
    this.config.riverWidth = this.getInputValue('cfg-riverWidth', 1.0);
    this.config.maxMicrobes = this.getInputValue('cfg-maxMicrobes', 1500);
    this.config.maxPlants = this.getInputValue('cfg-maxPlants', 1200);
    this.config.microbeGrowthRate = this.getInputValue('cfg-microbeGrowthRate', 5);
    this.config.plantGrowthRate = this.getInputValue('cfg-plantGrowthRate', 4);
    this.config.plantEnergy = this.getInputValue('cfg-plantEnergy', 30);
    this.config.ticksPerSecond = this.getInputValue('cfg-ticksPerSecond', 10);
  }

  private setInputValue(id: string, value: number): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = value.toString();
  }

  private getInputValue(id: string, fallback: number): number {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return fallback;
    const v = Number(el.value);
    return isNaN(v) ? fallback : v;
  }

  // ================================================================
  //  面板折叠
  // ================================================================

  private setupPanelToggle(): void {
    const panel = document.getElementById('stats-panel')!;
    const icon = document.getElementById('panel-toggle-icon')!;

    icon.addEventListener('click', () => {
      const isCollapsed = panel.classList.toggle('collapsed');
      icon.textContent = isCollapsed ? '▶' : '◀';
    });
  }

  // ================================================================
  //  物种走势图
  // ================================================================

  private setupChartPanel(): void {
    this.chartCanvas = document.getElementById('chart-canvas') as HTMLCanvasElement;
    this.chartCtx = this.chartCanvas?.getContext('2d') ?? null;

    // 面板展开/折叠
    document.getElementById('chart-toggle-btn')!.addEventListener('click', () => {
      const panel = document.getElementById('chart-panel')!;
      panel.classList.toggle('collapsed');
      // 展开时立即重绘
      if (!panel.classList.contains('collapsed')) {
        this.chartDirty = true;
      }
    });

    // 窗口大小变化时标记需要重绘
    window.addEventListener('resize', () => {
      this.chartDirty = true;
    });
  }

  /** 采样当前物种数量到历史数据 */
  private samplePopulation(stats: SimulationStats): void {
    this.historyFrameCounter++;
    if (this.historyFrameCounter % this.HISTORY_SAMPLE_INTERVAL !== 0) return;

    const h = this.populationHistory;
    h.microbes.push(stats.microbeCount);
    h.plants.push(stats.plantCount);
    h.insects.push(stats.insectCount);
    h.animals.push(stats.animalCount);

    // 限制最大长度
    if (h.microbes.length > this.MAX_HISTORY) {
      h.microbes.shift();
      h.plants.shift();
      h.insects.shift();
      h.animals.shift();
    }

    this.chartDirty = true;
  }

  /** 重置走势图数据 */
  private resetPopulationHistory(): void {
    this.populationHistory = { microbes: [], plants: [], insects: [], animals: [] };
    this.historyFrameCounter = 0;
    this.chartDirty = true;
  }

  /** 使用 Canvas 2D 绘制物种走势图 */
  private drawChart(): void {
    if (!this.chartDirty || !this.chartCanvas || !this.chartCtx) return;
    this.chartDirty = false;

    const canvas = this.chartCanvas;
    const ctx = this.chartCtx;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // 高清适配
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const h = this.populationHistory;
    const dataLen = h.microbes.length;

    // 背景
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(5, 10, 20, 0.6)';
    ctx.fillRect(0, 0, W, H);

    if (dataLen < 2) {
      // 没有足够的数据
      ctx.fillStyle = '#607d8b';
      ctx.font = '12px "Segoe UI", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('等待数据...', W / 2, H / 2);
      return;
    }

    // 绘图区域
    const padLeft = 48;
    const padRight = 12;
    const padTop = 10;
    const padBottom = 22;
    const plotW = W - padLeft - padRight;
    const plotH = H - padTop - padBottom;

    // 找到最大值（用于 Y 轴缩放）
    let maxVal = 10;
    for (let i = 0; i < dataLen; i++) {
      maxVal = Math.max(maxVal, h.microbes[i], h.plants[i], h.insects[i], h.animals[i]);
    }
    // Y 轴向上留一些空间
    maxVal = Math.ceil(maxVal * 1.15);

    // 网格线和 Y 轴标签
    const gridLines = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#607d8b';
    ctx.font = '10px "Segoe UI", "PingFang SC", sans-serif';
    ctx.textAlign = 'right';

    for (let i = 0; i <= gridLines; i++) {
      const y = padTop + (plotH / gridLines) * i;
      const value = Math.round(maxVal * (1 - i / gridLines));

      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillText(value.toString(), padLeft - 6, y + 3);
    }

    // X 轴底线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop + plotH);
    ctx.lineTo(padLeft + plotW, padTop + plotH);
    ctx.stroke();

    // 物种曲线配置
    const series: { data: number[]; color: string; fill: string; label: string }[] = [
      { data: h.plants,   color: '#66bb6a', fill: 'rgba(102,187,106,0.08)', label: '🌿 植物' },
      { data: h.microbes, color: '#4dd0e1', fill: 'rgba(77,208,225,0.08)',  label: '🦠 微生物' },
      { data: h.insects,  color: '#ffa726', fill: 'rgba(255,167,38,0.08)',  label: '🦗 昆虫' },
      { data: h.animals,  color: '#ef5350', fill: 'rgba(239,83,80,0.08)',   label: '🐾 动物' },
    ];

    // 绘制每条曲线（先画填充，再画线条，让线条在上层）
    for (const s of series) {
      // 填充区域
      ctx.beginPath();
      for (let i = 0; i < dataLen; i++) {
        const x = padLeft + (i / (dataLen - 1)) * plotW;
        const y = padTop + plotH - (s.data[i] / maxVal) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(padLeft + plotW, padTop + plotH);
      ctx.lineTo(padLeft, padTop + plotH);
      ctx.closePath();
      ctx.fillStyle = s.fill;
      ctx.fill();

      // 线条
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < dataLen; i++) {
        const x = padLeft + (i / (dataLen - 1)) * plotW;
        const y = padTop + plotH - (s.data[i] / maxVal) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 图例
    const legendX = padLeft + 8;
    const legendY = padTop + 4;
    ctx.font = '11px "Segoe UI", "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    const legendSpacing = 90;

    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      const x = legendX + i * legendSpacing;

      // 色块
      ctx.fillStyle = s.color;
      ctx.fillRect(x, legendY, 10, 10);

      // 文字
      ctx.fillStyle = '#b0bec5';
      ctx.fillText(s.label, x + 14, legendY + 9);
    }

    // X 轴标签（显示采样点范围信息）
    ctx.fillStyle = '#546e7a';
    ctx.font = '9px "Segoe UI", "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`← ${dataLen} 采样点`, padLeft, padTop + plotH + 14);
    ctx.textAlign = 'right';
    ctx.fillText('最新 →', padLeft + plotW, padTop + plotH + 14);
  }

  // ================================================================
  //  控制按钮（暂停、重启、速度、详情面板）
  // ================================================================

  private setupControls(): void {
    const btnPause = document.getElementById('btn-pause')!;
    const btnRestart = document.getElementById('btn-restart')!;

    // 暂停 / 继续
    btnPause.addEventListener('click', () => {
      if (!this.isRunning || !this.worker) return;
      this.paused = !this.paused;
      this.renderer.setPaused(this.paused);
      if (this.paused) {
        this.worker.postMessage({ type: WorkerMessageType.Pause });
        btnPause.textContent = '▶ 继续';
        btnRestart.style.display = 'inline-block';
      } else {
        this.worker.postMessage({ type: WorkerMessageType.Resume });
        btnPause.textContent = '⏸ 暂停';
        btnRestart.style.display = 'none';
        // 不再隐藏详情面板——运行中也可以跟踪选中的生命体
      }
    });

    // 重新开始
    btnRestart.addEventListener('click', () => {
      this.restartSimulation();
    });

    // 速度按钮
    const speedButtons = [
      { id: 'btn-speed1', speed: 1 },
      { id: 'btn-speed2', speed: 2 },
      { id: 'btn-speed5', speed: 5 },
    ];

    speedButtons.forEach(({ id, speed }) => {
      const btn = document.getElementById(id)!;
      btn.addEventListener('click', () => {
        if (!this.worker) return;
        this.currentSpeed = speed;
        this.worker.postMessage({
          type: WorkerMessageType.SetSpeed,
          data: { speed },
        });
        speedButtons.forEach(({ id: btnId }) => {
          document.getElementById(btnId)!.classList.remove('active');
        });
        btn.classList.add('active');
      });
    });

    // 关闭详情面板
    document.getElementById('org-panel-close')!.addEventListener('click', () => {
      this.renderer.clearSelection();
      this.hideOrganismPanel();
    });

    // 选中生命体回调
    this.renderer.onOrganismSelect = (org) => {
      if (org) this.showOrganismPanel(org);
      else this.hideOrganismPanel();
    };
  }

  // ================================================================
  //  模拟生命周期（启动 / 重启）
  // ================================================================

  /** 启动模拟：创建 Worker、初始化世界、开始 */
  private startSimulation(): void {
    // 重置状态
    this.paused = false;
    this.lastStats = null;
    this.currentSpeed = 1;
    this.tpsCounter = 0;
    this.currentTps = 0;
    this.lastTpsTime = performance.now();
    this.isRunning = true;

    // 解析随机种子：-1 → 生成实际种子，≥0 → 使用指定种子
    const [actualSeed] = createRNG(this.config.seed);
    // 将实际种子写回配置（使 renderer 和 worker 使用同一种子）
    const resolvedConfig: WorldConfig = { ...this.config, seed: actualSeed };

    // 重置渲染器（使用地形参数和种子重建地形）和走势图
    this.renderer.applyTerrainConfig(resolvedConfig);
    this.renderer.reset();
    this.resetPopulationHistory();

    // 重置 UI 控件
    document.getElementById('btn-pause')!.textContent = '⏸ 暂停';
    document.getElementById('btn-restart')!.style.display = 'none';
    document.getElementById('btn-speed1')!.classList.add('active');
    document.getElementById('btn-speed2')!.classList.remove('active');
    document.getElementById('btn-speed5')!.classList.remove('active');

    // 重置面板折叠状态
    document.getElementById('stats-panel')!.classList.remove('collapsed');
    document.getElementById('panel-toggle-icon')!.textContent = '◀';

    // 显示模拟 UI
    this.setSimulationUIVisible(true);

    // 创建 Worker
    this.worker = new Worker(
      new URL('./simulation/worker.ts', import.meta.url),
      { type: 'module' }
    );
    this.setupWorkerMessages();

    // 初始化模拟世界（使用解析后的种子）
    this.worker.postMessage({
      type: WorkerMessageType.Init,
      data: { config: resolvedConfig },
    } as WorkerMessage);
  }

  /** 重新开始：终止当前模拟，回到启动画面 */
  private restartSimulation(): void {
    // 停止当前模拟
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isRunning = false;
    this.paused = false;

    // 重置渲染器（清空生命体）
    this.renderer.reset();

    // 隐藏模拟 UI
    this.setSimulationUIVisible(false);

    // 回到启动画面
    this.showStartScreen();
  }

  /** 切换模拟 UI（面板）的可见性 */
  private setSimulationUIVisible(visible: boolean): void {
    document.getElementById('stats-panel')!.style.display = visible ? '' : 'none';
    document.getElementById('controls-panel')!.style.display = visible ? '' : 'none';
    document.getElementById('chart-panel')!.style.display = visible ? '' : 'none';
    if (!visible) {
      this.hideOrganismPanel();
    }
  }

  // ================================================================
  //  Worker 消息处理
  // ================================================================

  private setupWorkerMessages(): void {
    if (!this.worker) return;

    this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const { type, data } = e.data;

      switch (type) {
        case WorkerMessageType.Ready:
          console.log('🌍 模拟世界初始化完成');
          this.worker?.postMessage({ type: WorkerMessageType.Start });
          break;

        case WorkerMessageType.Frame: {
          const frameData = data as RenderFrameData;
          this.renderer.updateOrganisms(frameData.organisms);
          this.renderer.updateEggs(frameData.eggs ?? []);
          this.lastStats = frameData.stats;

          // 采样物种数量到历史记录
          this.samplePopulation(frameData.stats);

          // TPS 计算
          this.tpsCounter++;
          const now = performance.now();
          if (now - this.lastTpsTime >= 1000) {
            this.currentTps = this.tpsCounter;
            this.tpsCounter = 0;
            this.lastTpsTime = now;
          }
          break;
        }
      }
    };
  }

  // ================================================================
  //  渲染循环 & UI 更新
  // ================================================================

  private renderLoop = (): void => {
    requestAnimationFrame(this.renderLoop);
    this.renderer.render();
    this.updateUI();
    this.drawChart();
    this.renderPreview();
  };

  /** 更新 UI 数据显示 */
  private updateUI(): void {
    if (!this.lastStats) return;

    const stats = this.lastStats;

    this.setStatText('stat-tick', stats.tick.toLocaleString());
    this.setStatText('stat-organisms', stats.totalOrganisms.toLocaleString());
    this.setStatText('stat-microbes', stats.microbeCount.toLocaleString());
    this.setStatText('stat-plants', stats.plantCount.toLocaleString());
    this.setStatText('stat-insects', stats.insectCount.toLocaleString());
    this.setStatText('stat-animals', stats.animalCount.toLocaleString());
    this.setStatText('stat-births', stats.births.toLocaleString());
    this.setStatText('stat-deaths', stats.deaths.toLocaleString());

    // 死因分布
    const ds = stats.deathStats;
    this.setStatText('stat-death-starvation', ds.starvation.toLocaleString());
    this.setStatText('stat-death-oldage', ds.oldAge.toLocaleString());
    this.setStatText('stat-death-predation', ds.predation.toLocaleString());
    this.setStatText('stat-death-overcrowding', ds.overcrowding.toLocaleString());
    this.setStatText('stat-death-disease', ds.disease.toLocaleString());
    this.setStatText('stat-death-environmental', ds.environmental.toLocaleString());

    // 时刻显示
    this.setStatText('stat-time', this.renderer.getTimeLabel());

    // 大气 CO₂
    const co2 = stats.co2Level;
    const co2El = document.getElementById('stat-co2');
    if (co2El) {
      co2El.textContent = co2.toFixed(3);
      // CO₂ 颜色指示：正常绿色，偏低橙色，极低红色，偏高蓝色
      if (co2 < 0.3) co2El.style.color = '#ff4444';
      else if (co2 < 0.7) co2El.style.color = '#ffaa00';
      else if (co2 > 1.5) co2El.style.color = '#44aaff';
      else co2El.style.color = '#66ff66';
    }

    // 大气 O₂
    const o2 = stats.o2Level;
    const o2El = document.getElementById('stat-o2');
    if (o2El) {
      o2El.textContent = o2.toFixed(3);
      // O₂ 颜色指示：正常蓝绿色，偏低橙色，极低红色，偏高亮蓝
      if (o2 < 0.3) o2El.style.color = '#ff4444';
      else if (o2 < 0.6) o2El.style.color = '#ffaa00';
      else if (o2 > 1.5) o2El.style.color = '#88ddff';
      else o2El.style.color = '#66ccff';
    }

    // 有害气体
    const toxic = stats.toxicGasLevel;
    const toxicEl = document.getElementById('stat-toxic');
    if (toxicEl) {
      toxicEl.textContent = toxic.toFixed(3);
      // 有害气体颜色指示：无污染绿色，轻微黄色，中等橙色，严重红色
      if (toxic < 0.1) toxicEl.style.color = '#66ff66';
      else if (toxic < 0.3) toxicEl.style.color = '#ccff44';
      else if (toxic < 0.6) toxicEl.style.color = '#ffaa00';
      else toxicEl.style.color = '#ff4444';
    }

    this.setStatText('stat-fps', this.renderer.currentFps.toString());
    this.setStatText('stat-tps', (this.currentTps * this.currentSpeed).toString());
    this.setStatText('stat-species', stats.speciesCount.toString());

    // 物种列表（显示角色标签）
    const speciesList = document.getElementById('species-list')!;
    let speciesHtml = '';
    for (const sp of stats.speciesList) {
      const color = `rgb(${Math.round(sp.color[0] * 255)},${Math.round(sp.color[1] * 255)},${Math.round(sp.color[2] * 255)})`;
      speciesHtml += `
        <div class="species-item">
          <span class="species-color" style="background:${color}"></span>
          <span style="color:#aaa;font-size:12px">${sp.label || '物种 #' + sp.id}</span>
          <span style="color:#fff;margin-left:auto">${sp.count}</span>
        </div>
      `;
    }
    speciesList.innerHTML = speciesHtml;
  }

  private setStatText(id: string, text: string): void {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ================================================================
  //  生命体详情面板
  // ================================================================

  /** DNA 基因名称与颜色配置 */
  private static readonly GENE_LABELS: { name: string; color: string }[] = [
    { name: '体型', color: '#ff7043' },
    { name: '速度', color: '#42a5f5' },
    { name: '视野', color: '#ab47bc' },
    { name: '攻击力', color: '#ef5350' },
    { name: '防御力', color: '#66bb6a' },
    { name: '代谢', color: '#ffa726' },
    { name: '繁殖阈值', color: '#ec407a' },
    { name: '攻击倾向', color: '#f44336' },
    { name: '逃跑倾向', color: '#29b6f6' },
    { name: '食性', color: '#8d6e63' },
    { name: '突变率', color: '#78909c' },
    { name: '夜行性', color: '#5c6bc0' },
    { name: '水生性', color: '#00acc1' },
    { name: '体型形态', color: '#7cb342' },
    { name: '体色色相', color: '#e91e63' },
    { name: '体色明度', color: '#fdd835' },
  ];

  /** 类型名称映射 */
  private static getTypeName(type: OrganismType): string {
    switch (type) {
      case OrganismType.Microbe: return '🦠 微生物';
      case OrganismType.Plant: return '🌿 植物';
      case OrganismType.Insect: return '🦗 昆虫';
      case OrganismType.Animal: return '🐾 动物';
    }
  }

  // ================================================================
  //  DNA 折叠 & 3D 预览
  // ================================================================

  /** 设置 DNA 基因组区域折叠/展开 */
  private setupDnaToggle(): void {
    const toggle = document.getElementById('dna-section-toggle');
    const section = document.getElementById('dna-section');
    if (toggle && section) {
      toggle.addEventListener('click', () => {
        section.classList.toggle('collapsed');
      });
    }
  }

  /** 初始化 3D 模型预览迷你渲染器 */
  private setupPreviewRenderer(): void {
    const canvas = document.getElementById('org-preview-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    this.previewRenderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.previewRenderer.setClearColor(0x000000, 0);
    this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.previewRenderer.toneMappingExposure = 1.2;

    this.previewScene = new THREE.Scene();

    // 灯光
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.previewScene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(2, 3, 2);
    this.previewScene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x88bbff, 0.4);
    fillLight.position.set(-2, 1, -1);
    this.previewScene.add(fillLight);

    this.previewCamera = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 0.1, 50);
    this.previewCamera.position.set(0, 0.5, 2.2);
    this.previewCamera.lookAt(0, 0.3, 0);
  }

  /** 更新 3D 预览模型 */
  private updatePreviewModel(org: OrganismRenderData): void {
    if (!this.previewScene || !this.previewRenderer || !this.previewCamera) return;

    // 移除旧模型
    if (this.previewMesh) {
      this.previewScene.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      (this.previewMesh.material as THREE.Material).dispose();
      this.previewMesh = null;
    }

    // 通过主渲染器创建预览模型
    this.previewMesh = this.renderer.createPreviewMesh(org.type, org.dna);

    // 根据物种类型调整预览大小和位置
    let previewScale = 1.0;
    let yOffset = 0.3;
    switch (org.type) {
      case OrganismType.Microbe: previewScale = 2.5; yOffset = 0.15; break;
      case OrganismType.Plant:   previewScale = 1.2; yOffset = 0;    break;
      case OrganismType.Insect:  previewScale = 2.0; yOffset = 0.1;  break;
      case OrganismType.Animal:  previewScale = 1.5; yOffset = 0;    break;
    }
    this.previewMesh.scale.multiplyScalar(previewScale);
    this.previewMesh.position.y = yOffset;

    this.previewScene.add(this.previewMesh);
    this.previewVisible = true;
    this.lastPreviewOrgId = org.id;
  }

  /** 渲染 3D 预览（在主渲染循环中调用） */
  private renderPreview(): void {
    if (!this.previewVisible || !this.previewRenderer || !this.previewScene || !this.previewCamera) return;

    // 缓慢旋转展示
    if (this.previewMesh) {
      this.previewMesh.rotation.y += 0.012;
    }

    this.previewRenderer.render(this.previewScene, this.previewCamera);
  }

  /** 显示生命体详情面板 */
  private showOrganismPanel(org: OrganismRenderData): void {
    const panel = document.getElementById('organism-panel')!;
    panel.classList.add('visible');

    // 基本信息
    const typeLabel = ALifeApp.getTypeName(org.type);
    const roleLabel = getSubSpeciesLabel(org.type, org.dna);

    this.setStatText('org-id', `#${org.id}`);

    const titleEl = document.getElementById('org-title')!;
    titleEl.textContent = `🔍 ${roleLabel}`;

    this.setStatText('org-type', typeLabel);
    this.setStatText('org-species', `物种 #${org.speciesId}`);
    this.setStatText('org-energy', org.energy.toFixed(1));
    this.setStatText('org-age', `${org.age} / ${org.maxAge}`);

    // 健康值带颜色
    const healthEl = document.getElementById('org-health')!;
    const healthPct = (org.health * 100).toFixed(0);
    healthEl.textContent = `${healthPct}%`;
    if (org.health > 0.7) healthEl.style.color = '#66ff66';
    else if (org.health > 0.3) healthEl.style.color = '#ffaa00';
    else healthEl.style.color = '#ff4444';

    this.setStatText('org-size', org.size.toFixed(2));
    this.setStatText('org-position', `(${org.x.toFixed(0)}, ${org.z.toFixed(0)})`);

    // ---- 性别、饱腹度、繁殖状态 ----
    const genderRow = document.getElementById('org-gender-row')!;
    const satietyRow = document.getElementById('org-satiety-row')!;
    const estrusRow = document.getElementById('org-estrus-row')!;

    if (org.isCorpse) {
      // 尸体特殊显示
      genderRow.style.display = 'none';
      satietyRow.style.display = 'none';
      estrusRow.style.display = 'none';
      const titleEl2 = document.getElementById('org-title')!;
      titleEl2.textContent = `💀 ${roleLabel} (尸体)`;
      this.setStatText('org-health', `腐烂 ${(org.decayProgress * 100).toFixed(0)}%`);
    } else if (org.gender === Gender.None) {
      // 微生物/植物无性别
      genderRow.style.display = 'none';
      satietyRow.style.display = org.type === OrganismType.Plant ? 'none' : 'flex';
      estrusRow.style.display = 'none';
      if (org.type !== OrganismType.Plant) {
        const satPct = (org.satiety * 100).toFixed(0);
        this.setStatText('org-satiety', `${satPct}%`);
      }
    } else {
      genderRow.style.display = 'flex';
      satietyRow.style.display = 'flex';
      estrusRow.style.display = 'flex';

      // 性别
      const genderEl = document.getElementById('org-gender')!;
      if (org.gender === Gender.Female) {
        genderEl.textContent = '♀ 雌性';
        genderEl.style.color = '#ff99cc';
      } else {
        genderEl.textContent = '♂ 雄性';
        genderEl.style.color = '#66bbff';
      }

      // 饱腹度
      const satPct = (org.satiety * 100).toFixed(0);
      const satEl = document.getElementById('org-satiety')!;
      satEl.textContent = `${satPct}%`;
      if (org.satiety > 0.7) satEl.style.color = '#66ff66';
      else if (org.satiety > 0.3) satEl.style.color = '#ffaa00';
      else satEl.style.color = '#ff4444';

      // 繁殖状态（区分怀孕/发情/产卵/信号释放）
      const reproEl = document.getElementById('org-repro-status')!;
      if (org.gender === Gender.Female) {
        if (org.isPregnant) {
          const progPct = (org.pregnancyProgress * 100).toFixed(0);
          if (org.type === OrganismType.Animal) {
            reproEl.textContent = `🤰 怀孕中 ${progPct}%`;
          } else {
            reproEl.textContent = `🥚 孕卵中 ${progPct}%`;
          }
          reproEl.style.color = '#ffaa66';
        } else if (org.isInEstrus) {
          reproEl.textContent = '🔥 发情中（释放信息素）';
          reproEl.style.color = '#ff6699';
        } else {
          reproEl.textContent = '⏳ 非发情期';
          reproEl.style.color = '#888888';
        }
      } else {
        if (org.isEmittingMatingSignal) {
          reproEl.textContent = '📢 求偶信号释放中';
          reproEl.style.color = '#66ccff';
        } else {
          reproEl.textContent = '♂ 待交配';
          reproEl.style.color = '#88aacc';
        }
      }
    }

    // DNA 条形图
    const dnaBarsEl = document.getElementById('org-dna-bars')!;
    let dnaHtml = '';
    for (let i = 0; i < Gene.COUNT; i++) {
      const label = ALifeApp.GENE_LABELS[i];
      const [min, max] = GENE_RANGES[i];
      const value = org.dna[i];
      const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

      dnaHtml += `
        <div class="dna-bar-row">
          <span class="dna-bar-label">${label.name}</span>
          <div class="dna-bar-track">
            <div class="dna-bar-fill" style="width:${pct}%;background:${label.color}"></div>
          </div>
          <span class="dna-bar-value">${value.toFixed(2)}</span>
        </div>
      `;
    }
    dnaBarsEl.innerHTML = dnaHtml;

    // 仅当选中的生命体变化时才重建 3D 预览模型（避免旋转被重置）
    if (org.id !== this.lastPreviewOrgId) {
      this.updatePreviewModel(org);
    }
  }

  /** 隐藏生命体详情面板 */
  private hideOrganismPanel(): void {
    const panel = document.getElementById('organism-panel')!;
    panel.classList.remove('visible');
    this.previewVisible = false;
    this.lastPreviewOrgId = -1;
  }
}

// 启动应用
new ALifeApp();
