import {
  DOOR_LEFT,
  DOOR_RIGHT,
  PLATFORM_BOTTOM,
  PLAYER_RADIUS,
  PLAYER_START,
  SAFE_ZONE_Y,
  TRAIN_FLOOR,
  VIEW_WIDTH,
} from "./constants";
import { Input } from "./input";
import { STAGES } from "./stageData";
import {
  FailureReason,
  GamePhase,
  type Burst,
  type FloatingText,
  type GameSnapshot,
  type ImpactMark,
  type Npc,
  type NpcBody,
  type NpcKind,
  type Player,
  type Vec2,
} from "./types";

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const length = (vector: Vec2): number => Math.hypot(vector.x, vector.y);
const normalize = (vector: Vec2): Vec2 => {
  const magnitude = length(vector);
  return magnitude > 0.001 ? { x: vector.x / magnitude, y: vector.y / magnitude } : { x: 0, y: -1 };
};

const BODY_STATS: Record<NpcBody, { radius: number; resistance: number; height: number; width: number }> = {
  slim: { radius: 21, resistance: 0.85, height: 0.96, width: 0.78 },
  normal: { radius: 25, resistance: 1.35, height: 1, width: 1 },
  tall: { radius: 25, resistance: 1.35, height: 1.2, width: 0.96 },
  large: { radius: 30, resistance: 2.3, height: 1.06, width: 1.2 },
  backpack: { radius: 33, resistance: 3.75, height: 1.04, width: 1.14 },
};

const SKIN_TONES = ["#f2c8a8", "#dca27e", "#b97855", "#8f563f"];

export class Game {
  readonly player: Player = {
    id: 0,
    position: { ...PLAYER_START },
    velocity: { x: 0, y: 0 },
    radius: PLAYER_RADIUS,
    squash: 0,
    lastDirection: { x: 0, y: -1 },
    pushCooldown: 0,
    pushFlash: 0,
    caffeineTime: 0,
  };

  stageIndex = 0;
  phase = GamePhase.Ready;
  failureReason?: FailureReason;
  timeRemaining = STAGES[0].timeLimit;
  stageElapsed = 0;
  readyTime = 0.75;
  resultTime = 0;
  tutorialTime = 1.8;
  doorProgress = 1;
  shake = 0;
  flash = 0;
  hitStop = 0;
  lives = 3;
  lastAttemptResult = "";
  coffee?: Vec2;
  coffeeTaken = false;
  npcs: Npc[] = [];
  bursts: Burst[] = [];
  impacts: ImpactMark[] = [];
  texts: FloatingText[] = [];
  private nextId = 1;
  private lastStrongEjection = -99;
  private movementTutorialSeen = false;
  private pushTutorialSeen = false;

  constructor(readonly input: Input) {
    this.loadStage(0);
  }

  update(dt: number): void {
    const safeDt = Math.min(dt, 1 / 30);
    if (this.input.consume("KeyR")) {
      if (this.phase === GamePhase.GameOver) this.startNewGame();
      else this.loadStage(this.stageIndex);
    }

    if (this.phase === GamePhase.Cleared || this.phase === GamePhase.Failed || this.phase === GamePhase.GameOver) {
      this.resultTime += safeDt;
      if (this.phase === GamePhase.Cleared && this.input.consume("Space") && this.resultTime > 0.25) {
        if (this.stageIndex === STAGES.length - 1) this.startNewGame();
        else this.loadStage(this.stageIndex + 1);
      } else if (this.phase === GamePhase.Failed && this.lives > 0 && this.resultTime >= 0.46) {
        this.loadStage(this.stageIndex);
      }
      this.updateEffects(safeDt);
      this.input.endFrame();
      return;
    }

    if (this.phase === GamePhase.Ready) {
      this.readyTime -= safeDt;
      this.doorProgress = clamp(this.readyTime / 0.55, 0, 1);
      if (this.readyTime <= 0) {
        this.phase = GamePhase.Playing;
        this.doorProgress = 0;
      }
    } else {
      if (this.hitStop > 0) {
        this.hitStop = Math.max(0, this.hitStop - safeDt);
        this.input.endFrame();
        return;
      }
      this.timeRemaining = Math.max(0, this.timeRemaining - safeDt);
      this.stageElapsed += safeDt;
      this.tutorialTime = Math.max(0, this.tutorialTime - safeDt);
      this.doorProgress = this.timeRemaining < 0.68 ? 1 - this.timeRemaining / 0.68 : 0;
      this.updatePlayer(safeDt);
      this.updateNpcs(safeDt);
      this.resolveNpcPairs();
      this.resolvePlayerCollisions();
      this.checkCoffee();
      if (this.timeRemaining <= 0) this.judgeResult();
    }

    this.updateEffects(safeDt);
    this.input.endFrame();
  }

