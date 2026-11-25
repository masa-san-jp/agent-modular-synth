// エージェント(Claude Code)が書いたヴェイパーウェイヴ。1 分 75 拍(遅め)、ヘ長調のまわり(Fmaj7 → Em7 → Dm9 → Cmaj7)。
// 8 小節(25.6 秒)の楽譜 × 4: 入り → グルーヴ → 旋律 → テープが止まる。
// 「テープの揺れ」: 遅い LFO 1 つを、和音・エレピ・旋律の発振器に少しずつ混ぜ、音程がゆらゆら揺れる。
// 最後は、全部の発振器の音程を 2 拍で 1 オクターブ下げ、同時に卓の音量を絞る(テープが止まる音)。
// チャンネル: 1 = 和音(パッド)、2 = エレピ、3 = 低音、4 = キック、5 = スネア(ディレイで尾)、6 = ハイハット、7 = 旋律(ディレイ)。

const add = (id, type, params) => ({ command: "module.add", args: { id, type, ...(params ? { params } : {}) } });
const con = (from, to) => {
  const [fm, fp] = from.split(".");
  const [tm, tp] = to.split(".");
  return { command: "cable.connect", args: { from: { module: fm, port: fp }, to: { module: tm, port: tp } } };
};

export const TITLE = "ヴェイパーウェイヴ「午前 3 時のモール」(75 BPM)";
/** 録画のときに人が選ぶ画面の色相(MAGENTA)。 */
export const HUE = 297;
/** 録画のとき、2 つ目の楽譜の途中で人が書く指示。 */
export const PROMPT = "もっと懐かしく";

