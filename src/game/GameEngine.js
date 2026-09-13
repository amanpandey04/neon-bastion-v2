// ============================================================
// IMPORTS
// ============================================================

import { MAP, PATH, TOWER_TYPES, ENEMY_TYPES, getWaveConfig } from "./data";

import { Enemy, Projectile, Tower } from "./entities";

import { ObjectPool } from "./ObjectPool";

import { SpatialGrid } from "./SpatialGrid";

import { clamp, distanceSq, isPointNearPath, normalize } from "./utils";

// ============================================================
// CONSTANTS
// ============================================================

const FIXED_STEP = 1 / 60;

const ENEMY_VIEW_MARGIN = 32;

// How long the benchmark waits before it starts
// counting performance.
const BENCHMARK_WARMUP_SECONDS = 2;

// How long the benchmark actually measures performance.
const BENCHMARK_DURATION_SECONDS = 30;

// We consider a frame to meet the assignment's
// 45 FPS requirement when it is <= 22.22ms.
const TARGET_FRAME_MS = 1000 / 45;

// The assignment says fewer than 5% of frames may
// exceed 33ms.
const BAD_FRAME_MS = 33;

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
    this.keyHandler = this.handleKeyDown.bind(this);

    // --------------------------------------------------------
    // INPUT
    // --------------------------------------------------------

    canvas.addEventListener("pointerdown", this.pointerHandler);
    canvas.addEventListener("pointermove", this.pointerMoveHandler);
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

    const rawDelta = Math.min(
      (timestamp - this.lastTime) / 1000,

      0.1,
    );

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

    const actualFrameMs = performance.now() - frameStart;

    // --------------------------------------------------------
    // STORE PERFORMANCE DATA
    // --------------------------------------------------------

    this.state.performance.frameMs = actualFrameMs;

    this.state.performance.updateMs = updateFrameMs;

    this.state.performance.renderMs = renderFrameMs;

    this.state.performance.updateSteps = updateSteps;

    // --------------------------------------------------------
    // ROLLING FPS
    // --------------------------------------------------------

    this.updateRollingFps(actualFrameMs);

    // --------------------------------------------------------
    // BENCHMARK
    // --------------------------------------------------------

    if (this.benchmark.active) {
      this.updateBenchmark(rawDelta, actualFrameMs);
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

    const levelIndex = tower.level - 1;

    return {
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
  }

  // ==========================================================
  // ACQUIRE TOWER TARGET
  // ==========================================================

  acquireTarget(tower) {
    const stats = this.getTowerStats(tower);

    const candidates = this.grid.queryCircle(
      tower.x,

      tower.y,

      stats.range,

      this.targetQuery,
    );

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

      this.fireProjectile(
        tower,

        target,

        stats,
      );

      tower.cooldown = stats.fireRate;

      tower.targetId = target.id;
    }
  }

  // ==========================================================
  // FIRE PROJECTILE
  // ==========================================================

  fireProjectile(tower, target, stats) {
    const projectile = this.projectilePool.acquire();

    const direction = normalize(
      target.x - tower.x,

      target.y - tower.y,
    );

    projectile.x = tower.x;

    projectile.y = tower.y;

    projectile.vx = direction.x * stats.projectileSpeed;

    projectile.vy = direction.y * stats.projectileSpeed;

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

      const target = this.findEnemyById(projectile.targetId);

      // ------------------------------------------------------
      // TARGET GONE / EXPIRED
      // ------------------------------------------------------

      if (!target || projectile.lifetime <= 0) {
        this.projectilePool.release(projectile);

        this.projectiles.splice(i, 1);

        continue;
      }

      // ------------------------------------------------------
      // MOVE TOWARD TARGET
      // ------------------------------------------------------

      const dx = target.x - projectile.x;

      const dy = target.y - projectile.y;

      const distance = Math.hypot(dx, dy);

      const step = projectile.speed * dt;

      // ------------------------------------------------------
      // HIT
      // ------------------------------------------------------

      if (distance <= step + target.radius + projectile.radius) {
        projectile.x = target.x;

        projectile.y = target.y;

        this.applyProjectileHit(
          projectile,

          target,
        );

        this.projectilePool.release(projectile);

        this.projectiles.splice(i, 1);
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

      // In stress mode, we'll keep replenishing the enemy
      // population later.
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

    // Repaint immediately so the placement preview follows the cursor.
    if (this.selectedBuildType) {
      this.render();
    }
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
  // START STRESS TEST
  // ==========================================================

  runStressTest() {
    // Start from an empty world.
    this.clearEntities();

    // --------------------------------------------------------
    // RESET BENCHMARK
    // --------------------------------------------------------

    this.benchmark = {
      active: true,

      phase: "warmup",

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

    this.frameSamples = [];

    // --------------------------------------------------------
    // STRESS STATE
    // --------------------------------------------------------

    this.state.stressMode = true;

    this.state.runningWave = false;

    this.state.waveReady = false;

    this.state.wave = 50;

    this.state.money = 99999;

    this.state.health = 100;

    this.state.score = 0;

    this.state.benchmark = {
      active: true,

      phase: "warmup",

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
    };

    this.selectedBuildType = null;

    this.selectedTowerId = 0;

    // --------------------------------------------------------
    // CREATE 100 TOWERS
    // --------------------------------------------------------

    const towerTypes = ["blaster", "cannon", "sniper"];

    let towerCount = 0;

    for (let y = 45; y < 540 && towerCount < 100; y += 62) {
      for (let x = 45; x < 930 && towerCount < 100; x += 82) {
        if (
          isPointNearPath(
            x,

            y,

            this.path,

            40,
          )
        ) {
          continue;
        }

        const type = towerTypes[towerCount % towerTypes.length];

        const tower = new Tower();

        tower.init(
          this.nextTowerId++,

          type,

          x,

          y,
        );

        tower.level = 3;

        this.towers.push(tower);

        this.towersById.set(
          tower.id,

          tower,
        );

        towerCount += 1;
      }
    }

    // --------------------------------------------------------
    // CREATE 5,000 ENEMIES
    // --------------------------------------------------------

    const enemyTypes = ["basic", "runner", "tank", "armored"];

    for (let i = 0; i < 5000; i += 1) {
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

      this.enemiesById.set(
        enemy.id,

        enemy,
      );
    }

    // --------------------------------------------------------
    // CREATE 1,000 PROJECTILES
    // --------------------------------------------------------

    for (let i = 0; i < 1000; i += 1) {
      const projectile = this.projectilePool.acquire();

      const target = this.enemies[i % this.enemies.length];

      projectile.x = target.x - 20;

      projectile.y = target.y - 20;

      projectile.targetId = target.id;

      projectile.towerId = this.towers[i % this.towers.length].id;

      projectile.type = towerTypes[i % towerTypes.length];

      projectile.speed = 400;

      projectile.damage = 15;

      projectile.radius = 3;

      projectile.splashRadius = 0;

      projectile.lifetime = 4;

      this.projectiles.push(projectile);
    }

    // --------------------------------------------------------
    // COUNTERS
    // --------------------------------------------------------

    this.state.enemiesAlive = this.enemies.length;

    this.state.towerCount = this.towers.length;

    this.state.projectileCount = this.projectiles.length;

    this.emitSnapshot(true);
  }

  // ==========================================================
  // UPDATE BENCHMARK
  // ==========================================================

  updateBenchmark(rawDelta, frameMs) {
    if (!this.benchmark.active) {
      return;
    }

    // --------------------------------------------------------
    // WARMUP
    // --------------------------------------------------------

    if (this.benchmark.phase === "warmup") {
      this.benchmark.warmupElapsed += rawDelta;

      this.state.benchmark.warmupElapsed = this.benchmark.warmupElapsed;

      if (this.benchmark.warmupElapsed >= BENCHMARK_WARMUP_SECONDS) {
        // Start actual measurement.
        this.benchmark.phase = "measuring";

        this.benchmark.measuredElapsed = 0;

        this.benchmark.totalFrames = 0;

        this.benchmark.goodFrames = 0;

        this.benchmark.badFrames = 0;

        this.benchmark.totalFrameTime = 0;

        this.benchmark.worstFrameMs = 0;

        this.frameSamples = [];

        this.state.benchmark.phase = "measuring";

        this.emitSnapshot(true);
      }

      return;
    }

    // --------------------------------------------------------
    // MEASUREMENT
    // --------------------------------------------------------

    if (this.benchmark.phase !== "measuring") {
      return;
    }

    this.benchmark.measuredElapsed += rawDelta;

    this.benchmark.totalFrames += 1;

    this.benchmark.totalFrameTime += frameMs;

    this.benchmark.worstFrameMs = Math.max(
      this.benchmark.worstFrameMs,

      frameMs,
    );

    // Frame qualifies for the 45 FPS requirement.
    if (frameMs <= TARGET_FRAME_MS) {
      this.benchmark.goodFrames += 1;
    }

    // Frame violates the >33ms requirement.
    if (frameMs > BAD_FRAME_MS) {
      this.benchmark.badFrames += 1;
    }

    // Current percentages.
    this.benchmark.averageFrameMs = this.benchmark.totalFrameTime / this.benchmark.totalFrames;

    this.benchmark.pass45FpsPercent =
      (this.benchmark.goodFrames / this.benchmark.totalFrames) * 100;

    this.benchmark.over33msPercent = (this.benchmark.badFrames / this.benchmark.totalFrames) * 100;

    // Copy into React-visible state.
    this.state.benchmark = {
      active: true,

      phase: "measuring",

      warmupElapsed: this.benchmark.warmupElapsed,

      measuredElapsed: this.benchmark.measuredElapsed,

      totalFrames: this.benchmark.totalFrames,

      goodFrames: this.benchmark.goodFrames,

      badFrames: this.benchmark.badFrames,

      averageFrameMs: this.benchmark.averageFrameMs,

      worstFrameMs: this.benchmark.worstFrameMs,

      pass45FpsPercent: this.benchmark.pass45FpsPercent,

      over33msPercent: this.benchmark.over33msPercent,

      complete: false,
    };

    // --------------------------------------------------------
    // FINISH AFTER 30 SECONDS
    // --------------------------------------------------------

    if (this.benchmark.measuredElapsed >= BENCHMARK_DURATION_SECONDS) {
      this.finishBenchmark();
    }
  }

  // ==========================================================
  // FINISH BENCHMARK
  // ==========================================================

  finishBenchmark() {
    this.benchmark.phase = "complete";

    this.benchmark.complete = true;

    this.benchmark.active = false;

    this.state.benchmark = {
      active: false,

      phase: "complete",

      warmupElapsed: this.benchmark.warmupElapsed,

      measuredElapsed: this.benchmark.measuredElapsed,

      totalFrames: this.benchmark.totalFrames,

      goodFrames: this.benchmark.goodFrames,

      badFrames: this.benchmark.badFrames,

      averageFrameMs: this.benchmark.averageFrameMs,

      worstFrameMs: this.benchmark.worstFrameMs,

      pass45FpsPercent: this.benchmark.pass45FpsPercent,

      over33msPercent: this.benchmark.over33msPercent,

      complete: true,
    };

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

    this.renderBackground(ctx);

    this.renderPath(ctx);

    this.renderPlacementPreview(ctx);

    this.renderTowers(ctx);

    this.renderProjectiles(ctx);

    this.renderEnemies(ctx);

    this.renderNotification(ctx);

    this.renderEffects(ctx);
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
