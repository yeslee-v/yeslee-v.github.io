import {
  DOOR_LEFT,
  DOOR_RIGHT,
  PLATFORM_BOTTOM,
  PLAYER_RADIUS,
  PLAYER_START,
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
  type Npc,
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

const KIND_STATS: Record<NpcKind, { radius: number; resistance: number }> = {
  normal: { radius: 19, resistance: 1.35 },
  backpack: { radius: 27, resistance: 3.25 },
  alighter: { radius: 20, resistance: 2.15 },
  rival: { radius: 19, resistance: 1.55 },
};

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
  readyTime = 0.45;
  resultTime = 0;
  tutorialTime = 2.2;
  doorProgress = 0;
  shake = 0;
  flash = 0;
  coffee?: Vec2;
  coffeeTaken = false;
  npcs: Npc[] = [];
  bursts: Burst[] = [];
  texts: FloatingText[] = [];
  private nextId = 1;
  private lastStrongEjection = -99;

  constructor(readonly input: Input) {
    this.loadStage(0);
  }

  update(dt: number): void {
    const safeDt = Math.min(dt, 1 / 30);
    if (this.input.consume("KeyR")) this.loadStage(this.stageIndex);

    if (this.phase === GamePhase.Cleared || this.phase === GamePhase.Failed) {
      this.resultTime += safeDt;
      if (this.phase === GamePhase.Cleared && this.input.consume("Space") && this.resultTime > 0.25) {
        this.loadStage((this.stageIndex + 1) % STAGES.length);
      }
      this.updateEffects(safeDt);
      this.input.endFrame();
      return;
    }

    if (this.phase === GamePhase.Ready) {
      this.readyTime -= safeDt;
      if (this.readyTime <= 0) this.phase = GamePhase.Playing;
    } else {
      this.timeRemaining = Math.max(0, this.timeRemaining - safeDt);
      this.tutorialTime = Math.max(0, this.tutorialTime - safeDt);
      this.doorProgress = this.timeRemaining < 0.8 ? 1 - this.timeRemaining / 0.8 : 0;
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
    this.readyTime = 0.45;
    this.resultTime = 0;
    this.tutorialTime = this.stageIndex === 0 || this.stageIndex === 2 ? 2.2 : 0;
    this.doorProgress = 0;
    this.shake = 0;
    this.flash = 0;
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
      const stats = KIND_STATS[spawn.kind];
      const jitter = stage.randomize ? this.seededJitter(this.stageIndex * 31 + spawnIndex * 17) : 0;
      return {
        id: this.nextId++,
        kind: spawn.kind,
        position: { x: spawn.x + jitter, y: spawn.y + jitter * 0.25 },
        velocity: { x: 0, y: 0 },
        radius: stats.radius,
        resistance: stats.resistance,
        targetX: (spawn.targetX ?? spawn.x) - jitter * 0.35,
        squash: 0,
        active: true,
        tint: (spawnIndex * 47 + this.stageIndex * 23) % 360,
      };
    });
    this.bursts = [];
    this.texts = [];
  }

  getSnapshot(): GameSnapshot {
    const npcCounts: Record<NpcKind, number> = { normal: 0, backpack: 0, alighter: 0, rival: 0 };
    this.npcs.filter((npc) => npc.active).forEach((npc) => npcCounts[npc.kind]++);
    return {
      stage: this.stageIndex + 1,
      stageName: STAGES[this.stageIndex].name,
      phase: this.phase,
      failureReason: this.failureReason,
      timeRemaining: Number(this.timeRemaining.toFixed(2)),
      player: { x: Math.round(this.player.position.x), y: Math.round(this.player.position.y) },
      caffeineTime: Number(this.player.caffeineTime.toFixed(2)),
      npcCounts,
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
    const speed = this.player.caffeineTime > 0 ? 225 : 172;
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
      return distance < player.radius + npc.radius + 54 && (delta.x * forwardBias.x + delta.y * forwardBias.y) / Math.max(distance, 1) > 0.38;
    });
    const power = player.caffeineTime > 0 ? 8.2 : 3.35;
    const pressure = targets.reduce((sum, npc) => sum + npc.resistance + this.neighborPressure(npc), 0);
    const succeeds = targets.length === 0 || power >= pressure * 0.72;
    player.pushCooldown = player.caffeineTime > 0 ? 0.29 : 0.43;
    player.pushFlash = 0.16;
    player.squash = succeeds ? 0.18 : -0.22;
    this.flash = 0.08;

    if (succeeds) {
      const dash = player.caffeineTime > 0 ? 62 : 42;
      this.movePlayer(forwardBias.x * dash, forwardBias.y * dash);
      for (const npc of targets) {
        const impulse = player.caffeineTime > 0 ? 245 : 155;
        npc.velocity.x += forwardBias.x * impulse / npc.resistance;
        npc.velocity.y += forwardBias.y * impulse / npc.resistance;
        npc.squash = 0.2;
      }
      this.spawnImpact({
        x: player.position.x + forwardBias.x * 34,
        y: player.position.y + forwardBias.y * 34,
      }, player.caffeineTime > 0 ? "#ffe14f" : "#ffffff", player.caffeineTime > 0 ? 11 : 7);
      this.shake = player.caffeineTime > 0 ? 0.2 : 0.12;
    } else {
      const recoil = player.caffeineTime > 0 ? 28 : 76;
      player.velocity.x = -forwardBias.x * recoil * 4;
      player.velocity.y = Math.max(80, -forwardBias.y * recoil * 4);
      this.movePlayer(-forwardBias.x * recoil, -forwardBias.y * recoil);
      this.lastStrongEjection = this.timeRemaining;
      this.texts.push({ text: "꿈쩍도 안 한다!", position: { ...player.position }, life: 0.7, color: "#ffde59" });
      this.spawnImpact({ x: player.position.x, y: player.position.y - 18 }, "#ef5b5b", 9);
      this.shake = 0.3;
    }
  }

  private updateNpcs(dt: number): void {
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      npc.squash += (0 - npc.squash) * Math.min(1, dt * 10);
      if (npc.kind === "alighter") {
        const desiredX = npc.position.y < TRAIN_FLOOR - 6 ? 480 + (npc.targetX - 480) * 0.3 : npc.targetX;
        npc.velocity.x += (desiredX - npc.position.x) * dt * 4.5;
        npc.velocity.y += (112 - npc.velocity.y) * Math.min(1, dt * 4.5);
      } else if (npc.kind === "rival") {
        const inside = npc.position.y + npc.radius < TRAIN_FLOOR;
        if (!inside) {
          npc.velocity.x += (npc.targetX - npc.position.x) * dt * 2.8;
          const aligned = Math.abs(npc.targetX - npc.position.x) < 58;
          npc.velocity.y += ((aligned ? -105 : -34) - npc.velocity.y) * Math.min(1, dt * 3.4);
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
        this.movePlayer(normal.x * 12, 15);
        this.lastStrongEjection = this.timeRemaining;
        this.shake = Math.max(this.shake, 0.18);
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
      this.player.caffeineTime = 5;
      this.texts.push({ text: "CAFFEINE RUSH!", position: { ...this.player.position }, life: 1.2, color: "#ffe14f" });
      for (let i = 0; i < 18; i++) this.spawnSpark(this.player.position, "#ffe14f");
      this.shake = 0.2;
    }
  }

  private judgeResult(): void {
    this.doorProgress = 1;
    const top = this.player.position.y - this.player.radius;
    const bottom = this.player.position.y + this.player.radius;
    if (bottom <= TRAIN_FLOOR + 5) {
      this.phase = GamePhase.Cleared;
      this.texts.push({ text: "탑승 성공!", position: { ...this.player.position }, life: 1.4, color: "#55d6a7" });
    } else {
      this.phase = GamePhase.Failed;
      const overlapsLine = top < TRAIN_FLOOR + 8 && bottom > TRAIN_FLOOR - 8;
      const recentlyEjected = this.lastStrongEjection <= 2.2 && this.lastStrongEjection >= 0;
      this.failureReason = overlapsLine ? FailureReason.Stuck : recentlyEjected ? FailureReason.PushedOut : FailureReason.Timeout;
    }
    this.resultTime = 0;
    this.shake = 0.34;
  }

  private neighborPressure(target: Npc): number {
    return this.npcs.reduce((pressure, other) => {
      if (other === target || !other.active) return pressure;
      const distance = Math.hypot(other.position.x - target.position.x, other.position.y - target.position.y);
      return distance < target.radius + other.radius + 13 ? pressure + 0.68 : pressure;
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
    for (const floatingText of this.texts) {
      floatingText.position.y -= 28 * dt;
      floatingText.life -= dt;
    }
    this.texts = this.texts.filter((floatingText) => floatingText.life > 0);
    if (this.player.caffeineTime > 0 && Math.random() < dt * 16) this.spawnSpark(this.player.position, "#ffe14f");
  }

  private spawnImpact(position: Vec2, color: string, count: number): void {
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
