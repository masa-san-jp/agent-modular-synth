// エージェント(Claude Code)が書いたダークテクノ。1 分 130 拍、イ調(フリギア風: ラ・シ♭・ソを使う)。
// 8 小節(32 拍 = 約 14.5 秒)の楽譜 × 6: 導入 → 低音 → 全部 → ブレイク → 山場 → 終わり。
// チャンネル: 1 = キック、2 = ハイハット(ノイズ)、3 = 低音、4 = 和音のスタブ、5 = 低い持続音(ドローン)。
// フィルタやディレイの動きは、楽譜の中に書いてある(params)。拍に正確に合い、パッチは変えない。
// 音量の配分は、ミキサー卓(MOD-MIX-002)のメーターを読んで決める(エージェントは音を聞けないので、数値で確かめる)。
// 重さを出す工夫: キックと低音を歪ませる(MOD-SAT-001)、キックの残響を低域だけ残す(ランブル)、低音は少しずらした 2 つのノコギリ波 + 矩形波の 3 層、
// スタブも 2 層、低い持続音が下で鳴り続ける。

const add = (id, type, params) => ({ command: "module.add", args: { id, type, ...(params ? { params } : {}) } });
const con = (from, to) => {
  const [fm, fp] = from.split(".");
  const [tm, tp] = to.split(".");
  return { command: "cable.connect", args: { from: { module: fm, port: fp }, to: { module: tm, port: tp } } };
};
const set = (module_id, param, value) => ({ module_id, param, value });

export const TITLE = "ダークテクノ(130 BPM、歪みつきの重い版)";

