// ============================================
// 生命体 Organism
// ============================================

import { Gene, OrganismType, OrganismData, Vec3, DeathCause } from '../types';

let nextId = 1;

export class Organism {
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
  reproductionCooldown: number;

  /** 死亡原因（存活时为 None） */
  causeOfDeath: DeathCause;

  /** 当前所在区域的同类密度（由 World 每 tick 更新） */
  localDensity: number;

  /** 同物种邻居数量（精确到同 speciesId，由 World 每 tick 更新） */
  sameSpeciesNeighbors: number;

  /** 该物种在整个世界同类型中的占比 [0, 1]（由 World 每 tick 更新） */
  speciesDominance: number;

  /** 健康值 [0, 1]，受密度/疾病影响，低于阈值会死亡 */
  health: number;

  /** 大气 CO₂ 浓度（由 World 每 tick 更新） */
  co2Level: number;

  /**
   * 当前活跃度 [0.15, 1.0]（由 World 每 tick 根据昼夜和夜行性计算）
   * - 昼行动物白天 → 1.0，夜间 → 0.15
   * - 夜行动物夜间 → 1.0，白天 → 0.15
   */
  activityLevel: number;

  constructor(type: OrganismType, dna: number[], position: Vec3) {
    this.id = nextId++;
    this.type = type;
    this.dna = dna;
    this.energy = this.getInitialEnergy();
    this.age = 0;
    this.maxAge = this.calculateMaxAge();
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.alive = true;
    this.speciesId = 0;
    this.reproductionCooldown = 0;
    this.causeOfDeath = DeathCause.None;
    this.localDensity = 0;
    this.sameSpeciesNeighbors = 0;
    this.speciesDominance = 0;
    this.health = 1.0;
    this.co2Level = 1.0;
    this.activityLevel = 1.0;
  }

  private getInitialEnergy(): number {
    // 初始能量与物种体型和生态位成正比
    // 微生物极低，动物极高——反映真实世界的体能储备差异
    switch (this.type) {
      case OrganismType.Microbe: return 15;   // 极少储备，依赖快速分裂
      case OrganismType.Plant: return 35;     // 中等，靠光合作用积累
      case OrganismType.Insect: return 45;    // 适中
      case OrganismType.Animal: return 120;   // 大型动物有较多脂肪储备
    }
  }

  private calculateMaxAge(): number {
    // 寿命层级：微生物 < 昆虫 < 动物 < 植物
    // 一个昼夜循环 ≈ 5400 tick（180秒 × 30TPS）
    // 微生物：活几分钟（高繁殖率弥补短寿命）
    // 昆虫：活约半天到一天
    // 动物：活数天（K-策略，长寿低繁殖）
    // 植物：活最久（被动生存策略）
    const baseAge = this.type === OrganismType.Microbe ? 2500 :   // ~83s（高周转率）
                    this.type === OrganismType.Plant ? 28000 :     // ~933s ≈ 15min
                    this.type === OrganismType.Insect ? 5000 :     // ~167s（短世代）
                                                       20000;     // ~667s ≈ 11min（动物）
    // 体型越大寿命越长（大象比老鼠长寿），代谢越高寿命越短
    const sizeBonus = this.dna[Gene.BodySize] * 2000;
    const metabolismPenalty = this.dna[Gene.Metabolism] * 2500;
    // 各物种最低寿命保底
    const minAge = this.type === OrganismType.Microbe ? 800 :
                   this.type === OrganismType.Plant ? 5000 :
                   this.type === OrganismType.Insect ? 1500 : 5000;
    return Math.max(minAge, Math.floor(baseAge + sizeBonus - metabolismPenalty));
  }

  /** 获取体型 */
  get size(): number {
    return this.dna[Gene.BodySize];
  }

  /** 获取移动速度 */
  get speed(): number {
    return this.dna[Gene.MoveSpeed];
  }

  /** 获取感知范围 */
  get senseRange(): number {
    return this.dna[Gene.SenseRange];
  }

