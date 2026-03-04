# 🌍 ALife — Web 3D 人工生命演化模拟器

<p align="center">
  <strong>在浏览器中观察生命的诞生、演化与自然选择</strong>
</p>

一个运行在浏览器中的 3D 人工生命模拟系统。在程序化生成的自然地形中，模拟微生物、植物、昆虫和动物四大生命类群。每个生命体拥有 16 维 DNA 基因组、能量与饱腹度系统、性别与发情繁殖机制、参数化行为决策引擎，支持自然选择与物种演化。

---

## ✨ 核心特性

### 🧬 DNA 驱动系统
- **16 维基因编码**：体型、速度、感知范围、攻击力、防御力、代谢率、繁殖阈值、攻击倾向、逃跑倾向、食性、突变率、昼夜习性、水生适应性、体型形态、体色色相、体色明度
- DNA 直接影响生命体的 **3D 外形**（颜色、大小、形状）和 **行为**（移动方式、速度、习性、水生/陆生）
- 有性繁殖（基因交叉重组 + 突变）和无性繁殖（分裂）
- 行为决策完全由 DNA 参数控制，无硬编码规则

### 🌿 真实生态金字塔
- **微生物** 🦠：极小、几乎不动、极快分裂繁殖（r-策略极端）、分解者/腐生菌/寄生菌
- **植物** 🌳：静止、光合作用、寿命最长、程序化生成的树干+树枝+多层树叶模型
- **昆虫** 🦋：小型、敏捷、中速繁殖、卵生孵化、部分夜间发光（萤火虫效果）
- **动物** 🐺：大型、中速、慢繁殖（K-策略）、胎生（怀孕→分娩）
- 种群数量呈金字塔分布：微生物 >> 植物 > 昆虫 > 动物

### 🚻 性别与繁殖系统
- **无性繁殖**：微生物（分裂）、植物（种子传播）
- **有性繁殖**：昆虫和动物
  - 雌雄性别分化，雌性周期性进入 **发情期**
  - 发情雌性释放 **交配信号**（信息素/求偶鸣叫）→ 吸引同种雄性
  - 受精后：哺乳动物（Animal）经历 **妊娠期** → 活产；昆虫产 **卵** → 孵化
  - 繁殖需要满足能量、健康、发情条件

### 🍖 饱腹度与觅食系统
- 生命体拥有 **饱腹度**（Satiety）指标：0=饥饿，1=饱腹
- 饱腹时不会主动进食或捕猎（除非极具攻击性）
- 饱腹度随代谢速率衰减，驱动周期性觅食行为
- 捕食成功后原地 **进食**（有进食计时器）

### 💀 多因素死亡系统
- **饿死**：能量耗尽
- **自然老死**：达到最大年龄
- **被捕食**：被其他生命体攻击致死
- **过密致死**：同类竞争压力
- **疾病**：高密度 + 低健康 + 物种垄断 → 疫病爆发
- **环境灾害**：干旱、瘟疫、寒潮等随机事件
- **缺氧/中毒**：O₂ 耗尽或有害气体浓度过高

### 💀 尸体与食腐系统
- 动物/昆虫死后留下 **尸体**，在场景中逐渐腐烂
- 尸体散发 **气味**，吸引食腐动物和微生物前来进食
- 尸体附近自动滋生 **腐生菌**（分解者微生物）
- 完整的营养物质循环：尸体 → 分解 → CO₂ → 植物光合 → 食物链

### 🌬️ 大气三循环系统
- **CO₂ 碳循环**：动物/昆虫/微生物呼吸产生 CO₂ → 植物光合消耗 CO₂ → 地质活动补充
- **O₂ 氧循环**：植物光合产生 O₂ → 动物/昆虫/微生物呼吸消耗 O₂
- **有害气体**：高密度有机分解产生 → 植物吸收净化 → 自然消散
- 动物灭绝 → CO₂ 枯竭 → 植物也会死亡 → 生态崩溃

### 🌓 昼夜活动周期
- 3 分钟一个完整昼夜循环，包含日出、正午、日落、午夜等阶段
- 大部分动物昼行夜息，少部分物种昼伏夜出（由 DNA `Nocturnality` 基因控制）
- 休息时感知、速度、行为活跃度降低，能量消耗减少
- 夜间 **星空闪烁** + **月亮** 照亮地面
- 夜行昆虫具有 **生物发光** 效果（萤火虫呼吸灯）

