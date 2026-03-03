# 🌍 ALife — Web 3D 人工生命演化模拟器

<p align="center">
  <strong>在浏览器中观察生命的诞生、演化与自然选择</strong>
</p>

一个运行在浏览器中的 3D 人工生命模拟系统。在虚拟自然环境中模拟植物、微生物、昆虫和动物，每个生命体拥有 DNA、能量系统、行为决策、繁殖与捕食逻辑，支持自然选择与物种演化。

---

## ✨ 核心特性

### 🧬 DNA 驱动的行为系统
- 12 维基因编码：体型、速度、感知范围、攻击力、防御力、代谢率、繁殖阈值、攻击倾向、逃跑倾向、食性、突变率、昼夜习性
- 有性繁殖（基因重组 + 突变）和无性繁殖（分裂）
- 行为决策完全由 DNA 参数控制，无硬编码规则

### 🌿 真实生态金字塔
- **微生物**：极小、几乎不动、极快分裂繁殖（r-策略极端）
- **植物**：静止、光合作用、寿命最长
- **昆虫**：小型、敏捷、中速繁殖
- **动物**：大型、中速、慢繁殖（K-策略）
- 种群数量呈金字塔分布：微生物 >> 植物 > 昆虫 > 动物

### 💀 多因素死亡系统
- **饿死**：能量耗尽
- **自然老死**：达到最大年龄
- **被捕食**：被其他生命体攻击致死
- **过密致死**：借鉴生命游戏规则，邻居过多导致资源竞争
- **疾病**：高密度 + 低健康 + 物种垄断 → 疾病爆发
- **环境灾害**：干旱、瘟疫、寒潮等随机事件

### 🌬️ 大气 CO₂ 碳循环
- 动物/昆虫/微生物呼吸产生 CO₂
- 植物光合作用消耗 CO₂
- 动物灭绝 → CO₂ 枯竭 → 植物也会死亡 → 生态崩溃
- 地质活动缓慢释放 CO₂ 作为基线补充

### 🌓 昼夜活动周期
- 大部分动物昼行夜息，少部分物种昼伏夜出
- 夜行性由 DNA 中的 `Nocturnality` 基因控制
- 休息时感知、速度、行为活跃度降低，能量消耗减少

### 🎮 交互功能
- 点击选中生命体查看详细信息（暂停/运行时均可）
- 选中后按 `F` 聚焦，镜头实时跟随
- `WASD` 键盘移动、鼠标拖拽旋转、滚轮缩放
- 三指拖拽平移（触屏支持）
- 左侧统计面板可折叠
- 底部物种数量实时走势图（可折叠）
- 开始画面 + 参数设置面板
- 暂停 / 继续 / 重新开始 / 变速控制

---

## 🏗️ 技术架构

```
浏览器主线程
├── Three.js 渲染层（InstancedMesh GPU Instancing）
├── 相机控制（OrbitControls 风格）
├── UI 覆盖层（统计面板、详情面板、走势图）
└── 接收模拟状态

WebWorker 模拟线程
├── World（世界管理、生态循环）
├── DNA Engine（基因编码、重组、突变）
├── Behavior Engine（参数化行为决策）
├── SpatialGrid（空间分区高效查询）
└── Species Classifier（DNA 相似度物种聚类）
```

### 关键技术
- **Three.js** + **InstancedMesh**：GPU Instancing 渲染大量生命体，60 FPS
- **WebWorker**：模拟逻辑在独立线程运行，不阻塞 UI
- **SpatialGrid**：空间分区加速近邻查询
- **Canvas 2D**：实时物种数量走势图
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
├── index.html              # 主页面（UI 布局 + 样式）
├── src/
│   ├── main.ts             # 应用入口（UI 逻辑、Worker 通信、走势图）
│   ├── types.ts            # 共享类型定义（DNA、生命体、配置）
│   ├── renderer/
│   │   └── Renderer.ts     # Three.js 渲染器（场景、光照、昼夜循环）
│   └── simulation/
│       ├── worker.ts       # WebWorker 入口
│       ├── World.ts        # 世界系统（生态循环、CO₂、灾害）
│       ├── Organism.ts     # 生命体类（能量、老化、死亡）
│       ├── DNA.ts          # DNA 系统（创建、重组、突变）
│       ├── Behavior.ts     # 行为决策引擎（参数化决策）
│       └── SpatialGrid.ts  # 空间分区网格
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## ⚙️ 可配置参数

通过开始画面的 **⚙ 设置** 按钮可调整：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 微生物初始数量 | 400 | 最多，无处不在的分解者 |
| 植物初始数量 | 600 | 食物网的稳定基础 |
| 昆虫初始数量 | 200 | 小型消费者 |
| 动物初始数量 | 80 | 大型消费者 / 顶级捕食者 |
| 微生物上限 | 1500 | 微生物承载量最高 |
| 植物上限 | 1200 | 植物承载量次之 |
| 世界大小 | 500 | 世界宽度和高度 |
| 模拟 TPS | 30 | 每秒模拟 tick 数 |

