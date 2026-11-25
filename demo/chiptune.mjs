// エージェント(Claude Code)が書いたチップチューン。1 分 150 拍、ハ長調(C → Am → F → G)。
// 昔のゲーム機の音源の作り: 細いパルス波 2 つ(旋律と分散和音)、三角波の低音、ノイズの打楽器。フィルタは使わず、生の波形のまま鳴らす。
// 全体をサンプル&ホールドに通して、サンプリング周波数を約 9 kHz に落とす(粗い、安っぽい音)。
// 8 小節(12.8 秒)の楽譜 × 6 と、終わりの 4 小節: 入り → 主題 → 主題(打楽器) → 間奏(短調) → 主題(高く) → 転調して主題 → 終わり。
// チャンネル: 1 = 旋律(パルス、ビブラート)、2 = 分散和音(パルス)、3 = 低音(三角波)、4 = キック、5 = ノイズ(スネアとハイハット)。

const add = (id, type, params) => ({ command: "module.add", args: { id, type, ...(params ? { params } : {}) } });
const con = (from, to) => {
  const [fm, fp] = from.split(".");
  const [tm, tp] = to.split(".");
  return { command: "cable.connect", args: { from: { module: fm, port: fp }, to: { module: tm, port: tp } } };
};

export const TITLE = "チップチューン「ステージ 1」(150 BPM)";
/** 録画のときに人が選ぶ画面の色相(BLUE。ミニマルの GREEN と見分けやすいように)。 */
export const HUE = 227;
/** 録画のとき、2 つ目の楽譜の途中で人が書く指示。 */
export const PROMPT = "ボス戦の前みたいに";

