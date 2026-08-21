import Phaser from 'phaser';
import { COLORS, GAME_CONFIG } from './config';
import {
  type BusKind,
  GameStage,
  GameState,
  isTerminalState,
  type CommuteRushTestApi,
  type CrowdActor,
  type GameSnapshot,
} from './types';

const SUBWAY_VILLAIN_LINES = [
  '안 비켜! 다음 차 타!',
  '비켜! 나 먼저!',
  '내릴 사람? 난 모르겠는데?',
  '출근길 처음 봐?',
] as const;

const BOSS_LINES = [
  '요즘 젊은 애들은 절박함이 없어.',
  '나 때는 지하철 문에 끼어서라도 출근했어.',
  '회사에 애정이 없으니까 늦는 거야.',
  '이 정도 출근길도 못 버티나?',
] as const;

const PLAYER_COFFEE_LINES = [
  '마시니까 좀 살 것 같군...',
  '좋아, 카페인 풀충전.',
  '이제 좀 뛸 만한데?',
] as const;

const FONT_FAMILY = 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", Arial, sans-serif';
const PLAYER_START_X = 110;
const PLAYER_START_Y = 430;
const BUS_Y = 474;
const BUS_RIDER_OFFSET_X = -20;
const BUS_RIDER_OFFSET_Y = 82;
const COFFEE_X = 720;
const COFFEE_Y = 350;
const RESIGNATION_X = 3260;
const RESIGNATION_Y = 290;
const SCANNER_X = 4090;
const SCANNER_Y = 330;
const RED_BOARDING_X = 1745;
const WRONG_BOARDING_X = 1965;
const BOARDING_Y = 624;
const BOARDING_WIDTH = 190;
const BOARDING_HEIGHT = 92;
const FINGERPRINT_STAGE_X = 3760;

type BusPhase = 'moving' | 'cooldown';

export class GameScene extends Phaser.Scene {
  private state = GameState.Playing;
  private stage = GameStage.Subway;
  private gameStarted = false;
  private autoStartOnCreate = false;
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerIndicator!: Phaser.GameObjects.Triangle;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private bus!: Phaser.GameObjects.Sprite;
  private busDestinationText!: Phaser.GameObjects.Text;
  private coffee!: Phaser.GameObjects.Sprite;
  private coffeeLabel!: Phaser.GameObjects.Text;
  private resignation!: Phaser.GameObjects.Sprite;
  private scanner!: Phaser.GameObjects.Sprite;
  private crowd: CrowdActor[] = [];
  private queueNpcs: Phaser.GameObjects.Sprite[] = [];
  private subwayVillainActor?: CrowdActor;
  private subwayVillainBadge?: Phaser.GameObjects.Container;

  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  private readonly movementVector = new Phaser.Math.Vector2();
  private readonly knockbackVector = new Phaser.Math.Vector2();
  private currentSpeed: number = GAME_CONFIG.playerBaseSpeed;
  private mental: number = GAME_CONFIG.maxMental;
  private hasRiddenBus = false;

  private runStartedAtMs = 0;
  private frozenElapsedSeconds = 0;
  private lastDisplayedClockSecond = -1;

  private invulnerableUntilMs = 0;
  private knockbackUntilMs = 0;
  private dialogueUntilMs = 0;
  private coffeeUntilMs = 0;
  private coffeeCollected = false;
  private resignationCollected = false;

  private busPhase: BusPhase = 'moving';
  private busRespawnAtMs = 0;
  private busKind: BusKind = 'red';
  private nextBusKind: BusKind = 'blue';
  private busArrivalResolved = false;
  private queueNpcCount = 0;
  private fullBusMissed = false;

  private objective = '';
  private clockText!: Phaser.GameObjects.Text;
  private mentalText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private coffeeText!: Phaser.GameObjects.Text;
  private stageTexts: Phaser.GameObjects.Text[] = [];
  private bossNameText!: Phaser.GameObjects.Text;
  private playerDialogueText!: Phaser.GameObjects.Text;
  private playerDialogueUntilMs = 0;
  private noticeText!: Phaser.GameObjects.Text;
  private noticeUntilMs = 0;
  private bossPanel!: Phaser.GameObjects.Container;
  private bossDialogueText!: Phaser.GameObjects.Text;
  private titleOverlay!: Phaser.GameObjects.Container;
  private titleStartButton!: Phaser.GameObjects.Rectangle;
  private resultOverlay!: Phaser.GameObjects.Container;
  private resultPanel!: Phaser.GameObjects.Rectangle;
  private resultTitleText!: Phaser.GameObjects.Text;
  private resultTimeText!: Phaser.GameObjects.Text;
  private resultBodyText!: Phaser.GameObjects.Text;

  public constructor() {
    super('GameScene');
  }

  public init(data: { autoStart?: boolean } = {}): void {
    this.autoStartOnCreate = Boolean(data.autoStart);
  }

