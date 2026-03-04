// ============================================
// ALife Simulator - 共享类型定义
// ============================================

/** 3D 向量 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ---- DNA 基因索引 ----
export enum Gene {
  BodySize = 0,        // 体型 [0.3, 3.0]
  MoveSpeed = 1,       // 移动速度 [0.0, 5.0]
  SenseRange = 2,      // 视野范围 [2, 50]
  Attack = 3,          // 攻击力 [0, 10]
  Defense = 4,         // 防御力 [0, 10]
  Metabolism = 5,      // 代谢速率 [0.05, 2.0]
  ReproThreshold = 6,  // 繁殖能量阈值 [15, 200]
  Aggression = 7,      // 攻击倾向 [0, 1]
  FleeInclination = 8, // 逃跑倾向 [0, 1]
  DietType = 9,        // 食性类型 [0=草食, 0.5=杂食, 1=肉食]
  MutationRate = 10,   // 突变率 [0.01, 0.3]
  Nocturnality = 11,   // 昼夜习性 [0=昼行, 1=夜行]
  Aquatic = 12,        // 水生适应性 [0=纯陆生, 1=纯水生]
  BodyShape = 13,      // 体型形态 [0=圆润紧凑, 1=流线修长]
  ColorHue = 14,       // 体色色相 [0, 1] 映射 HSL 色环
  ColorLightness = 15, // 体色明度 [0=深色, 1=亮色]
  COUNT = 16,          // DNA 长度
}

/** DNA 各基因的范围定义 */
export const GENE_RANGES: [number, number][] = [
  [0.3, 3.0],   // BodySize
  [0.0, 5.0],   // MoveSpeed  — 下限 0（微生物/植物几乎不动）
  [2, 50],      // SenseRange — 下限 2（微生物感知极小）
  [0, 10],      // Attack
  [0, 10],      // Defense
  [0.05, 2.0],  // Metabolism — 下限 0.05（微生物代谢极低）
  [15, 200],    // ReproThreshold — 下限 15（微生物极低繁殖阈值）
  [0, 1],       // Aggression
  [0, 1],       // FleeInclination
  [0, 1],       // DietType
  [0.01, 0.3],  // MutationRate
  [0, 1],       // Nocturnality
  [0, 1],       // Aquatic      — 水生适应性
  [0, 1],       // BodyShape    — 体型形态
  [0, 1],       // ColorHue     — 体色色相
  [0, 1],       // ColorLightness — 体色明度
];

// ---- 死亡原因 ----
export enum DeathCause {
  None = 0,           // 未死亡
  Starvation = 1,     // 饿死（能量耗尽）
  OldAge = 2,         // 自然老死（达到最大年龄）
  Predation = 3,      // 被捕食（被其他生命体攻击/吃掉）
  Overcrowding = 4,   // 种群过密（同类竞争压力）
  Disease = 5,        // 疾病（高密度环境下触发）
  Environmental = 6,  // 环境灾害（随机自然灾害事件）
}

/** 死亡原因统计 */
export interface DeathStats {
  starvation: number;
  oldAge: number;
  predation: number;
  overcrowding: number;
  disease: number;
  environmental: number;
  total: number;
}

/** 创建空死亡统计 */
export function createEmptyDeathStats(): DeathStats {
  return {
    starvation: 0,
    oldAge: 0,
    predation: 0,
    overcrowding: 0,
    disease: 0,
    environmental: 0,
    total: 0,
  };
}

// ---- 性别 ----
export enum Gender {
  Female = 0,   // 雌性（负责繁殖/产卵）
  Male = 1,     // 雄性（负责受精）
  None = -1,    // 无性别（微生物/植物）
}

// ---- 生命体类型 ----
export enum OrganismType {
  Microbe = 0,  // 微生物（分解者/寄生者）
  Plant = 1,    // 植物（光合作用生产者）
  Insect = 2,   // 昆虫（小型消费者）
  Animal = 3,   // 动物（大型消费者）
}

/**
 * 根据 DNA 特征推导的生态角色标签
 * 用于在 UI 中显示可读的物种描述
 */
