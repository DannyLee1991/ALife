// ============================================
// Three.js 渲染器
// 程序化地形 + 河流水面 + 昼夜交替 + 星空
// 使用 InstancedMesh 实现高性能渲染
// ============================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OrganismType, OrganismRenderData } from '../types';

// ---- 常量 ----
const MAX_MICROBES = 800;
const MAX_PLANTS = 1000;
const MAX_INSECTS = 600;
const MAX_ANIMALS = 400;

const TERRAIN_SIZE = 600;
const TERRAIN_SEGMENTS = 200;
const WATER_LEVEL = 1.5;

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
  // 午夜（提高最低光照，保证地形轮廓可辨识）
  { time: 0.00, sky: 0x0c0c1a, fog: 0x06060e, sunColor: 0x334466, sunIntensity: 0.06, ambientIntensity: 0.18, hemiSky: 0x0e0e2a, hemiGround: 0x0a0a0a },
  // 黎明前
  { time: 0.20, sky: 0x181838, fog: 0x0e0e28, sunColor: 0x445577, sunIntensity: 0.10, ambientIntensity: 0.22, hemiSky: 0x181848, hemiGround: 0x0c0c0c },
  // 日出
  { time: 0.26, sky: 0xcc6633, fog: 0x884422, sunColor: 0xff8844, sunIntensity: 0.65, ambientIntensity: 0.35, hemiSky: 0xff9966, hemiGround: 0x2a1a0a },
  // 清晨
  { time: 0.34, sky: 0x5da0d0, fog: 0x7ab8dc, sunColor: 0xffeedd, sunIntensity: 1.00, ambientIntensity: 0.50, hemiSky: 0x88ccee, hemiGround: 0x3a2a1a },
  // 正午
  { time: 0.50, sky: 0x87ceeb, fog: 0x99d4ee, sunColor: 0xffffff, sunIntensity: 1.20, ambientIntensity: 0.60, hemiSky: 0x87ceeb, hemiGround: 0x443322 },
  // 下午
  { time: 0.65, sky: 0x5da0d0, fog: 0x7ab8dc, sunColor: 0xffeedd, sunIntensity: 1.00, ambientIntensity: 0.50, hemiSky: 0x88ccee, hemiGround: 0x3a2a1a },
  // 日落
  { time: 0.74, sky: 0xcc5522, fog: 0x773311, sunColor: 0xff5533, sunIntensity: 0.55, ambientIntensity: 0.30, hemiSky: 0xff6644, hemiGround: 0x220a04 },
  // 黄昏
  { time: 0.82, sky: 0x181838, fog: 0x0e0e28, sunColor: 0x445577, sunIntensity: 0.10, ambientIntensity: 0.22, hemiSky: 0x181848, hemiGround: 0x0c0c0c },
  // 回到午夜（与 time=0.00 一致，保证循环平滑）
  { time: 1.00, sky: 0x0c0c1a, fog: 0x06060e, sunColor: 0x334466, sunIntensity: 0.06, ambientIntensity: 0.18, hemiSky: 0x0e0e2a, hemiGround: 0x0a0a0a },
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

  // ---- 临时对象 ----
  private tempMatrix = new THREE.Matrix4();
  private tempColor = new THREE.Color();

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

  // ---- 水面 ----
  private waterMesh!: THREE.Mesh;

  // ---- 星空 ----
  private starsMesh!: THREE.Points;

  // ---- 昼夜 ----
  /** 累计运行时间（毫秒），暂停时不增长 */
  private elapsedRunTime = 0;
  /** 上一帧的 performance.now()，用于计算 delta */
  private lastFrameTime = performance.now();

  /** 当前时刻 [0, 1)：0=午夜, 0.25=日出, 0.5=正午, 0.75=日落 */
  dayTime = 0.3; // 从清晨开始

  // ---- 预计算高度图（用于快速查询地形高度）----
  private heightMap!: Float32Array;
  private heightMapRes = TERRAIN_SEGMENTS + 1;

  // ---- 生命体材质引用（用于夜间辉光） ----
  private microbeMat!: THREE.MeshStandardMaterial;
  private plantMat!: THREE.MeshStandardMaterial;
  private insectMat!: THREE.MeshStandardMaterial;
  private animalMat!: THREE.MeshStandardMaterial;

  // ---- 选中交互 ----
  private paused = false;
  private mouseDownScreenPos = { x: 0, y: 0 };
  private didDrag = false;
  private highlightMesh!: THREE.Mesh;

  /** 最后一帧的所有生命体数据（用于点击选中） */
  private lastOrganisms: OrganismRenderData[] = [];

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

    // 清空所有实例网格
    this.microbeMesh.count = 0;
    this.plantMesh.count = 0;
    this.insectMesh.count = 0;
    this.animalMesh.count = 0;
    const meshes = [this.microbeMesh, this.plantMesh, this.insectMesh, this.animalMesh];
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ================================================================
  //  程序化噪声（Value Noise + fBm）
  // ================================================================

  private hash2D(ix: number, iy: number): number {
    let h = (ix * 374761393 + iy * 668265263) | 0;
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
    const s = 0.006;

    // 主地形：连绵丘陵
    let h = (this.fbm(worldX * s + 100, worldZ * s + 100, 6) - 0.35) * 22;

    // 大尺度山脉：用 pow 让高处更陡峭
    const mountain = this.fbm(worldX * 0.003 + 50, worldZ * 0.003 + 50, 4);
    h += Math.pow(Math.max(0, mountain - 0.35), 1.6) * 70;

    // 细节起伏
    h += (this.noise2D(worldX * 0.03, worldZ * 0.03) - 0.5) * 2.5;

    // ---- 河流1：蜿蜒主河（大致南北方向）----
    const riverX = Math.sin(worldZ * 0.01) * 65 + Math.sin(worldZ * 0.003) * 110;
    const dRiver = Math.abs(worldX - riverX);
    const riverWidth = 24;
    if (dRiver < riverWidth) {
      const t = 1 - dRiver / riverWidth;
      h -= t * t * 12;
    }

    // ---- 河流2：东西方向支流 ----
    const river2Z = Math.cos(worldX * 0.008) * 55 + Math.cos(worldX * 0.002) * 95 + 30;
    const dRiver2 = Math.abs(worldZ - river2Z);
    const river2Width = 18;
    if (dRiver2 < river2Width) {
      const t = 1 - dRiver2 / river2Width;
      h -= t * t * 9;
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

    const terrain = new THREE.Mesh(geo, mat);
    this.scene.add(terrain);
  }

  /** 根据高度返回地形颜色 */
  private getTerrainColor(h: number): [number, number, number] {
    if (h < WATER_LEVEL - 3) {
      // 深水底：暗沙色
      return [0.35, 0.30, 0.20];
    } else if (h < WATER_LEVEL - 0.5) {
      // 浅水底：沙色
      return [0.55, 0.48, 0.32];
    } else if (h < WATER_LEVEL + 1) {
      // 河岸/沙滩
      return [0.72, 0.65, 0.42];
    } else if (h < 5) {
      // 草地：从浅绿渐变到绿
      const t = Math.max(0, Math.min(1, (h - WATER_LEVEL) / 3.5));
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
    this.waterMesh.position.y = WATER_LEVEL;
    this.scene.add(this.waterMesh);
  }

  /** 创建星空（夜间显示） */
  private createStars(): void {
    const starCount = 600;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random()); // 仅上半球
      const r = 700 + Math.random() * 200;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    });

    this.starsMesh = new THREE.Points(geo, mat);
    this.scene.add(this.starsMesh);
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

    // ---- 🌿 植物 — 树木（树干 + 树冠） ----
    const plantGeo = this.buildPlantGeometry();
    this.plantMat = new THREE.MeshStandardMaterial({
      color: 0x33aa33,
      roughness: 0.75,
      emissive: 0x228822,
      emissiveIntensity: 0,
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

    // 启用实例颜色
    const meshConfigs: [THREE.InstancedMesh, number][] = [
      [this.microbeMesh, MAX_MICROBES],
      [this.plantMesh, MAX_PLANTS],
      [this.insectMesh, MAX_INSECTS],
      [this.animalMesh, MAX_ANIMALS],
    ];
    for (const [mesh, maxCount] of meshConfigs) {
      if (!mesh.instanceColor) {
        (mesh as any).instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(maxCount * 3), 3
        );
      }
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

  /** 🌿 植物：树干 + 有机树冠 */
  private buildPlantGeometry(): THREE.BufferGeometry {
    // 树干：上细下粗
    const trunk = new THREE.CylinderGeometry(0.06, 0.10, 0.7, 5);
    trunk.translate(0, 0.35, 0);

    // 树冠：扰动的十二面体
    const canopy = new THREE.DodecahedronGeometry(0.48, 1);
    const cPos = canopy.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
      const n = 1 + (this.hash2D(i * 17, i * 29) - 0.5) * 0.35;
      cPos.setXYZ(i, cPos.getX(i) * n, cPos.getY(i) * n, cPos.getZ(i) * n);
    }
    canopy.computeVertexNormals();
    canopy.translate(0, 0.95, 0);

    const merged = mergeGeometries([trunk, canopy]);
    return merged ?? trunk; // fallback
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

    // 天空颜色
    const skyColor = new THREE.Color(p0.sky).lerp(new THREE.Color(p1.sky), t);
    const fogColor = new THREE.Color(p0.fog).lerp(new THREE.Color(p1.fog), t);
    const sunColor = new THREE.Color(p0.sunColor).lerp(new THREE.Color(p1.sunColor), t);
    const hemiSky = new THREE.Color(p0.hemiSky).lerp(new THREE.Color(p1.hemiSky), t);
    const hemiGround = new THREE.Color(p0.hemiGround).lerp(new THREE.Color(p1.hemiGround), t);

    // 应用
    (this.scene.background as THREE.Color).copy(skyColor);
    (this.scene.fog as THREE.FogExp2).color.copy(fogColor);

    this.sunLight.color.copy(sunColor);
    this.sunLight.intensity = p0.sunIntensity + (p1.sunIntensity - p0.sunIntensity) * t;

    this.ambientLight.intensity = p0.ambientIntensity + (p1.ambientIntensity - p0.ambientIntensity) * t;

    this.hemiLight.color.copy(hemiSky);
    this.hemiLight.groundColor.copy(hemiGround);

    // 太阳轨道（从东方升起，经天顶，从西方落下）
    const sunAngle = this.dayTime * Math.PI * 2 - Math.PI / 2;
    const sunRadius = 300;
    this.sunLight.position.set(
      Math.cos(sunAngle) * sunRadius * 0.7,
      Math.sin(sunAngle) * sunRadius,
      sunRadius * 0.3
    );

    // 曝光度：夜间不能太暗，保证可见性
    const sunHeight01 = (Math.sin(sunAngle) + 1) / 2; // [0, 1]
    this.renderer.toneMappingExposure = 0.75 + sunHeight01 * 0.45;

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
    (this.starsMesh.material as THREE.PointsMaterial).opacity = nightness * 0.85;

    // 生命体夜间辉光：夜晚时自发光使轮廓清晰可见
    const organismGlow = nightness * 0.45;
    this.microbeMat.emissiveIntensity = organismGlow;
    this.plantMat.emissiveIntensity = organismGlow * 0.7;
    this.insectMat.emissiveIntensity = organismGlow;
    this.animalMat.emissiveIntensity = organismGlow;

    // 水面颜色随天空变化
    const waterMat = this.waterMesh.material as THREE.MeshStandardMaterial;
    waterMat.color.copy(skyColor).multiplyScalar(0.25);
    waterMat.color.add(new THREE.Color(0x0a3050));

    // 水面微波（使用累计运行时间，暂停时静止）
    this.waterMesh.position.y = WATER_LEVEL + Math.sin(this.elapsedRunTime * 0.0008) * 0.12;
  }

  // ================================================================
  //  渲染数据更新
  // ================================================================

  /** 更新生命体渲染数据（生命体贴合地形表面） */
  updateOrganisms(organisms: OrganismRenderData[]): void {
    let microbeIdx = 0;
    let plantIdx = 0;
    let insectIdx = 0;
    let animalIdx = 0;

    // 存储最新帧数据（用于暂停时点击选中）
    this.lastOrganisms = organisms;

    for (let i = 0; i < organisms.length; i++) {
      const org = organisms[i];
      // 获取地形表面高度，确保不沉入水中
      const terrainY = Math.max(WATER_LEVEL + 0.1, this.getTerrainHeight(org.x, org.z));

      switch (org.type) {
        case OrganismType.Microbe: {
          if (microbeIdx >= MAX_MICROBES) break;
          const scale = org.size;
          this.tempMatrix.makeScale(scale, scale, scale);
          // 有机变形体中心在原点附近，微微抬高离地
          this.tempMatrix.setPosition(org.x, terrainY + scale * 0.25, org.z);
          this.microbeMesh.setMatrixAt(microbeIdx, this.tempMatrix);

          const hueM = (org.speciesId * 97.32 + 170) % 360;
          this.tempColor.setHSL(hueM / 360, 0.55, 0.55);
          this.microbeMesh.setColorAt(microbeIdx, this.tempColor);
          microbeIdx++;
          break;
        }

        case OrganismType.Plant: {
          if (plantIdx >= MAX_PLANTS) break;
          const scale = org.size;
          // 树木底部在 y=0，直接贴地
          this.tempMatrix.makeScale(scale, scale * 1.3, scale);
          this.tempMatrix.setPosition(org.x, terrainY, org.z);
          this.plantMesh.setMatrixAt(plantIdx, this.tempMatrix);

          const greenIntensity = 0.3 + Math.min(0.7, org.energy / 50);
          this.tempColor.setRGB(0.15, greenIntensity, 0.1);
          this.plantMesh.setColorAt(plantIdx, this.tempColor);
          plantIdx++;
          break;
        }

        case OrganismType.Insect: {
          if (insectIdx >= MAX_INSECTS) break;
          const scale = org.size;
          // 虫体腹部底部约 y=0.05，整体略抬
          this.tempMatrix.makeScale(scale, scale, scale);
          this.tempMatrix.setPosition(org.x, terrainY, org.z);
          this.insectMesh.setMatrixAt(insectIdx, this.tempMatrix);

          const hue1 = (org.speciesId * 137.508) % 360;
          this.tempColor.setHSL(hue1 / 360, 0.7, 0.5);
          this.insectMesh.setColorAt(insectIdx, this.tempColor);
          insectIdx++;
          break;
        }

        case OrganismType.Animal: {
          if (animalIdx >= MAX_ANIMALS) break;
          const scale = org.size;
          // 四足动物脚底在 y≈-0.1，整体贴地
          this.tempMatrix.makeScale(scale, scale, scale);
          this.tempMatrix.setPosition(org.x, terrainY, org.z);
          this.animalMesh.setMatrixAt(animalIdx, this.tempMatrix);

          const hue2 = (org.speciesId * 97.32 + 30) % 360;
          this.tempColor.setHSL(hue2 / 360, 0.75, 0.42);
          this.animalMesh.setColorAt(animalIdx, this.tempColor);
          animalIdx++;
          break;
        }
      }
    }

    // 更新实例数
    this.microbeMesh.count = microbeIdx;
    this.plantMesh.count = plantIdx;
    this.insectMesh.count = insectIdx;
    this.animalMesh.count = animalIdx;

    // 标记需要更新
    const meshes = [this.microbeMesh, this.plantMesh, this.insectMesh, this.animalMesh];
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // 如果有选中的生命体，更新高亮位置和数据（运行/暂停时都需要）
    if (this.selectedOrganism) {
      this.updateHighlightForSelected(organisms);
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
    const terrainY = Math.max(WATER_LEVEL + 0.1, this.getTerrainHeight(org.x, org.z));

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

  /** 每帧更新相机跟随（平滑跟踪选中的生命体） */
  private updateFollowCamera(): void {
    if (!this.isFollowing || !this.selectedOrganism || this.focusAnimating) return;

    const org = this.selectedOrganism;
    const terrainY = Math.max(WATER_LEVEL + 0.1, this.getTerrainHeight(org.x, org.z));
    const targetPos = new THREE.Vector3(org.x, terrainY + org.size * 0.5, org.z);

    // 平滑插值跟随，lerp 系数越小越平滑
    this.cameraTarget.lerp(targetPos, 0.06);
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

    // 根据相机朝向计算前/右方向（在 XZ 平面上）
    const forward = new THREE.Vector3(
      -Math.sin(this.cameraAzimuth),
      0,
      -Math.cos(this.cameraAzimuth)
    );
    const right = new THREE.Vector3(
      Math.cos(this.cameraAzimuth),
      0,
      -Math.sin(this.cameraAzimuth)
    );

    // 速度与相机距离成正比（越远移动越快）
    const speed = this.MOVE_SPEED * (this.cameraDistance / 200);
    const move = new THREE.Vector3();

    if (this.keysPressed.has('w') || this.keysPressed.has('arrowup'))    move.add(forward.clone().multiplyScalar(speed));
    if (this.keysPressed.has('s') || this.keysPressed.has('arrowdown'))  move.add(forward.clone().multiplyScalar(-speed));
    if (this.keysPressed.has('a') || this.keysPressed.has('arrowleft'))  move.add(right.clone().multiplyScalar(-speed));
    if (this.keysPressed.has('d') || this.keysPressed.has('arrowright')) move.add(right.clone().multiplyScalar(speed));

    if (move.lengthSq() > 0) {
      this.cameraTarget.add(move);
      this.updateCameraPosition();
    }
  }

  /** 根据鼠标像素偏移量平移相机 */
  private panCamera(dx: number, dy: number): void {
    // 平移速度与相机距离成正比
    const panScale = this.cameraDistance * 0.002;

    // 在 XZ 平面上的右方向和前方向
    const right = new THREE.Vector3(
      Math.cos(this.cameraAzimuth),
      0,
      -Math.sin(this.cameraAzimuth)
    );
    const forward = new THREE.Vector3(
      -Math.sin(this.cameraAzimuth),
      0,
      -Math.cos(this.cameraAzimuth)
    );

    this.cameraTarget.add(right.multiplyScalar(-dx * panScale));
    this.cameraTarget.add(forward.multiplyScalar(dy * panScale));
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
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.activeTouches = Array.from(e.touches);

      if (e.touches.length === 1) {
        // 单指 → 旋转
        this.isDragging = true;
        this.isPanning = false;
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        // 双指 → 缩放
        this.isDragging = false;
        this.isPanning = false;
        this.lastTouchDist = this.getTouchDist(e.touches[0], e.touches[1]);
      } else if (e.touches.length >= 3) {
        // 三指 → 平移
        this.isDragging = false;
        this.isPanning = true;
        const center = this.getTouchCenter(e.touches);
        this.lastTouchCenter.x = center.x;
        this.lastTouchCenter.y = center.y;
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
      this.activeTouches = Array.from(e.touches);
      if (e.touches.length === 0) {
        this.isDragging = false;
        this.isPanning = false;
      } else if (e.touches.length === 1) {
        this.isDragging = true;
        this.isPanning = false;
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.isDragging = false;
        this.isPanning = false;
        this.lastTouchDist = this.getTouchDist(e.touches[0], e.touches[1]);
      }
    });

    // ---- 窗口大小变化 ----
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
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
      const terrainY = Math.max(WATER_LEVEL + 0.1, this.getTerrainHeight(org.x, org.z));
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
      this.isFollowing = true;  // 选中后开始跟随
      this.positionHighlight(closest);
      this.highlightMesh.visible = true;
      this.onOrganismSelect?.(closest);
    } else {
      this.clearSelection();
    }
  }

  /** 将高亮环定位到指定生命体位置 */
  private positionHighlight(org: OrganismRenderData): void {
    const terrainY = Math.max(WATER_LEVEL + 0.1, this.getTerrainHeight(org.x, org.z));
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
