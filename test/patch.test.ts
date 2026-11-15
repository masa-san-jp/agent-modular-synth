// 複数モジュールをつないだパッチでの確認(VER-NF-003 の該当部分): ポリフォニー、ブロック長、決定性、スナップショット。
import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine } from "../src/engine/engine.js";
import { ModuleDef, ModuleFactory, SynthModule } from "../src/engine/module.js";
import { REGISTRY } from "../src/modules/registry.js";

const FS = 48000;

/** テスト用: 声ごとのピッチ(固定)とゲート(周期的に開閉)を出す源。状態はステップ数だけ。 */
class NoteSource extends SynthModule {
  readonly def: ModuleDef = {
    specId: "TEST-NOTES", specVersion: "0", title: "テスト用のノート源", inputs: [],
    outputs: [{ name: "pitch", type: "pitch" }, { name: "gate", type: "gate" }], params: [], stateful: true,
  };
  private n = 0;
  constructor(fs: number) {
    super(fs);
    this.init();
  }
  protected resetState(): void {
    this.n = 0;
  }
  step(): void {
    const p = this.outputs[0]!;
    const g = this.outputs[1]!;
    p.channels = 3;
    g.channels = 3;
    const pitches = [0, 4 / 12, 7 / 12]; // C4, E4, G4
    for (let c = 0; c < 3; c++) {
      p.values[c] = pitches[c]!;
      const period = 3000 + 700 * c;
      g.values[c] = this.n % period < period / 2 ? 10 : 0;
    }
    this.n++;
  }
  override getState() {
    return { n: this.n };
  }
  override setState(s: Record<string, unknown>): void {
    this.n = s.n as number;
  }
}

const REG = new Map<string, ModuleFactory>([...REGISTRY, ["TEST-NOTES", (fs) => new NoteSource(fs)]]);

function build(): Engine {
  const e = new Engine(FS);
  e.add("notes", new NoteSource(FS));
  e.add("vco", REG.get("MOD-OSC-001")!(FS));
  e.add("env", REG.get("MOD-ENV-001")!(FS));
  e.add("vca", REG.get("MOD-AMP-001")!(FS));
  e.add("trim", REG.get("MOD-UTL-001")!(FS));
  e.get("env").setParam("attack", 0.005);
  e.get("env").setParam("release", 0.02);
  e.get("trim").setParam("gain", 0.5); // ADSR の 0〜10 V を VCA の 0〜5 V へ
  e.connect("notes", "pitch", "vco", "pitch");
  e.connect("notes", "gate", "env", "gate");
  e.connect("vco", "saw", "vca", "in1");
  e.connect("env", "env", "trim", "in");
  e.connect("trim", "out", "vca", "cv1");
  return e;
}

function bits(bufs: Float32Array[]): number[] {
  return bufs.flatMap((b) => Array.from(new Uint32Array(b.buffer, b.byteOffset, b.length)));
}

test("ポリのパッチ: 3声が独立に鳴る(VCO→VCA、ADSR が声ごとに開閉)", () => {
  const e = build();
  const y = e.process(12000, "vca", "out", 3);
  assert.equal(e.get("vca").output("out").channels, 3);
  for (let c = 0; c < 3; c++) {
    let peak = 0;
    for (const v of y[c]!) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 1 && peak <= 12, `ch${c} のピーク ${peak}`);
  }
  // 声ごとにゲート周期が違うので、チャンネルの波形は一致しない
  assert.notDeepEqual(Array.from(y[0]!.subarray(0, 4000)), Array.from(y[1]!.subarray(0, 4000)));
  for (const id of e.ids()) assert.equal(e.get(id).nonfiniteCount, 0, `${id} の置換カウンタ`);
});

test("DEC-108 / VER-NF-003: ブロック長1と128でビット同一(状態を持つモジュールを含む)", () => {
  const a = build();
  const b = build();
  const total = 128 * 60;
  const ya = [new Float32Array(total), new Float32Array(total), new Float32Array(total)];
  for (let n = 0; n < total; n++) {
    const f = a.process(1, "vca", "out", 3);
    for (let c = 0; c < 3; c++) ya[c]![n] = f[c]![0]!;
  }
  const yb = [new Float32Array(total), new Float32Array(total), new Float32Array(total)];
  for (let n = 0; n < total; n += 128) {
    const f = b.process(128, "vca", "out", 3);
    for (let c = 0; c < 3; c++) yb[c]!.set(f[c]!, n);
  }
  assert.deepEqual(bits(ya), bits(yb));
});

test("VER-NF-003: 同じパッチの2回実行でビット同一、reset() 後も同じ", () => {
  const a = build();
  const y1 = bits(a.process(8000, "vca", "out", 3));
  const y2 = bits(build().process(8000, "vca", "out", 3));
  assert.deepEqual(y1, y2);
  a.reset();
  assert.deepEqual(bits(a.process(8000, "vca", "out", 3)), y1);
});

test("COM-14: 途中のスナップショット(JSON 経由)から復元するとビット同一に続く", () => {
  const a = build();
  a.run(5555); // エンベロープと位相が途中の状態
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = Engine.restore(snap, REG);
  assert.deepEqual(bits(b.process(9000, "vca", "out", 3)), bits(a.process(9000, "vca", "out", 3)));
});
