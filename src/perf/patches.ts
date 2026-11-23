// 性能の測定に使うパッチ(verification-plan §7.1 の BP-0 / BP-1 / BP-N / BP-ALL / BP-M / BP-POLY)。
// パッチは、共通コマンドの列(batch の ops)として作る: 製品と同じ検証を通るので、作れないパッチは測れない。
export interface BenchOp {
  command: string;
  args: Record<string, unknown>;
}

const add = (id: string, type: string, params?: Record<string, number>): BenchOp => ({ command: "module.add", args: { id, type, ...(params ? { params } : {}) } });
const con = (from: string, to: string): BenchOp => {
  const [fm, fp] = from.split(".") as [string, string];
  const [tm, tp] = to.split(".") as [string, string];
  return { command: "cable.connect", args: { from: { module: fm, port: fp }, to: { module: tm, port: tp } } };
};

/** BP-0: 空のパッチ(出力モジュールだけ)。 */
export function bp0(): BenchOp[] {
  return [];
}

/** BP-1: 基本の1声(MIDI-CV → VCO → フィルタ → VCA → 出力。ADSR が VCA を開閉)。`voices` を上げると BP-POLY。 */
export function bp1(voices = 1): BenchOp[] {
  return [
    add("midi", "MOD-IO-002", { voices }),
    add("vco", "MOD-OSC-001"),
    add("vcf", "MOD-FLT-001", { cutoff: 2, res: 0.3 }),
    add("vca", "MOD-AMP-001"),
    add("env", "MOD-ENV-001", { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 }),
    con("midi.PITCH", "vco.pitch"),
    con("vco.saw", "vcf.in"),
    con("vcf.out", "vca.in1"),
    con("midi.GATE", "env.gate"),
    con("env.env", "vca.cv1"),
    con("vca.out", "out.IN_L"),
  ];
}

/** BP-POLY: BP-1 を 16 声で鳴らす(ノートは測定側が MIDI で 16 個保持する)。 */
export function bpPoly(): BenchOp[] {
  return bp1(16);
}

/** BP-N: 連鎖(VCO → フィルタ → VCA)を N 本並べ、ミキサーを多段にして束ねて出力へ。 */
export function bpN(n: number): BenchOp[] {
  const ops: BenchOp[] = [];
  let outs: string[] = [];
  for (let i = 0; i < n; i++) {
    ops.push(add(`o${i}`, "MOD-OSC-001", { tune: ((i * 37) % 200) / 100 - 1 }));
    ops.push(add(`f${i}`, "MOD-FLT-001", { cutoff: 2 }));
    ops.push(add(`a${i}`, "MOD-AMP-001", { gain: 1 }));
    ops.push(con(`o${i}.saw`, `f${i}.in`), con(`f${i}.out`, `a${i}.in1`));
    outs.push(`a${i}.out`);
  }
  // 4入力のミキサーで束ねる(音量は 1/4 ずつにして、束ねた後も過大にならないようにする)
  let level = 0;
  while (outs.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < outs.length; i += 4) {
      const id = `x${level}_${i / 4}`;
      ops.push(add(id, "MOD-MIX-001", { master: 0.25 }));
      outs.slice(i, i + 4).forEach((o, k) => ops.push(con(o, `${id}.in${k + 1}`)));
      next.push(`${id}.out`);
    }
    outs = next;
    level++;
  }
  if (outs.length === 1) ops.push(con(outs[0]!, "out.IN_L"));
  return ops;
}

/** BP-N のモジュール数(出力モジュールを含む)。 */
export function bpNModules(n: number): number {
  return bpN(n).filter((o) => o.command === "module.add").length + 1;
}

