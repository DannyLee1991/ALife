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
  BodySize = 0,       // 体型 [0.3, 3.0]
  MoveSpeed = 1,      // 移动速度 [0.5, 5.0]
  SenseRange = 2,     // 视野范围 [5, 50]
  Attack = 3,         // 攻击力 [0, 10]
  Defense = 4,        // 防御力 [0, 10]
  Metabolism = 5,     // 代谢速率 [0.1, 2.0]
  ReproThreshold = 6, // 繁殖能量阈值 [50, 200]
  Aggression = 7,     // 攻击倾向 [0, 1]
  FleeInclination = 8,// 逃跑倾向 [0, 1]
  DietType = 9,       // 食性类型 [0=草食, 0.5=杂食, 1=肉食]
  MutationRate = 10,  // 突变率 [0.01, 0.3]
  Nocturnality = 11,  // 昼夜习性 [0=昼行, 1=夜行]
  COUNT = 12,         // DNA 长度
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
  const nocturnalTag = nocturnality > 0.6 ? ' 🌙' : '';

  switch (type) {
    case OrganismType.Microbe: {
      // 微生物：根据攻击倾向和食性区分
      if (aggression > 0.6) return '🦠 寄生菌';
      if (dietType > 0.6) return '🧫 腐生菌';
      return '🫧 分解者';
    }
    case OrganismType.Plant: {
      const size = dna[Gene.BodySize];
      if (size > 0.7) return '🌳 大型植物';
      if (size > 0.45) return '🌿 灌木';
      return '🌱 草本';
    }
    case OrganismType.Insect: {
      if (dietType > 0.6) return '🦂 肉食昆虫' + nocturnalTag;
      if (dietType > 0.3) return '🐛 杂食昆虫' + nocturnalTag;
      return '🦗 食草昆虫' + nocturnalTag;
    }
    case OrganismType.Animal: {
      if (dietType > 0.7) return '🐺 食肉动物' + nocturnalTag;
      if (dietType > 0.3) return '🦊 杂食动物' + nocturnalTag;
      return '🐄 食草动物' + nocturnalTag;
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
}

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
  ticksPerSecond: 30,
};