export const PATCH = [
  // --- 旋律(ch 1): 幅 25 % のパルス波。少し遅れてかかるビブラート。強さで音量が変わる ---
  add("m_midi", "MOD-IO-002", { channel: 1, voices: 1 }),
  add("vib", "MOD-LFO-001", { freq: 6, depth: 1 }),
  add("m_osc", "MOD-OSC-001", { pw: 0.25, fm_amt: 0.006 }),
  add("m_env", "MOD-ENV-001", { attack: 0.002, decay: 0.15, sustain: 0.75, release: 0.04 }),
  add("m_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("m_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("m_midi.PITCH", "m_osc.pitch"),
  con("vib.tri", "m_osc.fm"),
  con("m_midi.GATE", "m_env.gate"),
  con("m_osc.pulse", "m_vca.in1"),
  con("m_env.env", "m_vca.cv2"),
  con("m_vca.out", "m_vel.in1"),
  con("m_midi.VEL", "m_vel.cv2"),
  // --- 分散和音(ch 2): 幅 12.5 % の細いパルス波。短く切る ---
  add("a_midi", "MOD-IO-002", { channel: 2, voices: 1 }),
  add("a_osc", "MOD-OSC-001", { pw: 0.125 }),
  add("a_env", "MOD-ENV-001", { attack: 0.001, decay: 0.06, sustain: 0.4, release: 0.02 }),
  add("a_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("a_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("a_midi.PITCH", "a_osc.pitch"),
  con("a_midi.GATE", "a_env.gate"),
  con("a_osc.pulse", "a_vca.in1"),
  con("a_env.env", "a_vca.cv2"),
  con("a_vca.out", "a_vel.in1"),
  con("a_midi.VEL", "a_vel.cv2"),
  // --- 低音(ch 3): 三角波。鳴っている間は同じ大きさ(昔の三角波の音源は音量を変えられなかった) ---
  add("l_midi", "MOD-IO-002", { channel: 3, voices: 1 }),
  add("l_osc", "MOD-OSC-001"),
  add("l_env", "MOD-ENV-001", { attack: 0.001, decay: 0.01, sustain: 1, release: 0.01 }),
  add("l_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("l_midi.PITCH", "l_osc.pitch"),
  con("l_midi.GATE", "l_env.gate"),
  con("l_osc.tri", "l_vca.in1"),
  con("l_env.env", "l_vca.cv2"),
  // --- キック(ch 4): 三角波を、打った瞬間に高い所から一気に落とす ---
  add("k_midi", "MOD-IO-002", { channel: 4, voices: 1 }),
  add("k_osc", "MOD-OSC-001", { fm_amt: 0.35 }),
  add("k_penv", "MOD-ENV-001", { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 }),
  add("k_env", "MOD-ENV-001", { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 }),
  add("k_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("k_midi.PITCH", "k_osc.pitch"),
  con("k_midi.GATE", "k_penv.gate"),
  con("k_midi.GATE", "k_env.gate"),
  con("k_penv.env", "k_osc.fm"),
  con("k_osc.tri", "k_vca.in1"),
  con("k_env.env", "k_vca.cv2"),
  // --- ノイズ(ch 5): スネア(長め、強い)とハイハット(短い、弱い)を、音符の長さと強さで打ち分ける ---
  add("n_midi", "MOD-IO-002", { channel: 5, voices: 1 }),
  add("n_nse", "MOD-NSE-001", { level: 10, seed: 21 }),
  add("n_env", "MOD-ENV-001", { attack: 0.001, decay: 0.07, sustain: 0.3, release: 0.05 }),
  add("n_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("n_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("n_midi.GATE", "n_env.gate"),
  con("n_nse.out", "n_vca.in1"),
  con("n_env.env", "n_vca.cv2"),
  con("n_vca.out", "n_vel.in1"),
  con("n_midi.VEL", "n_vel.cv2"),
  // --- まとめ: 卓。昔の音源らしく、ほぼ中央。分散和音だけ少し右 ---
  add("desk", "MOD-MIX-002", {
    "level[1]": 0.24, "level[2]": 0.3, "level[3]": 0.175, "level[4]": 1, "level[5]": 0.22,
    window_ms: 400,
  }),
  con("m_vel.out", "desk.in1"),
  con("a_vel.out", "desk.in2"),
  con("l_vca.out", "desk.in3"),
  con("k_vca.out", "desk.in4"),
  con("n_vel.out", "desk.in5"),
  // --- 粗さ: 卓の出力をサンプル&ホールドに通し、約 9 kHz ごとに値を取り込んで保持する(サンプリング周波数を落とすのと同じ)。
  //     折り返しの雑音と段々が乗り、昔の音源の安っぽい音になる。叩く信号は、固定の電圧(5.1 V = C4 の 2^5.1 倍 ≒ 9 kHz)で鳴らす発振器のパルス波
  add("crush_v", "MOD-UTL-001", { gain: 0, offset: 5.1 }),
  add("crush_clk", "MOD-OSC-001"),
  add("crush", "MOD-RND-001"),
  con("crush_v.out", "crush_clk.pitch"),
  con("crush_clk.pulse", "crush.TRIG"),
  con("desk.L", "crush.IN"),
  con("crush.OUT", "out.IN_L"), // IN_R は未接続なので IN_L と同じ(昔の音源と同じく、中央にまとめる)
  { command: "param.set", args: { module_id: "out", param: "level", value: 1.2 } },
];

// ---- 楽譜を書くための道具(単位は拍。1 小節 = 4 拍) ----
const par = (t, dur, module_id, param, value) => ({ t, ...(dur ? { dur } : {}), module_id, param, value });
const bars = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
// 和音(分散和音に使う 4 音)と根音
const C = { arp: [60, 64, 67, 72], root: 36 };
const Am = { arp: [57, 60, 64, 69], root: 33 };
const F = { arp: [53, 57, 60, 65], root: 29 };
const G = { arp: [55, 59, 62, 67], root: 31 };
const Dm = { arp: [50, 53, 57, 62], root: 26 };
const E = { arp: [52, 56, 59, 64], root: 28 };
const up = (ch, k) => ({ arp: ch.arp.map((n) => n + k), root: ch.root + k });
const PROG = [C, Am, F, G, C, Am, F, G];
const BRIDGE = [Am, F, Dm, E, Am, F, Dm, E];
/** 分散和音: 16 分音符で、和音の 4 音を上がって下がる。 */
const arp = (bar, ch, vel = 80, key = 0) => {
  const seq = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3];
  return seq.map((k, i) => ({ t: bar * 4 + i * 0.25, dur: 0.2, note: ch.arp[k] + key, vel: i % 4 === 0 ? vel + 12 : vel, ch: 2 }));
};
/** 低音: 8 分音符で、根音と 1 オクターブ上を交互に。 */
const bass = (bar, ch, key = 0) => Array.from({ length: 8 }, (_, i) => ({ t: bar * 4 + i * 0.5, dur: 0.38, note: ch.root + 12 + key + (i % 2 ? 12 : 0), vel: 100, ch: 3 }));
/** 打楽器: キックは 1 拍目と 3 拍目(と 3 拍目の手前)、スネアは 2 拍目と 4 拍目、ハイハットは 8 分の裏。 */
const drums = (bar, { fill = false } = {}) => {
  const out = [{ t: bar * 4, dur: 0.1, note: 40, vel: 120, ch: 4 }, { t: bar * 4 + 2, dur: 0.1, note: 40, vel: 120, ch: 4 }, { t: bar * 4 + 1.5, dur: 0.1, note: 40, vel: 90, ch: 4 }];
  out.push({ t: bar * 4 + 1, dur: 0.16, note: 60, vel: 120, ch: 5 }, { t: bar * 4 + 3, dur: 0.16, note: 60, vel: 120, ch: 5 });
  for (let i = 0; i < 4; i++) out.push({ t: bar * 4 + i + 0.5, dur: 0.03, note: 60, vel: 60, ch: 5 });
  if (fill) for (let i = 0; i < 4; i++) out.push({ t: bar * 4 + 3 + i * 0.25, dur: 0.08, note: 60, vel: 90 + i * 8, ch: 5 });
  return out;
};
/** 旋律: [拍, 長さ, ノート] の並び(拍は 8 小節の先頭から)。 */
const mel = (list, { vel = 100, key = 0, oct = 0 } = {}) => list.map(([t, dur, note]) => ({ t, dur: dur * 0.85, note: note + key + oct * 12, vel, ch: 1 }));
// 主題(8 小節)
const THEME = [
  [0, 0.5, 76], [0.5, 0.5, 79], [1, 1, 84], [2, 0.5, 83], [2.5, 0.5, 79], [3, 1, 76],
  [4, 1.5, 81], [5.5, 0.5, 79], [6, 1, 76], [7, 1, 72],
  [8, 0.5, 77], [8.5, 0.5, 81], [9, 1, 84], [10, 0.5, 81], [10.5, 0.5, 77], [11, 1, 81],
  [12, 2, 79], [14, 0.5, 74], [14.5, 0.5, 76], [15, 0.5, 77], [15.5, 0.5, 79],
  [16, 0.5, 76], [16.5, 0.5, 79], [17, 1, 84], [18, 0.5, 83], [18.5, 0.5, 79], [19, 1, 76],
  [20, 1, 81], [21, 1, 84], [22, 1, 83], [23, 1, 81],
  [24, 1, 77], [25, 1, 81], [26, 0.5, 79], [26.5, 0.5, 77], [27, 1, 74],
  [28, 3, 72],
];
// 間奏の旋律(イ短調)
const BRIDGE_MEL = [
  [0, 2, 84], [2, 1, 83], [3, 1, 81], [4, 3, 81], [7, 1, 79], [8, 2, 77], [10, 1, 76], [11, 1, 74], [12, 2, 76], [14, 2, 80],
  [16, 2, 84], [18, 1, 83], [19, 1, 81], [20, 3, 81], [23, 1, 84], [24, 2, 86], [26, 1, 84], [27, 1, 81], [28, 2, 83], [30, 1, 80], [31, 1, 76],
];
const LEN = 32;
const score = (notes, params = []) => ({ tempo_bpm: 150, length: LEN, notes, params });

/** 1. 入り: 分散和音と低音だけ。最後の小節でスネアの連打。 */
const S1 = score([...bars(0, 8).flatMap((b) => arp(b, PROG[b], 70)), ...bars(4, 8).flatMap((b) => bass(b, PROG[b])), ...drums(7, { fill: true }).filter((n) => n.ch === 5 && n.t >= 31)]);
/** 2. 主題。 */
const S2 = score([...bars(0, 8).flatMap((b) => arp(b, PROG[b], 64)), ...bars(0, 8).flatMap((b) => bass(b, PROG[b])), ...mel(THEME, { vel: 96 })]);
/** 3. 主題に打楽器が加わる。分散和音の幅を広げて明るく。 */
const S3 = score(
  [...bars(0, 8).flatMap((b) => arp(b, PROG[b], 66)), ...bars(0, 8).flatMap((b) => bass(b, PROG[b])), ...bars(0, 8).flatMap((b) => drums(b, { fill: b === 7 })), ...mel(THEME, { vel: 104 })],
  [par(0, 0, "a_osc", "pw", 0.25)],
);
/** 4. 間奏: イ短調へ。旋律は長くのばし、分散和音は細く戻す。 */
const S4 = score(
  [...bars(0, 8).flatMap((b) => arp(b, BRIDGE[b], 66)), ...bars(0, 8).flatMap((b) => bass(b, BRIDGE[b])), ...bars(0, 8).flatMap((b) => drums(b, { fill: b === 7 })), ...mel(BRIDGE_MEL, { vel: 98 })],
  [par(0, 0, "a_osc", "pw", 0.125), par(0, 0, "m_osc", "pw", 0.5)],
);
/** 5. 主題を 1 オクターブ上で。旋律の幅を細くして、明るく鋭く。 */
const S5 = score(
  [...bars(0, 8).flatMap((b) => arp(b, PROG[b], 70)), ...bars(0, 8).flatMap((b) => bass(b, PROG[b])), ...bars(0, 8).flatMap((b) => drums(b, { fill: b === 7 })), ...mel(THEME, { vel: 96, oct: 1 }).map((n) => ({ ...n, note: Math.min(n.note, 100) }))],
  [par(0, 0, "m_osc", "pw", 0.125)],
);
/** 6. 全音上へ転調して主題(ニ長調)。 */
const S6 = score(
  [...bars(0, 8).flatMap((b) => arp(b, up(PROG[b], 2), 72)), ...bars(0, 8).flatMap((b) => bass(b, up(PROG[b], 2))), ...bars(0, 8).flatMap((b) => drums(b, { fill: b === 7 })), ...mel(THEME, { vel: 108, key: 2 })],
  [par(0, 0, "m_osc", "pw", 0.25), par(0, 0, "a_osc", "pw", 0.25)],
);
/** 7. 終わり(4 小節): ファンファーレ。I → IV → V → I で、最後の和音をのばして、打楽器の一撃で止める。 */
const D = up(C, 2), Gk = up(F, 2), A = up(G, 2);
const S7 = {
  tempo_bpm: 150, length: 16,
  notes: [
    ...arp(0, D, 74), ...arp(1, Gk, 74), ...arp(2, A, 76),
    ...bass(0, D), ...bass(1, Gk), ...bass(2, A),
    ...drums(0), ...drums(1), ...drums(2, { fill: true }),
    ...mel([[0, 0.33, 74], [0.33, 0.33, 78], [0.67, 0.33, 81], [1, 2, 86], [4, 0.33, 79], [4.33, 0.33, 83], [4.67, 0.33, 86], [5, 2, 91], [8, 0.5, 88], [8.5, 0.5, 86], [9, 0.5, 85], [9.5, 0.5, 86], [10, 2, 88]], { vel: 110 }),
    // 最後: 和音と低音をのばし、キックとスネアの一撃
    ...D.arp.map((n) => ({ t: 12, dur: 3, note: n, vel: 90, ch: 2 })),
    { t: 12, dur: 3, note: 86, vel: 112, ch: 1 },
    { t: 12, dur: 3, note: D.root + 12, vel: 100, ch: 3 },
    { t: 12, dur: 0.1, note: 40, vel: 127, ch: 4 },
    { t: 12, dur: 0.3, note: 60, vel: 127, ch: 5 },
  ],
  params: [par(12, 0, "a_env", "sustain", 0.8), par(12, 3, "desk", "master", 0.2)],
};

/** 区間(パラメータの動きは楽譜の中にある)。 */
export const SECTIONS = [
  { name: "入り", score: S1, params: [] },
  { name: "主題", score: S2, params: [] },
  { name: "主題と打楽器", score: S3, params: [] },
  { name: "間奏", score: S4, params: [] },
  { name: "主題(高く)", score: S5, params: [] },
  { name: "転調", score: S6, params: [] },
  { name: "終わり", score: S7, params: [] },
];

/** 音像の確かめ(demo/mixcheck.mjs): 曲調と、卓のチャンネルの役割(demo/styles.mjs)。 */
export const MIX = { style: "chiptune", desk: "desk", channels: { 1: "lead", 2: "arp", 3: "bass", 4: "kick", 5: "perc" } };
