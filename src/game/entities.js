import { ENEMY_TYPES, TOWER_TYPES } from "./data";

export class Enemy {
  constructor() {
    this.active = false;

    this.id = 0;
    this.type = "basic";

    this.x = 0;
    this.y = 0;

    this.hp = 0;
    this.maxHp = 0;

    this.speed = 0;
    this.radius = 8;

    this.pathIndex = 0;
    this.reward = 0;
    this.baseDamage = 1;

    this.damageTakenMultiplier = 1;

    this.progress = 0;
    this.hitFlash = 0;
  }

  reset() {
    this.active = false;
    this.hitFlash = 0;
  }

  init(id, type, healthScale, speedScale, pathStart) {
    const data = ENEMY_TYPES[type];

    this.active = true;

    this.id = id;
    this.type = type;

    this.x = pathStart.x;
    this.y = pathStart.y;

    this.hp = data.hp * healthScale;
    this.maxHp = this.hp;

    this.speed = data.speed * speedScale;

    this.radius = data.radius;
    this.reward = Math.round(data.reward * (1 + (healthScale - 1) * 0.35));

    this.baseDamage = data.baseDamage;

    this.damageTakenMultiplier = data.damageTakenMultiplier;

    this.pathIndex = 0;
    this.progress = 0;
    this.hitFlash = 0;
  }
}

export class Tower {
  constructor() {
    this.id = 0;
    this.type = "blaster";

    this.x = 0;
    this.y = 0;

    this.level = 1;
    this.cooldown = 0;

    this.kills = 0;
    this.totalSpent = 0;

    this.targetId = 0;
  }

  init(id, type, x, y) {
    this.id = id;
    this.type = type;

    this.x = x;
    this.y = y;

    this.level = 1;
    this.cooldown = 0;

    this.kills = 0;

    this.totalSpent = TOWER_TYPES[type].cost;

    this.targetId = 0;
  }
}

export class Projectile {
  constructor() {
    this.active = false;

    this.x = 0;
    this.y = 0;

    this.vx = 0;
    this.vy = 0;

    this.speed = 0;
    this.damage = 0;
    this.radius = 3;

    this.targetId = 0;
    this.towerId = 0;

    this.splashRadius = 0;

    this.type = "blaster";
    this.lifetime = 0;
  }

  reset() {
    this.active = false;
    this.targetId = 0;
    this.lifetime = 0;
  }
}
