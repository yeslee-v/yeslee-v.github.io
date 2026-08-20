import "./style.css";
import { Game } from "./game";
import { Input } from "./input";
import { Renderer } from "./renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("Game canvas was not found");

const input = new Input(canvas);
const game = new Game(input);
const renderer = new Renderer(canvas);
const requestedStage = Number(new URLSearchParams(window.location.search).get("stage"));
if (Number.isInteger(requestedStage) && requestedStage >= 1 && requestedStage <= 5) game.loadStage(requestedStage - 1);
let lastTime = performance.now();

const frame = (now: number): void => {
  let remainingTime = Math.min((now - lastTime) / 1000, 1);
  lastTime = now;
  while (remainingTime > 0) {
    const step = Math.min(remainingTime, 1 / 30);
    game.update(step);
    remainingTime -= step;
  }
  renderer.render(game);
  const snapshot = game.getSnapshot();
  canvas.dataset.stage = String(snapshot.stage);
  canvas.dataset.phase = snapshot.phase;
  canvas.dataset.time = String(snapshot.timeRemaining);
  canvas.dataset.playerX = String(snapshot.player.x);
  canvas.dataset.playerY = String(snapshot.player.y);
  canvas.dataset.caffeine = String(snapshot.caffeineTime);
  canvas.dataset.failure = snapshot.failureReason ?? "";
  canvas.dataset.lives = String(snapshot.lives);
  canvas.dataset.door = String(snapshot.doorProgress);
  canvas.dataset.hitStop = String(snapshot.hitStop);
  canvas.dataset.wallViolations = String(snapshot.wallViolations);
  canvas.dataset.chainHits = String(snapshot.lastChainCount);
  canvas.dataset.pressureContacts = String(snapshot.pressureContacts);
  canvas.dataset.bodyCounts = Object.entries(snapshot.bodyCounts).map(([body, count]) => `${body}:${count}`).join(",");
  canvas.dataset.lastResult = snapshot.lastAttemptResult;
  requestAnimationFrame(frame);
};

canvas.focus();
requestAnimationFrame(frame);

declare global {
  interface Window {
    __SQUEEZE_DEBUG__: {
      snapshot: () => ReturnType<Game["getSnapshot"]>;
      loadStage: (stage: number) => void;
      restart: () => void;
      newGame: () => void;
    };
  }
}

window.__SQUEEZE_DEBUG__ = {
  snapshot: () => game.getSnapshot(),
  loadStage: (stage: number) => game.loadStage(stage - 1),
  restart: () => game.loadStage(game.stageIndex),
  newGame: () => game.startNewGame(),
};

window.addEventListener("beforeunload", () => input.destroy(), { once: true });