  /** 获取攻击力 */
  get attack(): number {
    return this.dna[Gene.Attack];
  }

  /** 获取防御力 */
  get defense(): number {
    return this.dna[Gene.Defense];
  }

  /** 获取代谢率 */
  get metabolism(): number {
    return this.dna[Gene.Metabolism];
  }

  /** 获取繁殖能量阈值 */
  get reproThreshold(): number {
    return this.dna[Gene.ReproThreshold];
  }

  /** 获取攻击倾向 */
  get aggression(): number {
    return this.dna[Gene.Aggression];
  }

  /** 获取逃跑倾向 */
  get fleeInclination(): number {
    return this.dna[Gene.FleeInclination];
  }

  /** 获取食性 */
  get dietType(): number {
    return this.dna[Gene.DietType];
  }

  /** 获取夜行性 [0=昼行, 1=夜行] */
  get nocturnality(): number {
    return this.dna[Gene.Nocturnality] ?? 0;
  }

  /** 每 tick 的基础能量消耗（按物种差异化） */
  get energyCost(): number {
    // 物种代谢倍率：微生物和植物消耗极低，动物消耗最高
    // 模拟真实世界中体重与代谢率的异速缩放关系
    let typeMult: number;
    switch (this.type) {
      case OrganismType.Microbe: typeMult = 0.25; break; // 微生物：极低能耗
      case OrganismType.Plant:   typeMult = 0.15; break; // 植物：最低能耗
      case OrganismType.Insect:  typeMult = 0.7;  break; // 昆虫：中等能耗
      case OrganismType.Animal:  typeMult = 1.0;  break; // 动物：最高能耗
    }
    const baseCost = this.metabolism * 0.12 * typeMult;
    const sizeCost = this.size * 0.05 * typeMult;
    const speedCost = (Math.abs(this.velocity.x) + Math.abs(this.velocity.z)) * 0.025;
    const rawCost = baseCost + sizeCost + speedCost;
    // 休息时（活跃度低）能量消耗降低（类似睡眠节能）
    const activityMod = 0.4 + 0.6 * this.activityLevel;
    return rawCost * activityMod;
  }

  /**
   * 使生命体死亡并记录死因
   * 如果已经死亡则不会覆盖原始死因
   */
  die(cause: DeathCause): void {
    if (!this.alive) return;
    this.alive = false;
    this.causeOfDeath = cause;
  }

