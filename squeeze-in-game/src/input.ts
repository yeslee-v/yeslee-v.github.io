export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private pulseUntil = new Map<string, number>();

  constructor(target: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clear);
    target.addEventListener("pointerdown", () => target.focus());
  }

  get horizontal(): number {
    return Number(this.isDown("ArrowRight", "KeyD")) - Number(this.isDown("ArrowLeft", "KeyA"));
  }

  get vertical(): number {
    return Number(this.isDown("ArrowDown", "KeyS")) - Number(this.isDown("ArrowUp", "KeyW"));
  }

  consume(...codes: string[]): boolean {
    const found = codes.some((code) => this.pressed.has(code));
    codes.forEach((code) => this.pressed.delete(code));
    return found;
  }

  endFrame(): void {
    this.pressed.clear();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clear);
  }

  private isDown(...codes: string[]): boolean {
    const now = performance.now();
    return codes.some((code) => this.held.has(code) || (this.pulseUntil.get(code) ?? 0) > now);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    if (!event.repeat) this.pressed.add(event.code);
    this.held.add(event.code);
    this.pulseUntil.set(event.code, performance.now() + 105);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private clear = (): void => {
    this.held.clear();
    this.pressed.clear();
    this.pulseUntil.clear();
  };
}