  public create(): void {
    this.resetRuntimeValues();
    this.createRuntimeTextures();
    this.createWorld();
    this.createPlayer();
    this.createCrowd();
    this.createQueueNpcs();
    this.createBus();
    this.createItemsAndGoal();
    this.createHud();
    this.titleOverlay = this.createTitleOverlay();
    this.configureInputAndCamera();
    this.installTestApi();

    this.physics.add.collider(this.player, this.walls);
    this.updateStageAndObjective(true);
    this.updateHud(performance.now(), true);

    if (this.autoStartOnCreate) {
      this.startGame(false);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
  }

  public update(_time: number, delta: number): void {
    const nowMs = performance.now();

    if (!this.gameStarted) {
      return;
    }

    if (isTerminalState(this.state)) {
      return;
    }

    const elapsedSeconds = this.getElapsedSeconds(nowMs);
    if (elapsedSeconds >= GAME_CONFIG.timeLimitSeconds) {
      this.frozenElapsedSeconds = GAME_CONFIG.timeLimitSeconds;
      this.transitionTo(GameState.Late);
      return;
    }

    const safeDeltaSeconds = Math.min(delta, 50) / 1000;
    this.updateCrowd(safeDeltaSeconds);
    this.updateBus(nowMs, safeDeltaSeconds);

    if (this.state === GameState.RidingBus) {
      this.syncPlayerToBus();
      this.hideBossDialogueIfExpired(nowMs);
      this.hideTransientMessagesIfExpired(nowMs);
      this.updateHud(nowMs);
      return;
    }

    this.updatePlayerMovement(nowMs);
    this.checkCrowdContacts(nowMs);
    this.checkItemContacts(nowMs);
    this.checkScannerContact();
    this.updateStageAndObjective();
    this.updateBlink(nowMs);
    this.hideBossDialogueIfExpired(nowMs);
    this.hideTransientMessagesIfExpired(nowMs);
    this.updateHud(nowMs);
  }

  private resetRuntimeValues(): void {
    this.state = GameState.Playing;
    this.stage = GameStage.Subway;
    this.gameStarted = false;
    this.crowd = [];
    this.queueNpcs = [];
    this.subwayVillainActor = undefined;
    this.subwayVillainBadge = undefined;
    this.currentSpeed = GAME_CONFIG.playerBaseSpeed;
    this.mental = GAME_CONFIG.maxMental;
    this.hasRiddenBus = false;
    this.runStartedAtMs = 0;
    this.frozenElapsedSeconds = 0;
    this.lastDisplayedClockSecond = -1;
    this.invulnerableUntilMs = 0;
    this.knockbackUntilMs = 0;
    this.dialogueUntilMs = 0;
    this.coffeeUntilMs = 0;
    this.coffeeCollected = false;
    this.resignationCollected = false;
    this.busPhase = 'moving';
    this.busRespawnAtMs = 0;
    this.busKind = 'red';
    this.nextBusKind = 'blue';
    this.busArrivalResolved = false;
    this.queueNpcCount = Phaser.Math.Between(0, 6);
    this.fullBusMissed = false;
    this.objective = '';
    this.stageTexts = [];
    this.playerDialogueUntilMs = 0;
    this.noticeUntilMs = 0;
    this.movementVector.set(0, 0);
    this.knockbackVector.set(0, 0);
  }

  private createRuntimeTextures(): void {
    this.createPixelTexture();
    this.createPersonTexture('player', 0x1e3a5f, 0xf8fafc, true);

    const crowdSuitColors = [
      0x334155,
      0x1e3a5f,
      0x475569,
      0x0f766e,
      0x7c2d12,
      0x4338ca,
      0x155e75,
      0x4b5563,
      0x6b21a8,
      0x78350f,
    ];
    crowdSuitColors.forEach((color, index) => {
      this.createPersonTexture(`crowd-${index}`, color, 0xf2d3b1, false, index % 3);
    });
    this.createPersonTexture('subway-villain', 0x991b1b, 0xe9b891, false, 0, true);

    this.createBusTexture('bus-red', 0xdc2626, 0xf87171);
    this.createBusTexture('bus-blue', 0x2563eb, 0x60a5fa);
    this.createBusTexture('bus-green', 0x15803d, 0x4ade80);
    this.createCoffeeTexture();
    this.createResignationTexture();
    this.createScannerTexture();
  }

  private createPixelTexture(): void {
    if (this.textures.exists('pixel')) {
      return;
    }
    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRect(0, 0, 4, 4);
    graphics.generateTexture('pixel', 4, 4);
    graphics.destroy();
  }

  private createPersonTexture(
    key: string,
    suitColor: number,
    skinColor: number,
    isPlayer: boolean,
    sizeVariant = 0,
    isVillain = false,
  ): void {
    if (this.textures.exists(key)) {
      return;
    }

    const width = 42 + sizeVariant * 2;
    const height = 58 + sizeVariant * 2;
    const centerX = width / 2;
    const graphics = this.add.graphics({ x: 0, y: 0 });

    graphics.fillStyle(0x0f172a, 0.18);
    graphics.fillEllipse(centerX + 2, height - 5, width - 8, 10);
    graphics.fillStyle(suitColor, 1);
    graphics.fillRoundedRect(7, 22, width - 14, height - 28, 5);
    graphics.fillStyle(skinColor, 1);
    graphics.fillCircle(centerX, 15, 12);
    graphics.fillStyle(0x2b2118, 1);
    graphics.fillRect(centerX - 10, 5, 20, 5);
    graphics.fillStyle(0xf8fafc, 1);
    graphics.fillTriangle(centerX - 8, 23, centerX + 8, 23, centerX, 36);
    graphics.fillStyle(isPlayer ? 0xfacc15 : 0x111827, 1);
    graphics.fillTriangle(centerX - 3, 27, centerX + 3, 27, centerX, 40);
    graphics.fillStyle(0x111827, 1);
    graphics.fillRect(8, height - 10, 10, 8);
    graphics.fillRect(width - 18, height - 10, 10, 8);

    if (!isPlayer && !isVillain && sizeVariant === 0) {
      graphics.fillStyle(0x0f172a, 1);
      graphics.fillRoundedRect(width - 13, 30, 7, 12, 2);
      graphics.fillStyle(0x38bdf8, 1);
      graphics.fillRect(width - 12, 32, 5, 7);
    } else if (!isPlayer && !isVillain && sizeVariant === 1) {
      graphics.lineStyle(2, 0x78350f, 1);
      graphics.lineBetween(9, 25, width - 9, height - 15);
      graphics.fillStyle(0x92400e, 1);
      graphics.fillRoundedRect(width - 18, height - 27, 13, 16, 2);
    } else if (!isPlayer && !isVillain && sizeVariant === 2) {
      graphics.fillStyle(0xe0f2fe, 1);
      graphics.fillRoundedRect(width - 14, 30, 8, 13, 2);
      graphics.fillStyle(0x7c2d12, 1);
      graphics.fillRect(width - 13, 35, 6, 7);
    }

    if (isPlayer) {
      graphics.lineStyle(2, 0xfacc15, 1);
      graphics.strokeRoundedRect(4, 2, width - 8, height - 4, 7);
      graphics.fillStyle(0x38bdf8, 1);
      graphics.fillRoundedRect(4, 28, 7, 18, 2);
    }

    if (isVillain) {
      graphics.lineStyle(3, 0xf97316, 1);
      graphics.strokeRoundedRect(3, 2, width - 6, height - 4, 7);
      graphics.lineStyle(2, 0x450a0a, 1);
      graphics.lineBetween(centerX - 9, 11, centerX - 2, 14);
      graphics.lineBetween(centerX + 2, 14, centerX + 9, 11);
      graphics.fillStyle(0xfacc15, 1);
      graphics.fillRect(width - 9, 4, 3, 9);
      graphics.fillCircle(width - 7.5, 16, 2);
    }

    graphics.generateTexture(key, width, height);
    graphics.destroy();
  }

  private createBusTexture(key: string, bodyColor: number, accentColor: number): void {
    if (this.textures.exists(key)) {
      return;
    }

    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0x0f172a, 0.25);
    graphics.fillRoundedRect(8, 9, 292, 102, 18);
    graphics.fillStyle(bodyColor, 1);
    graphics.fillRoundedRect(0, 0, 292, 102, 16);
    graphics.fillStyle(accentColor, 1);
    graphics.fillRoundedRect(20, 14, 210, 74, 10);
    graphics.fillStyle(0x0f172a, 1);
    for (let index = 0; index < 5; index += 1) {
      graphics.fillRoundedRect(29 + index * 39, 22, 29, 55, 4);
    }
    graphics.fillStyle(0xfacc15, 1);
    graphics.fillRect(0, 82, 292, 10);
    graphics.fillStyle(0xf8fafc, 1);
    graphics.fillRoundedRect(237, 18, 42, 62, 6);
    graphics.fillStyle(0x111827, 1);
    graphics.fillRoundedRect(18, 94, 58, 8, 4);
    graphics.fillRoundedRect(215, 94, 58, 8, 4);
    graphics.generateTexture(key, 304, 116);
    graphics.destroy();
  }