/** BP-ALL: 19 種を各 1 個含み、どのモジュールも信号を処理しているパッチ。 */
export function bpAll(): BenchOp[] {
  return [
    add("clk", "MOD-CLK-001", { bpm: 240, ppqn: 4 }),
    add("div", "MOD-CLK-002", { division: 3 }),
    add("seq", "MOD-SEQ-001", { length: 8, "cv[1]": 0, "cv[2]": 0.25, "cv[3]": 0.5, "cv[4]": 1, "cv[5]": -0.5, "cv[6]": 0.75, "cv[7]": 0.1, "cv[8]": -1 }),
    add("midi", "MOD-IO-002"),
    add("vco", "MOD-OSC-001"),
    add("lfo", "MOD-LFO-001", { freq: 3 }),
    add("nse", "MOD-NSE-001", { level: 1 }),
    add("rnd", "MOD-RND-001"),
    add("fnc", "MOD-FNC-001", { rise: 0.01, fall: 0.05 }),
    add("lgc", "MOD-LGC-001"),
    add("env", "MOD-ENV-001", { attack: 0.005, decay: 0.05, sustain: 0.5, release: 0.05 }),
    add("vcf", "MOD-FLT-001", { cutoff: 2, res: 0.4, cv2_level: 0.2, cv3_level: 0.2 }),
    add("vca", "MOD-AMP-001"),
    add("mix", "MOD-MIX-001", { master: 0.5 }),
    add("dly", "MOD-DLY-001", { time: 0.12, feedback: 0.3, mix: 0.3 }),
    add("utl", "MOD-UTL-001", { gain: 0.8 }),
    add("sat", "MOD-SAT-001", { drive: 9 }),
    add("mt", "MOD-IO-003"),
    con("clk.clock", "div.clock"),
    con("clk.clock", "seq.CLOCK"),
    con("div.out2", "rnd.TRIG"),
    con("div.out4", "fnc.trig"),
    con("seq.CV", "vco.pitch"),
    con("seq.GATE", "env.gate"),
    con("lfo.sine", "vcf.cv2"),
    con("rnd.OUT", "vcf.cv3"),
    con("lfo.square", "lgc.a"),
    con("seq.GATE", "lgc.b"),
    con("lgc.xor", "vco.sync"),
    con("midi.MOD", "vco.pwm"),
    con("vco.saw", "vcf.in"),
    con("vcf.out", "vca.in1"),
    con("env.env", "vca.cv1"),
    con("vca.out", "mix.in1"),
    con("nse.out", "mix.in2"),
    con("fnc.out", "mix.in3"),
    con("mix.out", "sat.in"),
    con("sat.out", "dly.in"),
    con("dly.out", "utl.in"),
    con("utl.out", "mt.IN"),
    con("mt.THRU", "out.IN_L"),
  ];
}

/**
 * BP-M: 1つの種別だけを K 個置いたパッチ。各モジュールが信号を処理するよう、種別ごとに最小限の入力をつなぐ:
 * 駆動用の VCO・LFO・クロックを 1 個ずつ置き、その出力を K 個の入力へ配る(駆動用の分の負荷は、K = 0 の測定を引いて除く)。
 */
export function bpM(type: string, k: number): BenchOp[] {
  const ops: BenchOp[] = [add("d_osc", "MOD-OSC-001"), add("d_lfo", "MOD-LFO-001", { freq: 5 }), add("d_clk", "MOD-CLK-001", { bpm: 480, ppqn: 4 })];
  const feed: Record<string, [string, string][]> = {
    "MOD-AMP-001": [["d_osc.saw", "in1"], ["d_lfo.sine", "cv1"]],
    "MOD-CLK-001": [],
    "MOD-CLK-002": [["d_clk.clock", "clock"]],
    "MOD-DLY-001": [["d_osc.saw", "in"]],
    "MOD-ENV-001": [["d_lfo.square", "gate"]],
    "MOD-FLT-001": [["d_osc.saw", "in"], ["d_lfo.sine", "cv2"]],
    "MOD-FNC-001": [["d_lfo.square", "in"]],
    "MOD-IO-002": [],
    "MOD-IO-003": [["d_osc.saw", "IN"]],
    "MOD-LFO-001": [],
    "MOD-LGC-001": [["d_lfo.square", "a"], ["d_osc.pulse", "b"]],
    "MOD-MIX-001": [["d_osc.saw", "in1"], ["d_osc.tri", "in2"], ["d_lfo.sine", "in3"], ["d_osc.sine", "in4"]],
    "MOD-NSE-001": [],
    "MOD-OSC-001": [["d_lfo.sine", "pitch"]],
    "MOD-RND-001": [["d_clk.clock", "TRIG"]],
    "MOD-SAT-001": [["d_osc.saw", "in"], ["d_lfo.sine", "drive_cv"]],
    "MOD-SEQ-001": [["d_clk.clock", "CLOCK"]],
    "MOD-UTL-001": [["d_osc.saw", "in"]],
  };
  const wires = feed[type];
  if (!wires) throw new Error(`BP-M: ${type} は対象外`);
  for (let i = 0; i < k; i++) {
    ops.push(add(`u${i}`, type, type === "MOD-NSE-001" || type === "MOD-RND-001" ? { seed: 1000 + i * 16 } : undefined));
    for (const [from, port] of wires) ops.push(con(from, `u${i}.${port}`));
  }
  return ops;
}

/** BP-M の対象の種別(常設の出力 MOD-IO-001 は 1 個しか置けないので対象外)。 */
export const BPM_TYPES: readonly string[] = [
  "MOD-AMP-001", "MOD-CLK-001", "MOD-CLK-002", "MOD-DLY-001", "MOD-ENV-001", "MOD-FLT-001", "MOD-FNC-001", "MOD-IO-002", "MOD-IO-003",
  "MOD-LFO-001", "MOD-LGC-001", "MOD-MIX-001", "MOD-NSE-001", "MOD-OSC-001", "MOD-RND-001", "MOD-SAT-001", "MOD-SEQ-001", "MOD-UTL-001",
];