### 🏔️ 程序化地形系统
- 基于 **Value Noise + fBm** 的程序化地形生成
- 连绵丘陵 + 大尺度山脉 + 细节起伏
- 蜿蜒河流（主河 + 支流）自动切割地形
- 水面动态波纹效果
- 所有地形参数可在设置中调节（高度、起伏度、水位、河流宽度）
- 支持 **随机种子**：相同种子生成完全相同的世界（地形、初始物种、DNA）

### 🦴 生命体朝向与运动
- 生命体拥有 **朝向角度**（facing），移动时朝头部方向前进
- 移动过程中平滑插值旋转到速度方向
- 不同物种有不同转向速率（微生物最灵活，动物较迟缓）

### 🎮 交互功能
- **点击选中**生命体查看详细信息（暂停/运行时均可）
- 详情卡片显示 DNA 基因组（默认折叠）、3D 模型预览（自动旋转）
- 选中后按 **`F`** 聚焦，镜头实时跟随
- **WASD** 键盘移动、鼠标拖拽旋转、滚轮缩放
- 三指拖拽平移（触屏支持）
- 左侧统计面板可折叠
- 底部 **物种数量实时走势图**（可折叠）
- **开始画面** + **参数设置面板**
- 暂停 / 继续 / 重新开始 / 变速控制

---

## 🏗️ 技术架构

```
浏览器主线程
├── Three.js 渲染层
│   ├── InstancedMesh GPU Instancing（高性能渲染数千生命体）
│   ├── 程序化地形生成（Value Noise + fBm + 河流切割）
│   ├── 昼夜循环系统（多阶段插值光照 + 星空 + 月亮）
│   ├── DNA 驱动的生命体 3D 模型（形态/颜色/大小由基因决定）
│   └── 帧间插值（Lerp）实现丝滑运动
├── 相机控制（OrbitControls 风格 + WASD + 多指触控）
├── UI 覆盖层
│   ├── 统计面板（物种数量、CO₂/O₂ 浓度、死因统计）
│   ├── 生命体详情卡片（DNA、3D 预览、性别/发情/饱腹度状态）
│   ├── 物种数量走势图（Canvas 2D 实时绘制）
│   └── 开始画面 + 设置模态框
└── Worker 消息通信

WebWorker 模拟线程
├── World（世界管理）
│   ├── 生态循环（CO₂ / O₂ / 有害气体三循环）
│   ├── 尸体系统（腐烂 + 滋生腐生菌 + 气味吸引食腐者）
│   ├── 蛋系统（产卵 + 孵化）
│   ├── 环境灾害（干旱 / 瘟疫 / 寒潮）
│   ├── 昼夜同步（活跃度计算）
│   └── Species Classifier（DNA 相似度物种聚类）
├── DNA Engine（16 维基因 · 创建 · 交叉重组 · 突变）
├── Behavior Engine（参数化行为决策 · 觅食 · 捕猎 · 逃跑 · 交配 · 食腐）
├── Organism（能量 · 饱腹度 · 性别 · 发情 · 妊娠 · 朝向 · 老化 · 死亡）
├── SpatialGrid（空间分区高效近邻查询）
└── SeededRandom（Mulberry32 确定性伪随机数生成器）
```

### 关键技术
- **Three.js** + **InstancedMesh**：GPU Instancing 渲染大量生命体，60 FPS
- **WebWorker**：模拟逻辑在独立线程运行，不阻塞 UI
- **帧间 Lerp 插值**：模拟更新与渲染帧率解耦，实现丝滑运动
- **SpatialGrid**：空间分区加速近邻查询
- **程序化生成**：Value Noise + fBm 地形、DNA 驱动的 3D 模型
- **Mulberry32 PRNG**：可播种随机数生成器，支持确定性世界复现
- **Canvas 2D**：实时物种数量走势图
- **GC 优化**：热路径预分配临时对象，避免渲染帧分配内存
- **TypeScript** + **Vite**：类型安全 + 快速开发

---

## 🚀 快速开始

### 环境要求
- Node.js >= 18
- 现代浏览器（Chrome / Firefox / Safari / Edge）

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/your-username/ALife.git
cd ALife

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

打开浏览器访问 `http://localhost:5173`，点击 **🚀 开始模拟** 即可。

### 构建生产版本

```bash
npm run build
npm run preview
```

---

## 📁 项目结构

