import Phaser from 'phaser';
import { COLORS, GAME_CONFIG } from './config';
import {
  GameState,
  isTerminalState,
  type CommuteRushTestApi,
  type CrowdActor,
  type GameSnapshot,
} from './types';

const BOSS_LINES = [
  '요즘 젊은 애들은 절박함이 없어.',
  '나 때는 지하철 문에 끼어서라도 출근했어.',
  '회사에 애정이 없으니까 늦는 거야.',
  '이 정도 출근길도 못 버티나?',
] as const;

const FONT_FAMILY = 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", Arial, sans-serif';
const PLAYER_START_X = 110;
const PLAYER_START_Y = 430;
const BUS_Y = 430;
const BUS_RIDER_OFFSET_X = -20;
const BUS_RIDER_OFFSET_Y = 82;
const COFFEE_X = 1110;
const COFFEE_Y = 235;
const RESIGNATION_X = 3240;
const RESIGNATION_Y = 180;
const SCANNER_X = 4090;
const SCANNER_Y = 330;

type BusPhase = 'moving' | 'cooldown';

export class GameScene extends Phaser.Scene {
  private state = GameState.Playing;
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerIndicator!: Phaser.GameObjects.Triangle;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private bus!: Phaser.GameObjects.Sprite;
  private coffee!: Phaser.GameObjects.Sprite;
  private resignation!: Phaser.GameObjects.Sprite;
  private scanner!: Phaser.GameObjects.Sprite;
  private crowd: CrowdActor[] = [];

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

  private objective = '';
  private clockText!: Phaser.GameObjects.Text;
  private mentalText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private coffeeText!: Phaser.GameObjects.Text;
  private bossPanel!: Phaser.GameObjects.Container;
  private bossDialogueText!: Phaser.GameObjects.Text;
  private resultOverlay!: Phaser.GameObjects.Container;
  private resultTitleText!: Phaser.GameObjects.Text;
  private resultBodyText!: Phaser.GameObjects.Text;

  public constructor() {
    super('GameScene');
  }

  public create(): void {
    this.resetRuntimeValues();
    this.createRuntimeTextures();
    this.createWorld();
    this.createPlayer();
    this.createCrowd();
    this.createBus();
    this.createItemsAndGoal();
    this.createHud();
    this.configureInputAndCamera();
    this.installTestApi();

    this.physics.add.collider(this.player, this.walls);
    this.runStartedAtMs = performance.now();
    this.updateObjective(true);
    this.updateHud(performance.now(), true);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
  }

  public update(_time: number, delta: number): void {
    const nowMs = performance.now();

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
      this.updateHud(nowMs);
      return;
    }

