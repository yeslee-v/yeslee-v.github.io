import { expect, test, type Page } from '@playwright/test';

type Snapshot = ReturnType<NonNullable<Window['__COMMUTE_RUSH_TEST__']>['snapshot']>;

async function waitForGame(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__COMMUTE_RUSH_TEST__));
  await expect(page.locator('canvas')).toBeVisible();
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const api = window.__COMMUTE_RUSH_TEST__;
    if (!api) {
      throw new Error('Test API is not ready.');
    }
    return api.snapshot();
  });
}

async function invoke(page: Page, method: keyof NonNullable<Window['__COMMUTE_RUSH_TEST__']>): Promise<void> {
  await page.evaluate((methodName) => {
    const api = window.__COMMUTE_RUSH_TEST__;
    if (!api) {
      throw new Error('Test API is not ready.');
    }
    const candidate = api[methodName];
    if (typeof candidate !== 'function') {
      throw new Error(`Unknown test API method: ${String(methodName)}`);
    }
    (candidate as () => void)();
  }, method);
}

async function expectNoRuntimeErrors(page: Page, runtimeErrors: string[]): Promise<void> {
  await page.waitForTimeout(100);
  expect(runtimeErrors).toEqual([]);
}

function collectRuntimeErrors(page: Page): string[] {
  const runtimeErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      runtimeErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  return runtimeErrors;
}

test('성공 루프: 이동 → 버스 탑승/하차 → 지문 인식 → R 재시작', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);

  const initial = await snapshot(page);
  expect(initial.state).toBe('Playing');
  expect(initial.mental).toBe(5);
  expect(initial.crowdCount).toBe(10);
  expect(initial.sceneCrowdCount).toBe(10);
  expect(initial.sceneBusCount).toBe(1);

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(250);
  await page.keyboard.up('KeyD');
  expect((await snapshot(page)).playerX).toBeGreaterThan(initial.playerX + 25);

  await invoke(page, 'summonBusAtStop');
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'RidingBus');
  const ridingBefore = await snapshot(page);
  const initialOffset = ridingBefore.playerX - ridingBefore.busX;

  await page.keyboard.down('KeyA');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyA');
  const ridingAfter = await snapshot(page);
  expect(ridingAfter.state).toBe('RidingBus');
  expect(ridingAfter.playerX - ridingAfter.busX).toBeCloseTo(initialOffset, 1);
  expect(ridingAfter.busX).toBeGreaterThan(ridingBefore.busX);

  await invoke(page, 'forceBusArrival');
  await page.waitForFunction(() => {
    const state = window.__COMMUTE_RUSH_TEST__?.snapshot();
    return state?.state === 'Playing' && state.hasRiddenBus;
  });

  await invoke(page, 'reachScanner');
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'Cleared');
  const cleared = await snapshot(page);
  expect(cleared.resultVisible).toBe(true);
  expect(cleared.clockText).not.toBe('09:00:00');

  const frozenX = cleared.playerX;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(220);
  await page.keyboard.up('KeyD');
  expect((await snapshot(page)).playerX).toBeCloseTo(frozenX, 2);

  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => {
    const state = window.__COMMUTE_RUSH_TEST__?.snapshot();
    return state?.state === 'Playing' && state.elapsedSeconds < 1;
  });
  const restarted = await snapshot(page);
  expect(restarted.mental).toBe(5);
  expect(restarted.currentSpeed).toBe(230);
  expect(restarted.coffeeVisible).toBe(true);
  expect(restarted.resignationVisible).toBe(true);
  expect(restarted.sceneCrowdCount).toBe(10);
  expect(restarted.sceneBusCount).toBe(1);

  await expectNoRuntimeErrors(page, runtimeErrors);
});

test('지각: 실제 경과시간 기준 09:00:00 즉시 종료 및 이동 중단', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);

  await page.evaluate(() => window.__COMMUTE_RUSH_TEST__?.setElapsedSeconds(89.95));
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'Late');

  const late = await snapshot(page);
  expect(late.clockText).toBe('09:00:00');
  expect(late.resultVisible).toBe(true);

  const frozenX = late.playerX;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(200);
  await page.keyboard.up('KeyD');
  expect((await snapshot(page)).playerX).toBeCloseTo(frozenX, 2);

  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'Playing');
  await expectNoRuntimeErrors(page, runtimeErrors);
});