```
ALife/
├── index.html              # 主页面（UI 布局 + 样式 + 设置面板）
├── src/
│   ├── main.ts             # 应用入口（UI 逻辑、Worker 通信、走势图、设置）
│   ├── types.ts            # 共享类型（DNA 基因定义、配置、PRNG、渲染数据）
│   ├── renderer/
│   │   └── Renderer.ts     # Three.js 渲染器（地形、光照、昼夜、星空月亮、模型）
│   └── simulation/
│       ├── worker.ts       # WebWorker 入口
│       ├── World.ts        # 世界系统（生态循环、大气、灾害、尸体、蛋）
│       ├── Organism.ts     # 生命体类（能量、饱腹度、性别、发情、妊娠、朝向）
│       ├── DNA.ts          # DNA 系统（16 维基因创建、交叉重组、突变）
│       ├── Behavior.ts     # 行为决策引擎（觅食、捕猎、逃跑、交配、食腐）
│       └── SpatialGrid.ts  # 空间分区网格
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## ⚙️ 可配置参数

通过开始画面的 **⚙ 设置** 按钮可调整：

### 物种参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 微生物初始数量 | 400 | 最多，无处不在的分解者 |
| 植物初始数量 | 600 | 食物网的稳定基础 |
| 昆虫初始数量 | 200 | 小型消费者 |
| 动物初始数量 | 80 | 大型消费者 / 顶级捕食者 |
| 微生物上限 | 1500 | 微生物承载量最高 |
| 植物上限 | 1200 | 植物承载量次之 |
| 世界大小 | 500 | 世界宽度和高度 |
| 模拟 TPS | 10 | 每秒模拟 tick 数 |

### 地形参数

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| 随机种子 | -1 | -1 ~ 999999999 | -1=每次随机，≥0 为固定种子 |
| 山脉高度倍率 | 1.0 | 0.2 ~ 3.0 | 控制地形整体高度 |
| 地形起伏度 | 1.0 | 0.2 ~ 3.0 | 控制地形细节频率 |
| 水位高度 | 1.5 | 0.0 ~ 5.0 | 水面高度 |
| 河流宽度倍率 | 1.0 | 0.0 ~ 3.0 | 0=无河流 |

---

## 🎮 操作指南

| 操作 | 说明 |
|------|------|
| 鼠标左键拖拽 | 旋转视角 |
| 鼠标滚轮 | 缩放 |
| 鼠标右键/中键拖拽 | 平移视角 |
| WASD | 键盘移动 |
| 三指拖拽 | 触屏平移 |
| 点击生命体 | 选中并查看详情 |
| F | 聚焦到选中生命体 |
| 空格 | 暂停/继续 |

---

## 📜 License

MIT

---

---

# 🌍 ALife — Web 3D Artificial Life Evolution Simulator

<p align="center">
  <strong>Observe the birth, evolution, and natural selection of life in your browser</strong>
</p>

A browser-based 3D artificial life simulation system. In a procedurally generated natural terrain, it simulates four major life groups — microbes, plants, insects, and animals. Each organism possesses a 16-dimensional DNA genome, energy and satiety systems, gender and estrus-based reproduction mechanics, and a parameterized behavior decision engine, supporting natural selection and species evolution.

---

## ✨ Core Features

### 🧬 DNA-Driven System
- **16-dimensional gene encoding**: body size, speed, sense range, attack, defense, metabolism, reproduction threshold, aggression, flee inclination, diet type, mutation rate, nocturnality, aquatic adaptation, body shape, color hue, color lightness
- DNA directly influences the organism's **3D appearance** (color, size, shape) and **behavior** (movement style, speed, habits, aquatic/terrestrial)
- Sexual reproduction (gene crossover + mutation) and asexual reproduction (fission)
- All behavioral decisions are controlled by DNA parameters — no hardcoded rules

### 🌿 Realistic Ecological Pyramid
- **Microbes** 🦠: Tiny, nearly immobile, extremely fast fission (extreme r-strategy), decomposers/saprophytes/parasites
- **Plants** 🌳: Sessile, photosynthesis, longest lifespan, procedurally generated trunk+branch+multi-layer leaf models
- **Insects** 🦋: Small, agile, medium reproduction, oviparous (egg-laying + hatching), some glow at night (firefly effect)
- **Animals** 🐺: Large, moderate speed, slow reproduction (K-strategy), viviparous (pregnancy → birth)
- Population follows a pyramid: Microbes >> Plants > Insects > Animals

### 🚻 Gender & Reproduction System
- **Asexual reproduction**: Microbes (fission), Plants (seed dispersal)
- **Sexual reproduction**: Insects and Animals
  - Male/Female gender differentiation, females periodically enter **estrus**
  - Estrus females emit **mating signals** (pheromones/courtship calls) → attract conspecific males
  - After fertilization: Mammals (Animal) undergo **gestation** → live birth; Insects lay **eggs** → hatching
  - Reproduction requires sufficient energy, health, and estrus conditions

### 🍖 Satiety & Foraging System
- Organisms have a **satiety** indicator: 0=hungry, 1=full
- Full organisms won't actively forage or hunt (unless highly aggressive)
- Satiety decays with metabolism rate, driving periodic foraging behavior
- After successful predation, organisms pause to **feed** (with a feeding timer)

### 💀 Multi-Factor Death System
- **Starvation**: Energy depleted
- **Old age**: Maximum lifespan reached
- **Predation**: Killed by other organisms
- **Overcrowding**: Conspecific competition pressure
- **Disease**: High density + low health + species monopoly → epidemic
- **Environmental disasters**: Drought, plague, cold snap, etc.
- **Suffocation/Poisoning**: O₂ depletion or toxic gas concentration

### 💀 Corpse & Scavenging System
- Dead animals/insects leave **corpses** that gradually decay in the scene
- Corpses emit **scent** that attracts scavenging animals and microbes
- **Saprophytic bacteria** (decomposer microbes) automatically spawn near corpses
- Complete nutrient cycling: Corpse → Decomposition → CO₂ → Plant photosynthesis → Food chain

### 🌬️ Triple Atmospheric Cycle
- **CO₂ Carbon Cycle**: Animal/insect/microbe respiration produces CO₂ → Plant photosynthesis consumes CO₂ → Geological activity replenishes
- **O₂ Oxygen Cycle**: Plant photosynthesis produces O₂ → Animal/insect/microbe respiration consumes O₂
- **Toxic Gas**: High-density organic decomposition produces → Plants absorb and purify → Natural dissipation
- Animal extinction → CO₂ depletion → Plants die too → Ecosystem collapse

### 🌓 Day/Night Activity Cycle
- 3-minute full day/night cycle with sunrise, noon, sunset, midnight phases
- Most animals are diurnal, some species are nocturnal (controlled by DNA `Nocturnality` gene)
- Resting organisms have reduced perception, speed, and energy consumption
- Night features **twinkling starfield** + **moon** illuminating the ground
- Nocturnal insects exhibit **bioluminescence** (firefly breathing light effect)

### 🏔️ Procedural Terrain System
- **Value Noise + fBm**-based procedural terrain generation
- Rolling hills + large-scale mountains + fine detail
- Meandering rivers (main river + tributaries) automatically carving terrain
- Dynamic water surface ripple effects
- All terrain parameters adjustable in settings (height, roughness, water level, river width)
- **Random seed** support: Same seed generates identical worlds (terrain, initial species, DNA)

### 🦴 Organism Facing & Movement
- Organisms have a **facing angle**, moving in the direction their head points
- Smooth interpolation rotation toward velocity direction during movement
- Different species have different turn rates (microbes most agile, animals more sluggish)

### 🎮 Interactive Features
- **Click to select** organisms and view detailed info (works while paused or running)
- Detail card shows DNA genome (collapsed by default), 3D model preview (auto-rotating)
- Press **`F`** to focus on selected organism, camera follows in real-time
- **WASD** keyboard movement, mouse drag to orbit, scroll to zoom
- Three-finger drag to pan (touch support)
- Collapsible stats panel (left) and population chart (bottom)
- **Start screen** with configurable simulation **settings panel**
- Pause / Resume / Restart / Speed controls

---

## 🏗️ Architecture

```
Browser Main Thread
├── Three.js Renderer
│   ├── InstancedMesh GPU Instancing (high-perf rendering of thousands)
│   ├── Procedural Terrain (Value Noise + fBm + River Carving)
│   ├── Day/Night Cycle (multi-phase interpolated lighting + stars + moon)
│   ├── DNA-driven 3D Organism Models (shape/color/size from genes)
│   └── Frame Interpolation (Lerp) for smooth motion
├── Camera Controls (OrbitControls-style + WASD + multi-touch)
├── UI Overlay
│   ├── Stats Panel (species counts, CO₂/O₂, death stats)
│   ├── Organism Detail Card (DNA, 3D preview, gender/estrus/satiety)
│   ├── Population Trend Chart (Canvas 2D real-time)
│   └── Start Screen + Settings Modal
└── Worker Message Communication

