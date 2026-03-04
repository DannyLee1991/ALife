// ============================================
// 行为决策系统 - 参数化决策，由 DNA 控制
// ============================================

import { OrganismType, DeathCause, Gender, Gene } from '../types';
import { Organism } from './Organism';
import { SpatialGrid } from './SpatialGrid';

export enum Action {
  Idle,
  Wander,
  SeekFood,
  Attack,
  Flee,
  Reproduce,
  Parasitize,  // 微生物寄生行为
  Scavenge,    // 食腐行为（寻找尸体进食）
}

/** 尸体信息（传入行为引擎供食腐决策用） */
export interface CorpseInfo {
  position: { x: number; z: number };
  remainingEnergy: number;
  size: number;
}

interface ActionScore {
  action: Action;
  score: number;
  target?: Organism;
  /** 食腐目标的尸体索引 */
  corpseIdx?: number;
}

/**
 * 参数化行为决策引擎
 * 所有决策权重由 DNA 基因参数控制
 *
 * 食物链关系：
 * - 微生物：环境吸收能量 + 寄生型可吸取宿主能量
 * - 植物：光合作用（不参与行为决策）
 * - 昆虫：食草→吃植物/微生物，食肉→吃其他昆虫
 * - 动物：食草→吃植物，杂食→吃植物/昆虫，食肉→吃昆虫/其他动物
 */
export class BehaviorEngine {
  private worldWidth: number;
  private worldHeight: number;

