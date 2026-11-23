// エージェント(Claude Code)が書いたダークテクノ。1 分 132 拍、イ調(フリギア風: ラ・シ♭・ソを使う)。
// 8 小節(32 拍 = 約 14.5 秒)の楽譜 × 6: 導入 → 低音 → 全部 → ブレイク → 山場 → 終わり。
// チャンネル: 1 = キック、2 = ハイハット(ノイズ)、3 = 低音、4 = 和音のスタブ。
// 区間が変わるところで、エージェントがフィルタやディレイのパラメータも動かす(param.set)。

const add = (id, type, params) => ({ command: "module.add", args: { id, type, ...(params ? { params } : {}) } });
const con = (from, to) => {
  const [fm, fp] = from.split(".");
  const [tm, tp] = to.split(".");
  return { command: "cable.connect", args: { from: { module: fm, port: fp }, to: { module: tm, port: tp } } };
};
const set = (module_id, param, value) => ({ module_id, param, value });

export const TITLE = "ダークテクノ(132 BPM)";

export const PATCH = [
  // --- キック(ch 1): 正弦波。ピッチ用のエンベロープで、打った瞬間だけ音程を 3 オクターブ上げて落とす ---
  add("k_midi", "MOD-IO-002", { channel: 1 }),
  add("k_osc", "MOD-OSC-001", { fm_amt: 0.3 }),
  add("k_penv", "MOD-ENV-001", { attack: 0.001, decay: 0.055, sustain: 0, release: 0.02 }),
  add("k_env", "MOD-ENV-001", { attack: 0.001, decay: 0.28, sustain: 0, release: 0.05 }),
  add("k_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("k_midi.PITCH", "k_osc.pitch"),
  con("k_midi.GATE", "k_penv.gate"),
  con("k_midi.GATE", "k_env.gate"),
  con("k_penv.env", "k_osc.fm"),
  con("k_osc.sine", "k_vca.in1"),
  con("k_env.env", "k_vca.cv2"),
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
  // --- 低音(ch 3): ノコギリ波を、効きの強いフィルタで絞る。ゆっくりした LFO でフィルタが少しずつ動く ---
  add("b_midi", "MOD-IO-002", { channel: 3 }),
  add("b_osc", "MOD-OSC-001"),
  add("b_env", "MOD-ENV-001", { attack: 0.002, decay: 0.14, sustain: 0.4, release: 0.05 }),
  add("b_vcf", "MOD-FLT-001", { cutoff: -1.5, res: 0.6, cv2_level: 0.25, cv3_level: 0.12 }),
  add("b_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("b_lfo", "MOD-LFO-001", { freq: 0.035 }),
  con("b_midi.PITCH", "b_osc.pitch"),
  con("b_midi.GATE", "b_env.gate"),
  con("b_osc.saw", "b_vcf.in"),
  con("b_env.env", "b_vcf.cv2"),
  con("b_lfo.tri", "b_vcf.cv3"),
  con("b_vcf.out", "b_vca.in1"),
  con("b_env.env", "b_vca.cv2"),
  // --- スタブ(ch 4): 短い暗い和音(3 声)。ディレイで尾を引かせる ---
  add("s_midi", "MOD-IO-002", { channel: 4, voices: 3 }),
  add("s_osc", "MOD-OSC-001"),
  add("s_env", "MOD-ENV-001", { attack: 0.002, decay: 0.18, sustain: 0, release: 0.12 }),
  add("s_vcf", "MOD-FLT-001", { cutoff: -0.3, res: 0.35, cv2_level: 0.3 }),
  add("s_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("s_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("s_dly", "MOD-DLY-001", { time: 0.3409, feedback: 0.5, mix: 1 }), // 付点 8 分(0.75 拍)
  con("s_midi.PITCH", "s_osc.pitch"),
  con("s_midi.GATE", "s_env.gate"),
  con("s_osc.saw", "s_vcf.in"),
  con("s_env.env", "s_vcf.cv2"),
  con("s_vcf.out", "s_vca.in1"),
  con("s_env.env", "s_vca.cv2"),
  con("s_vca.out", "s_vel.in1"),
  con("s_midi.VEL", "s_vel.cv2"),
  con("s_vel.out", "s_dly.in"),
  // --- まとめ: キック・ハット・低音は中央。スタブは左に元の音、右にディレイ ---
  add("mix", "MOD-MIX-001", { level1: 0.62, level2: 0.5, level3: 1, master: 1 }),
  add("mixl", "MOD-MIX-001", { level1: 1, level2: 1, level3: 0.4, master: 1 }),
  add("mixr", "MOD-MIX-001", { level1: 1, level2: 0.35, level3: 1, master: 1 }),
  con("k_vca.out", "mix.in1"),
  con("h_vel.out", "mix.in2"),
  con("b_vca.out", "mix.in3"),
  con("mix.out", "mixl.in1"),
  con("s_vel.out", "mixl.in2"),
  con("s_dly.out", "mixl.in3"),
  con("mix.out", "mixr.in1"),
  con("s_vel.out", "mixr.in2"),
  con("s_dly.out", "mixr.in3"),
  con("mixl.out", "out.IN_L"),
  con("mixr.out", "out.IN_R"),
];

// ---- 楽譜を書くための道具(単位は拍。1 小節 = 4 拍) ----
const KICK = 24; // C1(約 33 Hz)。打った瞬間はピッチ用のエンベロープで高くなる
const A1 = 33, Bb1 = 34, G1 = 31, A2 = 45, E2 = 40;
const Am = [57, 60, 64], Bb = [58, 62, 65], Gm = [55, 58, 62];
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

const score = (notes) => ({ tempo_bpm: 132, length: 32, notes });

/** 1. 導入: キックと裏拍のハットだけ。7 小節目から低音が遠くで鳴り始める。 */
const S1 = score([
  ...bars(0, 8).flatMap(kick4),
  ...bars(2, 8).flatMap((b) => hats(b)),
  ...bars(6, 8).flatMap((b) => bassBar(b, BASS_A, 70)),
]);
/** 2. 低音が入る。ハットに 16 分の弱い音が加わる。 */
const S2 = score([
  ...bars(0, 8).flatMap(kick4),
  ...bars(0, 8).flatMap((b) => hats(b, { ghost: b >= 4, open: b % 4 === 3 })),
  ...bars(0, 8).flatMap((b) => bassBar(b, b % 4 === 3 ? BASS_B : BASS_A)),
  ...stabs(7, [[3.25, Am, 70]]), // 次の区間の予告
]);
/** 3. 全部そろう: スタブとクラップ。 */
const S3 = score([
  ...bars(0, 8).flatMap(kick4),
  ...bars(0, 8).flatMap((b) => hats(b, { ghost: true, open: b % 2 === 1, clap: true })),
  ...bars(0, 8).flatMap((b) => bassBar(b, b % 4 === 3 ? BASS_B : BASS_A)),
  ...bars(0, 8).flatMap((b) => stabs(b, b % 2 === 0 ? STAB_1 : STAB_2)),
]);
/** 4. ブレイク: キックが消え、低音はこもる。スタブが増えてディレイが渦を巻く。後半でキックが戻り、連打で盛り上げる。 */
const S4 = score([
  ...bars(0, 4).flatMap((b) => bassBar(b, BASS_A, 84)),
  ...bars(0, 4).flatMap((b) => stabs(b, [[0, Am, 90], [1.5, Am, 70], [2.75, b % 2 ? Gm : Bb, 100]])),
  ...bars(2, 4).flatMap((b) => hats(b)),
  ...bars(4, 6).flatMap(kick4),
  ...kickRoll(6, 0.5),
  ...kickRoll(7, 0.25),
  ...bars(4, 8).flatMap((b) => hats(b, { ghost: true })),
  ...bars(4, 8).flatMap((b) => bassBar(b, BASS_C, 96)),
  ...bars(4, 8).flatMap((b) => stabs(b, [[0.75, Am, 80 + (b - 4) * 10], [2.5, Bb, 80 + (b - 4) * 10]])),
]);
/** 5. 山場: 低音が動き、フィルタが開く。 */
const S5 = score([
  ...bars(0, 8).flatMap(kick4),
  ...bars(0, 8).flatMap((b) => hats(b, { ghost: true, open: true, clap: true })),
  ...bars(0, 8).flatMap((b) => bassBar(b, b % 2 === 0 ? BASS_C : BASS_B, 108)),
  ...bars(0, 8).flatMap((b) => stabs(b, b % 2 === 0 ? [...STAB_1, [3.5, Gm, 92]] : STAB_2)),
]);
/** 6. 終わり: 1 つずつ減らす。最後はキック 1 発と、ディレイの尾。 */
const S6 = {
  tempo_bpm: 132, length: 36,
  notes: [
    ...bars(0, 6).flatMap(kick4),
    ...bars(0, 4).flatMap((b) => hats(b, { ghost: b < 2, open: b % 2 === 1 })),
    ...bars(0, 6).flatMap((b) => bassBar(b, BASS_A, 100 - b * 8)),
    ...bars(0, 2).flatMap((b) => stabs(b, b % 2 === 0 ? STAB_1 : STAB_2)),
    ...stabs(4, [[0.75, Am, 90]]),
    { t: 24, dur: 0.2, note: KICK, vel: 120, ch: 1 },
    ...stabs(6, [[0, Am, 110]]),
  ],
};

/** 区間: 楽譜と、その区間に入った時点でエージェントが動かすパラメータ。 */
export const SECTIONS = [
  { name: "導入", score: S1, params: [set("b_vcf", "cutoff", -2.4), set("s_dly", "feedback", 0.5)] },
  { name: "低音", score: S2, params: [set("b_vcf", "cutoff", -1.6)] },
  { name: "全部", score: S3, params: [set("b_vcf", "cutoff", -1.1), set("b_vcf", "res", 0.65)] },
  { name: "ブレイク", score: S4, params: [set("b_vcf", "cutoff", -2.3), set("s_dly", "feedback", 0.72), set("s_vcf", "cutoff", 0.4)] },
  { name: "山場", score: S5, params: [set("b_vcf", "cutoff", -0.5), set("b_vcf", "res", 0.75), set("s_dly", "feedback", 0.5), set("s_vcf", "cutoff", 0.1)] },
  { name: "終わり", score: S6, params: [set("b_vcf", "cutoff", -1.6), set("b_vcf", "res", 0.6), set("s_dly", "feedback", 0.62)] },
];
