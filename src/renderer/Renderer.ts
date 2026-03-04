// ============================================
// Three.js 渲染器
// 程序化地形 + 河流水面 + 昼夜交替 + 星空
// 使用 InstancedMesh 实现高性能渲染
// ============================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OrganismType, OrganismRenderData, Gene, SeededRandom } from '../types';
import type { WorldConfig, EggRenderData } from '../types';

// ---- 常量 ----
const MAX_MICROBES = 800;
const MAX_PLANTS = 1000;
const MAX_INSECTS = 600;
const MAX_ANIMALS = 400;
const MAX_EGGS = 300;

const TERRAIN_SIZE = 600;
const TERRAIN_SEGMENTS = 200;
const DEFAULT_WATER_LEVEL = 1.5;

/** 一个完整昼夜循环的秒数（180s = 3分钟） */
const DAY_DURATION = 180;

// ---- 昼夜阶段定义 ----
interface DayPhase {
  time: number;
  sky: number;
  fog: number;
  sunColor: number;
  sunIntensity: number;
  ambientIntensity: number;
  hemiSky: number;
  hemiGround: number;
}

const DAY_PHASES: DayPhase[] = [
  // 午夜（月光 + 星光照亮地面，保证地形清晰可辨）
  { time: 0.00, sky: 0x0c0c1a, fog: 0x0a0a18, sunColor: 0x445588, sunIntensity: 0.12, ambientIntensity: 0.35, hemiSky: 0x141430, hemiGround: 0x1a1a28 },
  // 黎明前
  { time: 0.20, sky: 0x181838, fog: 0x121230, sunColor: 0x556688, sunIntensity: 0.15, ambientIntensity: 0.38, hemiSky: 0x1c1c50, hemiGround: 0x1e1e2a },
  // 日出
  { time: 0.26, sky: 0xcc6633, fog: 0x884422, sunColor: 0xff8844, sunIntensity: 0.65, ambientIntensity: 0.40, hemiSky: 0xff9966, hemiGround: 0x2a1a0a },
  // 清晨
  { time: 0.34, sky: 0x5da0d0, fog: 0x7ab8dc, sunColor: 0xffeedd, sunIntensity: 1.00, ambientIntensity: 0.50, hemiSky: 0x88ccee, hemiGround: 0x3a2a1a },
  // 正午
  { time: 0.50, sky: 0x87ceeb, fog: 0x99d4ee, sunColor: 0xffffff, sunIntensity: 1.20, ambientIntensity: 0.60, hemiSky: 0x87ceeb, hemiGround: 0x443322 },
  // 下午
  { time: 0.65, sky: 0x5da0d0, fog: 0x7ab8dc, sunColor: 0xffeedd, sunIntensity: 1.00, ambientIntensity: 0.50, hemiSky: 0x88ccee, hemiGround: 0x3a2a1a },
  // 日落
  { time: 0.74, sky: 0xcc5522, fog: 0x773311, sunColor: 0xff5533, sunIntensity: 0.55, ambientIntensity: 0.35, hemiSky: 0xff6644, hemiGround: 0x2a1508 },
  // 黄昏
  { time: 0.82, sky: 0x181838, fog: 0x121230, sunColor: 0x556688, sunIntensity: 0.15, ambientIntensity: 0.38, hemiSky: 0x1c1c50, hemiGround: 0x1e1e2a },
  // 回到午夜（与 time=0.00 一致，保证循环平滑）
  { time: 1.00, sky: 0x0c0c1a, fog: 0x0a0a18, sunColor: 0x445588, sunIntensity: 0.12, ambientIntensity: 0.35, hemiSky: 0x141430, hemiGround: 0x1a1a28 },
];

export class Renderer {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  // ---- InstancedMesh ----
  private microbeMesh!: THREE.InstancedMesh;
  private plantMesh!: THREE.InstancedMesh;
  private insectMesh!: THREE.InstancedMesh;
  private animalMesh!: THREE.InstancedMesh;
  private eggMesh!: THREE.InstancedMesh;

  // ---- 临时对象（预分配，避免热路径中 GC 抖动）----
  private tempMatrix = new THREE.Matrix4();
  private tempColor = new THREE.Color();
  private tempVec3A = new THREE.Vector3();
  private tempVec3B = new THREE.Vector3();
  private tempVec3C = new THREE.Vector3();
  private tempQuat = new THREE.Quaternion();
  private tempScaleVec = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly aquaticBlendColor = new THREE.Color(0x2288aa);
  // 昼夜颜色插值用（避免每帧 new Color）
  private dnColorA = new THREE.Color();
  private dnColorB = new THREE.Color();

  // ---- 相机控制 ----
  private cameraTarget = new THREE.Vector3(0, 20, 0);
  private cameraDistance = 300;
  private cameraAngle = Math.PI / 4;
  private cameraAzimuth = 0;
  private isDragging = false;
  private isPanning = false;           // 中键/右键平移
  private lastMouseX = 0;
  private lastMouseY = 0;

  // ---- WASD 键盘移动 ----
  private keysPressed = new Set<string>();
  private readonly MOVE_SPEED = 3.0;   // 每帧平移速度基数

  // ---- 触摸控制 ----
  private activeTouches: Touch[] = [];
  private lastTouchDist = 0;           // 双指缩放距离
  private lastTouchCenter = { x: 0, y: 0 }; // 触摸中心点

  // ---- 性能 ----
  private frameCount = 0;
  private lastFpsTime = 0;
  currentFps = 60;

  // ---- 灯光（用于昼夜动画）----
  private sunLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;

  // ---- 地形 & 水面 ----
  private terrainMesh!: THREE.Mesh;
  private waterMesh!: THREE.Mesh;

  // ---- 星空 & 月亮 ----
  private starsMesh!: THREE.Points;
  private moonGroup!: THREE.Group;      // 月亮组（球体 + 光晕）
  private moonLight!: THREE.PointLight; // 月光光源

  // ---- 昼夜 ----
  /** 累计运行时间（毫秒），暂停时不增长 */
  private elapsedRunTime = 0;
  /** 上一帧的 performance.now()，用于计算 delta */
  private lastFrameTime = performance.now();

  /** 当前时刻 [0, 1)：0=午夜, 0.25=日出, 0.5=正午, 0.75=日落 */
  dayTime = 0.3; // 从清晨开始

  /** 当前夜晚程度 [0, 1]：0=白天, 1=深夜（由 updateDayNight 更新） */
  private nightness = 0;

  // ---- 地形参数（由配置控制，支持种子确定性） ----
  private terrainSeed = 0;
  private terrainHeight = 1.0;
  private terrainRoughness = 1.0;
  private waterLevel = DEFAULT_WATER_LEVEL;
  private riverWidth = 1.0;

  // ---- 种子派生的随机偏移（让不同种子产生完全不同的地形结构） ----
  private noiseOffsetX1 = 100;   // 主地形噪声 X 偏移
  private noiseOffsetZ1 = 100;   // 主地形噪声 Z 偏移
  private noiseOffsetX2 = 50;    // 山脉噪声 X 偏移
  private noiseOffsetZ2 = 50;    // 山脉噪声 Z 偏移
  private river1Phase = 0;       // 河流1 相位偏移
  private river1Amp1 = 65;       // 河流1 摆幅1
  private river1Amp2 = 110;      // 河流1 摆幅2
  private river2Phase = 0;       // 河流2 相位偏移
  private river2Amp1 = 55;       // 河流2 摆幅1
  private river2Amp2 = 95;       // 河流2 摆幅2
  private river2Offset = 30;     // 河流2 Z 轴偏移

  // ---- 预计算高度图（用于快速查询地形高度）----
  private heightMap!: Float32Array;
  private heightMapRes = TERRAIN_SEGMENTS + 1;

  // ---- 生命体材质引用（用于夜间辉光） ----
  private microbeMat!: THREE.MeshStandardMaterial;
  private plantMat!: THREE.MeshStandardMaterial;
  private insectMat!: THREE.MeshStandardMaterial;
  private animalMat!: THREE.MeshStandardMaterial;
  private eggMat!: THREE.MeshStandardMaterial;

  // ---- 选中交互 ----
  private paused = false;
  private mouseDownScreenPos = { x: 0, y: 0 };
  private didDrag = false;
  private highlightMesh!: THREE.Mesh;

  /** 最后一帧的所有生命体数据（用于点击选中） */
  private lastOrganisms: OrganismRenderData[] = [];

  // ---- 帧间插值（消除卡顿/闪烁）----
  /** 上一帧各生命体的位置和朝向（用于插值） */
  private prevPositions = new Map<number, { x: number; z: number; facing: number }>();
  /** 当前目标帧的生命体数据 */
  private targetOrganisms: OrganismRenderData[] = [];
  /** 当前目标帧的蛋数据 */
  private targetEggs: EggRenderData[] = [];
  /** 上次收到 Worker 数据的时间戳 */
  private lastWorkerTime = 0;
  /** Worker 帧间隔（毫秒），自适应追踪 */
  private workerDt = 33;
  /** 是否需要更新实例颜色（仅在收到新数据时） */
  private needsColorUpdate = false;

  /** 当前选中的生命体数据 */
  private selectedOrganism: OrganismRenderData | null = null;

  /** 选中生命体时的回调 */
  onOrganismSelect: ((org: OrganismRenderData | null) => void) | null = null;

  /** 是否实时跟随选中的生命体 */
  private isFollowing = false;

