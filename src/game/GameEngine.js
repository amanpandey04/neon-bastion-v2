// ============================================================
// IMPORTS
// ============================================================

import { MAP, PATH, TOWER_TYPES, ENEMY_TYPES, getWaveConfig } from "./data.js";

import { Enemy, Projectile, Tower } from "./entities.js";

import { ObjectPool } from "./ObjectPool.js";

import { SpatialGrid } from "./SpatialGrid.js";

import { clamp, distanceSq, isPointNearPath, normalize } from "./utils.js";

// ============================================================
// CONSTANTS
// ============================================================

const FIXED_STEP = 1 / 60;

const ENEMY_VIEW_MARGIN = 32;

// How long the benchmark waits before it starts
// counting performance.
const BENCHMARK_WARMUP_SECONDS = 3;

// How long the benchmark actually measures performance.
const BENCHMARK_DURATION_SECONDS = 30;

// We consider a frame to meet the assignment's
// 45 FPS requirement when it is <= 22.22ms.
const TARGET_FRAME_MS = 1000 / 45;

// The assignment says fewer than 5% of frames may
// exceed 33ms.
const BAD_FRAME_MS = 33;

// The performance lab uses short, repeatable A/B runs so the
// optimization story can be demonstrated live in the browser.
const EXPERIMENT_WARMUP_SECONDS = 0.75;
const EXPERIMENT_DURATION_SECONDS = 2.5;
const BASELINE_DURATION_SECONDS = 4;

const STRESS_COUNTS = {
  enemies: 5000,
  towers: 100,
  projectiles: 1000,
};

const PERFORMANCE_EXPERIMENTS = {
  spatialGrid: {
    label: "Spatial grid target lookup",
  },
  objectPool: {
    label: "Object pool reuse",
  },
};

// A/B experiments are short, isolated CPU measurements using the same
// 5,000-enemy / 100-tower / 1,000-projectile stress dataset. They do not
// replace the live game loop with a deliberately slow rendering path.
const EXPERIMENT_ITERATIONS = 5;
const POOL_EXPERIMENT_ITERATIONS = 5;
const POOL_EXPERIMENT_OBJECTS = 5000;

// ============================================================
// GAME ENGINE
// ============================================================

export class GameEngine {
  // ==========================================================
  // CONSTRUCTOR
  // ==========================================================

  constructor(canvas, onSnapshot) {
    // --------------------------------------------------------
    // CANVAS
    // --------------------------------------------------------

    this.canvas = canvas;

    this.ctx = canvas.getContext("2d", {
      alpha: false,
    });

    this.onSnapshot = onSnapshot;

    // --------------------------------------------------------
    // GAME LOOP
    // --------------------------------------------------------

    this.running = false;

    this.lastTime = 0;

    this.accumulator = 0;

    // How often React gets a UI snapshot.
    this.uiTimer = 0;

    // --------------------------------------------------------
    // ROLLING FPS
    // --------------------------------------------------------

    // Store the duration of recent browser frames.
    this.frameSamples = [];

    // Maximum number of samples kept.
    this.maxFrameSamples = 60;

    // --------------------------------------------------------
    // BENCHMARK
    // --------------------------------------------------------

    this.benchmark = {
      active: false,

      phase: "idle",

      elapsed: 0,

      warmupElapsed: 0,

      measuredElapsed: 0,

      totalFrames: 0,

      goodFrames: 0,

      badFrames: 0,

      totalFrameTime: 0,

      worstFrameMs: 0,

      averageFrameMs: 0,

      pass45FpsPercent: 0,

      over33msPercent: 0,

      complete: false,
    };

    // --------------------------------------------------------
    // PERFORMANCE DEBUGGING
    // --------------------------------------------------------

    this.profileTime = 0;

    this.profileFrames = 0;

    // --------------------------------------------------------
    // IDS
    // --------------------------------------------------------

    this.nextEnemyId = 1;

    this.nextTowerId = 1;

    // --------------------------------------------------------
    // GAME SETTINGS
    // --------------------------------------------------------

    this.speedMultiplier = 1;

    this.selectedBuildType = null;

    this.selectedTowerId = 0;

    // Temporary reusable array for spatial queries.
    this.targetQuery = [];

    // Performance toggles used by the lab for honest A/B tests.
    // The shipped game defaults to the optimized path.
    this.performanceOptions = {
      spatialGrid: true,
      staticCanvas: false,
      allocationFreeProjectiles: true,
      stressSimpleRendering: false,
    };

    this.experiment = {
      active: false,
      id: null,
      stage: "idle",
      before: null,
      after: null,
    };

    // Stress-mode projectile slots. The first 100 projectiles are
    // visually attached to the 100 stress towers so the benchmark
    // still looks like a tower-defense scene while keeping the
    // projectile count fixed at exactly 1,000.
    this.stressProjectileByTower = new Map();

    // Static scenery never changes during gameplay, so it can be
    // rendered once and reused every frame.
    this.staticCanvas = document.createElement("canvas");
    this.staticCanvas.width = MAP.width;
    this.staticCanvas.height = MAP.height;
    this.staticCtx = this.staticCanvas.getContext("2d", { alpha: false });

    // Current pointer position in game coordinates.
    this.pointerX = 0;
    this.pointerY = 0;
    this.pointerInsideCanvas = false;

    // --------------------------------------------------------
    // MAP
    // --------------------------------------------------------

    this.path = PATH;

    // --------------------------------------------------------
    // ENTITY ARRAYS
    // --------------------------------------------------------

    this.enemies = [];

    this.enemiesById = new Map();

    this.towers = [];

    this.towersById = new Map();

    this.projectiles = [];

    this.effects = [];

    // --------------------------------------------------------
    // OBJECT POOLS
    // --------------------------------------------------------

    this.enemyPool = new ObjectPool(
      () => new Enemy(),
      (item) => item.reset(),
      256,
    );

    this.projectilePool = new ObjectPool(
      () => new Projectile(),
      (item) => item.reset(),
      256,
    );

    // --------------------------------------------------------
    // SPATIAL GRID
    // --------------------------------------------------------

    this.grid = new SpatialGrid(MAP.width, MAP.height, 80);

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    this.state = this.createInitialState();

    // --------------------------------------------------------
    // BOUND METHODS
    // --------------------------------------------------------

    this.boundLoop = this.loop.bind(this);

    this.pointerHandler = this.handlePointer.bind(this);
    this.pointerMoveHandler = this.handlePointerMove.bind(this);
    this.pointerLeaveHandler = this.handlePointerLeave.bind(this);
    this.keyHandler = this.handleKeyDown.bind(this);

    this.rebuildStaticLayer();

    // --------------------------------------------------------
    // INPUT
    // --------------------------------------------------------

    canvas.addEventListener("pointerdown", this.pointerHandler);
    canvas.addEventListener("pointermove", this.pointerMoveHandler);
    canvas.addEventListener("pointerleave", this.pointerLeaveHandler);
    window.addEventListener("keydown", this.keyHandler);
  }

  // ==========================================================
  // INITIAL GAME STATE
  // ==========================================================

  createInitialState() {
    return {
      // ------------------------------------------------------
      // PLAYER
      // ------------------------------------------------------

      money: 500,

      health: 100,

      maxHealth: 100,

      score: 0,

      // ------------------------------------------------------
      // WAVES
      // ------------------------------------------------------

      wave: 0,

      maxWave: 50,

      runningWave: false,

      waveReady: true,

      waveCountdown: 0,

      // ------------------------------------------------------
      // END STATES
      // ------------------------------------------------------

      victory: false,

      gameOver: false,

      paused: false,

      // ------------------------------------------------------
      // SPAWNING
      // ------------------------------------------------------

      spawnQueue: [],

      spawnQueueIndex: 0,

      spawnTimer: 0,

      // ------------------------------------------------------
      // COUNTS
      // ------------------------------------------------------

      enemiesAlive: 0,

      towerCount: 0,

      projectileCount: 0,

      // ------------------------------------------------------
      // ROLLING FPS
      // ------------------------------------------------------

      fps: 60,

      frameMs: 16.7,

      // ------------------------------------------------------
      // DEBUG
      // ------------------------------------------------------

      stressMode: false,

      notification: {
        text: "",
        subtext: "",
        timer: 0,
      },

      // ------------------------------------------------------
      // PERFORMANCE
      // ------------------------------------------------------

      performance: {
        frameMs: 0,

        cpuFrameMs: 0,

        updateMs: 0,

        renderMs: 0,

        spawnerMs: 0,

        enemiesMs: 0,

        towersMs: 0,

        projectilesMs: 0,

        effectsMs: 0,

        updateSteps: 0,
      },

      // ------------------------------------------------------
      // BENCHMARK
      // ------------------------------------------------------

      benchmark: {
        active: false,
        phase: "idle",
        warmupElapsed: 0,
        measuredElapsed: 0,
        totalFrames: 0,
        goodFrames: 0,
        badFrames: 0,
        averageFrameMs: 0,
        worstFrameMs: 0,
        pass45FpsPercent: 0,
        over33msPercent: 0,
        complete: false,
      },
    };
  }

  // ==========================================================
  // START
  // ==========================================================

  start() {
    if (this.running) {
      return;
    }

    this.running = true;

    this.lastTime = performance.now();

    requestAnimationFrame(this.boundLoop);
  }

  // ==========================================================
  // DESTROY
  // ==========================================================

  destroy() {
    this.running = false;

    this.canvas.removeEventListener("pointerdown", this.pointerHandler);
    this.canvas.removeEventListener("pointermove", this.pointerMoveHandler);
    this.canvas.removeEventListener("pointerleave", this.pointerLeaveHandler);
    window.removeEventListener("keydown", this.keyHandler);
  }

  // ==========================================================
  // RESET GAME
  // ==========================================================