  /** 消耗能量并老化，检测多种死亡条件 */
  tick(): void {
    if (!this.alive) return;

    this.age++;
    this.energy -= this.energyCost;

    if (this.reproductionCooldown > 0) {
      this.reproductionCooldown--;
    }

    // 微生物通过分解/吸收从环境获取能量
    // 微生物代谢极低，但能从环境中持续获取少量能量
    if (this.type === OrganismType.Microbe) {
      const densityFactor = Math.max(0.1, 1 - this.localDensity * 0.5);
      this.energy += (0.06 + this.metabolism * 0.08) * densityFactor;
    }

    // 植物通过光合作用获取能量
    // 核心机制：光合作用需要 CO₂，当 CO₂ 不足时植物无法获取能量
    // CO₂ 来自动物/昆虫/微生物的呼吸，所以其他生物灭绝 → 植物也会死
    if (this.type === OrganismType.Plant) {
      const densityFactor = Math.max(0.2, 1 - this.localDensity * 0.3);
      const co2Factor = Math.min(1.3, this.co2Level);
      this.energy += (0.1 + this.size * 0.06) * densityFactor * co2Factor;
    }

    // ---- 多因素死亡检测 ----

    // 1. 饿死：能量耗尽
    if (this.energy <= 0) {
      this.die(DeathCause.Starvation);
      return;
    }

    // 2. 自然老死：达到最大年龄
    if (this.age >= this.maxAge) {
      this.die(DeathCause.OldAge);
      return;
    }

    // 3. 生命游戏规则：同物种邻居过密致死
    //    借鉴 Conway's Game of Life：
    //    - 邻居太少 → 孤立（不直接致死，但无法繁殖）
    //    - 邻居适中 → 存活（理想范围）
    //    - 邻居过多 → 资源竞争导致死亡
    //    当物种多样性低（单一物种垄断）时，过密阈值更低、压力更大
    {
      // 基础过密阈值（邻居数量）
      // 微生物能容忍最高密度（群体生存），动物最低（领地性强）
      const baseOverpopThreshold = this.type === OrganismType.Microbe ? 30 :
                                    this.type === OrganismType.Plant ? 18 :
                                    this.type === OrganismType.Insect ? 12 : 5;

      // 单一物种垄断时，过密阈值降低（资源全被同一物种占据）
      // speciesDominance 越高 → 阈值越低 → 越容易触发过密致死
      const dominancePenalty = this.speciesDominance * this.speciesDominance;
      const effectiveThreshold = baseOverpopThreshold * (1 - dominancePenalty * 0.5);

      if (this.sameSpeciesNeighbors > effectiveThreshold) {
        // 超出阈值的程度
        const excess = (this.sameSpeciesNeighbors - effectiveThreshold) / effectiveThreshold;

        // 过密导致能量加速消耗（资源竞争）
        const competitionCost = excess * (1 + this.speciesDominance) * 0.2;
        this.energy -= competitionCost;
        this.health -= excess * 0.008 * (1 + this.speciesDominance);

        // 极度拥挤 → 直接概率性死亡（类似生命游戏的 overpopulation）
        const overpopDeathChance = excess * 0.005 * (1 + this.speciesDominance * 2);
        if (Math.random() < overpopDeathChance) {
          this.die(DeathCause.Overcrowding);
          return;
        }

        // 健康值耗尽也会过密致死
        if (this.health <= 0) {
          this.die(DeathCause.Overcrowding);
          return;
        }
      } else if (this.localDensity < 0.3) {
        // 低密度时健康缓慢恢复
        this.health = Math.min(1.0, this.health + 0.002);
      } else {
        // 中等密度时健康微弱恢复
        this.health = Math.min(1.0, this.health + 0.001);
      }
    }

    // 4. 疾病
    //    高密度 + 低健康 + 物种垄断 = 疾病爆发风险升高
    if (this.localDensity > 0.4 && this.health < 0.5) {
      const diseaseChance = (1 - this.health) * this.localDensity
                            * (1 + this.speciesDominance) * 0.001;
      if (Math.random() < diseaseChance) {
        this.die(DeathCause.Disease);
        return;
      }
    }

    // 5. 年老体衰：接近最大年龄时，随机死亡概率上升
    const ageRatio = this.age / this.maxAge;
    if (ageRatio > 0.8) {
      const elderlyDeathChance = (ageRatio - 0.8) * 0.003;
      if (Math.random() < elderlyDeathChance) {
        this.die(DeathCause.OldAge);
        return;
      }
    }
  }

  /** 是否可以繁殖 */
  canReproduce(): boolean {
    // 各物种达到性成熟的最低年龄不同
    // 微生物：几乎立刻可以分裂（r-策略）
    // 动物：需要较长时间发育到成年（K-策略）
    let minAge: number;
    switch (this.type) {
      case OrganismType.Microbe: minAge = 30;  break; // 极快成熟
      case OrganismType.Plant:   minAge = 80;  break; // 较快
      case OrganismType.Insect:  minAge = 60;  break; // 中等
      case OrganismType.Animal:  minAge = 400; break; // 慢成熟
    }
    return this.alive &&
           this.energy >= this.reproThreshold &&
           this.reproductionCooldown <= 0 &&
           this.age > minAge &&
           this.health > 0.3;
  }

  /** 序列化为可传输数据 */
  serialize(): OrganismData {
    return {
      id: this.id,
      type: this.type,
      dna: this.dna,
      energy: this.energy,
      age: this.age,
      maxAge: this.maxAge,
      position: { ...this.position },
      velocity: { ...this.velocity },
      alive: this.alive,
      speciesId: this.speciesId,
    };
  }
}
