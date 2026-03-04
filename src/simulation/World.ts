// ============================================
// 世界系统 - 管理所有生命体和生态循环
// ============================================

import {
  WorldConfig,
  OrganismType,
  OrganismRenderData,
  SimulationStats,
  SpeciesInfo,
  RenderFrameData,
  DeathCause,
  DeathStats,
  Gender,
  BASE_TPS,
  createEmptyDeathStats,
  getSubSpeciesLabel,
  SeededRandom,
  createRNG,
} from '../types';
import { Organism } from './Organism';
import { createRandomDNA, crossoverAndMutate, asexualReproduce, dnaSimilarity } from './DNA';
import { SpatialGrid } from './SpatialGrid';
import { BehaviorEngine } from './Behavior';

/** 尸体数据 */
interface Corpse {
  id: number;
  type: OrganismType;
  position: { x: number; y: number; z: number };
  size: number;
  dna: number[];
  /** 剩余可被分解的能量 */
  remainingEnergy: number;
  /** 腐烂剩余 tick 数 */
  decayTimer: number;
  /** 最大腐烂时间（用于计算进度） */
  maxDecayTime: number;
  /** 原始物种 ID */
  speciesId: number;
  /** 死亡时的朝向角度 */
  facing: number;
}

/** 蛋数据（昆虫产卵后的静态孵化对象） */
interface Egg {
  id: number;
  type: OrganismType;
  position: { x: number; y: number; z: number };
  /** 蛋的大小（与亲本体型相关） */
  size: number;
  /** 子代 DNA */
  dna: number[];
  /** 所属物种 ID */
  speciesId: number;
  /** 孵化剩余 tick 数 */
  hatchTimer: number;
  /** 孵化最大时间 */
  maxHatchTime: number;
  /** 蛋的生命值 [0, 1]（可被天敌吃掉） */
  health: number;
}

let nextCorpseId = 100000;
let nextEggId = 200000;

export class World {
  config: WorldConfig;
  organisms: Organism[];
  grid: SpatialGrid;
  behavior: BehaviorEngine;
  tick: number;
  totalBirths: number;
  totalDeaths: number;

  /** 累计各死因统计 */
  deathStats: DeathStats;

  /** 尸体列表 */
  corpses: Corpse[];

  /** 蛋列表（昆虫产卵） */
  eggs: Egg[];

  /** 可播种的伪随机数生成器 */
  rng: SeededRandom;

  private speciesMap: Map<number, SpeciesInfo>;
  private nextSpeciesId: number;

  /** 环境灾害冷却（每隔一段时间可能触发） */
  private disasterCooldown: number;

  /**
   * 每 tick 的时间步长归一化因子
   * = BASE_TPS / 实际 TPS
   * 所有 per-tick 连续效果（能量、健康、速度等）乘以此值
   * 确保提高 TPS 时不改变真实时间尺度下的行为
   */
  readonly tickDt: number;

  /**
   * TPS 缩放比（实际 TPS / BASE_TPS）
   * 用于缩放 tick 计数器类型的持续时间（冷却、年龄等）
   * 例如：TPS=10, BASE=3 → tpsRatio=3.33 → 冷却计数器初始值×3.33
   */
  readonly tpsRatio: number;

  /**
   * 一个完整昼夜循环的秒数（与渲染器 DAY_DURATION 保持一致）
   * 用于在模拟中独立计算当前时间
   */
  private static readonly DAY_DURATION = 180;

  /**
   * 当前时刻 [0, 1)：0=午夜, 0.25≈日出, 0.5=正午, 0.75≈日落
   * 由 tick 计数推导，与渲染器的昼夜循环同步
   */
  dayTime: number;

  /**
   * 大气 CO₂ 浓度（归一化值）
   * - 1.0 = 生态平衡态
   * - 0.0 = CO₂ 耗尽（植物无法光合作用）
   * - >1.0 = CO₂ 富余（植物光合略增益）
   *
   * 碳循环：
   *   动物/昆虫/微生物呼吸 → 产生 CO₂（消耗 O₂）
   *   植物光合作用 → 消耗 CO₂（释放 O₂）
   *   地质活动 → 缓慢释放 CO₂（基线补充）
   */
  co2Level: number;

  /**
   * 大气 O₂ 浓度（归一化值）
   * - 1.0 = 生态平衡态
   * - 0.0 = O₂ 耗尽（动物窒息）
   * - >1.0 = O₂ 富余
   *
   * 氧循环：
   *   植物光合作用 → 释放 O₂
   *   动物/昆虫/微生物呼吸 → 消耗 O₂
   */
  o2Level: number;

  /**
   * 有害气体浓度（归一化值）
   * - 0.0 = 无污染
   * - >0.3 = 开始影响生物健康
   * - >1.0 = 严重污染
   *
   * 来源：
   *   尸体腐烂 → 释放有害气体（硫化氢、氨气等）
   * 消除：
   *   食腐类物种消化尸体 → 减少有害气体排放
   *   自然消散 → 缓慢降低浓度
   */
  toxicGasLevel: number;