  loadStage(index: number): void {
    this.stageIndex = clamp(index, 0, STAGES.length - 1);
    const stage = STAGES[this.stageIndex];
    this.phase = GamePhase.Ready;
    this.failureReason = undefined;
    this.timeRemaining = stage.timeLimit;
    this.stageElapsed = 0;
    this.readyTime = 0.75;
    this.resultTime = 0;
    if (this.stageIndex === 0 && !this.movementTutorialSeen) {
      this.tutorialTime = 1.8;
      this.movementTutorialSeen = true;
    } else if (this.stageIndex === 2 && !this.pushTutorialSeen) {
      this.tutorialTime = 2;
      this.pushTutorialSeen = true;
    } else this.tutorialTime = 0;
    this.doorProgress = 1;
    this.shake = 0;
    this.flash = 0;
    this.hitStop = 0;
    this.lastStrongEjection = -99;
    this.coffee = stage.coffee ? { ...stage.coffee } : undefined;
    this.coffeeTaken = false;
    Object.assign(this.player, {
      position: { ...PLAYER_START },
      velocity: { x: 0, y: 0 },
      squash: 0,
      lastDirection: { x: 0, y: -1 },
      pushCooldown: 0,
      pushFlash: 0,
      caffeineTime: 0,
    });
    this.npcs = stage.spawns.map((spawn, spawnIndex) => {
      const body = spawn.body ?? (spawn.kind === "backpack" ? "backpack" : "normal");
      const stats = BODY_STATS[body];
      const jitter = stage.randomize ? this.seededJitter(this.stageIndex * 31 + spawnIndex * 17) : 0;
      return {
        id: this.nextId++,
        kind: spawn.kind,
        body,
        position: { x: spawn.x + jitter, y: spawn.y + jitter * 0.25 },
        velocity: { x: 0, y: 0 },
        radius: stats.radius,
        resistance: stats.resistance * (spawn.kind === "alighter" ? 1.18 : spawn.kind === "rival" ? 1.05 : 1),
        targetX: (spawn.targetX ?? spawn.x) - jitter * 0.35,
        squash: 0,
        active: true,
        tint: (spawnIndex * 47 + this.stageIndex * 23) % 360,
        pantsTint: (spawnIndex * 71 + 205) % 360,
        skinTone: SKIN_TONES[spawnIndex % SKIN_TONES.length],
        heightScale: stats.height * (0.96 + (spawnIndex % 3) * 0.035),
        widthScale: stats.width,
        headScale: 0.9 + (spawnIndex % 4) * 0.06,
        impactCooldown: 0,
      };
    });
    this.bursts = [];
    this.impacts = [];
    this.texts = [];
  }

  startNewGame(): void {
    this.lives = 3;
    this.lastAttemptResult = "";
    this.movementTutorialSeen = false;
    this.pushTutorialSeen = false;
    this.loadStage(0);
  }

  getSnapshot(): GameSnapshot {
    const npcCounts: Record<NpcKind, number> = { normal: 0, backpack: 0, alighter: 0, rival: 0 };
    const bodyCounts: Record<NpcBody, number> = { slim: 0, normal: 0, tall: 0, large: 0, backpack: 0 };
    this.npcs.filter((npc) => npc.active).forEach((npc) => npcCounts[npc.kind]++);
    this.npcs.filter((npc) => npc.active).forEach((npc) => bodyCounts[npc.body]++);
    return {
      stage: this.stageIndex + 1,
      stageName: STAGES[this.stageIndex].name,
      phase: this.phase,
      failureReason: this.failureReason,
      timeRemaining: Number(this.timeRemaining.toFixed(2)),
      player: { x: Math.round(this.player.position.x), y: Math.round(this.player.position.y) },
      caffeineTime: Number(this.player.caffeineTime.toFixed(2)),
      lives: this.lives,
      doorProgress: Number(this.doorProgress.toFixed(2)),
      hitStop: Number(this.hitStop.toFixed(3)),
      npcCounts,
      bodyCounts,
      lastAttemptResult: this.lastAttemptResult,
    };
  }