  constructor(worldWidth: number, worldHeight: number) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
  }

  /**
   * 计算指定坐标的水域深度 [0, 1]
   * 使用与渲染器相同的河流方程，确保逻辑一致
   */
  getWaterDepth(x: number, z: number): number {
    // 河流1：南北蜿蜒主河
    const riverX = Math.sin(z * 0.01) * 65 + Math.sin(z * 0.003) * 110;
    const dRiver1 = Math.abs(x - riverX);
    const river1Width = 20;

    // 河流2：东西支流
    const river2Z = Math.cos(x * 0.008) * 55 + Math.cos(x * 0.002) * 95 + 30;
    const dRiver2 = Math.abs(z - river2Z);
    const river2Width = 14;

    let depth = 0;
    if (dRiver1 < river1Width) {
      const t = 1 - dRiver1 / river1Width;
      depth = Math.max(depth, t * t);
    }
    if (dRiver2 < river2Width) {
      const t = 1 - dRiver2 / river2Width;
      depth = Math.max(depth, t * t);
    }
    return depth;
  }

  /**
   * 为生命体执行一次决策 + 行为
   * @param corpses 当前世界中的所有尸体（食腐行为用）
   * @param dt 时间步长归一化因子（BASE_TPS/TPS），运动和连续效果需乘以此值
   */
  update(organism: Organism, grid: SpatialGrid, corpses: CorpseInfo[] = [], dt: number = 1): void {
    // 植物不参与行为决策
    if (!organism.alive || organism.type === OrganismType.Plant) return;

    // ---- 正在原地进食猎物：停止一切行动 ----
    if (organism.isFeeding) {
      // 进食中：速度归零，原地不动
      organism.velocity.x = 0;
      organism.velocity.z = 0;
      return;
    }

    // ---- 昼夜活跃度 ----
    // activityLevel [0.15, 1.0]：休息时感知降低、行动迟缓
    const activity = organism.activityLevel;

    // 有效感知范围：休息时大幅缩短（但仍能感知近距离威胁）
    const effectiveSenseRange = organism.senseRange * (0.3 + 0.7 * activity);

    // 1. 感知周围环境
    const nearby = grid.queryRange(
      organism.position.x,
      organism.position.z,
      effectiveSenseRange
    );

    // 分类周围生物
    const threats: Organism[] = [];
    const prey: Organism[] = [];
    const mates: Organism[] = [];
    const plants: Organism[] = [];
    const parasiteTargets: Organism[] = []; // 寄生目标

    for (let i = 0; i < nearby.length; i++) {
      const other = nearby[i];
      if (other.id === organism.id || !other.alive) continue;

      if (other.type === OrganismType.Plant) {
        plants.push(other);
      } else if (this.isThreat(organism, other)) {
        threats.push(other);
      } else if (this.isPrey(organism, other)) {
        prey.push(other);
      }

      // 微生物寄生目标：比自己大的非植物生物
      if (organism.type === OrganismType.Microbe &&
          organism.aggression > 0.5 &&
          other.type !== OrganismType.Microbe &&
          other.type !== OrganismType.Plant) {
        parasiteTargets.push(other);
      }

      // 同类潜在配偶（普通感知范围内的）
      this.checkMateCandidate(organism, other, mates);
    }

    // ---- 交配信号扩展感知：发情期信息素/声音可在更远距离被检测到 ----
    // 如果是准备好交配的雄性或发情雌性，扫描更大范围寻找配偶
    if (mates.length === 0 && organism.isEmittingMatingSignal) {
      const signalRange = organism.matingSignalRange;
      if (signalRange > effectiveSenseRange) {
        const extendedNearby = grid.queryRange(
          organism.position.x,
          organism.position.z,
          signalRange
        );
        for (let i = 0; i < extendedNearby.length; i++) {
          const other = extendedNearby[i];
          if (other.id === organism.id || !other.alive) continue;
          // 只关心同类且释放交配信号的个体（信息素对接）
          if (other.type === organism.type && other.isEmittingMatingSignal) {
            this.checkMateCandidate(organism, other, mates);
          }
        }
      }
    }

    // 2. 计算各行为的权重得分（由 DNA 控制）
    const scores: ActionScore[] = [];

    // 饥饿度 [0, 1]：结合能量和饱腹度
    const energyHunger = 1 - Math.min(1, organism.energy / (organism.reproThreshold * 0.8));
    const satietyHunger = 1 - organism.satiety;
    // 综合饥饿度：能量不足或胃空都会触发觅食
    const hunger = Math.max(energyHunger, satietyHunger * 0.7);

    // 是否饱腹（饱腹时不主动觅食/捕猎）
    const isFull = organism.isFull;

    // ---- 活跃度对行为得分的调制 ----
    const activeMod = activity;
    const passiveMod = 0.5 + 0.5 * activity;

    // 寻找食物（饱腹时不觅食）
    if (!isFull) {
      const foodTarget = this.findBestFood(organism, plants, prey);
      if (foodTarget) {
        const foodScore = (hunger * 10 + (1 - organism.dietType) * 2) * activeMod;
        scores.push({ action: Action.SeekFood, score: foodScore, target: foodTarget });
      }
    }

    // 攻击猎物（饱腹时不捕猎，除非极具攻击性）
    if (prey.length > 0 && (!isFull || organism.aggression > 0.8)) {
      const bestPrey = this.findNearest(organism, prey);
      if (bestPrey) {
        const hungerMod = isFull ? 0.2 : 1.0;
        const attackScore = (organism.aggression * 8 + hunger * 5 + organism.dietType * 3) * activeMod * hungerMod;
        scores.push({ action: Action.Attack, score: attackScore, target: bestPrey });
      }
    }

    // 微生物寄生行为
    if (organism.type === OrganismType.Microbe && parasiteTargets.length > 0) {
      const host = this.findNearest(organism, parasiteTargets);
      if (host) {
        const parasiteScore = (organism.aggression * 10 + hunger * 6) * activeMod;
        scores.push({ action: Action.Parasitize, score: parasiteScore, target: host });
      }
    }

    // ---- 食腐行为：被尸体气味吸引 ----
    // 食腐者：杂食/肉食动物(dietType>0.3)、腐生微生物(dietType>0.5)
    if (!isFull && corpses.length > 0) {
      const isScavenger =
        (organism.type === OrganismType.Animal && organism.dietType > 0.3) ||
        (organism.type === OrganismType.Insect && organism.dietType > 0.4) ||
        (organism.type === OrganismType.Microbe && organism.dietType > 0.5);

      if (isScavenger) {
        // 找到感知范围内最近的尸体
        // 尸体气味传播范围比普通感知更远（气味扩散）
        const smellRange = effectiveSenseRange * 1.5;
        let nearestCorpseIdx = -1;
        let nearestCorpseDist = Infinity;

        for (let ci = 0; ci < corpses.length; ci++) {
          const c = corpses[ci];
          if (c.remainingEnergy <= 0) continue;
          const dx = c.position.x - organism.position.x;
          const dz = c.position.z - organism.position.z;
          const d = dx * dx + dz * dz;
          if (d < smellRange * smellRange && d < nearestCorpseDist) {
            nearestCorpseDist = d;
            nearestCorpseIdx = ci;
          }
        }

        if (nearestCorpseIdx >= 0) {
          // 食腐分数：饥饿度越高越想吃、食性越偏肉食越高分
          // 微生物的食腐分数额外加成（腐生菌天职）
          const corpseBonus = organism.type === OrganismType.Microbe ? 8 : 0;
          const scavengeScore = (hunger * 9 + organism.dietType * 4 + corpseBonus) * activeMod;
          scores.push({ action: Action.Scavenge, score: scavengeScore, corpseIdx: nearestCorpseIdx });
        }
      }
    }

    // 逃跑（即使休息中遇到威胁也会反应，但灵敏度降低）
    if (threats.length > 0) {
      const nearestThreat = this.findNearest(organism, threats);
      if (nearestThreat) {
        const dist = this.distance(organism, nearestThreat);
        const dangerLevel = 1 - dist / effectiveSenseRange;
        const fleeScore = (organism.fleeInclination * 12 + dangerLevel * 8) * passiveMod;
        scores.push({ action: Action.Flee, score: fleeScore, target: nearestThreat });
      }
    }

    // 繁殖 / 寻偶交配
    // 怀孕中的雌性不再寻偶
    if (!organism.isPregnant && mates.length > 0) {
      // 无性繁殖 or 有性繁殖均可
      const canTryMate = organism.canReproduce() || organism.canMate() ||
        (organism.gender === Gender.Female && organism.isInEstrus && !organism.isFertilized);
      if (canTryMate) {
        const mate = this.findNearest(organism, mates);
        if (mate) {
          // 交配信号加成：双方都释放信号时得分更高（信息素吸引）
          const signalBonus = (organism.isEmittingMatingSignal && mate.isEmittingMatingSignal) ? 5 : 0;
          const reproScore = ((1 - hunger) * 6 + 3 + signalBonus) * activeMod;
          scores.push({ action: Action.Reproduce, score: reproScore, target: mate });
        }
      }
    }

    // 休息/漫游（默认行为）
    // 活跃度低时，"静止休息"得分提高（动物倾向原地不动）
    const restScore = 2 + (1 - activity) * 8;
    scores.push({ action: Action.Wander, score: restScore });

    // 3. 选择得分最高的行为
    let bestAction = scores[0];
    for (let i = 1; i < scores.length; i++) {
      if (scores[i].score > bestAction.score) {
        bestAction = scores[i];
      }
    }

    // 4. 执行行为
    this.executeAction(organism, bestAction, corpses, dt);
  }

  /**
   * 判断 other 是否对 self 构成威胁
   * 完善的食物链威胁关系
   */
  private isThreat(self: Organism, other: Organism): boolean {
    // 微生物不会被主动威胁（太小了，被无意中吃掉而非主动攻击）
    // 但如果对方是肉食昆虫/动物且比自己大，则视为威胁
    if (self.type === OrganismType.Microbe) {
      return (other.type === OrganismType.Insect || other.type === OrganismType.Animal) &&
             other.attack > 1;
    }

    if (self.type === OrganismType.Insect) {
      // 对昆虫的威胁：动物、或攻击力更强的肉食昆虫
      if (other.type === OrganismType.Animal && other.dietType > 0.3) return true;
      if (other.type === OrganismType.Insect &&
          other.dietType > 0.5 &&
          other.attack > self.defense * 1.2) return true;
      return false;
    }

    if (self.type === OrganismType.Animal) {
      // 对动物的威胁：攻击力明显高于自己防御力的食肉动物
      if (other.type === OrganismType.Animal &&
          other.dietType > 0.5 &&
          other.attack > self.defense * 1.3 &&
          other.size > self.size * 0.8) return true;
      return false;
    }

    return false;
  }

  /**
   * 判断 other 是否是 self 的猎物
   * 完善的食物链捕食关系
   */
  private isPrey(self: Organism, other: Organism): boolean {
    // 微生物不主动捕食（通过寄生/分解获取能量）
    if (self.type === OrganismType.Microbe) return false;

    if (self.type === OrganismType.Insect) {
      // 昆虫猎物：
      // - 食草昆虫 → 吃植物（通过 plants 列表处理）和微生物
      // - 食肉昆虫 → 吃其他昆虫和微生物
      if (other.type === OrganismType.Microbe) return true; // 所有昆虫都能吃微生物
      if (other.type === OrganismType.Insect &&
          self.dietType > 0.5 &&
          self.attack > other.defense) return true;
      return false;
    }

    if (self.type === OrganismType.Animal) {
      // 动物猎物：
      // - 食草动物 → 吃植物（通过 plants 列表处理），不捕食
      // - 杂食动物 → 吃昆虫、微生物
      // - 食肉动物 → 吃昆虫、其他食草/杂食动物、微生物
      if (other.type === OrganismType.Microbe && self.dietType > 0.2) return true;
      if (other.type === OrganismType.Insect && self.dietType > 0.3) return true;
      if (other.type === OrganismType.Animal &&
          self.dietType > 0.6 &&
          other.dietType < self.dietType &&
          self.attack > other.defense * 0.8) return true;
      // 也可以吃植物（但只在 findBestFood 中处理）
      return false;
    }

    return false;
  }

  /**
   * 检查 other 是否可作为 organism 的配偶候选，符合条件则加入 mates 数组
   */
  private checkMateCandidate(organism: Organism, other: Organism, mates: Organism[]): void {
    if (other.type !== organism.type) return;

    if (organism.gender === Gender.None) {
      // 无性繁殖物种：只要对方能繁殖即可
      if (other.canReproduce()) mates.push(other);
    } else if (organism.gender === Gender.Male && organism.canMate()) {
      // 雄性：寻找发情雌性（未受精）
      if (other.gender === Gender.Female && other.isInEstrus && !other.isFertilized) {
        mates.push(other);
      }
    } else if (organism.gender === Gender.Female && organism.isInEstrus && !organism.isFertilized) {
      // 发情雌性（未受精）：寻找可交配雄性
      if (other.gender === Gender.Male && other.canMate()) {
        mates.push(other);
      }
    }
  }

  private findBestFood(organism: Organism, plants: Organism[], prey: Organism[]): Organism | null {
    if (organism.type === OrganismType.Microbe) {
      // 微生物不主动捕食，通过环境/寄生获取能量
      return null;
    }

    // 根据食性决定优先寻找什么食物
    if (organism.dietType < 0.3) {
      // 草食性，优先植物
      return this.findNearest(organism, plants);
    } else if (organism.dietType > 0.7) {
      // 肉食性，优先猎物
      return this.findNearest(organism, prey) || this.findNearest(organism, plants);
    } else {
      // 杂食性，找最近的
      const allFood = [...plants, ...prey];
      return this.findNearest(organism, allFood);
    }
  }

  private findNearest(self: Organism, candidates: Organism[]): Organism | null {
    if (candidates.length === 0) return null;
    let nearest = candidates[0];
    let nearestDist = this.distanceSq(self, candidates[0]);
    for (let i = 1; i < candidates.length; i++) {
      const d = this.distanceSq(self, candidates[i]);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = candidates[i];
      }
    }
    return nearest;
  }

  private executeAction(organism: Organism, action: ActionScore, corpses: CorpseInfo[] = [], dt: number = 1): void {
    switch (action.action) {
      case Action.Wander:
        this.wander(organism, dt);
        break;
      case Action.SeekFood:
        if (action.target) this.moveToward(organism, action.target, dt);
        this.tryEat(organism, action.target, dt);
        break;
      case Action.Attack:
        if (action.target) {
          this.moveToward(organism, action.target, dt);
          this.tryAttack(organism, action.target, dt);
        }
        break;
      case Action.Flee:
        if (action.target) this.moveAway(organism, action.target, dt);
        break;
      case Action.Reproduce:
        if (action.target) this.moveToward(organism, action.target, dt);
        break;
      case Action.Parasitize:
        if (action.target) {
          this.moveToward(organism, action.target, dt);
          this.tryParasitize(organism, action.target, dt);
        }
        break;
      case Action.Scavenge:
        if (action.corpseIdx !== undefined && action.corpseIdx >= 0 && action.corpseIdx < corpses.length) {
          const corpse = corpses[action.corpseIdx];
          this.moveTowardPos(organism, corpse.position.x, corpse.position.z, dt);
          this.tryEatCorpse(organism, corpse, dt);
        }
        break;
      case Action.Idle:
        organism.velocity.x = 0;
        organism.velocity.z = 0;
        break;
    }

    // 应用速度到位置（乘 dt 缩放步长）
    this.applyMovement(organism, dt);
  }

  private wander(organism: Organism, dt: number = 1): void {
    const activity = organism.activityLevel;
    const wanderStrength = (activity < 0.4 ? 0.1 : 1.0) * dt;
    organism.velocity.x += (Math.random() - 0.5) * wanderStrength;
    organism.velocity.z += (Math.random() - 0.5) * wanderStrength;

    if (activity < 0.4) {
      organism.velocity.x *= 0.3;
      organism.velocity.z *= 0.3;
    }

    // ---- 水陆偏好导航 ----
    const aq = organism.aquatic;
    const curDepth = this.getWaterDepth(organism.position.x, organism.position.z);

    if (aq > 0.5 && curDepth < 0.1) {
      const gradX = this.getWaterDepth(organism.position.x + 5, organism.position.z) - curDepth;
      const gradZ = this.getWaterDepth(organism.position.x, organism.position.z + 5) - curDepth;
      organism.velocity.x += gradX * aq * 3 * dt;
      organism.velocity.z += gradZ * aq * 3 * dt;
    } else if (aq < 0.3 && curDepth > 0.15) {
      const gradX = this.getWaterDepth(organism.position.x + 5, organism.position.z) - curDepth;
      const gradZ = this.getWaterDepth(organism.position.x, organism.position.z + 5) - curDepth;
      organism.velocity.x -= gradX * (1 - aq) * 4 * dt;
      organism.velocity.z -= gradZ * (1 - aq) * 4 * dt;
    }

    this.limitSpeed(organism, dt);
  }

  /**
   * 计算水陆地形对速度的修正系数
   * 水生生物在水中快、陆地慢；陆生生物在水中慢、陆地快
   */
  private getTerrainSpeedMod(organism: Organism): number {
    if (organism.isInWater) {
      // 水中：aquatic=1 → 1.2×加速, aquatic=0 → 0.3×减速
      return 0.3 + organism.aquatic * 0.9;
    }
    // 陆地：aquatic=1 → 0.5×减速, aquatic=0 → 1.0×正常
    return 1.0 - organism.aquatic * 0.5;
  }

  private moveToward(organism: Organism, target: Organism, dt: number = 1): void {
    const dx = target.position.x - organism.position.x;
    const dz = target.position.z - organism.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.01) {
      const terrainMod = this.getTerrainSpeedMod(organism);
      const effectiveSpeed = organism.speed * (0.3 + 0.7 * organism.activityLevel) * terrainMod * dt;
      organism.velocity.x = (dx / dist) * effectiveSpeed;
      organism.velocity.z = (dz / dist) * effectiveSpeed;
    }
  }

  private moveAway(organism: Organism, threat: Organism, dt: number = 1): void {
    const dx = organism.position.x - threat.position.x;
    const dz = organism.position.z - threat.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.01) {
      const terrainMod = this.getTerrainSpeedMod(organism);
      const effectiveSpeed = organism.speed * (0.5 + 0.5 * organism.activityLevel) * terrainMod * dt;
      organism.velocity.x = (dx / dist) * effectiveSpeed;
      organism.velocity.z = (dz / dist) * effectiveSpeed;
    }
  }

  private tryEat(organism: Organism, target?: Organism, _dt: number = 1): void {
    if (!target || !target.alive) return;
    // 饱腹时不进食
    if (organism.isFull) return;

    const dist = this.distance(organism, target);
    if (dist < organism.size + target.size + 1) {
      if (target.type === OrganismType.Plant) {
        const efficiency = organism.type === OrganismType.Insect ? 0.4 : 0.7;
        const gained = target.energy * efficiency;
        organism.energy += gained;
        organism.feed(gained); // 增加饱腹度
        target.die(DeathCause.Predation);
      } else if (target.type === OrganismType.Microbe) {
        const gained = target.energy * 0.3;
        organism.energy += gained;
        organism.feed(gained);
        target.die(DeathCause.Predation);
      }
    }
  }

  private tryAttack(organism: Organism, target: Organism, dt: number = 1): void {
    if (!target.alive) return;
    const dist = this.distance(organism, target);
    if (dist < organism.size + target.size + 1.5) {
      const damage = Math.max(0, organism.attack - target.defense * 0.5);
      target.energy -= damage * 3 * dt;
      const attackCost = (organism.type === OrganismType.Animal ? 0.6 :
                         organism.type === OrganismType.Insect ? 0.15 : 0.1) * dt;
      organism.energy -= attackCost;

      if (target.energy <= 0) {
        target.die(DeathCause.Predation);
        // 捕食获取能量（与猎物体型成正比，大型猎物更有价值）
        const gained = target.size * 12 + Math.max(0, target.energy * 0.1);
        organism.energy += gained;
        organism.feed(gained); // 捕食增加饱腹度

        // 捕食者原地停留进食：动物进食时间较长，昆虫较短
        if (organism.type === OrganismType.Animal) {
          organism.feedingTimer = 8 + target.size * 2; // 约 8~14 归一化 tick
        } else if (organism.type === OrganismType.Insect) {
          organism.feedingTimer = 3 + target.size;     // 约 3~6 归一化 tick
        }
        // 进食时速度清零
        organism.velocity.x = 0;
        organism.velocity.z = 0;
      }
    }
  }

  /**
   * 微生物寄生行为：靠近宿主后持续吸取少量能量
   */
  private tryParasitize(organism: Organism, host: Organism, dt: number = 1): void {
    if (!host.alive || !organism.alive) return;
    const dist = this.distance(organism, host);
    if (dist < organism.size + host.size + 2) {
      const drainAmount = (organism.aggression * 0.06 + 0.02) * dt;
      host.energy -= drainAmount;
      organism.energy += drainAmount * 0.8;
      host.health -= 0.0015 * dt;

      if (host.energy <= 0) {
        host.die(DeathCause.Disease);
      }
    }
  }

  /**
   * 向指定坐标移动（用于食腐等目标不是 Organism 的场景）
   */
  private moveTowardPos(organism: Organism, tx: number, tz: number, dt: number = 1): void {
    const dx = tx - organism.position.x;
    const dz = tz - organism.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.01) {
      const terrainMod = this.getTerrainSpeedMod(organism);
      const effectiveSpeed = organism.speed * (0.3 + 0.7 * organism.activityLevel) * terrainMod * dt;
      organism.velocity.x = (dx / dist) * effectiveSpeed;
      organism.velocity.z = (dz / dist) * effectiveSpeed;
    }
  }

  /**
   * 食腐行为：从尸体上进食
   * 动物大口撕咬获取大量能量，微生物缓慢分解
   */
  private tryEatCorpse(organism: Organism, corpse: CorpseInfo, dt: number = 1): void {
    if (organism.isFull || corpse.remainingEnergy <= 0) return;

    const dx = corpse.position.x - organism.position.x;
    const dz = corpse.position.z - organism.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < organism.size + corpse.size + 2) {
      let eatAmount: number;
      if (organism.type === OrganismType.Animal) {
        eatAmount = (2.0 + organism.size * 0.8) * dt;
      } else if (organism.type === OrganismType.Insect) {
        eatAmount = (0.5 + organism.size * 0.3) * dt;
      } else {
        eatAmount = (0.1 + organism.metabolism * 0.15) * dt;
      }

      eatAmount = Math.min(eatAmount, corpse.remainingEnergy);
      organism.energy += eatAmount;
      organism.feed(eatAmount);
      corpse.remainingEnergy -= eatAmount;
    }
  }

  private limitSpeed(organism: Organism, dt: number = 1): void {
    const speed = Math.sqrt(
      organism.velocity.x * organism.velocity.x +
      organism.velocity.z * organism.velocity.z
    );
    let maxSpeed = organism.speed * dt;

    // 怀孕减速：妊娠中的雌性移动速度降低（进度越大越慢）
    if (organism.isPregnant) {
      const progress = organism.pregnancyProgress;
      // 孕早期几乎不影响（0.95×），晚期明显减速（0.5×）
      maxSpeed *= 0.95 - progress * 0.45;
    }

    if (speed > maxSpeed) {
      organism.velocity.x = (organism.velocity.x / speed) * maxSpeed;
      organism.velocity.z = (organism.velocity.z / speed) * maxSpeed;
    }
  }

  private applyMovement(organism: Organism, dt: number = 1): void {
    // 位置增量已经在速度设置时乘以了 dt，这里直接应用
    organism.position.x += organism.velocity.x;
    organism.position.z += organism.velocity.z;

    // ---- 平滑更新朝向 ----
    // 只有在速度足够大时才更新朝向（静止/极慢时保持当前朝向）
    const vx = organism.velocity.x;
    const vz = organism.velocity.z;
    const speedSq = vx * vx + vz * vz;
    const minSpeedSq = 0.001; // 速度阈值的平方
    if (speedSq > minSpeedSq) {
      // 目标朝向：atan2(vx, vz) → 0=+Z, PI/2=+X（Three.js Y轴旋转约定）
      const targetFacing = Math.atan2(vx, vz);
      // 计算最短角度差 [-PI, PI]
      let angleDiff = targetFacing - organism.facing;
      if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      // 转向速度：不同物种转弯灵活度不同
      // 微生物极快（几乎立即转向），昆虫快，动物中等
      let turnRate: number;
      switch (organism.type) {
        case OrganismType.Microbe: turnRate = 0.6; break;
        case OrganismType.Insect:  turnRate = 0.35; break;
        case OrganismType.Animal:  turnRate = 0.2; break;
        default:                   turnRate = 0.3; break;
      }
      // BodyShape 影响转向：紧凑型(0)转弯快，流线型(1)转弯慢
      const bodyShape = organism.dna[Gene.BodyShape] ?? 0.5;
      turnRate *= (1.2 - bodyShape * 0.4); // [0.8, 1.2]

      // 平滑插值（乘以 dt 保证时间一致性）
      // 使用 1 - pow(1-turnRate, dt) 替代简单的 turnRate*dt，避免 dt 大时超调
      const smoothFactor = 1 - Math.pow(1 - turnRate, dt);
      organism.facing += angleDiff * smoothFactor;

      // 归一化到 [0, 2PI)
      if (organism.facing < 0) organism.facing += Math.PI * 2;
      if (organism.facing >= Math.PI * 2) organism.facing -= Math.PI * 2;
    }

    // 世界边界约束
    const halfW = this.worldWidth / 2;
    const halfH = this.worldHeight / 2;

    if (organism.position.x < -halfW) {
      organism.position.x = -halfW;
      organism.velocity.x *= -0.5;
    }
    if (organism.position.x > halfW) {
      organism.position.x = halfW;
      organism.velocity.x *= -0.5;
    }
    if (organism.position.z < -halfH) {
      organism.position.z = -halfH;
      organism.velocity.z *= -0.5;
    }
    if (organism.position.z > halfH) {
      organism.position.z = halfH;
      organism.velocity.z *= -0.5;
    }

    // 应用阻力（归一化到 dt）
    // 原始 0.9 是在 BASE_TPS 下的衰减，需要 pow(0.9, dt) 近似
    const friction = Math.pow(0.9, dt);
    organism.velocity.x *= friction;
    organism.velocity.z *= friction;
  }

  private distance(a: Organism, b: Organism): number {
    return Math.sqrt(this.distanceSq(a, b));
  }

  private distanceSq(a: Organism, b: Organism): number {
    const dx = a.position.x - b.position.x;
    const dz = a.position.z - b.position.z;
    return dx * dx + dz * dz;
  }
}
