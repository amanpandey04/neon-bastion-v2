export const TOWER_TYPES = {
  blaster: {
    id: "blaster",
    name: "Blaster",
    description: "Balanced rapid-fire tower.",
    cost: 80,
    baseDamage: 10,
    baseRange: 115,
    baseFireRate: 0.55,
    projectileSpeed: 420,
    projectileRadius: 3,
    color: "#65d7ff",
    upgradeCosts: [60, 95],
  },

  cannon: {
    id: "cannon",
    name: "Cannon",
    description: "Slow shells with splash damage.",
    cost: 140,
    baseDamage: 42,
    baseRange: 105,
    baseFireRate: 1.45,
    projectileSpeed: 300,
    projectileRadius: 6,
    splashRadius: 42,
    color: "#ffb45b",
    upgradeCosts: [100, 160],
  },

  sniper: {
    id: "sniper",
    name: "Sniper",
    description: "Long range, high single-target damage.",
    cost: 190,
    baseDamage: 90,
    baseRange: 260,
    baseFireRate: 2.4,
    projectileSpeed: 620,
    projectileRadius: 2,
    color: "#ca9cff",
    upgradeCosts: [135, 220],
  },
};

export const ENEMY_TYPES = {
  basic: {
    id: "basic",
    name: "Drone",
    hp: 55,
    speed: 46,
    radius: 9,
    reward: 8,
    baseDamage: 1,
    damageTakenMultiplier: 1,
    color: "#e8edf7",
  },

  runner: {
    id: "runner",
    name: "Runner",
    hp: 35,
    speed: 86,
    radius: 7,
    reward: 11,
    baseDamage: 1,
    damageTakenMultiplier: 1,
    color: "#72f0a4",
  },

  tank: {
    id: "tank",
    name: "Tank",
    hp: 260,
    speed: 28,
    radius: 14,
    reward: 28,
    baseDamage: 4,
    damageTakenMultiplier: 1,
    color: "#ff7f7f",
  },

  armored: {
    id: "armored",
    name: "Armored",
    hp: 120,
    speed: 38,
    radius: 11,
    reward: 18,
    baseDamage: 2,
    damageTakenMultiplier: 0.62,
    color: "#ffd45f",
  },
};

export const PATH = [
  { x: 22, y: 80 },
  { x: 170, y: 80 },
  { x: 170, y: 210 },
  { x: 420, y: 210 },
  { x: 420, y: 110 },
  { x: 700, y: 110 },
  { x: 700, y: 330 },
  { x: 520, y: 330 },
  { x: 520, y: 470 },
  { x: 910, y: 470 },
];

export const MAP = {
  width: 960,
  height: 560,
  baseRadius: 30,
};

export function getWaveConfig(wave) {
  const total = Math.floor(8 + wave * 3.7 + wave ** 1.14 * 1.8);

  const healthScale = 1 + (wave - 1) * 0.065;
  const speedScale = 1 + (wave - 1) * 0.012;

  const groups = [];

  const add = (type, count, spawnInterval) => {
    groups.push({
      type,
      count,
      spawnInterval,
    });
  };

  if (wave < 6) {
    add("basic", total, Math.max(0.16, 0.42 - wave * 0.025));
  } else if (wave < 11) {
    add("basic", Math.floor(total * 0.68), 0.25);
    add("runner", Math.floor(total * 0.32), 0.21);
  } else if (wave < 21) {
    add("basic", Math.floor(total * 0.42), 0.22);
    add("runner", Math.floor(total * 0.28), 0.18);
    add("tank", Math.floor(total * 0.17), 0.58);
    add("armored", Math.floor(total * 0.13), 0.38);
  } else {
    add("basic", Math.floor(total * 0.27), 0.18);
    add("runner", Math.floor(total * 0.26), 0.16);
    add("tank", Math.floor(total * 0.22), 0.34);
    add("armored", Math.floor(total * 0.25), 0.25);
  }

  if (wave % 10 === 0) {
    add("tank", Math.max(4, Math.floor(wave / 2)), 0.9);
  }

  return {
    wave,
    groups,
    healthScale,
    speedScale,
  };
}
