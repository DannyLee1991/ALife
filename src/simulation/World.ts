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
  createEmptyDeathStats,
  getSubSpeciesLabel,
} from '../types';
import { Organism } from './Organism';
import { createRandomDNA, crossoverAndMutate, asexualReproduce, dnaSimilarity } from './DNA';
import { SpatialGrid } from './SpatialGrid';
import { BehaviorEngine } from './Behavior';

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

  private speciesMap: Map<number, SpeciesInfo>;
  private nextSpeciesId: number;

  /** 环境灾害冷却（每隔一段时间可能触发） */
  private disasterCooldown: number;

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
   *   动物/昆虫/微生物呼吸 → 产生 CO₂
   *   植物光合作用 → 消耗 CO₂
   *   地质活动 → 缓慢释放 CO₂（基线补充）
   */
  co2Level: number;

  constructor(config: WorldConfig) {
    this.config = config;
    this.organisms = [];
    this.grid = new SpatialGrid(config.width, config.height, 30);
    this.behavior = new BehaviorEngine(config.width, config.height);
    this.tick = 0;
    this.totalBirths = 0;
    this.totalDeaths = 0;
    this.deathStats = createEmptyDeathStats();
    this.speciesMap = new Map();
    this.nextSpeciesId = 1;
    this.disasterCooldown = 500 + Math.floor(Math.random() * 500);
    this.co2Level = 1.0;
    this.dayTime = 0.3; // 从清晨开始（与渲染器同步）
  }

  /** 初始化世界 */
  initialize(): void {
    // 生成微生物
    for (let i = 0; i < this.config.initialMicrobes; i++) {
      const dna = createRandomDNA(OrganismType.Microbe);
      const pos = {
        x: (Math.random() - 0.5) * this.config.width,
        y: 0,
        z: (Math.random() - 0.5) * this.config.height,
      };
      this.organisms.push(new Organism(OrganismType.Microbe, dna, pos));
    }

    // 生成植物
    for (let i = 0; i < this.config.initialPlants; i++) {
      const dna = createRandomDNA(OrganismType.Plant);
      const pos = {
        x: (Math.random() - 0.5) * this.config.width,
        y: 0,
        z: (Math.random() - 0.5) * this.config.height,
      };
      this.organisms.push(new Organism(OrganismType.Plant, dna, pos));
    }

    // 生成昆虫
    for (let i = 0; i < this.config.initialInsects; i++) {
      const dna = createRandomDNA(OrganismType.Insect);
      const pos = {
        x: (Math.random() - 0.5) * this.config.width,
        y: 0,
        z: (Math.random() - 0.5) * this.config.height,
      };
      this.organisms.push(new Organism(OrganismType.Insect, dna, pos));
    }

    // 生成动物
    for (let i = 0; i < this.config.initialAnimals; i++) {
      const dna = createRandomDNA(OrganismType.Animal);
      const pos = {
        x: (Math.random() - 0.5) * this.config.width,
        y: 0,
        z: (Math.random() - 0.5) * this.config.height,
      };
      this.organisms.push(new Organism(OrganismType.Animal, dna, pos));
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

      // 将大气 CO₂ 浓度注入每个生命体（供 tick 中光合作用使用）
      org.co2Level = this.co2Level;

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
      this.behavior.update(org, this.grid);

      // 生命体 tick（能量消耗、老化、多因素死亡检测）
      org.tick();
    }

    // 5. 处理繁殖
    this.handleReproduction();

    // 6. 自然生长（植物 + 微生物）
    this.growPlants();
    this.growMicrobes();

    // 7. 环境灾害检测
    this.checkEnvironmentalDisaster();

    // 8. 移除死亡个体（统计死因）
    this.removeDeadOrganisms();

    // 9. 每 50 tick 重新分类物种
    if (this.tick % 50 === 0) {
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
   * 大气 CO₂ 碳循环
   *
   * 核心机制 —— 模拟真实生态中的碳循环：
   *   - 动物/昆虫/微生物通过呼吸作用产生 CO₂（消耗 O₂ + 有机物 → CO₂ + 能量）
   *   - 植物通过光合作用消耗 CO₂（CO₂ + 光 → 有机物 + O₂）
   *   - 地质活动（火山等）缓慢释放 CO₂，为生态提供基线补充
   *
   * 生态反馈环路：
   *   动物繁盛 → CO₂ 上升 → 植物旺盛 → 食物充足 → 生态平衡
   *   动物灭绝 → CO₂ 枯竭 → 植物无法光合 → 植物也死亡 → 生态崩溃
   *   植物过多 → CO₂ 被大量消耗 → CO₂ 下降 → 植物生长减缓 → 自我调节
   */
  private updateAtmosphere(): void {
    let co2Production = 0;   // 本 tick CO₂ 总产生量
    let co2Consumption = 0;  // 本 tick CO₂ 总消耗量

    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (!org.alive) continue;

      if (org.type === OrganismType.Plant) {
        // 植物消耗 CO₂ 进行光合作用
        co2Consumption += (0.5 + org.size * 0.3) * Math.min(1.5, this.co2Level);
      } else {
        // 非植物通过呼吸产生 CO₂
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
      }
    }

    // 地质活动释放 CO₂（火山、地热等）—— 缓慢的基线补充
    // 确保即使所有生物灭绝 CO₂ 也能极缓慢恢复
    const geologicalRelease = 1.0;

    // CO₂ 变化量 = (呼吸产生 + 地质释放 - 光合消耗) × 缩放因子
    // 缩放因子控制 CO₂ 变化速度，值越小变化越平缓
    const scaleFactor = 0.00008;
    const co2Delta = (co2Production + geologicalRelease - co2Consumption) * scaleFactor;

    this.co2Level += co2Delta;

    // 限制在合理范围 [0, 3.0]
    this.co2Level = Math.max(0, Math.min(3.0, this.co2Level));
  }

  /**
   * 环境灾害事件
   * 以一定概率在某个区域触发，影响范围内所有生命体
   */
  private checkEnvironmentalDisaster(): void {
    this.disasterCooldown--;
    if (this.disasterCooldown > 0) return;

    // 重置冷却（600~1500 tick 之间随机触发下一次）
    this.disasterCooldown = 600 + Math.floor(Math.random() * 900);

    // 随机选择灾害类型
    const disasterType = Math.random();

    if (disasterType < 0.4) {
      // 局部干旱 —— 某个区域的植物大量死亡
      const cx = (Math.random() - 0.5) * this.config.width;
      const cz = (Math.random() - 0.5) * this.config.height;
      const radius = 30 + Math.random() * 50;

      const affected = this.grid.queryRange(cx, cz, radius);
      for (const org of affected) {
        if (!org.alive) continue;
        if (org.type === OrganismType.Plant) {
          // 植物受旱灾影响最大
          if (Math.random() < 0.4) {
            org.die(DeathCause.Environmental);
          }
        } else if (org.type === OrganismType.Microbe) {
          // 微生物也受干旱影响（依赖湿度）
          if (Math.random() < 0.3) {
            org.die(DeathCause.Environmental);
          }
        } else {
          // 其他生命体能量受损
          org.energy -= 10 + Math.random() * 10;
        }
      }
    } else if (disasterType < 0.7) {
      // 瘟疫 —— 高密度区域的生命体受疾病影响（微生物活跃导致）
      for (let i = 0; i < this.organisms.length; i++) {
        const org = this.organisms[i];
        if (!org.alive) continue;
        if (org.localDensity > 0.4) {
          const plagueChance = org.localDensity * 0.08;
          if (Math.random() < plagueChance) {
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
        const energyLoss = vulnerability * (3 + Math.random() * 3);
        org.energy -= energyLoss;
        // 极端情况直接冻死（微生物和小体型最脆弱）
        if (org.size < 0.5 && Math.random() < 0.05) {
          org.die(DeathCause.Environmental);
        }
      }
    }
  }

  /** 处理繁殖 */
  private handleReproduction(): void {
    const newborns: Organism[] = [];

    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (!org.alive || !org.canReproduce()) continue;

      if (org.type === OrganismType.Plant || org.type === OrganismType.Microbe) {
        // 植物和微生物无性繁殖（分裂/种子传播）
        const childDNA = asexualReproduce(org.dna);
        // 微生物分裂距离近，植物种子传播远
        const offset = org.type === OrganismType.Microbe ? 0.5 + Math.random() * 2 : 3 + Math.random() * 5;
        const angle = Math.random() * Math.PI * 2;
        const pos = {
          x: org.position.x + Math.cos(angle) * offset,
          y: 0,
          z: org.position.z + Math.sin(angle) * offset,
        };
        const halfW = this.config.width / 2;
        const halfH = this.config.height / 2;
        if (pos.x >= -halfW && pos.x <= halfW && pos.z >= -halfH && pos.z <= halfH) {
          const child = new Organism(org.type, childDNA, pos);
          child.speciesId = org.speciesId;
          newborns.push(child);
          // 微生物分裂消耗少，植物种子消耗稍多
          const reproCost = org.type === OrganismType.Microbe ? 0.35 : 0.45;
          org.energy -= org.reproThreshold * reproCost;
          // 微生物分裂极快（~1秒），植物较慢
          org.reproductionCooldown = org.type === OrganismType.Microbe ? 25 : 80;
          this.totalBirths++;
        }
      } else {
        // 有性繁殖 - 寻找附近同类配偶
        const mate = this.grid.queryNearest(
          org.position.x,
          org.position.z,
          org.senseRange,
          (other) =>
            other.id !== org.id &&
            other.alive &&
            other.type === org.type &&
            other.canReproduce()
        );

        if (mate) {
          const dist = Math.sqrt(
            (org.position.x - mate.position.x) ** 2 +
            (org.position.z - mate.position.z) ** 2
          );
          if (dist < org.size + mate.size + 3) {
            const childDNA = crossoverAndMutate(org.dna, mate.dna);
            const pos = {
              x: (org.position.x + mate.position.x) / 2 + (Math.random() - 0.5) * 3,
              y: 0,
              z: (org.position.z + mate.position.z) / 2 + (Math.random() - 0.5) * 3,
            };
            const child = new Organism(org.type, childDNA, pos);
            child.speciesId = org.speciesId;
            newborns.push(child);

            // 昆虫繁殖消耗较少（产卵），动物较多（妊娠/哺乳）
            const reproCost = org.type === OrganismType.Insect ? 0.3 : 0.45;
            org.energy -= org.reproThreshold * reproCost;
            mate.energy -= mate.reproThreshold * reproCost;
            // 昆虫繁殖冷却较短（~4秒），动物很长（~17秒）
            const cooldown = org.type === OrganismType.Insect ? 100 : 500;
            org.reproductionCooldown = cooldown;
            mate.reproductionCooldown = cooldown;
            this.totalBirths++;
          }
        }
      }
    }

    // 添加新生命体
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
      // CO₂ 不足时植物生长速率降低：co2=0 → 不生长，co2=1 → 正常，co2>1 → 略快
      const co2GrowthFactor = Math.min(1.2, this.co2Level);
      const effectiveGrowthRate = Math.floor(this.config.plantGrowthRate * co2GrowthFactor);

      const growCount = Math.min(
        effectiveGrowthRate,
        this.config.maxPlants - plantCount
      );
      for (let i = 0; i < growCount; i++) {
        const dna = createRandomDNA(OrganismType.Plant);
        const pos = {
          x: (Math.random() - 0.5) * this.config.width,
          y: 0,
          z: (Math.random() - 0.5) * this.config.height,
        };
        const plant = new Organism(OrganismType.Plant, dna, pos);
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
        this.config.microbeGrowthRate,
        this.config.maxMicrobes - microbeCount
      );
      for (let i = 0; i < growCount; i++) {
        const dna = createRandomDNA(OrganismType.Microbe);
        const pos = {
          x: (Math.random() - 0.5) * this.config.width,
          y: 0,
          z: (Math.random() - 0.5) * this.config.height,
        };
        const microbe = new Organism(OrganismType.Microbe, dna, pos);
        microbe.speciesId = 0;
        this.organisms.push(microbe);
      }
    }
  }

  /** 移除死亡个体，按死因分类统计 */
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
            // 未知原因（兜底归入饿死）
            this.deathStats.starvation++;
            break;
        }
      }
    }

    this.organisms = alive;
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
      });
    }

    const speciesList = Array.from(this.speciesMap.values())
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15); // 显示更多物种

    return {
      tick: this.tick,
      organisms: renderData,
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
        dayTime: Math.round(this.dayTime * 1000) / 1000,
      },
    };
  }
}