  private updatePlayer(dt: number): void {
    this.player.pushCooldown = Math.max(0, this.player.pushCooldown - dt);
    this.player.pushFlash = Math.max(0, this.player.pushFlash - dt);
    this.player.caffeineTime = Math.max(0, this.player.caffeineTime - dt);
    const raw = { x: this.input.horizontal, y: this.input.vertical };
    const moving = length(raw) > 0;
    const direction = moving ? normalize(raw) : { x: 0, y: 0 };
    if (moving) this.player.lastDirection = direction;
    const speed = this.player.caffeineTime > 0 ? 240 : 185;
    const response = 1 - Math.exp(-dt * 20);
    this.player.velocity.x += (direction.x * speed - this.player.velocity.x) * response;
    this.player.velocity.y += (direction.y * speed - this.player.velocity.y) * response;

    if (this.input.consume("Space") && this.player.pushCooldown <= 0) this.performPush();
    this.movePlayer(this.player.velocity.x * dt, this.player.velocity.y * dt);
  }

  private movePlayer(dx: number, dy: number): void {
    const previousY = this.player.position.y;
    this.player.position.x = clamp(this.player.position.x + dx, 38, VIEW_WIDTH - 38);
    this.player.position.y = clamp(this.player.position.y + dy, 142, PLATFORM_BOTTOM - this.player.radius);
    const crossingFloor = previousY - this.player.radius >= TRAIN_FLOOR && this.player.position.y - this.player.radius < TRAIN_FLOOR;
    if (crossingFloor && !this.insideDoorOpening(this.player.position.x, this.player.radius)) {
      this.player.position.y = TRAIN_FLOOR + this.player.radius;
      this.player.velocity.y = Math.max(0, this.player.velocity.y);
    }
  }

  private performPush(): void {
    const player = this.player;
    const pushDirection = normalize(length(player.lastDirection) > 0 ? player.lastDirection : { x: 0, y: -1 });
    const forwardBias = pushDirection.y > -0.15 ? pushDirection : normalize({ x: pushDirection.x * 0.85, y: pushDirection.y });
    const targets = this.npcs.filter((npc) => {
      if (!npc.active) return false;
      const delta = { x: npc.position.x - player.position.x, y: npc.position.y - player.position.y };
      const distance = length(delta);
      return distance < player.radius + npc.radius + 28 && (delta.x * forwardBias.x + delta.y * forwardBias.y) / Math.max(distance, 1) > 0.42;
    });
    const power = player.caffeineTime > 0 ? 9.4 : 4.7;
    const pressure = targets.reduce((sum, npc) => sum + npc.resistance + this.neighborPressure(npc), 0);
    const succeeds = targets.length === 0 || power >= pressure * 0.45;
    player.pushCooldown = player.caffeineTime > 0 ? 0.29 : 0.43;
    player.pushFlash = 0.16;
    player.squash = succeeds ? 0.18 : -0.22;
    this.flash = targets.length > 0 ? 0.055 : 0;

    if (succeeds) {
      const dash = player.caffeineTime > 0 ? 70 : targets.length > 0 ? 52 : 34;
      this.movePlayer(forwardBias.x * dash, forwardBias.y * dash);
      for (const npc of targets) {
        const impulse = player.caffeineTime > 0 ? 290 : 175;
        npc.velocity.x += forwardBias.x * impulse / npc.resistance;
        npc.velocity.y += forwardBias.y * impulse / npc.resistance;
        npc.squash = 0.2;
      }
      this.spawnImpact({
        x: player.position.x + forwardBias.x * 34,
        y: player.position.y + forwardBias.y * 34,
      }, player.caffeineTime > 0 ? "#ffe14f" : "#ffffff", player.caffeineTime > 0 ? 12 : 8, targets.length > 0);
      if (targets.length > 0) {
        this.texts.push({
          text: player.caffeineTime > 0 && targets.length >= 2 ? "쾅!" : "팡!",
          position: { x: player.position.x + forwardBias.x * 48, y: player.position.y + forwardBias.y * 48 },
          life: 0.42,
          color: player.caffeineTime > 0 ? "#ffe14f" : "#ffffff",
        });
        this.hitStop = player.caffeineTime > 0 ? 0.065 : 0.05;
      }
      this.shake = targets.length > 0 ? (player.caffeineTime > 0 ? 0.12 : 0.07) : 0;
    } else {
      const recoil = player.caffeineTime > 0 ? 34 : 92;
      player.velocity.x = -forwardBias.x * recoil * 4;
      player.velocity.y = Math.max(80, -forwardBias.y * recoil * 4);
      this.movePlayer(-forwardBias.x * recoil, -forwardBias.y * recoil);
      this.lastStrongEjection = this.timeRemaining;
      this.texts.push({ text: "쾅!", position: { x: player.position.x, y: player.position.y - 18 }, life: 0.48, color: "#ffde59" });
      this.spawnImpact({ x: player.position.x, y: player.position.y - 22 }, "#ef5b5b", 11, true);
      this.hitStop = 0.065;
      this.shake = 0.12;
    }
  }