---

## 📜 License

MIT

---

---

# 🌍 ALife — Web 3D Artificial Life Evolution Simulator

<p align="center">
  <strong>Observe the birth, evolution, and natural selection of life in your browser</strong>
</p>

A browser-based 3D artificial life simulation system. It simulates plants, microbes, insects, and animals in a virtual natural environment. Each organism possesses DNA, an energy system, behavioral decision-making, reproduction and predation logic, supporting natural selection and species evolution.

---

## ✨ Core Features

### 🧬 DNA-Driven Behavior System
- 12-dimensional gene encoding: body size, speed, sense range, attack, defense, metabolism, reproduction threshold, aggression, flee inclination, diet type, mutation rate, nocturnality
- Sexual reproduction (gene recombination + mutation) and asexual reproduction (fission)
- All behavioral decisions are controlled by DNA parameters — no hardcoded rules

### 🌿 Realistic Ecological Pyramid
- **Microbes**: Tiny, nearly immobile, extremely fast fission (extreme r-strategy)
- **Plants**: Sessile, photosynthesis, longest lifespan
- **Insects**: Small, agile, medium reproduction rate
- **Animals**: Large, moderate speed, slow reproduction (K-strategy)
- Population follows a pyramid: Microbes >> Plants > Insects > Animals

### 💀 Multi-Factor Death System
- **Starvation**: Energy depleted
- **Old age**: Maximum lifespan reached
- **Predation**: Killed by other organisms
- **Overcrowding**: Inspired by Conway's Game of Life — too many neighbors causes resource competition
- **Disease**: High density + low health + species monopoly → epidemic
- **Environmental disasters**: Drought, plague, cold snap, etc.

### 🌬️ Atmospheric CO₂ Carbon Cycle
- Animals / insects / microbes produce CO₂ through respiration
- Plants consume CO₂ through photosynthesis
- Animal extinction → CO₂ depletion → plants die too → ecosystem collapse
- Geological activity provides slow baseline CO₂ release

### 🌓 Day/Night Activity Cycle
- Most animals are diurnal (active during daytime), some species are nocturnal
- Nocturnality is controlled by a DNA gene
- Resting organisms have reduced perception, speed, and energy consumption

### 🎮 Interactive Features
- Click to select organisms and view detailed info (works while paused or running)
- Press `F` to focus on selected organism, camera follows in real-time
- `WASD` keyboard movement, mouse drag to orbit, scroll to zoom
- Three-finger drag to pan (touch support)
- Collapsible stats panel (left) and population chart (bottom)
- Start screen with configurable simulation parameters
- Pause / Resume / Restart / Speed controls

---

## 🏗️ Architecture

```
Browser Main Thread
├── Three.js Renderer (InstancedMesh GPU Instancing)
├── Camera Controls (OrbitControls-style)
├── UI Overlay (stats panel, detail panel, population chart)
└── Receives simulation state

WebWorker Simulation Thread
├── World (ecosystem management, carbon cycle, disasters)
├── DNA Engine (gene encoding, crossover, mutation)
├── Behavior Engine (parameterized decision-making)
├── SpatialGrid (spatial partitioning for efficient queries)
└── Species Classifier (DNA similarity clustering)
```

### Key Technologies
- **Three.js** + **InstancedMesh**: GPU instancing for rendering thousands of organisms at 60 FPS
- **WebWorker**: Simulation logic runs on a separate thread, never blocking the UI
- **SpatialGrid**: Spatial partitioning for fast nearest-neighbor queries
- **Canvas 2D**: Real-time species population trend chart
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
├── index.html              # Main page (UI layout + styles)
├── src/
│   ├── main.ts             # App entry (UI logic, worker communication, chart)
│   ├── types.ts            # Shared type definitions (DNA, organisms, config)
│   ├── renderer/
│   │   └── Renderer.ts     # Three.js renderer (scene, lighting, day/night)
│   └── simulation/
│       ├── worker.ts       # WebWorker entry point
│       ├── World.ts        # World system (ecology, CO₂, disasters)
│       ├── Organism.ts     # Organism class (energy, aging, death)
│       ├── DNA.ts          # DNA system (creation, crossover, mutation)
│       ├── Behavior.ts     # Behavior decision engine (parameterized)
│       └── SpatialGrid.ts  # Spatial partition grid
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## ⚙️ Configurable Parameters

Adjustable via the **⚙ Settings** button on the start screen:

| Parameter | Default | Description |
|-----------|---------|-------------|
| Initial Microbes | 400 | Most numerous, ubiquitous decomposers |
| Initial Plants | 600 | Stable base of the food web |
| Initial Insects | 200 | Small consumers |
| Initial Animals | 80 | Large consumers / apex predators |
| Max Microbes | 1500 | Highest carrying capacity |
| Max Plants | 1200 | Second highest carrying capacity |
| World Size | 500 | World width and height |
| Simulation TPS | 30 | Ticks per second |

---

## 📜 License

MIT