  constructor(config: WorldConfig) {
    this.config = config;
    this.organisms = [];
    this.grid = new SpatialGrid(config.width, config.height, 30);
    this.behavior = new BehaviorEngine(config.width, config.height);
    this.tick = 0;
    this.totalBirths = 0;
    this.totalDeaths = 0;
    this.deathStats = createEmptyDeathStats();
    this.corpses = [];
    this.eggs = [];
    this.speciesMap = new Map();
    this.nextSpeciesId = 1;

    // 创建 PRNG（种子已在 main.ts 中解析为实际值）
    const [, rng] = createRNG(config.seed);
    this.rng = rng;

    // TPS 归一化因子
    this.tickDt = BASE_TPS / config.ticksPerSecond;     // 例：3/10 = 0.3
    this.tpsRatio = config.ticksPerSecond / BASE_TPS;    // 例：10/3 ≈ 3.33

    this.disasterCooldown = Math.floor((500 + this.rng.next() * 500) * this.tpsRatio);
    this.co2Level = 1.0;
    this.o2Level = 1.0;
    this.toxicGasLevel = 0;
    this.dayTime = 0.3; // 从清晨开始（与渲染器同步）
  }

  /** 创建生命体并按 TPS 缩放其时间计数器 */
  private createOrganism(type: OrganismType, dna: number[], pos: { x: number; y: number; z: number }): Organism {
    const org = new Organism(type, dna, pos, this.rng);
    org.scaleTimers(this.tpsRatio);
    return org;
  }

  /** 初始化世界 */
  initialize(): void {
    const rng = this.rng;

    // 生成微生物
    for (let i = 0; i < this.config.initialMicrobes; i++) {
      const dna = createRandomDNA(OrganismType.Microbe, rng);
      const pos = {
        x: (rng.next() - 0.5) * this.config.width,
        y: 0,
        z: (rng.next() - 0.5) * this.config.height,
      };
      this.organisms.push(this.createOrganism(OrganismType.Microbe, dna, pos));
    }

    // 生成植物
    for (let i = 0; i < this.config.initialPlants; i++) {
      const dna = createRandomDNA(OrganismType.Plant, rng);
      const pos = {
        x: (rng.next() - 0.5) * this.config.width,
        y: 0,
        z: (rng.next() - 0.5) * this.config.height,
      };
      this.organisms.push(this.createOrganism(OrganismType.Plant, dna, pos));
    }

    // 生成昆虫
    for (let i = 0; i < this.config.initialInsects; i++) {
      const dna = createRandomDNA(OrganismType.Insect, rng);
      const pos = {
        x: (rng.next() - 0.5) * this.config.width,
        y: 0,
        z: (rng.next() - 0.5) * this.config.height,
      };
      this.organisms.push(this.createOrganism(OrganismType.Insect, dna, pos));
    }

    // 生成动物
    for (let i = 0; i < this.config.initialAnimals; i++) {
      const dna = createRandomDNA(OrganismType.Animal, rng);
      const pos = {
        x: (rng.next() - 0.5) * this.config.width,
        y: 0,
        z: (rng.next() - 0.5) * this.config.height,
      };
      this.organisms.push(this.createOrganism(OrganismType.Animal, dna, pos));
    }

    // 初始物种分类
    this.classifySpecies();
  }

  /** 执行一个 tick */
  step(): void {
    this.tick++;

    // 0. 更新昼夜时间
    // dayTime ∈ [0, 1)：0=午夜, ~0.26=日出, 0.5=正午, ~0.74=日落
    const dayTicks = World.DAY_DURATION * this.config.ticksPerSecond;
    this.dayTime = (0.3 + this.tick / dayTicks) % 1.0;

    // 光照水平 [0, 1]：0=深夜, 1=正午（平滑余弦曲线）
    const lightLevel = (1 + Math.sin((this.dayTime - 0.25) * Math.PI * 2)) / 2;

    // 1. 重建空间网格
    this.grid.rebuild(this.organisms);

    // 2. 计算每个生命体的局部密度
    this.updateLocalDensity();

    // 3. 更新大气 CO₂（碳循环）
    this.updateAtmosphere();

    // 4. 更新所有生命体行为
    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (!org.alive) continue;

      // 将大气浓度注入每个生命体（供 tick 中使用）
      org.co2Level = this.co2Level;
      org.o2Level = this.o2Level;
      org.toxicGasLevel = this.toxicGasLevel;

      // ---- 水域状态更新 ----
      const waterDepth = this.behavior.getWaterDepth(org.position.x, org.position.z);
      org.waterDepth = waterDepth;
      org.isInWater = waterDepth > 0.2;

      // 计算活跃度：昼行动物白天活跃，夜行动物夜间活跃
      // nocturnality=0 → activityLevel = lightLevel（白天活跃）
      // nocturnality=1 → activityLevel = 1-lightLevel（夜间活跃）
      if (org.type === OrganismType.Plant || org.type === OrganismType.Microbe) {
        org.activityLevel = 1.0; // 植物和微生物不受昼夜影响
      } else {
        const n = org.nocturnality;
        const raw = n * (1 - lightLevel) + (1 - n) * lightLevel;
        // 最低 0.15 —— 即使在"休息"时也保持微弱活动（可逃跑/被动反应）
        org.activityLevel = 0.15 + raw * 0.85;
      }

      // 行为决策（植物不需要行为决策）
      // 传入尸体列表供食腐行为使用
      this.behavior.update(org, this.grid, this.corpses, this.tickDt);

      // 生命体 tick（能量消耗、老化、多因素死亡检测）
      org.tick(this.tickDt);
    }

