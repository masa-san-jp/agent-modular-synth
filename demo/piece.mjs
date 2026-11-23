// エージェント(Claude Code)が書いた楽譜と、それを鳴らすためのパッチ。
// 曲: イ短調、1 分 96 拍、4 小節 × 4 つの楽譜(各 16 拍 = 10 秒)。和音の進行は Am → F → C → G(最後だけ Am → F → G → Am)。
// チャンネル 1 = 分散和音と旋律(MIDI-CV、6 声)、チャンネル 2 = 低音(MIDI-CV、1 声)。

const add = (id, type, params) => ({ command: "module.add", args: { id, type, ...(params ? { params } : {}) } });
const con = (from, to) => {
  const [fm, fp] = from.split(".");
  const [tm, tp] = to.split(".");
  return { command: "cable.connect", args: { from: { module: fm, port: fp }, to: { module: tm, port: tp } } };
};

/** パッチ: 上の声部(ノコギリ波 → フィルタ → VCA)と低音(矩形波 → フィルタ → VCA)をミキサーでまとめ、ディレイを通して左右へ。 */
export const PATCH = [
  // 上の声部(チャンネル 1、6 声)
  add("midi", "MOD-IO-002", { channel: 1, voices: 6 }),
  add("vco", "MOD-OSC-001"),
  add("env", "MOD-ENV-001", { attack: 0.005, decay: 0.25, sustain: 0.35, release: 0.35 }),
  add("vcf", "MOD-FLT-001", { cutoff: 0.5, res: 0.25, cv2_level: 0.35 }),
  add("vca", "MOD-AMP-001"),
  con("midi.PITCH", "vco.pitch"),
  con("midi.GATE", "env.gate"),
  con("vco.saw", "vcf.in"),
  con("env.env", "vcf.cv2"), // 音の出だしでフィルタが開く
  con("vcf.out", "vca.in1"),
  con("env.env", "vca.cv1"),
  // 低音(チャンネル 2、1 声)
  add("midi2", "MOD-IO-002", { channel: 2 }),
  add("vco2", "MOD-OSC-001", { pw: 0.35 }),
  add("env2", "MOD-ENV-001", { attack: 0.01, decay: 0.4, sustain: 0.5, release: 0.25 }),
  add("vcf2", "MOD-FLT-001", { cutoff: -1, res: 0.1, cv2_level: 0.2 }),
  add("vca2", "MOD-AMP-001"),
  con("midi2.PITCH", "vco2.pitch"),
  con("midi2.GATE", "env2.gate"),
  con("vco2.pulse", "vcf2.in"),
  con("env2.env", "vcf2.cv2"),
  con("vcf2.out", "vca2.in1"),
  con("env2.env", "vca2.cv1"),
  // まとめて、ディレイで広がりを足す
  add("mix", "MOD-MIX-001", { level1: 0.3, level2: 0.55, master: 1 }),
  add("dly", "MOD-DLY-001", { time: 0.46875, feedback: 0.35, mix: 0.28 }), // 付点 8 分(0.75 拍)の長さ
  con("vca.out", "mix.in1"),
  con("vca2.out", "mix.in2"),
  con("mix.out", "dly.in"),
  con("mix.out", "out.IN_L"), // 左は元の音
  con("dly.out", "out.IN_R"), // 右はディレイを混ぜた音
];

// ---- 楽譜を書くための道具 ----
const A2 = 45, C3 = 48, F2 = 41, G2 = 43;
const CHORD = {
  Am: { arp: [57, 60, 64, 69], bass: A2 },
  F: { arp: [53, 57, 60, 65], bass: F2 },
  C: { arp: [55, 60, 64, 67], bass: C3 },
  G: { arp: [55, 59, 62, 67], bass: G2 },
};
/** 1 小節(4 拍)の分散和音: 8 分音符で 下 → 上 → 下。 */
const arp = (bar, name, vel = 78) => {
  const n = CHORD[name].arp;
  const order = [0, 1, 2, 3, 2, 1, 2, 3];
  return order.map((k, i) => ({ t: bar * 4 + i * 0.5, dur: 0.45, note: n[k], vel: i === 0 ? vel + 12 : vel }));
};
/** 1 小節の低音: 1 拍目と 3 拍目(3 拍目は 1 オクターブ上)。 */
const bass = (bar, name) => [
  { t: bar * 4, dur: 1.8, note: CHORD[name].bass, vel: 105, ch: 2 },
  { t: bar * 4 + 2, dur: 1.5, note: CHORD[name].bass + 12, vel: 85, ch: 2 },
];
/** 旋律: [拍の位置, 長さ, 音] の並び。 */
const tune = (bar, list, vel = 112) => list.map(([t, dur, note]) => ({ t: bar * 4 + t, dur: dur * 0.95, note, vel }));