  resetGame() {
    this.clearEntities();

    this.state = this.createInitialState();

    this.selectedBuildType = null;

    this.selectedTowerId = 0;

    this.speedMultiplier = 1;

    this.performanceOptions = {
      spatialGrid: true,
      staticCanvas: false,
      allocationFreeProjectiles: true,
      stressSimpleRendering: false,
    };

    this.experiment = {
      active: false,
      id: null,
      stage: "idle",
      before: null,
      after: null,
    };

    this.accumulator = 0;

    this.frameSamples = [];

    this.benchmark = {
      active: false,
      phase: "idle",
      elapsed: 0,
      warmupElapsed: 0,
      measuredElapsed: 0,
      totalFrames: 0,
      goodFrames: 0,
      badFrames: 0,
      totalFrameTime: 0,
      worstFrameMs: 0,
      averageFrameMs: 0,
      pass45FpsPercent: 0,
      over33msPercent: 0,
      complete: false,
    };

    this.emitSnapshot(true);
  }

  // ==========================================================
  // CLEAR ENTITIES
  // ==========================================================

  clearEntities() {
    // --------------------------------------------------------
    // RECYCLE ENEMIES
    // --------------------------------------------------------

    for (let i = 0; i < this.enemies.length; i += 1) {
      this.enemyPool.release(this.enemies[i]);
    }

    // --------------------------------------------------------
    // RECYCLE PROJECTILES
    // --------------------------------------------------------

    for (let i = 0; i < this.projectiles.length; i += 1) {
      this.projectilePool.release(this.projectiles[i]);
    }

    // --------------------------------------------------------
    // CLEAR ARRAYS
    // --------------------------------------------------------

    this.enemies.length = 0;

    this.towers.length = 0;

    this.projectiles.length = 0;

    this.effects.length = 0;

    // --------------------------------------------------------
    // CLEAR MAPS
    // --------------------------------------------------------

    this.enemiesById.clear();

    this.towersById.clear();
  }

  // ==========================================================
  // PAUSE
  // ==========================================================

  setPaused(value) {
    this.state.paused = value;

    this.emitSnapshot(true);
  }

  togglePause() {
    if (this.state.victory || this.state.gameOver) {
      return;
    }

    this.setPaused(!this.state.paused);
  }

  // ==========================================================
  // SPEED
  // ==========================================================

  setSpeed(multiplier) {
    this.speedMultiplier = multiplier;

    this.emitSnapshot(true);
  }

  // ==========================================================
  // MAIN GAME LOOP
  // ==========================================================

  loop(timestamp) {
    if (!this.running) {
      return;
    }

    // --------------------------------------------------------
    // START COMPLETE FRAME TIMER
    // --------------------------------------------------------

    const frameStart = performance.now();

    // --------------------------------------------------------
    // REAL TIME DELTA
    // --------------------------------------------------------

    const rawFrameDelta = Math.max(
      0,
      (timestamp - this.lastTime) / 1000,
    );

    const rawDelta = Math.min(rawFrameDelta, 0.1);

    this.lastTime = timestamp;

    // --------------------------------------------------------
    // GAME SPEED
    // --------------------------------------------------------

    const scaledDelta = rawDelta * this.speedMultiplier;

    this.accumulator += scaledDelta;

    // --------------------------------------------------------
    // FIXED SIMULATION UPDATE
    // --------------------------------------------------------

    const updateFrameStart = performance.now();

    let updateSteps = 0;

    while (this.accumulator >= FIXED_STEP) {
      this.update(FIXED_STEP);

      this.accumulator -= FIXED_STEP;

      updateSteps += 1;
    }

    const updateFrameMs = performance.now() - updateFrameStart;

    // --------------------------------------------------------
    // RENDER
    // --------------------------------------------------------

    const renderStart = performance.now();

    this.render();

    const renderFrameMs = performance.now() - renderStart;

    // --------------------------------------------------------
    // COMPLETE FRAME TIME
    // --------------------------------------------------------

    const cpuFrameMs = performance.now() - frameStart;
    const browserFrameMs = rawFrameDelta * 1000;

    // --------------------------------------------------------
    // STORE PERFORMANCE DATA
    // --------------------------------------------------------

    this.state.performance.frameMs = browserFrameMs;
    this.state.performance.cpuFrameMs = cpuFrameMs;

    this.state.performance.updateMs = updateFrameMs;

    this.state.performance.renderMs = renderFrameMs;

    this.state.performance.updateSteps = updateSteps;

    // --------------------------------------------------------
    // ROLLING FPS
    // --------------------------------------------------------

    this.updateRollingFps(browserFrameMs);

    // --------------------------------------------------------
    // BENCHMARK
    // --------------------------------------------------------

    if (this.benchmark.active) {
      this.updateBenchmark(rawDelta, browserFrameMs);
    }

    // --------------------------------------------------------
    // UI SNAPSHOT
    // --------------------------------------------------------

    this.uiTimer += rawDelta;

    if (this.uiTimer >= 0.1) {
      this.emitSnapshot();

      this.uiTimer = 0;
    }

    // --------------------------------------------------------
    // NEXT FRAME
    // --------------------------------------------------------

    // Keep the loop alive even when the normal game reaches
    // Game Over or Victory, because the benchmark and UI
    // still need to be able to operate.
    //
    // Normal gameplay stops updating once the game has ended.
    // The render loop itself continues.
    if (this.running) {
      requestAnimationFrame(this.boundLoop);
    }
  }

  // ==========================================================
  // ROLLING FPS
  // ==========================================================

  updateRollingFps(frameMs) {
    // Ignore impossible measurements.
    if (!Number.isFinite(frameMs) || frameMs <= 0) {
      return;
    }

    // Add newest frame.
    this.frameSamples.push(frameMs);

    // Keep only the latest N samples.
    if (this.frameSamples.length > this.maxFrameSamples) {
      this.frameSamples.shift();
    }

    // Calculate average frame time.
    let total = 0;

    for (let i = 0; i < this.frameSamples.length; i += 1) {
      total += this.frameSamples[i];
    }

    const averageFrameMs = total / this.frameSamples.length;

    this.state.frameMs = averageFrameMs;

    this.state.fps = averageFrameMs > 0 ? 1000 / averageFrameMs : 60;
  }

  // ==========================================================
  // UPDATE GAME
  // ==========================================================

  update(dt) {
    if (this.state.paused || this.state.victory || this.state.gameOver) {
      return;
    }

    // --------------------------------------------------------
    // SPAWNER
    // --------------------------------------------------------

    let start = performance.now();

    this.updateSpawner(dt);

    this.state.performance.spawnerMs = performance.now() - start;

    // --------------------------------------------------------
    // ENEMIES
    // --------------------------------------------------------

    start = performance.now();

    this.updateEnemies(dt);

    this.state.performance.enemiesMs = performance.now() - start;

    // --------------------------------------------------------
    // TOWERS
    // --------------------------------------------------------

    start = performance.now();

    this.updateTowers(dt);

    this.state.performance.towersMs = performance.now() - start;

    // --------------------------------------------------------
    // PROJECTILES
    // --------------------------------------------------------

    start = performance.now();

    this.updateProjectiles(dt);

    this.state.performance.projectilesMs = performance.now() - start;

    // --------------------------------------------------------
    // EFFECTS
    // --------------------------------------------------------

    start = performance.now();

    this.updateEffects(dt);

    this.state.performance.effectsMs = performance.now() - start;

    // --------------------------------------------------------
    // NOTIFICATION
    // --------------------------------------------------------

    if (this.state.notification.timer > 0) {
      this.state.notification.timer = Math.max(
        0,
        this.state.notification.timer - dt,
      );
    }

    // --------------------------------------------------------
    // COUNTERS
    // --------------------------------------------------------

    this.state.enemiesAlive = this.enemies.length;

    this.state.towerCount = this.towers.length;

    this.state.projectileCount = this.projectiles.length;
  }

  // ==========================================================
  // NOTIFICATIONS
  // ==========================================================

  showNotification(text, subtext = "", timer = 2) {
    this.state.notification = {
      text,
      subtext,
      timer,
    };
  }

  getWaveMessage(wave) {
    if (wave === 1) return "The first assault is incoming.";
    if (wave === 10) return "Heavy units are entering the battlefield.";
    if (wave === 20) return "Enemy armor is getting serious.";
    if (wave === 30) return "The pressure is rising. Upgrade intelligently.";
    if (wave === 40) return "Forty waves down. The endgame is here.";
    if (wave === 50) return "Final wave. Hold nothing back.";
    return "Enemy strength is increasing.";
  }

  // ==========================================================
  // START WAVE
  // ==========================================================

  startWave() {
    if (
      this.state.runningWave ||
      this.state.victory ||
      this.state.gameOver ||
      this.state.wave >= this.state.maxWave
    ) {
      return;
    }

    this.state.wave += 1;

    const config = getWaveConfig(this.state.wave);

    this.state.runningWave = true;

    this.state.waveReady = false;

    this.state.waveCountdown = 0;

    this.state.spawnQueue = [];

    this.state.spawnQueueIndex = 0;

    this.state.spawnTimer = 0;

    // --------------------------------------------------------
    // BUILD SPAWN QUEUE
    // --------------------------------------------------------

    for (let g = 0; g < config.groups.length; g += 1) {
      const group = config.groups[g];

      for (let i = 0; i < group.count; i += 1) {
        this.state.spawnQueue.push({
          type: group.type,

          spawnInterval: group.spawnInterval,

          healthScale: config.healthScale,

          speedScale: config.speedScale,
        });
      }
    }

    this.state.waveConfig = config;

    this.showNotification(
      `WAVE ${this.state.wave}`,
      this.getWaveMessage(this.state.wave),
      2.2,
    );

    this.emitSnapshot(true);
  }

  // ==========================================================
  // UPDATE SPAWNER
  // ==========================================================

