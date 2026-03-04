// ============================================
// DNA 系统 - 基因编码、重组与突变
// ============================================

import { Gene, GENE_RANGES, OrganismType, SeededRandom } from '../types';

/**
 * 将基因值限制在合法范围内
 */
function clampGene(index: number, value: number): number {
  const [min, max] = GENE_RANGES[index];
  return Math.max(min, Math.min(max, value));
}

/** 获取随机数：优先使用 PRNG，否则回退 Math.random() */
function rand(rng?: SeededRandom): number {
  return rng ? rng.next() : Math.random();
}

/**
 * 生成随机 DNA
 * @param type 生命体类型
 * @param rng 可选的播种随机数生成器（传入则确定性生成）
 */
export function createRandomDNA(type: OrganismType, rng?: SeededRandom): number[] {
  const dna = new Array(Gene.COUNT);

  for (let i = 0; i < Gene.COUNT; i++) {
    const [min, max] = GENE_RANGES[i];
    dna[i] = min + rand(rng) * (max - min);
  }

  // 根据生命体类型调整初始 DNA 倾向
  // 设计原则：模拟真实生态金字塔
  //   微生物：极小、极慢、极快繁殖、极低能耗
  //   植物：静止、长寿、被动光合
  //   昆虫：小型、敏捷、中速繁殖
  //   动物：大型、中速、慢繁殖、高能耗
  switch (type) {
    case OrganismType.Microbe:
      // 微生物：细菌/原生生物，几乎不动，靠分裂快速繁殖
      dna[Gene.BodySize] = 0.3 + rand(rng) * 0.1;     // 极小 (0.3~0.4)
      dna[Gene.MoveSpeed] = 0.05 + rand(rng) * 0.25;  // 几乎不动 (0.05~0.3)
      dna[Gene.SenseRange] = 2 + rand(rng) * 5;       // 极小感知 (2~7)
      dna[Gene.Attack] = rand(rng) * 0.8;             // 极低攻击
      dna[Gene.Defense] = rand(rng) * 0.5;            // 极低防御
      dna[Gene.Metabolism] = 0.05 + rand(rng) * 0.1;  // 极低代谢 (0.05~0.15)
      dna[Gene.ReproThreshold] = 18 + rand(rng) * 15; // 极低阈值 (18~33) → 超快繁殖
      dna[Gene.Aggression] = rand(rng);
      dna[Gene.FleeInclination] = rand(rng) * 0.2;    // 几乎不逃跑
      dna[Gene.DietType] = rand(rng);
      dna[Gene.Nocturnality] = rand(rng) * 0.3;       // 基本不受昼夜影响
      // ---- 形态基因 ----
      // ~30% 水生微生物（浮游菌、藻类），其余陆生
      dna[Gene.Aquatic] = rand(rng) < 0.3
        ? 0.6 + rand(rng) * 0.4
        : rand(rng) * 0.25;
      dna[Gene.BodyShape] = rand(rng) * 0.3;          // 多为圆润/不规则形态
      dna[Gene.ColorHue] = 0.4 + rand(rng) * 0.25;    // 青绿色系 (144°~234°)
      dna[Gene.ColorLightness] = 0.4 + rand(rng) * 0.3;
      break;

    case OrganismType.Plant:
      // 植物：完全静止，靠光合作用，寿命最长
      dna[Gene.MoveSpeed] = 0;
      dna[Gene.Attack] = 0;
      dna[Gene.Aggression] = 0;
      dna[Gene.FleeInclination] = 0;
      dna[Gene.DietType] = 0;
      dna[Gene.BodySize] = 0.3 + rand(rng) * 0.7;    // (0.3~1.0)
      dna[Gene.SenseRange] = 0;
      dna[Gene.Metabolism] = 0.05 + rand(rng) * 0.15; // 极低代谢 (0.05~0.2)
      dna[Gene.ReproThreshold] = 30 + rand(rng) * 25; // 低阈值 (30~55) → 种子传播
      dna[Gene.Nocturnality] = 0;
      // ---- 形态基因 ----
      // ~15% 水生植物（睡莲、水草），其余陆生
      dna[Gene.Aquatic] = rand(rng) < 0.15
        ? 0.7 + rand(rng) * 0.3
        : rand(rng) * 0.15;
      dna[Gene.BodyShape] = 0.3 + rand(rng) * 0.4;    // 中等形态（树干较直）
      dna[Gene.ColorHue] = 0.22 + rand(rng) * 0.18;   // 绿色系 (79°~144°)
      dna[Gene.ColorLightness] = 0.25 + rand(rng) * 0.35;
      break;

    case OrganismType.Insect:
      // 昆虫：小型、敏捷、中速繁殖，r-策略繁殖者
      dna[Gene.BodySize] = 0.3 + rand(rng) * 0.3;     // 小型 (0.3~0.6)
      dna[Gene.MoveSpeed] = 2.0 + rand(rng) * 2.5;    // 敏捷 (2.0~4.5)
      dna[Gene.SenseRange] = 8 + rand(rng) * 15;      // 中等感知 (8~23)
      dna[Gene.Attack] = rand(rng) * 3;
      dna[Gene.Defense] = rand(rng) * 2;
      dna[Gene.Metabolism] = 0.3 + rand(rng) * 0.4;   // 中等代谢 (0.3~0.7)
      dna[Gene.ReproThreshold] = 35 + rand(rng) * 25; // 较低阈值 (35~60) → 较快繁殖
      dna[Gene.DietType] = rand(rng) * 0.6;
      dna[Gene.Aggression] = rand(rng) * 0.5;
      dna[Gene.FleeInclination] = 0.3 + rand(rng) * 0.5;
      // 昆虫：~70% 昼行，~30% 夜行（飞蛾、萤火虫）
      dna[Gene.Nocturnality] = rand(rng) < 0.3
        ? 0.6 + rand(rng) * 0.4
        : rand(rng) * 0.4;
      // ---- 形态基因 ----
      // ~15% 水生节肢（水蜘蛛、蜻蜓幼虫），其余陆生
      dna[Gene.Aquatic] = rand(rng) < 0.15
        ? 0.6 + rand(rng) * 0.4
        : rand(rng) * 0.2;
      dna[Gene.BodyShape] = 0.2 + rand(rng) * 0.7;    // 多样形态
      dna[Gene.ColorHue] = rand(rng);                   // 色彩丰富（拟态/警戒色）
      dna[Gene.ColorLightness] = 0.3 + rand(rng) * 0.4;
      break;

    case OrganismType.Animal:
      // 动物（哺乳类）：大型、中速移动、K-策略繁殖者（慢繁殖、高投入）
      dna[Gene.BodySize] = 1.2 + rand(rng) * 1.8;     // 大型 (1.2~3.0)
      dna[Gene.MoveSpeed] = 1.5 + rand(rng) * 2.0;    // 中等速度 (1.5~3.5)
      dna[Gene.SenseRange] = 15 + rand(rng) * 25;     // 大感知范围 (15~40)
      dna[Gene.Metabolism] = 0.5 + rand(rng) * 0.7;   // 较高代谢 (0.5~1.2)
      dna[Gene.ReproThreshold] = 120 + rand(rng) * 60; // 高阈值 (120~180) → 慢繁殖
      dna[Gene.DietType] = rand(rng);
      // 根据食性倾向调整攻防
      if (dna[Gene.DietType] > 0.6) {
        // 食肉 → 高攻击（如狼、豹）
        dna[Gene.Attack] = 5 + rand(rng) * 5;
        dna[Gene.Defense] = 2 + rand(rng) * 3;
        dna[Gene.Aggression] = 0.5 + rand(rng) * 0.5;
        dna[Gene.FleeInclination] = rand(rng) * 0.3;
      } else if (dna[Gene.DietType] < 0.3) {
        // 食草 → 高防御、善逃（如鹿、牛）
        dna[Gene.Attack] = rand(rng) * 2;
        dna[Gene.Defense] = 4 + rand(rng) * 5;
        dna[Gene.Aggression] = rand(rng) * 0.15;
        dna[Gene.FleeInclination] = 0.5 + rand(rng) * 0.5;
      } else {
        // 杂食 → 均衡（如熊、猪）
        dna[Gene.Attack] = 2 + rand(rng) * 5;
        dna[Gene.Defense] = 2 + rand(rng) * 5;
        dna[Gene.Aggression] = 0.2 + rand(rng) * 0.5;
        dna[Gene.FleeInclination] = 0.2 + rand(rng) * 0.5;
      }
      // ~80% 昼行（牛、鹿），~20% 夜行（狼、猫头鹰）
      dna[Gene.Nocturnality] = rand(rng) < 0.2
        ? 0.7 + rand(rng) * 0.3
        : rand(rng) * 0.3;
      // ---- 形态基因 ----
      // ~20% 水生动物（鱼、水獭），其余陆生
      dna[Gene.Aquatic] = rand(rng) < 0.2
        ? 0.6 + rand(rng) * 0.4
        : rand(rng) * 0.2;
      // 体型形态与食性关联：食肉→流线，食草→紧凑
      if (dna[Gene.DietType] > 0.6) {
        dna[Gene.BodyShape] = 0.5 + rand(rng) * 0.5;  // 流线型猎手
      } else if (dna[Gene.DietType] < 0.3) {
        dna[Gene.BodyShape] = 0.1 + rand(rng) * 0.35; // 紧凑型食草
      } else {
        dna[Gene.BodyShape] = 0.2 + rand(rng) * 0.6;  // 杂食多样
      }
      dna[Gene.ColorHue] = rand(rng);                   // 各色皮毛
      dna[Gene.ColorLightness] = 0.2 + rand(rng) * 0.45;
      // 水生动物倾向流线型
      if (dna[Gene.Aquatic] > 0.5) {
        dna[Gene.BodyShape] = Math.max(dna[Gene.BodyShape], 0.6 + rand(rng) * 0.4);
      }
      break;
  }

  return dna;
}

