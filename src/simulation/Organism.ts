// ============================================
// 生命体 Organism
// ============================================

import { Gene, OrganismType, OrganismData, Vec3, DeathCause, Gender, BASE_TPS, SeededRandom } from '../types';

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

  /** 大气 O₂ 浓度（由 World 每 tick 更新） */
  o2Level: number;

  /** 有害气体浓度（由 World 每 tick 更新） */
  toxicGasLevel: number;

  /**
   * 当前活跃度 [0.15, 1.0]（由 World 每 tick 根据昼夜和夜行性计算）
   * - 昼行动物白天 → 1.0，夜间 → 0.15
   * - 夜行动物夜间 → 1.0，白天 → 0.15
   */
  activityLevel: number;

  /** 是否处于水域中（由 World 每 tick 更新） */
  isInWater: boolean;

  /** 当前位置的水深度 [0, 1]（由 World 每 tick 更新） */
  waterDepth: number;

  // ---- 性别与繁殖 ----
  /** 性别（微生物/植物无性别） */
  gender: Gender;

  /**
   * 饱腹度 [0, 1]
   * 0 = 空腹/饥饿，1 = 完全饱腹
   * 饱腹时不会进食
   */
  satiety: number;

  /**
   * 发情期剩余 tick 数
   * >0 时处于发情期（仅雌性动物/昆虫有效）
   */
  estrusRemaining: number;

  /**
   * 发情期冷却 tick 数
   * 发情期结束后需要冷却一段时间才能再次进入发情
   */
  estrusCooldown: number;

  /**
   * 是否已受精（仅雌性）
   * 受精后会在一段时间后产下后代
   */
  isFertilized: boolean;

  /** 受精后妊娠计时器 */
  gestationTimer: number;

  /**
   * 朝向角度（弧度）：生命体面朝的方向
   * 使用 atan2(vx, vz) 约定，0 = +Z 方向，PI/2 = +X 方向
   * 在移动时平滑插值到速度方向
   */
  facing: number;

  /**
   * 进食计时器（捕食成功后原地进食）
   * >0 时表示正在进食中，不会移动或执行其他行为
   * 单位为归一化 tick（乘以 dt 递减）
   */
  feedingTimer: number;

  constructor(type: OrganismType, dna: number[], position: Vec3, rng?: SeededRandom) {
    const r = rng ? () => rng.next() : Math.random;

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
    this.o2Level = 1.0;
    this.toxicGasLevel = 0;
    this.activityLevel = 1.0;
    this.isInWater = false;
    this.waterDepth = 0;

    // 性别：微生物和植物无性别，昆虫/动物随机
    if (type === OrganismType.Microbe || type === OrganismType.Plant) {
      this.gender = Gender.None;
    } else {
      this.gender = r() < 0.5 ? Gender.Female : Gender.Male;
    }

    this.satiety = 0.6; // 初始中等饱腹
    this.estrusRemaining = 0;
    // 初始发情冷却随机错开，避免所有雌性同时进入发情期
    this.estrusCooldown = type === OrganismType.Animal
      ? 100 + Math.floor(r() * 400)
      : 50 + Math.floor(r() * 150);
    this.isFertilized = false;
    this.gestationTimer = 0;

    // 随机初始朝向
    this.facing = r() * Math.PI * 2;

    // 进食计时器（非进食状态）
    this.feedingTimer = 0;
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
    // 基准值以 BASE_TPS=3 为准，实际 TPS 会在 World.constructor 中设置
    // 此处无法获取 TPS，所以在 World 初始化时通过 scaleTimers() 统一缩放
    const baseAge = this.type === OrganismType.Microbe ? 2500 :
                    this.type === OrganismType.Plant ? 28000 :
                    this.type === OrganismType.Insect ? 5000 :
                                                       20000;
    const sizeBonus = this.dna[Gene.BodySize] * 2000;
    const metabolismPenalty = this.dna[Gene.Metabolism] * 2500;
    const minAge = this.type === OrganismType.Microbe ? 800 :
                   this.type === OrganismType.Plant ? 5000 :
                   this.type === OrganismType.Insect ? 1500 : 5000;
    return Math.max(minAge, Math.floor(baseAge + sizeBonus - metabolismPenalty));
  }

  /**
   * 按 TPS 缩放所有 tick 计数器类型的持续时间
   * 在 World 初始化完成后调用一次
   * @param tpsRatio 实际 TPS / BASE_TPS（如 10/3 ≈ 3.33）
   */
  scaleTimers(tpsRatio: number): void {
    this.maxAge = Math.floor(this.maxAge * tpsRatio);
    this.estrusCooldown = Math.floor(this.estrusCooldown * tpsRatio);
  }

  /** 获取体型 */
  get size(): number {
    return this.dna[Gene.BodySize];
  }

  /** 获取移动速度（流线型体型有速度加成） */
  get speed(): number {
    const base = this.dna[Gene.MoveSpeed];
    // 流线型 (bodyShape→1) 最多 +0.5 速度
    const shapeBonus = (this.dna[Gene.BodyShape] ?? 0.5) * 0.5;
    return base + shapeBonus;
  }

  /** 获取感知范围 */
  get senseRange(): number {
    return this.dna[Gene.SenseRange];
  }

  /** 获取攻击力 */
  get attack(): number {
    return this.dna[Gene.Attack];
  }

  /** 获取防御力（紧凑型体型有防御加成） */
  get defense(): number {
    const base = this.dna[Gene.Defense];
    // 紧凑型 (bodyShape→0) 最多 +1.0 防御
    const shapeBonus = (1 - (this.dna[Gene.BodyShape] ?? 0.5)) * 1.0;
    return base + shapeBonus;
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

  /** 获取水生适应性 [0=纯陆生, 1=纯水生] */
  get aquatic(): number {
    return this.dna[Gene.Aquatic] ?? 0;
  }

  /** 获取体型形态 [0=圆润紧凑, 1=流线修长] */
  get bodyShape(): number {
    return this.dna[Gene.BodyShape] ?? 0.5;
  }

  /** 获取体色色相 [0, 1] */
  get colorHue(): number {
    return this.dna[Gene.ColorHue] ?? 0.5;
  }

  /** 获取体色明度 [0=深色, 1=亮色] */
  get colorLightness(): number {
    return this.dna[Gene.ColorLightness] ?? 0.5;
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

    // 水陆适应性修正：
    // 水生生物在水中消耗低（aquatic=1 → 0.6×），在陆地消耗高（aquatic=1 → 1.4×）
    // 陆生生物在水中消耗高（aquatic=0 → 1.5×），在陆地正常（aquatic=0 → 1.0×）
    let terrainMod = 1.0;
    if (this.isInWater) {
      terrainMod = 1.5 - this.aquatic * 0.9; // aquatic=1 → 0.6, aquatic=0 → 1.5
    } else {
      terrainMod = 1.0 + this.aquatic * 0.4;  // aquatic=1 → 1.4, aquatic=0 → 1.0
    }

    // 怀孕能量消耗增加（需要额外营养供给胎儿/蛋）
    const pregnancyMod = this.isPregnant ? 1.3 : 1.0;

    return rawCost * activityMod * terrainMod * pregnancyMod;
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

  /** 获取发情期周期长度（多少 tick 进入一次发情） */
  get estrusCyclePeriod(): number {
    return this.type === OrganismType.Animal ? 500 : 200;
  }

  /** 获取发情期持续时间 */
  get estrusDuration(): number {
    return this.type === OrganismType.Animal ? 100 : 60;
  }

  /** 获取妊娠期长度（哺乳动物长于昆虫） */
  get gestationPeriod(): number {
    return this.type === OrganismType.Animal ? 200 : 80;
  }

  /** 是否处于发情期 */
  get isInEstrus(): boolean {
    return this.gender === Gender.Female && this.estrusRemaining > 0;
  }

  /**
   * 是否正在释放交配信号（信息素/求偶鸣叫/发光等）
   * - 雌性发情期 → 释放信息素
   * - 雄性在繁殖就绪时 → 释放求偶信号
   */
  get isEmittingMatingSignal(): boolean {
    if (this.gender === Gender.Female) {
      return this.estrusRemaining > 0 && !this.isFertilized;
    }
    if (this.gender === Gender.Male) {
      return this.canMate();
    }
    return false;
  }

  /**
   * 交配信号传播范围（信息素扩散距离）
   * 比普通感知范围大 2 倍，模拟气味/声音的远距离传播
   */
  get matingSignalRange(): number {
    return this.senseRange * 2.0;
  }

  /** 是否处于怀孕/妊娠状态 */
  get isPregnant(): boolean {
    return this.gender === Gender.Female && this.isFertilized && this.gestationTimer > 0;
  }

  /**
   * 怀孕进度 [0, 1]
   * 0 = 刚受精, 1 = 即将分娩/产卵
   */
  get pregnancyProgress(): number {
    if (!this.isPregnant) return 0;
    const totalGestation = this.gestationPeriod;
    // gestationTimer 从 gestationPeriod*tpsRatio 递减到 0
    // 计算进度: 1 - (remaining / total_scaled)
    // 由于 totalGestation 是未缩放值，而 gestationTimer 已经缩放了
    // 需要使用 _gestationMax 记录初始值
    if ((this as any)._gestationMax) {
      return 1 - this.gestationTimer / (this as any)._gestationMax;
    }
    return 0;
  }

  /** 是否饱腹（不需要进食） */
  get isFull(): boolean {
    return this.satiety > 0.85;
  }

  /** 是否正在原地进食猎物 */
  get isFeeding(): boolean {
    return this.feedingTimer > 0;
  }

  /** 饱腹容量（基于体型） */
  get stomachCapacity(): number {
    return this.size * 30;
  }

  /**
   * 消耗能量并老化，检测多种死亡条件
   * @param dt 时间步长归一化因子（BASE_TPS / 实际TPS），连续效果需乘以此值
   */
  tick(dt: number = 1): void {
    if (!this.alive) return;

    this.age++;
    this.energy -= this.energyCost * dt;

    if (this.reproductionCooldown > 0) {
      this.reproductionCooldown--;
    }

    // ---- 进食计时器递减 ----
    if (this.feedingTimer > 0) {
      this.feedingTimer -= dt;
      if (this.feedingTimer < 0) this.feedingTimer = 0;
    }

    // ---- 饱腹度衰减（乘 dt 归一化） ----
    const satietyDecay = (this.metabolism * 0.003 + 0.001) * dt;
    this.satiety = Math.max(0, this.satiety - satietyDecay);

    // ---- 发情期周期（仅雌性动物/昆虫） ----
    if (this.gender === Gender.Female &&
        (this.type === OrganismType.Animal || this.type === OrganismType.Insect)) {
      if (this.estrusRemaining > 0) {
        this.estrusRemaining--;
      } else if (this.estrusCooldown > 0) {
        this.estrusCooldown--;
      } else if (this.health > 0.5 && this.energy > this.reproThreshold * 0.5) {
        // 进入发情期（需要健康和一定能量）
        // 持续时间按 tpsRatio 缩放
        const tpsRatio = 1 / dt;
        this.estrusRemaining = Math.floor(this.estrusDuration * tpsRatio);
        this.estrusCooldown = Math.floor(this.estrusCyclePeriod * tpsRatio);
      }

      // 妊娠计时
      if (this.isFertilized) {
        this.gestationTimer--;
        if (this.gestationTimer <= 0) {
          this.isFertilized = false;
        }
      }
    }

    // 微生物通过分解/吸收从环境获取能量（乘 dt 归一化）
    if (this.type === OrganismType.Microbe) {
      const densityFactor = Math.max(0.1, 1 - this.localDensity * 0.5);
      this.energy += (0.06 + this.metabolism * 0.08) * densityFactor * dt;
    }

    // 植物通过光合作用获取能量（乘 dt 归一化）
    if (this.type === OrganismType.Plant) {
      const densityFactor = Math.max(0.2, 1 - this.localDensity * 0.3);
      const co2Factor = Math.min(1.3, this.co2Level);
      const o2Inhibition = this.o2Level > 1.5
        ? Math.max(0.3, 1 - (this.o2Level - 1.5) * 0.4)
        : 1.0;
      this.energy += (0.1 + this.size * 0.06) * densityFactor * co2Factor * o2Inhibition * dt;
    }

    // ---- 多因素死亡检测 ----

    // 1. 饿死
    if (this.energy <= 0) {
      this.die(DeathCause.Starvation);
      return;
    }

    // 2. 自然老死
    if (this.age >= this.maxAge) {
      this.die(DeathCause.OldAge);
      return;
    }

    // 3. 过密致死
    {
      const baseOverpopThreshold = this.type === OrganismType.Microbe ? 30 :
                                    this.type === OrganismType.Plant ? 18 :
                                    this.type === OrganismType.Insect ? 12 : 5;
      const dominancePenalty = this.speciesDominance * this.speciesDominance;
      const effectiveThreshold = baseOverpopThreshold * (1 - dominancePenalty * 0.5);

      if (this.sameSpeciesNeighbors > effectiveThreshold) {
        const excess = (this.sameSpeciesNeighbors - effectiveThreshold) / effectiveThreshold;
        const competitionCost = excess * (1 + this.speciesDominance) * 0.2 * dt;
        this.energy -= competitionCost;
        this.health -= excess * 0.008 * (1 + this.speciesDominance) * dt;

        const overpopDeathChance = excess * 0.005 * (1 + this.speciesDominance * 2) * dt;
        if (Math.random() < overpopDeathChance) {
          this.die(DeathCause.Overcrowding);
          return;
        }
        if (this.health <= 0) {
          this.die(DeathCause.Overcrowding);
          return;
        }
      } else if (this.localDensity < 0.3) {
        this.health = Math.min(1.0, this.health + 0.002 * dt);
      } else {
        this.health = Math.min(1.0, this.health + 0.001 * dt);
      }
    }

    // 4. 疾病
    if (this.localDensity > 0.4 && this.health < 0.5) {
      const diseaseChance = (1 - this.health) * this.localDensity
                            * (1 + this.speciesDominance) * 0.001 * dt;
      if (Math.random() < diseaseChance) {
        this.die(DeathCause.Disease);
        return;
      }
    }

    // 5a. 缺氧（乘 dt）
    if (this.type !== OrganismType.Plant && this.o2Level < 0.5) {
      const suffocateRate = (0.5 - this.o2Level) * 0.02 * dt;
      this.health -= suffocateRate;
      this.energy -= suffocateRate * 1.5;
      if (this.health <= 0) {
        this.die(DeathCause.Environmental);
        return;
      }
    }

    // 5b. 有害气体中毒（乘 dt）
    if (this.toxicGasLevel > 0.3) {
      const toxicSensitivity = this.type === OrganismType.Plant ? 0.3 : 1.0;
      const toxicDamage = (this.toxicGasLevel - 0.3) * 0.008 * toxicSensitivity * dt;
      this.health -= toxicDamage;
      this.energy -= toxicDamage * 0.5;
      if (this.health <= 0) {
        this.die(DeathCause.Environmental);
        return;
      }
    }

    // 5c. 溺水（乘 dt）
    if (this.isInWater && this.aquatic < 0.4) {
      const drownRate = (1 - this.aquatic) * this.waterDepth * 0.015 * dt;
      this.health -= drownRate;
      this.energy -= drownRate * 2;
      if (this.health <= 0) {
        this.die(DeathCause.Environmental);
        return;
      }
    }

    // 6. 年老体衰（概率乘 dt）
    const ageRatio = this.age / this.maxAge;
    if (ageRatio > 0.8) {
      const elderlyDeathChance = (ageRatio - 0.8) * 0.003 * dt;
      if (Math.random() < elderlyDeathChance) {
        this.die(DeathCause.OldAge);
        return;
      }
    }
  }

  /**
   * 是否可以繁殖
   * - 微生物/植物：无性繁殖，只需能量和年龄
   * - 昆虫/动物雌性：需要处于发情期或已受精且妊娠完成
   * - 昆虫/动物雄性：不直接繁殖，而是"受精"雌性
   */
  canReproduce(): boolean {
    // 各物种达到性成熟的最低年龄不同
    let minAge: number;
    switch (this.type) {
      case OrganismType.Microbe: minAge = 30;  break;
      case OrganismType.Plant:   minAge = 80;  break;
      case OrganismType.Insect:  minAge = 60;  break;
      case OrganismType.Animal:  minAge = 400; break;
    }

    const baseCondition = this.alive &&
           this.energy >= this.reproThreshold &&
           this.reproductionCooldown <= 0 &&
           this.age > minAge &&
           this.health > 0.3;

    if (!baseCondition) return false;

    // 微生物/植物无性繁殖 → 直接满足
    if (this.gender === Gender.None) return true;

    // 有性别的物种
    if (this.gender === Gender.Female) {
      // 雌性：必须已受精且妊娠完成
      return !this.isFertilized && this.gestationTimer <= 0;
    }

    // 雄性不直接"繁殖"，而是参与受精
    return false;
  }

  /**
   * 雄性是否可以参与交配（受精雌性）
   */
  canMate(): boolean {
    let minAge: number;
    switch (this.type) {
      case OrganismType.Insect:  minAge = 60;  break;
      case OrganismType.Animal:  minAge = 400; break;
      default: return false;
    }
    return this.alive &&
           this.gender === Gender.Male &&
           this.energy >= this.reproThreshold * 0.4 &&
           this.reproductionCooldown <= 0 &&
           this.age > minAge &&
           this.health > 0.3;
  }

  /** 进食增加饱腹度 */
  feed(foodEnergy: number): void {
    const satietyGain = foodEnergy / this.stomachCapacity;
    this.satiety = Math.min(1.0, this.satiety + satietyGain);
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