    this.updatePlayerMovement(nowMs);
    this.checkCrowdContacts(nowMs);
    this.checkItemContacts(nowMs);
    this.checkScannerContact();
    this.updateObjective();
    this.updateBlink(nowMs);
    this.hideBossDialogueIfExpired(nowMs);
    this.updateHud(nowMs);
  }

  private resetRuntimeValues(): void {
    this.state = GameState.Playing;
    this.crowd = [];
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
    this.objective = '';
    this.movementVector.set(0, 0);
    this.knockbackVector.set(0, 0);
  }

  private createRuntimeTextures(): void {
    this.createPixelTexture();
    this.createPersonTexture('player', 0x1e3a5f, 0xf8fafc, true);

    const crowdSuitColors = [
      0x7c3aed,
      0xbe123c,
      0x0369a1,
      0x4d7c0f,
      0x9a3412,
      0x4338ca,
      0x0f766e,
      0x6b7280,
      0xa21caf,
      0x92400e,
    ];
    crowdSuitColors.forEach((color, index) => {
      this.createPersonTexture(`crowd-${index}`, color, 0xf2d3b1, false, index % 3);
    });

    this.createBusTexture();
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

    if (isPlayer) {
      graphics.lineStyle(2, 0xfacc15, 1);
      graphics.strokeRoundedRect(4, 2, width - 8, height - 4, 7);
    }

    graphics.generateTexture(key, width, height);
    graphics.destroy();
  }

  private createBusTexture(): void {
    if (this.textures.exists('bus')) {
      return;
    }

    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0x0f172a, 0.25);
    graphics.fillRoundedRect(8, 9, 292, 102, 18);
    graphics.fillStyle(0x2563eb, 1);
    graphics.fillRoundedRect(0, 0, 292, 102, 16);
    graphics.fillStyle(0x60a5fa, 1);
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
    graphics.generateTexture('bus', 304, 116);
    graphics.destroy();
  }

  private createCoffeeTexture(): void {
    if (this.textures.exists('coffee')) {
      return;
    }

    const graphics = this.add.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0x0f172a, 0.2);
    graphics.fillEllipse(24, 50, 38, 8);
    graphics.fillStyle(0xe0f2fe, 1);
    graphics.fillRoundedRect(8, 8, 32, 40, 5);
    graphics.fillStyle(0x7c2d12, 1);
    graphics.fillRect(11, 17, 26, 27);
    graphics.fillStyle(0xf8fafc, 1);
    graphics.fillRect(5, 4, 38, 8);
    graphics.fillStyle(0x111827, 1);
    graphics.fillRect(29, 0, 4, 18);
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
    this.addWall(GAME_CONFIG.worldWidth / 2, 112, GAME_CONFIG.worldWidth, 24, COLORS.wall);
    this.addWall(GAME_CONFIG.worldWidth / 2, 712, GAME_CONFIG.worldWidth, 24, COLORS.wall);

    this.addWall(445, 255, 180, 64, 0x3d4b5f);
    this.addWall(730, 555, 210, 58, 0x3d4b5f);
    this.addWall(1015, 380, 118, 148, 0x3d4b5f);
    this.addWall(1300, 230, 100, 120, 0x3d4b5f);

    this.addWall(2110, 410, 82, 596, 0x991b1b);
    this.addWall(3545, 340, 360, 360, 0x475569);
    this.addWall(3890, 540, 72, 220, 0x475569);
  }

  private createSubwayVisuals(): void {
    this.add.rectangle(0, 124, 1420, 18, COLORS.platformStripe).setOrigin(0, 0).setDepth(-5);

    for (let x = 70; x < 1400; x += 150) {
      this.add.rectangle(x, 648, 90, 14, 0x94a3b8, 0.55).setDepth(-5);
    }

    this.addSectionTitle(70, 156, '1  만원 지하철 탈출');
    this.addWorldLabel(95, 610, '출발 지점', 0x0f172a);
    this.addWorldLabel(1260, 615, '지하철 출구 →', 0x0f172a);

    const pillarLocations = [
      { x: 445, y: 255, label: '기둥' },
      { x: 730, y: 555, label: '벤치' },
      { x: 1015, y: 380, label: '환승 안내' },
      { x: 1300, y: 230, label: '개찰구' },
    ];

    pillarLocations.forEach(({ x, y, label }) => {
      this.addWorldLabel(x, y, label, 0xf8fafc).setOrigin(0.5);
    });
  }

  private createRoadAndStopVisuals(): void {
    this.add.rectangle(1420, 124, 600, 580, 0xcbd5e1).setOrigin(0, 0).setDepth(-12);
    this.add.rectangle(2020, 124, 900, 580, COLORS.road).setOrigin(0, 0).setDepth(-12);

    for (let x = 2060; x < 2920; x += 145) {
      this.add.rectangle(x, 405, 82, 9, COLORS.roadLine, 0.8).setDepth(-6);
    }

    this.add.rectangle(1690, 300, 310, 260, 0x38bdf8, 0.15).setStrokeStyle(4, 0x0284c7, 0.8);
    this.add.rectangle(1630, 238, 18, 150, 0x334155);
    this.add.rectangle(1665, 225, 100, 52, 0x2563eb).setStrokeStyle(3, 0xffffff);
    this.addWorldLabel(1665, 225, '광역버스', 0xffffff).setOrigin(0.5);
    this.addWorldLabel(1835, 278, '대기 구역', 0x0f172a).setOrigin(0.5);
    this.addWorldLabel(2110, 180, '도로 횡단 금지\n버스를 타세요', 0xffffff).setOrigin(0.5);
    this.addWorldLabel(2600, 650, '버스 전용 도로', 0xffffff).setOrigin(0.5);
    this.addSectionTitle(1460, 156, '2  달리는 광역버스 탑승');
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
    this.addWorldLabel(3545, 535, '에스컬레이터', 0xf8fafc).setOrigin(0.5).setDepth(3);

    this.add.rectangle(3545, 624, 390, 110, 0x9ca3af).setStrokeStyle(4, 0x475569);
    for (let x = 3390; x <= 3700; x += 35) {
      this.add.rectangle(x, 624, 20, 82, 0xd1d5db);
    }
    this.addWorldLabel(3545, 624, '계단 우회로', 0x111827).setOrigin(0.5).setDepth(3);
    this.addWorldLabel(4015, 205, '출근 게이트', 0x111827).setOrigin(0.5);
  }

  private addWall(x: number, y: number, width: number, height: number, tint: number): void {
    const wall = this.physics.add.staticImage(x, y, 'pixel');
    wall.setDisplaySize(width, height);
    wall.setTint(tint);
    wall.setDepth(0);
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
  ): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        fontStyle: 'bold',
        color: Phaser.Display.Color.IntegerToColor(color).rgba,
        align: 'center',
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
      const sprite = this.add.sprite(startX, startY, `crowd-${index}`);
      sprite.setName('crowd-npc');
      sprite.setDepth(20 + (startY % 5));
      sprite.setScale(0.9 + (index % 3) * 0.06);

      this.crowd.push({
        sprite,
        startX,
        startY,
        endX,
        endY,
        targetIsEnd: true,
        speed: GAME_CONFIG.crowdSpeed + (index % 4) * 8,
      });
    });
  }

  private createBus(): void {
    this.bus = this.add.sprite(GAME_CONFIG.busSpawnX, BUS_Y, 'bus');
    this.bus.setName('commute-bus');
    this.bus.setDepth(25);
  }

  private createItemsAndGoal(): void {
    this.coffee = this.add.sprite(COFFEE_X, COFFEE_Y, 'coffee').setDepth(22);
    this.coffee.setName('coffee-item');
    this.addWorldLabel(COFFEE_X, COFFEE_Y + 46, '아이스 아메리카노', 0x111827).setOrigin(0.5);

    this.resignation = this.add.sprite(RESIGNATION_X, RESIGNATION_Y, 'resignation').setDepth(22);
    this.resignation.setName('resignation-item');
    this.addWorldLabel(RESIGNATION_X, RESIGNATION_Y + 42, '사직서', 0x991b1b).setOrigin(0.5);

    this.scanner = this.add.sprite(SCANNER_X, SCANNER_Y, 'scanner').setDepth(22);
    this.scanner.setName('fingerprint-scanner');
    this.addWorldLabel(SCANNER_X, SCANNER_Y + 70, '지문 인식기', 0x111827).setOrigin(0.5);
  }

  private createHud(): void {
    const hudBackground = this.add
      .rectangle(0, 0, GAME_CONFIG.width, 112, COLORS.hud, 0.96)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(500);
    hudBackground.setStrokeStyle(2, COLORS.hudAccent, 0.55);

    this.clockText = this.addFixedText(24, 16, '', 25, '#f8fafc', 'bold');
    this.mentalText = this.addFixedText(310, 16, '', 25, '#fca5a5', 'bold');
    this.objectiveText = this.addFixedText(545, 17, '', 22, '#bae6fd', 'bold');
    this.coffeeText = this.addFixedText(24, 66, '카페인 부스트 없음', 20, '#fde68a');
    this.addFixedText(1085, 70, 'WASD 이동', 17, '#cbd5e1');

    this.bossPanel = this.createBossPanel();
    this.resultOverlay = this.createResultOverlay();
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
    const nameTag = this.add.text(108, 18, '꼰대 부장', {
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
        nameTag,
        this.bossDialogueText,
      ])
      .setScrollFactor(0)
      .setDepth(700)
      .setVisible(false);
  }

  private createResultOverlay(): Phaser.GameObjects.Container {
    const backdrop = this.add
      .rectangle(0, 0, GAME_CONFIG.width, GAME_CONFIG.height, 0x020617, 0.86)
      .setOrigin(0, 0);
    const panel = this.add
      .rectangle(GAME_CONFIG.width / 2, GAME_CONFIG.height / 2, 760, 390, 0x0f172a, 0.98)
      .setStrokeStyle(5, 0x38bdf8, 1);
    this.resultTitleText = this.add
      .text(GAME_CONFIG.width / 2, 280, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '48px',
        fontStyle: 'bold',
        color: '#f8fafc',
        align: 'center',
      })
      .setOrigin(0.5);
    this.resultBodyText = this.add
      .text(GAME_CONFIG.width / 2, 385, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '30px',
        color: '#dbeafe',
        align: 'center',
        lineSpacing: 12,
      })
      .setOrigin(0.5);
    const restartText = this.add
      .text(GAME_CONFIG.width / 2, 512, 'R 키로 다시 출근하기', {
        fontFamily: FONT_FAMILY,
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#fde68a',
      })
      .setOrigin(0.5);

    return this.add
      .container(0, 0, [backdrop, panel, this.resultTitleText, this.resultBodyText, restartText])
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

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setRoundPixels(true);
    this.cameras.main.scrollX = 0;
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
    const line = BOSS_LINES[Phaser.Math.Between(0, BOSS_LINES.length - 1)];
    this.bossDialogueText.setText(line);
    this.dialogueUntilMs = nowMs + 1_200;
    this.bossPanel.setVisible(true);
  }

  private hideBossDialogueIfExpired(nowMs: number): void {
    if (this.bossPanel.visible && nowMs >= this.dialogueUntilMs) {
      this.bossPanel.setVisible(false);
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
    if (this.busPhase === 'cooldown') {
      if (nowMs >= this.busRespawnAtMs) {
        this.busPhase = 'moving';
        this.bus.setPosition(GAME_CONFIG.busSpawnX, BUS_Y).setVisible(true);
      }
      return;
    }

    this.bus.x += GAME_CONFIG.busSpeed * deltaSeconds;

    if (this.state === GameState.Playing && this.canBoardBus()) {
      this.beginBusRide();
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

  private canBoardBus(): boolean {
    return (
      !this.hasRiddenBus &&
      this.bus.visible &&
      this.bus.x >= GAME_CONFIG.busStopMinX &&
      this.bus.x <= GAME_CONFIG.busStopMaxX &&
      Math.abs(this.player.x - this.bus.x) <= 190 &&
      Math.abs(this.player.y - this.bus.y) <= 104
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
    this.objective = '목표: 광역버스로 회사까지 이동 중입니다.';
    this.objectiveText.setText(this.objective);
    this.syncPlayerToBus();
  }

  private syncPlayerToBus(): void {
    this.player.setPosition(this.bus.x + BUS_RIDER_OFFSET_X, this.bus.y + BUS_RIDER_OFFSET_Y);
    this.playerIndicator.setPosition(this.player.x, this.player.y - 44).setRotation(Math.PI / 2);
  }

  private finishBusRide(): void {
    this.hasRiddenBus = true;
    this.state = GameState.Playing;
    const dropX = GAME_CONFIG.busDropOffX + 45;
    const dropY = 470;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(dropX, dropY);
    body.setVelocity(0, 0);
    this.player.setPosition(dropX, dropY).setAlpha(1);
    this.playerIndicator.setPosition(dropX, dropY - 44).setRotation(Math.PI / 2);
    this.startBusCooldown(performance.now());
    this.updateObjective(true);
  }

  private startBusCooldown(nowMs: number): void {
    this.busPhase = 'cooldown';
    this.busRespawnAtMs = nowMs + GAME_CONFIG.busRespawnIntervalMs;
    this.bus.setVisible(false);
    this.bus.setPosition(GAME_CONFIG.busSpawnX, BUS_Y);
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
    this.coffeeUntilMs = nowMs + GAME_CONFIG.coffeeDurationMs;
    this.currentSpeed = GAME_CONFIG.playerBaseSpeed * GAME_CONFIG.coffeeSpeedMultiplier;
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

  private updateObjective(force = false): void {
    let nextObjective: string;

    if (this.state === GameState.RidingBus) {
      nextObjective = '목표: 광역버스로 회사까지 이동 중입니다.';
    } else if (this.hasRiddenBus) {
      nextObjective = '목표: 회사 지문 인식기로 이동하세요.';
    } else if (this.player.x >= 1360) {
      nextObjective = '목표: 광역버스에 올라타세요.';
    } else {
      nextObjective = '목표: 지하철 출구로 이동하세요.';
    }

    if (force || nextObjective !== this.objective) {
      this.objective = nextObjective;
      this.objectiveText?.setText(nextObjective);
    }
  }

  private updateHud(nowMs: number, force = false): void {
    const clockSecond = Math.min(
      GAME_CONFIG.timeLimitSeconds,
      Math.floor(this.getElapsedSeconds(nowMs)),
    );

    if (force || clockSecond !== this.lastDisplayedClockSecond) {
      this.lastDisplayedClockSecond = clockSecond;
      this.clockText.setText(`출근 시각 ${this.formatClock(clockSecond)}`);
    }

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

  private getElapsedSeconds(nowMs: number): number {
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

    if (nextState === GameState.Late) {
      this.frozenElapsedSeconds = GAME_CONFIG.timeLimitSeconds;
      this.showResult(
        '09:00:00 지각',
        '시말서 작성이 확정되었습니다.',
        '#ef4444',
      );
    } else if (nextState === GameState.Cleared) {
      this.showResult(
        `${this.formatClock(this.frozenElapsedSeconds)} 출근 성공`,
        '오늘도 퇴사는 미뤄졌습니다.',
        '#22c55e',
      );
    } else if (nextState === GameState.Resigned) {
      this.frozenElapsedSeconds = this.getElapsedSecondsBeforeTerminal();
      this.showResult(
        '사직서 제출 완료',
        '축하합니다.\n모든 출근 장애물에 영구 면역이 되었습니다.',
        '#f59e0b',
      );
    } else if (nextState === GameState.MentalBreak) {
      this.frozenElapsedSeconds = this.getElapsedSecondsBeforeTerminal();
      this.showResult('멘탈이 먼저 퇴근했습니다.', '출근 실패', '#a855f7');
    }

    this.clockText.setText(`출근 시각 ${this.formatClock(this.frozenElapsedSeconds)}`);
  }

  private getElapsedSecondsBeforeTerminal(): number {
    return Math.max(0, (performance.now() - this.runStartedAtMs) / 1000);
  }

  private showResult(title: string, body: string, accentColor: string): void {
    this.resultTitleText.setText(title).setColor(accentColor);
    this.resultBodyText.setText(body);
    this.resultOverlay.setVisible(true);
  }

  private installTestApi(): void {
    const api: CommuteRushTestApi = {
      snapshot: () => this.createSnapshot(),
      teleport: (x, y) => this.teleportPlayer(x, y),
      setElapsedSeconds: (seconds) => {
        this.runStartedAtMs = performance.now() - Math.max(0, seconds) * 1000;
      },
      summonBusAtStop: () => {
        this.busPhase = 'moving';
        this.bus.setPosition(1775, BUS_Y).setVisible(true);
        this.busRespawnAtMs = 0;
        this.teleportPlayer(1775, BUS_Y + 90);
      },
      forceBusArrival: () => {
        if (this.state === GameState.RidingBus) {
          this.bus.x = GAME_CONFIG.busDropOffX + 2;
          this.syncPlayerToBus();
        }
      },
      forceBusMiss: () => {
        if (this.state === GameState.Playing) {
          this.busPhase = 'moving';
          this.bus.setPosition(GAME_CONFIG.busEndX + 2, BUS_Y).setVisible(true);
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
      restartScene: () => this.scene.restart(),
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
      elapsedSeconds,
      clockText: this.formatClock(elapsedSeconds),
      mental: this.mental,
      currentSpeed: this.currentSpeed,
      coffeeRemainingSeconds: Math.max(0, this.coffeeUntilMs - nowMs) / 1000,
      playerX: this.player.x,
      playerY: this.player.y,
      busX: this.bus.x,
      busY: this.bus.y,
      busVisible: this.bus.visible,
      crowdCount: this.crowd.length,
      sceneCrowdCount: this.children.list.filter((child) => child.name === 'crowd-npc').length,
      sceneBusCount: this.children.list.filter((child) => child.name === 'commute-bus').length,
      objective: this.objective,
      coffeeVisible: this.coffee.visible,
      resignationVisible: this.resignation.visible,
      hasRiddenBus: this.hasRiddenBus,
      resultVisible: this.resultOverlay.visible,
      dialogueVisible: this.bossPanel.visible,
      dialogueText: this.bossDialogueText.text,
    };
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
      this.scene.restart();
    }
  }

  private handleShutdown(): void {
    this.input.keyboard?.off('keydown-R', this.handleRestartKey, this);

    if (window.__COMMUTE_RUSH_TEST__) {
      delete window.__COMMUTE_RUSH_TEST__;
    }
  }
}