/**
 * 有性繁殖 - 基因重组 + 突变
 * 从两个父代的 DNA 中产生子代 DNA
 */
export function crossoverAndMutate(parentA: number[], parentB: number[], rng?: SeededRandom): number[] {
  const child = new Array(Gene.COUNT);
  const mutationRate = (parentA[Gene.MutationRate] + parentB[Gene.MutationRate]) / 2;

  for (let i = 0; i < Gene.COUNT; i++) {
    // 基因重组：随机选择父代之一的基因，或取中间值
    const r = rand(rng);
    if (r < 0.4) {
      child[i] = parentA[i];
    } else if (r < 0.8) {
      child[i] = parentB[i];
    } else {
      // 混合
      const t = rand(rng);
      child[i] = parentA[i] * t + parentB[i] * (1 - t);
    }

    // 突变
    if (rand(rng) < mutationRate) {
      const [min, max] = GENE_RANGES[i];
      const range = max - min;
      // 高斯突变
      const mutation = (rand(rng) + rand(rng) + rand(rng) - 1.5) * range * 0.15;
      child[i] = clampGene(i, child[i] + mutation);
    }
  }

  return child;
}

/**
 * 无性繁殖（植物分裂） - 微小突变
 */
export function asexualReproduce(parent: number[], rng?: SeededRandom): number[] {
  const child = new Array(Gene.COUNT);
  const mutationRate = parent[Gene.MutationRate];

  for (let i = 0; i < Gene.COUNT; i++) {
    child[i] = parent[i];
    if (rand(rng) < mutationRate) {
      const [min, max] = GENE_RANGES[i];
      const range = max - min;
      const mutation = (rand(rng) - 0.5) * range * 0.1;
      child[i] = clampGene(i, child[i] + mutation);
    }
  }

  return child;
}

/**
 * 计算两个 DNA 之间的相似度 [0, 1]
 * 用于物种分类
 */
export function dnaSimilarity(a: number[], b: number[]): number {
  let totalDiff = 0;
  for (let i = 0; i < Gene.COUNT; i++) {
    const [min, max] = GENE_RANGES[i];
    const range = max - min;
    if (range > 0) {
      totalDiff += Math.abs(a[i] - b[i]) / range;
    }
  }
  return 1 - totalDiff / Gene.COUNT;
}
