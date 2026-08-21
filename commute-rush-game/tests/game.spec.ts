import { expect, test, type Page } from '@playwright/test';

type Snapshot = ReturnType<NonNullable<Window['__COMMUTE_RUSH_TEST__']>['snapshot']>;

async function waitForGame(page: Page, autoStart = true): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__COMMUTE_RUSH_TEST__));
  await expect(page.locator('canvas')).toBeVisible();
  if (autoStart) {
    await page.evaluate(() => window.__COMMUTE_RUSH_TEST__?.startGame());
    await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().gameStarted);
  }
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

async function setQueueNpcCount(page: Page, count: number): Promise<void> {
  await page.evaluate((value) => window.__COMMUTE_RUSH_TEST__?.setQueueNpcCount(value), count);
}

async function summonBus(page: Page, kind: 'red' | 'blue' | 'green'): Promise<void> {
  await page.evaluate((busKind) => window.__COMMUTE_RUSH_TEST__?.summonBusAtStop(busKind), kind);
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

test('첫 실행: 타이틀·게임 목적·CTA 표시 후 클릭으로 출근 시작', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page, false);

  const beforeStart = await snapshot(page);
  expect(beforeStart.gameStarted).toBe(false);
  expect(beforeStart.titleVisible).toBe(true);
  expect(beforeStart.elapsedSeconds).toBe(0);
  expect(beforeStart.objective).toBe('목표: 지하철 출구로 이동하세요.');

  await page.waitForTimeout(250);
  expect((await snapshot(page)).elapsedSeconds).toBe(0);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Game canvas has no visible bounds.');
  }
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * (505 / 720));
  await page.waitForFunction(() => {
    const state = window.__COMMUTE_RUSH_TEST__?.snapshot();
    return Boolean(state?.gameStarted && !state.titleVisible);
  });

  const started = await snapshot(page);
  expect(started.stage).toBe('Subway');
  expect(started.remainingTimeText).toBe('01:30');
  await expectNoRuntimeErrors(page, runtimeErrors);
});

test('성공 루프: 이동 → 버스 탑승/하차 → 지문 인식 → R 재시작', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);

  const initial = await snapshot(page);
  expect(initial.state).toBe('Playing');
  expect(initial.mental).toBe(5);
  expect(initial.crowdCount).toBe(10);
  expect(initial.sceneCrowdCount).toBe(10);
  expect(initial.sceneBusCount).toBe(1);
  expect(initial.stage).toBe('Subway');
  expect(initial.remainingTimeText).toBe('01:30');
  expect(initial.queueNpcCount).toBeGreaterThanOrEqual(0);
  expect(initial.queueNpcCount).toBeLessThanOrEqual(6);
  expect(initial.sceneQueueNpcCount).toBe(initial.queueNpcCount);

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(250);
  await page.keyboard.up('KeyD');
  expect((await snapshot(page)).playerX).toBeGreaterThan(initial.playerX + 25);

  await setQueueNpcCount(page, 0);
  await summonBus(page, 'red');
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
  expect(cleared.resultTitle).toBe('출근 성공!');
  expect(cleared.resultTime).toBe(cleared.clockText);
  expect(cleared.resultBody).toContain('무사히 살아남았습니다');

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
  expect(restarted.coffeeLabelVisible).toBe(true);
  expect(restarted.stage).toBe('Subway');
  expect(restarted.gameStarted).toBe(true);
  expect(restarted.titleVisible).toBe(false);

  await expectNoRuntimeErrors(page, runtimeErrors);
});

test('지각: 실제 경과시간 기준 09:00:00 즉시 종료 및 이동 중단', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);

  await page.evaluate(() => window.__COMMUTE_RUSH_TEST__?.setElapsedSeconds(89.95));
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'Late');

  const late = await snapshot(page);
  expect(late.clockText).toBe('09:00:00');
  expect(late.remainingTimeText).toBe('00:00');
  expect(late.resultVisible).toBe(true);
  expect(late.resultTitle).toBe('지각!');
  expect(late.resultTime).toBe('09:00:00');
  expect(late.resultBody).toContain('시말서');

  const frozenX = late.playerX;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(200);
  await page.keyboard.up('KeyD');
  expect((await snapshot(page)).playerX).toBeCloseTo(frozenX, 2);

  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'Playing');
  await expectNoRuntimeErrors(page, runtimeErrors);
});

test('긴급 HUD: 10초 이하에서 빨간색 카운트다운으로 전환', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);

  await page.evaluate(() => window.__COMMUTE_RUSH_TEST__?.setElapsedSeconds(80.05));
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().remainingTimeText === '00:10');
  const urgent = await snapshot(page);
  expect(urgent.countdownUrgent).toBe(true);
  expect(urgent.countdownColor).toBe('#f87171');

  await page.evaluate(() => window.__COMMUTE_RUSH_TEST__?.setElapsedSeconds(85.05));
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().remainingTimeText === '00:05');
  expect((await snapshot(page)).countdownColor).toBe('#f87171');
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
  expect(['안 비켜! 다음 차 타!', '비켜! 나 먼저!', '내릴 사람? 난 모르겠는데?', '출근길 처음 봐?']).toContain(
    current.dialogueText,
  );

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
  expect(current.resultTitle).toBe('멘탈 퇴근');
  expect(current.resultBody).toContain('정신력이 먼저 퇴근했습니다');

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
  expect(boosted.coffeeLabelVisible).toBe(false);
  expect(boosted.playerDialogueVisible).toBe(true);
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
      return Boolean(state?.busVisible && state.busX <= 1650);
    },
    undefined,
    { timeout: 4_000 },
  );

  await setQueueNpcCount(page, 0);
  await summonBus(page, 'red');
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

test('오답 버스: 일반버스 승차 위치를 선택한 경우에만 WrongBus', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);
  await setQueueNpcCount(page, 0);

  await summonBus(page, 'blue');
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'WrongBus');
  const wrongBus = await snapshot(page);
  expect(wrongBus.resultVisible).toBe(true);
  expect(wrongBus.stage).toBe('Bus');
  expect(wrongBus.resultTitle).toBe('경로를 이탈했습니다');
  expect(wrongBus.resultBody).toContain('회사로 가지 않습니다');

  const frozenSeconds = wrongBus.elapsedSeconds;
  await page.waitForTimeout(250);
  expect((await snapshot(page)).elapsedSeconds).toBeCloseTo(frozenSeconds, 2);

  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'Playing');
  await expectNoRuntimeErrors(page, runtimeErrors);
});

test('만원 버스: NPC 6명일 때 첫 빨간 버스를 놓치고 다음 빨간 버스 탑승', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await waitForGame(page);
  await setQueueNpcCount(page, 6);

  await summonBus(page, 'red');
  await page.waitForFunction(() => window.__COMMUTE_RUSH_TEST__?.snapshot().fullBusMissed);
  const missed = await snapshot(page);
  expect(missed.state).toBe('Playing');
  expect(missed.queueNpcCount).toBe(0);
  expect(missed.sceneQueueNpcCount).toBe(0);

  await page.waitForFunction(
    () => window.__COMMUTE_RUSH_TEST__?.snapshot().state === 'RidingBus',
    undefined,
    { timeout: 9_000 },
  );
  const secondBus = await snapshot(page);
  expect(secondBus.busKind).toBe('red');
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
    expect(resigned.resultTitle).toBe('사직 완료');
    expect(resigned.resultBody).toContain('출근하지 않아도 됩니다');

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