export function getSubSpeciesLabel(type: OrganismType, dna: number[]): string {
  const dietType = dna[Gene.DietType];
  const aggression = dna[Gene.Aggression];
  const nocturnality = dna[Gene.Nocturnality] ?? 0;
  const aquatic = dna[Gene.Aquatic] ?? 0;
  const bodyShape = dna[Gene.BodyShape] ?? 0.5;

  const nocturnalTag = nocturnality > 0.6 ? ' 🌙' : '';
  const aquaticTag = aquatic > 0.6 ? ' 🌊' : '';

  switch (type) {
    case OrganismType.Microbe: {
      if (aquatic > 0.6) return '🦠 浮游微生物' + aquaticTag;
      if (aggression > 0.6) return '🦠 寄生菌';
      if (dietType > 0.6) return '🧫 腐生菌';
      return '🫧 分解者';
    }
    case OrganismType.Plant: {
      const size = dna[Gene.BodySize];
      if (aquatic > 0.6) return '🪷 水生植物' + aquaticTag;
      if (size > 0.7) return '🌳 大型植物';
      if (size > 0.45) return '🌿 灌木';
      return '🌱 草本';
    }
    case OrganismType.Insect: {
      if (aquatic > 0.6) return '🦐 水生节肢' + nocturnalTag + aquaticTag;
      if (bodyShape > 0.7) {
        if (dietType > 0.5) return '🦟 掠食飞虫' + nocturnalTag;
        return '🦋 飞行昆虫' + nocturnalTag;
      }
      if (dietType > 0.6) return '🦂 肉食昆虫' + nocturnalTag;
      if (dietType > 0.3) return '🐛 杂食昆虫' + nocturnalTag;
      return '🦗 食草昆虫' + nocturnalTag;
    }
    case OrganismType.Animal: {
      if (aquatic > 0.6) {
        if (dietType > 0.6) return '🦈 水域猎手' + nocturnalTag + aquaticTag;
        return '🐟 水生动物' + nocturnalTag + aquaticTag;
      }
      if (bodyShape > 0.7) {
        if (dietType > 0.6) return '🐆 流线猎手' + nocturnalTag;
        return '🦌 长腿草食' + nocturnalTag;
      }
      if (bodyShape < 0.3) {
        if (dietType > 0.5) return '🐻 敦实杂食' + nocturnalTag;
        return '🐖 紧凑食草' + nocturnalTag;
      }
      if (dietType > 0.7) return '🐺 食肉动物' + nocturnalTag + aquaticTag;
      if (dietType > 0.3) return '🦊 杂食动物' + nocturnalTag + aquaticTag;
      return '🐄 食草动物' + nocturnalTag + aquaticTag;
    }
  }
}

/** 生命体序列化数据（用于 Worker <-> Main Thread 通信） */
export interface OrganismData {
  id: number;
  type: OrganismType;
  dna: number[];
  energy: number;
  age: number;
  maxAge: number;
  position: Vec3;
  velocity: Vec3;
  alive: boolean;
  speciesId: number;
}

/** 渲染帧数据（Worker 发送到主线程） */
export interface RenderFrameData {
  tick: number;
  organisms: OrganismRenderData[];
  /** 世界中的蛋（昆虫产卵后的静态孵化对象） */
  eggs: EggRenderData[];
  stats: SimulationStats;
}

/** 用于渲染的精简生命体数据 */
export interface OrganismRenderData {
  id: number;
  type: OrganismType;
  x: number;
  y: number;
  z: number;
  size: number;
  energy: number;
  speciesId: number;
  /** 完整 DNA（用于暂停时查看详情） */
  dna: number[];
  /** 当前年龄 */
  age: number;
  /** 最大寿命 */
  maxAge: number;
  /** 健康值 [0, 1] */
  health: number;
  /** 性别 (-1=无, 0=雌, 1=雄) */
  gender: Gender;
  /** 饱腹度 [0, 1]（0=饥饿, 1=饱腹） */
  satiety: number;
  /** 是否处于发情期（仅雌性有意义） */
  isInEstrus: boolean;
  /** 朝向角度（弧度）：生命体面朝的方向 */
  facing: number;
  /** 是否为尸体 */
  isCorpse: boolean;
  /** 腐烂进度 [0, 1]（0=新鲜, 1=完全腐烂） */
  decayProgress: number;

  // ---- 繁殖状态 ----
  /** 是否正在释放交配信号（发情信息素/求偶鸣叫） */
  isEmittingMatingSignal: boolean;
  /** 是否处于怀孕/妊娠状态（仅哺乳动物雌性） */
  isPregnant: boolean;
  /** 怀孕进度 [0, 1]（0=刚受精, 1=即将分娩） */
  pregnancyProgress: number;
}

/** 蛋的渲染数据 */
export interface EggRenderData {
  id: number;
  x: number;
  y: number;
  z: number;
  /** 蛋的大小（与亲本体型相关） */
  size: number;
  /** 所属物种 ID */
  speciesId: number;
  /** 生物类型 */
  type: OrganismType;
  /** 孵化进度 [0, 1]（0=刚产, 1=即将孵化） */
  hatchProgress: number;
  /** 蛋的 DNA（用于颜色推导） */
  dna: number[];
}

/** 模拟统计数据 */
export interface SimulationStats {
  tick: number;
  totalOrganisms: number;
  microbeCount: number;
  plantCount: number;
  insectCount: number;
  animalCount: number;
  births: number;
  deaths: number;
  deathStats: DeathStats;
  speciesCount: number;
  speciesList: SpeciesInfo[];