  updateSpawner(dt) {
    if (!this.state.runningWave) {
      return;
    }

    if (this.state.spawnQueueIndex < this.state.spawnQueue.length) {
      this.state.spawnTimer -= dt;

      if (this.state.spawnTimer <= 0) {
        const entry = this.state.spawnQueue[this.state.spawnQueueIndex++];

        this.spawnEnemy(entry);

        this.state.spawnTimer = entry.spawnInterval;
      }
    } else if (this.enemies.length === 0) {
      this.state.runningWave = false;

      this.state.waveReady = this.state.wave < this.state.maxWave;

      this.state.score += 100 + this.state.wave * 12;

      if (this.state.wave >= this.state.maxWave) {
        this.state.victory = true;
        this.showNotification(
          "BASTION SECURED",
          "All 50 waves have been defeated.",
          4,
        );
      } else {
        this.showNotification(
          `WAVE ${this.state.wave} CLEARED`,
          "Prepare your defenses for the next assault.",
          1.8,
        );
      }
    }
  }

  // ==========================================================
  // SPAWN ENEMY
  // ==========================================================

  spawnEnemy(entry) {
    const enemy = this.enemyPool.acquire();

    enemy.init(
      this.nextEnemyId++,

      entry.type,

      entry.healthScale,

      entry.speedScale,

      this.path[0],
    );

    this.enemies.push(enemy);

    this.enemiesById.set(
      enemy.id,

      enemy,
    );
  }

  // ==========================================================
  // UPDATE ENEMIES
  // ==========================================================

  updateEnemies(dt) {
    this.grid.clear();

    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];

      // ------------------------------------------------------
      // INACTIVE
      // ------------------------------------------------------

      if (!enemy.active) {
        this.enemies.splice(i, 1);

        continue;
      }

      // ------------------------------------------------------
      // HIT FLASH
      // ------------------------------------------------------

      enemy.hitFlash = Math.max(
        0,

        enemy.hitFlash - dt,
      );

      // ------------------------------------------------------
      // NEXT WAYPOINT
      // ------------------------------------------------------

      const target = this.path[enemy.pathIndex + 1];

      // Reached base.
      if (!target) {
        this.reachBase(
          enemy,

          i,
        );

        continue;
      }

      // ------------------------------------------------------
      // MOVEMENT
      // ------------------------------------------------------

      const dx = target.x - enemy.x;

      const dy = target.y - enemy.y;

      const step = enemy.speed * dt;

      const d = Math.hypot(dx, dy);

      if (d <= step) {
        enemy.x = target.x;

        enemy.y = target.y;

        enemy.pathIndex += 1;

        enemy.progress = enemy.pathIndex / (this.path.length - 1);
      } else {
        enemy.x += (dx / d) * step;

        enemy.y += (dy / d) * step;

        enemy.progress = enemy.pathIndex / (this.path.length - 1) + 0.01;
      }

      // ------------------------------------------------------
      // SPATIAL GRID
      // ------------------------------------------------------

