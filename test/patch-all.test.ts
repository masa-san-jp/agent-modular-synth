// 20種すべてを1つのパッチに入れた確認: 生成・接続・実行ができ、出力が有限で範囲内、
// ブロック長・2回実行・スナップショット(JSON 経由)でビット同一(VER-NF-003 の該当部分)。
import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine } from "../src/engine/engine.js";
import { IoMidiModule } from "../src/modules/io-midi.js";
import { REGISTRY } from "../src/modules/registry.js";

const FS = 48000;

function build(): Engine {
  const e = new Engine(FS);
  const add = (id: string, type: string, params: Record<string, number> = {}): void => {
    const m = REGISTRY.get(type)!(FS);
    for (const [k, v] of Object.entries(params)) m.setParam(k, v);
    m.reset();
    e.add(id, m);
  };
  add("clk", "MOD-CLK-001", { bpm: 600, ppqn: 4 });
  add("div", "MOD-CLK-002", { division: 3 });
  add("seq", "MOD-SEQ-001", { length: 4, "cv[1]": 0, "cv[2]": 0.25, "cv[3]": 0.5, "cv[4]": -0.5, glide: 0.01 });
  add("midi", "MOD-IO-002", { voices: 3 });
  add("vco", "MOD-OSC-001");
  add("vco2", "MOD-OSC-001", { tune: 0.02 });
  add("lfo", "MOD-LFO-001", { freq: 5 });
  add("nse", "MOD-NSE-001", { level: 1 });
  add("rnd", "MOD-RND-001", { seed: 17 });
  add("fnc", "MOD-FNC-001", { rise: 0.01, fall: 0.05 });
  add("lgc", "MOD-LGC-001");
  add("env", "MOD-ENV-001", { attack: 0.002, release: 0.05 });
  add("trim", "MOD-UTL-001", { gain: 0.5 });
  add("mix", "MOD-MIX-001", { level1: 0.5, level2: 0.5, level3: 0.1 });
  add("flt", "MOD-FLT-001", { cutoff: 1.5, res: 0.4, cv2_level: 0.3 });
  add("vca", "MOD-AMP-001");
  add("sat", "MOD-SAT-001", { drive: 9, bias: 0.2, mix: 0.7 });
  add("dly", "MOD-DLY-001", { time: 0.03, feedback: 0.4, mix: 0.3 });
  add("desk", "MOD-MIX-002", { "level[1]": 0.9, "pan[1]": -0.4, "send[1]": 0.3, "level[2]": 0.5, "pan[2]": 0.6, window_ms: 20 });
  add("meter", "MOD-IO-003");
  add("out", "MOD-IO-001");
  const c = (a: string, b: string): void => {
    const [fm, fp] = a.split(".");
    const [tm, tp] = b.split(".");
    e.connect(fm!, fp!, tm!, tp!);
  };
  c("clk.clock", "seq.CLOCK");
  c("clk.clock", "div.clock");
  c("div.out_div", "rnd.TRIG");
  c("seq.CV", "vco.pitch"); // シーケンサ(1声)
  c("midi.PITCH", "vco2.pitch"); // MIDI(3声)
  c("midi.GATE", "env.gate");
  c("seq.GATE", "fnc.trig");
  c("seq.GATE", "lgc.a");
  c("div.out2", "lgc.b");
  c("vco.saw", "mix.in1");
  c("vco2.pulse", "mix.in2");
  c("nse.out", "mix.in3");
  c("mix.out", "flt.in");
  c("lfo.sine", "flt.cv2");
  c("rnd.OUT", "flt.cv3");
  c("flt.out", "vca.in1");
  c("env.env", "trim.in");
  c("trim.out", "vca.cv1");
  c("fnc.out", "vca.cv2");
  c("vca.out", "sat.in");
  c("lfo.tri", "sat.drive_cv");
  c("sat.out", "dly.in");
  c("dly.out", "meter.IN");
  c("meter.THRU", "out.IN_L");
  c("dly.out", "desk.in1");
  c("vco2.pulse", "desk.in2");
  c("desk.R", "out.IN_R");
  c("lgc.and", "lfo.reset");
  return e;
}

/** 決まった時刻に MIDI を送りながら total フレームを処理し、出力モジュールの PRE_L/PRE_R を返す。 */
function render(e: Engine, total: number, blockSize: number): Float32Array[] {
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const midi = e.get("midi") as IoMidiModule;
  const out = e.get("out");
  const events: Record<number, number[][]> = {
    256: [[0x90, 60, 100]],
    2560: [[0x90, 64, 90], [0x90, 67, 80]],
    12800: [[0x80, 64, 0]],
    15360: [[0x90, 72, 110], [0xe0, 0, 80]],
    25600: [[0x80, 60, 0], [0x80, 67, 0], [0x80, 72, 0]],
  };
  for (let n = 0; n < total; n += blockSize) {
    const base = e.step;
    for (let i = 0; i < blockSize; i++) {
      for (const msg of events[base + i] ?? []) midi.midi(msg);
      e.tick();
      L[n + i] = out.output("PRE_L").values[0]!;
      R[n + i] = out.output("PRE_R").values[0]!;
    }
  }
  return [L, R];
}
const bits = (bufs: Float32Array[]): number[] => bufs.flatMap((b) => Array.from(new Uint32Array(b.buffer, b.byteOffset, b.length)));

test("20種すべてを登録している", () => {
  assert.equal(REGISTRY.size, 20);
});

test("20種を使ったパッチ: 実行でき、音が出て、出力は有限で飽和範囲(±100)内。置換カウンタは 0", () => {
  const e = build();
  const [L, R] = render(e, 36000, 128);
  let peak = 0;
  for (const v of [...L!, ...R!]) {
    assert.ok(Number.isFinite(v) && Math.abs(v) <= 100);
    peak = Math.max(peak, Math.abs(v));
  }
  assert.ok(peak > 0.01, `ピーク ${peak}`);
  assert.equal(e.get("vco2").output("pulse").channels, 3, "MIDI の3声が VCO に届く");
  assert.equal(e.get("out").output("PRE_L").channels, 1, "出力モジュールは全チャンネルを加算して1チャンネル");
  for (const id of e.ids()) assert.equal(e.get(id).nonfiniteCount, 0, `${id} の置換カウンタ`);
});

test("20種のパッチ: ブロック長1と128、2回実行でビット同一", () => {
  const a = bits(render(build(), 20480, 128));
  assert.deepEqual(bits(render(build(), 20480, 1)), a);
  assert.deepEqual(bits(render(build(), 20480, 128)), a);
});

test("20種のパッチ: 途中のスナップショット(JSON 経由)から復元するとビット同一に続く", () => {
  const a = build();
  render(a, 14080, 128); // 声が鳴っていて、遅延バッファ・乱数・シーケンサが途中の状態
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = Engine.restore(snap, REGISTRY);
  assert.deepEqual(bits(render(b, 16000, 128)), bits(render(a, 16000, 128)));
});
