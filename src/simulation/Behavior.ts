// ============================================
// 行为决策系统 - 参数化决策，由 DNA 控制
// ============================================

import { OrganismType, DeathCause } from '../types';
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
}

interface ActionScore {
  action: Action;
  score: number;
  target?: Organism;
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
   * 为生命体执行一次决策 + 行为
   */
  update(organism: Organism, grid: SpatialGrid): void {
    // 植物不参与行为决策
    if (!organism.alive || organism.type === OrganismType.Plant) return;

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

      // 同类且可繁殖
      if (other.type === organism.type && other.canReproduce()) {
        mates.push(other);
      }
    }

    // 2. 计算各行为的权重得分（由 DNA 控制）
    const scores: ActionScore[] = [];

    // 饥饿度 [0, 1]
    const hunger = 1 - Math.min(1, organism.energy / (organism.reproThreshold * 0.8));

    // ---- 活跃度对行为得分的调制 ----
    // 休息时：主动行为（觅食/攻击/繁殖）大幅降低，被动行为（逃跑）仅轻微降低
    const activeMod = activity;           // 主动行为乘数
    const passiveMod = 0.5 + 0.5 * activity; // 逃跑等被动行为乘数（最低 0.5）

    // 寻找食物
    const foodTarget = this.findBestFood(organism, plants, prey);
    if (foodTarget) {
      const foodScore = (hunger * 10 + (1 - organism.dietType) * 2) * activeMod;
      scores.push({ action: Action.SeekFood, score: foodScore, target: foodTarget });
    }

    // 攻击猎物
    if (prey.length > 0) {
      const bestPrey = this.findNearest(organism, prey);
      if (bestPrey) {
        const attackScore = (organism.aggression * 8 + hunger * 5 + organism.dietType * 3) * activeMod;
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

    // 繁殖
    if (organism.canReproduce() && mates.length > 0) {
      const mate = this.findNearest(organism, mates);
      if (mate) {
        const reproScore = ((1 - hunger) * 6 + 3) * activeMod;
        scores.push({ action: Action.Reproduce, score: reproScore, target: mate });
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
    this.executeAction(organism, bestAction);
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

  private executeAction(organism: Organism, action: ActionScore): void {
    switch (action.action) {
      case Action.Wander:
        this.wander(organism);
        break;
      case Action.SeekFood:
        if (action.target) this.moveToward(organism, action.target);
        this.tryEat(organism, action.target);
        break;
      case Action.Attack:
        if (action.target) {
          this.moveToward(organism, action.target);
          this.tryAttack(organism, action.target);
        }
        break;
      case Action.Flee:
        if (action.target) this.moveAway(organism, action.target);
        break;
      case Action.Reproduce:
        if (action.target) this.moveToward(organism, action.target);
        break;
      case Action.Parasitize:
        if (action.target) {
          this.moveToward(organism, action.target);
          this.tryParasitize(organism, action.target);
        }
        break;
      case Action.Idle:
        organism.velocity.x = 0;
        organism.velocity.z = 0;
        break;
    }

    // 应用速度到位置
    this.applyMovement(organism);
  }

  private wander(organism: Organism): void {
    const activity = organism.activityLevel;
    // 休息时几乎不动，只有微弱的随机漂移
    const wanderStrength = activity < 0.4 ? 0.1 : 1.0;
    organism.velocity.x += (Math.random() - 0.5) * wanderStrength;
    organism.velocity.z += (Math.random() - 0.5) * wanderStrength;

    // 休息时速度显著降低
    if (activity < 0.4) {
      organism.velocity.x *= 0.3;
      organism.velocity.z *= 0.3;
    }

    // 限速（考虑活跃度）
    this.limitSpeed(organism);
  }

  private moveToward(organism: Organism, target: Organism): void {
    const dx = target.position.x - organism.position.x;
    const dz = target.position.z - organism.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.01) {
      // 移动速度受活跃度影响
      const effectiveSpeed = organism.speed * (0.3 + 0.7 * organism.activityLevel);
      organism.velocity.x = (dx / dist) * effectiveSpeed;
      organism.velocity.z = (dz / dist) * effectiveSpeed;
    }
  }

  private moveAway(organism: Organism, threat: Organism): void {
    const dx = organism.position.x - threat.position.x;
    const dz = organism.position.z - threat.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.01) {
      // 逃跑速度受活跃度影响（但即使在休息也能有一定速度）
      const effectiveSpeed = organism.speed * (0.5 + 0.5 * organism.activityLevel);
      organism.velocity.x = (dx / dist) * effectiveSpeed;
      organism.velocity.z = (dz / dist) * effectiveSpeed;
    }
  }

  private tryEat(organism: Organism, target?: Organism): void {
    if (!target || !target.alive) return;
    const dist = this.distance(organism, target);
    if (dist < organism.size + target.size + 1) {
      if (target.type === OrganismType.Plant) {
        // 吃植物 —— 昆虫吃一小口，动物吃得更多
        const efficiency = organism.type === OrganismType.Insect ? 0.4 : 0.7;
        organism.energy += target.energy * efficiency;
        target.die(DeathCause.Predation);
      } else if (target.type === OrganismType.Microbe) {
        // 吃微生物 —— 极少能量（微生物太小了）
        organism.energy += target.energy * 0.3;
        target.die(DeathCause.Predation);
      }
    }
  }

  private tryAttack(organism: Organism, target: Organism): void {
    if (!target.alive) return;
    const dist = this.distance(organism, target);
    if (dist < organism.size + target.size + 1.5) {
      // 伤害计算：攻击者越大、攻击力越高伤害越大
      const damage = Math.max(0, organism.attack - target.defense * 0.5);
      target.energy -= damage * 3;
      // 攻击消耗：动物攻击消耗更多能量（大型身体运动代价高）
      const attackCost = organism.type === OrganismType.Animal ? 0.6 :
                         organism.type === OrganismType.Insect ? 0.15 : 0.1;
      organism.energy -= attackCost;

      if (target.energy <= 0) {
        target.die(DeathCause.Predation);
        // 捕食获取能量（与猎物体型成正比，大型猎物更有价值）
        organism.energy += target.size * 12 + target.energy * 0.1;
      }
    }
  }

  /**
   * 微生物寄生行为：靠近宿主后持续吸取少量能量
   */
  private tryParasitize(organism: Organism, host: Organism): void {
    if (!host.alive || !organism.alive) return;
    const dist = this.distance(organism, host);
    if (dist < organism.size + host.size + 2) {
      // 微生物寄生：吸取极少能量（微生物很小），但持续伤害宿主
      const drainAmount = organism.aggression * 0.06 + 0.02;
      host.energy -= drainAmount;
      organism.energy += drainAmount * 0.8;
      host.health -= 0.0015; // 缓慢损害宿主健康（感染）

      if (host.energy <= 0) {
        host.die(DeathCause.Disease);
      }
    }
  }

  private limitSpeed(organism: Organism): void {
    const speed = Math.sqrt(
      organism.velocity.x * organism.velocity.x +
      organism.velocity.z * organism.velocity.z
    );
    if (speed > organism.speed) {
      organism.velocity.x = (organism.velocity.x / speed) * organism.speed;
      organism.velocity.z = (organism.velocity.z / speed) * organism.speed;
    }
  }

  private applyMovement(organism: Organism): void {
    organism.position.x += organism.velocity.x;
    organism.position.z += organism.velocity.z;

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

    // 应用阻力
    organism.velocity.x *= 0.9;
    organism.velocity.z *= 0.9;
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
