import type { NpcBody, Spawn, StageDefinition } from "./types";

const normal = (x: number, y: number, body: NpcBody = "normal"): Spawn => ({ kind: "normal", body, x, y });
const backpack = (x: number, y: number): Spawn => ({ kind: "backpack", body: "backpack", x, y });
const luggage = (x: number, y: number): Spawn => ({ kind: "normal", body: "luggage", x, y });
const alighter = (x: number, y: number, targetX = x, body: NpcBody = "normal"): Spawn => ({ kind: "alighter", body, x, y, targetX });
const rival = (x: number, y: number, targetX: number, body: NpcBody = "normal"): Spawn => ({ kind: "rival", body, x, y, targetX });

export const STAGES: StageDefinition[] = [
  {
    name: "첫 출근",
    timeLimit: 15,
    spawns: [
      normal(308, 380, "slim"), normal(365, 280), normal(412, 205),
      normal(554, 220), normal(620, 300, "large"), normal(684, 382, "slim"),
      normal(752, 250), luggage(814, 372),
    ],
  },
  {
    name: "출근 시작",
    timeLimit: 13,
    spawns: [
      normal(285, 385), normal(335, 315, "slim"), normal(382, 385),
      normal(447, 390), normal(565, 370, "slim"), normal(610, 388),
      normal(646, 318), normal(704, 388), normal(765, 312, "slim"),
      luggage(820, 382), normal(420, 270), normal(515, 245), normal(605, 225, "slim"),
    ],
  },
  {
    name: "만원",
    timeLimit: 11,
    spawns: [
      normal(250, 390, "slim"), normal(300, 330), normal(350, 390),
      normal(400, 335), normal(449, 390, "slim"), normal(481, 393),
      normal(529, 385, "large"), normal(580, 335), normal(630, 390),
      normal(680, 330, "slim"), normal(730, 390), normal(785, 325, "large"),
      luggage(830, 390), normal(330, 245), normal(405, 225),
      backpack(555, 250), normal(650, 225, "slim"), luggage(745, 240),
    ],
  },
  {
    name: "환승역",
    timeLimit: 9,
    randomize: true,
    spawns: [
      normal(235, 390), normal(285, 325, "slim"), normal(335, 390, "large"),
      luggage(385, 325), normal(430, 390), normal(535, 390, "slim"),
      normal(585, 325, "large"), normal(635, 390), normal(685, 320),
      normal(735, 390, "slim"), normal(785, 325), normal(830, 390, "large"),
      normal(320, 235), normal(400, 220), normal(565, 230, "slim"),
      luggage(655, 215), normal(750, 235),
      alighter(450, 360, 440, "slim"), alighter(482, 320, 485),
      alighter(512, 365, 520, "large"), alighter(492, 245, 500),
      rival(350, 520, 455, "slim"),
    ],
  },
  {
    name: "지옥철",
    timeLimit: 7,
    randomize: true,
    coffee: { x: 610, y: 518 },
    spawns: [
      normal(205, 392, "large"), normal(250, 335, "slim"), normal(295, 392),
      luggage(340, 330), normal(382, 392, "large"), normal(423, 335),
      normal(452, 392, "slim"), backpack(486, 390), normal(523, 388, "large"),
      normal(558, 330), backpack(595, 388), normal(635, 330),
      normal(675, 392, "large"), normal(718, 330, "slim"), normal(760, 390),
      luggage(805, 328), normal(850, 390, "large"),
      normal(255, 245), normal(315, 205), normal(375, 250, "slim"),
      normal(435, 215), normal(545, 220, "large"), normal(610, 245, "slim"),
      luggage(675, 205), normal(740, 250), normal(805, 210, "slim"),
      alighter(455, 350, 445, "slim"), alighter(486, 305, 485),
      alighter(515, 355, 520, "large"),
      rival(345, 520, 456, "slim"), rival(760, 525, 510),
    ],
  },
];