WebWorker Simulation Thread
├── World (ecosystem management)
│   ├── Ecological Cycles (CO₂ / O₂ / Toxic Gas triple cycle)
│   ├── Corpse System (decay + saprophyte spawning + scent attraction)
│   ├── Egg System (laying + hatching)
│   ├── Environmental Disasters (drought / plague / cold snap)
│   ├── Day/Night Sync (activity level calculation)
│   └── Species Classifier (DNA similarity clustering)
├── DNA Engine (16-dim genes · creation · crossover · mutation)
├── Behavior Engine (parameterized decisions · forage · hunt · flee · mate · scavenge)
├── Organism (energy · satiety · gender · estrus · gestation · facing · aging · death)
├── SpatialGrid (spatial partitioning for fast neighbor queries)
└── SeededRandom (Mulberry32 deterministic PRNG)
```

### Key Technologies
- **Three.js** + **InstancedMesh**: GPU instancing for rendering thousands of organisms at 60 FPS
- **WebWorker**: Simulation logic runs on a separate thread, never blocking the UI
- **Frame Interpolation (Lerp)**: Decouples simulation updates from render frame rate for smooth motion
- **SpatialGrid**: Spatial partitioning for fast nearest-neighbor queries
- **Procedural Generation**: Value Noise + fBm terrain, DNA-driven 3D models
- **Mulberry32 PRNG**: Seedable random number generator for deterministic world reproduction
- **Canvas 2D**: Real-time species population trend chart
- **GC Optimization**: Pre-allocated temporary objects in hot paths to avoid render-frame allocations
- **TypeScript** + **Vite**: Type safety + fast development

---

## 🚀 Getting Started

### Requirements
- Node.js >= 18
- Modern browser (Chrome / Firefox / Safari / Edge)

### Install & Run

```bash
# Clone the repository
git clone https://github.com/your-username/ALife.git
cd ALife

