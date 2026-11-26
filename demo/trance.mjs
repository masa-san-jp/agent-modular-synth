// エージェント(Claude Code)が書いたトランス。1 分 138 拍、イ短調(Am → F → C → G)。
// 発振器の帯域制限(#58)の前と後で、差が聞き取りやすい曲として作った。折り返しの雑音がよく聞こえる条件を、曲の作りとして入れてある:
//   1. 高い音: 主旋律は A5〜C7(約 880〜2100 Hz)まで上がる。基本波が高いほど、折り返す倍音が可聴域に多く落ちる。
//   2. 生の鋸歯: 主旋律(3 本の鋸歯を少しずらして重ねる)とライザーはフィルタを通さない。削られないので、折り返しがそのまま出る。
//   3. 音の高さが動く: 主旋律のビブラートと、ライザー(鋸歯を 8 小節かけて C6 から C8 へ 2 オクターブ上げる)。折り返した成分は、音の高さと逆向きに動くので、音程のない「ひゅー」という音として目立つ。
// 低音・和音・打楽器はフィルタで丸めてあり、比べる耳を主旋律とライザーに向けやすくしてある。
// 8 小節(13.9 秒)の楽譜 × 5 と、終わりの 4 小節: 入り → ブレイク(主旋律だけが前に出る) → ビルド(ライザー) → ドロップ → ドロップ(1 オクターブ上) → 終わり。
// チャンネル: 1 = 主旋律、2 = 和音(3 音)、3 = 低音、4 = キック、5 = ノイズ(ハイハットとスネア)、6 = アルペジオ、7 = ライザー。

const add = (id, type, params) => ({ command: "module.add", args: { id, type, ...(params ? { params } : {}) } });
const con = (from, to) => {
  const [fm, fp] = from.split(".");
  const [tm, tp] = to.split(".");
  return { command: "cable.connect", args: { from: { module: fm, port: fp }, to: { module: tm, port: tp } } };
};

export const TITLE = "トランス「ハイ・ライン」(138 BPM)";
/** 録画のときに人が選ぶ画面の色相(MAGENTA)。 */
export const HUE = 297;
/** 録画のとき、2 つ目の楽譜の途中で人が書く指示。 */
export const PROMPT = "もっと高く、明るく";

