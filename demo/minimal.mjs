// エージェント(Claude Code)が書いたミニマル。1 分 120 拍、ホ短調(ドリア風)。8 小節(16 秒)の楽譜 × 6。
// 長さの違う 2 つの短い型をくり返す: A は 16 分音符 12 個、B は 16 分音符 7 個で 1 周。小節(16 分音符 16 個)とずれ続けるので、
// 同じ型なのに、重なり方が少しずつ変わっていく(位相のずれ)。曲の起伏は、パートの出し入れと、フィルタの開き具合でつける。
// チャンネル: 1 = 型 A(パルス波、左)、2 = 型 B(ノコギリ波、右。ディレイ)、3 = 低音、4 = キック(柔らかい)、5 = ハイハット(ノイズ)。

const add = (id, type, params) => ({ command: "module.add", args: { id, type, ...(params ? { params } : {}) } });
const con = (from, to) => {
  const [fm, fp] = from.split(".");
  const [tm, tp] = to.split(".");
  return { command: "cable.connect", args: { from: { module: fm, port: fp }, to: { module: tm, port: tp } } };
};

export const TITLE = "ミニマル「位相」(120 BPM)";
/** 録画のときに人が選ぶ画面の色相(GREEN)。 */
export const HUE = 141;

export const PATCH = [
  // --- 型 A(ch 1): 細いパルス波。音ごとにフィルタを弾く(短いエンベロープ)。開き具合は楽譜が動かす ---
  add("a_midi", "MOD-IO-002", { channel: 1, voices: 1 }),
  add("a_osc", "MOD-OSC-001", { pw: 0.3 }),
  add("a_env", "MOD-ENV-001", { attack: 0.002, decay: 0.12, sustain: 0.1, release: 0.08 }),
  add("a_vcf", "MOD-FLT-001", { cutoff: -0.5, res: 0.55, cv2_level: 0.35 }),
  add("a_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("a_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("a_midi.PITCH", "a_osc.pitch"),
  con("a_midi.PITCH", "a_vcf.cv1"), // 高い音ほどフィルタも開く(音程に追従)
  con("a_midi.GATE", "a_env.gate"),
  con("a_osc.pulse", "a_vcf.in"),
  con("a_env.env", "a_vcf.cv2"),
  con("a_vcf.out", "a_vca.in1"),
  con("a_env.env", "a_vca.cv2"),
  con("a_vca.out", "a_vel.in1"),
  con("a_midi.VEL", "a_vel.cv2"),
  // --- 型 B(ch 2): ノコギリ波を 2 つ、少しずらす。少し長めに残る ---
  add("b_midi", "MOD-IO-002", { channel: 2, voices: 1 }),
  add("b_osc", "MOD-OSC-001"),
  add("b_osc2", "MOD-OSC-001", { tune: 0.012 }),
  add("b_pre", "MOD-MIX-001", { level1: 0.6, level2: 0.6 }),
  add("b_env", "MOD-ENV-001", { attack: 0.003, decay: 0.25, sustain: 0.2, release: 0.18 }),
  add("b_vcf", "MOD-FLT-001", { cutoff: -0.8, res: 0.35, cv2_level: 0.25 }),
  add("b_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("b_midi.PITCH", "b_osc.pitch"),
  con("b_midi.PITCH", "b_osc2.pitch"),
  con("b_midi.GATE", "b_env.gate"),
  con("b_osc.saw", "b_pre.in1"),
  con("b_osc2.saw", "b_pre.in2"),
  con("b_pre.out", "b_vcf.in"),
  con("b_env.env", "b_vcf.cv2"),
  con("b_vcf.out", "b_vca.in1"),
  con("b_env.env", "b_vca.cv2"),
  // ディレイ: 付点 8 分(0.375 秒)。型 B をセンドで送る
  add("dly", "MOD-DLY-001", { time: 0.375, feedback: 0.45, mix: 1 }),
  // --- 低音(ch 3): ノコギリ波と 1 オクターブ下の矩形波。短く刻む ---
  add("l_midi", "MOD-IO-002", { channel: 3, voices: 1 }),
  add("l_osc", "MOD-OSC-001"),
  add("l_osc2", "MOD-OSC-001", { range: -1, pw: 0.5 }),
  add("l_pre", "MOD-MIX-001", { level1: 0.6, level2: 0.5 }),
  add("l_env", "MOD-ENV-001", { attack: 0.003, decay: 0.16, sustain: 0.3, release: 0.06 }),
  add("l_vcf", "MOD-FLT-001", { cutoff: -2.2, res: 0.3, cv2_level: 0.22 }),
  add("l_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("l_midi.PITCH", "l_osc.pitch"),
  con("l_midi.PITCH", "l_osc2.pitch"),
  con("l_midi.GATE", "l_env.gate"),
  con("l_osc.saw", "l_pre.in1"),
  con("l_osc2.pulse", "l_pre.in2"),
  con("l_pre.out", "l_vcf.in"),
  con("l_env.env", "l_vcf.cv2"),
  con("l_vcf.out", "l_vca.in1"),
  con("l_env.env", "l_vca.cv2"),
  // --- キック(ch 4): 正弦波を、打った瞬間だけ高くして落とす。テクノより短く、柔らかい ---
  add("k_midi", "MOD-IO-002", { channel: 4, voices: 1 }),
  add("k_osc", "MOD-OSC-001", { fm_amt: 0.22 }),
  add("k_penv", "MOD-ENV-001", { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 }),
  add("k_env", "MOD-ENV-001", { attack: 0.001, decay: 0.24, sustain: 0, release: 0.05 }),
  add("k_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("k_midi.PITCH", "k_osc.pitch"),
  con("k_midi.GATE", "k_penv.gate"),
  con("k_midi.GATE", "k_env.gate"),
  con("k_penv.env", "k_osc.fm"),
  con("k_osc.sine", "k_vca.in1"),
  con("k_env.env", "k_vca.cv2"),
  // --- ハイハット(ch 5): ノイズを短く切り、高い方だけ残す ---
  add("h_midi", "MOD-IO-002", { channel: 5, voices: 1 }),
  add("h_nse", "MOD-NSE-001", { level: 10, seed: 5 }),
  add("h_env", "MOD-ENV-001", { attack: 0.001, decay: 0.03, sustain: 0, release: 0.03 }),
  add("h_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("h_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("h_midi.GATE", "h_env.gate"),
  add("h_vcf", "MOD-FLT-001", { cutoff: 5.5, res: 0.15 }), // 白色ノイズのままは鋭すぎる(重心 12 kHz)。約 11.8 kHz から上を削る
  con("h_nse.out", "h_vcf.in"),
  con("h_vcf.out", "h_vca.in1"),
  con("h_env.env", "h_vca.cv2"),
  con("h_vca.out", "h_vel.in1"),
  con("h_midi.VEL", "h_vel.cv2"),
  // --- まとめ: 卓。1 型 A(左)/ 2 型 B(右、ディレイへ)/ 3 ディレイの戻り(左寄り)/ 4 低音 / 5 キック / 6 ハイハット(少し右) ---
  add("desk", "MOD-MIX-002", {
    "level[1]": 1, "level[2]": 0.8, "level[3]": 0.75, "level[4]": 0.5, "level[5]": 0.49, "level[6]": 0.6,
    "pan[1]": -0.35, "pan[2]": 0.4, "send[2]": 1, "pan[3]": -0.5, "pan[6]": 0.2, window_ms: 400,
  }),
  con("a_vel.out", "desk.in1"),
  con("b_vca.out", "desk.in2"),
  con("dly.out", "desk.in3"),
  con("l_vca.out", "desk.in4"),
  con("k_vca.out", "desk.in5"),
  con("h_vel.out", "desk.in6"),
  con("desk.SEND", "dly.in"),
  con("desk.L", "out.IN_L"),
  con("desk.R", "out.IN_R"),
  { command: "param.set", args: { module_id: "out", param: "level", value: 1.5 } },
];

// ---- 楽譜を書くための道具(単位は拍。1 小節 = 4 拍、16 分音符 = 0.25 拍) ----
const par = (t, dur, module_id, param, value) => ({ t, ...(dur ? { dur } : {}), module_id, param, value });
const S16 = 0.25;
const BARS = 8;
const LEN = BARS * 4;
// 型 A: 16 分音符 12 個(E ドリア: ミ ソ シ レ シ ソ ミ レ ミ ソ ラ シ)。強弱をつけて、型の頭を少し強く
const A = [64, 67, 71, 74, 71, 67, 64, 62, 64, 67, 69, 71];
// 型 B: 16 分音符 7 個(1 オクターブ上)。null は休み
const B = [76, null, 74, 79, null, 78, 74];
const B2 = [78, null, 76, 81, null, 79, 76]; // 終盤: 少し上へずらした型
/** 型を、拍 from〜to の間、16 分音符で敷き詰める。offset で型の始まりをずらせる。 */
function loop(pattern, ch, from, to, { vel = 96, accent = 18, offset = 0, dur = 0.2 } = {}) {
  const out = [];
  for (let i = 0; from + i * S16 < to - 1e-9; i++) {
    const k = (i + offset) % pattern.length;
    const note = pattern[k];
    if (note === null) continue;
    out.push({ t: from + i * S16, dur, note, vel: Math.min(127, vel + (k === 0 ? accent : 0)), ch });
  }
  return out;
}
/** 低音: 8 分音符で刻む。2 小節ごとに根音を変える(roots は 2 小節ずつ)。 */
const bass = (roots, from = 0, to = LEN, vel = 100) => {
  const out = [];
  for (let t = from; t < to; t += 0.5) {
    const root = roots[Math.floor(t / 8) % roots.length];
    out.push({ t, dur: 0.3, note: (t * 2) % 4 === 3 ? root + 12 : root, vel: t % 1 === 0 ? vel : vel - 18, ch: 3 });
  }
  return out;
};
const kick = (from = 0, to = LEN) => Array.from({ length: Math.round(to - from) }, (_, i) => ({ t: from + i, dur: 0.15, note: 36, vel: 110, ch: 4 }));
const hats = (from = 0, to = LEN, ghost = false) => {
  const out = [];
  for (let t = from; t < to; t += 0.5) {
    if (t % 1 === 0.5) out.push({ t, dur: 0.05, note: 60, vel: 100, ch: 5 });
    else if (ghost) out.push({ t: t + 0.25, dur: 0.04, note: 60, vel: 50, ch: 5 });
  }
  return out;
};
const ROOTS = [40, 40, 38, 43]; // E E D G(2 小節ずつ)
const score = (notes, params = []) => ({ tempo_bpm: 120, length: LEN, notes, params });

/** 1. 型 A だけ。フィルタは閉じ気味から、少しずつ開く。 */
const S1 = score(loop(A, 1, 0, LEN, { vel: 84 }), [par(0, 0, "a_vcf", "cutoff", -1.6), par(0, LEN, "a_vcf", "cutoff", -0.6), par(0, 0, "dly", "feedback", 0.4)]);
/** 2. 低音が入る。型 A はそのまま回り続ける。 */
const S2 = score([...loop(A, 1, 0, LEN, { vel: 90, offset: (LEN / S16) % 12 }), ...bass(ROOTS, 0, LEN, 92)], [par(0, LEN, "a_vcf", "cutoff", -0.1), par(0, LEN, "l_vcf", "cutoff", -1.6)]);
/** 3. キックと型 B。2 つの型の重なりが、小節ごとに変わっていく。 */
const S3 = score(
  [...loop(A, 1, 0, LEN, { vel: 92, offset: ((2 * LEN) / S16) % 12 }), ...loop(B, 2, 0, LEN, { vel: 88 }), ...bass(ROOTS), ...kick()],
  [par(0, 0, "b_vcf", "cutoff", -1.2), par(0, LEN, "b_vcf", "cutoff", -0.2)],
);
/** 4. ハイハットが入り、全部そろう。型 A のフィルタが大きく開き、共振が鳴る。ディレイが深くなる。 */
const S4 = score(
  [...loop(A, 1, 0, LEN, { vel: 96, offset: ((3 * LEN) / S16) % 12 }), ...loop(B, 2, 0, LEN, { vel: 92, offset: (LEN / S16) % 7 }), ...bass(ROOTS, 0, LEN, 104), ...kick(), ...hats(0, LEN, true)],
  [par(0, 16, "a_vcf", "cutoff", 1.2), par(0, 16, "a_vcf", "res", 0.72), par(0, 0, "dly", "feedback", 0.58), par(16, 16, "a_vcf", "cutoff", 0.4)],
);
/** 5. ブレイク: キックとハットが抜け、低音は長くのばす。型 B が上にずれた型になり、ディレイの尾が重なる。後半でキックが戻る。 */
const S5 = score(
  [
    ...loop(A, 1, 0, LEN, { vel: 86, offset: ((4 * LEN) / S16) % 12 }),
    ...loop(B2, 2, 0, LEN, { vel: 92 }),
    ...[0, 8, 16, 24].map((t, i) => ({ t, dur: 7.5, note: ROOTS[i], vel: 90, ch: 3 })),
    ...kick(24, LEN),
    ...hats(28, LEN),
  ],
  [par(0, 0, "a_vcf", "cutoff", -0.8), par(0, 0, "dly", "feedback", 0.7), par(0, 0, "l_env", "sustain", 0.8), par(0, 24, "a_vcf", "cutoff", 0.8), par(24, 0, "l_env", "sustain", 0.3)],
);
/** 6. 終わり: もう一度全部そろってから、型 B、ハット、キック、低音の順に抜け、最後は型 A が閉じていく。 */
const S6 = score(
  [
    ...loop(A, 1, 0, LEN, { vel: 94, offset: ((5 * LEN) / S16) % 12 }),
    ...loop(B, 2, 0, 12, { vel: 90 }),
    ...bass(ROOTS, 0, 20, 100),
    ...kick(0, 16),
    ...hats(0, 8, true),
    { t: LEN - 1, dur: 0.6, note: 52, vel: 100, ch: 3 },
  ],
  [par(0, 0, "dly", "feedback", 0.5), par(8, 24, "a_vcf", "cutoff", -2.2), par(0, 0, "a_vcf", "res", 0.6)],
);

/** 区間(パラメータの動きは楽譜の中にある)。 */
export const SECTIONS = [
  { name: "型 A", score: S1, params: [] },
  { name: "低音", score: S2, params: [] },
  { name: "型 B", score: S3, params: [] },
  { name: "全部", score: S4, params: [] },
  { name: "ブレイク", score: S5, params: [] },
  { name: "終わり", score: S6, params: [] },
];

/** 録画のとき、2 つ目の楽譜の途中で人が書く指示。 */
export const PROMPT = "少しずつ明るく";

/** 音像の確かめ(demo/mixcheck.mjs): 曲調と、卓のチャンネルの役割(demo/styles.mjs)。 */
export const MIX = { style: "minimal", desk: "desk", channels: { 1: "lead", 2: "counter", 3: "fx", 4: "bass", 5: "kick", 6: "hats" } };