    // 5. 处理繁殖（受精 + 分娩/产卵）
    this.handleReproduction();

    // 5.5 处理蛋的孵化
    this.handleEggHatching();

    // 6. 自然生长（植物 + 微生物）
    this.growPlants();
    this.growMicrobes();

    // 7. 环境灾害检测
    this.checkEnvironmentalDisaster();

    // 8. 移除死亡个体（统计死因 + 生成尸体）
    this.removeDeadOrganisms();

    // 9. 更新尸体（腐烂 + 滋生腐生菌）
    this.updateCorpses();

    // 10. 定期重新分类物种（按 tpsRatio 缩放间隔）
    const classifyInterval = Math.max(10, Math.floor(50 * this.tpsRatio));
    if (this.tick % classifyInterval === 0) {
      this.classifySpecies();
    }
  }

  /**
   * 计算每个生命体周围的局部密度、同物种邻居数、物种垄断度
   *
   * 借鉴 Conway's Game of Life 的核心思想：
   * - 邻居数量直接影响存活（过多 = 过密致死）
   * - 当只有单一物种时，物种垄断度升高，过密压力放大
   */
  private updateLocalDensity(): void {
    // 密度归一化阈值
    const densityThreshold = 15;

    // ---- 计算各类型中每个 speciesId 的占比（全局物种垄断度）----
    const typeCount: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const speciesCount = new Map<string, number>(); // key = "type:speciesId"

    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (!org.alive) continue;
      typeCount[org.type]++;
      const key = `${org.type}:${org.speciesId}`;
      speciesCount.set(key, (speciesCount.get(key) || 0) + 1);
    }

    // 预计算每个 (type, speciesId) 在该 type 中的占比
    const speciesDominanceMap = new Map<string, number>();
    for (const [key, count] of speciesCount) {
      const type = parseInt(key.split(':')[0]);
      const total = typeCount[type];
      speciesDominanceMap.set(key, total > 0 ? count / total : 0);
    }

    // ---- 遍历每个生命体，计算局部指标 ----
    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (!org.alive) continue;

      const range = Math.max(15, org.senseRange * 0.5);
      const nearby = this.grid.queryRange(org.position.x, org.position.z, range);

      let sameTypeCount = 0;
      let sameSpeciesCount = 0;

      for (let j = 0; j < nearby.length; j++) {
        const other = nearby[j];
        if (other.id === org.id || !other.alive) continue;

        if (other.type === org.type) {
          sameTypeCount++;
          // 精确到同物种（同 speciesId）
          if (other.speciesId === org.speciesId) {
            sameSpeciesCount++;
          }
        }
      }

      // 归一化密度 [0, 1]（基于同类型邻居数）
      org.localDensity = Math.min(1.0, sameTypeCount / densityThreshold);

      // 同物种邻居的绝对数量（用于生命游戏规则判定）
      org.sameSpeciesNeighbors = sameSpeciesCount;

      // 该物种在全局同类型中的垄断度 [0, 1]
      const key = `${org.type}:${org.speciesId}`;
      org.speciesDominance = speciesDominanceMap.get(key) || 0;
    }
  }

  /**
   * 大气循环：CO₂ + O₂ + 有害气体
   *
   * 核心机制 —— 模拟真实生态中的气体循环：
   *
   * 【碳循环 CO₂】
   *   - 动物/昆虫/微生物通过呼吸作用产生 CO₂（消耗 O₂ + 有机物 → CO₂ + 能量）
   *   - 植物通过光合作用消耗 CO₂（CO₂ + 光 → 有机物 + O₂）
   *   - 地质活动（火山等）缓慢释放 CO₂，为生态提供基线补充
   *
   * 【氧循环 O₂】
   *   - 植物光合作用释放 O₂（光合作用越强释放越多）
   *   - 动物/昆虫/微生物呼吸消耗 O₂
   *   - O₂ 与 CO₂ 成互补关系
   *
   * 【有害气体】
   *   - 尸体腐烂释放有害气体（硫化氢 H₂S、氨气 NH₃ 等）
   *   - 食腐类物种消化尸体 → 减少尸体量 → 降低有害气体排放
   *   - 自然消散 → 有害气体缓慢降低
   *   - 植物对有害气体有微弱吸收作用
   *
   * 生态反馈环路：
   *   动物繁盛 → CO₂ 上升 + O₂ 下降 → 植物旺盛 → O₂ 恢复 → 生态平衡
   *   尸体堆积 → 有害气体上升 → 生物健康受损 → 食腐物种繁盛 → 分解尸体 → 有害气体降低
   */
  private updateAtmosphere(): void {
    let co2Production = 0;    // 本 tick CO₂ 总产生量
    let co2Consumption = 0;   // 本 tick CO₂ 总消耗量
    let o2Production = 0;     // 本 tick O₂ 总产生量
    let o2Consumption = 0;    // 本 tick O₂ 总消耗量
    let toxicProduction = 0;  // 本 tick 有害气体总产生量
    let toxicAbsorption = 0;  // 本 tick 有害气体总吸收量

    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (!org.alive) continue;

      if (org.type === OrganismType.Plant) {
        // 植物消耗 CO₂ 进行光合作用，同时释放 O₂
        const photoRate = (0.5 + org.size * 0.3) * Math.min(1.5, this.co2Level);
        co2Consumption += photoRate;
        o2Production += photoRate * 0.9;  // 光合作用释放 O₂（与 CO₂ 消耗近似等量）
        // 植物对有害气体有微弱的吸收净化作用
        toxicAbsorption += org.size * 0.02;
      } else {
        // 非植物通过呼吸产生 CO₂、消耗 O₂
        // 微生物个体产出极少但群体量大，动物个体产出最多
        let breathRate: number;
        if (org.type === OrganismType.Microbe) {
          breathRate = org.metabolism * 0.08 + 0.02;   // 微生物：个体呼吸极少
        } else if (org.type === OrganismType.Insect) {
          breathRate = org.metabolism * 0.3 + org.size * 0.1; // 昆虫：中等
        } else {
          breathRate = org.metabolism * 0.5 + org.size * 0.2; // 动物：最多
        }
        co2Production += breathRate;
        o2Consumption += breathRate * 0.85; // 呼吸消耗 O₂（略低于 CO₂ 产量）
      }
    }

    // ---- 尸体腐烂产生有害气体 ----
    for (const corpse of this.corpses) {
      const decayProgress = 1 - corpse.decayTimer / corpse.maxDecayTime;
      // 腐烂中期释放有害气体最多（刚死不太多，快完全分解也少了）
      // 钟形曲线：在 decayProgress ≈ 0.4 时达到峰值
      const decayCurve = Math.sin(decayProgress * Math.PI);
      const toxicRate = corpse.size * 0.15 * decayCurve;
      toxicProduction += toxicRate;
      // 尸体腐烂也会释放少量 CO₂
      co2Production += corpse.size * 0.03 * decayCurve;
    }

    // 地质活动释放 CO₂（火山、地热等）—— 缓慢的基线补充
    // 确保即使所有生物灭绝 CO₂ 也能极缓慢恢复
    const geologicalRelease = 1.0;

    // ---- CO₂ 变化（乘 tickDt 归一化） ----
    const scaleFactor = 0.00008 * this.tickDt;
    const co2Delta = (co2Production + geologicalRelease - co2Consumption) * scaleFactor;
    this.co2Level += co2Delta;
    this.co2Level = Math.max(0, Math.min(3.0, this.co2Level));

    // ---- O₂ 变化 ----
    const o2Baseline = 0.5;
    const o2Delta = (o2Production + o2Baseline - o2Consumption) * scaleFactor;
    this.o2Level += o2Delta;
    this.o2Level = Math.max(0, Math.min(3.0, this.o2Level));

    // ---- 有害气体变化 ----
    const naturalDissipation = this.toxicGasLevel * 0.02;
    const toxicScaleFactor = 0.0003 * this.tickDt;
    const toxicDelta = (toxicProduction - toxicAbsorption) * toxicScaleFactor - naturalDissipation * 0.001 * this.tickDt;
    this.toxicGasLevel += toxicDelta;
    this.toxicGasLevel = Math.max(0, Math.min(3.0, this.toxicGasLevel));
  }

  /**
   * 环境灾害事件
   * 以一定概率在某个区域触发，影响范围内所有生命体
   */
  private checkEnvironmentalDisaster(): void {
    this.disasterCooldown--;
    if (this.disasterCooldown > 0) return;

    // 重置冷却（基于 tpsRatio 缩放，保持真实时间不变）
    this.disasterCooldown = Math.floor((600 + this.rng.next() * 900) * this.tpsRatio);

    // 随机选择灾害类型
    const disasterType = this.rng.next();

    if (disasterType < 0.4) {
      // 局部干旱 —— 某个区域的植物大量死亡
      const cx = (this.rng.next() - 0.5) * this.config.width;
      const cz = (this.rng.next() - 0.5) * this.config.height;
      const radius = 30 + this.rng.next() * 50;

      const affected = this.grid.queryRange(cx, cz, radius);
      for (const org of affected) {
        if (!org.alive) continue;
        if (org.type === OrganismType.Plant) {
          // 植物受旱灾影响最大
          if (this.rng.next() < 0.4) {
            org.die(DeathCause.Environmental);
          }
        } else if (org.type === OrganismType.Microbe) {
          // 微生物也受干旱影响（依赖湿度）
          if (this.rng.next() < 0.3) {
            org.die(DeathCause.Environmental);
          }
        } else {
          // 其他生命体能量受损
          org.energy -= 10 + this.rng.next() * 10;
        }
      }
    } else if (disasterType < 0.7) {
      // 瘟疫 —— 高密度区域的生命体受疾病影响（微生物活跃导致）
      for (let i = 0; i < this.organisms.length; i++) {
        const org = this.organisms[i];
        if (!org.alive) continue;
        if (org.localDensity > 0.4) {
          const plagueChance = org.localDensity * 0.08;
          if (this.rng.next() < plagueChance) {
            org.health -= 0.3;
            if (org.health <= 0) {
              org.die(DeathCause.Disease);
            }
          }
        }
      }
    } else {
      // 寒潮 —— 所有生命体能量轻微受损，小体型更脆弱
      for (let i = 0; i < this.organisms.length; i++) {
        const org = this.organisms[i];
        if (!org.alive) continue;
        // 体型越小越受影响
        const vulnerability = Math.max(0, 1.5 - org.size);
        const energyLoss = vulnerability * (3 + this.rng.next() * 3);
        org.energy -= energyLoss;
        // 极端情况直接冻死（微生物和小体型最脆弱）
        if (org.size < 0.5 && this.rng.next() < 0.05) {
          org.die(DeathCause.Environmental);
        }
      }
    }
  }

  /**
   * 处理繁殖
   *
   * 繁殖机制：
   * - 微生物/植物：无性繁殖（分裂/种子传播）
   * - 昆虫/动物：有性繁殖
   *   1. 发情期雌性释放信息素/求偶信号 → 吸引同种雄性
   *   2. 雄性检测到信号 → 靠近 → 受精
   *   3. 受精后：
   *      - 哺乳动物（Animal）：怀孕 → 妊娠期 → 分娩（活产）
   *      - 非哺乳动物（Insect）：短妊娠 → 产卵 → 蛋孵化
   */
  private handleReproduction(): void {
    const newborns: Organism[] = [];

    // ---- 第一阶段：处理受精（雄性 + 发情雌性） ----
    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (!org.alive) continue;

      // 只有雄性在此阶段参与
      if (org.gender !== Gender.Male || !org.canMate()) continue;

      // 寻找附近同类发情雌性（使用交配信号范围，模拟信息素/声音传播）
      const searchRange = org.isEmittingMatingSignal ? org.matingSignalRange : org.senseRange;
      const female = this.grid.queryNearest(
        org.position.x,
        org.position.z,
        searchRange,
        (other) =>
          other.id !== org.id &&
          other.alive &&
          other.type === org.type &&
          other.gender === Gender.Female &&
          other.isInEstrus &&
          !other.isFertilized
      );

      if (female) {
        const dist = Math.sqrt(
          (org.position.x - female.position.x) ** 2 +
          (org.position.z - female.position.z) ** 2
        );
        if (dist < org.size + female.size + 3) {
          // 受精成功
          female.isFertilized = true;
          const gestMax = Math.floor(female.gestationPeriod * this.tpsRatio);
          female.gestationTimer = gestMax;
          (female as any)._gestationMax = gestMax; // 用于计算怀孕进度
          female.estrusRemaining = 0; // 受精后发情期结束
          // 保存父本 DNA 到子代用（存储在一个临时属性中）
          (female as any)._mateDna = org.dna;

          // 交配能量消耗
          org.energy -= org.reproThreshold * 0.15;
          const cooldown = org.type === OrganismType.Insect
            ? Math.floor(100 * this.tpsRatio)
            : Math.floor(500 * this.tpsRatio);
          org.reproductionCooldown = cooldown;
        }
      }
    }

    // ---- 第二阶段：处理无性繁殖 + 有性繁殖（分娩/产卵） ----
    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (!org.alive) continue;

      if (org.type === OrganismType.Plant || org.type === OrganismType.Microbe) {
        // 微生物/植物：无性繁殖
        if (!org.canReproduce()) continue;

        const childDNA = asexualReproduce(org.dna, this.rng);
        const offset = org.type === OrganismType.Microbe ? 0.5 + this.rng.next() * 2 : 3 + this.rng.next() * 5;
        const angle = this.rng.next() * Math.PI * 2;
        const pos = {
          x: org.position.x + Math.cos(angle) * offset,
          y: 0,
          z: org.position.z + Math.sin(angle) * offset,
        };
        const halfW = this.config.width / 2;
        const halfH = this.config.height / 2;
        if (pos.x >= -halfW && pos.x <= halfW && pos.z >= -halfH && pos.z <= halfH) {
          const child = this.createOrganism(org.type, childDNA, pos);
          child.speciesId = org.speciesId;
          newborns.push(child);
          const reproCost = org.type === OrganismType.Microbe ? 0.35 : 0.45;
          org.energy -= org.reproThreshold * reproCost;
          org.reproductionCooldown = Math.floor(
            (org.type === OrganismType.Microbe ? 25 : 80) * this.tpsRatio
          );
          this.totalBirths++;
        }
      } else if (org.gender === Gender.Female && org.canReproduce()) {
        // 雌性妊娠完成 → 分娩或产卵
        const mateDna = (org as any)._mateDna as number[] | undefined;
        if (!mateDna) continue; // 没有受精过，跳过

        const childDNA = crossoverAndMutate(org.dna, mateDna, this.rng);

        if (org.type === OrganismType.Animal) {
          // ---- 哺乳动物：活产（直接分娩） ----
          const offset = 2 + this.rng.next() * 3;
          const angle = this.rng.next() * Math.PI * 2;
          const pos = {
            x: org.position.x + Math.cos(angle) * offset,
            y: 0,
            z: org.position.z + Math.sin(angle) * offset,
          };
          const halfW = this.config.width / 2;
          const halfH = this.config.height / 2;
          if (pos.x >= -halfW && pos.x <= halfW && pos.z >= -halfH && pos.z <= halfH) {
            const child = this.createOrganism(org.type, childDNA, pos);
            child.speciesId = org.speciesId;
            newborns.push(child);
            org.energy -= org.reproThreshold * 0.45;
            org.reproductionCooldown = Math.floor(500 * this.tpsRatio);
            this.totalBirths++;
          }
        } else {
          // ---- 昆虫等非哺乳动物：产卵 ----
          const eggCount = 1 + Math.floor(this.rng.next() * 2); // 产 1~2 枚蛋
          for (let e = 0; e < eggCount; e++) {
            const offset = 1 + this.rng.next() * 2;
            const angle = this.rng.next() * Math.PI * 2;
            const eggPos = {
              x: org.position.x + Math.cos(angle) * offset,
              y: 0,
              z: org.position.z + Math.sin(angle) * offset,
            };
            const halfW = this.config.width / 2;
            const halfH = this.config.height / 2;
            if (eggPos.x >= -halfW && eggPos.x <= halfW && eggPos.z >= -halfH && eggPos.z <= halfH) {
              // 为每个蛋生成独立子代 DNA（同一窝蛋有微小差异）
              const eggDNA = e === 0 ? childDNA : crossoverAndMutate(org.dna, mateDna, this.rng);
              const hatchTime = Math.floor((80 + this.rng.next() * 40) * this.tpsRatio); // 约 80~120 基准 tick
              this.eggs.push({
                id: nextEggId++,
                type: org.type,
                position: eggPos,
                size: org.size * 0.3,
                dna: eggDNA,
                speciesId: org.speciesId,
                hatchTimer: hatchTime,
                maxHatchTime: hatchTime,
                health: 1.0,
              });
            }
          }
          org.energy -= org.reproThreshold * 0.3;
          org.reproductionCooldown = Math.floor(100 * this.tpsRatio);
        }

        // 清除父本 DNA 和妊娠记录
        delete (org as any)._mateDna;
        delete (org as any)._gestationMax;
      }
    }

    // 添加新生命体
    for (const child of newborns) {
      this.organisms.push(child);
    }
  }

  /**
   * 处理蛋的孵化
   * - 蛋是静态对象，放在世界中等待孵化
   * - 到期后孵化出新个体
   * - 蛋可以被天敌吃掉（在 handlePredation 中处理）
   */
  private handleEggHatching(): void {
    const newborns: Organism[] = [];
    const survivingEggs: Egg[] = [];

    for (const egg of this.eggs) {
      egg.hatchTimer--;

      if (egg.health <= 0) {
        // 蛋被吃掉了，不孵化
        continue;
      }

      if (egg.hatchTimer <= 0) {
        // 孵化成功：创建新生命体
        const child = this.createOrganism(egg.type, egg.dna, egg.position);
        child.speciesId = egg.speciesId;
        newborns.push(child);
        this.totalBirths++;
      } else {
        // 继续孵化
        survivingEggs.push(egg);
      }
    }

    this.eggs = survivingEggs;

    for (const child of newborns) {
      this.organisms.push(child);
    }
  }

  /** 植物自动生长（受 CO₂ 浓度影响） */
  private growPlants(): void {
    const plantCount = this.organisms.filter(
      (o) => o.alive && o.type === OrganismType.Plant
    ).length;

    if (plantCount < this.config.maxPlants) {
      // CO₂ 不足时植物生长速率降低（乘 tickDt 归一化）
      const co2GrowthFactor = Math.min(1.2, this.co2Level);
      const effectiveGrowthRate = Math.max(1,
        Math.floor(this.config.plantGrowthRate * co2GrowthFactor * this.tickDt)
      );

      const growCount = Math.min(
        effectiveGrowthRate,
        this.config.maxPlants - plantCount
      );
      for (let i = 0; i < growCount; i++) {
        const dna = createRandomDNA(OrganismType.Plant, this.rng);
        const pos = {
          x: (this.rng.next() - 0.5) * this.config.width,
          y: 0,
          z: (this.rng.next() - 0.5) * this.config.height,
        };
        const plant = this.createOrganism(OrganismType.Plant, dna, pos);
        plant.speciesId = 0;
        this.organisms.push(plant);
      }
    }
  }

  /** 微生物自动生长（从环境中自然产生） */
  private growMicrobes(): void {
    const microbeCount = this.organisms.filter(
      (o) => o.alive && o.type === OrganismType.Microbe
    ).length;

    if (microbeCount < this.config.maxMicrobes) {
      const growCount = Math.min(
        Math.max(1, Math.floor(this.config.microbeGrowthRate * this.tickDt)),
        this.config.maxMicrobes - microbeCount
      );
      for (let i = 0; i < growCount; i++) {
        const dna = createRandomDNA(OrganismType.Microbe, this.rng);
        const pos = {
          x: (this.rng.next() - 0.5) * this.config.width,
          y: 0,
          z: (this.rng.next() - 0.5) * this.config.height,
        };
        const microbe = this.createOrganism(OrganismType.Microbe, dna, pos);
        microbe.speciesId = 0;
        this.organisms.push(microbe);
      }
    }
  }

  /** 移除死亡个体，按死因分类统计，动物/昆虫死后留下尸体 */
  private removeDeadOrganisms(): void {
    const alive: Organism[] = [];

    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (org.alive) {
        alive.push(org);
      } else {
        // 按死因分类统计
        this.totalDeaths++;
        this.deathStats.total++;
        switch (org.causeOfDeath) {
          case DeathCause.Starvation:
            this.deathStats.starvation++;
            break;
          case DeathCause.OldAge:
            this.deathStats.oldAge++;
            break;
          case DeathCause.Predation:
            this.deathStats.predation++;
            break;
          case DeathCause.Overcrowding:
            this.deathStats.overcrowding++;
            break;
          case DeathCause.Disease:
            this.deathStats.disease++;
            break;
          case DeathCause.Environmental:
            this.deathStats.environmental++;
            break;
          default:
            this.deathStats.starvation++;
            break;
        }

        // 动物和昆虫死后留下尸体（捕食致死的猎物被吃掉，不留尸体）
        if ((org.type === OrganismType.Animal || org.type === OrganismType.Insect)
            && org.causeOfDeath !== DeathCause.Predation) {
          // 腐烂时间与体型成正比（乘 tpsRatio 保持真实时间不变）
          const decayTime = org.type === OrganismType.Animal
            ? Math.floor((300 + org.size * 150) * this.tpsRatio)
            : Math.floor((150 + org.size * 80) * this.tpsRatio);
          this.corpses.push({
            id: nextCorpseId++,
            type: org.type,
            position: { ...org.position },
            size: org.size,
            dna: org.dna,
            remainingEnergy: org.size * 15 + 10,
            decayTimer: decayTime,
            maxDecayTime: decayTime,
            speciesId: org.speciesId,
            facing: org.facing,
          });
        }
      }
    }

    this.organisms = alive;
  }

  /**
   * 更新尸体：腐烂 + 滋生腐生菌
   *
   * 生态学意义：
   * - 尸体是营养物质循环的关键环节
   * - 腐生菌（分解者微生物）分解尸体获取能量
   * - 分解产生的 CO₂ 促进植物生长 → 完成碳循环
   */
  private updateCorpses(): void {
    const remainingCorpses: Corpse[] = [];

    for (const corpse of this.corpses) {
      corpse.decayTimer--;

      // 附近微生物从尸体获取能量（分解作用，乘 tickDt 归一化）
      const nearbyMicrobes = this.grid.queryRange(
        corpse.position.x, corpse.position.z, 15
      );
      for (const org of nearbyMicrobes) {
        if (!org.alive || org.type !== OrganismType.Microbe) continue;
        const decomposeFactor = org.dietType > 0.5 ? 0.12 : 0.04;
        const energyGain = decomposeFactor * (1 + org.metabolism) * this.tickDt;
        if (corpse.remainingEnergy > energyGain) {
          org.energy += energyGain;
          org.satiety = Math.min(1.0, org.satiety + 0.02 * this.tickDt);
          corpse.remainingEnergy -= energyGain;
        }
      }

      // 自然腐烂也消耗尸体能量
      corpse.remainingEnergy -= 0.05 * this.tickDt;

      // 每隔一段时间在尸体附近自动滋生腐生菌
      const decayProgress = 1 - corpse.decayTimer / corpse.maxDecayTime;
      if (decayProgress > 0.1 && decayProgress < 0.8 && this.rng.next() < 0.02 * this.tickDt) {
        const microbeCount = this.organisms.filter(
          o => o.alive && o.type === OrganismType.Microbe
        ).length;
        if (microbeCount < this.config.maxMicrobes) {
          const dna = createRandomDNA(OrganismType.Microbe, this.rng);
          // 倾向生成腐生菌（高 dietType，低攻击性）
          dna[5] = 0.08 + this.rng.next() * 0.1;  // 低代谢
          dna[9] = 0.7 + this.rng.next() * 0.3;   // 高 dietType（腐生性）
          dna[7] = this.rng.next() * 0.2;          // 低攻击倾向
          const angle = this.rng.next() * Math.PI * 2;
          const dist = this.rng.next() * 5;
          const pos = {
            x: corpse.position.x + Math.cos(angle) * dist,
            y: 0,
            z: corpse.position.z + Math.sin(angle) * dist,
          };
          const microbe = this.createOrganism(OrganismType.Microbe, dna, pos);
          microbe.speciesId = 0;
          this.organisms.push(microbe);
        }
      }

      // 尸体还没完全腐烂就保留
      if (corpse.decayTimer > 0 && corpse.remainingEnergy > 0) {
        remainingCorpses.push(corpse);
      }
    }

    this.corpses = remainingCorpses;
  }

  /**
   * 基于 DNA 相似度的物种分类
   * 分别对每种类型进行聚类（包括微生物）
   * 为每个物种计算生态角色标签
   */
  private classifySpecies(): void {
    this.speciesMap.clear();

    // 对非植物的所有类型进行分类（微生物、昆虫、动物）
    // 植物也参与分类，但分类阈值不同
    const byType = new Map<OrganismType, Organism[]>();
    for (const org of this.organisms) {
      if (!org.alive) continue;
      const list = byType.get(org.type) || [];
      list.push(org);
      byType.set(org.type, list);
    }

    // 使用代表个体做简单分类
    const representatives: { id: number; dna: number[]; type: OrganismType }[] = [];

    for (const [type, orgs] of byType) {
      // 植物的相似度阈值可以低一些（变异不大）
      const similarityThreshold = type === OrganismType.Plant ? 0.8 :
                                   type === OrganismType.Microbe ? 0.75 : 0.7;

      for (const org of orgs) {
        let assigned = false;
        for (const rep of representatives) {
          if (rep.type === type && dnaSimilarity(org.dna, rep.dna) > similarityThreshold) {
            org.speciesId = rep.id;
            assigned = true;
            break;
          }
        }
        if (!assigned) {
          const speciesId = this.nextSpeciesId++;
          representatives.push({ id: speciesId, dna: [...org.dna], type });
          org.speciesId = speciesId;
        }
      }
    }

    // 统计各物种信息
    for (const org of this.organisms) {
      if (!org.alive) continue;
      const sid = org.speciesId;
      let info = this.speciesMap.get(sid);
      if (!info) {
        info = {
          id: sid,
          type: org.type,
          count: 0,
          avgDna: new Array(org.dna.length).fill(0),
          color: this.speciesColor(sid, org.type),
          label: '', // 稍后根据平均 DNA 计算
        };
        this.speciesMap.set(sid, info);
      }
      info.count++;
      for (let i = 0; i < org.dna.length; i++) {
        info.avgDna[i] += org.dna[i];
      }
    }

    // 计算平均 DNA 并生成物种角色标签
    for (const info of this.speciesMap.values()) {
      for (let i = 0; i < info.avgDna.length; i++) {
        info.avgDna[i] /= info.count;
      }
      // 根据平均 DNA 推导生态角色标签
      info.label = getSubSpeciesLabel(info.type, info.avgDna);
    }
  }

  /** 根据物种 ID 和类型生成颜色 */
  private speciesColor(id: number, type: OrganismType): [number, number, number] {
    switch (type) {
      case OrganismType.Microbe: {
        // 微生物用浅蓝/青色系
        const hue = (id * 97.32 + 170) % 360;
        return this.hslToRgb(hue / 360, 0.5, 0.6);
      }
      case OrganismType.Plant:
        return [0.2, 0.7, 0.2];
      case OrganismType.Insect: {
        const hue = (id * 137.508) % 360;
        return this.hslToRgb(hue / 360, 0.7, 0.5);
      }
      case OrganismType.Animal: {
        const hue = (id * 97.32 + 30) % 360;
        return this.hslToRgb(hue / 360, 0.8, 0.45);
      }
    }
  }

  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    let r: number, g: number, b: number;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [r, g, b];
  }

  /** 生成渲染帧数据 */
  getFrameData(): RenderFrameData {
    const renderData: OrganismRenderData[] = [];
    let microbeCount = 0;
    let plantCount = 0;
    let insectCount = 0;
    let animalCount = 0;

    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (!org.alive) continue;

      switch (org.type) {
        case OrganismType.Microbe: microbeCount++; break;
        case OrganismType.Plant: plantCount++; break;
        case OrganismType.Insect: insectCount++; break;
        case OrganismType.Animal: animalCount++; break;
      }

      renderData.push({
        id: org.id,
        type: org.type,
        x: org.position.x,
        y: org.position.y,
        z: org.position.z,
        size: org.size,
        energy: org.energy,
        speciesId: org.speciesId,
        dna: org.dna,
        age: org.age,
        maxAge: org.maxAge,
        health: org.health,
        gender: org.gender,
        satiety: org.satiety,
        isInEstrus: org.isInEstrus,
        facing: org.facing,
        isCorpse: false,
        decayProgress: 0,
        isEmittingMatingSignal: org.isEmittingMatingSignal,
        isPregnant: org.isPregnant,
        pregnancyProgress: org.pregnancyProgress,
      });
    }

    // 将尸体也加入渲染数据（尸体不移动，facing 固定）
    for (const corpse of this.corpses) {
      renderData.push({
        id: corpse.id,
        type: corpse.type,
        x: corpse.position.x,
        y: corpse.position.y,
        z: corpse.position.z,
        size: corpse.size,
        energy: corpse.remainingEnergy,
        speciesId: corpse.speciesId,
        dna: corpse.dna,
        age: 0,
        maxAge: 0,
        health: 0,
        gender: Gender.None,
        satiety: 0,
        isInEstrus: false,
        facing: corpse.facing ?? 0,
        isCorpse: true,
        decayProgress: 1 - corpse.decayTimer / corpse.maxDecayTime,
        isEmittingMatingSignal: false,
        isPregnant: false,
        pregnancyProgress: 0,
      });
    }

    // 蛋的渲染数据
    const eggRenderData = this.eggs.map(egg => ({
      id: egg.id,
      x: egg.position.x,
      y: egg.position.y,
      z: egg.position.z,
      size: egg.size,
      speciesId: egg.speciesId,
      type: egg.type,
      hatchProgress: 1 - egg.hatchTimer / egg.maxHatchTime,
      dna: egg.dna,
    }));

    const speciesList = Array.from(this.speciesMap.values())
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15); // 显示更多物种

    return {
      tick: this.tick,
      organisms: renderData,
      eggs: eggRenderData,
      stats: {
        tick: this.tick,
        totalOrganisms: renderData.length,
        microbeCount,
        plantCount,
        insectCount,
        animalCount,
        births: this.totalBirths,
        deaths: this.totalDeaths,
        deathStats: { ...this.deathStats },
        speciesCount: this.speciesMap.size,
        speciesList,
        co2Level: Math.round(this.co2Level * 1000) / 1000, // 保留3位小数
        o2Level: Math.round(this.o2Level * 1000) / 1000,
        toxicGasLevel: Math.round(this.toxicGasLevel * 1000) / 1000,
        dayTime: Math.round(this.dayTime * 1000) / 1000,
      },
    };
  }
}
