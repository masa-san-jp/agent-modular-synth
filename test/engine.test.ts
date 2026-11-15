import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine } from "../src/engine/engine.js";
import { ModuleDef, SynthModule } from "../src/engine/module.js";
import { REGISTRY } from "../src/modules/registry.js";
import { UtlModule } from "../src/modules/utl.js";

const FS = 48000;

function utl(gain: number, offset: number): UtlModule {
  const m = new UtlModule(FS);
  m.setParam("gain", gain);
  m.setParam("offset", offset);
  return m;
}

test("COM-06: ケーブルは1サンプル遅延(評価順序に依存しない)", () => {
  for (const order of [["a", "b"], ["b", "a"]] as const) {
    const e = new Engine(FS);
    const mods = { a: utl(0, 3), b: utl(1, 0) }; // a は定数 3 V、b は素通し
    for (const id of order) e.add(id, mods[id]);
    e.connect("a", "out", "b", "in");
    e.tick();
    assert.equal(e.get("a").output("out").values[0], 3);
    assert.equal(e.get("b").output("out").values[0], 0, "最初のステップは遅延値 0 V");
    e.tick();
    assert.equal(e.get("b").output("out").values[0], 3, "次のステップで届く");
  }
});

test("COM-06: フィードバック(自己接続)が定義される", () => {
  const e = new Engine(FS);
  e.add("u", utl(0.5, 1)); // y[n] = 0.5·y[n-1] + 1
  e.connect("u", "out", "u", "in");
  const ys = Array.from(e.process(6, "u", "out")[0]!);
  assert.deepEqual(ys, [1, 1.5, 1.75, 1.875, 1.9375, 1.96875]);
});

/** テスト用: 決まった値を N チャンネルで出す源。 */
class PolySource extends SynthModule {
  readonly def: ModuleDef = {
    specId: "TEST-SRC", specVersion: "0", title: "テスト用の源", inputs: [], outputs: [{ name: "out", type: "cv" }], params: [], stateful: false,
  };
  constructor(fs: number, private readonly vals: number[]) {
    super(fs);
    this.init();
  }
  protected resetState(): void {}
  step(): void {
    const o = this.outputs[0]!;
    o.channels = this.vals.length;
    this.vals.forEach((v, c) => (o.values[c] = v));
  }
}

test("COM-08: ケーブルはチャンネル数と各チャンネルの値を運ぶ", () => {
  const e = new Engine(FS);
  e.add("src", new PolySource(FS, [-10, 4, 10]));
  e.add("dst", utl(0.5, 1));
  e.connect("src", "out", "dst", "in");
  e.tick();
  assert.equal(e.get("dst").output("out").channels, 1, "最初のステップは遅延値(1チャンネルの 0 V)");
  e.tick();
  const out = e.get("dst").output("out");
  assert.equal(out.channels, 3);
  assert.deepEqual(Array.from(out.values.subarray(0, 3)), [-4, 3, 6]);
});

test("DEC-108: ブロック長1と128で結果が一致", () => {
  const build = (): Engine => {
    const e = new Engine(FS);
    e.add("u", utl(0.9, 0.3));
    e.add("v", utl(-0.7, 0.1));
    e.connect("u", "out", "v", "in");
    e.connect("v", "out", "u", "in");
    return e;
  };
  const a = build();
  const b = build();
  const total = 1024;
  const ya = new Float32Array(total);
  for (let n = 0; n < total; n++) ya[n] = a.process(1, "v", "out")[0]![0]!;
  const yb = new Float32Array(total);
  for (let n = 0; n < total; n += 128) yb.set(b.process(128, "v", "out")[0]!, n);
  assert.deepEqual(Array.from(ya), Array.from(yb));
});

test("REQ-NF-003: 同じ入力の2回実行でビット同一、reset() 後も同じ列", () => {
  const e = new Engine(FS);
  e.add("u", utl(0.9, 0.3));
  e.connect("u", "out", "u", "in");
  const y1 = Array.from(e.process(500, "u", "out")[0]!);
  e.reset();
  const y2 = Array.from(e.process(500, "u", "out")[0]!);
  assert.deepEqual(y1, y2);
});

test("COM-14: スナップショットから復元するとビット同一に続く(JSON を経由)", () => {
  const e = new Engine(FS);
  e.add("u", utl(0.9, 0.3));
  e.add("v", utl(-0.7, 0.1));
  e.connect("u", "out", "v", "in");
  e.connect("v", "out", "u", "in");
  e.run(333);
  const snap = JSON.parse(JSON.stringify(e.snapshot()));
  const r = Engine.restore(snap, REGISTRY);
  const ya = Array.from(e.process(400, "v", "out")[0]!);
  const yb = Array.from(r.process(400, "v", "out")[0]!);
  assert.deepEqual(ya, yb);
  assert.equal(r.step, e.step);
});

test("接続の検査: 使用中の入力、存在しないポート、削除でケーブルも消える", () => {
  const e = new Engine(FS);
  e.add("a", utl(1, 0));
  e.add("b", utl(1, 0));
  e.connect("a", "out", "b", "in");
  assert.throws(() => e.connect("a", "out", "b", "in"), /使用中/);
  assert.throws(() => e.connect("a", "nope", "b", "in"), /出力/);
  e.remove("a");
  e.tick();
  assert.equal(e.get("b").input("in").connected, false);
});
