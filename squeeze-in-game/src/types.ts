export type Vec2 = { x: number; y: number };

export enum GamePhase {
  Ready = "Ready",
  Playing = "Playing",
  Cleared = "Cleared",
  Failed = "Failed",
  GameOver = "GameOver",
}

export enum FailureReason {
  Timeout = "Timeout",
  Stuck = "Stuck",
  PushedOut = "PushedOut",
}

export type NpcKind = "normal" | "backpack" | "alighter" | "rival";
export type NpcBody = "slim" | "normal" | "tall" | "large" | "backpack";

export interface Actor {
  id: number;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  squash: number;
}

export interface Player extends Actor {
  lastDirection: Vec2;
  pushCooldown: number;
  pushFlash: number;
  caffeineTime: number;
}

export interface Npc extends Actor {
  kind: NpcKind;
  body: NpcBody;
  resistance: number;
  targetX: number;
  active: boolean;
  tint: number;
  pantsTint: number;
  skinTone: string;
  heightScale: number;
  widthScale: number;
  headScale: number;
  impactCooldown: number;
}

export interface Spawn {
  kind: NpcKind;
  body?: NpcBody;
  x: number;
  y: number;
  targetX?: number;
}

export interface StageDefinition {
  name: string;
  timeLimit: number;
  spawns: Spawn[];
  coffee?: Vec2;
  randomize?: boolean;
}

export interface Burst {
  position: Vec2;
  velocity: Vec2;
  life: number;
  color: string;
  size: number;
}

export interface FloatingText {
  text: string;
  position: Vec2;
  life: number;
  color: string;
}

export interface ImpactMark {
  position: Vec2;
  life: number;
  color: string;
  strong: boolean;
}

export interface GameSnapshot {
  stage: number;
  stageName: string;
  phase: GamePhase;
  failureReason?: FailureReason;
  timeRemaining: number;
  player: Vec2;
  caffeineTime: number;
  lives: number;
  doorProgress: number;
  hitStop: number;
  npcCounts: Record<NpcKind, number>;
  bodyCounts: Record<NpcBody, number>;
  lastAttemptResult: string;
}