  // ---- 聚焦动画 ----
  private focusAnimating = false;
  private focusFrom = new THREE.Vector3();
  private focusTo = new THREE.Vector3();
  private focusDistFrom = 0;
  private focusDistTo = 0;
  private focusProgress = 0;
  private readonly FOCUS_DURATION = 0.4; // 聚焦动画时长（秒）

  constructor(container: HTMLElement) {
    this.container = container;

    // 场景
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.FogExp2(0x87ceeb, 0.0012);

    // 相机
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      2000
    );
    this.updateCameraPosition();

    // WebGL 渲染器
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // 构建场景（顺序有关）
    this.buildHeightMap();
    this.createTerrain();
    this.createWater();
    this.createStars();
    this.createLighting();
    this.createOrganismMeshes();
    this.createHighlightMesh();

    // 事件
    this.setupEvents();
  }

  /** 设置暂停状态 */
  setPaused(paused: boolean): void {
    this.paused = paused;
    // 不再自动清除选中——选中状态在暂停和运行中都保持
  }

  /** 清除当前选中并停止跟随 */
  clearSelection(): void {
    this.selectedOrganism = null;
    this.isFollowing = false;
    this.highlightMesh.visible = false;
    this.onOrganismSelect?.(null);
  }

  /** 重置渲染器状态（用于模拟重启） */
  reset(): void {
    this.elapsedRunTime = 0;
    this.dayTime = 0.3;
    this.lastFrameTime = performance.now();
    this.lastOrganisms = [];
    this.paused = false;
    this.clearSelection();
    this.focusAnimating = false;
    this.isFollowing = false;

    // 清空插值状态
    this.prevPositions.clear();
    this.targetOrganisms = [];
    this.targetEggs = [];
    this.lastWorkerTime = 0;
    this.workerDt = 33;
    this.needsColorUpdate = false;

    // 清空所有实例网格
    this.microbeMesh.count = 0;
    this.plantMesh.count = 0;
    this.insectMesh.count = 0;
    this.animalMesh.count = 0;
    this.eggMesh.count = 0;
    const meshes = [this.microbeMesh, this.plantMesh, this.insectMesh, this.animalMesh, this.eggMesh];
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ================================================================
  //  应用地形配置（种子 + 地形参数）
  // ================================================================

  /**
   * 应用 WorldConfig 中的地形参数并重建地形
   * 在 startSimulation 中调用
   */
  applyTerrainConfig(config: WorldConfig): void {
    this.terrainSeed = config.seed;
    this.terrainHeight = config.terrainHeight;
    this.terrainRoughness = config.terrainRoughness;
    this.waterLevel = config.waterLevel;
    this.riverWidth = config.riverWidth;

    // 用种子生成一系列确定性偏移，让不同种子产生完全不同的地形和河流布局
    const rng = new SeededRandom(config.seed ^ 0xA5A5A5A5);
    this.noiseOffsetX1 = rng.nextRange(-500, 500);
    this.noiseOffsetZ1 = rng.nextRange(-500, 500);
    this.noiseOffsetX2 = rng.nextRange(-500, 500);
    this.noiseOffsetZ2 = rng.nextRange(-500, 500);
    this.river1Phase = rng.nextRange(0, Math.PI * 2);
    this.river1Amp1 = 40 + rng.next() * 60;   // 40~100
    this.river1Amp2 = 70 + rng.next() * 80;   // 70~150
    this.river2Phase = rng.nextRange(0, Math.PI * 2);
    this.river2Amp1 = 30 + rng.next() * 50;   // 30~80
    this.river2Amp2 = 60 + rng.next() * 70;   // 60~130
    this.river2Offset = rng.nextRange(-80, 80);

    // 移除旧的地形和水面
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }
    if (this.waterMesh) {
      this.scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      (this.waterMesh.material as THREE.Material).dispose();
    }

    // 用新参数重建高度图、地形、水面
    this.buildHeightMap();
    this.createTerrain();
    this.createWater();
  }

  // ================================================================
  //  程序化噪声（Value Noise + fBm）
  // ================================================================

  private hash2D(ix: number, iy: number): number {
    let h = (ix * 374761393 + iy * 668265263 + this.terrainSeed * 1013904223) | 0;
    h = ((h ^ (h >> 13)) * 1274126177) | 0;
    h = (h ^ (h >> 16)) | 0;
    return (h & 0xffff) / 0xffff;
  }

  private noise2D(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    // Smoothstep
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const v00 = this.hash2D(ix, iy);
    const v10 = this.hash2D(ix + 1, iy);
    const v01 = this.hash2D(ix, iy + 1);
    const v11 = this.hash2D(ix + 1, iy + 1);

    return (v00 * (1 - ux) + v10 * ux) * (1 - uy) +
           (v01 * (1 - ux) + v11 * ux) * uy;
  }

  private fbm(x: number, y: number, octaves = 5): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise2D(x * frequency, y * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value;
  }

  // ================================================================
  //  高度图
  // ================================================================

  /** 计算世界坐标 (x, z) 处的原始地形高度 */
  private computeRawHeight(worldX: number, worldZ: number): number {
    const s = 0.006 * this.terrainRoughness;
    const heightMul = this.terrainHeight;

    // 主地形：连绵丘陵（偏移量由种子决定，不同种子 → 完全不同的地形布局）
    let h = (this.fbm(worldX * s + this.noiseOffsetX1, worldZ * s + this.noiseOffsetZ1, 6) - 0.35) * 22 * heightMul;

    // 大尺度山脉：用 pow 让高处更陡峭
    const mountain = this.fbm(
      worldX * 0.003 * this.terrainRoughness + this.noiseOffsetX2,
      worldZ * 0.003 * this.terrainRoughness + this.noiseOffsetZ2, 4
    );
    h += Math.pow(Math.max(0, mountain - 0.35), 1.6) * 70 * heightMul;

    // 细节起伏
    h += (this.noise2D(worldX * 0.03 + this.noiseOffsetX1 * 0.1, worldZ * 0.03 + this.noiseOffsetZ1 * 0.1) - 0.5) * 2.5 * heightMul;

    // ---- 河流（位置/形态由种子决定，宽度受 riverWidth 参数控制）----
    if (this.riverWidth > 0) {
      // 河流1：蜿蜒主河（大致南北方向，相位和振幅由种子决定）
      const riverX = Math.sin(worldZ * 0.01 + this.river1Phase) * this.river1Amp1
                   + Math.sin(worldZ * 0.003 + this.river1Phase * 0.7) * this.river1Amp2;
      const dRiver = Math.abs(worldX - riverX);
      const rw1 = 24 * this.riverWidth;
      if (dRiver < rw1) {
        const t = 1 - dRiver / rw1;
        h -= t * t * 12;
      }

      // 河流2：东西方向支流（相位、振幅、偏移由种子决定）
      const river2Z = Math.cos(worldX * 0.008 + this.river2Phase) * this.river2Amp1
                    + Math.cos(worldX * 0.002 + this.river2Phase * 0.6) * this.river2Amp2
                    + this.river2Offset;
      const dRiver2 = Math.abs(worldZ - river2Z);
      const rw2 = 18 * this.riverWidth;
      if (dRiver2 < rw2) {
        const t = 1 - dRiver2 / rw2;
        h -= t * t * 9;
      }
    }

    // 边缘渐降（避免地图边界出现悬崖）
    const halfSize = TERRAIN_SIZE / 2;
    const border = 60;
    const edgeX = Math.min(1, Math.max(0, (halfSize - Math.abs(worldX)) / border));
    const edgeZ = Math.min(1, Math.max(0, (halfSize - Math.abs(worldZ)) / border));
    h *= Math.min(edgeX, edgeZ);

    return h;
  }

  /** 预计算高度图，后续查询 O(1) */
  private buildHeightMap(): void {
    const res = this.heightMapRes;
    this.heightMap = new Float32Array(res * res);
    const step = TERRAIN_SIZE / (res - 1);
    const half = TERRAIN_SIZE / 2;

    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const x = ix * step - half;
        const z = iz * step - half;
        this.heightMap[iz * res + ix] = this.computeRawHeight(x, z);
      }
    }
  }

  /** 从预计算高度图查询地形高度（双线性插值） */
  getTerrainHeight(worldX: number, worldZ: number): number {
    const half = TERRAIN_SIZE / 2;
    const step = TERRAIN_SIZE / (this.heightMapRes - 1);

    const fx = (worldX + half) / step;
    const fz = (worldZ + half) / step;

    const ix = Math.floor(fx);
    const iz = Math.floor(fz);

    if (ix < 0 || ix >= this.heightMapRes - 1 || iz < 0 || iz >= this.heightMapRes - 1) {
      return 0;
    }

    const tx = fx - ix;
    const tz = fz - iz;
    const res = this.heightMapRes;

    const h00 = this.heightMap[iz * res + ix];
    const h10 = this.heightMap[iz * res + ix + 1];
    const h01 = this.heightMap[(iz + 1) * res + ix];
    const h11 = this.heightMap[(iz + 1) * res + ix + 1];

    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) +
           (h01 * (1 - tx) + h11 * tx) * tz;
  }

  // ================================================================
  //  场景构建
  // ================================================================

  /** 创建程序化地形 */
  private createTerrain(): void {
    const geo = new THREE.PlaneGeometry(
      TERRAIN_SIZE, TERRAIN_SIZE,
      TERRAIN_SEGMENTS, TERRAIN_SEGMENTS
    );
    geo.rotateX(-Math.PI / 2); // 旋转到 XZ 平面

    const positions = geo.attributes.position;
    const colors = new Float32Array(positions.count * 3);

    // 从预计算高度图读取高度，设置顶点颜色
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const h = this.getTerrainHeight(x, z);
      positions.setY(i, h);

      const [r, g, b] = this.getTerrainColor(h);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
    });

    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.terrainMesh);
  }

  /** 根据高度返回地形颜色 */
  private getTerrainColor(h: number): [number, number, number] {
    if (h < this.waterLevel - 3) {
      // 深水底：暗沙色
      return [0.35, 0.30, 0.20];
    } else if (h < this.waterLevel - 0.5) {
      // 浅水底：沙色
      return [0.55, 0.48, 0.32];
    } else if (h < this.waterLevel + 1) {
      // 河岸/沙滩
      return [0.72, 0.65, 0.42];
    } else if (h < 5) {
      // 草地：从浅绿渐变到绿
      const t = Math.max(0, Math.min(1, (h - this.waterLevel) / 3.5));
      return [
        0.22 - t * 0.05,
        0.50 + t * 0.12,
        0.15 - t * 0.02,
      ];
    } else if (h < 12) {
      // 森林/深绿
      const t = (h - 5) / 7;
      return [
        0.12 + t * 0.08,
        0.42 - t * 0.08,
        0.08 + t * 0.04,
      ];
    } else if (h < 20) {
      // 山地岩石/棕色
      const t = (h - 12) / 8;
      return [
        0.38 + t * 0.12,
        0.30 + t * 0.08,
        0.20 + t * 0.06,
      ];
    } else if (h < 28) {
      // 高山灰岩
      const t = (h - 20) / 8;
      return [
        0.48 + t * 0.12,
        0.45 + t * 0.12,
        0.40 + t * 0.15,
      ];
    } else {
      // 雪顶
      const t = Math.min(1, (h - 28) / 6);
      return [
        0.65 + t * 0.30,
        0.62 + t * 0.33,
        0.60 + t * 0.36,
      ];
    }
  }

  /** 创建水面 */
  private createWater(): void {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a6088,
      transparent: true,
      opacity: 0.6,
      roughness: 0.15,
      metalness: 0.35,
    });

    this.waterMesh = new THREE.Mesh(geo, mat);
    this.waterMesh.position.y = this.waterLevel;
    this.scene.add(this.waterMesh);
  }

  /** 创建星空（多层亮度 + 大小变化，夜间显示） */
  private createStars(): void {
    const starCount = 1200;
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random()); // 仅上半球
      const r = 700 + Math.random() * 200;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      // 星星大小分布：大部分小星 + 少量亮星
      const brightness = Math.random();
      sizes[i] = brightness < 0.9 ? 1.0 + Math.random() * 1.5
                                  : 2.5 + Math.random() * 2.0;

      // 星色微变：白/淡蓝/淡黄
      const colorRand = Math.random();
      if (colorRand < 0.6) {
        // 白色
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 1.0;
      } else if (colorRand < 0.8) {
        // 淡蓝
        colors[i * 3] = 0.75; colors[i * 3 + 1] = 0.85; colors[i * 3 + 2] = 1.0;
      } else {
        // 淡黄
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.95; colors[i * 3 + 2] = 0.7;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 2,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
      vertexColors: true,   // 使用每顶点颜色
    });

    this.starsMesh = new THREE.Points(geo, mat);
    this.scene.add(this.starsMesh);

    // ---- 月亮 ----
    this.createMoon();
  }

  /** 创建月亮（球体 + 发光光晕 + 月光光源） */
  private createMoon(): void {
    this.moonGroup = new THREE.Group();

    // 月球体
    const moonGeo = new THREE.SphereGeometry(15, 32, 32);
    const moonMat = new THREE.MeshStandardMaterial({
      color: 0xf5f0e0,
      emissive: 0xddd8c8,
      emissiveIntensity: 0.6,
      roughness: 0.9,
      metalness: 0.0,
    });
    const moonSphere = new THREE.Mesh(moonGeo, moonMat);
    this.moonGroup.add(moonSphere);

    // 月亮光晕（半透明大球）
    const glowGeo = new THREE.SphereGeometry(25, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xccd4e8,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    this.moonGroup.add(glowMesh);

    this.moonGroup.visible = false;
    this.scene.add(this.moonGroup);

    // 月光光源（柔和的定向补充光）
    this.moonLight = new THREE.PointLight(0x8899bb, 0, 800);
    this.moonGroup.add(this.moonLight);
  }

  /** 创建灯光 */
  private createLighting(): void {
    // 环境光
    this.ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(this.ambientLight);

    // 太阳光（方向光）
    this.sunLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    this.sunLight.position.set(100, 200, 100);
    this.scene.add(this.sunLight);

    // 半球光（天空/地面反光）
    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x362d1b, 0.4);
    this.scene.add(this.hemiLight);
  }

  /** 创建 InstancedMesh（使用更精细的程序化模型） */
  private createOrganismMeshes(): void {
    // ---- 🦠 微生物 — 有机变形体（类阿米巴虫） ----
    const microbeGeo = this.buildMicrobeGeometry();
    this.microbeMat = new THREE.MeshStandardMaterial({
      color: 0x66cccc,
      roughness: 0.2,
      metalness: 0.15,       // 细胞膜湿润质感
      transparent: true,
      opacity: 0.75,
      emissive: 0x44aaaa,
      emissiveIntensity: 0,
    });
    this.microbeMesh = new THREE.InstancedMesh(microbeGeo, this.microbeMat, MAX_MICROBES);
    this.microbeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.microbeMesh.count = 0;
    this.scene.add(this.microbeMesh);

    // ---- 🌿 植物 — 树木（树干 + 分枝 + 多层树叶） ----
    const plantGeo = this.buildPlantGeometry();
    this.plantMat = new THREE.MeshStandardMaterial({
      color: 0x33aa33,
      roughness: 0.75,
      emissive: 0x228822,
      emissiveIntensity: 0,
      side: THREE.DoubleSide,  // 叶簇需要双面可见
    });
    this.plantMesh = new THREE.InstancedMesh(plantGeo, this.plantMat, MAX_PLANTS);
    this.plantMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.plantMesh.count = 0;
    this.scene.add(this.plantMesh);

    // ---- 🦗 昆虫 — 分节虫体 + 翅膀 ----
    const insectGeo = this.buildInsectGeometry();
    this.insectMat = new THREE.MeshStandardMaterial({
      color: 0xddaa33,
      roughness: 0.35,
      metalness: 0.2,        // 甲壳质感
      emissive: 0xaa8822,
      emissiveIntensity: 0,
      side: THREE.DoubleSide, // 翅膀双面可见
    });
    this.insectMesh = new THREE.InstancedMesh(insectGeo, this.insectMat, MAX_INSECTS);
    this.insectMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.insectMesh.count = 0;
    this.scene.add(this.insectMesh);

    // ---- 🐾 动物 — 四足动物（躯干 + 头部 + 四肢 + 尾巴） ----
    const animalGeo = this.buildAnimalGeometry();
    this.animalMat = new THREE.MeshStandardMaterial({
      color: 0xcc5533,
      roughness: 0.8,         // 皮毛粗糙质感
      emissive: 0xaa4422,
      emissiveIntensity: 0,
    });
    this.animalMesh = new THREE.InstancedMesh(animalGeo, this.animalMat, MAX_ANIMALS);
    this.animalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.animalMesh.count = 0;
    this.scene.add(this.animalMesh);

    // ---- 🥚 蛋 — 椭圆体 ----
    const eggGeo = new THREE.SphereGeometry(0.4, 8, 6);
    eggGeo.scale(1, 1.3, 1); // 椭圆形蛋
    this.eggMat = new THREE.MeshStandardMaterial({
      color: 0xf5e6c8,
      roughness: 0.4,
      metalness: 0.05,
      emissive: 0xf5e6c8,
      emissiveIntensity: 0,
    });
    this.eggMesh = new THREE.InstancedMesh(eggGeo, this.eggMat, MAX_EGGS);
    this.eggMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.eggMesh.count = 0;
    this.scene.add(this.eggMesh);

    // 启用实例颜色
    const meshConfigs: [THREE.InstancedMesh, number][] = [
      [this.microbeMesh, MAX_MICROBES],
      [this.plantMesh, MAX_PLANTS],
      [this.insectMesh, MAX_INSECTS],
      [this.animalMesh, MAX_ANIMALS],
      [this.eggMesh, MAX_EGGS],
    ];
    for (const [mesh, maxCount] of meshConfigs) {
      if (!mesh.instanceColor) {
        (mesh as any).instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(maxCount * 3), 3
        );
      }
      // 禁用视锥体剔除：InstancedMesh 的包围球基于单个几何体，
      // 无法覆盖所有实例的位置，导致缩放/俯视时整体被错误剔除
      mesh.frustumCulled = false;
    }
  }

  // ================================================================
  //  程序化生物模型
  // ================================================================

  /** 🦠 微生物：有机变形二十面体 */
  private buildMicrobeGeometry(): THREE.BufferGeometry {
    const geo = new THREE.IcosahedronGeometry(0.3, 1);
    const pos = geo.attributes.position;
    // 扰动顶点使形状不规则，模拟阿米巴虫
    for (let i = 0; i < pos.count; i++) {
      const noise = 1 + (this.hash2D(i * 7, i * 13) - 0.5) * 0.55;
      const ySquash = 0.7 + this.hash2D(i * 3, i * 11) * 0.3; // 纵向略扁
      pos.setXYZ(
        i,
        pos.getX(i) * noise,
        pos.getY(i) * noise * ySquash,
        pos.getZ(i) * noise,
      );
    }
    geo.computeVertexNormals();
    return geo;
  }

  /** 🌿 植物：树干 + 分枝 + 多层树叶簇 */
  private buildPlantGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];

    // ---- 树干：略有弯曲的锥形圆柱 ----
    const trunk = new THREE.CylinderGeometry(0.05, 0.12, 0.8, 6);
    // 给树干顶点加一点弯曲
    const tPos = trunk.attributes.position;
    for (let i = 0; i < tPos.count; i++) {
      const y = tPos.getY(i);
      const bendFactor = (y + 0.4) / 0.8; // 0→底, 1→顶
      tPos.setX(i, tPos.getX(i) + bendFactor * bendFactor * 0.03);
    }
    trunk.translate(0, 0.4, 0);
    parts.push(trunk);

    // ---- 主要树枝（3条，从树干上部伸出） ----
    const branchAngles = [0, Math.PI * 0.7, Math.PI * 1.4];
    for (let b = 0; b < 3; b++) {
      const branch = new THREE.CylinderGeometry(0.015, 0.035, 0.35, 4);
      branch.rotateZ(Math.PI * 0.35); // 倾斜
      branch.rotateY(branchAngles[b]);
      branch.translate(
        Math.sin(branchAngles[b]) * 0.12,
        0.65 + b * 0.05,
        Math.cos(branchAngles[b]) * 0.12
      );
      parts.push(branch);
    }

    // ---- 树冠：由多个扰动的球体/十二面体组成的有机叶簇 ----
    // 主冠（顶部大球）
    const mainCanopy = new THREE.DodecahedronGeometry(0.38, 1);
    this.perturbGeometry(mainCanopy, 0.3, 100);
    mainCanopy.translate(0, 1.05, 0);
    parts.push(mainCanopy);

    // 侧冠叶簇（围绕主冠排列，让树冠更丰满）
    const leafClusters = [
      { x: 0.22, y: 0.88, z: 0.15, r: 0.22 },
      { x: -0.18, y: 0.92, z: 0.20, r: 0.20 },
      { x: 0.05, y: 0.82, z: -0.25, r: 0.23 },
      { x: -0.20, y: 1.00, z: -0.12, r: 0.18 },
      { x: 0.25, y: 1.05, z: -0.10, r: 0.19 },
      { x: -0.08, y: 1.18, z: 0.10, r: 0.17 },
    ];
    for (let c = 0; c < leafClusters.length; c++) {
      const lc = leafClusters[c];
      const cluster = new THREE.DodecahedronGeometry(lc.r, 1);
      this.perturbGeometry(cluster, 0.25, 200 + c * 37);
      cluster.translate(lc.x, lc.y, lc.z);
      parts.push(cluster);
    }

    // ---- 底部小植被（灌木感） ----
    const bush = new THREE.SphereGeometry(0.14, 5, 4);
    this.perturbGeometry(bush, 0.2, 500);
    bush.translate(0.1, 0.12, 0.08);
    parts.push(bush);

    const bush2 = new THREE.SphereGeometry(0.12, 5, 4);
    this.perturbGeometry(bush2, 0.2, 600);
    bush2.translate(-0.08, 0.10, -0.06);
    parts.push(bush2);

    const merged = mergeGeometries(parts);
    return merged ?? parts[0];
  }

  /** 对几何体顶点施加有机扰动（模拟自然生长的不规则感） */
  private perturbGeometry(geo: THREE.BufferGeometry, strength: number, seedOffset: number): void {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const n = 1 + (this.hash2D(i * 17 + seedOffset, i * 29 + seedOffset) - 0.5) * strength;
      pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n, pos.getZ(i) * n);
    }
    geo.computeVertexNormals();
  }

  /** 🦗 昆虫：头 + 胸 + 腹 + 翅膀 */
  private buildInsectGeometry(): THREE.BufferGeometry {
    // 腹部（最大）
    const abdomen = new THREE.SphereGeometry(0.30, 6, 4);
    abdomen.scale(0.8, 0.6, 1.2);
    abdomen.translate(0, 0.18, 0.22);

    // 胸部
    const thorax = new THREE.SphereGeometry(0.20, 5, 4);
    thorax.scale(0.85, 0.65, 0.85);
    thorax.translate(0, 0.20, -0.20);

    // 头部
    const head = new THREE.SphereGeometry(0.12, 5, 3);
    head.translate(0, 0.20, -0.45);

    // 触角（两根细棒）
    const antennaL = new THREE.CylinderGeometry(0.008, 0.008, 0.25, 3);
    antennaL.rotateZ(0.3);
    antennaL.rotateX(-0.6);
    antennaL.translate(-0.06, 0.32, -0.55);
    const antennaR = new THREE.CylinderGeometry(0.008, 0.008, 0.25, 3);
    antennaR.rotateZ(-0.3);
    antennaR.rotateX(-0.6);
    antennaR.translate(0.06, 0.32, -0.55);

    // 翅膀（薄片椭圆形）
    const wingL = new THREE.PlaneGeometry(0.5, 0.18);
    wingL.rotateX(-0.15);
    wingL.rotateZ(0.2);
    wingL.translate(-0.22, 0.32, -0.02);
    const wingR = new THREE.PlaneGeometry(0.5, 0.18);
    wingR.rotateX(-0.15);
    wingR.rotateZ(-0.2);
    wingR.translate(0.22, 0.32, -0.02);

    const merged = mergeGeometries([abdomen, thorax, head, antennaL, antennaR, wingL, wingR]);
    return merged ?? abdomen;
  }

  /** 🐾 动物：躯干 + 头部 + 四肢 + 耳朵 + 尾巴 */
  private buildAnimalGeometry(): THREE.BufferGeometry {
    // 躯干（圆润的盒子）
    const body = new THREE.BoxGeometry(0.50, 0.38, 0.75, 2, 2, 2);
    // 轻微圆化顶点
    const bPos = body.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      const x = bPos.getX(i), y = bPos.getY(i), z = bPos.getZ(i);
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len > 0) {
        const roundFactor = 0.08;
        const nx = x / len, ny = y / len, nz = z / len;
        bPos.setXYZ(i, x + nx * roundFactor, y + ny * roundFactor, z + nz * roundFactor);
      }
    }
    body.computeVertexNormals();
    body.translate(0, 0.32, 0);

    // 头部
    const head = new THREE.SphereGeometry(0.18, 6, 5);
    head.scale(1, 0.9, 1.1);
    head.translate(0, 0.42, -0.45);

    // 鼻吻
    const snout = new THREE.SphereGeometry(0.08, 5, 3);
    snout.scale(1, 0.7, 1.3);
    snout.translate(0, 0.37, -0.62);

    // 耳朵
    const earL = new THREE.ConeGeometry(0.05, 0.12, 4);
    earL.translate(-0.12, 0.58, -0.40);
    const earR = new THREE.ConeGeometry(0.05, 0.12, 4);
    earR.translate(0.12, 0.58, -0.40);

    // 四肢
    const makeLeg = (): THREE.CylinderGeometry => new THREE.CylinderGeometry(0.05, 0.04, 0.26, 4);
    const legFL = makeLeg(); legFL.translate(-0.17, 0.03, -0.24);
    const legFR = makeLeg(); legFR.translate(0.17, 0.03, -0.24);
    const legBL = makeLeg(); legBL.translate(-0.17, 0.03, 0.24);
    const legBR = makeLeg(); legBR.translate(0.17, 0.03, 0.24);

    // 尾巴
    const tail = new THREE.CylinderGeometry(0.025, 0.012, 0.30, 4);
    tail.rotateX(0.7);
    tail.translate(0, 0.42, 0.50);

    const merged = mergeGeometries([
      body, head, snout, earL, earR,
      legFL, legFR, legBL, legBR, tail,
    ]);
    return merged ?? body;
  }

  /**
   * 公开方法：创建生命体 3D 预览模型
   * 根据物种类型和 DNA 生成带颜色和形态变化的 Mesh
   * 用于详情面板中的 3D 预览
   */
  createPreviewMesh(type: OrganismType, dna: number[]): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    switch (type) {
      case OrganismType.Microbe: geometry = this.buildMicrobeGeometry(); break;
      case OrganismType.Plant:   geometry = this.buildPlantGeometry();   break;
      case OrganismType.Insect:  geometry = this.buildInsectGeometry();  break;
      case OrganismType.Animal:  geometry = this.buildAnimalGeometry();  break;
    }

    // DNA 驱动颜色
    const aquatic = dna[Gene.Aquatic] ?? 0;
    const colorHue = dna[Gene.ColorHue] ?? 0.5;
    const colorLight = dna[Gene.ColorLightness] ?? 0.5;
    const bodyShape = dna[Gene.BodyShape] ?? 0.5;

    const color = new THREE.Color();
    switch (type) {
      case OrganismType.Microbe: {
        const hue = 0.45 + colorHue * 0.2 - aquatic * 0.1;
        color.setHSL(hue, 0.45 + aquatic * 0.25, 0.35 + colorLight * 0.35);
        break;
      }
      case OrganismType.Plant: {
        const hue = 0.25 + colorHue * 0.15 - aquatic * 0.08;
        color.setHSL(hue, 0.5 + colorLight * 0.3, 0.3 + colorLight * 0.3);
        break;
      }
      case OrganismType.Insect: {
        color.setHSL(colorHue, 0.55 + colorLight * 0.3, 0.3 + colorLight * 0.35);
        if (aquatic > 0.5) color.lerp(this.aquaticBlendColor, aquatic * 0.4);
        break;
      }
      case OrganismType.Animal: {
        let hue = colorHue * 0.15 + 0.02;
        let sat = 0.55 + colorLight * 0.25;
        if (aquatic > 0.5) { hue = 0.55 + colorHue * 0.1; sat = 0.3 + colorLight * 0.2; }
        color.setHSL(hue, sat, 0.25 + colorLight * 0.3);
        break;
      }
    }

    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      metalness: 0.1,
      emissive: color.clone().multiplyScalar(0.15),
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // 体型形态变形
    const shapeX = 1 + (0.5 - bodyShape) * 0.35;
    const shapeZ = 1 + (bodyShape - 0.5) * 0.35;
    const scaleY = (type === OrganismType.Plant && aquatic > 0.5) ? 0.6 : 1.0;
    mesh.scale.set(shapeX, scaleY, shapeZ);

    return mesh;
  }

  /** 创建选中高亮环 */
  private createHighlightMesh(): void {
    const ringGeo = new THREE.RingGeometry(1.5, 2.0, 32);
    ringGeo.rotateX(-Math.PI / 2); // 水平放置
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.highlightMesh = new THREE.Mesh(ringGeo, ringMat);
    this.highlightMesh.visible = false;
    this.highlightMesh.renderOrder = 999; // 在最上层渲染
    this.scene.add(this.highlightMesh);
  }

  // ================================================================
  //  昼夜交替
  // ================================================================

  /** 更新昼夜循环：天空颜色、雾、太阳位置、灯光、星空 */
  private updateDayNight(): void {
    // 更新时刻：仅在非暂停时累计运行时间
    const now = performance.now();
    if (!this.paused) {
      this.elapsedRunTime += now - this.lastFrameTime;
    }
    this.lastFrameTime = now;

    const elapsedSec = this.elapsedRunTime / 1000;
    this.dayTime = (0.3 + elapsedSec / DAY_DURATION) % 1.0;

    // 找到当前所处的阶段区间
    let p0 = DAY_PHASES[0];
    let p1 = DAY_PHASES[1];
    for (let i = 0; i < DAY_PHASES.length - 1; i++) {
      if (this.dayTime >= DAY_PHASES[i].time && this.dayTime < DAY_PHASES[i + 1].time) {
        p0 = DAY_PHASES[i];
        p1 = DAY_PHASES[i + 1];
        break;
      }
    }

    // 插值因子
    const range = p1.time - p0.time;
    const t = range > 0 ? (this.dayTime - p0.time) / range : 0;

    // 天空颜色（使用预分配临时对象避免 GC）
    const a = this.dnColorA;
    const b = this.dnColorB;

    a.setHex(p0.sky); b.setHex(p1.sky);
    (this.scene.background as THREE.Color).copy(a.lerp(b, t));
    const skyColor = this.scene.background as THREE.Color; // 引用，用于后续水面

    a.setHex(p0.fog); b.setHex(p1.fog);
    (this.scene.fog as THREE.FogExp2).color.copy(a.lerp(b, t));

    a.setHex(p0.sunColor); b.setHex(p1.sunColor);
    this.sunLight.color.copy(a.lerp(b, t));
    this.sunLight.intensity = p0.sunIntensity + (p1.sunIntensity - p0.sunIntensity) * t;

    this.ambientLight.intensity = p0.ambientIntensity + (p1.ambientIntensity - p0.ambientIntensity) * t;

    a.setHex(p0.hemiSky); b.setHex(p1.hemiSky);
    this.hemiLight.color.copy(a.lerp(b, t));

    a.setHex(p0.hemiGround); b.setHex(p1.hemiGround);
    this.hemiLight.groundColor.copy(a.lerp(b, t));

    // 太阳轨道（从东方升起，经天顶，从西方落下）
    const sunAngle = this.dayTime * Math.PI * 2 - Math.PI / 2;
    const sunRadius = 300;
    this.sunLight.position.set(
      Math.cos(sunAngle) * sunRadius * 0.7,
      Math.sin(sunAngle) * sunRadius,
      sunRadius * 0.3
    );

    // 曝光度：夜间保留足够亮度，保证地面可见
    const sunHeight01 = (Math.sin(sunAngle) + 1) / 2; // [0, 1]
    this.renderer.toneMappingExposure = 1.0 + sunHeight01 * 0.3;

    // 星空透明度：夜间显示，白天隐藏
    let nightness: number;
    if (this.dayTime < 0.22) {
      nightness = 1;
    } else if (this.dayTime < 0.30) {
      nightness = 1 - (this.dayTime - 0.22) / 0.08;
    } else if (this.dayTime > 0.80) {
      nightness = (this.dayTime - 0.80) / 0.20;
    } else if (this.dayTime > 0.74) {
      nightness = (this.dayTime - 0.74) / 0.06 * 0.5;
    } else {
      nightness = 0;
    }
    this.nightness = nightness;
    (this.starsMesh.material as THREE.PointsMaterial).opacity = nightness * 0.9;

    // 星星微闪烁（用 sin 叠加产生随机感）
    const starFlicker = 1.0 + Math.sin(this.elapsedRunTime * 0.002) * 0.08
                            + Math.sin(this.elapsedRunTime * 0.0057) * 0.06;
    (this.starsMesh.material as THREE.PointsMaterial).size = 2.0 * starFlicker;

    // ---- 月亮位置 & 可见性 ----
    // 月亮与太阳相对：太阳在天时月亮在地平线以下，太阳落下时月亮升起
    const moonAngle = sunAngle + Math.PI; // 月亮与太阳对称
    const moonRadius = 500;
    const moonX = Math.cos(moonAngle) * moonRadius * 0.6;
    const moonY = Math.sin(moonAngle) * moonRadius * 0.8;
    const moonZ = moonRadius * 0.4;
    this.moonGroup.position.set(moonX, moonY, moonZ);

    // 月亮仅在夜间可见（高度 > 0）
    const moonVisible = nightness > 0.05 && moonY > 0;
    this.moonGroup.visible = moonVisible;
    // 月光强度随夜晚程度和月亮高度变化
    if (moonVisible) {
      const moonHeight01 = Math.max(0, moonY / (moonRadius * 0.8));
      this.moonLight.intensity = nightness * moonHeight01 * 0.6;
      // 月球和光晕透明度
      const moonMat = (this.moonGroup.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      moonMat.emissiveIntensity = 0.4 + nightness * 0.6;
      const glowMat = (this.moonGroup.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      glowMat.opacity = nightness * 0.12;
    }

    // ---- 生命体夜间辉光 ----
    const organismGlow = nightness * 0.45;
    this.microbeMat.emissiveIntensity = organismGlow;
    this.plantMat.emissiveIntensity = organismGlow * 0.7;
    // 昆虫：夜行昆虫额外发光（萤火虫效果），通过更高的 emissiveIntensity 实现
    // 基础辉光 + 额外脉冲闪烁（呼吸灯效果）
    const insectBaseGlow = organismGlow;
    const insectBioGlow = nightness * 0.6 * (0.7 + 0.3 * Math.sin(this.elapsedRunTime * 0.003));
    this.insectMat.emissiveIntensity = insectBaseGlow + insectBioGlow;
    this.animalMat.emissiveIntensity = organismGlow;
    this.eggMat.emissiveIntensity = organismGlow * 0.5; // 蛋微弱发光

    // 水面颜色随天空变化（使用临时 color 避免 new）
    const waterMat = this.waterMesh.material as THREE.MeshStandardMaterial;
    waterMat.color.copy(skyColor).multiplyScalar(0.25);
    a.setHex(0x0a3050);
    waterMat.color.add(a);

    // 水面微波（使用累计运行时间，暂停时静止）
    this.waterMesh.position.y = this.waterLevel + Math.sin(this.elapsedRunTime * 0.0008) * 0.12;
  }

  // ================================================================
  //  渲染数据更新
  // ================================================================

  /**
   * 接收 Worker 发来的最新帧数据
   * 仅存储目标位置并标记颜色需更新，实际矩阵更新在 render() 中通过插值完成
   */
  updateOrganisms(organisms: OrganismRenderData[]): void {
    // 将当前目标位置和朝向保存为"上一帧"（用于插值）
    this.prevPositions.clear();
    for (const org of this.targetOrganisms) {
      this.prevPositions.set(org.id, { x: org.x, z: org.z, facing: org.facing });
    }

    // 存储新的目标数据
    this.targetOrganisms = organisms;
    this.lastOrganisms = organisms;

    // 自适应追踪 Worker 帧间隔
    const now = performance.now();
    if (this.lastWorkerTime > 0) {
      this.workerDt = Math.max(10, Math.min(500, now - this.lastWorkerTime));
    }
    this.lastWorkerTime = now;

    // 标记颜色需要更新（下次矩阵更新时一并处理）
    this.needsColorUpdate = true;

    // 如果有选中的生命体，更新高亮位置和数据（运行/暂停时都需要）
    if (this.selectedOrganism) {
      this.updateHighlightForSelected(organisms);
    }
  }

  /** 接收 Worker 发来的蛋数据 */
  updateEggs(eggs: EggRenderData[]): void {
    this.targetEggs = eggs;
  }

  // ================================================================
  //  帧间插值（每帧调用，消除运动卡顿）
  // ================================================================

  /** 计算当前插值系数 [0, 1]，使用 smoothstep 缓动 */
  private getLerpAlpha(): number {
    if (this.lastWorkerTime <= 0 || this.workerDt <= 0) return 1;
    const elapsed = performance.now() - this.lastWorkerTime;
    const raw = Math.min(elapsed / this.workerDt, 1.0);
    // smoothstep 缓动：避免线性插值的突兀过渡
    return raw * raw * (3 - 2 * raw);
  }

  /** 获取指定生命体的插值位置和朝向 */
  private getInterpolatedPos(org: OrganismRenderData, alpha: number): { x: number; z: number } {
    const prev = this.prevPositions.get(org.id);
    if (prev) {
      return {
        x: prev.x + (org.x - prev.x) * alpha,
        z: prev.z + (org.z - prev.z) * alpha,
      };
    }
    return { x: org.x, z: org.z };
  }

  /** 获取指定生命体的插值朝向角度（处理 wrap-around） */
  private getInterpolatedFacing(org: OrganismRenderData, alpha: number): number {
    const prev = this.prevPositions.get(org.id);
    if (prev) {
      let diff = org.facing - prev.facing;
      // 归一化到 [-PI, PI]，走最短弧
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      return prev.facing + diff * alpha;
    }
    return org.facing;
  }

  /**
   * 每渲染帧调用：使用插值位置更新所有 InstancedMesh 矩阵
   * 颜色仅在收到新 Worker 数据时更新（needsColorUpdate）
   */
  private updateInstanceMatrices(): void {
    const organisms = this.targetOrganisms;
    if (organisms.length === 0) return;

    const alpha = this.getLerpAlpha();

    let microbeIdx = 0;
    let plantIdx = 0;
    let insectIdx = 0;
    let animalIdx = 0;

    for (let i = 0; i < organisms.length; i++) {
      const org = organisms[i];

      // 插值位置（尸体不需要插值，它们不移动）
      const pos = org.isCorpse
        ? { x: org.x, z: org.z }
        : this.getInterpolatedPos(org, alpha);
      // 插值朝向（尸体保持死亡时的朝向）
      const facing = org.isCorpse
        ? org.facing
        : this.getInterpolatedFacing(org, alpha);

      const rawTerrainY = this.getTerrainHeight(pos.x, pos.z);
      // DNA 基因读取
      const aquatic = org.dna[Gene.Aquatic] ?? 0;
      const bodyShape = org.dna[Gene.BodyShape] ?? 0.5;
      const colorHue = org.dna[Gene.ColorHue] ?? 0.5;
      const colorLight = org.dna[Gene.ColorLightness] ?? 0.5;

      // 水生生物在水面以下时贴水面游动，陆生生物在水面以上
      let terrainY: number;
      if (rawTerrainY < this.waterLevel && aquatic > 0.5) {
        terrainY = this.waterLevel - 0.3;
      } else {
        terrainY = Math.max(this.waterLevel + 0.1, rawTerrainY);
      }

      // 体型形态：紧凑型(0)→宽扁，流线型(1)→修长
      const shapeX = 1 + (0.5 - bodyShape) * 0.35;
      const shapeZ = 1 + (bodyShape - 0.5) * 0.35;

      // ---- 尸体视觉修正 ----
      // 尸体：压扁（倒地），颜色变暗灰
      const isCorpse = org.isCorpse;
      const decayDarken = isCorpse ? (1 - org.decayProgress * 0.6) : 1.0;
      const corpseYScale = isCorpse ? 0.2 : 1.0; // 尸体压扁

      // 模型的头部都朝向 -Z 方向，所以需要加 π 翻转，使头部对齐移动方向
      const renderFacing = facing + Math.PI;

      switch (org.type) {
        case OrganismType.Microbe: {
          if (microbeIdx >= MAX_MICROBES) break;
          const scale = org.size;
          // 微生物大致对称，仍应用旋转以保持一致性
          this.tempQuat.setFromAxisAngle(this.yAxis, renderFacing);
          this.tempScaleVec.set(scale * shapeX, scale * corpseYScale, scale * shapeZ);
          this.tempVec3A.set(pos.x, terrainY + scale * 0.25 * corpseYScale, pos.z);
          this.tempMatrix.compose(this.tempVec3A, this.tempQuat, this.tempScaleVec);
          this.microbeMesh.setMatrixAt(microbeIdx, this.tempMatrix);

          if (this.needsColorUpdate) {
            const hue = 0.45 + colorHue * 0.2 - aquatic * 0.1;
            const sat = isCorpse ? 0.15 : (0.45 + aquatic * 0.25);
            const light = (0.35 + colorLight * 0.35) * decayDarken;
            this.tempColor.setHSL(hue, sat, light);
            this.microbeMesh.setColorAt(microbeIdx, this.tempColor);
          }
          microbeIdx++;
          break;
        }

        case OrganismType.Plant: {
          if (plantIdx >= MAX_PLANTS) break;
          const scale = org.size;
          const plantShapeY = aquatic > 0.5 ? 0.6 : 1.3;
          // 植物不旋转（用单位四元数），保持固定朝向
          this.tempQuat.identity();
          this.tempScaleVec.set(scale * shapeX, scale * plantShapeY * corpseYScale, scale * shapeZ);
          this.tempVec3A.set(pos.x, terrainY, pos.z);
          this.tempMatrix.compose(this.tempVec3A, this.tempQuat, this.tempScaleVec);
          this.plantMesh.setMatrixAt(plantIdx, this.tempMatrix);

          if (this.needsColorUpdate) {
            const hue = 0.25 + colorHue * 0.15 - aquatic * 0.08;
            const sat = isCorpse ? 0.1 : (0.5 + colorLight * 0.3);
            const light = (0.25 + colorLight * 0.3 + Math.min(0.15, org.energy / 100)) * decayDarken;
            this.tempColor.setHSL(hue, sat, light);
            this.plantMesh.setColorAt(plantIdx, this.tempColor);
          }
          plantIdx++;
          break;
        }

        case OrganismType.Insect: {
          if (insectIdx >= MAX_INSECTS) break;
          const scale = org.size;
          // 组合矩阵：缩放 → Y轴旋转(头部朝前) → 位移
          this.tempQuat.setFromAxisAngle(this.yAxis, renderFacing);
          this.tempScaleVec.set(scale * shapeX, scale * corpseYScale, scale * shapeZ);
          this.tempVec3A.set(pos.x, terrainY, pos.z);
          this.tempMatrix.compose(this.tempVec3A, this.tempQuat, this.tempScaleVec);
          this.insectMesh.setMatrixAt(insectIdx, this.tempMatrix);

          if (this.needsColorUpdate) {
            const nocturnality = org.dna[Gene.Nocturnality] ?? 0;
            const hue = colorHue;
            const sat = isCorpse ? 0.1 : (0.55 + colorLight * 0.3);
            let light = (0.3 + colorLight * 0.35) * decayDarken;

            // 夜行昆虫发光效果（萤火虫）：nocturnality > 0.5 在夜间颜色偏黄绿且变亮
            if (!isCorpse && nocturnality > 0.5 && this.nightness > 0.1) {
              const glowAmount = (nocturnality - 0.5) * 2.0; // [0, 1]
              const glow = glowAmount * this.nightness * 0.55;
              light = Math.min(0.95, light + glow);
              // 颜色偏暖黄绿（萤火虫典型色 hue ≈ 0.18-0.35）
              this.tempColor.setHSL(
                0.18 + hue * 0.17,
                Math.min(1, sat + glow * 0.4),
                light
              );
            } else {
              this.tempColor.setHSL(hue, sat, light);
            }

            if (!isCorpse && aquatic > 0.5) {
              this.tempColor.lerp(this.aquaticBlendColor, aquatic * 0.4);
            }
            this.insectMesh.setColorAt(insectIdx, this.tempColor);
          }
          insectIdx++;
          break;
        }

        case OrganismType.Animal: {
          if (animalIdx >= MAX_ANIMALS) break;
          const scale = org.size;
          // 尸体侧倒：宽度增加，高度压缩
          const corpseWidthMod = isCorpse ? 1.3 : 1.0;
          // 组合矩阵：缩放 → Y轴旋转(头部朝前) → 位移
          this.tempQuat.setFromAxisAngle(this.yAxis, renderFacing);
          this.tempScaleVec.set(scale * shapeX * corpseWidthMod, scale * corpseYScale, scale * shapeZ * corpseWidthMod);
          this.tempVec3A.set(pos.x, terrainY, pos.z);
          this.tempMatrix.compose(this.tempVec3A, this.tempQuat, this.tempScaleVec);
          this.animalMesh.setMatrixAt(animalIdx, this.tempMatrix);

          if (this.needsColorUpdate) {
            let hue = colorHue * 0.15 + 0.02;
            let sat = isCorpse ? 0.08 : (0.55 + colorLight * 0.25);
            const light = (0.25 + colorLight * 0.3) * decayDarken;
            if (!isCorpse && aquatic > 0.5) {
              hue = 0.55 + colorHue * 0.1;
              sat = 0.3 + colorLight * 0.2;
            }
            this.tempColor.setHSL(hue, sat, light);
            this.animalMesh.setColorAt(animalIdx, this.tempColor);
          }
          animalIdx++;
          break;
        }
      }
    }

    // ---- 蛋的实例矩阵更新 ----
    let eggIdx = 0;
    const eggs = this.targetEggs;
    for (let i = 0; i < eggs.length && eggIdx < MAX_EGGS; i++) {
      const egg = eggs[i];
      const rawY = this.getTerrainHeight(egg.x, egg.z);
      const terrainY = Math.max(this.waterLevel + 0.1, rawY);
      const eggSize = egg.size;

      // 蛋的缩放：随孵化进度微微膨胀
      const hatchSwell = 1 + egg.hatchProgress * 0.15;
      this.tempScaleVec.set(eggSize * hatchSwell, eggSize * hatchSwell * 1.3, eggSize * hatchSwell);

      this.tempQuat.identity(); // 蛋不旋转
      this.tempVec3A.set(egg.x, terrainY + eggSize * 0.4, egg.z);
      this.tempMatrix.compose(this.tempVec3A, this.tempQuat, this.tempScaleVec);
      this.eggMesh.setMatrixAt(eggIdx, this.tempMatrix);

      if (this.needsColorUpdate) {
        // 蛋的颜色：基于亲本 DNA 色相，偏暖色调
        const eggHue = (egg.dna[Gene.ColorHue] ?? 0.12) * 0.15 + 0.06;
        const eggLight = 0.65 + (egg.dna[Gene.ColorLightness] ?? 0.5) * 0.2;
        this.tempColor.setHSL(eggHue, 0.35, eggLight);
        this.eggMesh.setColorAt(eggIdx, this.tempColor);
      }
      eggIdx++;
    }

    // 更新实例数
    this.microbeMesh.count = microbeIdx;
    this.plantMesh.count = plantIdx;
    this.insectMesh.count = insectIdx;
    this.animalMesh.count = animalIdx;
    this.eggMesh.count = eggIdx;

    // 标记 GPU 需要重新上传
    const meshes = [this.microbeMesh, this.plantMesh, this.insectMesh, this.animalMesh, this.eggMesh];
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (this.needsColorUpdate && mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
    this.needsColorUpdate = false;

    // 更新选中高亮位置（使用插值坐标）
    if (this.selectedOrganism && this.highlightMesh.visible) {
      const selPos = this.getInterpolatedPos(this.selectedOrganism, alpha);
      const selTerrainY = Math.max(this.waterLevel + 0.1, this.getTerrainHeight(selPos.x, selPos.z));
      const ringScale = this.selectedOrganism.size * 2.5;
      this.highlightMesh.scale.set(ringScale, ringScale, ringScale);
      this.highlightMesh.position.set(selPos.x, selTerrainY + 0.3, selPos.z);
    }
  }

  // ================================================================
  //  渲染
  // ================================================================

  /** 渲染一帧 */
  render(): void {
    // 处理聚焦动画
    this.updateFocusAnimation();

    // 实时跟随选中的生命体
    this.updateFollowCamera();

    // 处理 WASD 键盘平移
    this.processKeyboardMovement();

    // 更新昼夜交替
    this.updateDayNight();

    // ★ 每帧使用插值位置更新所有生命体矩阵（消除卡顿）
    this.updateInstanceMatrices();

    // 选中高亮脉冲动画
    if (this.highlightMesh.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.004);
      (this.highlightMesh.material as THREE.MeshBasicMaterial).opacity = 0.4 + pulse * 0.4;
      this.highlightMesh.rotation.y += 0.015;
    }

    this.renderer.render(this.scene, this.camera);

    // FPS 计算
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  }

  // ================================================================
  //  相机控制
  // ================================================================

  /** 更新相机位置 */
  private updateCameraPosition(): void {
    const x = this.cameraTarget.x +
      this.cameraDistance * Math.sin(this.cameraAzimuth) * Math.cos(this.cameraAngle);
    const y = this.cameraTarget.y +
      this.cameraDistance * Math.sin(this.cameraAngle);
    const z = this.cameraTarget.z +
      this.cameraDistance * Math.cos(this.cameraAzimuth) * Math.cos(this.cameraAngle);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.cameraTarget);
  }

  /** 聚焦到当前选中的生命体 */
  private focusOnSelected(): void {
    if (!this.selectedOrganism) return;

    const org = this.selectedOrganism;
    const terrainY = Math.max(this.waterLevel + 0.1, this.getTerrainHeight(org.x, org.z));

    // 记录动画起点
    this.focusFrom.copy(this.cameraTarget);
    this.focusDistFrom = this.cameraDistance;

    // 计算目标点（生命体正上方略微偏上）
    this.focusTo.set(org.x, terrainY + org.size * 0.5, org.z);

    // 目标距离：根据生命体大小决定拉近程度，最小 30
    this.focusDistTo = Math.max(30, org.size * 25);

    // 启动动画（动画结束后自动进入跟随模式）
    this.focusProgress = 0;
    this.focusAnimating = true;
    this.isFollowing = true;
  }

  /** 每帧更新聚焦平滑动画 */
  private updateFocusAnimation(): void {
    if (!this.focusAnimating) return;

    // 推进动画（约 60fps 下 ~0.4 秒）
    this.focusProgress += 1 / (60 * this.FOCUS_DURATION);
    if (this.focusProgress >= 1) {
      this.focusProgress = 1;
      this.focusAnimating = false;
    }

    // easeOutCubic 缓动
    const t = 1 - Math.pow(1 - this.focusProgress, 3);

    // 插值 cameraTarget 和 cameraDistance
    this.cameraTarget.lerpVectors(this.focusFrom, this.focusTo, t);
    this.cameraDistance = this.focusDistFrom + (this.focusDistTo - this.focusDistFrom) * t;

    this.updateCameraPosition();
  }

  /** 每帧更新相机跟随（平滑跟踪选中的生命体，使用插值位置） */
  private updateFollowCamera(): void {
    if (!this.isFollowing || !this.selectedOrganism || this.focusAnimating) return;

    const org = this.selectedOrganism;
    // 使用插值位置而非原始位置，确保相机跟随也平滑
    const alpha = this.getLerpAlpha();
    const pos = this.getInterpolatedPos(org, alpha);
    const terrainY = Math.max(this.waterLevel + 0.1, this.getTerrainHeight(pos.x, pos.z));
    // 复用临时向量，避免每帧 new
    this.tempVec3A.set(pos.x, terrainY + org.size * 0.5, pos.z);

    // 平滑插值跟随，lerp 系数越小越平滑
    this.cameraTarget.lerp(this.tempVec3A, 0.08);
    this.updateCameraPosition();
  }

  /** 每帧处理 WASD 键盘平移 */
  private processKeyboardMovement(): void {
    if (this.keysPressed.size === 0) return;
    // WASD 移动时中断聚焦动画和跟随
    if ((this.focusAnimating || this.isFollowing) && (
      this.keysPressed.has('w') || this.keysPressed.has('a') ||
      this.keysPressed.has('s') || this.keysPressed.has('d') ||
      this.keysPressed.has('arrowup') || this.keysPressed.has('arrowdown') ||
      this.keysPressed.has('arrowleft') || this.keysPressed.has('arrowright')
    )) {
      this.focusAnimating = false;
      this.isFollowing = false;
    }

    // 根据相机朝向计算前/右方向（在 XZ 平面上），复用临时向量
    const sinAz = Math.sin(this.cameraAzimuth);
    const cosAz = Math.cos(this.cameraAzimuth);

    // 速度与相机距离成正比（越远移动越快）
    const speed = this.MOVE_SPEED * (this.cameraDistance / 200);
    let mx = 0, mz = 0;

    if (this.keysPressed.has('w') || this.keysPressed.has('arrowup'))    { mx += -sinAz * speed; mz += -cosAz * speed; }
    if (this.keysPressed.has('s') || this.keysPressed.has('arrowdown'))  { mx +=  sinAz * speed; mz +=  cosAz * speed; }
    if (this.keysPressed.has('a') || this.keysPressed.has('arrowleft'))  { mx += -cosAz * speed; mz +=  sinAz * speed; }
    if (this.keysPressed.has('d') || this.keysPressed.has('arrowright')) { mx +=  cosAz * speed; mz += -sinAz * speed; }

    if (mx !== 0 || mz !== 0) {
      this.cameraTarget.x += mx;
      this.cameraTarget.z += mz;
      this.updateCameraPosition();
    }
  }

  /** 根据鼠标像素偏移量平移相机 */
  private panCamera(dx: number, dy: number): void {
    // 平移速度与相机距离成正比
    const panScale = this.cameraDistance * 0.002;

    // 在 XZ 平面上的右方向和前方向（纯数学，避免对象分配）
    const sinAz = Math.sin(this.cameraAzimuth);
    const cosAz = Math.cos(this.cameraAzimuth);

    this.cameraTarget.x += -cosAz * (-dx * panScale) + sinAz * (dy * panScale);
    this.cameraTarget.z +=  sinAz * (-dx * panScale) + cosAz * (dy * panScale);
    this.updateCameraPosition();
  }

  /** 设置鼠标/触摸/键盘事件 */
  private setupEvents(): void {
    const canvas = this.renderer.domElement;

    // ---- 键盘 ----
    window.addEventListener('keydown', (e) => {
      // 忽略输入框中的按键（避免在设置面板输入时触发相机移动）
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      this.keysPressed.add(e.key.toLowerCase());
      // F 键聚焦选中的生命体
      if (e.key.toLowerCase() === 'f' && this.selectedOrganism) {
        this.focusOnSelected();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keysPressed.delete(e.key.toLowerCase());
    });
    // 窗口失焦时清空按键状态，避免粘连
    window.addEventListener('blur', () => {
      this.keysPressed.clear();
    });

    // ---- 鼠标按下 ----
    canvas.addEventListener('mousedown', (e) => {
      this.didDrag = false;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.mouseDownScreenPos.x = e.clientX;
      this.mouseDownScreenPos.y = e.clientY;

      if (e.button === 0) {
        // 左键 → 旋转
        this.isDragging = true;
        this.isPanning = false;
      } else if (e.button === 1 || e.button === 2) {
        // 中键 / 右键 → 平移
        this.isPanning = true;
        this.isDragging = false;
      }
    });

    window.addEventListener('mousedown', (e) => {
      this.mouseDownScreenPos.x = e.clientX;
      this.mouseDownScreenPos.y = e.clientY;
      this.didDrag = false;
    });

    // ---- 鼠标移动 ----
    window.addEventListener('mousemove', (e) => {
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      // 标记为真正的拖拽
      const totalDx = e.clientX - this.mouseDownScreenPos.x;
      const totalDy = e.clientY - this.mouseDownScreenPos.y;
      if (Math.abs(totalDx) > 4 || Math.abs(totalDy) > 4) {
        this.didDrag = true;
      }

      if (this.isDragging) {
        // 左键拖拽 → 旋转（不中断跟随，只中断聚焦动画）
        this.focusAnimating = false;
        this.cameraAzimuth -= dx * 0.005;
        this.cameraAngle = Math.max(0.05, Math.min(Math.PI / 2 - 0.01,
          this.cameraAngle + dy * 0.005));
        this.updateCameraPosition();
      } else if (this.isPanning) {
        // 中键/右键拖拽 → 平移（中断跟随和聚焦动画）
        this.focusAnimating = false;
        this.isFollowing = false;
        this.panCamera(dx, dy);
      }
    });

    // ---- 鼠标松开 ----
    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.isPanning = false;
    });

    // 禁止右键菜单（用于右键平移）
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // ---- 点击选中（暂停和运行时都可以点选） ----
    canvas.addEventListener('click', (e) => {
      if (this.didDrag) return;
      this.handleClick(e.clientX, e.clientY);
    });

    // ---- 滚轮缩放 ----
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraDistance = Math.max(30, Math.min(900,
        this.cameraDistance + e.deltaY * 0.5));
      this.updateCameraPosition();
    }, { passive: false });

    // ---- 触摸事件 ----
    // 触控点击检测（tap-to-select）
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let touchMoved = false;

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.activeTouches = Array.from(e.touches);

      if (e.touches.length === 1) {
        // 单指 → 旋转 + 记录起始位置用于 tap 检测
        this.isDragging = true;
        this.isPanning = false;
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = performance.now();
        touchMoved = false;
      } else if (e.touches.length === 2) {
        // 双指 → 缩放
        this.isDragging = false;
        this.isPanning = false;
        this.lastTouchDist = this.getTouchDist(e.touches[0], e.touches[1]);
        touchMoved = true; // 多指操作不算 tap
      } else if (e.touches.length >= 3) {
        // 三指 → 平移
        this.isDragging = false;
        this.isPanning = true;
        const center = this.getTouchCenter(e.touches);
        this.lastTouchCenter.x = center.x;
        this.lastTouchCenter.y = center.y;
        touchMoved = true;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      this.activeTouches = Array.from(e.touches);

      if (e.touches.length === 1 && this.isDragging) {
        // 单指旋转
        const dx = e.touches[0].clientX - this.lastMouseX;
        const dy = e.touches[0].clientY - this.lastMouseY;
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;

        // 检测是否产生了明显的移动（超过 8px 即视为拖拽，非 tap）
        const totalDx = e.touches[0].clientX - touchStartX;
        const totalDy = e.touches[0].clientY - touchStartY;
        if (totalDx * totalDx + totalDy * totalDy > 64) {
          touchMoved = true;
        }

        this.cameraAzimuth -= dx * 0.005;
        this.cameraAngle = Math.max(0.05, Math.min(Math.PI / 2 - 0.01,
          this.cameraAngle + dy * 0.005));
        this.updateCameraPosition();

      } else if (e.touches.length === 2) {
        // 双指缩放
        const newDist = this.getTouchDist(e.touches[0], e.touches[1]);
        const delta = this.lastTouchDist - newDist;
        this.lastTouchDist = newDist;
        this.cameraDistance = Math.max(30, Math.min(900,
          this.cameraDistance + delta * 1.5));
        this.updateCameraPosition();

      } else if (e.touches.length >= 3 && this.isPanning) {
        // 三指平移
        const center = this.getTouchCenter(e.touches);
        const dx = center.x - this.lastTouchCenter.x;
        const dy = center.y - this.lastTouchCenter.y;
        this.lastTouchCenter.x = center.x;
        this.lastTouchCenter.y = center.y;
        this.panCamera(dx, dy);
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      // 检测单指 tap（短时间 + 无大幅移动 + 单指释放）
      const touchCount = e.touches.length;
      const elapsed = performance.now() - touchStartTime;
      if (touchCount === 0 && !touchMoved && elapsed < 300) {
        // 这是一个 tap，触发点选
        this.handleClick(touchStartX, touchStartY);
      }

      this.activeTouches = Array.from(e.touches);
      if (touchCount === 0) {
        this.isDragging = false;
        this.isPanning = false;
      } else if (touchCount === 1) {
        this.isDragging = true;
        this.isPanning = false;
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
      } else if (touchCount === 2) {
        this.isDragging = false;
        this.isPanning = false;
        this.lastTouchDist = this.getTouchDist(e.touches[0], e.touches[1]);
      }
    });

    // ---- 窗口大小变化（含移动端旋转屏幕） ----
    const handleResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };
    window.addEventListener('resize', handleResize);
    // 部分移动端浏览器不触发 resize，需要监听 orientationchange
    window.addEventListener('orientationchange', () => {
      setTimeout(handleResize, 150); // 延迟等待浏览器完成旋转
    });
  }

  /** 计算两个触摸点的距离 */
  private getTouchDist(t1: Touch, t2: Touch): number {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** 计算所有触摸点的中心 */
  private getTouchCenter(touches: TouchList): { x: number; y: number } {
    let x = 0, y = 0;
    for (let i = 0; i < touches.length; i++) {
      x += touches[i].clientX;
      y += touches[i].clientY;
    }
    return { x: x / touches.length, y: y / touches.length };
  }

  // ================================================================
  //  选中交互（屏幕空间投影法）
  // ================================================================

  /**
   * 处理点击事件：将所有生命体 3D 坐标投影到屏幕 2D，
   * 找到离鼠标点击位置最近的生命体。
   * 比 Raycaster 更可靠，适用于小型 InstancedMesh 实例。
   */
  private handleClick(screenX: number, screenY: number): void {
    if (this.lastOrganisms.length === 0) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const projPos = new THREE.Vector3();

    let closest: OrganismRenderData | null = null;
    let closestDist = Infinity;

    for (const org of this.lastOrganisms) {
      // 计算生命体的实际渲染 Y 坐标（与 updateOrganisms 一致）
      const terrainY = Math.max(this.waterLevel + 0.1, this.getTerrainHeight(org.x, org.z));
      projPos.set(org.x, terrainY + org.size * 0.5, org.z);

      // 投影到 NDC [-1, 1]
      projPos.project(this.camera);

      // 排除相机背后的生命体
      if (projPos.z < 0 || projPos.z > 1) continue;

      // NDC → 屏幕像素坐标
      const sx = (projPos.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-projPos.y * 0.5 + 0.5) * rect.height + rect.top;

      const dx = sx - screenX;
      const dy = sy - screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 点击容差：根据生命体大小和相机距离动态调整，最小 20px
      const clickThreshold = Math.max(20, org.size * 15);

      if (dist < clickThreshold && dist < closestDist) {
        closestDist = dist;
        closest = org;
      }
    }

    if (closest) {
      this.selectedOrganism = closest;
      this.isFollowing = !closest.isCorpse;  // 尸体不跟随
      this.positionHighlight(closest);
      this.highlightMesh.visible = true;
      this.onOrganismSelect?.(closest);
    } else {
      this.clearSelection();
    }
  }

  /** 将高亮环定位到指定生命体位置 */
  private positionHighlight(org: OrganismRenderData): void {
    const terrainY = Math.max(this.waterLevel + 0.1, this.getTerrainHeight(org.x, org.z));
    const ringScale = org.size * 2.5;
    this.highlightMesh.scale.set(ringScale, ringScale, ringScale);
    this.highlightMesh.position.set(org.x, terrainY + 0.3, org.z);
  }

  /** 如果有选中的生命体，在新帧数据中更新它（确保位置和数据同步） */
  private updateHighlightForSelected(organisms: OrganismRenderData[]): void {
    if (!this.selectedOrganism) return;
    // 查找同 id 的生命体
    const updated = organisms.find(o => o.id === this.selectedOrganism!.id);
    if (updated) {
      this.selectedOrganism = updated;
      this.positionHighlight(updated);
      this.onOrganismSelect?.(updated);
    } else {
      // 生命体已死亡/消失
      this.clearSelection();
    }
  }

  /** 获取当前时刻的中文标签 */
  getTimeLabel(): string {
    const t = this.dayTime;
    if (t < 0.20) return '🌙 深夜';
    if (t < 0.26) return '🌅 黎明';
    if (t < 0.34) return '🌄 日出';
    if (t < 0.45) return '☀️ 上午';
    if (t < 0.55) return '☀️ 正午';
    if (t < 0.65) return '☀️ 下午';
    if (t < 0.74) return '🌇 傍晚';
    if (t < 0.82) return '🌆 黄昏';
    return '🌙 夜晚';
  }

  /** 销毁渲染器 */
  dispose(): void {
    this.renderer.dispose();
  }
}
