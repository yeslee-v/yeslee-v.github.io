import {
  COLORS,
  DOOR_LEFT,
  DOOR_RIGHT,
  PLATFORM_BOTTOM,
  SAFE_ZONE_Y,
  TRAIN_FLOOR,
  TRAIN_TOP,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "./constants";
import { STAGES } from "./stageData";
import { FailureReason, GamePhase, type Npc, type Player } from "./types";
import type { Game } from "./game";

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    this.ctx = context;
  }

  render(game: Game): void {
    const ctx = this.ctx;
    ctx.save();
    const shakeAmount = game.shake > 0 ? game.shake * 7 : 0;
    ctx.translate((Math.random() - 0.5) * shakeAmount, (Math.random() - 0.5) * shakeAmount);
    this.drawBackground(game);
    this.drawCoffee(game);
    const actors = [...game.npcs.filter((npc) => npc.active), game.player].sort((a, b) => a.position.y - b.position.y);
    for (const actor of actors) actor === game.player ? this.drawPlayer(game.player) : this.drawNpc(actor as Npc);
    this.drawDoors(game);
    this.drawEffects(game);
    this.drawHud(game);
    this.drawOverlay(game);
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${game.flash * 4})`;
      ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    }
    ctx.restore();
  }

  private drawBackground(game: Game): void {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
    gradient.addColorStop(0, "#0c1720");
    gradient.addColorStop(1, "#24343d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    ctx.fillStyle = COLORS.train;
    this.roundRect(24, TRAIN_TOP, VIEW_WIDTH - 48, TRAIN_FLOOR - TRAIN_TOP + 8, 18);
    ctx.fill();
    ctx.fillStyle = "#a9bcc5";
    ctx.fillRect(24, TRAIN_TOP + 42, VIEW_WIDTH - 48, 9);
    ctx.fillStyle = "#cbd7dc";
    ctx.fillRect(44, TRAIN_TOP + 62, 340, 136);
    ctx.fillRect(576, TRAIN_TOP + 62, 340, 136);
    ctx.fillStyle = "#d8e1e4";
    ctx.fillRect(44, TRAIN_TOP + 207, 872, TRAIN_FLOOR - TRAIN_TOP - 212);
    ctx.fillStyle = "#78909c";
    for (let x = 70; x < 900; x += 132) ctx.fillRect(x, TRAIN_TOP + 8, 66, 8);

    ctx.fillStyle = COLORS.platform;
    ctx.fillRect(0, TRAIN_FLOOR + 8, VIEW_WIDTH, PLATFORM_BOTTOM - TRAIN_FLOOR);
    ctx.fillStyle = "#4b5b63";
    for (let y = TRAIN_FLOOR + 38; y < PLATFORM_BOTTOM; y += 44) ctx.fillRect(0, y, VIEW_WIDTH, 2);
    ctx.fillStyle = COLORS.yellow;
    ctx.fillRect(0, PLATFORM_BOTTOM - 28, VIEW_WIDTH, 10);
    ctx.fillStyle = "#1b292f";
    for (let x = 12; x < VIEW_WIDTH; x += 28) ctx.fillRect(x, PLATFORM_BOTTOM - 26, 13, 6);

    ctx.fillStyle = "#768991";
    ctx.fillRect(0, TRAIN_FLOOR, DOOR_LEFT, 10);
    ctx.fillRect(DOOR_RIGHT, TRAIN_FLOOR, VIEW_WIDTH - DOOR_RIGHT, 10);
    ctx.strokeStyle = game.timeRemaining <= 3 && game.phase === GamePhase.Playing ? COLORS.red : "#7bd7db";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(DOOR_LEFT, TRAIN_FLOOR + 10);
    ctx.lineTo(DOOR_RIGHT, TRAIN_FLOOR + 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(85,214,219,0.34)";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 8]);
    ctx.beginPath();
    ctx.moveTo(DOOR_LEFT + 8, SAFE_ZONE_Y);
    ctx.lineTo(DOOR_RIGHT - 8, SAFE_ZONE_Y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawDoors(game: Game): void {
    const ctx = this.ctx;
    const halfWidth = (DOOR_RIGHT - DOOR_LEFT) * 0.5 * game.doorProgress;
    if (halfWidth <= 0.5) {
      ctx.fillStyle = game.timeRemaining <= 3 && Math.floor(game.timeRemaining * 5) % 2 === 0 ? COLORS.red : "#5a717b";
      ctx.beginPath();
      ctx.arc(DOOR_LEFT - 18, TRAIN_TOP + 18, 6, 0, Math.PI * 2);
      ctx.arc(DOOR_RIGHT + 18, TRAIN_TOP + 18, 6, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.fillStyle = "#b8c7cd";
    ctx.strokeStyle = "#70858f";
    ctx.lineWidth = 4;
    ctx.fillRect(DOOR_LEFT, TRAIN_TOP + 50, halfWidth, TRAIN_FLOOR - TRAIN_TOP - 42);
    ctx.strokeRect(DOOR_LEFT, TRAIN_TOP + 50, halfWidth, TRAIN_FLOOR - TRAIN_TOP - 42);
    ctx.fillRect(DOOR_RIGHT - halfWidth, TRAIN_TOP + 50, halfWidth, TRAIN_FLOOR - TRAIN_TOP - 42);
    ctx.strokeRect(DOOR_RIGHT - halfWidth, TRAIN_TOP + 50, halfWidth, TRAIN_FLOOR - TRAIN_TOP - 42);
  }

  private drawPersonBase(
    x: number,
    y: number,
    radius: number,
    shirtColor: string,
    pantsColor: string,
    skinTone: string,
    squash: number,
    widthScale = 1,
    heightScale = 1,
    headScale = 1,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale((1 + squash * 0.55) * widthScale, (1 - squash * 0.45) * heightScale);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(0, radius * 0.85, radius * 0.85, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pantsColor;
    this.roundRect(-radius * 0.68, radius * 0.42, radius * 1.36, radius * 0.78, 6);
    ctx.fill();
    ctx.fillStyle = shirtColor;
    this.roundRect(-radius * 0.74, -radius * 0.08, radius * 1.48, radius * 0.78, 8);
    ctx.fill();
    ctx.fillStyle = skinTone;
    ctx.beginPath();
    ctx.arc(0, -radius * 0.6, radius * 0.5 * headScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#25333a";
    ctx.beginPath();
    ctx.arc(0, -radius * 0.71, radius * 0.49 * headScale, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawPlayer(player: Player): void {
    const ctx = this.ctx;
    if (player.caffeineTime > 0) {
      ctx.strokeStyle = `rgba(255,225,79,${0.55 + Math.sin(performance.now() * 0.02) * 0.25})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(player.position.x, player.position.y, 28 + Math.sin(performance.now() * 0.03) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.drawPersonBase(
      player.position.x,
      player.position.y,
      player.radius,
      player.caffeineTime > 0 ? "#f7b733" : COLORS.blue,
      "#244a88",
      "#efbb96",
      player.squash,
    );
    ctx.fillStyle = COLORS.white;
    ctx.font = "900 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("YOU", player.position.x, player.position.y + 8);
  }

  private drawNpc(npc: Npc): void {
    const color = npc.kind === "alighter" ? "#ef665b" : npc.kind === "rival" ? "#8d69d5" : `hsl(${npc.tint} 45% 46%)`;
    const pants = `hsl(${npc.pantsTint} 24% 27%)`;
    this.drawPersonBase(
      npc.position.x,
      npc.position.y,
      npc.radius,
      color,
      pants,
      npc.skinTone,
      npc.squash,
      npc.widthScale,
      npc.heightScale,
      npc.headScale,
    );
    const ctx = this.ctx;
    if (npc.kind === "backpack") {
      ctx.fillStyle = "#4b3428";
      this.roundRect(npc.position.x + npc.radius * 0.35, npc.position.y - 5, npc.radius * 0.92, npc.radius * 1.34, 8);
      ctx.fill();
      ctx.strokeStyle = "#241c17";
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (npc.kind === "alighter") {
      ctx.fillStyle = COLORS.white;
      ctx.font = "900 14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("↓", npc.position.x, npc.position.y + npc.radius + 15);
    } else if (npc.kind === "rival") {
      ctx.fillStyle = "#ffe9ff";
      ctx.font = "900 10px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("RUSH", npc.position.x, npc.position.y + 7);
    }
  }

  private drawCoffee(game: Game): void {
    if (!game.coffee || game.coffeeTaken) return;
    const ctx = this.ctx;
    const { x, y } = game.coffee;
    ctx.save();
    ctx.translate(x, y + Math.sin(performance.now() * 0.005) * 4);
    ctx.fillStyle = "rgba(255,218,75,0.18)";
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8b5533";
    this.roundRect(-12, -18, 24, 34, 5);
    ctx.fill();
    ctx.fillStyle = "#d9f7ff";
    ctx.fillRect(-11, -14, 22, 10);
    ctx.strokeStyle = "#f7e5d0";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(5, -18);
    ctx.lineTo(14, -35);
    ctx.stroke();
    ctx.fillStyle = COLORS.yellow;
    ctx.font = "900 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("COFFEE", 0, 34);
    ctx.restore();
  }

  private drawEffects(game: Game): void {
    const ctx = this.ctx;
    for (const impact of game.impacts) {
      const alpha = Math.min(1, impact.life * 5);
      const scale = (impact.strong ? 34 : 24) * (1.3 - impact.life);
      ctx.save();
      ctx.translate(impact.position.x, impact.position.y);
      ctx.rotate(performance.now() * 0.008);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = impact.color;
      ctx.beginPath();
      for (let point = 0; point < 16; point++) {
        const radius = point % 2 === 0 ? scale : scale * 0.42;
        const angle = point * Math.PI / 8;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (point === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    for (const burst of game.bursts) {
      ctx.globalAlpha = Math.min(1, burst.life * 4);
      ctx.fillStyle = burst.color;
      ctx.fillRect(burst.position.x - burst.size / 2, burst.position.y - burst.size / 2, burst.size, burst.size);
    }
    ctx.globalAlpha = 1;
    for (const text of game.texts) {
      ctx.globalAlpha = Math.min(1, text.life * 2.5);
      ctx.fillStyle = text.color;
      ctx.font = "900 24px system-ui";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(8,16,21,0.8)";
      ctx.textAlign = "center";
      ctx.strokeText(text.text, text.position.x, text.position.y - 34);
      ctx.fillText(text.text, text.position.x, text.position.y - 34);
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(game: Game): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(6,14,19,0.86)";
    this.roundRect(28, 24, 904, 64, 13);
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = "900 20px system-ui";
    ctx.fillText(`STAGE ${game.stageIndex + 1}`, 52, 56);
    ctx.fillStyle = "#9fb1ba";
    ctx.font = "700 14px system-ui";
    ctx.fillText(STAGES[game.stageIndex].name, 147, 57);
    ctx.textAlign = "center";
    ctx.fillStyle = game.timeRemaining <= 3 ? COLORS.red : COLORS.white;
    ctx.font = "900 25px system-ui";
    ctx.fillText(`문 닫힘까지 ${Math.ceil(game.timeRemaining).toString().padStart(2, "0")}`, 480, 56);
    ctx.textAlign = "right";
    ctx.font = "900 20px system-ui";
    for (let heart = 0; heart < 3; heart++) {
      ctx.fillStyle = heart < game.lives ? COLORS.red : "#42515a";
      ctx.fillText(heart < game.lives ? "♥" : "♡", 902 - (2 - heart) * 27, 56);
    }
    if (game.player.caffeineTime > 0) {
      ctx.textAlign = "right";
      ctx.fillStyle = COLORS.yellow;
      ctx.font = "900 14px system-ui";
      ctx.fillText(`☕ ${game.player.caffeineTime.toFixed(1)}s`, 755, 56);
    }
    if (game.timeRemaining <= 3 && game.phase === GamePhase.Playing) {
      const blink = Math.floor(performance.now() / 180) % 2 === 0;
      ctx.fillStyle = blink ? COLORS.red : "#5a2528";
      ctx.beginPath();
      ctx.arc(DOOR_LEFT - 20, TRAIN_TOP + 20, 8, 0, Math.PI * 2);
      ctx.arc(DOOR_RIGHT + 20, TRAIN_TOP + 20, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillStyle = COLORS.red;
      ctx.globalAlpha = 0.82;
      ctx.font = "900 58px system-ui";
      ctx.fillText(String(Math.max(1, Math.ceil(game.timeRemaining))), 480, 132);
      ctx.globalAlpha = 1;
    }
  }

  private drawOverlay(game: Game): void {
    const ctx = this.ctx;
    if (game.phase === GamePhase.Ready) {
      this.centerPanel();
      ctx.fillStyle = COLORS.yellow;
      ctx.font = "900 18px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(`STAGE ${game.stageIndex + 1}`, 480, 253);
      ctx.fillStyle = COLORS.white;
      ctx.font = "900 36px system-ui";
      ctx.fillText(STAGES[game.stageIndex].name, 480, 300);
      ctx.fillStyle = "#a9bac2";
      ctx.font = "700 16px system-ui";
      ctx.fillText("문이 열린다!", 480, 335);
    } else if (game.phase === GamePhase.Cleared) {
      this.centerPanel();
      ctx.fillStyle = "#55d6a7";
      ctx.font = "900 39px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("탑승 성공!", 480, 276);
      ctx.fillStyle = COLORS.white;
      ctx.font = "700 18px system-ui";
      ctx.fillText("안쪽까지 완전히 밀고 들어갔습니다.", 480, 316);
      ctx.fillStyle = COLORS.yellow;
      ctx.font = "800 15px system-ui";
      ctx.fillText(game.stageIndex < STAGES.length - 1 ? "SPACE 다음 스테이지  ·  R 다시 하기" : "SPACE 처음부터  ·  R 다시 하기", 480, 354);
    } else if (game.phase === GamePhase.GameOver) {
      this.centerPanel();
      ctx.fillStyle = COLORS.red;
      ctx.font = "900 38px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", 480, 270);
      ctx.fillStyle = COLORS.white;
      ctx.font = "700 18px system-ui";
      ctx.fillText("이번 열차도 실패.", 480, 313);
      ctx.fillStyle = COLORS.yellow;
      ctx.font = "800 16px system-ui";
      ctx.fillText("R 다시 시작", 480, 352);
    } else if (game.phase === GamePhase.Failed) {
      this.centerPanel();
      const lines = this.failureCopy(game.failureReason);
      ctx.fillStyle = COLORS.red;
      ctx.font = "900 35px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(lines[0], 480, 276);
      ctx.fillStyle = COLORS.white;
      ctx.font = "700 18px system-ui";
      ctx.fillText(lines[1], 480, 316);
      ctx.fillStyle = "#a9bac2";
      ctx.font = "800 15px system-ui";
      ctx.fillText(`남은 기회 ${game.lives}`, 480, 352);
    }

    if (game.phase === GamePhase.Playing && game.tutorialTime > 0) {
      const instruction = game.stageIndex === 0 ? "방향키 / WASD" : "SPACE";
      const subInstruction = game.stageIndex === 0 ? "움직이기" : "비집기";
      const panelY = Math.max(330, game.player.position.y - 115);
      ctx.fillStyle = "rgba(8,16,21,0.88)";
      this.roundRect(game.player.position.x - 95, panelY, 190, 67, 13);
      ctx.fill();
      ctx.fillStyle = COLORS.white;
      ctx.font = "900 19px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(instruction, game.player.position.x, panelY + 27);
      ctx.fillStyle = "#9fb1ba";
      ctx.font = "700 13px system-ui";
      ctx.fillText(subInstruction, game.player.position.x, panelY + 49);
    }
  }

  private centerPanel(): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(5,12,17,0.88)";
    this.roundRect(270, 210, 420, 180, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private failureCopy(reason?: FailureReason): [string, string] {
    if (reason === FailureReason.Stuck) return ["끼였다.", "조금만 더 들어갔어야 했다."];
    if (reason === FailureReason.PushedOut) return ["밀려났다.", "이번 열차도 안녕."];
    return ["문 닫힘.", "또 놓쳤다."];
  }

  private roundRect(x: number, y: number, width: number, height: number, radius: number): void {
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, width, height, radius);
  }
}
