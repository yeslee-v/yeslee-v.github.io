import type Phaser from 'phaser';

export enum GameState {
  Playing = 'Playing',
  RidingBus = 'RidingBus',
  Cleared = 'Cleared',
  Late = 'Late',
  Resigned = 'Resigned',
  MentalBreak = 'MentalBreak',
}

export interface CrowdActor {
  sprite: Phaser.GameObjects.Sprite;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  targetIsEnd: boolean;
  speed: number;
}

export interface GameSnapshot {
  state: GameState;
  elapsedSeconds: number;
  clockText: string;
  mental: number;
  currentSpeed: number;
  coffeeRemainingSeconds: number;
  playerX: number;
  playerY: number;
  busX: number;
  busY: number;
  busVisible: boolean;
  crowdCount: number;
  sceneCrowdCount: number;
  sceneBusCount: number;
  objective: string;
  coffeeVisible: boolean;
  resignationVisible: boolean;
  hasRiddenBus: boolean;
  resultVisible: boolean;
  dialogueVisible: boolean;
  dialogueText: string;
}

export interface CommuteRushTestApi {
  snapshot(): GameSnapshot;
  teleport(x: number, y: number): void;
  setElapsedSeconds(seconds: number): void;
  summonBusAtStop(): void;
  forceBusArrival(): void;
  forceBusMiss(): void;
  damageFromCrowd(index?: number): void;
  crowdPosition(index?: number): { x: number; y: number };
  collectCoffee(): void;
  collectResignation(): void;
  reachScanner(): void;
  restartScene(): void;
}

declare global {
  interface Window {
    __COMMUTE_RUSH_TEST__?: CommuteRushTestApi;
  }
}

export function isTerminalState(state: GameState): boolean {
  return (
    state === GameState.Cleared ||
    state === GameState.Late ||
    state === GameState.Resigned ||
    state === GameState.MentalBreak
  );
}