  private createCoffeeTexture(): void {
    if (this.textures.exists('coffee')) {
      return;
    }

    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xfacc15, 0.22);
    graphics.fillCircle(24, 28, 24);
    graphics.fillStyle(0x0f172a, 0.28);
    graphics.fillEllipse(24, 51, 40, 8);
    graphics.fillStyle(0xe0f2fe, 1);
    graphics.fillRoundedRect(8, 8, 32, 40, 5);
    graphics.fillStyle(0xbae6fd, 1);
    graphics.fillCircle(15, 15, 3);
    graphics.fillCircle(23, 13, 3);
    graphics.fillCircle(31, 16, 3);
    graphics.fillStyle(0x7c2d12, 1);
    graphics.fillRect(11, 20, 26, 24);
    graphics.fillStyle(0xf8fafc, 1);
    graphics.fillRect(5, 4, 38, 8);
    graphics.fillStyle(0x111827, 1);
    graphics.fillRect(29, 0, 4, 18);
    graphics.fillStyle(0xfacc15, 1);
    graphics.fillCircle(4, 18, 2);
    graphics.fillCircle(44, 28, 2);
    graphics.fillRect(3, 32, 3, 7);
    graphics.generateTexture('coffee', 48, 56);
    graphics.destroy();
  }

  private createResignationTexture(): void {
    if (this.textures.exists('resignation')) {
      return;
    }

    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(2, 2, 52, 38, 3);
    graphics.lineStyle(2, 0xef4444, 1);
    graphics.strokeRoundedRect(2, 2, 52, 38, 3);
    graphics.lineStyle(2, 0x64748b, 1);
    graphics.lineBetween(10, 14, 46, 14);
    graphics.lineBetween(10, 22, 42, 22);
    graphics.lineBetween(10, 30, 36, 30);
    graphics.fillStyle(0xef4444, 1);
    graphics.fillCircle(45, 31, 6);
    graphics.generateTexture('resignation', 58, 44);
    graphics.destroy();
  }

  private createScannerTexture(): void {
    if (this.textures.exists('scanner')) {
      return;
    }

    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0x111827, 1);
    graphics.fillRoundedRect(2, 2, 46, 82, 6);
    graphics.fillStyle(0x22c55e, 1);
    graphics.fillRoundedRect(9, 10, 32, 32, 4);
    graphics.lineStyle(2, 0xdcfce7, 1);
    graphics.strokeCircle(25, 26, 9);
    graphics.lineStyle(1, 0xdcfce7, 1);
    graphics.strokeCircle(25, 26, 5);
    graphics.fillStyle(0x64748b, 1);
    graphics.fillRoundedRect(13, 50, 24, 22, 3);
    graphics.generateTexture('scanner', 50, 86);
    graphics.destroy();
  }

  private createWorld(): void {
    this.physics.world.setBounds(0, 0, GAME_CONFIG.worldWidth, GAME_CONFIG.worldHeight);
    this.cameras.main.setBackgroundColor(COLORS.background);
    this.cameras.main.setBounds(0, 0, GAME_CONFIG.worldWidth, GAME_CONFIG.worldHeight);

    this.add
      .rectangle(0, 0, 1420, GAME_CONFIG.worldHeight, COLORS.subwayFloor)
      .setOrigin(0, 0)
      .setDepth(-20);
    this.add
      .rectangle(1420, 0, 1500, GAME_CONFIG.worldHeight, COLORS.busStopFloor)
      .setOrigin(0, 0)
      .setDepth(-20);
    this.add
      .rectangle(2920, 0, GAME_CONFIG.worldWidth - 2920, GAME_CONFIG.worldHeight, COLORS.officeFloor)
      .setOrigin(0, 0)
      .setDepth(-20);

    this.createSubwayVisuals();
    this.createRoadAndStopVisuals();
    this.createOfficeVisuals();

    this.walls = this.physics.add.staticGroup();
    this.addWall(GAME_CONFIG.worldWidth / 2, 112, GAME_CONFIG.worldWidth, 24, COLORS.wall, true);
    this.addWall(GAME_CONFIG.worldWidth / 2, 712, GAME_CONFIG.worldWidth, 24, COLORS.wall, true);

    this.addWall(445, 255, 180, 64, 0x1e293b, true);
    this.addWall(730, 555, 210, 58, 0x334155, true);
    this.addWall(1015, 380, 118, 148, 0x1e293b, true);
    this.addWall(1300, 230, 100, 120, 0x111827, true);

    this.addWall(2110, 410, 82, 596, 0x991b1b);
    this.addWall(3545, 340, 360, 360, 0x475569);
    this.addWall(3890, 540, 72, 220, 0x475569);
  }

  private createSubwayVisuals(): void {
    this.add.rectangle(0, 124, 1420, 580, 0x8491a1).setOrigin(0, 0).setDepth(-18);
    this.add.rectangle(0, 124, 1420, 112, 0x1e2b3d).setOrigin(0, 0).setDepth(-15);
    this.add.rectangle(0, 124, 1420, 10, 0x0f172a).setOrigin(0, 0).setDepth(-13);

    this.createPlatformScreenDoors();
    this.createSubwayFloorPattern();
    this.createSubwayBackgroundCrowd();
    this.createSubwayPropVisuals();

    this.add
      .text(28, 266, 'B2  ·  만원 지하철', {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#e0f2fe',
        backgroundColor: '#0f172ad9',
        padding: { x: 11, y: 6 },
      })
      .setDepth(10);
  }

  private createPlatformScreenDoors(): void {
    const routeBand = this.add.rectangle(710, 151, 1380, 34, 0x111827, 0.96).setDepth(-11);
    routeBand.setStrokeStyle(2, 0x334155, 1);
    this.add
      .text(36, 139, '한강로  ·  출근 방면', {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#bae6fd',
        letterSpacing: 1,
      })
      .setDepth(-9);

    for (let bay = 0; bay < 7; bay += 1) {
      const x = 18 + bay * 176;
      const glass = this.add
        .rectangle(x, 170, 160, 62, 0x1f3b50, 0.92)
        .setOrigin(0, 0)
        .setStrokeStyle(3, 0x64748b, 1)
        .setDepth(-12);
      glass.setData('station-layer', 'screen-door');
      this.add.rectangle(x + 80, 201, 3, 58, 0x94a3b8, 0.9).setDepth(-10);
      this.add.rectangle(x + 14, 218, 132, 5, 0x38bdf8, 0.75).setDepth(-9);
      this.add.rectangle(x + 80, 229, 152, 10, 0x111827, 0.7).setDepth(-9);

      for (const silhouetteOffset of [-43, -18, 18, 43]) {
        this.add.circle(x + 80 + silhouetteOffset, 189, 7, 0x0f172a, 0.66).setDepth(-11);
        this.add
          .rectangle(x + 80 + silhouetteOffset, 207, 12, 26, 0x0f172a, 0.62)
          .setDepth(-11);
      }
    }

    this.add.rectangle(0, 234, 1420, 18, COLORS.platformStripe, 1).setOrigin(0, 0).setDepth(-7);
    this.add.rectangle(0, 252, 1420, 5, 0xb91c1c, 0.9).setOrigin(0, 0).setDepth(-7);
  }

  private createSubwayFloorPattern(): void {
    this.add.rectangle(710, 480, 1420, 448, 0x8794a4, 1).setDepth(-17);
    this.add.rectangle(710, 470, 1280, 150, 0xa3afbc, 0.42).setDepth(-14);

    for (let x = 0; x <= 1420; x += 72) {
      this.add.rectangle(x, 478, 2, 452, 0xcbd5e1, 0.19).setDepth(-12);
    }
    for (let y = 282; y <= 704; y += 56) {
      this.add.rectangle(710, y, 1420, 2, 0x475569, 0.2).setDepth(-12);
    }

    for (let x = 90; x < 1350; x += 42) {
      this.add.rectangle(x, 641, 28, 10, 0xfacc15, 0.72).setDepth(-7);
    }
    for (let x = 170; x < 1280; x += 170) {
      this.add
        .text(x, 444, '›', {
          fontFamily: FONT_FAMILY,
          fontSize: '38px',
          fontStyle: 'bold',
          color: '#dbeafe66',
        })
        .setOrigin(0.5)
        .setDepth(-6);
    }
  }

  private createSubwayBackgroundCrowd(): void {
    const positions = [
      [95, 300], [132, 305], [170, 292], [205, 304],
      [242, 316], [278, 298],
      [345, 338], [382, 325], [420, 340],
      [565, 300], [602, 310], [640, 296], [678, 312],
      [744, 318], [780, 298], [816, 320],
      [835, 596], [872, 605], [910, 590],
      [1042, 315], [1110, 292], [1146, 304], [1182, 290], [1218, 306],
    ] as const;

    positions.forEach(([x, y], index) => {
      const passenger = this.add.sprite(x, y, `crowd-${index % GAME_CONFIG.crowdCount}`);
      passenger
        .setName('background-crowd')
        .setScale(0.58 + (index % 3) * 0.04)
        .setAlpha(0.58)
        .setTint(index % 4 === 0 ? 0xcbd5e1 : 0xa8b4c3)
        .setDepth(7 + (y % 2));
    });
  }

  private createSubwayPropVisuals(): void {
    this.add
      .rectangle(445, 255, 172, 54, 0x1e293b, 1)
      .setStrokeStyle(4, 0x475569, 1)
      .setDepth(2);

    this.add.rectangle(730, 550, 198, 45, 0x334155, 1).setStrokeStyle(4, 0x1e293b).setDepth(2);
    for (const x of [650, 690, 730, 770, 810]) {
      this.add.rectangle(x, 548, 28, 35, 0x64748b, 1).setDepth(3);
    }
    this.add.rectangle(650, 588, 10, 24, 0x1e293b).setDepth(2);
    this.add.rectangle(810, 588, 10, 24, 0x1e293b).setDepth(2);

    this.add
      .rectangle(1015, 380, 104, 138, 0x2b3545, 1)
      .setStrokeStyle(5, 0x172033, 1)
      .setDepth(2);
    this.add.rectangle(1015, 336, 94, 38, 0x075985, 1).setDepth(3);
    this.add
      .text(1015, 336, '2호선  ●\n환승 통로', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(4);

    this.add.rectangle(1300, 230, 88, 112, 0x111827, 1).setStrokeStyle(4, 0x475569).setDepth(2);
    for (const x of [1274, 1300, 1326]) {
      this.add.rectangle(x, 245, 12, 76, 0x64748b, 1).setDepth(3);
      this.add.rectangle(x, 215, 18, 22, 0x22c55e, 1).setDepth(4);
    }

    this.add
      .rectangle(1150, 580, 220, 104, 0x064e3b, 0.98)
      .setStrokeStyle(5, 0x6ee7b7, 1)
      .setDepth(3);
    this.add
      .text(1150, 563, '3번 출구  →', {
        fontFamily: FONT_FAMILY,
        fontSize: '27px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(5);
    this.add
      .text(1150, 604, 'EXIT  ·  회사 방면', {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#a7f3d0',
        letterSpacing: 1,
      })
      .setOrigin(0.5)
      .setDepth(5);
    this.add.rectangle(1388, 478, 12, 350, 0x10b981, 0.72).setDepth(-3);
  }

  private createRoadAndStopVisuals(): void {
    this.add.rectangle(1420, 124, 1500, 580, 0xd9e2e8).setOrigin(0, 0).setDepth(-14);
    this.add.rectangle(1420, 244, 1500, 306, COLORS.road).setOrigin(0, 0).setDepth(-12);

    for (const laneLineY of [346, 448]) {
      for (let x = 1465; x < 2920; x += 138) {
        this.add.rectangle(x, laneLineY, 82, 7, COLORS.roadLine, 0.72).setDepth(-6);
      }
    }

    this.add
      .rectangle(1790, 624, 590, 126, 0xe0f2fe, 0.96)
      .setStrokeStyle(4, 0x0284c7, 0.9)
      .setDepth(-4);
    this.add
      .rectangle(RED_BOARDING_X, BOARDING_Y, BOARDING_WIDTH, BOARDING_HEIGHT, 0xfecaca, 0.95)
      .setStrokeStyle(4, 0xdc2626, 1)
      .setDepth(-3);
    this.add
      .rectangle(WRONG_BOARDING_X, BOARDING_Y, BOARDING_WIDTH, BOARDING_HEIGHT, 0xdbeafe, 0.95)
      .setStrokeStyle(4, 0x2563eb, 1)
      .setDepth(-3);

    this.add.rectangle(1515, 256, 18, 120, 0x334155);
    this.add.rectangle(1558, 222, 118, 50, 0xdc2626).setStrokeStyle(3, 0xffffff);
    this.addWorldLabel(1558, 222, '버스 정류장', 0xffffff).setOrigin(0.5);
    this.addWorldLabel(1790, 565, '버스 대기 · 승차 위치를 선택하세요', 0x0f172a, '#f8faf0e6').setOrigin(0.5);
    this.addWorldLabel(RED_BOARDING_X, BOARDING_Y, '빨간 광역버스\n승차 위치', 0x991b1b).setOrigin(0.5);
    this.addWorldLabel(WRONG_BOARDING_X, BOARDING_Y, '일반버스\n승차 위치', 0x1e3a8a).setOrigin(0.5);
    this.addWorldLabel(2185, 190, '도로 횡단 금지 · 승차 위치에서 기다리세요', 0xffffff, '#111827e6').setOrigin(0.5);
    this.addWorldLabel(2620, 520, '버스 전용 도로 · 3차선', 0xffffff, '#111827cc').setOrigin(0.5);
    this.addSectionTitle(1460, 144, '2  빨간 광역버스 탑승');

    for (const x of [2350, 2490, 2630, 2770]) {
      this.add.rectangle(x, 215, 10, 42, 0x7c4a24).setDepth(-3);
      this.add.circle(x, 188, 25, 0x16a34a).setStrokeStyle(3, 0x166534).setDepth(-2);
      this.add.circle(x - 18, 217, 5, 0xf472b6).setDepth(-2);
      this.add.circle(x + 18, 218, 5, 0xfacc15).setDepth(-2);
    }
  }

  private createOfficeVisuals(): void {
    this.addSectionTitle(2980, 156, '3  회사 로비 · 지문 인식기');

    this.add.rectangle(2920, 124, 1280, 24, 0x1e293b).setOrigin(0, 0).setDepth(-5);
    for (let x = 3000; x < 4200; x += 160) {
      this.add.rectangle(x, 670, 96, 12, 0x94a3b8, 0.45).setDepth(-5);
    }

    this.add.rectangle(3545, 340, 340, 340, 0x64748b).setStrokeStyle(5, 0x334155);
    for (let offset = -130; offset <= 130; offset += 32) {
      this.add.rectangle(3545, 340 + offset, 290, 12, 0x94a3b8).setDepth(1);
    }
    this.add.rectangle(3545, 180, 270, 54, 0xef4444).setDepth(2);
    this.addWorldLabel(3545, 180, '고장 · 이용 금지', 0xffffff).setOrigin(0.5).setDepth(3);
    this.addWorldLabel(3545, 535, '에스컬레이터', 0x111827, '#f8faf0e6').setOrigin(0.5).setDepth(3);

    this.add.rectangle(3545, 624, 390, 110, 0x9ca3af).setStrokeStyle(4, 0x475569);
    for (let x = 3390; x <= 3700; x += 35) {
      this.add.rectangle(x, 624, 20, 82, 0xd1d5db);
    }
    this.addWorldLabel(3545, 624, '계단 우회로', 0x111827).setOrigin(0.5).setDepth(3);
    this.addWorldLabel(4060, 205, '지문 인식 · 접촉 시 출근 성공', 0x111827, '#f8faf0e6').setOrigin(0.5);
  }

  private addWall(
    x: number,
    y: number,
    width: number,
    height: number,
    tint: number,
    hideCollider = false,
  ): void {
    const wall = this.physics.add.staticImage(x, y, 'pixel');
    wall.setDisplaySize(width, height);
    wall.setTint(tint);
    wall.setDepth(0).setAlpha(hideCollider ? 0 : 1);
    wall.refreshBody();
    this.walls.add(wall);
  }

  private addSectionTitle(x: number, y: number, text: string): void {
    this.add
      .text(x, y, text, {
        fontFamily: FONT_FAMILY,
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#f8fafc',
        backgroundColor: '#0f172acc',
        padding: { x: 14, y: 8 },
      })
      .setDepth(10);
  }

  private addWorldLabel(
    x: number,
    y: number,
    text: string,
    color: number,
    backgroundColor?: string,
  ): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        fontStyle: 'bold',
        color: Phaser.Display.Color.IntegerToColor(color).rgba,
        align: 'center',
        backgroundColor,
        padding: backgroundColor ? { x: 7, y: 4 } : undefined,
      })
      .setDepth(5);
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(PLAYER_START_X, PLAYER_START_Y, 'player');
    this.player.setName('player');
    this.player.setDepth(30);
    this.player.setCollideWorldBounds(true);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(28, 40);
    body.setOffset((this.player.width - 28) / 2, this.player.height - 42);

    this.playerIndicator = this.add
      .triangle(PLAYER_START_X, PLAYER_START_Y - 44, 0, 12, 7, 0, 14, 12, 0xfacc15)
      .setStrokeStyle(2, 0x111827)
      .setDepth(31);
  }

  private createCrowd(): void {
    const paths = [
      [280, 205, 280, 610],
      [370, 610, 370, 185],
      [545, 190, 545, 620],
      [640, 610, 640, 190],
      [805, 190, 805, 620],
      [900, 620, 900, 180],
      [1090, 180, 1090, 620],
      [1180, 620, 1180, 190],
      [450, 470, 860, 470],
      [760, 285, 1240, 285],
    ] as const;

    paths.slice(0, GAME_CONFIG.crowdCount).forEach((path, index) => {
      const [startX, startY, endX, endY] = path;
      const sprite = this.add.sprite(
        startX,
        startY,
        index === 0 ? 'subway-villain' : `crowd-${index}`,
      );
      sprite.setName('crowd-npc');
      sprite.setDepth(20 + (startY % 5));
      sprite.setScale(0.9 + (index % 3) * 0.06);

      const actor: CrowdActor = {
        sprite,
        startX,
        startY,
        endX,
        endY,
        targetIsEnd: true,
        speed: GAME_CONFIG.crowdSpeed + (index % 4) * 8,
      };
      this.crowd.push(actor);

      if (index === 0) {
        this.subwayVillainActor = actor;
        this.subwayVillainBadge = this.createSubwayVillainBadge(startX, startY - 49);
      }
    });
  }

  private createSubwayVillainBadge(x: number, y: number): Phaser.GameObjects.Container {
    const pill = this.add
      .rectangle(0, 0, 118, 28, 0x450a0a, 0.96)
      .setStrokeStyle(2, 0xfb923c, 1);
    const icon = this.add.circle(-45, 0, 10, 0xef4444, 1);
    const iconText = this.add
      .text(-45, -1, '!', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    const name = this.add
      .text(12, 0, '지하철 빌런', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#fed7aa',
      })
      .setOrigin(0.5);

    return this.add.container(x, y, [pill, icon, iconText, name]).setDepth(26);
  }

  private createQueueNpcs(): void {
    const slots = [
      [1535, 592],
      [1585, 592],
      [1635, 592],
      [1535, 657],
      [1585, 657],
      [1635, 657],
    ] as const;

    slots.slice(0, this.queueNpcCount).forEach(([x, y], index) => {
      const npc = this.add.sprite(x, y, `crowd-${(index + 2) % GAME_CONFIG.crowdCount}`);
      npc.setName('queue-npc').setScale(0.72).setDepth(16);
      this.queueNpcs.push(npc);
    });
  }

  private createBus(): void {
    this.bus = this.add.sprite(GAME_CONFIG.busSpawnX, BUS_Y, 'bus-red');
    this.bus.setName('commute-bus');
    this.bus.setDepth(25);
    this.busDestinationText = this.add
      .text(this.bus.x, this.bus.y - 68, '강남 · 회사', {
        fontFamily: FONT_FAMILY,
        fontSize: '17px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#7f1d1dee',
        padding: { x: 7, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(27);
  }

  private createItemsAndGoal(): void {
    this.coffee = this.add.sprite(COFFEE_X, COFFEE_Y, 'coffee').setDepth(22);
    this.coffee.setName('coffee-item');
    this.coffeeLabel = this.addWorldLabel(
      COFFEE_X,
      COFFEE_Y + 46,
      '아아 · 카페인 +35%',
      0xfef3c7,
      '#422006e8',
    ).setOrigin(0.5).setDepth(24);

    this.resignation = this.add.sprite(RESIGNATION_X, RESIGNATION_Y, 'resignation').setDepth(22);
    this.resignation.setName('resignation-item');
    this.addWorldLabel(RESIGNATION_X, RESIGNATION_Y + 42, '사직서', 0x991b1b, '#fff7edee').setOrigin(0.5);

    this.scanner = this.add.sprite(SCANNER_X, SCANNER_Y, 'scanner').setDepth(22);
    this.scanner.setName('fingerprint-scanner');
    this.addWorldLabel(SCANNER_X, SCANNER_Y + 70, '지문 인식기', 0x111827).setOrigin(0.5);
  }

  private createHud(): void {
    const hudBackground = this.add
      .rectangle(0, 0, GAME_CONFIG.width, 110, COLORS.hud, 0.97)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(500);
    hudBackground.setStrokeStyle(2, COLORS.hudAccent, 0.55);

    this.clockText = this.addFixedText(24, 8, '', 25, '#f8fafc', 'bold');
    this.objectiveText = this.addFixedText(
      GAME_CONFIG.width / 2,
      11,
      '',
      21,
      '#bae6fd',
      'bold',
    ).setOrigin(0.5, 0);
    this.mentalText = this.addFixedText(24, 45, '', 19, '#fca5a5', 'bold');

    const stageXs = [470, 650, 835, 1025];
    const stageLabels = ['만원 지하철', '광역버스', '회사 로비', '지문 인식'];
    this.stageTexts = stageLabels.map((label, index) =>
      this.addFixedText(stageXs[index], 50, label, 15, '#64748b', 'bold').setOrigin(0.5),
    );
    [560, 742, 932].forEach((x) => {
      this.addFixedText(x, 43, '━━', 16, '#475569', 'bold').setOrigin(0.5);
    });

    this.coffeeText = this.addFixedText(24, 81, '카페인 부스트 없음', 16, '#fde68a');
    this.addFixedText(1175, 83, 'WASD 이동', 14, '#cbd5e1');

    this.playerDialogueText = this.addFixedText(
      GAME_CONFIG.width / 2,
      525,
      '',
      22,
      '#fef3c7',
      'bold',
    )
      .setOrigin(0.5)
      .setBackgroundColor('#111827e8')
      .setPadding(14, 8)
      .setDepth(720)
      .setVisible(false);
    this.noticeText = this.addFixedText(
      GAME_CONFIG.width / 2,
      142,
      '',
      22,
      '#ffffff',
      'bold',
    )
      .setOrigin(0.5, 0)
      .setBackgroundColor('#991b1be8')
      .setPadding(14, 8)
      .setDepth(720)
      .setVisible(false);

    this.bossPanel = this.createBossPanel();
    this.resultOverlay = this.createResultOverlay();
  }

  private createTitleOverlay(): Phaser.GameObjects.Container {
    const backdrop = this.add
      .rectangle(0, 0, GAME_CONFIG.width, GAME_CONFIG.height, 0x07111f, 1)
      .setOrigin(0, 0);
    const glow = this.add.circle(GAME_CONFIG.width / 2, 250, 330, 0x0ea5e9, 0.08);
    const topRule = this.add.rectangle(GAME_CONFIG.width / 2, 84, 880, 4, 0x38bdf8, 0.8);
    const road = this.add.rectangle(GAME_CONFIG.width / 2, 655, GAME_CONFIG.width, 96, 0x1f2937);
    const roadLineLeft = this.add.rectangle(345, 655, 210, 8, 0xf8fafc, 0.6);
    const roadLineRight = this.add.rectangle(935, 655, 210, 8, 0xf8fafc, 0.6);
    const eyebrow = this.add
      .text(GAME_CONFIG.width / 2, 112, '08:58:30 · 출근 타임어택', {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#7dd3fc',
        letterSpacing: 2,
      })
      .setOrigin(0.5);
    const title = this.add
      .text(GAME_CONFIG.width / 2, 205, '출근길 RUSH', {
        fontFamily: FONT_FAMILY,
        fontSize: '82px',
        fontStyle: 'bold',
        color: '#f8fafc',
        stroke: '#0c4a6e',
        strokeThickness: 8,
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(GAME_CONFIG.width / 2, 290, '9시 전에 회사에 도착하세요.', {
        fontFamily: FONT_FAMILY,
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#facc15',
      })
      .setOrigin(0.5);
    const description = this.add
      .text(
        GAME_CONFIG.width / 2,
        365,
        '지하철을 뚫고 · 광역버스를 잡아타고\n지문 인식기에 손을 대라.',
        {
          fontFamily: FONT_FAMILY,
          fontSize: '23px',
          color: '#cbd5e1',
          align: 'center',
          lineSpacing: 10,
        },
      )
      .setOrigin(0.5);

    this.titleStartButton = this.add
      .rectangle(GAME_CONFIG.width / 2, 505, 330, 78, 0x0284c7, 1)
      .setStrokeStyle(4, 0x7dd3fc, 1)
      .setInteractive({ useHandCursor: true });
    const startText = this.add
      .text(GAME_CONFIG.width / 2, 505, '출근 시작', {
        fontFamily: FONT_FAMILY,
        fontSize: '31px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    const controls = this.add
      .text(GAME_CONFIG.width / 2, 575, 'WASD 이동  ·  ENTER 시작', {
        fontFamily: FONT_FAMILY,
        fontSize: '16px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);
    const playerIcon = this.add.image(260, 565, 'player').setScale(1.15);
    const busIcon = this.add.image(1040, 575, 'bus-red').setScale(0.58);

    this.titleStartButton
      .on('pointerover', () => this.titleStartButton.setFillStyle(0x0369a1, 1))
      .on('pointerout', () => this.titleStartButton.setFillStyle(0x0284c7, 1))
      .on('pointerdown', () => this.startGame(true));

    return this.add
      .container(0, 0, [
        backdrop,
        glow,
        topRule,
        road,
        roadLineLeft,
        roadLineRight,
        eyebrow,
        title,
        subtitle,
        description,
        this.titleStartButton,
        startText,
        controls,
        playerIcon,
        busIcon,
      ])
      .setScrollFactor(0)
      .setDepth(950)
      .setVisible(true);
  }

  private addFixedText(
    x: number,
    y: number,
    text: string,
    fontSize: number,
    color: string,
    fontStyle = 'normal',
  ): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, {
        fontFamily: FONT_FAMILY,
        fontSize: `${fontSize}px`,
        fontStyle,
        color,
      })
      .setScrollFactor(0)
      .setDepth(510);
  }

  private createBossPanel(): Phaser.GameObjects.Container {
    const background = this.add
      .rectangle(0, 0, 780, 106, 0x111827, 0.95)
      .setOrigin(0, 0)
      .setStrokeStyle(3, 0xf97316, 1);
    const face = this.add.circle(58, 53, 38, 0xf2c6a0).setStrokeStyle(4, 0x7c2d12);
    const hair = this.add.rectangle(58, 28, 60, 15, 0x3f2d20);
    const leftEye = this.add.circle(45, 48, 4, 0x111827);
    const rightEye = this.add.circle(71, 48, 4, 0x111827);
    const browLeft = this.add.rectangle(44, 39, 18, 3, 0x111827).setRotation(0.13);
    const browRight = this.add.rectangle(72, 39, 18, 3, 0x111827).setRotation(-0.13);
    const mouth = this.add.rectangle(58, 70, 24, 4, 0x7c2d12);
    this.bossNameText = this.add.text(108, 18, '지하철 빌런', {
      fontFamily: FONT_FAMILY,
      fontSize: '20px',
      fontStyle: 'bold',
      color: '#fdba74',
    });
    this.bossDialogueText = this.add.text(108, 52, '', {
      fontFamily: FONT_FAMILY,
      fontSize: '21px',
      fontStyle: 'bold',
      color: '#f8fafc',
      wordWrap: { width: 630 },
    });

    return this.add
      .container(250, 584, [
        background,
        face,
        hair,
        leftEye,
        rightEye,
        browLeft,
        browRight,
        mouth,
        this.bossNameText,
        this.bossDialogueText,
      ])
      .setScrollFactor(0)
      .setDepth(700)
      .setVisible(false);
  }

  private createResultOverlay(): Phaser.GameObjects.Container {
    const backdrop = this.add
      .rectangle(0, 0, GAME_CONFIG.width, GAME_CONFIG.height, 0x020617, 0.91)
      .setOrigin(0, 0);
    this.resultPanel = this.add
      .rectangle(GAME_CONFIG.width / 2, GAME_CONFIG.height / 2, 800, 470, 0x0f172a, 0.99)
      .setStrokeStyle(5, 0x38bdf8, 1);
    const resultLabel = this.add
      .text(GAME_CONFIG.width / 2, 154, '출근길 RUSH · 출근 결과', {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#7dd3fc',
      })
      .setOrigin(0.5);
    const topRule = this.add.rectangle(GAME_CONFIG.width / 2, 187, 650, 3, 0x334155, 1);
    this.resultTitleText = this.add
      .text(GAME_CONFIG.width / 2, 245, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '54px',
        fontStyle: 'bold',
        color: '#f8fafc',
        align: 'center',
      })
      .setOrigin(0.5);
    this.resultTimeText = this.add
      .text(GAME_CONFIG.width / 2, 318, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#f8fafc',
        align: 'center',
      })
      .setOrigin(0.5);
    this.resultBodyText = this.add
      .text(GAME_CONFIG.width / 2, 385, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '26px',
        color: '#dbeafe',
        align: 'center',
        lineSpacing: 10,
      })
      .setOrigin(0.5);
    const restartButton = this.add
      .rectangle(GAME_CONFIG.width / 2, 500, 350, 70, 0x1e3a5f, 1)
      .setStrokeStyle(3, 0x7dd3fc, 1)
      .setInteractive({ useHandCursor: true });
    const restartText = this.add
      .text(GAME_CONFIG.width / 2, 500, 'R  다시 출근하기', {
        fontFamily: FONT_FAMILY,
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    restartButton
      .on('pointerover', () => restartButton.setFillStyle(0x0c4a6e, 1))
      .on('pointerout', () => restartButton.setFillStyle(0x1e3a5f, 1))
      .on('pointerdown', () => this.restartPlayingScene());

    return this.add
      .container(0, 0, [
        backdrop,
        this.resultPanel,
        resultLabel,
        topRule,
        this.resultTitleText,
        this.resultTimeText,
        this.resultBodyText,
        restartButton,
        restartText,
      ])
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);
  }

  private configureInputAndCamera(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error('Keyboard input is required for this desktop prototype.');
    }

    this.keys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    keyboard.on('keydown-R', this.handleRestartKey, this);
    keyboard.on('keydown-ENTER', this.handleStartKey, this);
    keyboard.on('keydown-SPACE', this.handleStartKey, this);

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setRoundPixels(true);
    this.cameras.main.scrollX = 0;
  }

  private startGame(animate: boolean): void {
    if (this.gameStarted) {
      return;
    }

    this.gameStarted = true;
    this.runStartedAtMs = performance.now();
    this.titleStartButton.disableInteractive();
    this.updateStageAndObjective(true);
    this.updateHud(this.runStartedAtMs, true);

    if (!animate) {
      this.titleOverlay.setAlpha(0).setVisible(false);
      return;
    }

    this.tweens.killTweensOf(this.titleOverlay);
    this.tweens.add({
      targets: this.titleOverlay,
      alpha: 0,
      duration: 320,
      ease: 'Sine.Out',
      onComplete: () => this.titleOverlay.setVisible(false),
    });
  }

  private handleStartKey(): void {
    if (!this.gameStarted) {
      this.startGame(true);
    }
  }

  private updatePlayerMovement(nowMs: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    this.movementVector.set(0, 0);

    if (this.keys.left.isDown) {
      this.movementVector.x -= 1;
    }
    if (this.keys.right.isDown) {
      this.movementVector.x += 1;
    }
    if (this.keys.up.isDown) {
      this.movementVector.y -= 1;
    }
    if (this.keys.down.isDown) {
      this.movementVector.y += 1;
    }

    this.currentSpeed =
      nowMs < this.coffeeUntilMs
        ? GAME_CONFIG.playerBaseSpeed * GAME_CONFIG.coffeeSpeedMultiplier
        : GAME_CONFIG.playerBaseSpeed;

    if (nowMs < this.knockbackUntilMs) {
      body.setVelocity(this.knockbackVector.x, this.knockbackVector.y);
    } else if (this.movementVector.lengthSq() > 0) {
      this.movementVector.normalize().scale(this.currentSpeed);
      body.setVelocity(this.movementVector.x, this.movementVector.y);
      this.updatePlayerDirection(this.movementVector.x, this.movementVector.y);
    } else {
      body.setVelocity(0, 0);
    }

    this.playerIndicator.setPosition(this.player.x, this.player.y - 44);
  }

  private updatePlayerDirection(x: number, y: number): void {
    if (Math.abs(x) > Math.abs(y)) {
      this.playerIndicator.setRotation(x > 0 ? Math.PI / 2 : -Math.PI / 2);
    } else {
      this.playerIndicator.setRotation(y > 0 ? Math.PI : 0);
    }
  }

  private updateCrowd(deltaSeconds: number): void {
    for (const actor of this.crowd) {
      const targetX = actor.targetIsEnd ? actor.endX : actor.startX;
      const targetY = actor.targetIsEnd ? actor.endY : actor.startY;
      const dx = targetX - actor.sprite.x;
      const dy = targetY - actor.sprite.y;
      const distance = Math.hypot(dx, dy);
      const step = actor.speed * deltaSeconds;

      if (distance <= step || distance === 0) {
        actor.sprite.setPosition(targetX, targetY);
        actor.targetIsEnd = !actor.targetIsEnd;
      } else {
        actor.sprite.x += (dx / distance) * step;
        actor.sprite.y += (dy / distance) * step;
      }
    }

    if (this.subwayVillainActor && this.subwayVillainBadge) {
      this.subwayVillainBadge.setPosition(
        this.subwayVillainActor.sprite.x,
        this.subwayVillainActor.sprite.y - 49,
      );
    }
  }

  private checkCrowdContacts(nowMs: number): void {
    if (nowMs < this.invulnerableUntilMs) {
      return;
    }

    for (const actor of this.crowd) {
      if (this.overlaps(this.player, actor.sprite, 4, 2)) {
        this.applyCrowdHit(actor, nowMs);
        break;
      }
    }
  }

  private applyCrowdHit(actor: CrowdActor, nowMs: number): void {
    if (this.state !== GameState.Playing || nowMs < this.invulnerableUntilMs) {
      return;
    }

    this.mental = Math.max(0, this.mental - 1);
    this.invulnerableUntilMs = nowMs + GAME_CONFIG.hitCooldownMs;
    this.knockbackUntilMs = nowMs + GAME_CONFIG.hitKnockbackMs;

    let awayX = this.player.x - actor.sprite.x;
    let awayY = this.player.y - actor.sprite.y;
    if (Math.abs(awayX) + Math.abs(awayY) < 0.01) {
      awayX = -1;
      awayY = 0;
    }
    this.knockbackVector.set(awayX, awayY).normalize().scale(GAME_CONFIG.playerBaseSpeed * 1.45);

    this.showBossDialogue(nowMs);
    this.mentalText.setText(this.formatMentalText());

    if (this.mental <= 0) {
      this.transitionTo(GameState.MentalBreak);
    }
  }

  private showBossDialogue(nowMs: number): void {
    const isSubway = this.player.x < 1420;
    const lines = isSubway ? SUBWAY_VILLAIN_LINES : BOSS_LINES;
    const line = lines[Phaser.Math.Between(0, lines.length - 1)];
    this.bossNameText.setText(isSubway ? '지하철 빌런' : '꼰대 부장');
    this.bossDialogueText.setText(line);
    this.dialogueUntilMs = nowMs + 1_200;
    this.bossPanel.setVisible(true);
  }

  private hideBossDialogueIfExpired(nowMs: number): void {
    if (this.bossPanel.visible && nowMs >= this.dialogueUntilMs) {
      this.bossPanel.setVisible(false);
    }
  }

  private showPlayerDialogue(nowMs: number): void {
    const line = PLAYER_COFFEE_LINES[Phaser.Math.Between(0, PLAYER_COFFEE_LINES.length - 1)];
    this.playerDialogueText.setText(line).setVisible(true);
    this.playerDialogueUntilMs = nowMs + 1_300;
  }

  private showNotice(text: string, nowMs: number): void {
    this.noticeText.setText(text).setVisible(true);
    this.noticeUntilMs = nowMs + 1_800;
  }

  private hideTransientMessagesIfExpired(nowMs: number): void {
    if (this.playerDialogueText.visible && nowMs >= this.playerDialogueUntilMs) {
      this.playerDialogueText.setVisible(false);
    }
    if (this.noticeText.visible && nowMs >= this.noticeUntilMs) {
      this.noticeText.setVisible(false);
    }
  }

  private updateBlink(nowMs: number): void {
    if (nowMs >= this.invulnerableUntilMs) {
      this.player.setAlpha(1);
      return;
    }

    const blinkPhase = Math.floor((this.invulnerableUntilMs - nowMs) / 90);
    this.player.setAlpha(blinkPhase % 2 === 0 ? 0.25 : 1);
  }

  private updateBus(nowMs: number, deltaSeconds: number): void {
    if (this.stage === GameStage.Subway && !this.hasRiddenBus) {
      this.syncBusLabel();
      return;
    }

    if (this.busPhase === 'cooldown') {
      if (nowMs >= this.busRespawnAtMs) {
        this.spawnBus(this.nextBusKind);
      }
      return;
    }

    this.bus.x += GAME_CONFIG.busSpeed * deltaSeconds;
    this.syncBusLabel();

    if (this.state === GameState.Playing && !this.hasRiddenBus) {
      const inArrivalWindow =
        this.bus.x >= GAME_CONFIG.busStopMinX && this.bus.x <= GAME_CONFIG.busStopMaxX;

      if (
        this.busKind === 'red' &&
        !this.busArrivalResolved &&
        !this.fullBusMissed &&
        this.queueNpcCount >= 5 &&
        this.bus.x >= GAME_CONFIG.busStopMinX
      ) {
        this.busArrivalResolved = true;
        this.fullBusMissed = true;
        this.nextBusKind = 'red';
        this.clearQueueNpcs();
        this.showNotice('만원입니다! 다음 빨간 버스를 기다리세요.', nowMs);
      } else if (inArrivalWindow && !this.busArrivalResolved) {
        if (this.busKind === 'red' && this.isPlayerInBoardingZone('red')) {
          this.busArrivalResolved = true;
          this.beginBusRide();
        } else if (this.busKind !== 'red' && this.isPlayerInBoardingZone('wrong')) {
          this.busArrivalResolved = true;
          this.frozenElapsedSeconds = this.getElapsedSeconds(nowMs);
          this.transitionTo(GameState.WrongBus);
          return;
        }
      } else if (this.bus.x > GAME_CONFIG.busStopMaxX) {
        this.busArrivalResolved = true;
      }
    }

    if (this.state === GameState.RidingBus) {
      this.syncPlayerToBus();
      if (this.bus.x >= GAME_CONFIG.busDropOffX) {
        this.finishBusRide();
        return;
      }
    }

    if (this.bus.x >= GAME_CONFIG.busEndX) {
      this.startBusCooldown(nowMs);
    }
  }

  private isPlayerInBoardingZone(kind: 'red' | 'wrong'): boolean {
    const centerX = kind === 'red' ? RED_BOARDING_X : WRONG_BOARDING_X;
    return (
      Math.abs(this.player.x - centerX) <= BOARDING_WIDTH / 2 &&
      Math.abs(this.player.y - BOARDING_Y) <= BOARDING_HEIGHT / 2
    );
  }

  private beginBusRide(): void {
    if (this.state !== GameState.Playing) {
      return;
    }

    this.state = GameState.RidingBus;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.enable = false;
    this.player.setAlpha(1);
    this.bossPanel.setVisible(false);
    this.objective = '목표: 빨간 광역버스에 올라타세요.';
    this.objectiveText.setText(this.objective);
    this.updateStageProgress();
    this.syncPlayerToBus();
  }

  private syncPlayerToBus(): void {
    this.player.setPosition(this.bus.x + BUS_RIDER_OFFSET_X, this.bus.y + BUS_RIDER_OFFSET_Y);
    this.playerIndicator.setPosition(this.player.x, this.player.y - 44).setRotation(Math.PI / 2);
    this.syncBusLabel();
  }

  private finishBusRide(): void {
    this.hasRiddenBus = true;
    this.state = GameState.Playing;
    this.stage = GameStage.Lobby;
    const dropX = 3040;
    const dropY = 470;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(dropX, dropY);
    body.setVelocity(0, 0);
    this.player.setPosition(dropX, dropY).setAlpha(1);
    this.playerIndicator.setPosition(dropX, dropY - 44).setRotation(Math.PI / 2);
    this.startBusCooldown(performance.now());
    this.updateStageAndObjective(true);
  }

  private startBusCooldown(nowMs: number): void {
    this.busPhase = 'cooldown';
    this.busRespawnAtMs = nowMs + GAME_CONFIG.busRespawnIntervalMs;
    this.bus.setVisible(false);
    this.busDestinationText.setVisible(false);
    this.bus.setPosition(GAME_CONFIG.busSpawnX, BUS_Y);
  }

  private spawnBus(kind: BusKind): void {
    this.busKind = kind;
    this.nextBusKind = kind === 'red' ? (Math.random() < 0.5 ? 'blue' : 'green') : 'red';
    this.busArrivalResolved = false;
    this.busPhase = 'moving';
    this.bus
      .setTexture(`bus-${kind}`)
      .setPosition(GAME_CONFIG.busSpawnX, BUS_Y)
      .setVisible(true);
    this.busDestinationText
      .setText(kind === 'red' ? '강남 · 회사' : '반대 방향')
      .setColor('#ffffff')
      .setBackgroundColor(kind === 'red' ? '#7f1d1dee' : '#1e3a8aee')
      .setVisible(true);
    this.syncBusLabel();
  }

  private syncBusLabel(): void {
    this.busDestinationText.setPosition(this.bus.x, this.bus.y - 68).setVisible(this.bus.visible);
  }

  private clearQueueNpcs(): void {
    this.queueNpcs.forEach((npc) => npc.destroy());
    this.queueNpcs = [];
    this.queueNpcCount = 0;
  }

  private checkItemContacts(nowMs: number): void {
    if (!this.coffeeCollected && this.overlaps(this.player, this.coffee, 8, 8)) {
      this.collectCoffee(nowMs);
    }

    if (!this.resignationCollected && this.overlaps(this.player, this.resignation, 8, 8)) {
      this.collectResignation();
    }
  }

  private collectCoffee(nowMs: number): void {
    if (this.coffeeCollected || this.state !== GameState.Playing) {
      return;
    }

    this.coffeeCollected = true;
    this.coffee.setVisible(false).setActive(false);
    this.coffeeLabel.setVisible(false).setActive(false);
    this.coffeeUntilMs = nowMs + GAME_CONFIG.coffeeDurationMs;
    this.currentSpeed = GAME_CONFIG.playerBaseSpeed * GAME_CONFIG.coffeeSpeedMultiplier;
    this.showPlayerDialogue(nowMs);
  }

  private collectResignation(): void {
    if (this.resignationCollected || this.state !== GameState.Playing) {
      return;
    }

    this.resignationCollected = true;
    this.resignation.setVisible(false).setActive(false);
    this.transitionTo(GameState.Resigned);
  }

  private checkScannerContact(): void {
    if (
      this.hasRiddenBus &&
      this.state === GameState.Playing &&
      this.overlaps(this.player, this.scanner, 24, 28)
    ) {
      this.stage = GameStage.Fingerprint;
      this.frozenElapsedSeconds = this.getElapsedSeconds(performance.now());
      this.transitionTo(GameState.Cleared);
    }
  }

  private overlaps(
    first: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Size,
    second: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Size,
    paddingX: number,
    paddingY: number,
  ): boolean {
    const firstHalfWidth = first.displayWidth / 2;
    const firstHalfHeight = first.displayHeight / 2;
    const secondHalfWidth = second.displayWidth / 2;
    const secondHalfHeight = second.displayHeight / 2;

    return (
      Math.abs(first.x - second.x) <= firstHalfWidth + secondHalfWidth + paddingX &&
      Math.abs(first.y - second.y) <= firstHalfHeight + secondHalfHeight + paddingY
    );
  }

  private updateStageAndObjective(force = false): void {
    const previousStage = this.stage;

    if (!this.hasRiddenBus && this.player.x >= 1360) {
      this.stage = GameStage.Bus;
    } else if (this.hasRiddenBus && this.stage === GameStage.Bus) {
      this.stage = GameStage.Lobby;
    }

    if (
      this.hasRiddenBus &&
      this.stage === GameStage.Lobby &&
      this.player.x >= FINGERPRINT_STAGE_X
    ) {
      this.stage = GameStage.Fingerprint;
    }

    const objectives: Record<GameStage, string> = {
      [GameStage.Subway]: '목표: 지하철 출구로 이동하세요.',
      [GameStage.Bus]: '목표: 빨간 광역버스에 올라타세요.',
      [GameStage.Lobby]: '목표: 고장난 에스컬레이터를 우회하세요.',
      [GameStage.Fingerprint]: '목표: 지문 인식기로 이동하세요.',
    };
    const nextObjective = objectives[this.stage];

    if (force || nextObjective !== this.objective || previousStage !== this.stage) {
      this.objective = nextObjective;
      this.objectiveText?.setText(nextObjective).setAlpha(0.55);
      this.tweens.add({
        targets: this.objectiveText,
        alpha: 1,
        duration: 180,
        ease: 'Sine.Out',
      });
      this.updateStageProgress();
    }
  }

  private updateStageProgress(): void {
    if (this.stageTexts.length === 0) {
      return;
    }
    const orderedStages = [
      GameStage.Subway,
      GameStage.Bus,
      GameStage.Lobby,
      GameStage.Fingerprint,
    ];
    const labels = ['만원 지하철', '광역버스', '회사 로비', '지문 인식'];
    const currentIndex = orderedStages.indexOf(this.stage);

    this.stageTexts.forEach((text, index) => {
      const isComplete = this.state === GameState.Cleared || index < currentIndex;
      const isCurrent = index === currentIndex && this.state !== GameState.Cleared;
      const symbol = isComplete ? '✓' : isCurrent ? '●' : '○';
      text
        .setText(`${symbol} ${labels[index]}`)
        .setColor(isComplete ? '#86efac' : isCurrent ? '#facc15' : '#64748b');
    });
  }

  private updateHud(nowMs: number, force = false): void {
    const elapsedSeconds = Math.min(GAME_CONFIG.timeLimitSeconds, this.getElapsedSeconds(nowMs));
    const remainingSeconds = Math.max(0, Math.ceil(GAME_CONFIG.timeLimitSeconds - elapsedSeconds));

    if (force || remainingSeconds !== this.lastDisplayedClockSecond) {
      this.lastDisplayedClockSecond = remainingSeconds;
      this.clockText.setText(`출근까지 남은 시간 ${this.formatRemainingTime(remainingSeconds)}`);
    }

    const urgent = remainingSeconds <= 10;
    const critical = remainingSeconds <= 5;
    const pulse = urgent ? 0.86 + (Math.sin(nowMs / (critical ? 120 : 180)) + 1) * 0.07 : 1;
    this.clockText
      .setColor(urgent ? '#f87171' : '#f8fafc')
      .setAlpha(pulse)
      .setScale(critical ? 1.035 : 1);

    this.mentalText.setText(this.formatMentalText());

    const coffeeRemainingMs = Math.max(0, this.coffeeUntilMs - nowMs);
    if (coffeeRemainingMs > 0) {
      this.coffeeText.setText(`카페인 부스트 ${(coffeeRemainingMs / 1000).toFixed(1)}초`);
    } else {
      this.coffeeText.setText('카페인 부스트 없음');
      this.currentSpeed = GAME_CONFIG.playerBaseSpeed;
    }
  }

  private formatMentalText(): string {
    return `정신력 ${this.mental}/${GAME_CONFIG.maxMental} ${'■'.repeat(this.mental)}${'□'.repeat(
      GAME_CONFIG.maxMental - this.mental,
    )}`;
  }

  private formatRemainingTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }

  private getElapsedSeconds(nowMs: number): number {
    if (!this.gameStarted) {
      return 0;
    }
    if (isTerminalState(this.state)) {
      return this.frozenElapsedSeconds;
    }
    return Math.max(0, (nowMs - this.runStartedAtMs) / 1000);
  }

  private formatClock(elapsedSeconds: number): string {
    const absoluteSeconds = GAME_CONFIG.startClockSeconds + Math.floor(elapsedSeconds);
    const hours = Math.floor(absoluteSeconds / 3600) % 24;
    const minutes = Math.floor((absoluteSeconds % 3600) / 60);
    const seconds = absoluteSeconds % 60;
    return [hours, minutes, seconds].map((value) => value.toString().padStart(2, '0')).join(':');
  }

  private transitionTo(nextState: GameState): void {
    if (isTerminalState(this.state) || !isTerminalState(nextState)) {
      return;
    }

    this.state = nextState;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.enable = false;
    this.player.setAlpha(1);
    this.bossPanel.setVisible(false);
    this.playerDialogueText.setVisible(false);
    this.noticeText.setVisible(false);
    this.currentSpeed = GAME_CONFIG.playerBaseSpeed;
    this.coffeeUntilMs = 0;

    if (nextState === GameState.Late) {
      this.frozenElapsedSeconds = GAME_CONFIG.timeLimitSeconds;
      this.showResult(
        '지각!',
        '시말서 작성이 확정되었습니다.',
        '#ef4444',
        '09:00:00',
      );
    } else if (nextState === GameState.Cleared) {
      this.showResult(
        '출근 성공!',
        '오늘도 무사히 살아남았습니다.',
        '#22c55e',
        this.formatClock(this.frozenElapsedSeconds),
      );
    } else if (nextState === GameState.Resigned) {
      this.frozenElapsedSeconds = this.getElapsedSecondsBeforeTerminal();
      this.showResult(
        '사직 완료',
        '출근하지 않아도 됩니다.',
        '#f59e0b',
      );
    } else if (nextState === GameState.MentalBreak) {
      this.frozenElapsedSeconds = this.getElapsedSecondsBeforeTerminal();
      this.showResult('멘탈 퇴근', '정신력이 먼저 퇴근했습니다.', '#a855f7');
    } else if (nextState === GameState.WrongBus) {
      this.showResult(
        '경로를 이탈했습니다',
        '이 버스는 회사로 가지 않습니다.\n출근 실패',
        '#60a5fa',
      );
    }

    this.clockText.setText(
      `출근까지 남은 시간 ${this.formatRemainingTime(
        Math.max(0, Math.ceil(GAME_CONFIG.timeLimitSeconds - this.frozenElapsedSeconds)),
      )}`,
    );
    this.updateStageProgress();
  }

  private getElapsedSecondsBeforeTerminal(): number {
    return Math.max(0, (performance.now() - this.runStartedAtMs) / 1000);
  }

  private showResult(
    title: string,
    body: string,
    accentColor: string,
    timeText = '',
  ): void {
    const accent = Phaser.Display.Color.HexStringToColor(accentColor).color;
    this.resultPanel.setStrokeStyle(5, accent, 1);
    this.resultTitleText.setText(title).setColor(accentColor);
    this.resultTimeText.setText(timeText).setVisible(timeText.length > 0);
    this.resultBodyText.setText(body);
    this.resultOverlay.setVisible(true);
  }

  private installTestApi(): void {
    const api: CommuteRushTestApi = {
      snapshot: () => this.createSnapshot(),
      startGame: () => this.startGame(false),
      teleport: (x, y) => this.teleportPlayer(x, y),
      setElapsedSeconds: (seconds) => {
        this.runStartedAtMs = performance.now() - Math.max(0, seconds) * 1000;
      },
      summonBusAtStop: (kind = 'red') => {
        this.stage = GameStage.Bus;
        this.spawnBus(kind);
        this.bus.setPosition(GAME_CONFIG.busStopMinX + 25, BUS_Y).setVisible(true);
        this.busArrivalResolved = false;
        this.busRespawnAtMs = 0;
        this.selectBoardingZone(kind === 'red' ? 'red' : 'wrong');
        this.syncBusLabel();
      },
      selectBoardingZone: (kind) => this.selectBoardingZone(kind),
      setQueueNpcCount: (count) => this.setQueueNpcCount(count),
      forceBusArrival: () => {
        if (this.state === GameState.RidingBus) {
          this.bus.x = GAME_CONFIG.busDropOffX + 2;
          this.syncPlayerToBus();
        }
      },
      forceBusMiss: () => {
        if (this.state === GameState.Playing) {
          this.stage = GameStage.Bus;
          this.busPhase = 'moving';
          this.bus.setPosition(GAME_CONFIG.busEndX + 2, BUS_Y).setVisible(true);
          this.busDestinationText.setVisible(true);
        }
      },
      damageFromCrowd: (index = 0) => {
        const actor = this.crowd[Math.min(Math.max(index, 0), this.crowd.length - 1)];
        if (actor) {
          this.applyCrowdHit(actor, performance.now());
        }
      },
      crowdPosition: (index = 0) => {
        const actor = this.crowd[Math.min(Math.max(index, 0), this.crowd.length - 1)];
        return actor ? { x: actor.sprite.x, y: actor.sprite.y } : { x: 0, y: 0 };
      },
      collectCoffee: () => this.collectCoffee(performance.now()),
      collectResignation: () => this.collectResignation(),
      reachScanner: () => {
        this.hasRiddenBus = true;
        this.teleportPlayer(SCANNER_X, SCANNER_Y);
      },
      restartScene: () => this.restartPlayingScene(),
    };

    window.__COMMUTE_RUSH_TEST__ = api;
  }

  private createSnapshot(): GameSnapshot {
    const nowMs = performance.now();
    const elapsedSeconds = Math.min(
      GAME_CONFIG.timeLimitSeconds,
      this.getElapsedSeconds(nowMs),
    );

    return {
      state: this.state,
      stage: this.stage,
      gameStarted: this.gameStarted,
      titleVisible: this.titleOverlay.visible,
      elapsedSeconds,
      clockText: this.formatClock(elapsedSeconds),
      remainingTimeText: this.formatRemainingTime(
        Math.max(0, Math.ceil(GAME_CONFIG.timeLimitSeconds - elapsedSeconds)),
      ),
      countdownUrgent: GAME_CONFIG.timeLimitSeconds - elapsedSeconds <= 10,
      countdownColor:
        typeof this.clockText.style.color === 'string' ? this.clockText.style.color : '',
      mental: this.mental,
      currentSpeed: this.currentSpeed,
      coffeeRemainingSeconds: Math.max(0, this.coffeeUntilMs - nowMs) / 1000,
      playerX: this.player.x,
      playerY: this.player.y,
      busX: this.bus.x,
      busY: this.bus.y,
      busVisible: this.bus.visible,
      busKind: this.busKind,
      crowdCount: this.crowd.length,
      sceneCrowdCount: this.children.list.filter((child) => child.name === 'crowd-npc').length,
      backgroundCrowdCount: this.children.list.filter(
        (child) => child.name === 'background-crowd',
      ).length,
      subwayVillainVisible: this.subwayVillainBadge?.visible ?? false,
      sceneBusCount: this.children.list.filter((child) => child.name === 'commute-bus').length,
      objective: this.objective,
      coffeeVisible: this.coffee.visible,
      coffeeLabelVisible: this.coffeeLabel.visible,
      resignationVisible: this.resignation.visible,
      hasRiddenBus: this.hasRiddenBus,
      resultVisible: this.resultOverlay.visible,
      resultTitle: this.resultTitleText.text,
      resultTime: this.resultTimeText.text,
      resultBody: this.resultBodyText.text,
      dialogueVisible: this.bossPanel.visible,
      dialogueText: this.bossDialogueText.text,
      playerDialogueVisible: this.playerDialogueText.visible,
      queueNpcCount: this.queueNpcCount,
      sceneQueueNpcCount: this.children.list.filter((child) => child.name === 'queue-npc').length,
      fullBusMissed: this.fullBusMissed,
    };
  }

  private selectBoardingZone(kind: 'red' | 'wrong'): void {
    this.stage = GameStage.Bus;
    this.teleportPlayer(kind === 'red' ? RED_BOARDING_X : WRONG_BOARDING_X, BOARDING_Y);
    this.updateStageAndObjective(true);
  }

  private setQueueNpcCount(count: number): void {
    this.queueNpcs.forEach((npc) => npc.destroy());
    this.queueNpcs = [];
    this.queueNpcCount = Phaser.Math.Clamp(Math.floor(count), 0, 6);
    this.fullBusMissed = false;
    this.createQueueNpcs();
  }

  private teleportPlayer(x: number, y: number): void {
    if (isTerminalState(this.state)) {
      return;
    }
    const clampedX = Phaser.Math.Clamp(x, 32, GAME_CONFIG.worldWidth - 32);
    const clampedY = Phaser.Math.Clamp(
      y,
      GAME_CONFIG.playAreaTop + 32,
      GAME_CONFIG.playAreaBottom - 32,
    );
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (body.enable) {
      body.reset(clampedX, clampedY);
    }
    this.player.setPosition(clampedX, clampedY);
    this.playerIndicator.setPosition(clampedX, clampedY - 44);
  }

  private handleRestartKey(): void {
    if (isTerminalState(this.state)) {
      this.restartPlayingScene();
    }
  }

  private restartPlayingScene(): void {
    this.scene.restart({ autoStart: true });
  }

  private handleShutdown(): void {
    this.input.keyboard?.off('keydown-R', this.handleRestartKey, this);
    this.input.keyboard?.off('keydown-ENTER', this.handleStartKey, this);
    this.input.keyboard?.off('keydown-SPACE', this.handleStartKey, this);

    if (window.__COMMUTE_RUSH_TEST__) {
      delete window.__COMMUTE_RUSH_TEST__;
    }
  }
}