  private updateNpcs(dt: number): void {
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      npc.impactCooldown = Math.max(0, npc.impactCooldown - dt);
      npc.squash += (0 - npc.squash) * Math.min(1, dt * 10);
      if (npc.kind === "alighter") {
        if (this.stageElapsed < 0.45) continue;
        const desiredX = npc.position.y < TRAIN_FLOOR - 6 ? 480 + (npc.targetX - 480) * 0.3 : npc.targetX;
        npc.velocity.x += (desiredX - npc.position.x) * dt * 4.5;
        npc.velocity.y += (154 - npc.velocity.y) * Math.min(1, dt * 5.2);
      } else if (npc.kind === "rival") {
        const inside = npc.position.y + npc.radius < TRAIN_FLOOR;
        if (!inside) {
          npc.velocity.x += (npc.targetX - npc.position.x) * dt * 3.4;
          const aligned = Math.abs(npc.targetX - npc.position.x) < 58;
          npc.velocity.y += ((aligned ? -125 : -42) - npc.velocity.y) * Math.min(1, dt * 4);
        } else {
          npc.velocity.y += (-18 - npc.velocity.y) * Math.min(1, dt * 2);
        }
      }

      npc.position.x += npc.velocity.x * dt;
      npc.position.y += npc.velocity.y * dt;
      const damping = Math.pow(npc.kind === "alighter" || npc.kind === "rival" ? 0.92 : 0.18, dt);
      npc.velocity.x *= damping;
      npc.velocity.y *= damping;
      npc.position.x = clamp(npc.position.x, 30, VIEW_WIDTH - 30);

      if (npc.kind !== "alighter" && npc.position.y + npc.radius > TRAIN_FLOOR && !this.insideDoorOpening(npc.position.x, npc.radius)) {
        npc.position.y = TRAIN_FLOOR - npc.radius;
        npc.velocity.y = Math.min(0, npc.velocity.y);
      }
      if (npc.kind === "alighter" && npc.position.y > PLATFORM_BOTTOM + 40) npc.active = false;
      if (npc.kind === "rival") npc.position.y = clamp(npc.position.y, 152, PLATFORM_BOTTOM - npc.radius);
      else if (npc.kind !== "alighter") npc.position.y = clamp(npc.position.y, 145, TRAIN_FLOOR - npc.radius);
    }
  }

  private resolvePlayerCollisions(): void {
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      const delta = { x: this.player.position.x - npc.position.x, y: this.player.position.y - npc.position.y };
      const distance = length(delta);
      const overlap = this.player.radius + npc.radius - distance;
      if (overlap <= 0) continue;
      const normal = distance > 0.01 ? { x: delta.x / distance, y: delta.y / distance } : { x: 0, y: 1 };
      const force = npc.kind === "alighter" ? 1.15 : npc.kind === "rival" ? 0.76 : 0.62;
      this.movePlayer(normal.x * overlap * force, normal.y * overlap * force);
      npc.position.x -= normal.x * overlap * (1 - force) / npc.resistance;
      npc.position.y -= normal.y * overlap * (1 - force) / npc.resistance;

      if (npc.kind === "alighter" && npc.velocity.y > 55) {
        this.player.velocity.x += normal.x * 135;
        this.player.velocity.y += Math.max(170, npc.velocity.y * 1.75);
        this.movePlayer(normal.x * 16, 22);
        this.lastStrongEjection = this.timeRemaining;
        if (npc.impactCooldown <= 0) {
          const hitPoint = { x: (npc.position.x + this.player.position.x) * 0.5, y: (npc.position.y + this.player.position.y) * 0.5 };
          this.texts.push({ text: "팡!", position: hitPoint, life: 0.36, color: "#ffffff" });
          this.spawnImpact(hitPoint, "#ef7b68", 7, true);
          npc.impactCooldown = 0.35;
          this.hitStop = Math.max(this.hitStop, 0.045);
        }
        this.shake = Math.max(this.shake, 0.08);
      } else if (npc.kind === "rival") {
        this.player.velocity.x += normal.x * 48;
      }
    }
  }

  private resolveNpcPairs(): void {
    for (let i = 0; i < this.npcs.length; i++) {
      const a = this.npcs[i];
      if (!a.active) continue;
      for (let j = i + 1; j < this.npcs.length; j++) {
        const b = this.npcs[j];
        if (!b.active) continue;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distance = Math.hypot(dx, dy);
        const desired = (a.radius + b.radius) * 0.82;
        if (distance >= desired || distance < 0.01) continue;
        const overlap = (desired - distance) * 0.32;
        const nx = dx / distance;
        const ny = dy / distance;
        const totalResistance = a.resistance + b.resistance;
        a.position.x -= nx * overlap * b.resistance / totalResistance;
        a.position.y -= ny * overlap * b.resistance / totalResistance;
        b.position.x += nx * overlap * a.resistance / totalResistance;
        b.position.y += ny * overlap * a.resistance / totalResistance;
      }
    }
  }

  private checkCoffee(): void {
    if (!this.coffee || this.coffeeTaken) return;
    if (Math.hypot(this.player.position.x - this.coffee.x, this.player.position.y - this.coffee.y) < 42) {
      this.coffeeTaken = true;
      this.player.caffeineTime = 4.8;
      this.texts.push({ text: "CAFFEINE RUSH!", position: { ...this.player.position }, life: 1.2, color: "#ffe14f" });
      for (let i = 0; i < 18; i++) this.spawnSpark(this.player.position, "#ffe14f");
      this.shake = 0.2;
    }
  }

  private judgeResult(): void {
    this.doorProgress = 1;
    const top = this.player.position.y - this.player.radius;
    if (this.player.position.y <= SAFE_ZONE_Y) {
      this.phase = GamePhase.Cleared;
      this.lastAttemptResult = "Cleared";
      this.texts.push({ text: "탑승 성공!", position: { ...this.player.position }, life: 1.4, color: "#55d6a7" });
    } else {
      const insideThreshold = top < TRAIN_FLOOR + 5;
      const recentlyEjected = this.lastStrongEjection <= 2.2 && this.lastStrongEjection >= 0;
      this.failureReason = insideThreshold ? FailureReason.Stuck : recentlyEjected ? FailureReason.PushedOut : FailureReason.Timeout;
      this.lastAttemptResult = this.failureReason;
      this.lives = Math.max(0, this.lives - 1);
      this.phase = this.lives > 0 ? GamePhase.Failed : GamePhase.GameOver;
    }
    this.resultTime = 0;
    this.shake = 0.34;
  }

  private neighborPressure(target: Npc): number {
    return this.npcs.reduce((pressure, other) => {
      if (other === target || !other.active) return pressure;
      const distance = Math.hypot(other.position.x - target.position.x, other.position.y - target.position.y);
      return distance < target.radius + other.radius + 10 ? pressure + 0.72 : pressure;
    }, 0);
  }

  private insideDoorOpening(x: number, radius: number): boolean {
    const inset = this.doorProgress * (DOOR_RIGHT - DOOR_LEFT) * 0.48;
    return x - radius > DOOR_LEFT + inset && x + radius < DOOR_RIGHT - inset;
  }

  private updateEffects(dt: number): void {
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.player.squash += (0 - this.player.squash) * Math.min(1, dt * 12);
    for (const burst of this.bursts) {
      burst.position.x += burst.velocity.x * dt;
      burst.position.y += burst.velocity.y * dt;
      burst.velocity.x *= 0.9;
      burst.velocity.y *= 0.9;
      burst.life -= dt;
    }
    this.bursts = this.bursts.filter((burst) => burst.life > 0);
    for (const impact of this.impacts) impact.life -= dt;
    this.impacts = this.impacts.filter((impact) => impact.life > 0);
    for (const floatingText of this.texts) {
      floatingText.position.y -= 28 * dt;
      floatingText.life -= dt;
    }
    this.texts = this.texts.filter((floatingText) => floatingText.life > 0);
    if (this.player.caffeineTime > 0 && Math.random() < dt * 16) this.spawnSpark(this.player.position, "#ffe14f");
  }

  private spawnImpact(position: Vec2, color: string, count: number, strong = false): void {
    this.impacts.push({ position: { ...position }, life: strong ? 0.34 : 0.24, color, strong });
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.25;
      const speed = 65 + Math.random() * 95;
      this.bursts.push({
        position: { ...position },
        velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        life: 0.22 + Math.random() * 0.2,
        color,
        size: 2 + Math.random() * 4,
      });
    }
  }

  private spawnSpark(position: Vec2, color: string): void {
    const angle = Math.random() * Math.PI * 2;
    this.bursts.push({
      position: { x: position.x + Math.cos(angle) * 25, y: position.y + Math.sin(angle) * 28 },
      velocity: { x: Math.cos(angle) * 32, y: -30 - Math.random() * 30 },
      life: 0.25 + Math.random() * 0.25,
      color,
      size: 2 + Math.random() * 3,
    });
  }

  private seededJitter(seed: number): number {
    const value = Math.sin(seed * 91.117) * 43758.5453;
    return (value - Math.floor(value) - 0.5) * 20;
  }
}