export const PATCH = [
  // --- キック(ch 1): 正弦波。ピッチ用のエンベロープで、打った瞬間だけ音程を上げて落とす。余韻を長めにして胴鳴りを出す ---
  add("k_midi", "MOD-IO-002", { channel: 1 }),
  add("k_osc", "MOD-OSC-001", { fm_amt: 0.32 }),
  add("k_penv", "MOD-ENV-001", { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 }),
  add("k_env", "MOD-ENV-001", { attack: 0.001, decay: 0.42, sustain: 0, release: 0.08 }),
  add("k_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("k_midi.PITCH", "k_osc.pitch"),
  con("k_midi.GATE", "k_penv.gate"),
  con("k_midi.GATE", "k_env.gate"),
  con("k_penv.env", "k_osc.fm"),
  con("k_osc.sine", "k_vca.in1"),
  con("k_env.env", "k_vca.cv2"),
  // キックを歪ませて倍音を足す(小さいスピーカーでも聞こえる芯ができ、押し出しが強くなる)
  add("k_sat", "MOD-SAT-001", { drive: 15, bias: 0.12, level: 0.8 }),
  con("k_vca.out", "k_sat.in"),
  // --- ランブル: キックをディレイで繰り返し、低域だけを残す。キックの合間が低い唸りで埋まる ---
  add("r_dly", "MOD-DLY-001", { time: 0.1731, feedback: 0.55, mix: 1 }), // 16 分音符 1.5 個ぶん
  add("r_vcf", "MOD-FLT-001", { cutoff: -1.9, res: 0.2 }),
  con("k_sat.out", "r_dly.in"),
  con("r_dly.out", "r_vcf.in"),
  // --- ハイハット(ch 2): ノイズを短く切る。音符が長いとオープン。強さ(ベロシティ)で音量が変わる ---
  add("h_midi", "MOD-IO-002", { channel: 2 }),
  add("h_nse", "MOD-NSE-001", { level: 5, seed: 7 }),
  add("h_env", "MOD-ENV-001", { attack: 0.001, decay: 0.035, sustain: 0.22, release: 0.06 }),
  add("h_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("h_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("h_midi.GATE", "h_env.gate"),
  con("h_nse.out", "h_vca.in1"),
  con("h_env.env", "h_vca.cv2"),
  con("h_vca.out", "h_vel.in1"),
  con("h_midi.VEL", "h_vel.cv2"),
  // --- 低音(ch 3): 少しずらした 2 つのノコギリ波と矩形波を重ね、効きの強いフィルタで絞る。ゆっくりした LFO でフィルタが少しずつ動く ---
  add("b_midi", "MOD-IO-002", { channel: 3 }),
  add("b_osc", "MOD-OSC-001"),
  add("b_osc2", "MOD-OSC-001", { tune: 0.012 }),
  add("b_osc3", "MOD-OSC-001", { tune: -0.008, pw: 0.3 }),
  add("b_pre", "MOD-MIX-001", { level1: 0.6, level2: 0.6, level3: 0.5 }),
  add("b_env", "MOD-ENV-001", { attack: 0.002, decay: 0.16, sustain: 0.45, release: 0.06 }),
  add("b_vcf", "MOD-FLT-001", { cutoff: -1.5, res: 0.6, cv2_level: 0.25, cv3_level: 0.12 }),
  add("b_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("b_lfo", "MOD-LFO-001", { freq: 0.035 }),
  con("b_midi.PITCH", "b_osc.pitch"),
  con("b_midi.PITCH", "b_osc2.pitch"),
  con("b_midi.PITCH", "b_osc3.pitch"),
  con("b_midi.GATE", "b_env.gate"),
  con("b_osc.saw", "b_pre.in1"),
  con("b_osc2.saw", "b_pre.in2"),
  con("b_osc3.pulse", "b_pre.in3"),
  con("b_pre.out", "b_vcf.in"),
  con("b_env.env", "b_vcf.cv2"),
  con("b_lfo.tri", "b_vcf.cv3"),
  // 低音を歪ませる: フィルタの後で曲げるので、唸るような倍音が乗る。歪みの量は楽譜が動かす
  add("b_sat", "MOD-SAT-001", { drive: 14, bias: 0.2, level: 0.7 }),
  con("b_vcf.out", "b_sat.in"),
  con("b_sat.out", "b_vca.in1"),
  con("b_env.env", "b_vca.cv2"),
  // --- スタブ(ch 4): 短い暗い和音(3 声)。少しずらした 2 層。ディレイで尾を引かせる ---
  add("s_midi", "MOD-IO-002", { channel: 4, voices: 4 }),
  add("s_osc", "MOD-OSC-001"),
  add("s_osc2", "MOD-OSC-001", { tune: 0.015 }),
  add("s_pre", "MOD-MIX-001", { level1: 0.95, level2: 0.95 }),
  add("s_env", "MOD-ENV-001", { attack: 0.002, decay: 0.22, sustain: 0, release: 0.16 }),
  add("s_vcf", "MOD-FLT-001", { cutoff: -0.3, res: 0.4, cv2_level: 0.3 }),
  add("s_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("s_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("s_dly", "MOD-DLY-001", { time: 0.3462, feedback: 0.5, mix: 1 }), // 付点 8 分(0.75 拍)
  con("s_midi.PITCH", "s_osc.pitch"),
  con("s_midi.PITCH", "s_osc2.pitch"),
  con("s_midi.GATE", "s_env.gate"),
  con("s_osc.saw", "s_pre.in1"),
  con("s_osc2.saw", "s_pre.in2"),
  con("s_pre.out", "s_vcf.in"),
  con("s_env.env", "s_vcf.cv2"),
  con("s_vcf.out", "s_vca.in1"),
  con("s_env.env", "s_vca.cv2"),
  con("s_vca.out", "s_vel.in1"),
  con("s_midi.VEL", "s_vel.cv2"),
  // --- ドローン(ch 5): 低いラとミを鳴らし続ける。ゆっくり立ち上がり、フィルタの開き具合は楽譜が動かす ---
  add("d_midi", "MOD-IO-002", { channel: 5, voices: 2 }),
  add("d_osc", "MOD-OSC-001"),
  add("d_osc2", "MOD-OSC-001", { tune: -0.01 }),
  add("d_pre", "MOD-MIX-001", { level1: 0.6, level2: 0.6 }),
  add("d_env", "MOD-ENV-001", { attack: 2.5, decay: 1, sustain: 0.8, release: 3 }),
  add("d_vcf", "MOD-FLT-001", { cutoff: -2.6, res: 0.3 }),
  add("d_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("d_midi.PITCH", "d_osc.pitch"),
  con("d_midi.PITCH", "d_osc2.pitch"),
  con("d_midi.GATE", "d_env.gate"),
  con("d_osc.saw", "d_pre.in1"),
  con("d_osc2.saw", "d_pre.in2"),
  con("d_pre.out", "d_vcf.in"),
  con("d_vcf.out", "d_vca.in1"),
  con("d_env.env", "d_vca.cv2"),
  // --- まとめ: ミキサー卓(MOD-MIX-002)。チャンネルごとの音量は、最初は仮の値。演奏の前に、卓のメーターを読んで決める(サウンドチェック) ---
  //   1 キック / 2 ランブル / 3 低音 / 4 ハット / 5 スタブ(左寄り。センドでディレイへ)/ 6 ディレイの戻り(右寄り)/ 7 ドローン
  add("desk", "MOD-MIX-002", { "pan[5]": -0.45, "send[5]": 1, "pan[6]": 0.55, "pan[4]": 0.15, window_ms: 400 }),
  con("k_sat.out", "desk.in1"),
  con("r_vcf.out", "desk.in2"),
  con("b_vca.out", "desk.in3"),
  con("h_vel.out", "desk.in4"),
  con("s_vel.out", "desk.in5"),
  con("s_dly.out", "desk.in6"),
  con("d_vca.out", "desk.in7"),
  con("desk.SEND", "s_dly.in"),
  con("desk.L", "out.IN_L"),
  con("desk.R", "out.IN_R"),
  // 卓の出力を、出力モジュールで持ち上げる(卓の中に余裕を残したまま、最後の段で音量を稼ぐ。大きすぎる分は製品のリミッターが抑える)
  { command: "param.set", args: { module_id: "out", param: "level", value: 1.8 } },
];

// ---- 楽譜を書くための道具(単位は拍。1 小節 = 4 拍) ----
const KICK = 24; // C1(約 33 Hz)。打った瞬間はピッチ用のエンベロープで高くなる
const A1 = 33, Bb1 = 34, G1 = 31, A2 = 45, E2 = 40;
const Am = [45, 52, 57, 60], Bb = [46, 53, 58, 62], Gm = [43, 50, 55, 58]; // 低い位置の和音(根音を下に重ねる)
/** ドローン: 低いラとミを、区間の最初から最後まで鳴らす。 */
const drone = (from, to, vel = 90) => [33, 40].map((note) => ({ t: from * 4, dur: (to - from) * 4, note, vel, ch: 5 }));
/** パラメータの変化: 位置(拍)、長さ(拍。0 なら切り替え)、モジュール、パラメータ、値。 */
const par = (t, dur, module_id, param, value) => ({ t, ...(dur ? { dur } : {}), module_id, param, value });
const bars = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);

/** キック: 各拍の頭(4 つ打ち)。 */
const kick4 = (bar) => [0, 1, 2, 3].map((b) => ({ t: bar * 4 + b, dur: 0.2, note: KICK, vel: 120, ch: 1 }));
/** キックの連打(盛り上げ): step 拍ごと。 */
const kickRoll = (bar, step) => Array.from({ length: Math.round(4 / step) }, (_, i) => ({ t: bar * 4 + i * step, dur: step * 0.5, note: KICK, vel: 120, ch: 1 }));
/** ハイハット: 裏拍(各拍の半分)。ghost で 16 分の弱い音を足す。open で 4 拍目の裏をオープンにする。 */
const hats = (bar, { ghost = false, open = false, clap = false } = {}) => {
  const out = [];
  for (let b = 0; b < 4; b++) {
    const isOpen = open && b === 3;
    out.push({ t: bar * 4 + b + 0.5, dur: isOpen ? 0.4 : 0.08, note: 60, vel: isOpen ? 110 : 96, ch: 2 });
    if (ghost) {
      out.push({ t: bar * 4 + b + 0.25, dur: 0.05, note: 60, vel: 34, ch: 2 });
      out.push({ t: bar * 4 + b + 0.75, dur: 0.05, note: 60, vel: 46, ch: 2 });
    }
  }
  // クラップの代わり: 2 拍目と 4 拍目の頭に、少し長いノイズ
  if (clap) for (const b of [1, 3]) out.push({ t: bar * 4 + b, dur: 0.16, note: 60, vel: 78, ch: 2 });
  return out;
};
/** 低音: キックの位置(各拍の頭)を空けて、16 分音符 3 つずつ転がす。pattern は 1 小節 12 音。 */
const bassBar = (bar, pattern, vel = 100) => {
  const out = [];
  pattern.forEach((note, i) => {
    if (note === null) return;
    const beat = Math.floor(i / 3);
    const sub = (i % 3) + 1;
    out.push({ t: bar * 4 + beat + sub * 0.25, dur: 0.2, note, vel: sub === 2 ? vel : vel - 14, ch: 3 });
  });
  return out;
};
const BASS_A = [A1, A1, A1, A1, A1, A2, A1, A1, A1, A1, G1, A1];
const BASS_B = [A1, A1, A1, A1, A1, A2, Bb1, Bb1, Bb1, Bb1, A1, G1];
const BASS_C = [A1, A2, A1, A1, E2, A1, A1, A2, A1, Bb1, A2, G1];
/** スタブ: [拍の位置, 和音, 強さ] の並び。短く切る。 */
const stabs = (bar, list) => list.flatMap(([t, chord, vel = 100]) => chord.map((note) => ({ t: bar * 4 + t, dur: 0.22, note, vel, ch: 4 })));
const STAB_1 = [[0.75, Am, 104], [2.5, Am, 84]];
const STAB_2 = [[1.75, Am, 96], [3.25, Bb, 108]];

const score = (notes, params = []) => ({ tempo_bpm: 130, length: 32, notes, params });

/** 1. 導入: キックとランブル、下でドローンが立ち上がる。裏拍のハットが入り、終わりに低音が遠くで鳴り始める。 */
const S1 = score(
  [
    ...bars(0, 8).flatMap(kick4),
    ...bars(2, 8).flatMap((b) => hats(b)),
    ...bars(6, 8).flatMap((b) => bassBar(b, BASS_A, 70)),
    ...drone(0, 8),
  ],
  [par(0, 0, "b_vcf", "cutoff", -2.6), par(0, 0, "d_vcf", "cutoff", -3), par(0, 32, "d_vcf", "cutoff", -1.8), par(24, 8, "b_vcf", "cutoff", -1.8)],
);
/** 2. 低音が入る。ハットに 16 分の弱い音が加わる。フィルタが少しずつ開く。 */
const S2 = score(
  [
    ...bars(0, 8).flatMap(kick4),
    ...bars(0, 8).flatMap((b) => hats(b, { ghost: b >= 4, open: b % 4 === 3 })),
    ...bars(0, 8).flatMap((b) => bassBar(b, b % 4 === 3 ? BASS_B : BASS_A)),
    ...stabs(7, [[3.25, Am, 70]]), // 次の区間の予告
    ...drone(0, 8),
  ],
  [par(0, 32, "b_vcf", "cutoff", -1.2), par(0, 0, "b_vcf", "res", 0.62)],
);
/** 3. 全部そろう: スタブとクラップ。 */
const S3 = score(
  [
    ...bars(0, 8).flatMap(kick4),
    ...bars(0, 8).flatMap((b) => hats(b, { ghost: true, open: b % 2 === 1, clap: true })),
    ...bars(0, 8).flatMap((b) => bassBar(b, b % 4 === 3 ? BASS_B : BASS_A)),
    ...bars(0, 8).flatMap((b) => stabs(b, b % 2 === 0 ? STAB_1 : STAB_2)),
    ...drone(0, 8),
  ],
  [par(0, 0, "b_vcf", "cutoff", -1.1), par(0, 0, "b_vcf", "res", 0.68), par(0, 32, "d_vcf", "cutoff", -1.2)],
);
/** 4. ブレイク: キックが消え、低音はこもる。ドローンが開き、スタブのディレイが渦を巻く。後半でキックが戻り、フィルタが 4 小節かけて開いていく。 */
const S4 = score(
  [
    ...bars(0, 4).flatMap((b) => bassBar(b, BASS_A, 84)),
    ...bars(0, 4).flatMap((b) => stabs(b, [[0, Am, 90], [1.5, Am, 70], [2.75, b % 2 ? Gm : Bb, 100]])),
    ...bars(2, 4).flatMap((b) => hats(b)),
    ...bars(4, 6).flatMap(kick4),
    ...kickRoll(6, 0.5),
    ...kickRoll(7, 0.25),
    ...bars(4, 8).flatMap((b) => hats(b, { ghost: true })),
    ...bars(4, 8).flatMap((b) => bassBar(b, BASS_C, 96)),
    ...bars(4, 8).flatMap((b) => stabs(b, [[0.75, Am, 80 + (b - 4) * 10], [2.5, Bb, 80 + (b - 4) * 10]])),
    ...drone(0, 8, 110),
  ],
  [
    par(0, 0, "b_vcf", "cutoff", -2.5),
    par(0, 0, "s_dly", "feedback", 0.74),
    par(0, 16, "d_vcf", "cutoff", 0.2), // ドローンが開く
    par(0, 16, "s_vcf", "cutoff", 0.6),
    par(16, 16, "b_vcf", "cutoff", 0.2), // 後半: 低音のフィルタが開いていく
    par(16, 16, "b_vcf", "res", 0.8),
    par(16, 16, "b_sat", "drive", 24), // 歪みも強くなっていく
    par(16, 16, "d_vcf", "cutoff", -1),
  ],
);
/** 5. 山場: 低音が動き、フィルタが開いたまま。 */
const S5 = score(
  [
    ...bars(0, 8).flatMap(kick4),
    ...bars(0, 8).flatMap((b) => hats(b, { ghost: true, open: true, clap: true })),
    ...bars(0, 8).flatMap((b) => bassBar(b, b % 2 === 0 ? BASS_C : BASS_B, 108)),
    ...bars(0, 8).flatMap((b) => stabs(b, b % 2 === 0 ? [...STAB_1, [3.5, Gm, 92]] : STAB_2)),
    ...drone(0, 8, 100),
  ],
  [
    par(0, 0, "b_vcf", "cutoff", -0.5),
    par(0, 0, "b_vcf", "res", 0.75),
    par(0, 0, "s_dly", "feedback", 0.5),
    par(0, 0, "s_vcf", "cutoff", 0.1),
    par(0, 0, "d_vcf", "cutoff", -1.4),
    par(0, 0, "b_sat", "drive", 20),
    par(0, 0, "k_sat", "drive", 18),
    par(16, 16, "b_vcf", "cutoff", -0.1),
  ],
);
/** 6. 終わり: 1 つずつ減らし、フィルタが閉じていく。最後はキック 1 発と、ディレイの尾。 */
const S6 = {
  tempo_bpm: 130, length: 38,
  notes: [
    ...bars(0, 6).flatMap(kick4),
    ...bars(0, 4).flatMap((b) => hats(b, { ghost: b < 2, open: b % 2 === 1 })),
    ...bars(0, 6).flatMap((b) => bassBar(b, BASS_A, 100 - b * 8)),
    ...bars(0, 2).flatMap((b) => stabs(b, b % 2 === 0 ? STAB_1 : STAB_2)),
    ...stabs(4, [[0.75, Am, 90]]),
    { t: 24, dur: 0.2, note: KICK, vel: 120, ch: 1 },
    ...stabs(6, [[0, Am, 110]]),
    ...drone(0, 7, 90),
  ],
  params: [par(0, 16, "b_sat", "drive", 12), par(0, 0, "k_sat", "drive", 15), par(0, 24, "b_vcf", "cutoff", -2.6), par(0, 0, "b_vcf", "res", 0.6), par(0, 0, "s_dly", "feedback", 0.66), par(0, 28, "d_vcf", "cutoff", -3)],
};

/**
 * サウンドチェックの設定: 卓のメーター(meter.read)を読んで、チャンネルごとの音量を決める。
 * `targets` は、チャンネル番号 → 目標の音量(実効値 [V]。±5 V が基準)。キックを一番大きく、低音がそれに続く配分。
 * `score` は、全パートが鳴る区間(山場)。`outPeak` は、卓の出力の最大の目標 [V]。
 */
export const SOUNDCHECK = {
  desk: "desk",
  score: S5,
  targets: { 1: 1.0, 2: 0.3, 3: 0.75, 4: 0.24, 5: 0.26, 6: 0.18, 7: 0.24 },
  names: { 1: "キック", 2: "ランブル", 3: "低音", 4: "ハット", 5: "スタブ", 6: "ディレイ", 7: "ドローン" },
  outPeak: 4.6,
  settleSeconds: 6, // ドローンがゆっくり立ち上がる(2.5 秒)のを待つ
};

/** 区間: 楽譜(パラメータの動きも楽譜の中にある)。 */
export const SECTIONS = [
  { name: "導入", score: S1, params: [] },
  { name: "低音", score: S2, params: [] },
  { name: "全部", score: S3, params: [] },
  { name: "ブレイク", score: S4, params: [] },
  { name: "山場", score: S5, params: [] },
  { name: "終わり", score: S6, params: [] },
];
