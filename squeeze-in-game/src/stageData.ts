import type { Spawn, StageDefinition } from "./types";

const normal = (x: number, y: number): Spawn => ({ kind: "normal", x, y });
const backpack = (x: number, y: number): Spawn => ({ kind: "backpack", x, y });
const alighter = (x: number, y: number, targetX = x): Spawn => ({ kind: "alighter", x, y, targetX });
const rival = (x: number, y: number, targetX: number): Spawn => ({ kind: "rival", x, y, targetX });

export const STAGES: StageDefinition[] = [
  {
    name: "첫 출근",
    timeLimit: 13,
    spawns: [normal(395, 210), normal(565, 205), normal(590, 280)],
  },
  {
    name: "조금 붐빈다",
    timeLimit: 12,
    spawns: [
      normal(394, 286), normal(466, 294), normal(530, 276),
      normal(572, 210), normal(435, 208), normal(615, 292),
    ],
  },
  {
    name: "비집고 들어가기",
    timeLimit: 12,
    spawns: [
      normal(365, 287), normal(416, 278), normal(470, 289), normal(522, 281),
      normal(574, 288), normal(612, 246), normal(444, 211), normal(543, 207),
    ],
  },
  {
    name: "내리는 사람 먼저",
    timeLimit: 13,
    randomize: true,
    spawns: [
      normal(372, 213), normal(420, 284), normal(535, 283), normal(590, 216), normal(617, 284),
      alighter(448, 235, 430), alighter(494, 205, 505), alighter(545, 246, 560),
      rival(278, 490, 395),
    ],
  },
  {
    name: "지옥철",
    timeLimit: 11,
    randomize: true,
    coffee: { x: 752, y: 470 },
    spawns: [
      normal(354, 284), normal(401, 216), normal(432, 285), normal(479, 214),
      normal(518, 284), normal(565, 210), normal(612, 280),
      backpack(470, 286), backpack(581, 282),
      alighter(432, 238, 410), alighter(500, 205, 500), alighter(552, 242, 568),
      rival(275, 492, 388), rival(685, 505, 602),
    ],
  },
];
