// エンジンの高速化(Issue: 音声ファイルの書き出しの速度)の確認。
// つながっていない出力の「前のステップの値」(控え)は毎サンプル写さず、必要になったときに写し直す。
// 写し直した結果が、毎サンプル写した場合(= スナップショットを毎回取って写し直させた場合)と同じであること。
import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine } from "../src/engine/engine.js";
import { REGISTRY } from "../src/modules/registry.js";

const FS = 48000;
const make = (type: string) => REGISTRY.get(type)!(FS);

function build(): Engine {
  const e = new Engine(FS);
  e.add("lfo", make("MOD-LFO-001"));
  e.add("vco", make("MOD-OSC-001"));
  e.add("vcf", make("MOD-FLT-001"));
  e.add("vca", make("MOD-AMP-001"));
  e.get("lfo").setParam("freq", 37);
  e.get("vca").setParam("gain", 1);
  e.connect("vco", "saw", "vcf", "in"); // vco の sine / tri / pulse、lfo の全出力は、つながっていない
  return e;
}
const outOf = (e: Engine): number[] => ["vcf", "vca"].flatMap((id) => e.get(id).outputs.map((o) => o.values[0]!));

test("つながっていない出力を後からつないでも、最初からつないでいた場合と同じ値が 1 サンプル目から流れる", () => {
  // a: 途中でつなぐ。b: 同じ操作だが、毎サンプルごとにスナップショットを取る(すべての控えを写し直させる = 毎サンプル写すのと同じ)
  const a = build();
  const b = build();
  for (let i = 0; i < 257; i++) {
    a.tick();
    b.tick();
    b.snapshot();
  }
  for (const e of [a, b]) {
    e.connect("vco", "sine", "vca", "in1");
    e.connect("lfo", "sine", "vcf", "cv1");
  }
  for (let i = 0; i < 300; i++) {
    a.tick();
    b.tick();
    b.snapshot();
    assert.deepEqual(outOf(a), outOf(b), `${i} サンプル目`);
  }
  assert.ok(Math.abs(a.get("vca").outputs[0]!.values[0]!) > 0, "音が流れている");
  assert.deepEqual(a.snapshot(), b.snapshot(), "スナップショットも同じ(つながっていない出力の控えを含む)");
});

test("スナップショットは、つながっていない出力の控えも最後のステップの値を持つ。復元して続けても同じ", () => {
  const a = build();
  for (let i = 0; i < 123; i++) a.tick();
  const snap = a.snapshot();
  const vco = snap.modules.find((m) => m.id === "vco")!;
  const sine = a.get("vco").outputs[3]!.values[0]!;
  assert.notEqual(sine, 0);
  assert.equal(vco.ports[3]!.values[0], sine, "つながっていない sine の控え = 最後のステップの出力");
  // 復元したエンジンと、そのまま続けたエンジンは、後からつないでも同じ
  const b = Engine.restore(JSON.parse(JSON.stringify(snap)) as typeof snap, REGISTRY);
  for (const e of [a, b]) e.connect("vco", "tri", "vca", "in1");
  for (let i = 0; i < 200; i++) {
    a.tick();
    b.tick();
    assert.deepEqual(outOf(a), outOf(b), `${i} サンプル目`);
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test("リセットの後も同じ: 控えは初期値に戻り、つながっていない出力を後からつなぐと、リセット後の出力が流れる", () => {
  const a = build();
  const b = build();
  for (let i = 0; i < 50; i++) {
    a.tick();
    b.tick();
    b.snapshot();
  }
  a.reset();
  b.reset();
  assert.deepEqual(a.snapshot(), b.snapshot(), "リセット直後");
  for (let i = 0; i < 40; i++) {
    a.tick();
    b.tick();
    b.snapshot();
  }
  for (const e of [a, b]) e.connect("vco", "pulse", "vca", "in1");
  for (let i = 0; i < 100; i++) {
    a.tick();
    b.tick();
    b.snapshot();
    assert.deepEqual(outOf(a), outOf(b), `${i} サンプル目`);
  }
  // ケーブルを外した入力は、未接続に戻る
  a.disconnect("vca", "in1");
  a.tick();
  assert.equal(a.get("vca").inputs[0]!.connected, false);
});
