// エージェント(Claude Code)が書いたアンビエント。1 分 60 拍(1 拍 = 1 秒)、ニ長調(リディア風: ソ♯の代わりに ド♯ と ソ を使う和音)。
// 24 拍(24 秒)の楽譜 × 4: 夜明け → 鐘 → 満ち潮 → 引き潮。拍は感じさせず、長い和音と、まばらな鐘で空間を作る。
// チャンネル: 1 = 和音(パッド。5 声)、2 = 鐘(3 声。ディレイで尾を引かせる)、3 = 低い持続音。風(ノイズ)は楽譜でなく、パラメータの動きで出し入れする。
// 鐘の位置は、種を決めた乱数で選ぶ(毎回同じ曲になる)。

const add = (id, type, params) => ({ command: "module.add", args: { id, type, ...(params ? { params } : {}) } });
const con = (from, to) => {
  const [fm, fp] = from.split(".");
  const [tm, tp] = to.split(".");
  return { command: "cable.connect", args: { from: { module: fm, port: fp }, to: { module: tm, port: tp } } };
};

export const TITLE = "アンビエント「潮のガラス」(60 BPM)";
/** 録画のときに人が選ぶ画面の色相(VIOLET)。 */
export const HUE = 268;

export const PATCH = [
  // --- 和音(ch 1): 少しずらした 2 つのノコギリ波を、ゆっくり開閉するフィルタで丸める。立ち上がり 4 秒、余韻 7 秒 ---
  add("p_midi", "MOD-IO-002", { channel: 1, voices: 5 }),
  add("p_osc", "MOD-OSC-001"),
  add("p_osc2", "MOD-OSC-001", { tune: 0.009 }),
  add("p_osc3", "MOD-OSC-001", { range: -1, tune: -0.006 }),
  add("p_pre", "MOD-MIX-001", { level1: 0.55, level2: 0.55, level3: 0.35 }),
  add("p_env", "MOD-ENV-001", { attack: 4, decay: 2, sustain: 0.85, release: 7 }),
  add("p_lfo", "MOD-LFO-001", { freq: 0.07, depth: 0.5 }),
  add("p_vcf", "MOD-FLT-001", { cutoff: -1.2, res: 0.25, cv2_level: 0.12, cv3_level: 0.3 }),
  add("p_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("p_midi.PITCH", "p_osc.pitch"),
  con("p_midi.PITCH", "p_osc2.pitch"),
  con("p_midi.PITCH", "p_osc3.pitch"),
  con("p_midi.GATE", "p_env.gate"),
  con("p_osc.saw", "p_pre.in1"),
  con("p_osc2.saw", "p_pre.in2"),
  con("p_osc3.tri", "p_pre.in3"),
  con("p_pre.out", "p_vcf.in"),
  con("p_env.env", "p_vcf.cv2"),
  con("p_lfo.sine", "p_vcf.cv3"),
  con("p_vcf.out", "p_vca.in1"),
  con("p_env.env", "p_vca.cv2"),
  // --- 鐘(ch 2): 正弦波に、少し高い三角波を FM で混ぜて金属的な倍音を足す。すぐ減衰し、強さで音量が変わる ---
  add("b_midi", "MOD-IO-002", { channel: 2, voices: 3 }),
  add("b_mod", "MOD-OSC-001", { range: 1, tune: 0.807 }), // 約 3.5 倍の周波数(整数倍でない比で鐘らしく)
  add("b_osc", "MOD-OSC-001", { fm_amt: 0.18 }),
  add("b_env", "MOD-ENV-001", { attack: 0.004, decay: 1.6, sustain: 0, release: 2.2 }),
  add("b_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("b_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("b_midi.PITCH", "b_mod.pitch"),
  con("b_midi.PITCH", "b_osc.pitch"),
  con("b_mod.tri", "b_osc.fm"),
  con("b_midi.GATE", "b_env.gate"),
  con("b_osc.sine", "b_vca.in1"),
  con("b_env.env", "b_vca.cv2"),
  con("b_vca.out", "b_vel.in1"),
  con("b_midi.VEL", "b_vel.cv2"),
  // ディレイ: 付点 4 分(1.5 秒)。卓のセンドから入れ、戻りを別のチャンネルで右へ
  add("dly", "MOD-DLY-001", { time: 1.5, feedback: 0.62, mix: 1 }),
  add("dly_vcf", "MOD-FLT-001", { cutoff: 1.2, res: 0.1 }), // 繰り返すほど丸くなるよう、戻りを少し削る
  // --- 低い持続音(ch 3): 正弦波 1 つ。ゆっくり立ち上がる ---
  add("s_midi", "MOD-IO-002", { channel: 3, voices: 1 }),
  add("s_osc", "MOD-OSC-001"),
  add("s_env", "MOD-ENV-001", { attack: 5, decay: 1, sustain: 1, release: 6 }),
  add("s_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("s_midi.PITCH", "s_osc.pitch"),
  con("s_midi.GATE", "s_env.gate"),
  con("s_osc.sine", "s_vca.in1"),
  con("s_env.env", "s_vca.cv2"),
  // --- 風: ノイズを、共振の強いフィルタに通す。とてもゆっくりした LFO で、吹き抜ける高さが変わる。音量は楽譜のパラメータで出し入れ ---
  add("w_nse", "MOD-NSE-001", { level: 5, seed: 11 }),
  add("w_lfo", "MOD-LFO-001", { freq: 0.045 }),
  add("w_vcf", "MOD-FLT-001", { cutoff: 0.4, res: 0.72, cv3_level: 0.35 }),
  add("w_vca", "MOD-AMP-001", { gain: 0 }),
  con("w_nse.out", "w_vcf.in"),
  con("w_lfo.tri", "w_vcf.cv3"),
  con("w_vcf.out", "w_vca.in1"),
  // --- まとめ: 卓。1 和音(中央)/ 2 鐘(左寄り、ディレイへ)/ 3 ディレイの戻り(右寄り)/ 4 風(少し右)/ 5 低い持続音 ---
  add("desk", "MOD-MIX-002", {
    "level[1]": 0.6, "level[2]": 0.65, "level[3]": 1, "level[4]": 1, "level[5]": 0.17,
    "pan[2]": -0.4, "send[2]": 1, "pan[3]": 0.55, "pan[4]": 0.25, "send[1]": 0.15, window_ms: 400,
  }),
  con("p_vca.out", "desk.in1"),
  con("b_vel.out", "desk.in2"),
  con("dly.out", "dly_vcf.in"),
  con("dly_vcf.out", "desk.in3"),
  con("w_vca.out", "desk.in4"),
  con("s_vca.out", "desk.in5"),
  con("desk.SEND", "dly.in"),
  con("desk.L", "out.IN_L"),
  con("desk.R", "out.IN_R"),
  { command: "param.set", args: { module_id: "out", param: "level", value: 1.6 } },
];

// ---- 楽譜を書くための道具(単位は拍 = 秒) ----
const par = (t, dur, module_id, param, value) => ({ t, ...(dur ? { dur } : {}), module_id, param, value });
/** 種を決めた乱数(毎回同じ並び)。 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// 和音(低い方から)。D: ニ長調、Bm、G(リディア風に C♯ を足す)、Em
const DMAJ9 = [50, 57, 61, 64, 66];
const BM11 = [47, 54, 57, 62, 64];
const GMAJ7 = [43, 50, 54, 59, 61];
const EM9 = [52, 59, 62, 66, 67];
/** 和音を t 拍から dur 拍のばす。 */
const pad = (t, dur, chord, vel = 80) => chord.map((note) => ({ t, dur, note, vel, ch: 1 }));
/** 低い持続音。 */
const sub = (t, dur, note) => [{ t, dur, note, vel: 100, ch: 3 }];
// 鐘に使う音(ニ長調の五音音階、上の 2 オクターブ)
const BELL = [74, 76, 78, 81, 83, 86, 88, 90, 93];
/** 鐘: from〜to 拍の間に count 個、ばらばらの位置に置く。 */
const bells = (seed, from, to, count, velFrom = 70, velTo = 100) => {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = Math.round((from + r() * (to - from - 1)) * 4) / 4; // 16 分の格子に寄せる(揺れすぎないように)
    const note = BELL[Math.floor(r() * BELL.length)];
    out.push({ t, dur: 0.3, note, vel: Math.round(velFrom + r() * (velTo - velFrom)), ch: 2 });
  }
  return out.sort((a, b) => a.t - b.t);
};

/** 1. 夜明け: 和音がゆっくり立ち上がり、下で低い音が鳴り始める。風が遠くで吹き、フィルタが少しずつ開く。 */
const S1 = {
  tempo_bpm: 60, length: 24,
  notes: [...pad(0, 12.5, DMAJ9, 70), ...pad(12, 12.5, BM11, 72), ...sub(2, 22, 38), ...bells(3, 16, 24, 2, 55, 70)],
  params: [par(0, 0, "p_vcf", "cutoff", -2.2), par(0, 24, "p_vcf", "cutoff", -0.8), par(0, 0, "w_vca", "gain", 0), par(0, 16, "w_vca", "gain", 0.7), par(0, 0, "dly", "feedback", 0.55)],
};
/** 2. 鐘: 鐘がまばらに鳴り、ディレイが左右に散らす。和音は G と D。 */
const S2 = {
  tempo_bpm: 60, length: 24,
  notes: [...pad(0, 12.5, GMAJ7, 76), ...pad(12, 12.5, DMAJ9, 78), ...sub(0, 12.5, 31), ...sub(12, 12.5, 38), ...bells(17, 0, 24, 9, 60, 100)],
  params: [par(0, 12, "p_vcf", "cutoff", -0.3), par(0, 0, "dly", "feedback", 0.62), par(12, 12, "w_vca", "gain", 0.5)],
};
/** 3. 満ち潮: 鐘が増え、フィルタが開いて和音が明るくなる。LFO が速くなり、和音が揺れる。 */
const S3 = {
  tempo_bpm: 60, length: 24,
  notes: [...pad(0, 12.5, BM11, 84), ...pad(12, 12.5, EM9, 86), ...sub(0, 12.5, 35), ...sub(12, 12.5, 40), ...bells(29, 0, 24, 16, 65, 110)],
  params: [par(0, 10, "p_vcf", "cutoff", 0.4), par(0, 0, "p_lfo", "freq", 0.18), par(0, 0, "p_vcf", "res", 0.35), par(0, 0, "dly", "feedback", 0.7), par(0, 12, "w_vca", "gain", 0.85), par(16, 8, "p_vcf", "cutoff", -0.2)],
};
/** 4. 引き潮: D の和音に戻り、鐘が減り、フィルタが閉じて、風と一緒に遠ざかる。最後の鐘の尾をディレイが運ぶ。 */
const S4 = {
  tempo_bpm: 60, length: 24,
  notes: [...pad(0, 14, DMAJ9, 74), ...sub(0, 14, 38), ...bells(41, 0, 12, 4, 60, 85), { t: 15, dur: 0.3, note: 86, vel: 80, ch: 2 }],
  params: [par(0, 0, "p_lfo", "freq", 0.07), par(0, 0, "p_vcf", "res", 0.25), par(0, 20, "p_vcf", "cutoff", -2.6), par(4, 16, "w_vca", "gain", 0), par(12, 0, "dly", "feedback", 0.72)],
};

/** 区間(パラメータの動きは楽譜の中にある)。 */
export const SECTIONS = [
  { name: "夜明け", score: S1, params: [] },
  { name: "鐘", score: S2, params: [] },
  { name: "満ち潮", score: S3, params: [] },
  { name: "引き潮", score: S4, params: [] },
];

/** 録画のとき、2 つ目の楽譜の途中で人が書く指示。 */
export const PROMPT = "もっと遠くへ、静かに";