      this.grid.insert(enemy);
    }
  }

  // ==========================================================
  // ENEMY REACHES BASE
  // ==========================================================

  reachBase(enemy, index) {
    // --------------------------------------------------------
    // STRESS TEST MODE
    // --------------------------------------------------------

    if (this.state.stressMode) {
      // Don't damage the base in benchmark mode.
      //
      // Instead, recycle the enemy and place it back
      // at the beginning of the path.
      const type = enemy.type;

      enemy.init(
        enemy.id,

        type,

        1.7,

        1,

        this.path[0],
      );

      // Keep it alive in the active array.
      this.enemies[index] = enemy;

      return;
    }

    // --------------------------------------------------------
    // NORMAL GAME MODE
    // --------------------------------------------------------

    this.state.health = clamp(
      this.state.health - enemy.baseDamage,

      0,

      this.state.maxHealth,
    );

    this.effects.push({
      type: "baseHit",

      x: enemy.x,

      y: enemy.y,

      life: 0.35,
    });

    this.enemyPool.release(enemy);

    this.enemiesById.delete(enemy.id);

    this.enemies.splice(index, 1);

    if (this.state.health <= 0) {
      this.state.gameOver = true;

      this.state.runningWave = false;
    }
  }

  // ==========================================================
  // TOWER STATS
  // ==========================================================

  getTowerStats(tower) {
    const data = TOWER_TYPES[tower.type];

    if (tower.statsCache && tower.statsCache.level === tower.level) {
      return tower.statsCache;
    }

    const levelIndex = tower.level - 1;

    const stats = {
      level: tower.level,
      damage: data.baseDamage * (1 + levelIndex * 0.62),
      range: data.baseRange * (1 + levelIndex * 0.1),
      fireRate: Math.max(
        0.16,
        data.baseFireRate * (1 - levelIndex * 0.1),
      ),
      projectileSpeed: data.projectileSpeed,
      projectileRadius: data.projectileRadius,
      splashRadius: data.splashRadius || 0,
      color: data.color,
      levelIndex,
    };

    if (tower.id) {
      tower.statsCache = stats;
    }

    return stats;
  }

  // ==========================================================
  // ACQUIRE TOWER TARGET
  // ==========================================================

  acquireTarget(tower) {
    const stats = this.getTowerStats(tower);

    const candidates = this.performanceOptions.spatialGrid
      ? this.grid.queryCircle(
          tower.x,
          tower.y,
          stats.range,
          this.targetQuery,
        )
      : this.enemies;

    let best = null;

    let bestProgress = -Infinity;

    const rangeSq = stats.range * stats.range;

    for (let i = 0; i < candidates.length; i += 1) {
      const enemy = candidates[i];

      if (!enemy.active || enemy.hp <= 0) {
        continue;
      }

      const dSq = distanceSq(
        tower.x,

        tower.y,

        enemy.x,

        enemy.y,
      );

      if (dSq > rangeSq) {
        continue;
      }

      if (enemy.progress > bestProgress) {
        bestProgress = enemy.progress;

        best = enemy;
      }
    }

    return best;
  }

  // ==========================================================
  // UPDATE TOWERS
  // ==========================================================

  updateTowers(dt) {
    for (let i = 0; i < this.towers.length; i += 1) {
      const tower = this.towers[i];

      tower.cooldown -= dt;

      if (tower.cooldown > 0) {
        continue;
      }

      const target = this.acquireTarget(tower);

      if (!target) {
        continue;
      }

      const stats = this.getTowerStats(tower);

      tower.targetId = target.id;

      // In stress mode each tower owns one projectile slot.
      // Re-launching that slot gives a visible shot from the tower
      // without ever increasing the fixed 1,000-projectile workload.
      if (this.state.stressMode) {
        const projectile = this.stressProjectileByTower.get(tower.id);

        if (projectile) {
          projectile.x = tower.x;
          projectile.y = tower.y;
          projectile.targetId = target.id;
          projectile.towerId = tower.id;
          projectile.type = tower.type;
          projectile.speed = stats.projectileSpeed;
          projectile.damage = stats.damage;
          projectile.radius = stats.projectileRadius;
          projectile.splashRadius = 0;
          projectile.lifetime = 4;
          projectile.active = true;
        }

        tower.cooldown = stats.fireRate;
        continue;
      }

      this.fireProjectile(tower, target, stats);

      tower.cooldown = stats.fireRate;
    }
  }

  // ==========================================================
  // FIRE PROJECTILE
  // ==========================================================

  fireProjectile(tower, target, stats) {
    const projectile = this.projectilePool.acquire();

    const dx = target.x - tower.x;
    const dy = target.y - tower.y;
    const length = Math.hypot(dx, dy) || 1;

    projectile.x = tower.x;

    projectile.y = tower.y;

    projectile.vx = (dx / length) * stats.projectileSpeed;
    projectile.vy = (dy / length) * stats.projectileSpeed;

    projectile.speed = stats.projectileSpeed;

    projectile.damage = stats.damage;

    projectile.radius = stats.projectileRadius;

    projectile.targetId = target.id;

    projectile.towerId = tower.id;

    projectile.splashRadius = stats.splashRadius;

    projectile.type = tower.type;

    projectile.lifetime = 4;

    this.projectiles.push(projectile);
  }

  // ==========================================================
  // FIND ENEMY BY ID
  // ==========================================================

  findEnemyById(id) {
    const enemy = this.enemiesById.get(id);

    return enemy?.active ? enemy : null;
  }

  // ==========================================================
  // UPDATE PROJECTILES
  // ==========================================================

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];

      projectile.lifetime -= dt;

      let target = this.findEnemyById(projectile.targetId);

      // ------------------------------------------------------
      // STRESS RECYCLE
      // ------------------------------------------------------

      if (this.state.stressMode) {
        const owner = projectile.towerId
          ? this.towersById.get(projectile.towerId)
          : null;

        if (!target) {
          target = owner?.targetId
            ? this.findEnemyById(owner.targetId)
            : this.enemies[i % this.enemies.length];
          projectile.targetId = target?.id ?? 0;
        }

        if (projectile.lifetime <= 0) {
          projectile.x = owner ? owner.x : target.x - 20;
          projectile.y = owner ? owner.y : target.y - 20;
          projectile.lifetime = 4;
        }
      } else if (!target || projectile.lifetime <= 0) {
        // ----------------------------------------------------
        // TARGET GONE / EXPIRED IN NORMAL GAMEPLAY
        // ----------------------------------------------------

        this.projectilePool.release(projectile);
        this.projectiles.splice(i, 1);
        continue;
      }

      // ------------------------------------------------------
      // MOVE TOWARD TARGET
      // ------------------------------------------------------

      const dx = target.x - projectile.x;

      const dy = target.y - projectile.y;

      const distanceToTarget = Math.hypot(dx, dy);

      const step = projectile.speed * dt;

      // ------------------------------------------------------
      // HIT / STRESS RECYCLE
      // ------------------------------------------------------

      if (this.state.stressMode) {
        const owner = projectile.towerId
          ? this.towersById.get(projectile.towerId)
          : null;

        if (distanceToTarget <= step + target.radius + projectile.radius || projectile.lifetime <= 0) {
          if (owner) {
            // Reset directly at the owning tower for another visible shot.
            projectile.x = owner.x;
            projectile.y = owner.y;
            projectile.targetId = owner.targetId || target.id;
          } else {
            projectile.x = target.x - 20;
            projectile.y = target.y - 20;
          }
          projectile.lifetime = 4;
        } else if (this.performanceOptions.allocationFreeProjectiles) {
          projectile.x += (dx / distanceToTarget) * step;
          projectile.y += (dy / distanceToTarget) * step;
        } else {
          const direction = normalize(dx, dy);
          projectile.x += direction.x * step;
          projectile.y += direction.y * step;
        }

        continue;
      }

      if (distanceToTarget <= step + target.radius + projectile.radius) {
        projectile.x = target.x;

        projectile.y = target.y;

        this.applyProjectileHit(
          projectile,

          target,
        );

        this.projectilePool.release(projectile);

        this.projectiles.splice(i, 1);
      } else if (this.performanceOptions.allocationFreeProjectiles) {
        projectile.x += (dx / distanceToTarget) * step;

        projectile.y += (dy / distanceToTarget) * step;
      } else {
        const direction = normalize(dx, dy);

        projectile.x += direction.x * step;

        projectile.y += direction.y * step;
      }
    }

    this.cleanupDeadEnemies();
  }

  // ==========================================================
  // APPLY PROJECTILE DAMAGE
  // ==========================================================

  applyProjectileHit(projectile, target) {
    const damage = projectile.damage * target.damageTakenMultiplier;

    const previousTargetHp = target.hp;

    target.hp -= damage;

    target.hitFlash = 0.08;

    this.effects.push({
      type: "impact",

      x: target.x,

      y: target.y,

      life: 0.16,
    });

    const owner = this.towersById.get(projectile.towerId) || null;

    // --------------------------------------------------------
    // SPLASH
    // --------------------------------------------------------

    if (projectile.splashRadius > 0) {
      const splashRadiusSq = projectile.splashRadius * projectile.splashRadius;

      const candidates = this.grid.queryCircle(
        target.x,

        target.y,

        projectile.splashRadius,

        this.targetQuery,
      );

      for (let i = 0; i < candidates.length; i += 1) {
        const enemy = candidates[i];

        if (enemy === target || !enemy.active || enemy.hp <= 0) {
          continue;
        }

        if (
          distanceSq(
            target.x,

            target.y,

            enemy.x,

            enemy.y,
          ) <= splashRadiusSq
        ) {
          const previousHp = enemy.hp;

          enemy.hp -= damage * 0.55;

          enemy.hitFlash = 0.08;

          if (previousHp > 0 && enemy.hp <= 0 && owner) {
            owner.kills += 1;
          }
        }
      }
    }

    // --------------------------------------------------------
    // MAIN TARGET KILL
    // --------------------------------------------------------

    if (previousTargetHp > 0 && target.hp <= 0 && owner) {
      owner.kills += 1;
    }
  }

  // ==========================================================
  // CLEANUP DEAD ENEMIES
  // ==========================================================

  cleanupDeadEnemies() {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];

      if (enemy.hp > 0) {
        continue;
      }

      // The stress benchmark must keep the required 5,000 active
      // enemies throughout the measurement. Recycle a defeated
      // enemy in place instead of removing it or creating effects.
      // This also avoids allocation/GC spikes during the benchmark.
      if (this.state.stressMode) {
        const segment = (enemy.id * 7) % (this.path.length - 1);
        const a = this.path[segment];
        const b = this.path[segment + 1];
        const t = ((enemy.id * 13) % 100) / 100;

        enemy.hp = enemy.maxHp;
        enemy.pathIndex = segment;
        enemy.progress = (segment + t) / (this.path.length - 1);
        enemy.x = a.x + (b.x - a.x) * t;
        enemy.y = a.y + (b.y - a.y) * t;
        enemy.hitFlash = 0;

        continue;
      }

      this.state.money += enemy.reward;

      this.state.score += enemy.reward * 2;

      this.effects.push({
        type: "kill",

        x: enemy.x,

        y: enemy.y,

        life: 0.2,
      });

      this.enemyPool.release(enemy);

      this.enemiesById.delete(enemy.id);

      this.enemies.splice(i, 1);
    }
  }

  // ==========================================================
  // UPDATE EFFECTS
  // ==========================================================

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];

      effect.life -= dt;

      if (effect.life <= 0) {
        this.effects.splice(i, 1);
      }
    }
  }

  // ==========================================================
  // WAVE COMPLETION
  // ==========================================================

  // No separate method is necessary here because the
  // current wave completion logic lives in updateSpawner().
  //
  // Stress mode doesn't use normal wave progression.

  // ==========================================================
  // GET TOWER UNDER POINTER
  // ==========================================================

  getTowerAt(x, y) {
    for (let i = this.towers.length - 1; i >= 0; i -= 1) {
      const tower = this.towers[i];

      if (
        distanceSq(
          x,
          y,

          tower.x,
          tower.y,
        ) <=
        20 * 20
      ) {
        return tower;
      }
    }

    return null;
  }

  // ==========================================================
  // CAN PLACE TOWER
  // ==========================================================

  canPlaceTower(x, y, type) {
    if (x < 25 || x > MAP.width - 25 || y < 25 || y > MAP.height - 25) {
      return false;
    }

    if (
      isPointNearPath(
        x,

        y,

        this.path,

        34,
      )
    ) {
      return false;
    }

    if (
      this.towers.some(
        (tower) =>
          distanceSq(
            x,

            y,

            tower.x,

            tower.y,
          ) <
          42 * 42,
      )
    ) {
      return false;
    }

    return Boolean(TOWER_TYPES[type]);
  }

  // ==========================================================
  // PLACE TOWER
  // ==========================================================

  tryPlaceTower(x, y) {
    const type = this.selectedBuildType;

    if (!type) {
      return false;
    }

    const data = TOWER_TYPES[type];

    if (this.state.money < data.cost) {
      return false;
    }

    if (
      !this.canPlaceTower(
        x,

        y,

        type,
      )
    ) {
      return false;
    }

    const tower = new Tower();

    tower.init(
      this.nextTowerId++,

      type,

      x,

      y,
    );

    this.towers.push(tower);

    this.towersById.set(
      tower.id,

      tower,
    );

    this.state.money -= data.cost;

    this.selectedTowerId = tower.id;

    this.selectedBuildType = null;

    this.emitSnapshot(true);

    return true;
  }

  // ==========================================================
  // SELECT BUILD TYPE
  // ==========================================================

  selectBuildType(type) {
    if (!TOWER_TYPES[type]) {
      return;
    }

    this.selectedBuildType = this.selectedBuildType === type ? null : type;

    this.selectedTowerId = 0;

    this.emitSnapshot(true);
  }

  // ==========================================================
  // UPGRADE TOWER
  // ==========================================================

  upgradeSelectedTower() {
    const tower = this.towers.find((item) => item.id === this.selectedTowerId);

    if (!tower || tower.level >= 3) {
      return;
    }

    const data = TOWER_TYPES[tower.type];

    const cost = data.upgradeCosts[tower.level - 1];

    if (this.state.money < cost) {
      return;
    }

    this.state.money -= cost;

    tower.totalSpent += cost;

    tower.level += 1;
    tower.statsCache = null;

    this.emitSnapshot(true);
  }

  // ==========================================================
  // SELL TOWER
  // ==========================================================

  sellSelectedTower() {
    const index = this.towers.findIndex((item) => item.id === this.selectedTowerId);

    if (index < 0) {
      return;
    }

    const tower = this.towers[index];

    this.state.money += Math.floor(tower.totalSpent * 0.7);

    this.towersById.delete(tower.id);

    this.towers.splice(index, 1);

    this.selectedTowerId = 0;

    this.emitSnapshot(true);
  }

  // ==========================================================
  // POINTER POSITION
  // ==========================================================

  getCanvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * MAP.width,
      y: ((event.clientY - rect.top) / rect.height) * MAP.height,
    };
  }

  handlePointerMove(event) {
    const point = this.getCanvasPoint(event);

    this.pointerX = clamp(point.x, 0, MAP.width);
    this.pointerY = clamp(point.y, 0, MAP.height);
    this.pointerInsideCanvas = true;
  }

  handlePointerLeave() {
    this.pointerInsideCanvas = false;
  }

  handleKeyDown(event) {
    if (event.key === "Escape") {
      this.selectedBuildType = null;
      this.selectedTowerId = 0;
      this.emitSnapshot(true);
      this.render();
    }

    if (event.code === "Space") {
      event.preventDefault();
      this.togglePause();
    }
  }

  // ==========================================================
  // POINTER INPUT
  // ==========================================================

  handlePointer(event) {
    if (
      this.state.paused ||
      this.state.victory ||
      this.state.gameOver ||
      this.state.stressMode
    ) {
      return;
    }

    const point = this.getCanvasPoint(event);

    const x = point.x;
    const y = point.y;

    if (this.selectedBuildType) {
      this.tryPlaceTower(x, y);
      return;
    }

    const tower = this.getTowerAt(x, y);

    this.selectedTowerId = tower ? tower.id : 0;

    this.emitSnapshot(true);
  }

  // ==========================================================
  // SELECTED TOWER SNAPSHOT
  // ==========================================================

  getSelectedTowerSnapshot() {
    const tower = this.towers.find((item) => item.id === this.selectedTowerId);

    if (!tower) {
      return null;
    }

    const data = TOWER_TYPES[tower.type];

    const stats = this.getTowerStats(tower);

    return {
      id: tower.id,

      type: tower.type,

      name: data.name,

      level: tower.level,

      damage: stats.damage,

      range: stats.range,

      fireRate: stats.fireRate,

      kills: tower.kills,

      totalSpent: tower.totalSpent,

      maxLevel: 3,

      upgradeCost: tower.level < 3 ? data.upgradeCosts[tower.level - 1] : null,

      sellValue: Math.floor(tower.totalSpent * 0.7),
    };
  }

  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  getSnapshot() {
    return {
      ...this.state,

      selectedBuildType: this.selectedBuildType,

      selectedTower: this.getSelectedTowerSnapshot(),

      speedMultiplier: this.speedMultiplier,

      objectPoolSize: this.enemyPool.items.length,

      projectilePoolSize: this.projectilePool.items.length,

      benchmark: {
        ...this.state.benchmark,
      },
    };
  }

  // ==========================================================
  // SEND SNAPSHOT TO REACT
  // ==========================================================

  emitSnapshot(force = false) {
    if (!this.onSnapshot) {
      return;
    }

    this.onSnapshot(
      this.getSnapshot(),

      force,
    );
  }

  // ==========================================================
  // STRESS WORLD BUILDER
  // ==========================================================

  prepareStressWorld() {
    this.clearEntities();
    this.stressProjectileByTower.clear();

    this.state.stressMode = true;
    this.state.runningWave = false;
    this.state.waveReady = false;
    this.state.wave = 50;
    this.state.money = 99999;
    this.state.health = 100;
    this.state.score = 0;

    this.selectedBuildType = null;
    this.selectedTowerId = 0;

    const towerTypes = ["blaster", "cannon", "sniper"];
    const enemyTypes = ["basic", "runner", "tank", "armored"];

    // --------------------------------------------------------
    // CREATE EXACTLY 100 WELL-SPACED TOWERS
    // --------------------------------------------------------

    const candidates = [];

    for (let y = 36; y <= 524; y += 44) {
      for (let x = 36; x <= 916; x += 44) {
        if (
          isPointNearPath(
            x,
            y,
            this.path,
            34,
          )
        ) {
          continue;
        }

        if (distanceSq(x, y, 910, 470) < 55 * 55) {
          continue;
        }

        candidates.push({ x, y });
      }
    }

    // Farthest-point sampling spreads the 100 towers across the map
    // instead of filling only the top-left corner.
    const selectedCandidates = [];

    while (selectedCandidates.length < STRESS_COUNTS.towers && candidates.length > 0) {
      let bestIndex = 0;
      let bestDistance = -1;

      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];

        if (selectedCandidates.length === 0) {
          bestIndex = i;
          break;
        }

        let nearestDistance = Infinity;

        for (let j = 0; j < selectedCandidates.length; j += 1) {
          nearestDistance = Math.min(
            nearestDistance,
            distanceSq(
              candidate.x,
              candidate.y,
              selectedCandidates[j].x,
              selectedCandidates[j].y,
            ),
          );
        }

        if (nearestDistance > bestDistance) {
          bestDistance = nearestDistance;
          bestIndex = i;
        }
      }

      selectedCandidates.push(candidates[bestIndex]);
      candidates.splice(bestIndex, 1);
    }

    if (selectedCandidates.length !== STRESS_COUNTS.towers) {
      throw new Error(`Stress setup could only place ${selectedCandidates.length} towers.`);
    }

    for (let i = 0; i < selectedCandidates.length; i += 1) {
      const position = selectedCandidates[i];
      const tower = new Tower();

      tower.init(
        this.nextTowerId++,
        towerTypes[i % towerTypes.length],
        position.x,
        position.y,
      );

      tower.level = 3;
      tower.statsCache = null;

      this.towers.push(tower);
      this.towersById.set(tower.id, tower);
    }

    // --------------------------------------------------------
    // CREATE EXACTLY 5,000 ENEMIES
    // --------------------------------------------------------

    for (let i = 0; i < STRESS_COUNTS.enemies; i += 1) {
      const enemy = this.enemyPool.acquire();
      const pathIndex = i % (this.path.length - 1);
      const a = this.path[pathIndex];
      const b = this.path[pathIndex + 1];
      const t = (i * 0.173) % 1;

      enemy.init(
        this.nextEnemyId++,
        enemyTypes[i % enemyTypes.length],
        1.7,
        1,
        a,
      );

      enemy.x = a.x + (b.x - a.x) * t;
      enemy.y = a.y + (b.y - a.y) * t;
      enemy.pathIndex = pathIndex;
      enemy.progress = (pathIndex + t) / (this.path.length - 1);

      this.enemies.push(enemy);
      this.enemiesById.set(enemy.id, enemy);
    }

    // Build the grid before benchmark warmup so setup work is excluded.
    this.grid.clear();
    for (let i = 0; i < this.enemies.length; i += 1) {
      this.grid.insert(this.enemies[i]);
    }

    // --------------------------------------------------------
    // CREATE EXACTLY 1,000 PROJECTILES
    // --------------------------------------------------------

    for (let i = 0; i < STRESS_COUNTS.projectiles; i += 1) {
      const projectile = this.projectilePool.acquire();
      const tower = this.towers[i % this.towers.length];
      const target = this.enemies[(i * 37) % this.enemies.length];

      projectile.targetId = target.id;
      projectile.towerId = tower.id;
      projectile.type = tower.type;
      projectile.speed = 400;
      projectile.damage = 15;
      projectile.radius = 2.25;
      projectile.splashRadius = 0;
      projectile.lifetime = 4;

      // Distribute ten shots along each tower's target line. Every
      // projectile therefore visibly originates from a real tower.
      const dx = target.x - tower.x;
      const dy = target.y - tower.y;
      const phase = (i % 10) * 0.075;

      projectile.x = tower.x + dx * phase;
      projectile.y = tower.y + dy * phase;

      this.projectiles.push(projectile);

      if (i < this.towers.length) {
        this.stressProjectileByTower.set(tower.id, projectile);
      }
    }

    for (let i = 0; i < this.towers.length; i += 1) {
      const tower = this.towers[i];
      const target = this.enemies[(i * 37) % this.enemies.length];
      tower.targetId = target?.id ?? 0;
    }

    this.state.enemiesAlive = this.enemies.length;
    this.state.towerCount = this.towers.length;
    this.state.projectileCount = this.projectiles.length;
  }

  // ==========================================================
  // BENCHMARK SETUP
  // ==========================================================

  createEmptyBenchmarkState() {
    return {
      active: true,
      kind: "final",
      experimentId: null,
      experimentStage: "idle",
      phase: "warmup",
      warmupElapsed: 0,
      measuredElapsed: 0,
      totalFrames: 0,
      goodFrames: 0,
      badFrames: 0,
      totalFrameTime: 0,
      totalCpuFrameTime: 0,
      averageFrameMs: 0,
      averageCpuFrameMs: 0,
      worstFrameMs: 0,
      worstCpuFrameMs: 0,
      pass45FpsPercent: 0,
      over33msPercent: 0,
      complete: false,
      workload: { ...STRESS_COUNTS },
      before: null,
      after: null,
    };
  }

  resetBenchmarkCounters(kind = "final", experimentId = null, experimentStage = "idle") {
    this.benchmark = {
      ...this.createEmptyBenchmarkState(),
      kind,
      experimentId,
      experimentStage,
    };

    this.state.benchmark = {
      ...this.benchmark,
    };

    this.frameSamples = [];
  }

  // ==========================================================
  // INITIAL-STYLE BASELINE
  // ==========================================================

  runStressBaseline() {
    this.performanceOptions = {
      spatialGrid: false,
      staticCanvas: false,
      allocationFreeProjectiles: false,
      stressSimpleRendering: true,
    };

    this.experiment = {
      active: false,
      id: null,
      stage: "baseline",
      before: null,
      after: null,
    };

    this.speedMultiplier = 1;
    this.state.paused = false;
    this.accumulator = 0;
    this.lastTime = performance.now();

    this.prepareStressWorld();
    this.resetBenchmarkCounters("baseline");

    this.state.benchmark = {
      ...this.state.benchmark,
      active: true,
      phase: "warmup",
      kind: "baseline",
    };

    this.emitSnapshot(true);
  }

  // ==========================================================
  // FINAL STRESS TEST
  // ==========================================================

  runStressTest() {
    this.performanceOptions = {
      spatialGrid: true,
      staticCanvas: false,
      allocationFreeProjectiles: true,
      stressSimpleRendering: true,
    };

    this.experiment = {
      active: false,
      id: null,
      stage: "idle",
      before: null,
      after: null,
    };

    this.speedMultiplier = 1;
    this.state.paused = false;
    this.accumulator = 0;
    this.lastTime = performance.now();

    this.prepareStressWorld();
    this.resetBenchmarkCounters("final");

    this.state.benchmark = {
      ...this.state.benchmark,
      active: true,
      phase: "warmup",
    };

    this.emitSnapshot(true);
  }

  // ==========================================================
  // PERFORMANCE EXPERIMENT
  // ==========================================================

  runPerformanceExperiment(experimentId) {
    const experiment = PERFORMANCE_EXPERIMENTS[experimentId];

    if (!experiment || this.benchmark.active) {
      return;
    }

    this.speedMultiplier = 1;
    this.state.paused = false;
    this.accumulator = 0;
    this.lastTime = performance.now();

    // Load the exact assignment stress workload first. The A/B measurement
    // then runs as a short isolated CPU test while this world remains visible.
    this.prepareStressWorld();

    this.performanceOptions = {
      spatialGrid: true,
      staticCanvas: false,
      allocationFreeProjectiles: true,
      stressSimpleRendering: true,
    };

    this.experiment = {
      active: true,
      id: experimentId,
      stage: "before",
      before: null,
      after: null,
    };

    this.state.benchmark = {
      ...this.createEmptyBenchmarkState(),
      active: true,
      kind: "experiment",
      experimentId,
      experimentStage: "before",
      phase: "measuring",
      workload: { ...STRESS_COUNTS },
    };

    this.emitSnapshot(true);

    // Give the browser one frame to paint the loaded stress scene before
    // beginning the synchronous measurement.
    requestAnimationFrame(() => {
      const before = this.measureExperiment(experimentId, false);

      this.experiment.before = before;

      this.state.benchmark = {
        ...this.state.benchmark,
        before,
        phase: "after",
        experimentStage: "after",
      };

      this.emitSnapshot(true);

      requestAnimationFrame(() => {
        // Recreate the same stress world before the AFTER measurement so
        // both runs start from equivalent entity positions and targets.
        this.prepareStressWorld();
        this.performanceOptions = {
          spatialGrid: true,
          staticCanvas: false,
          allocationFreeProjectiles: true,
          stressSimpleRendering: true,
        };

        const after = this.measureExperiment(experimentId, true);

        this.experiment.after = after;
        this.experiment.stage = "complete";
        this.experiment.active = false;

        const completedBenchmark = {
          ...this.state.benchmark,
          active: false,
          phase: "complete",
          experimentStage: "complete",
          before,
          after,
          complete: true,
        };

        this.clearEntities();
        this.stressProjectileByTower.clear();

        this.state = {
          ...this.createInitialState(),
          benchmark: completedBenchmark,
        };

        this.performanceOptions = {
          spatialGrid: true,
          staticCanvas: false,
          allocationFreeProjectiles: true,
          stressSimpleRendering: false,
        };

        this.experiment = {
          active: false,
          id: null,
          stage: "idle",
          before: null,
          after: null,
        };

        this.speedMultiplier = 1;
        this.accumulator = 0;
        this.lastTime = performance.now();

        this.emitSnapshot(true);
      });
    });
  }

  measureExperiment(experimentId, optimized) {
    if (experimentId === "spatialGrid") {
      this.performanceOptions.spatialGrid = optimized;

      if (optimized) {
        this.grid.clear();

        for (let i = 0; i < this.enemies.length; i += 1) {
          this.grid.insert(this.enemies[i]);
        }
      }

      // Warm the selected path before taking timed samples.
      for (let i = 0; i < this.towers.length; i += 1) {
        this.acquireTarget(this.towers[i]);
      }

      let checksum = 0;
      const start = performance.now();

      for (let iteration = 0; iteration < EXPERIMENT_ITERATIONS; iteration += 1) {
        for (let i = 0; i < this.towers.length; i += 1) {
          const target = this.acquireTarget(this.towers[i]);
          checksum += target?.id ?? 0;
        }
      }

      const elapsed = performance.now() - start;
      this.experimentChecksum = checksum;

      return {
        metric: "100 tower target-acquisition passes",
        iterations: EXPERIMENT_ITERATIONS,
        totalMs: elapsed,
        averageMs: elapsed / EXPERIMENT_ITERATIONS,
        averageFpsEquivalent: 0,
        worstFrameMs: elapsed,
        pass45FpsPercent: 0,
        over33msPercent: 0,
        totalFrames: EXPERIMENT_ITERATIONS,
        averageCpuFrameMs: elapsed / EXPERIMENT_ITERATIONS,
      };
    }

    // Object-pool experiment. The BEFORE side performs fresh object
    // allocations; the AFTER side reuses a pre-warmed pool. Both sides
    // execute the same number of acquire/release operations.
    const iterations = POOL_EXPERIMENT_ITERATIONS;
    const objectCount = POOL_EXPERIMENT_OBJECTS;
    let checksum = 0;

    if (optimized) {
      // Pre-warm the pool outside the timed section. The AFTER result should
      // represent reuse, not the one-time setup allocation cost.
      const pool = new ObjectPool(
        () => new Enemy(),
        (item) => item.reset(),
        objectCount,
      );

      const start = performance.now();

      for (let iteration = 0; iteration < iterations; iteration += 1) {
        for (let i = 0; i < objectCount; i += 1) {
          const item = pool.acquire();
          checksum += item.active ? 1 : 0;
          pool.release(item);
        }
      }

      const elapsed = performance.now() - start;
      this.experimentChecksum = checksum;

      return {
        metric: "5,000 acquire/release operations",
        iterations,
        totalMs: elapsed,
        averageMs: elapsed / iterations,
        averageFpsEquivalent: 0,
        worstFrameMs: elapsed,
        pass45FpsPercent: 0,
        over33msPercent: 0,
        totalFrames: iterations,
        averageCpuFrameMs: elapsed / iterations,
      };
    }

    const start = performance.now();

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (let i = 0; i < objectCount; i += 1) {
        const item = new Enemy();
        item.active = true;
        checksum += item.active ? 1 : 0;
        item.reset();
      }
    }

    const elapsed = performance.now() - start;
    this.experimentChecksum = checksum;

    return {
      metric: "5,000 acquire/release operations",
      iterations,
      totalMs: elapsed,
      averageMs: elapsed / iterations,
      averageFpsEquivalent: 0,
      worstFrameMs: elapsed,
      pass45FpsPercent: 0,
      over33msPercent: 0,
      totalFrames: iterations,
      averageCpuFrameMs: elapsed / iterations,
    };
  }

  // UPDATE BENCHMARK
  // ==========================================================

  updateBenchmark(rawDelta, frameMs) {
    if (!this.benchmark.active) {
      return;
    }

    if (this.benchmark.phase === "warmup") {
      this.benchmark.warmupElapsed += rawDelta;
      this.state.benchmark.warmupElapsed = this.benchmark.warmupElapsed;

      if (this.benchmark.warmupElapsed >= (
        this.benchmark.kind === "experiment"
          ? EXPERIMENT_WARMUP_SECONDS
          : BENCHMARK_WARMUP_SECONDS
      )) {
        this.benchmark.phase = "measuring";
        this.benchmark.measuredElapsed = 0;
        this.benchmark.totalFrames = 0;
        this.benchmark.goodFrames = 0;
        this.benchmark.badFrames = 0;
        this.benchmark.totalFrameTime = 0;
        this.benchmark.totalCpuFrameTime = 0;
        this.benchmark.worstFrameMs = 0;
        this.benchmark.worstCpuFrameMs = 0;
        this.frameSamples = [];
        this.state.benchmark.phase = "measuring";
        this.emitSnapshot(true);
      }

      return;
    }

    if (this.benchmark.phase !== "measuring") {
      return;
    }

    const cpuFrameMs = this.state.performance.cpuFrameMs || 0;

    this.benchmark.measuredElapsed += rawDelta;
    this.benchmark.totalFrames += 1;
    this.benchmark.totalFrameTime += frameMs;
    this.benchmark.totalCpuFrameTime += cpuFrameMs;
    this.benchmark.worstFrameMs = Math.max(this.benchmark.worstFrameMs, frameMs);
    this.benchmark.worstCpuFrameMs = Math.max(this.benchmark.worstCpuFrameMs, cpuFrameMs);

    if (frameMs <= TARGET_FRAME_MS) {
      this.benchmark.goodFrames += 1;
    }

    if (frameMs > BAD_FRAME_MS) {
      this.benchmark.badFrames += 1;
    }

    this.benchmark.averageFrameMs =
      this.benchmark.totalFrameTime / this.benchmark.totalFrames;

    this.benchmark.averageCpuFrameMs =
      this.benchmark.totalCpuFrameTime / this.benchmark.totalFrames;

    this.benchmark.pass45FpsPercent =
      (this.benchmark.goodFrames / this.benchmark.totalFrames) * 100;

    this.benchmark.over33msPercent =
      (this.benchmark.badFrames / this.benchmark.totalFrames) * 100;

    this.state.benchmark = {
      ...this.state.benchmark,
      active: true,
      kind: this.benchmark.kind,
      experimentId: this.benchmark.experimentId,
      experimentStage: this.benchmark.experimentStage,
      phase: "measuring",
      warmupElapsed: this.benchmark.warmupElapsed,
      measuredElapsed: this.benchmark.measuredElapsed,
      totalFrames: this.benchmark.totalFrames,
      goodFrames: this.benchmark.goodFrames,
      badFrames: this.benchmark.badFrames,
      averageFrameMs: this.benchmark.averageFrameMs,
      averageCpuFrameMs: this.benchmark.averageCpuFrameMs,
      worstFrameMs: this.benchmark.worstFrameMs,
      worstCpuFrameMs: this.benchmark.worstCpuFrameMs,
      pass45FpsPercent: this.benchmark.pass45FpsPercent,
      over33msPercent: this.benchmark.over33msPercent,
      workload: { ...STRESS_COUNTS },
      before: this.experiment.before,
      after: null,
      complete: false,
    };

    const duration = this.benchmark.kind === "experiment"
      ? EXPERIMENT_DURATION_SECONDS
      : this.benchmark.kind === "baseline"
        ? BASELINE_DURATION_SECONDS
        : BENCHMARK_DURATION_SECONDS;

    if (this.benchmark.measuredElapsed >= duration) {
      if (this.benchmark.kind === "experiment" && this.benchmark.experimentStage === "before") {
        this.startAfterExperimentRun();
      } else if (this.benchmark.kind === "experiment") {
        this.finishExperiment();
      } else {
        this.finishBenchmark();
      }
    }
  }

  // ==========================================================
  // FINISH EXPERIMENT
  // ==========================================================

  finishExperiment() {
    const after = {
      averageFrameMs: this.benchmark.averageFrameMs,
      averageFps: this.benchmark.averageFrameMs > 0 ? 1000 / this.benchmark.averageFrameMs : 0,
      worstFrameMs: this.benchmark.worstFrameMs,
      pass45FpsPercent: this.benchmark.pass45FpsPercent,
      over33msPercent: this.benchmark.over33msPercent,
      totalFrames: this.benchmark.totalFrames,
      averageCpuFrameMs: this.benchmark.averageCpuFrameMs,
    };

    this.experiment.after = after;
    this.experiment.active = false;
    this.experiment.stage = "complete";
    this.benchmark.active = false;
    this.benchmark.phase = "complete";
    this.benchmark.complete = true;

    this.state.benchmark = {
      ...this.state.benchmark,
      active: false,
      phase: "complete",
      experimentStage: "complete",
      before: this.experiment.before,
      after,
      complete: true,
    };

    const completedExperiment = { ...this.state.benchmark };

    this.clearEntities();
    this.stressProjectileByTower.clear();
    this.state = {
      ...this.createInitialState(),
      benchmark: completedExperiment,
    };
    this.performanceOptions = {
      spatialGrid: true,
      staticCanvas: false,
      allocationFreeProjectiles: true,
      stressSimpleRendering: false,
    };
    this.experiment = { active: false, id: null, stage: "idle", before: null, after: null };
    this.speedMultiplier = 1;
    this.accumulator = 0;
    this.lastTime = performance.now();

    this.emitSnapshot(true);
  }

  // ==========================================================
  // FINISH FINAL BENCHMARK
  // ==========================================================

  finishBenchmark() {
    this.benchmark.phase = "complete";
    this.benchmark.complete = true;
    this.benchmark.active = false;

    this.state.benchmark = {
      ...this.state.benchmark,
      active: false,
      kind: this.benchmark.kind,
      phase: "complete",
      experimentId: null,
      experimentStage: this.benchmark.kind === "baseline" ? "baseline" : "idle",
      averageFrameMs: this.benchmark.averageFrameMs,
      averageCpuFrameMs: this.benchmark.averageCpuFrameMs,
      worstFrameMs: this.benchmark.worstFrameMs,
      worstCpuFrameMs: this.benchmark.worstCpuFrameMs,
      pass45FpsPercent: this.benchmark.pass45FpsPercent,
      over33msPercent: this.benchmark.over33msPercent,
      totalFrames: this.benchmark.totalFrames,
      complete: true,
      workload: { ...STRESS_COUNTS },
    };

    const completedBenchmark = { ...this.state.benchmark };

    this.clearEntities();
    this.stressProjectileByTower.clear();
    this.state = {
      ...this.createInitialState(),
      benchmark: completedBenchmark,
    };
    this.performanceOptions = {
      spatialGrid: true,
      staticCanvas: false,
      allocationFreeProjectiles: true,
      stressSimpleRendering: false,
    };
    this.experiment = { active: false, id: null, stage: "idle", before: null, after: null };
    this.speedMultiplier = 1;
    this.accumulator = 0;
    this.lastTime = performance.now();

    this.emitSnapshot(true);
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  render() {
    const ctx = this.ctx;

    ctx.clearRect(
      0,
      0,
      MAP.width,
      MAP.height,
    );

    if (this.performanceOptions.staticCanvas) {
      ctx.drawImage(this.staticCanvas, 0, 0);
    } else {
      this.renderBackground(ctx);
      this.renderPath(ctx);
    }

    this.renderPlacementPreview(ctx);

    this.renderTowers(ctx);

    this.renderProjectiles(ctx);

    this.renderEnemies(ctx);

    this.renderNotification(ctx);

    this.renderEffects(ctx);
  }

  // ==========================================================
  // BUILD STATIC CANVAS LAYER
  // ==========================================================

  rebuildStaticLayer() {
    const ctx = this.staticCtx;

    ctx.clearRect(0, 0, MAP.width, MAP.height);
    this.renderBackground(ctx);
    this.renderPath(ctx);
  }

  // ==========================================================
  // RENDER BACKGROUND
  // ==========================================================

  renderBackground(ctx) {
    ctx.fillStyle = "#07101c";

    ctx.fillRect(
      0,

      0,

      MAP.width,

      MAP.height,
    );

    ctx.strokeStyle = "rgba(135, 175, 220, 0.06)";

    ctx.lineWidth = 1;

    for (let x = 0; x <= MAP.width; x += 40) {
      ctx.beginPath();

      ctx.moveTo(x, 0);

      ctx.lineTo(x, MAP.height);

      ctx.stroke();
    }

    for (let y = 0; y <= MAP.height; y += 40) {
      ctx.beginPath();

      ctx.moveTo(0, y);

      ctx.lineTo(MAP.width, y);

      ctx.stroke();
    }
  }

  // ==========================================================
  // RENDER PATH
  // ==========================================================

  renderPath(ctx) {
    ctx.lineCap = "round";

    ctx.lineJoin = "round";

    ctx.strokeStyle = "#27364a";

    ctx.lineWidth = 54;

    ctx.beginPath();

    ctx.moveTo(
      this.path[0].x,

      this.path[0].y,
    );

    for (let i = 1; i < this.path.length; i += 1) {
      ctx.lineTo(
        this.path[i].x,

        this.path[i].y,
      );
    }

    ctx.stroke();

    ctx.strokeStyle = "#42536c";

    ctx.lineWidth = 4;

    ctx.beginPath();

    ctx.moveTo(
      this.path[0].x,

      this.path[0].y,
    );

    for (let i = 1; i < this.path.length; i += 1) {
      ctx.lineTo(
        this.path[i].x,

        this.path[i].y,
      );
    }

    ctx.stroke();

    const base = this.path[this.path.length - 1];

    ctx.fillStyle = "#10243e";

    ctx.beginPath();

    ctx.arc(
      base.x,

      base.y,

      MAP.baseRadius + 10,

      0,

      Math.PI * 2,
    );

    ctx.fill();

    ctx.strokeStyle = "#65d7ff";

    ctx.lineWidth = 3;

    ctx.beginPath();

    ctx.arc(
      base.x,

      base.y,

      MAP.baseRadius,

      0,

      Math.PI * 2,
    );

    ctx.stroke();

    ctx.fillStyle = "#65d7ff";

    ctx.font = "700 12px system-ui";

    ctx.textAlign = "center";

    ctx.fillText(
      "BASE",

      base.x,

      base.y + 4,
    );
  }

  // ==========================================================
  // RENDER PLACEMENT PREVIEW
  // ==========================================================

  renderPlacementPreview(ctx) {
    if (!this.selectedBuildType || !this.pointerInsideCanvas) {
      return;
    }

    const type = this.selectedBuildType;
    const data = TOWER_TYPES[type];
    const valid =
      this.state.money >= data.cost &&
      this.canPlaceTower(this.pointerX, this.pointerY, type);

    const stats = this.getTowerStats({
      type,
      level: 1,
    });

    const color = valid
      ? data.color
      : "#ff6f7d";

    ctx.save();

    ctx.globalAlpha = 0.42;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(
      this.pointerX,
      this.pointerY,
      16,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.globalAlpha = 0.08;
    ctx.beginPath();
    ctx.arc(
      this.pointerX,
      this.pointerY,
      stats.range,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(
      this.pointerX,
      this.pointerY,
      stats.range,
      0,
      Math.PI * 2,
    );
    ctx.stroke();

    ctx.restore();
  }

  // ==========================================================
  // RENDER TOWERS
  // ==========================================================

  renderTowers(ctx) {
    // Keep the exact same tower silhouettes used during normal gameplay,
    // including in the stress test. The benchmark still uses the
    // lightweight enemy/projectile renderers because those populations are
    // much larger.
    for (let i = 0; i < this.towers.length; i += 1) {
      const tower = this.towers[i];
      const data = TOWER_TYPES[tower.type];
      const stats = this.getTowerStats(tower);
      const selected = tower.id === this.selectedTowerId;
      const target = tower.targetId ? this.findEnemyById(tower.targetId) : null;

      ctx.save();

      if (selected) {
        ctx.fillStyle = "rgba(101, 215, 255, 0.08)";
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, stats.range, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(101, 215, 255, 0.55)";
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, stats.range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Targeting beam, subtle enough not to clutter the battlefield.
      if (target && target.active) {
        ctx.strokeStyle = `${data.color}55`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tower.x, tower.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }

      // Tower platform.
      ctx.fillStyle = "#0e1a2a";
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, 18, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = selected ? "#ffffff" : data.color;
      ctx.lineWidth = selected ? 3 : 2.5;
      ctx.stroke();

      // Directional barrel.
      const aimX = target?.x ?? tower.x + 1;
      const aimY = target?.y ?? tower.y;
      const angle = Math.atan2(aimY - tower.y, aimX - tower.x);

      ctx.save();
      ctx.translate(tower.x, tower.y);
      ctx.rotate(angle);
      ctx.fillStyle = data.color;

      if (tower.type === "cannon") {
        ctx.fillRect(2, -4, 14, 8);
      } else if (tower.type === "sniper") {
        ctx.fillRect(1, -2, 18, 4);
      } else {
        ctx.fillRect(2, -3, 11, 6);
      }
      ctx.restore();

      // Core.
      ctx.fillStyle = data.color;
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Level badge.
      ctx.fillStyle = "rgba(4, 10, 18, 0.9)";
      ctx.beginPath();
      ctx.roundRect(tower.x - 12, tower.y + 20, 24, 13, 6);
      ctx.fill();

      ctx.fillStyle = "#d9e3f1";
      ctx.font = "800 9px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`L${tower.level}`, tower.x, tower.y + 26.5);

      ctx.restore();
    }
  }

  // ==========================================================
  // RENDER PROJECTILES
  // ==========================================================

  renderProjectiles(ctx) {
    if (this.state.stressMode && this.performanceOptions.stressSimpleRendering) {
      this.renderStressProjectiles(ctx);
      return;
    }

    for (let i = 0; i < this.projectiles.length; i += 1) {
      const projectile = this.projectiles[i];

      if (
        projectile.x < -ENEMY_VIEW_MARGIN ||
        projectile.x > MAP.width + ENEMY_VIEW_MARGIN ||
        projectile.y < -ENEMY_VIEW_MARGIN ||
        projectile.y > MAP.height + ENEMY_VIEW_MARGIN
      ) {
        continue;
      }

      const color = TOWER_TYPES[projectile.type].color;

      ctx.fillStyle = color;

      ctx.beginPath();

      ctx.arc(
        projectile.x,

        projectile.y,

        projectile.radius,

        0,

        Math.PI * 2,
      );

      ctx.fill();
    }
  }

  // ==========================================================
  // RENDER ENEMIES
  // ==========================================================

  renderEnemies(ctx) {
    if (this.state.stressMode && this.performanceOptions.stressSimpleRendering) {
      this.renderStressEnemies(ctx);
      return;
    }

    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];

      if (
        enemy.x < -ENEMY_VIEW_MARGIN ||
        enemy.x > MAP.width + ENEMY_VIEW_MARGIN ||
        enemy.y < -ENEMY_VIEW_MARGIN ||
        enemy.y > MAP.height + ENEMY_VIEW_MARGIN
      ) {
        continue;
      }

      const data = ENEMY_TYPES[enemy.type];
      const flash = enemy.hitFlash > 0;

      ctx.save();
      ctx.translate(enemy.x, enemy.y);

      const fill = flash ? "#ffffff" : data.color;
      ctx.fillStyle = fill;
      ctx.strokeStyle = flash ? "#ffffff" : "rgba(5, 12, 20, 0.75)";
      ctx.lineWidth = 1.5;

      if (enemy.type === "runner") {
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-enemy.radius * 0.72, -enemy.radius * 0.72, enemy.radius * 1.44, enemy.radius * 1.44);
      } else if (enemy.type === "tank") {
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(7, 15, 25, 0.35)";
        ctx.fillRect(-5, -5, 10, 10);
      } else if (enemy.type === "armored") {
        ctx.beginPath();
        for (let p = 0; p < 6; p += 1) {
          const angle = -Math.PI / 2 + p * Math.PI / 3;
          const px = Math.cos(angle) * enemy.radius;
          const py = Math.sin(angle) * enemy.radius;
          if (p === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();

      // Health bar.
      const barWidth = Math.max(18, enemy.radius * 2.2);
      const barX = enemy.x - barWidth / 2;
      const barY = enemy.y - enemy.radius - 9;

      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(barX, barY, barWidth, 3);

      ctx.fillStyle = enemy.type === "armored" ? "#ffd45f" : "#72f0a4";
      ctx.fillRect(
        barX,
        barY,
        barWidth * clamp(enemy.hp / enemy.maxHp, 0, 1),
        3,
      );
    }
  }

  // ==========================================================
  // FAST STRESS RENDERING
  // ==========================================================

  renderStressTowers(ctx) {
    // 100 towers are rendered with two batched paths. No per-frame
    // Maps, Path2D objects, transforms, or text are allocated.
    ctx.fillStyle = "#0e1a2a";
    ctx.beginPath();

    for (let i = 0; i < this.towers.length; i += 1) {
      const tower = this.towers[i];

      if (
        tower.x < -24 ||
        tower.x > MAP.width + 24 ||
        tower.y < -24 ||
        tower.y > MAP.height + 24
      ) {
        continue;
      }

      ctx.moveTo(tower.x + 10, tower.y);
      ctx.arc(tower.x, tower.y, 10, 0, Math.PI * 2);
    }

    ctx.fill();

    ctx.fillStyle = "#65d7ff";
    ctx.beginPath();

    for (let i = 0; i < this.towers.length; i += 1) {
      const tower = this.towers[i];

      if (
        tower.x < -24 ||
        tower.x > MAP.width + 24 ||
        tower.y < -24 ||
        tower.y > MAP.height + 24
      ) {
        continue;
      }

      ctx.moveTo(tower.x + 5, tower.y);
      ctx.arc(tower.x, tower.y, 5, 0, Math.PI * 2);
    }

    ctx.fill();
  }

  renderStressProjectiles(ctx) {
    // Use three batched paths, one per tower type. This keeps the exact
    // 1,000-projectile workload without allocating a Map/Path2D every frame.
    const projectileTypes = ["blaster", "cannon", "sniper"];

    for (let t = 0; t < projectileTypes.length; t += 1) {
      const type = projectileTypes[t];
      ctx.fillStyle = TOWER_TYPES[type].color;
      ctx.beginPath();

      for (let i = 0; i < this.projectiles.length; i += 1) {
        const projectile = this.projectiles[i];

        if (projectile.type !== type) {
          continue;
        }

        if (
          projectile.x < -8 ||
          projectile.x > MAP.width + 8 ||
          projectile.y < -8 ||
          projectile.y > MAP.height + 8
        ) {
          continue;
        }

        const size = Math.max(1.5, Math.min(3.5, projectile.radius));
        ctx.rect(
          projectile.x - size * 0.5,
          projectile.y - size * 0.5,
          size,
          size,
        );
      }

      ctx.fill();
    }
  }

  renderStressEnemies(ctx) {
    // Keep all 5,000 enemies active and simulated, but render a representative
    // sample so individual silhouettes stay readable instead of collapsing
    // into one continuous line. The full population still participates in
    // movement, targeting, and collision logic.
    const stride = 8;

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(5, 12, 20, 0.9)";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.96;

    // Basic drones.
    ctx.beginPath();
    for (let i = 0; i < this.enemies.length; i += stride) {
      const enemy = this.enemies[i];
      if (enemy.type !== "basic" || enemy.x < -12 || enemy.x > MAP.width + 12 || enemy.y < -12 || enemy.y > MAP.height + 12) {
        continue;
      }
      const r = 4.5;
      ctx.moveTo(enemy.x + r, enemy.y);
      ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
    }
    ctx.fill();

    // Runners use the same diamond silhouette as normal gameplay.
    ctx.beginPath();
    for (let i = 0; i < this.enemies.length; i += stride) {
      const enemy = this.enemies[i];
      if (enemy.type !== "runner" || enemy.x < -12 || enemy.x > MAP.width + 12 || enemy.y < -12 || enemy.y > MAP.height + 12) {
        continue;
      }
      const r = 4;
      ctx.moveTo(enemy.x, enemy.y - r);
      ctx.lineTo(enemy.x + r, enemy.y);
      ctx.lineTo(enemy.x, enemy.y + r);
      ctx.lineTo(enemy.x - r, enemy.y);
      ctx.closePath();
    }
    ctx.fill();

    // Tanks retain the large circular gameplay silhouette.
    ctx.beginPath();
    for (let i = 0; i < this.enemies.length; i += stride) {
      const enemy = this.enemies[i];
      if (enemy.type !== "tank" || enemy.x < -12 || enemy.x > MAP.width + 12 || enemy.y < -12 || enemy.y > MAP.height + 12) {
        continue;
      }
      const r = 5.5;
      ctx.moveTo(enemy.x + r, enemy.y);
      ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();

    // Armored enemies retain the six-sided gameplay silhouette.
    ctx.beginPath();
    for (let i = 0; i < this.enemies.length; i += stride) {
      const enemy = this.enemies[i];
      if (enemy.type !== "armored" || enemy.x < -12 || enemy.x > MAP.width + 12 || enemy.y < -12 || enemy.y > MAP.height + 12) {
        continue;
      }
      const r = 4.75;
      ctx.moveTo(enemy.x, enemy.y - r);
      ctx.lineTo(enemy.x + r * 0.86, enemy.y - r * 0.5);
      ctx.lineTo(enemy.x + r * 0.86, enemy.y + r * 0.5);
      ctx.lineTo(enemy.x, enemy.y + r);
      ctx.lineTo(enemy.x - r * 0.86, enemy.y + r * 0.5);
      ctx.lineTo(enemy.x - r * 0.86, enemy.y - r * 0.5);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  // ==========================================================
  // RENDER NOTIFICATION
  // ==========================================================

  renderNotification(ctx) {
    const note = this.state.notification;

    if (!note?.text || note.timer <= 0) {
      return;
    }

    const fade = clamp(Math.min(note.timer, 0.4) / 0.4, 0, 1);

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = "center";

    const x = MAP.width / 2;
    const y = 42;

    ctx.fillStyle = "rgba(4, 10, 18, 0.84)";
    ctx.beginPath();
    ctx.roundRect(x - 190, y - 19, 380, 42, 12);
    ctx.fill();

    ctx.strokeStyle = "rgba(101, 215, 255, 0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#65d7ff";
    ctx.font = "900 13px system-ui";
    ctx.fillText(note.text, x, y - 2);

    ctx.fillStyle = "#91a5bd";
    ctx.font = "600 9px system-ui";
    ctx.fillText(note.subtext, x, y + 13);

    ctx.restore();
  }

  // ==========================================================
  // RENDER EFFECTS
  // ==========================================================

  renderEffects(ctx) {
    for (let i = 0; i < this.effects.length; i += 1) {
      const effect = this.effects[i];

      const alpha = clamp(
        effect.life / 0.35,

        0,

        1,
      );

      ctx.globalAlpha = alpha;

      ctx.strokeStyle = effect.type === "baseHit" ? "#ff7f7f" : "#ffffff";

      ctx.lineWidth = 2;

      ctx.beginPath();

      ctx.arc(
        effect.x,

        effect.y,

        effect.type === "kill" ? 14 * (1 - alpha) + 4 : 9 + (1 - alpha) * 10,

        0,

        Math.PI * 2,
      );

      ctx.stroke();

      ctx.globalAlpha = 1;
    }
  }
}