export const PATCH = [
  // --- 主旋律(ch 1): 鋸歯 3 本(少しずつずらす)を重ね、フィルタを通さずに鳴らす。少し遅れてかかるビブラート ---
  add("l_midi", "MOD-IO-002", { channel: 1, voices: 1 }),
  add("l_vib", "MOD-LFO-001", { freq: 5.5, depth: 1 }),
  add("l_osc1", "MOD-OSC-001", { fm_amt: 0.004 }),
  add("l_osc2", "MOD-OSC-001", { fm_amt: 0.004, tune: 0.012 }),
  add("l_osc3", "MOD-OSC-001", { fm_amt: 0.004, tune: -0.01 }),
  add("l_pre", "MOD-MIX-001", { level1: 0.5, level2: 0.45, level3: 0.45 }),
  add("l_env", "MOD-ENV-001", { attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.12 }),
  add("l_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("l_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("l_midi.PITCH", "l_osc1.pitch"),
  con("l_midi.PITCH", "l_osc2.pitch"),
  con("l_midi.PITCH", "l_osc3.pitch"),
  con("l_vib.tri", "l_osc1.fm"),
  con("l_vib.tri", "l_osc2.fm"),
  con("l_vib.tri", "l_osc3.fm"),
  con("l_osc1.saw", "l_pre.in1"),
  con("l_osc2.saw", "l_pre.in2"),
  con("l_osc3.saw", "l_pre.in3"),
  con("l_pre.out", "l_vca.in1"),
  con("l_midi.GATE", "l_env.gate"),
  con("l_env.env", "l_vca.cv2"),
  con("l_vca.out", "l_vel.in1"),
  con("l_midi.VEL", "l_vel.cv2"),
  // 主旋律の残響: 付点 8 分(0.326 秒)のディレイ。卓のセンドから送り、戻りは右へ
  add("l_dly", "MOD-DLY-001", { time: 0.326, feedback: 0.42, mix: 1 }),
  add("l_dvcf", "MOD-FLT-001", { cutoff: 3.2, res: 0.1 }),
  con("l_dly.out", "l_dvcf.in"),
  // --- 和音(ch 2): 鋸歯 2 本の 3 声。フィルタで丸め、ゆっくり立ち上げる ---
  add("p_midi", "MOD-IO-002", { channel: 2, voices: 3 }),
  add("p_osc1", "MOD-OSC-001"),
  add("p_osc2", "MOD-OSC-001", { tune: -0.009 }),
  add("p_pre", "MOD-MIX-001", { level1: 0.5, level2: 0.5 }),
  add("p_vcf", "MOD-FLT-001", { cutoff: 1.2, res: 0.15 }),
  add("p_env", "MOD-ENV-001", { attack: 0.6, decay: 1, sustain: 0.85, release: 1.2 }),
  add("p_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("p_midi.PITCH", "p_osc1.pitch"),
  con("p_midi.PITCH", "p_osc2.pitch"),
  con("p_osc1.saw", "p_pre.in1"),
  con("p_osc2.saw", "p_pre.in2"),
  con("p_pre.out", "p_vcf.in"),
  con("p_vcf.out", "p_vca.in1"),
  con("p_midi.GATE", "p_env.gate"),
  con("p_env.env", "p_vca.cv2"),
  // --- 低音(ch 3): 裏拍の鋸歯。短いエンベロープでフィルタを開く ---
  add("b_midi", "MOD-IO-002", { channel: 3, voices: 1 }),
  add("b_osc", "MOD-OSC-001"),
  add("b_env", "MOD-ENV-001", { attack: 0.002, decay: 0.14, sustain: 0.3, release: 0.05 }),
  add("b_vcf", "MOD-FLT-001", { cutoff: -0.3, res: 0.25, cv2_level: 0.22 }),
  add("b_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("b_midi.PITCH", "b_osc.pitch"),
  con("b_osc.saw", "b_vcf.in"),
  con("b_midi.GATE", "b_env.gate"),
  con("b_env.env", "b_vcf.cv2"),
  con("b_vcf.out", "b_vca.in1"),
  con("b_env.env", "b_vca.cv2"),
  // --- キック(ch 4): 正弦を、打った瞬間に高い所から一気に落とす ---
  add("k_midi", "MOD-IO-002", { channel: 4, voices: 1 }),
  add("k_osc", "MOD-OSC-001", { fm_amt: 0.3 }),
  add("k_penv", "MOD-ENV-001", { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 }),
  add("k_env", "MOD-ENV-001", { attack: 0.001, decay: 0.35, sustain: 0, release: 0.05 }),
  add("k_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("k_midi.PITCH", "k_osc.pitch"),
  con("k_midi.GATE", "k_penv.gate"),
  con("k_midi.GATE", "k_env.gate"),
  con("k_penv.env", "k_osc.fm"),
  con("k_osc.sine", "k_vca.in1"),
  con("k_env.env", "k_vca.cv2"),
  // --- ノイズ(ch 5): ハイハット(短い、弱い)とスネア(長め)を、音符の長さと強さで打ち分ける。高い所を少し削る ---
  add("n_midi", "MOD-IO-002", { channel: 5, voices: 1 }),
  add("n_nse", "MOD-NSE-001", { level: 9, seed: 5 }),
  add("n_vcf", "MOD-FLT-001", { cutoff: 5.2, res: 0.1 }),
  add("n_env", "MOD-ENV-001", { attack: 0.001, decay: 0.05, sustain: 0.25, release: 0.06 }),
  add("n_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("n_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("n_nse.out", "n_vcf.in"),
  con("n_vcf.out", "n_vca.in1"),
  con("n_midi.GATE", "n_env.gate"),
  con("n_env.env", "n_vca.cv2"),
  con("n_vca.out", "n_vel.in1"),
  con("n_midi.VEL", "n_vel.cv2"),
  // --- アルペジオ(ch 6): 細いパルス波の 16 分音符。短いエンベロープでフィルタを開く ---
  add("a_midi", "MOD-IO-002", { channel: 6, voices: 1 }),
  add("a_osc", "MOD-OSC-001", { pw: 0.3 }),
  add("a_env", "MOD-ENV-001", { attack: 0.001, decay: 0.09, sustain: 0.05, release: 0.05 }),
  add("a_vcf", "MOD-FLT-001", { cutoff: 1.5, res: 0.35, cv2_level: 0.3 }),
  add("a_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("a_midi.PITCH", "a_osc.pitch"),
  con("a_osc.pulse", "a_vcf.in"),
  con("a_midi.GATE", "a_env.gate"),
  con("a_env.env", "a_vcf.cv2"),
  con("a_vcf.out", "a_vca.in1"),
  con("a_env.env", "a_vca.cv2"),
  // --- ライザー(ch 7): 生の鋸歯。楽譜が tune を -1 → +1 へ 8 小節かけて動かす(2 オクターブ上がる)。フィルタは通さない ---
  add("r_midi", "MOD-IO-002", { channel: 7, voices: 1 }),
  add("r_osc", "MOD-OSC-001", { tune: -1 }),
  add("r_env", "MOD-ENV-001", { attack: 8, decay: 1, sustain: 1, release: 0.05 }),
  add("r_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("r_midi.PITCH", "r_osc.pitch"),
  con("r_osc.saw", "r_vca.in1"),
  con("r_midi.GATE", "r_env.gate"),
  con("r_env.env", "r_vca.cv2"),
  // --- まとめ: 卓。1 主旋律(センドでディレイへ)/ 2 ディレイの戻り(右)/ 3 和音 / 4 低音 / 5 キック / 6 ノイズ(少し右)/ 7 アルペジオ(少し左)/ 8 ライザー ---
  add("desk", "MOD-MIX-002", {
    "level[1]": 0.24, "send[1]": 1,
    "level[2]": 1, "pan[2]": 0.5,
    "level[3]": 0.18,
    "level[4]": 1,
    "level[5]": 0.9,
    "level[6]": 0.2, "pan[6]": 0.2,
    "level[7]": 0.48, "pan[7]": -0.35,
    "level[8]": 0.085,
    window_ms: 400,
  }),
  con("l_vel.out", "desk.in1"),
  con("l_dvcf.out", "desk.in2"),
  con("p_vca.out", "desk.in3"),
  con("b_vca.out", "desk.in4"),
  con("k_vca.out", "desk.in5"),
  con("n_vel.out", "desk.in6"),
  con("a_vca.out", "desk.in7"),
  con("r_vca.out", "desk.in8"),
  con("desk.SEND", "l_dly.in"),
  con("desk.L", "out.IN_L"),
  con("desk.R", "out.IN_R"),
  { command: "param.set", args: { module_id: "out", param: "level", value: 1.4 } },
];

// ---- 楽譜を書くための道具(単位は拍。1 小節 = 4 拍) ----
const par = (t, dur, module_id, param, value) => ({ t, ...(dur ? { dur } : {}), module_id, param, value });
const bars = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
// 和音(3 音)・アルペジオの 4 音・根音
const Am = { pad: [57, 60, 64], arp: [69, 72, 76, 81], root: 33 };
const F = { pad: [57, 60, 65], arp: [65, 69, 72, 77], root: 29 };
const C = { pad: [55, 60, 64], arp: [67, 72, 76, 79], root: 36 };
const G = { pad: [55, 59, 62], arp: [67, 71, 74, 79], root: 31 };
const PROG = [Am, Am, F, F, C, C, G, G];
/** 和音: 2 小節ずつのばす。 */
const pad = (from, to, vel = 80) => bars(from, to).filter((b) => b % 2 === 0).flatMap((b) => PROG[b].pad.map((note) => ({ t: b * 4, dur: 7.8, note, vel, ch: 2 })));
/** 低音: 8 分の裏拍(トランスの「ズン・ブン」の「ブン」)。 */
const bass = (bar) => [0.5, 1.5, 2.5, 3.5].map((x) => ({ t: bar * 4 + x, dur: 0.35, note: PROG[bar].root + 12, vel: 100, ch: 3 }));
/** キック: 4 つ打ち。 */
const kick = (bar) => [0, 1, 2, 3].map((x) => ({ t: bar * 4 + x, dur: 0.1, note: 24, vel: 120, ch: 4 }));
/** ハイハット: 8 分の裏。スネア(クラップの代わり)は 2 拍目と 4 拍目。 */
const hats = (bar, snare = false) => [
  ...[0.5, 1.5, 2.5, 3.5].map((x) => ({ t: bar * 4 + x, dur: 0.04, note: 60, vel: 70, ch: 5 })),
  ...(snare ? [1, 3].map((x) => ({ t: bar * 4 + x, dur: 0.14, note: 60, vel: 115, ch: 5 })) : []),
];
/** スネアの連打: 8 小節で 4 分 → 8 分 → 16 分と細かく、強くなる(ビルド)。 */
const roll = () => bars(0, 8).flatMap((b) => {
  const step = b < 4 ? 1 : b < 6 ? 0.5 : 0.25;
  return Array.from({ length: 4 / step }, (_, i) => ({ t: b * 4 + i * step, dur: 0.1, note: 60, vel: Math.min(127, 70 + b * 7), ch: 5 }));
});
/** アルペジオ: 16 分音符で、4 音を上がって下がる。 */
const arp = (bar, vel = 80) => [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3].map((k, i) => ({ t: bar * 4 + i * 0.25, dur: 0.18, note: PROG[bar].arp[k], vel: i % 4 === 0 ? vel + 12 : vel, ch: 6 }));
/** 主旋律: [拍, 長さ, ノート] の並び(拍は 8 小節の先頭から)。 */
const mel = (list, { vel = 100, oct = 0 } = {}) => list.map(([t, dur, note]) => ({ t, dur: dur * 0.92, note: note + oct * 12, vel, ch: 1 }));
// 主題(8 小節、A4〜C6)。長くのばす音でビブラートが聞こえる
const THEME = [
  [0, 1.5, 76], [1.5, 1.5, 81], [3, 1, 83],
  [4, 3, 84], [7, 1, 83],
  [8, 1.5, 81], [9.5, 1.5, 77], [11, 1, 76],
  [12, 3, 77], [15, 1, 79],
  [16, 1.5, 79], [17.5, 1.5, 84], [19, 1, 88],
  [20, 3, 88], [23, 1, 86],
  [24, 1.5, 83], [25.5, 1.5, 79], [27, 1, 86],
  [28, 4, 83],
];
const LEN = 32;
const score = (notes, params = []) => ({ tempo_bpm: 138, length: LEN, notes, params });

/** 1. 入り: キック・低音・ハイハット・和音。 */
const S1 = score([...bars(0, 8).flatMap(kick), ...bars(0, 8).flatMap(bass), ...bars(4, 8).flatMap((b) => hats(b)), ...pad(0, 8, 70)]);
/** 2. ブレイク: 打楽器を抜き、暗く小さくした和音の上で、主旋律(1 オクターブ上、A5〜E7)だけが前に出る(折り返しをいちばん聞き比べやすい所)。 */
const S2 = score([...pad(0, 8, 62), ...mel(THEME, { vel: 96, oct: 1 })], [par(0, 0, "p_vcf", "cutoff", 1), par(0, 32, "p_vcf", "cutoff", 1.6)]);
/** 3. ビルド: ライザー(生の鋸歯が C6 から C8 へ 2 オクターブ上がる)と、スネアの連打。後半にアルペジオが加わり、和音のフィルタを開いていく。 */
const S3 = score(
  [...pad(0, 8, 84), ...bars(4, 8).flatMap((b) => arp(b, 64)), ...roll(), { t: 0, dur: 31.8, note: 96, vel: 110, ch: 7 }],
  [par(0, 0, "r_osc", "tune", -1), par(0, 31.5, "r_osc", "tune", 1), par(0, 30, "a_vcf", "cutoff", 3.2), par(0, 30, "p_vcf", "cutoff", 3)],
);
/** 4. ドロップ: 全部。主旋律は主題のまま。 */
const S4 = score(
  [...bars(0, 8).flatMap(kick), ...bars(0, 8).flatMap(bass), ...bars(0, 8).flatMap((b) => hats(b, true)), ...pad(0, 8, 76), ...bars(0, 8).flatMap((b) => arp(b, 74)), ...mel(THEME, { vel: 108 })],
  [par(0, 0, "p_vcf", "cutoff", 1.6), par(0, 0, "a_vcf", "cutoff", 1.8)],
);
/** 5. ドロップ(高く): 主旋律を 1 オクターブ上(A5〜C7)で。いちばん折り返しが出る所。 */
const S5 = score(
  [...bars(0, 8).flatMap(kick), ...bars(0, 8).flatMap(bass), ...bars(0, 8).flatMap((b) => hats(b, true)), ...pad(0, 8, 76), ...bars(0, 8).flatMap((b) => arp(b, 74)), ...mel(THEME, { vel: 104, oct: 1 })],
);
/** 6. 終わり(4 小節): 主旋律の最後の音を高くのばし、キックの一撃で止める。 */
const S6 = {
  tempo_bpm: 138, length: 16,
  notes: [
    ...kick(0), ...kick(1), ...bass(0), ...bass(1), ...hats(0, true), ...hats(1, true),
    ...pad(0, 2, 80),
    ...mel([[0, 1.5, 88], [1.5, 1.5, 93], [3, 1, 95], [4, 8, 93]], { vel: 104 }),
    ...Am.pad.map((note) => ({ t: 8, dur: 6, note, vel: 80, ch: 2 })),
    { t: 8, dur: 0.1, note: 24, vel: 127, ch: 4 },
    { t: 8, dur: 0.3, note: 60, vel: 120, ch: 5 },
  ],
  params: [par(8, 6, "desk", "master", 0.15)],
};

/** 音像の確かめ(demo/mixcheck.mjs): 卓のチャンネルと役割。 */
export const MIX = { style: "trance", desk: "desk", channels: { 1: "lead", 2: "delay", 3: "pad", 4: "bass", 5: "kick", 6: "perc", 7: "arp", 8: "riser" } };

/** 区間(パラメータの動きは楽譜の中にある)。 */
export const SECTIONS = [
  { name: "入り", score: S1, params: [] },
  { name: "ブレイク", score: S2, params: [] },
  { name: "ビルド", score: S3, params: [] },
  { name: "ドロップ", score: S4, params: [] },
  { name: "ドロップ(高く)", score: S5, params: [] },
  { name: "終わり", score: S6, params: [] },
];