const E5 = 76, D5 = 74, C5 = 72, B4 = 71, A4 = 69, G5 = 79, A5 = 81, F5 = 77, B5 = 83, C6 = 84;

/** 楽譜 1(導入): 分散和音と低音だけ。 */
export const SCORE_1 = {
  tempo_bpm: 96, length: 16,
  notes: [
    ...arp(0, "Am", 60), ...arp(1, "F", 66), ...arp(2, "C", 72), ...arp(3, "G", 78),
    ...bass(1, "F"), ...bass(2, "C"), ...bass(3, "G"), // 低音は 2 小節目から入る
  ],
};
/** 楽譜 2(主題): 旋律が入る。 */
export const SCORE_2 = {
  tempo_bpm: 96, length: 16,
  notes: [
    ...arp(0, "Am"), ...arp(1, "F"), ...arp(2, "C"), ...arp(3, "G"),
    ...bass(0, "Am"), ...bass(1, "F"), ...bass(2, "C"), ...bass(3, "G"),
    ...tune(0, [[0, 2, E5], [2, 1, D5], [3, 1, C5]]),
    ...tune(1, [[0, 2, A4], [2, 2, C5]]),
    ...tune(2, [[0, 1.5, G5], [1.5, 1.5, E5], [3, 1, D5]]),
    ...tune(3, [[0, 2, D5], [2, 2, B4]]),
  ],
};
/** 楽譜 3(展開): 旋律が高くなり、動きが増える。 */
export const SCORE_3 = {
  tempo_bpm: 96, length: 16,
  notes: [
    ...arp(0, "Am", 84), ...arp(1, "F", 84), ...arp(2, "C", 84), ...arp(3, "G", 84),
    ...bass(0, "Am"), ...bass(1, "F"), ...bass(2, "C"), ...bass(3, "G"),
    ...tune(0, [[0, 1, A5], [1, 1, G5], [2, 2, E5]], 118),
    ...tune(1, [[0, 1, F5], [1, 1, E5], [2, 2, C5]], 118),
    ...tune(2, [[0, 1, E5], [1, 1, G5], [2, 2, C6]], 122),
    ...tune(3, [[0, 1, B5], [1, 1, A5], [2, 1, G5], [3, 1, D5]], 118),
  ],
};
/** 楽譜 4(終わり): Am → F → G → Am。最後の小節は和音をのばして終わる。 */
export const SCORE_4 = {
  tempo_bpm: 96, length: 18,
  notes: [
    ...arp(0, "Am", 74), ...arp(1, "F", 70), ...arp(2, "G", 66),
    ...bass(0, "Am"), ...bass(1, "F"), ...bass(2, "G"),
    ...tune(0, [[0, 2, E5], [2, 2, C5]], 104),
    ...tune(1, [[0, 2, A4], [2, 2, C5]], 100),
    ...tune(2, [[0, 2, B4], [2, 2, D5]], 96),
    // 最後: イ短調の和音を 1 音ずつ重ねて、のばす
    { t: 12, dur: 5.5, note: A2, vel: 100, ch: 2 },
    { t: 12, dur: 5.5, note: 57, vel: 80 }, { t: 12.5, dur: 5, note: 60, vel: 76 }, { t: 13, dur: 4.5, note: 64, vel: 72 },
    { t: 13.5, dur: 4, note: 69, vel: 70 }, { t: 14, dur: 3.5, note: A5 - 12 + 7, vel: 66 }, // E5
    { t: 14.5, dur: 3, note: A5, vel: 90 },
  ],
};
export const TITLE = "イ短調の小品(96 BPM)";
/** 区間: 楽譜と、その区間に入った時点で動かすパラメータ(この曲では動かさない)。 */
export const SECTIONS = [SCORE_1, SCORE_2, SCORE_3, SCORE_4].map((score, i) => ({ name: ["導入", "主題", "展開", "終わり"][i], score, params: [] }));