# Install dependencies
npm install

# Start development server
npm run dev
```

Open your browser at `http://localhost:5173` and click **🚀 Start Simulation**.

### Production Build

```bash
npm run build
npm run preview
```

---

## 📁 Project Structure

```
ALife/
├── index.html              # Main page (UI layout + styles + settings panel)
├── src/
│   ├── main.ts             # App entry (UI logic, worker comm, chart, settings)
│   ├── types.ts            # Shared types (DNA gene defs, config, PRNG, render data)
│   ├── renderer/
│   │   └── Renderer.ts     # Three.js renderer (terrain, lighting, day/night, stars, moon, models)
│   └── simulation/
│       ├── worker.ts       # WebWorker entry point
│       ├── World.ts        # World system (ecology, atmosphere, disasters, corpses, eggs)
│       ├── Organism.ts     # Organism class (energy, satiety, gender, estrus, gestation, facing)
│       ├── DNA.ts          # DNA system (16-dim gene creation, crossover, mutation)
│       ├── Behavior.ts     # Behavior decision engine (forage, hunt, flee, mate, scavenge)
│       └── SpatialGrid.ts  # Spatial partition grid
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## ⚙️ Configurable Parameters

Adjustable via the **⚙ Settings** button on the start screen:

### Species Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Initial Microbes | 400 | Most numerous, ubiquitous decomposers |
| Initial Plants | 600 | Stable base of the food web |
| Initial Insects | 200 | Small consumers |
| Initial Animals | 80 | Large consumers / apex predators |
| Max Microbes | 1500 | Highest carrying capacity |
| Max Plants | 1200 | Second highest carrying capacity |
| World Size | 500 | World width and height |
| Simulation TPS | 10 | Ticks per second |

### Terrain Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Random Seed | -1 | -1 ~ 999999999 | -1=random each time, ≥0 for fixed seed |
| Terrain Height | 1.0 | 0.2 ~ 3.0 | Overall terrain height multiplier |
| Terrain Roughness | 1.0 | 0.2 ~ 3.0 | Terrain detail frequency |
| Water Level | 1.5 | 0.0 ~ 5.0 | Water surface height |
| River Width | 1.0 | 0.0 ~ 3.0 | 0=no rivers |

---

## 🎮 Controls

| Action | Description |
|--------|-------------|
| Left-click drag | Orbit camera |
| Scroll wheel | Zoom |
| Right/Middle-click drag | Pan camera |
| WASD | Keyboard movement |
| Three-finger drag | Touch pan |
| Click organism | Select and view details |
| F | Focus on selected organism |
| Space | Pause / Resume |

---

## 📜 License

MIT