export const PATCH = [
  // --- テープの揺れ: 0.35 Hz の正弦波 ---
  add("wow", "MOD-LFO-001", { freq: 0.35 }),
  // --- 和音(ch 1): 少しずらしたノコギリ波 2 つ + 1 オクターブ下の三角波。ゆっくり立ち上がり、こもらせる ---
  add("p_midi", "MOD-IO-002", { channel: 1, voices: 5 }),
  add("p_osc", "MOD-OSC-001", { tune: 0.008, fm_amt: 0.004 }),
  add("p_osc2", "MOD-OSC-001", { tune: -0.008, fm_amt: 0.005 }),
  add("p_osc3", "MOD-OSC-001", { range: -1, fm_amt: 0.004 }),
  add("p_pre", "MOD-MIX-001", { level1: 0.5, level2: 0.5, level3: 0.4 }),
  add("p_env", "MOD-ENV-001", { attack: 0.9, decay: 1, sustain: 0.8, release: 1.6 }),
  add("p_vcf", "MOD-FLT-001", { cutoff: -0.6, res: 0.2, cv2_level: 0.1 }),
  add("p_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("p_midi.PITCH", "p_osc.pitch"),
  con("p_midi.PITCH", "p_osc2.pitch"),
  con("p_midi.PITCH", "p_osc3.pitch"),
  con("wow.sine", "p_osc.fm"),
  con("wow.sine", "p_osc2.fm"),
  con("wow.sine", "p_osc3.fm"),
  con("p_midi.GATE", "p_env.gate"),
  con("p_osc.saw", "p_pre.in1"),
  con("p_osc2.saw", "p_pre.in2"),
  con("p_osc3.tri", "p_pre.in3"),
  con("p_pre.out", "p_vcf.in"),
  con("p_env.env", "p_vcf.cv2"),
  con("p_vcf.out", "p_vca.in1"),
  con("p_env.env", "p_vca.cv2"),
  // --- エレピ(ch 2): 正弦波を、同じ高さの正弦波で FM する。打った瞬間が明るく、すぐ丸くなる。強さで音量が変わる ---
  add("e_midi", "MOD-IO-002", { channel: 2, voices: 5 }),
  add("e_mod", "MOD-OSC-001", { range: 1, fm_amt: 0.004 }),
  add("e_osc", "MOD-OSC-001", { fm_amt: 0.16 }),
  add("e_env", "MOD-ENV-001", { attack: 0.003, decay: 1.3, sustain: 0.25, release: 0.5 }),
  add("e_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("e_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("e_midi.PITCH", "e_mod.pitch"),
  con("e_midi.PITCH", "e_osc.pitch"),
  con("wow.sine", "e_mod.fm"),
  con("e_mod.sine", "e_osc.fm"),
  con("e_midi.GATE", "e_env.gate"),
  con("e_osc.sine", "e_vca.in1"),
  con("e_env.env", "e_vca.cv2"),
  con("e_vca.out", "e_vel.in1"),
  con("e_midi.VEL", "e_vel.cv2"),
  // --- 低音(ch 3): 正弦波と三角波。丸く、長め ---
  add("l_midi", "MOD-IO-002", { channel: 3, voices: 1 }),
  add("l_osc", "MOD-OSC-001"),
  add("l_pre", "MOD-MIX-001", { level1: 0.7, level2: 0.4 }),
  add("l_env", "MOD-ENV-001", { attack: 0.005, decay: 0.5, sustain: 0.6, release: 0.15 }),
  add("l_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("l_midi.PITCH", "l_osc.pitch"),
  con("l_midi.GATE", "l_env.gate"),
  con("l_osc.sine", "l_pre.in1"),
  con("l_osc.tri", "l_pre.in2"),
  con("l_pre.out", "l_vca.in1"),
  con("l_env.env", "l_vca.cv2"),
  // --- キック(ch 4): 柔らかく、少し長い ---
  add("k_midi", "MOD-IO-002", { channel: 4, voices: 1 }),
  add("k_osc", "MOD-OSC-001", { fm_amt: 0.25 }),
  add("k_penv", "MOD-ENV-001", { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 }),
  add("k_env", "MOD-ENV-001", { attack: 0.001, decay: 0.32, sustain: 0, release: 0.06 }),
  add("k_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("k_midi.PITCH", "k_osc.pitch"),
  con("k_midi.GATE", "k_penv.gate"),
  con("k_midi.GATE", "k_env.gate"),
  con("k_penv.env", "k_osc.fm"),
  con("k_osc.sine", "k_vca.in1"),
  con("k_env.env", "k_vca.cv2"),
  // --- スネア(ch 5): ノイズを中域に寄せて短く切る。ディレイへ多めに送り、80 年代の残響の代わりにする ---
  add("s_midi", "MOD-IO-002", { channel: 5, voices: 1 }),
  add("s_nse", "MOD-NSE-001", { level: 10, seed: 3 }),
  add("s_vcf", "MOD-FLT-001", { cutoff: 5, res: 0.2 }),
  add("s_env", "MOD-ENV-001", { attack: 0.001, decay: 0.22, sustain: 0, release: 0.1 }),
  add("s_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("s_midi.GATE", "s_env.gate"),
  con("s_nse.out", "s_vcf.in"),
  con("s_vcf.out", "s_vca.in1"),
  con("s_env.env", "s_vca.cv2"),
  // --- ハイハット(ch 6) ---
  add("h_midi", "MOD-IO-002", { channel: 6, voices: 1 }),
  add("h_nse", "MOD-NSE-001", { level: 8, seed: 9 }),
  add("h_env", "MOD-ENV-001", { attack: 0.001, decay: 0.035, sustain: 0, release: 0.03 }),
  add("h_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  add("h_vel", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("h_midi.GATE", "h_env.gate"),
  con("h_nse.out", "h_vca.in1"),
  con("h_env.env", "h_vca.cv2"),
  con("h_vca.out", "h_vel.in1"),
  con("h_midi.VEL", "h_vel.cv2"),
  // --- 旋律(ch 7): ノコギリ波とパルス波を、共振の弱いフィルタで丸める(サックスの代わり)。速めの揺れ(ビブラート)も足す ---
  add("m_midi", "MOD-IO-002", { channel: 7, voices: 1 }),
  add("vib", "MOD-LFO-001", { freq: 5.2, depth: 0.5 }),
  add("m_osc", "MOD-OSC-001", { fm_amt: 0.004 }),
  add("m_osc2", "MOD-OSC-001", { pw: 0.35, tune: 0.005, fm_amt: 0.004 }),
  add("m_pre", "MOD-MIX-001", { level1: 0.6, level2: 0.4 }),
  add("m_env", "MOD-ENV-001", { attack: 0.06, decay: 0.4, sustain: 0.7, release: 0.25 }),
  add("m_vcf", "MOD-FLT-001", { cutoff: 0.6, res: 0.25, cv2_level: 0.15 }),
  add("m_vca", "MOD-AMP-001", { cv2_level: 0.5 }),
  con("m_midi.PITCH", "m_osc.pitch"),
  con("m_midi.PITCH", "m_osc2.pitch"),
  con("m_midi.PITCH", "m_vcf.cv1"),
  con("vib.sine", "m_osc.fm"),
  con("wow.sine", "m_osc2.fm"),
  con("m_midi.GATE", "m_env.gate"),
  con("m_osc.saw", "m_pre.in1"),
  con("m_osc2.pulse", "m_pre.in2"),
  con("m_pre.out", "m_vcf.in"),
  con("m_env.env", "m_vcf.cv2"),
  con("m_vcf.out", "m_vca.in1"),
  con("m_env.env", "m_vca.cv2"),
  // ディレイ: 付点 8 分(0.6 秒)。戻りは卓のチャンネル 8 へ
  add("dly", "MOD-DLY-001", { time: 0.6, feedback: 0.5, mix: 1 }),
  add("dly_vcf", "MOD-FLT-001", { cutoff: 1, res: 0.1 }),
  // --- まとめ: 卓 ---
  add("desk", "MOD-MIX-002", {
    "level[1]": 0.35, "level[2]": 0.38, "level[3]": 0.29, "level[4]": 0.6, "level[5]": 1, "level[6]": 0.6, "level[7]": 0.8, "level[8]": 1,
    "pan[1]": -0.1, "pan[2]": 0.25, "pan[5]": 0.05, "pan[6]": 0.3, "pan[7]": -0.15, "pan[8]": 0.35,
    "send[5]": 0.8, "send[7]": 0.6, "send[2]": 0.25, window_ms: 400,
  }),
  con("p_vca.out", "desk.in1"),
  con("e_vel.out", "desk.in2"),
  con("l_vca.out", "desk.in3"),
  con("k_vca.out", "desk.in4"),
  con("s_vca.out", "desk.in5"),
  con("h_vel.out", "desk.in6"),
  con("m_vca.out", "desk.in7"),
  con("desk.SEND", "dly.in"),
  con("dly.out", "dly_vcf.in"),
  con("dly_vcf.out", "desk.in8"),
  con("desk.L", "out.IN_L"),
  con("desk.R", "out.IN_R"),
  { command: "param.set", args: { module_id: "out", param: "level", value: 1.2 } },
];

// ---- 楽譜を書くための道具(単位は拍。1 小節 = 4 拍) ----
const par = (t, dur, module_id, param, value) => ({ t, ...(dur ? { dur } : {}), module_id, param, value });
const LEN = 32;
// 和音(4 小節で 1 周)。根音は低音用
const CHORDS = [
  { pad: [53, 57, 60, 64], ep: [57, 60, 64, 67], root: 41 }, // Fmaj7(F A C E)、エレピは Am7 の形で 9th を足す
  { pad: [52, 55, 59, 62], ep: [55, 59, 62, 66], root: 40 }, // Em7
  { pad: [50, 53, 57, 60], ep: [53, 57, 60, 64], root: 38 }, // Dm9
  { pad: [48, 52, 55, 59], ep: [52, 55, 59, 62], root: 36 }, // Cmaj7
];
const chordAt = (bar) => CHORDS[bar % 4];
const bars = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
const padBar = (b, vel = 70) => chordAt(b).pad.map((note) => ({ t: b * 4, dur: 3.9, note, vel, ch: 1 }));
/** エレピ: 1 拍目と 2 拍目の裏に和音を置く。 */
const epBar = (b, vel = 84) => [[0, 1.4], [2.5, 1.2]].flatMap(([t, dur], i) => chordAt(b).ep.map((note) => ({ t: b * 4 + t, dur, note, vel: vel - i * 10, ch: 2 })));
/** 低音: 1 拍目、2 拍目の裏に 5 度、4 拍目の裏に根音。 */
const bassBar = (b, vel = 100) => {
  const r = chordAt(b).root;
  return [{ t: b * 4, dur: 1.4, note: r, vel, ch: 3 }, { t: b * 4 + 1.5, dur: 0.4, note: r + 7, vel: vel - 15, ch: 3 }, { t: b * 4 + 2.5, dur: 1, note: r + 12, vel: vel - 10, ch: 3 }, { t: b * 4 + 3.5, dur: 0.4, note: r, vel: vel - 15, ch: 3 }];
};
/** 打楽器: キックは 1 拍目と 3 拍目の手前、スネアは 2 拍目と 4 拍目、ハイハットは 8 分。 */
const drumBar = (b, { hats = true, ghost = false } = {}) => {
  const out = [{ t: b * 4, dur: 0.2, note: 36, vel: 110, ch: 4 }, { t: b * 4 + 2.5, dur: 0.2, note: 36, vel: 100, ch: 4 }];
  out.push({ t: b * 4 + 1, dur: 0.2, note: 60, vel: 110, ch: 5 }, { t: b * 4 + 3, dur: 0.2, note: 60, vel: 110, ch: 5 });
  if (ghost) out.push({ t: b * 4 + 3.75, dur: 0.1, note: 60, vel: 60, ch: 5 });
  if (hats) for (let i = 0; i < 8; i++) out.push({ t: b * 4 + i * 0.5, dur: 0.05, note: 60, vel: i % 2 ? 90 : 60, ch: 6 });
  return out;
};
/** 旋律: [拍, 長さ, ノート] の並びを、小節 bar から置く。 */
const melody = (bar, list, vel = 96) => list.map(([t, dur, note]) => ({ t: bar * 4 + t, dur: dur * 0.92, note, vel, ch: 7 }));
const MEL_1 = [[0, 1.5, 69], [1.5, 0.5, 72], [2, 2, 76], [4, 1, 74], [5, 1, 71], [6, 2, 67], [8, 0.5, 65], [8.5, 0.5, 69], [9, 1, 72], [10, 1.5, 76], [11.5, 0.5, 74], [12, 1, 76], [13, 0.5, 74], [13.5, 0.5, 72], [14, 2, 71]];
const MEL_2 = [[0, 1.5, 76], [1.5, 0.5, 79], [2, 2, 81], [4, 1, 79], [5, 1, 76], [6, 2, 74], [8, 1, 77], [9, 1, 76], [10, 1, 72], [11, 1, 69], [12, 4, 71]];

/** 1. 入り: 和音とエレピだけ。テープの揺れがよく聞こえる。フィルタが少しずつ開く。 */
const S1 = {
  tempo_bpm: 75, length: LEN,
  notes: [...bars(0, 8).flatMap((b) => padBar(b, 66)), ...bars(4, 8).flatMap((b) => epBar(b, 70)), ...bars(6, 8).flatMap((b) => [{ t: b * 4, dur: 0.2, note: 36, vel: 90, ch: 4 }])],
  params: [par(0, 0, "p_vcf", "cutoff", -1.6), par(0, LEN, "p_vcf", "cutoff", -0.4), par(0, 0, "desk", "master", 1)],
};
/** 2. グルーヴ: 低音と打楽器が入る。 */
const S2 = {
  tempo_bpm: 75, length: LEN,
  notes: [...bars(0, 8).flatMap((b) => padBar(b, 62)), ...bars(0, 8).flatMap((b) => epBar(b)), ...bars(0, 8).flatMap((b) => bassBar(b)), ...bars(0, 8).flatMap((b) => drumBar(b, { ghost: b % 4 === 3 }))],
  params: [par(0, 0, "p_vcf", "cutoff", -0.4)],
};
/** 3. 旋律: 上でサックスの代わりの旋律が歌う。後半は高い方へ。 */
const S3 = {
  tempo_bpm: 75, length: LEN,
  notes: [
    ...bars(0, 8).flatMap((b) => padBar(b, 60)),
    ...bars(0, 8).flatMap((b) => epBar(b, 76)),
    ...bars(0, 8).flatMap((b) => bassBar(b)),
    ...bars(0, 8).flatMap((b) => drumBar(b, { ghost: b % 2 === 1 })),
    ...melody(0, MEL_1),
    ...melody(4, MEL_2, 100),
  ],
  params: [par(0, 0, "dly", "feedback", 0.55), par(16, 16, "m_vcf", "cutoff", 1.2)],
};
/** 4. テープが止まる: 打楽器が抜け、旋律の最初の句がもう一度。最後の 2 拍で、全部の音程が 1 オクターブ落ち、音量も絞られる。 */
const STOP = 28; // テープが止まり始める拍
const S4 = {
  tempo_bpm: 75, length: LEN,
  notes: [
    ...bars(0, 7).flatMap((b) => padBar(b, 64)),
    { t: 28, dur: 4, note: 53, vel: 64, ch: 1 }, { t: 28, dur: 4, note: 57, vel: 64, ch: 1 }, { t: 28, dur: 4, note: 60, vel: 64, ch: 1 }, { t: 28, dur: 4, note: 64, vel: 64, ch: 1 },
    ...bars(0, 8).flatMap((b) => epBar(b, 72)),
    ...bars(0, 8).flatMap((b) => bassBar(b, 96)),
    ...bars(0, 4).flatMap((b) => drumBar(b, { hats: false })),
    ...melody(0, MEL_1, 92),
    ...melody(4, [[0, 1.5, 69], [1.5, 0.5, 72], [2, 2, 76], [4, 4, 74], [8, 8, 77]], 88),
  ],
  params: [
    par(16, 12, "p_vcf", "cutoff", -1.2),
    // テープが止まる: 発振器の音程(tune、−1 = 1 オクターブ下)と、卓の全体の音量を 2 拍で落とす
    ...["p_osc", "p_osc2", "p_osc3", "e_osc", "e_mod", "l_osc", "m_osc", "m_osc2"].map((id) => par(STOP, 3, id, "tune", -1)),
    par(STOP, 3.6, "desk", "master", 0),
  ],
};

/** 区間(パラメータの動きは楽譜の中にある)。 */
export const SECTIONS = [
  { name: "入り", score: S1, params: [] },
  { name: "グルーヴ", score: S2, params: [] },
  { name: "旋律", score: S3, params: [] },
  { name: "テープが止まる", score: S4, params: [] },
];