test('정신력: 800ms 재피격 방지, 단일 대사, 0에서 MentalBreak', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);

  await invoke(page, 'damageFromCrowd');
  let current = await snapshot(page);
  expect(current.mental).toBe(4);
  expect(current.dialogueVisible).toBe(true);
  expect(current.dialogueText.length).toBeGreaterThan(0);

  await invoke(page, 'damageFromCrowd');
  expect((await snapshot(page)).mental).toBe(4);

  for (let expectedMental = 3; expectedMental >= 0; expectedMental -= 1) {
    await page.waitForTimeout(830);
    await invoke(page, 'damageFromCrowd');
    current = await snapshot(page);
    expect(current.mental).toBe(expectedMental);
  }

  expect(current.state).toBe('MentalBreak');
  expect(current.resultVisible).toBe(true);

  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'Playing');
  expect((await snapshot(page)).mental).toBe(5);
  await expectNoRuntimeErrors(page, runtimeErrors);
});

test('커피: 35% 가속, HUD 카운트다운, 5초 후 정확한 기본 속도 복구', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);

  await invoke(page, 'collectCoffee');
  const boosted = await snapshot(page);
  expect(boosted.coffeeVisible).toBe(false);
  expect(boosted.currentSpeed).toBeCloseTo(230 * 1.35, 4);
  expect(boosted.coffeeRemainingSeconds).toBeGreaterThan(4.7);
  expect(boosted.coffeeRemainingSeconds).toBeLessThanOrEqual(5);

  await page.waitForTimeout(5_150);
  const restored = await snapshot(page);
  expect(restored.coffeeRemainingSeconds).toBe(0);
  expect(restored.currentSpeed).toBe(230);

  await invoke(page, 'restartScene');
  await page.waitForFunction(() => {
    const state = window.__COMMUTE_RUSH_TEST__?.snapshot();
    return state?.state === 'Playing' && state.coffeeVisible;
  });
  const restarted = await snapshot(page);
  expect(restarted.currentSpeed).toBe(230);
  expect(restarted.coffeeRemainingSeconds).toBe(0);
  await expectNoRuntimeErrors(page, runtimeErrors);
});

test('버스: 놓치면 재등장, 자동 탑승, 좌표 동기화, 자동 하차', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);

  await invoke(page, 'forceBusMiss');
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().busVisible === false);
  await page.waitForFunction(
    () => {
      const state = window.__COMMUTE_RUSH_TEST__?.snapshot();
      return Boolean(state?.busVisible && state.busX < 1500);
    },
    undefined,
    { timeout: 4_000 },
  );

  await invoke(page, 'summonBusAtStop');
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'RidingBus');
  const before = await snapshot(page);
  await page.waitForTimeout(250);
  const after = await snapshot(page);
  expect(after.playerX - after.busX).toBeCloseTo(before.playerX - before.busX, 1);

  await invoke(page, 'forceBusArrival');
  await page.waitForFunction(() => {
    const state = window.__COMMUTE_RUSH_TEST__?.snapshot();
    return state?.state === 'Playing' && state.hasRiddenBus;
  });
  const dropped = await snapshot(page);
  expect(dropped.playerX).toBeGreaterThan(3_000);

  const xBeforeMove = dropped.playerX;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(200);
  await page.keyboard.up('KeyD');
  expect((await snapshot(page)).playerX).toBeGreaterThan(xBeforeMove + 20);
  await expectNoRuntimeErrors(page, runtimeErrors);
});

test('사직 및 3회 반복 재시작: 오브젝트·입력·속도 중복 없음', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await invoke(page, 'collectResignation');
    await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'Resigned');
    const resigned = await snapshot(page);
    expect(resigned.resultVisible).toBe(true);

    const frozenX = resigned.playerX;
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(120);
    await page.keyboard.up('KeyD');
    expect((await snapshot(page)).playerX).toBeCloseTo(frozenX, 2);

    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => {
      const state = window.__COMMUTE_RUSH_TEST__?.snapshot();
      return state?.state === 'Playing' && state.elapsedSeconds < 1;
    });
    const restarted = await snapshot(page);
    expect(restarted.sceneCrowdCount).toBe(10);
    expect(restarted.sceneBusCount).toBe(1);
    expect(restarted.currentSpeed).toBe(230);
    expect(restarted.coffeeVisible).toBe(true);
    expect(restarted.resignationVisible).toBe(true);
  }

  await expectNoRuntimeErrors(page, runtimeErrors);
});
