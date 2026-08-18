import "./style.css";
import { Game } from "./game";
import { Input } from "./input";
import { Renderer } from "./renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("Game canvas was not found");

const input = new Input(canvas);
const game = new Game(input);
const renderer = new Renderer(canvas);
let lastTime = performance.now();

const frame = (now: number): void => {
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  game.update(dt);
  renderer.render(game);
  const snapshot = game.getSnapshot();
  canvas.dataset.stage = String(snapshot.stage);
  canvas.dataset.phase = snapshot.phase;
  canvas.dataset.time = String(snapshot.timeRemaining);
  canvas.dataset.playerX = String(snapshot.player.x);
  canvas.dataset.playerY = String(snapshot.player.y);
  canvas.dataset.caffeine = String(snapshot.caffeineTime);
  canvas.dataset.failure = snapshot.failureReason ?? "";
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
    };
  }
}

window.__SQUEEZE_DEBUG__ = {
  snapshot: () => game.getSnapshot(),
  loadStage: (stage: number) => game.loadStage(stage - 1),
  restart: () => game.loadStage(game.stageIndex),
};

window.addEventListener("beforeunload", () => input.destroy(), { once: true });