  /** 大气 CO₂ 浓度 [0, ~3.0]，1.0 为平衡态 */
  co2Level: number;

  /** 大气 O₂ 浓度 [0, ~3.0]，1.0 为平衡态 */
  o2Level: number;

  /** 有害气体浓度 [0, ~3.0]，0 为无污染 */
  toxicGasLevel: number;

  /** 当前昼夜时刻 [0,1)：0=午夜, 0.5=正午 */
  dayTime: number;
}

export interface SpeciesInfo {
  id: number;
  type: OrganismType;
  count: number;
  avgDna: number[];
  color: [number, number, number];
  /** 生态角色标签（如 "食肉动物"、"分解者"） */
  label: string;
}

// ---- Worker 消息类型 ----
export enum WorkerMessageType {
  Init = 'init',
  Start = 'start',
  Pause = 'pause',
  Resume = 'resume',
  SetSpeed = 'setSpeed',
  Frame = 'frame',
  Ready = 'ready',
}

export interface WorkerMessage {
  type: WorkerMessageType;
  data?: any;
}

// ---- 世界配置 ----
export interface WorldConfig {
  width: number;
  height: number;
  initialMicrobes: number;
  initialPlants: number;
  initialInsects: number;
  initialAnimals: number;
  maxMicrobes: number;
  maxPlants: number;
  microbeGrowthRate: number; // 每 tick 自然生长的微生物数
  plantGrowthRate: number;   // 每 tick 生长的植物数
  plantEnergy: number;       // 每株植物的能量
  ticksPerSecond: number;

  // ---- 随机种子 ----
  /** 随机种子：-1 表示每次随机，≥0 时确定性生成（相同种子 = 相同世界） */
  seed: number;

  // ---- 地形参数 ----
  /** 山脉高度倍率 [0.2, 3.0]，1.0=默认 */
  terrainHeight: number;
  /** 地形起伏度 [0.2, 3.0]，1.0=默认 */
  terrainRoughness: number;
  /** 水位高度 [0.0, 5.0]，1.5=默认 */
  waterLevel: number;
  /** 河流宽度倍率 [0.0, 3.0]，1.0=默认，0=无河流 */
  riverWidth: number;
}

/**
 * 基准 TPS（所有 per-tick 参数都以此 TPS 为基准调优）
 * 提高实际 TPS 可获得更流畅的运动，但需要用 tickDt 归一化
 */
export const BASE_TPS = 3;

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  width: 500,
  height: 500,
  // 生态金字塔：微生物 >> 植物 > 昆虫 > 动物
  initialMicrobes: 400,   // 最多：无处不在的分解者
  initialPlants: 600,     // 次多：食物网的稳定基础
  initialInsects: 200,    // 中等：小型消费者
  initialAnimals: 80,     // 最少：大型消费者/顶级捕食者
  maxMicrobes: 1500,      // 微生物承载量最高
  maxPlants: 1200,        // 植物承载量次之
  microbeGrowthRate: 5,   // 微生物从环境中快速自发生长
  plantGrowthRate: 4,     // 植物种子传播较快
  plantEnergy: 30,
  ticksPerSecond: 10,     // 10 TPS → 更流畅的运动（原 3 TPS）
  seed: -1,               // -1 = 每次随机
  terrainHeight: 1.0,     // 山脉高度倍率
  terrainRoughness: 1.0,  // 地形起伏度
  waterLevel: 1.5,        // 水位
  riverWidth: 1.0,        // 河流宽度倍率
};

// ================================================================
//  确定性伪随机数生成器 (Mulberry32)
// ================================================================

/**
 * 可播种的伪随机数生成器
 * 使用 Mulberry32 算法 — 质量好、速度快、可完全复现
 *
 * @example
 * const rng = new SeededRandom(12345);
 * rng.next();      // [0, 1) 均匀分布
 * rng.nextInt(10);  // [0, 10) 整数
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // 确保 seed 是 32-bit 正整数
    this.state = (seed >>> 0) || 1;
  }

  /** 返回 [0, 1) 伪随机浮点数 */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [0, max) 整数 */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** 返回 [min, max) 浮点数 */
  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** 返回 true 的概率为 p */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/**
 * 根据 WorldConfig.seed 创建 PRNG 实例
 * seed = -1 → 用当前时间作为随机种子（每次不同）
 * seed >= 0 → 确定性种子（可复现）
 *
 * 返回 [实际种子, PRNG实例]
 */
export function createRNG(seed: number): [number, SeededRandom] {
  const actualSeed = seed < 0 ? (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0 : seed;
  return [actualSeed, new SeededRandom(actualSeed)];
}
