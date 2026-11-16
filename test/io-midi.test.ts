// MOD-IO-002 の検証例(specifications/modules/MOD-IO-002.md §10、仕様 v0.2)。
import assert from "node:assert/strict";
import { IoMidiModule, MidiMsg } from "../src/modules/io-midi.js";
import { near, tv } from "./helpers.js";

const FS = 48000;
const OUTS = ["PITCH", "GATE", "VEL", "PW", "MOD", "RTRG", "CLK"] as const;
type OutName = (typeof OUTS)[number];
/** rec[名前][n] = そのサンプルの全チャンネルの値。 */
type Rec = Record<OutName, number[][]>;
type Script = Record<number, readonly MidiMsg[]>;
type Hooks = Record<number, (m: IoMidiModule) => void>;

const on = (ch: number, note: number, vel: number): MidiMsg => ({ type: "note_on", ch, note, vel });
const off = (ch: number, note: number): MidiMsg => ({ type: "note_off", ch, note, vel: 0 });
const bend = (ch: number, v14: number): MidiMsg => ({ type: "pitch_bend", ch, v14 });
const cc = (ch: number, num: number, val: number): MidiMsg => ({ type: "cc", ch, num, val });
const clock: MidiMsg = { type: "clock" };

const byte = (x: number): boolean => Number.isInteger(x) && x >= 0 && x <= 127;
/** 生のMIDIバイト列で表せるメッセージは midi() で、表せないもの(範囲外の値)は event() で渡す。 */
function send(m: IoMidiModule, msg: MidiMsg): void {
  if (msg.type === "clock") return m.midi([0xf8]);
  if (!(Number.isInteger(msg.ch) && msg.ch >= 1 && msg.ch <= 16)) return m.event(msg);
  const c = msg.ch - 1;
  switch (msg.type) {
    case "note_on":
      return byte(msg.note) && byte(msg.vel) ? m.midi([0x90 | c, msg.note, msg.vel]) : m.event(msg);
    case "note_off":
      return byte(msg.note) ? m.midi([0x80 | c, msg.note, 0]) : m.event(msg);
    case "cc":
      return byte(msg.num) && byte(msg.val) ? m.midi([0xb0 | c, msg.num, msg.val]) : m.event(msg);
    case "pitch_bend":
      return Number.isInteger(msg.v14) && msg.v14 >= 0 && msg.v14 <= 16383
        ? m.midi([0xe0 | c, msg.v14 & 0x7f, msg.v14 >> 7])
        : m.event(msg);
  }
}

/** 「生成時」のパラメータで作る(last_channel / last_voices は生成時の値: 仕様 §5)。 */
function mk(params: Record<string, number> = {}, fs = FS): IoMidiModule {
  const m = new IoMidiModule(fs);
  for (const [k, v] of Object.entries(params)) m.setParam(k, v);
  m.reset();
  return m;
}

const newRec = (): Rec => ({ PITCH: [], GATE: [], VEL: [], PW: [], MOD: [], RTRG: [], CLK: [] });

/** サンプル from..to−1 を処理する。hooks[n] は n の処理の前に呼ぶ。 */
function run(m: IoMidiModule, script: Script, to: number, hooks: Hooks = {}, rec: Rec = newRec(), from = 0): Rec {
  for (let n = from; n < to; n++) {
    hooks[n]?.(m);
    for (const msg of script[n] ?? []) send(m, msg);
    m.step();
    for (const o of OUTS) {
      const p = m.output(o);
      rec[o][n] = Array.from(p.values.subarray(0, p.channels));
    }
  }
  return rec;
}

/** サンプル n のポートの全チャンネル(チャンネル数も一致)。 */
function vals(rec: Rec, o: OutName, n: number, expected: readonly number[]): void {
  const a = rec[o][n]!;
  assert.equal(a.length, expected.length, `${o}[n=${n}] のチャンネル数`);
  if (o === "GATE" || o === "RTRG" || o === "CLK") assert.deepEqual(a, expected, `${o}[n=${n}]`);
  else expected.forEach((e, c) => near(a[c]!, e, 1e-6, 0, `${o}[n=${n}][${c}]`));
}
/** n=a..b の全サンプルで同じ値。 */
function span(rec: Rec, o: OutName, a: number, b: number, expected: readonly number[]): void {
  for (let n = a; n <= b; n++) vals(rec, o, n, expected);
}
/** ポートのチャンネル c が 10 V であるサンプルが、ちょうど ranges([a,b] の列)と一致する。 */
function high(rec: Rec, o: "RTRG" | "CLK" | "GATE", c: number, ranges: readonly (readonly [number, number])[]): void {
  rec[o].forEach((v, n) => {
    const exp = ranges.some(([a, b]) => n >= a && n <= b) ? 10 : 0;
    assert.equal(v[c], exp, `${o}[声${c}][n=${n}]`);
  });
}
function allZero(rec: Rec, n: number, v: number): void {
  const z = new Array<number>(v).fill(0);
  for (const o of ["PITCH", "GATE", "VEL", "RTRG"] as const) vals(rec, o, n, z);
  for (const o of ["PW", "MOD", "CLK"] as const) vals(rec, o, n, [0]);
}

const V100 = 7.874015748;
const V80 = 6.2992125984;
const V60 = 4.7244094488;
const V50 = 3.937007874;
const V40 = 3.1496062992;
const V90 = 7.0866141732;
const E4 = 0.3333333333;
const G4 = 0.5833333333;
const D4 = 0.1666666667;
const B4 = 0.9166666667;

tv("TV-MOD-IO-002-01", () => {
  const r = run(mk(), { 0: [on(1, 60, 100)], 100: [off(1, 60)] }, 200);
  high(r, "RTRG", 0, [[0, 47]]);
  high(r, "GATE", 0, [[0, 99]]);
  span(r, "PITCH", 0, 199, [0]);
  span(r, "VEL", 0, 199, [V100]);
});

tv("TV-MOD-IO-002-02", () => {
  const r = run(
    mk(),
    {
      0: [on(1, 60, 100)],
      100: [on(1, 64, 50)],
      200: [on(1, 67, 127)],
      300: [off(1, 67)],
      400: [off(1, 60)],
      500: [off(1, 64)],
    },
    600,
  );
  span(r, "PITCH", 0, 99, [0]);
  span(r, "VEL", 0, 99, [V100]);
  span(r, "PITCH", 100, 199, [E4]);
  span(r, "VEL", 100, 199, [V50]);
  span(r, "PITCH", 200, 299, [G4]);
  span(r, "VEL", 200, 299, [10]);
  span(r, "PITCH", 300, 599, [E4]);
  span(r, "VEL", 300, 599, [V50]);
  high(r, "GATE", 0, [[0, 499]]);
  high(r, "RTRG", 0, [
    [0, 47],
    [100, 147],
    [200, 247],
  ]);
});

tv("TV-MOD-IO-002-03", () => {
  // (a)
  const a = run(mk(), { 0: [on(1, 60, 100)], 10: [on(1, 60, 0)] }, 60);
  high(a, "GATE", 0, [[0, 9]]);
  high(a, "RTRG", 0, [[0, 47]]);
  // (b)
  const pw = [-5.0, -2.5, 0.0, 2.5, 4.9993896484];
  [0, 4096, 8192, 12288, 16383].forEach((v14, i) => {
    const b = run(mk(), { 0: [bend(1, v14)] }, 2);
    vals(b, "PW", 1, [pw[i]!]);
  });
  // (c)
  const c = run(mk(), { 0: [cc(1, 1, 127), cc(1, 2, 64)] }, 2);
  vals(c, "MOD", 1, [10]);
  // (d)
  const d = run(mk({ cc_number: 74 }), { 0: [cc(1, 1, 127), cc(1, 74, 64)] }, 2);
  vals(d, "MOD", 1, [5.0393700787]);
});

tv("TV-MOD-IO-002-04", () => {
  const cases: [Record<string, number>, number, number][] = [
    [{}, 0, -5.0],
    [{}, 127, 5.5833333333],
    [{ transpose: 12 }, 60, 1.0],
    [{ transpose: -48 }, 60, -4.0],
    [{ transpose: 48 }, 127, 9.5833333333],
  ];
  for (const [p, note, pitch] of cases) {
    const r = run(mk(p), { 0: [on(1, note, 127)] }, 2);
    span(r, "PITCH", 0, 1, [pitch]);
    span(r, "VEL", 0, 1, [10]);
  }
});

tv("TV-MOD-IO-002-05", () => {
  const a = run(mk(), { 0: [on(1, 60, 100), on(1, 60, 0), on(1, 62, 80)] }, 60);
  vals(a, "PITCH", 0, [D4]);
  vals(a, "VEL", 0, [V80]);
  vals(a, "GATE", 0, [10]);
  high(a, "RTRG", 0, [[0, 47]]);
  const b = run(mk(), { 0: [on(1, 60, 100)], 5: [on(1, 62, 80), off(1, 60)] }, 10);
  vals(b, "PITCH", 5, [D4]);
  vals(b, "VEL", 5, [V80]);
  high(b, "GATE", 0, [[0, 9]]);
});

tv("TV-MOD-IO-002-06", () => {
  const bad = [
    on(2, 60, 100),
    on(1, 128, 100),
    on(1, 60, 200),
    bend(1, 16384),
    bend(1, -1),
    cc(1, 1, 128),
    on(17, 60, 100),
    on(0, 60, 100),
  ];
  const script: Script = {};
  bad.forEach((m, n) => (script[n] = [m]));
  const r = run(mk({ channel: 1 }), script, 10);
  for (let n = 0; n < 10; n++) {
    for (const o of OUTS) assert.deepEqual(r[o][n], [0], `${o}[n=${n}]`);
  }
  const g = run(mk({ channel: 1 }), { 0: [on(1, 60, 100)] }, 1);
  vals(g, "PITCH", 0, [0]);
  vals(g, "GATE", 0, [10]);
  vals(g, "VEL", 0, [V100]);
  vals(g, "RTRG", 0, [10]);
});

tv("TV-MOD-IO-002-07", () => {
  const r = run(mk({ channel: 0 }), { 0: [on(9, 62, 64)] }, 1);
  vals(r, "PITCH", 0, [D4]);
  vals(r, "VEL", 0, [5.0393700787]);
  vals(r, "GATE", 0, [10]);
  const z = run(mk({ channel: 0 }), { 0: [on(0, 62, 64), on(17, 62, 64)] }, 2);
  for (let n = 0; n < 2; n++) allZero(z, n, 1);
});

tv("TV-MOD-IO-002-08", () => {
  const r = run(mk(), {}, 50);
  for (let n = 0; n < 50; n++) allZero(r, n, 1);
});

tv("TV-MOD-IO-002-09", () => {
  const a = run(mk(), { 0: [on(1, 60, 100), on(1, 64, 100)], 5: [cc(1, 123, 0)] }, 8);
  vals(a, "PITCH", 4, [E4]);
  vals(a, "GATE", 4, [10]);
  span(a, "GATE", 5, 7, [0]);
  span(a, "PITCH", 5, 7, [E4]);
  span(a, "VEL", 5, 7, [V100]);
  // (b)
  const m = mk();
  const b = run(m, { 0: [on(1, 64, 100), bend(1, 12288), cc(1, 1, 127)] }, 4, { 3: (x) => x.reset() });
  vals(b, "PITCH", 2, [E4]);
  vals(b, "PW", 2, [2.5]);
  vals(b, "MOD", 2, [10]);
  allZero(b, 3, 1);
  assert.deepEqual(m.getParams(), { channel: 0, transpose: 0, voices: 1, cc_number: 1 });
});

tv("TV-MOD-IO-002-10", () => {
  const r = run(mk(), { 0: [clock], 1000: [clock, clock] }, 1100);
  high(r, "CLK", 0, [
    [0, 47],
    [1000, 1047],
  ]);
  assert.equal(r.CLK.filter((v) => v[0] === 10).length, 96);
});

tv("TV-MOD-IO-002-11", () => {
  const r = run(mk({ channel: 1 }), { 0: [on(1, 60, 100)] }, 6, { 3: (m) => m.setParam("channel", 2) });
  high(r, "GATE", 0, [[0, 2]]);
  span(r, "PITCH", 0, 5, [0]);
  span(r, "VEL", 0, 5, [V100]);
});

tv("TV-MOD-IO-002-12", () => {
  const r = run(mk({}, 44100), { 0: [on(1, 60, 100)] }, 100);
  high(r, "RTRG", 0, [[0, 43]]);
});

tv("TV-MOD-IO-002-13", () => {
  const script: Script = {
    0: [on(1, 60, 100)],
    10: [on(1, 64, 50)],
    20: [bend(1, 12000)],
    30: [off(1, 64)],
    40: [clock],
    60: [cc(1, 1, 33)],
    70: [on(1, 67, 90)],
  };
  const a = mk();
  const ra = run(a, script, 45);
  const snap = JSON.parse(JSON.stringify(a.getState())) as Record<string, unknown>;
  const b = mk();
  b.setState(snap);
  run(a, script, 200, {}, ra, 45);
  const rb = run(b, script, 200, {}, newRec(), 45);
  for (let n = 45; n < 200; n++) {
    for (const o of OUTS) {
      const x = ra[o][n]!;
      const y = rb[o][n]!;
      assert.equal(x.length, y.length);
      x.forEach((v, c) => assert.ok(Object.is(v, y[c]), `${o}[n=${n}][${c}] ${v} / ${y[c]}`));
    }
  }
  vals(ra, "PW", 44, [2.32421875]);
  vals(ra, "CLK", 44, [10]);
  vals(ra, "RTRG", 44, [10]);
  vals(ra, "GATE", 44, [10]);
  vals(ra, "PITCH", 44, [0]);
  for (const r of [ra, rb]) {
    vals(r, "MOD", 60, [2.5984251969]);
    vals(r, "PITCH", 199, [G4]);
    vals(r, "VEL", 199, [V90]);
    vals(r, "PW", 199, [2.32421875]);
    vals(r, "MOD", 199, [2.5984251969]);
    vals(r, "GATE", 199, [10]);
  }
  high(ra, "RTRG", 0, [
    [0, 57],
    [70, 117],
  ]);
  for (let n = 45; n < 200; n++) assert.equal(rb.RTRG[n]![0], n <= 57 || (n >= 70 && n <= 117) ? 10 : 0);
});

tv("TV-MOD-IO-002-14", () => {
  const one = (p: Record<string, number>, msgs: MidiMsg[]): Rec => {
    const m = mk(p);
    const r = run(m, { 0: msgs }, 2);
    assert.equal(m.nonfiniteCount, 0);
    return r;
  };
  vals(one({ transpose: 2.5 }, [on(1, 60, 127)]), "PITCH", 1, [0.25]); // (a)
  vals(one({ transpose: -2.5 }, [on(1, 60, 127)]), "PITCH", 1, [-D4]); // (b)
  vals(one({ transpose: 2.4 }, [on(1, 60, 127)]), "PITCH", 1, [D4]); // (c)
  vals(one({ transpose: NaN }, [on(1, 60, 127)]), "PITCH", 1, [0]); // (d)
  vals(one({ transpose: Infinity }, [on(1, 60, 127)]), "PITCH", 1, [0]);
  const e = one({ channel: NaN }, [on(3, 60, 100)]); // (e)
  vals(e, "GATE", 1, [10]);
  vals(e, "PITCH", 1, [0]);
  vals(one({ channel: 2.6 }, [on(3, 60, 100)]), "GATE", 1, [10]); // (f)
  vals(one({ channel: 2.6 }, [on(2, 62, 100)]), "GATE", 1, [0]);
  vals(one({ cc_number: NaN }, [cc(1, 1, 127), cc(1, 74, 64)]), "MOD", 1, [10]); // (g)
  vals(one({ cc_number: 73.5 }, [cc(1, 1, 127), cc(1, 74, 64)]), "MOD", 1, [5.0393700787]); // (h)
});

tv("TV-MOD-IO-002-15", () => {
  const r = run(
    mk({ voices: 4 }),
    {
      0: [on(1, 60, 100)],
      100: [on(1, 64, 80)],
      200: [on(1, 67, 60)],
      250: [bend(1, 12288)],
      300: [off(1, 64)],
      400: [on(1, 69, 127)],
      500: [on(1, 71, 90)],
    },
    600,
  );
  for (let n = 0; n < 600; n++) {
    for (const o of ["PITCH", "GATE", "VEL", "RTRG"] as const) assert.equal(r[o][n]!.length, 4);
    for (const o of ["PW", "MOD", "CLK"] as const) assert.equal(r[o][n]!.length, 1);
  }
  span(r, "PITCH", 200, 299, [0, E4, G4, 0]);
  span(r, "GATE", 200, 299, [10, 10, 10, 0]);
  span(r, "VEL", 200, 299, [V100, V80, V60, 0]);
  span(r, "GATE", 300, 399, [10, 0, 10, 0]);
  span(r, "PITCH", 300, 399, [0, E4, G4, 0]);
  span(r, "VEL", 300, 399, [V100, V80, V60, 0]);
  span(r, "PITCH", 400, 499, [0, E4, G4, 0.75]);
  span(r, "GATE", 400, 499, [10, 0, 10, 10]);
  span(r, "VEL", 400, 499, [V100, V80, V60, 10]);
  span(r, "PITCH", 500, 599, [0, B4, G4, 0.75]);
  span(r, "GATE", 500, 599, [10, 10, 10, 10]);
  span(r, "VEL", 500, 599, [V100, V90, V60, 10]);
  high(r, "RTRG", 0, [[0, 47]]);
  high(r, "RTRG", 1, [
    [100, 147],
    [500, 547],
  ]);
  high(r, "RTRG", 2, [[200, 247]]);
  high(r, "RTRG", 3, [[400, 447]]);
  span(r, "PW", 0, 249, [0]);
  span(r, "PW", 250, 599, [2.5]);
});

tv("TV-MOD-IO-002-16", () => {
  const a = run(
    mk({ voices: 4 }),
    {
      0: [on(1, 60, 100)],
      50: [off(1, 60)],
      100: [on(1, 62, 100)],
      150: [off(1, 62)],
      200: [on(1, 60, 64)],
      250: [off(1, 60)],
      300: [on(1, 64, 100)],
    },
    360,
  );
  span(a, "PITCH", 200, 249, [0, D4, 0, 0]);
  span(a, "GATE", 200, 249, [10, 0, 0, 0]);
  span(a, "VEL", 200, 249, [5.0393700787, V100, 0, 0]);
  span(a, "PITCH", 300, 359, [0, E4, 0, 0]);
  span(a, "GATE", 300, 359, [0, 10, 0, 0]);
  span(a, "VEL", 300, 359, [5.0393700787, V100, 0, 0]);
  high(a, "RTRG", 0, [
    [0, 47],
    [200, 247],
  ]);
  high(a, "RTRG", 1, [
    [100, 147],
    [300, 347],
  ]);
  high(a, "RTRG", 2, []);
  high(a, "RTRG", 3, []);
  const b = run(
    mk({ voices: 4 }),
    {
      0: [on(1, 60, 100)],
      10: [off(1, 60)],
      20: [on(1, 62, 100)],
      30: [off(1, 62)],
      40: [on(1, 64, 100)],
      50: [on(1, 65, 100)],
      60: [on(1, 67, 100)],
      70: [on(1, 60, 100)],
    },
    80,
  );
  span(b, "PITCH", 60, 69, [G4, D4, E4, 0.4166666667]);
  span(b, "GATE", 60, 69, [10, 0, 10, 10]);
  span(b, "PITCH", 70, 79, [G4, 0, E4, 0.4166666667]);
  span(b, "GATE", 70, 79, [10, 10, 10, 10]);
});

tv("TV-MOD-IO-002-17", () => {
  const script: Script = { 20: [off(1, 76)] };
  for (let n = 0; n <= 16; n++) script[n] = [on(1, 60 + n, 100)];
  const r = run(mk({ voices: 16 }), script, 70);
  const base = Array.from({ length: 16 }, (_, c) => c / 12);
  const all10 = new Array<number>(16).fill(10);
  const allV = new Array<number>(16).fill(V100);
  vals(r, "PITCH", 15, base);
  vals(r, "GATE", 15, all10);
  vals(r, "VEL", 15, allV);
  span(r, "PITCH", 16, 19, [1.3333333333, ...base.slice(1)]);
  span(r, "GATE", 16, 19, all10);
  span(r, "VEL", 16, 19, allV);
  span(r, "PITCH", 20, 69, base);
  span(r, "GATE", 20, 69, all10);
  span(r, "VEL", 20, 69, allV);
  high(r, "RTRG", 0, [[0, 63]]);
  for (let c = 1; c < 16; c++) high(r, "RTRG", c, [[c, c + 47]]);
});

tv("TV-MOD-IO-002-18", () => {
  const a = run(
    mk({ voices: 2 }),
    {
      0: [on(1, 60, 100)],
      10: [on(1, 64, 80)],
      20: [on(1, 67, 60)],
      30: [on(1, 71, 40)],
      40: [off(1, 67)],
      50: [off(1, 71)],
      60: [off(1, 64)],
      70: [on(1, 64, 20)],
    },
    130,
  );
  span(a, "PITCH", 10, 19, [0, E4]);
  span(a, "VEL", 10, 19, [V100, V80]);
  span(a, "PITCH", 20, 29, [G4, E4]);
  span(a, "VEL", 20, 29, [V60, V80]);
  span(a, "PITCH", 30, 39, [G4, B4]);
  span(a, "VEL", 30, 39, [V60, V40]);
  span(a, "PITCH", 40, 49, [E4, B4]);
  span(a, "VEL", 40, 49, [V80, V40]);
  span(a, "PITCH", 50, 59, [E4, 0]);
  span(a, "VEL", 50, 59, [V80, V100]);
  span(a, "GATE", 0, 9, [10, 0]);
  span(a, "GATE", 10, 59, [10, 10]);
  span(a, "GATE", 60, 69, [0, 10]);
  span(a, "GATE", 70, 129, [10, 10]);
  span(a, "PITCH", 70, 129, [E4, 0]);
  span(a, "VEL", 70, 129, [1.5748031496, V100]);
  high(a, "RTRG", 0, [
    [0, 67],
    [70, 117],
  ]);
  high(a, "RTRG", 1, [[10, 77]]);
  const b = run(
    mk({ voices: 2 }),
    {
      0: [on(1, 60, 100)],
      10: [on(1, 64, 80)],
      20: [on(1, 67, 60)],
      30: [on(1, 64, 30)],
      40: [on(1, 60, 10)],
      50: [off(1, 60)],
      60: [off(1, 62)],
    },
    120,
  );
  const V30 = 2.3622047244;
  span(b, "PITCH", 30, 39, [G4, E4]);
  span(b, "VEL", 30, 39, [V60, V30]);
  span(b, "PITCH", 40, 49, [0, E4]);
  span(b, "VEL", 40, 49, [0.7874015748, V30]);
  span(b, "PITCH", 50, 119, [G4, E4]);
  span(b, "VEL", 50, 119, [V60, V30]);
  span(b, "GATE", 10, 119, [10, 10]);
  high(b, "RTRG", 0, [[0, 87]]);
  high(b, "RTRG", 1, [[10, 77]]);
});

tv("TV-MOD-IO-002-19", () => {
  const a = run(
    mk({ voices: 3 }),
    { 0: [on(1, 60, 100), on(1, 64, 80), on(1, 67, 60), on(1, 71, 40), off(1, 64)] },
    60,
  );
  vals(a, "PITCH", 0, [B4, 0, G4]);
  vals(a, "GATE", 0, [10, 10, 10]);
  vals(a, "VEL", 0, [V40, V100, V60]);
  for (let c = 0; c < 3; c++) high(a, "RTRG", c, [[0, 47]]);
  const b = run(mk({ voices: 3 }), { 0: [on(1, 60, 100)], 5: [on(1, 64, 80), off(1, 64)] }, 60);
  span(b, "PITCH", 5, 59, [0, 0, 0]);
  span(b, "GATE", 5, 59, [10, 0, 0]);
  span(b, "VEL", 5, 59, [V100, 0, 0]);
  high(b, "RTRG", 0, [[0, 47]]);
  high(b, "RTRG", 1, [[5, 52]]);
  high(b, "RTRG", 2, []);
});

tv("TV-MOD-IO-002-20", () => {
  const z = (n: number): number[] => new Array<number>(n).fill(0);
  const cases: [number, number[], number[]][] = [
    [0, [10], [E4]],
    [-3, [10], [E4]],
    [17, [10, 10, ...z(14)], [0, E4, ...z(14)]],
    [100, [10, 10, ...z(14)], [0, E4, ...z(14)]],
    [NaN, [10], [E4]],
    [Infinity, [10], [E4]],
    [-Infinity, [10], [E4]],
    [2.5, [10, 10, 0], [0, E4, 0]],
    [2.4, [10, 10], [0, E4]],
    [1.5, [10, 10], [0, E4]],
    [1.4, [10], [E4]],
  ];
  for (const [voices, gate, pitch] of cases) {
    const m = mk({ voices });
    const r = run(m, { 0: [on(1, 60, 100), on(1, 64, 100)] }, 2);
    vals(r, "GATE", 1, gate);
    vals(r, "PITCH", 1, pitch);
    assert.equal(m.nonfiniteCount, 0);
  }
});

tv("TV-MOD-IO-002-21", () => {
  const m = mk({ voices: 4 });
  const r = run(
    m,
    {
      0: [on(1, 60, 100), on(1, 64, 100), on(1, 67, 100)],
      2: [off(1, 64), bend(1, 12288), cc(1, 1, 127), clock],
      6: [on(1, 64, 100)],
      8: [on(1, 72, 50)],
    },
    12,
    { 5: (x) => x.reset() },
  );
  vals(r, "PITCH", 4, [0, E4, G4, 0]);
  vals(r, "GATE", 4, [10, 0, 10, 0]);
  vals(r, "VEL", 4, [V100, V100, V100, 0]);
  vals(r, "RTRG", 4, [10, 10, 10, 0]);
  vals(r, "PW", 4, [2.5]);
  vals(r, "MOD", 4, [10]);
  vals(r, "CLK", 4, [10]);
  allZero(r, 5, 4);
  vals(r, "PITCH", 6, [E4, 0, 0, 0]);
  vals(r, "GATE", 6, [10, 0, 0, 0]);
  vals(r, "VEL", 6, [V100, 0, 0, 0]);
  vals(r, "RTRG", 6, [10, 0, 0, 0]);
  span(r, "PITCH", 8, 11, [E4, 1, 0, 0]);
  span(r, "GATE", 8, 11, [10, 10, 0, 0]);
  span(r, "VEL", 8, 11, [V100, V50, 0, 0]);
  assert.equal(m.getParams().voices, 4);
  // reset() がなければ E4 は最後に鳴らした声1へ入る
  const q = run(
    mk({ voices: 4 }),
    { 0: [on(1, 60, 100), on(1, 64, 100), on(1, 67, 100)], 2: [off(1, 64)], 6: [on(1, 64, 100)] },
    7,
  );
  vals(q, "PITCH", 6, [0, E4, G4, 0]);
  vals(q, "GATE", 6, [10, 10, 10, 0]);
});

tv("TV-MOD-IO-002-22", () => {
  const a = run(
    mk({ voices: 4 }),
    { 0: [on(1, 60, 100), on(1, 64, 80)], 5: [cc(1, 123, 0)], 10: [on(1, 67, 60)], 20: [on(1, 60, 40)] },
    70,
  );
  span(a, "GATE", 5, 9, [0, 0, 0, 0]);
  span(a, "PITCH", 5, 9, [0, E4, 0, 0]);
  span(a, "VEL", 5, 9, [V100, V80, 0, 0]);
  span(a, "PITCH", 10, 69, [0, E4, G4, 0]);
  span(a, "GATE", 10, 19, [0, 0, 10, 0]);
  span(a, "VEL", 10, 19, [V100, V80, V60, 0]);
  span(a, "GATE", 20, 69, [10, 0, 10, 0]);
  span(a, "VEL", 20, 69, [V40, V80, V60, 0]);
  high(a, "RTRG", 0, [[0, 67]]);
  high(a, "RTRG", 1, [[0, 47]]);
  high(a, "RTRG", 2, [[10, 57]]);
  high(a, "RTRG", 3, []);
  // (b)
  const b = run(
    mk({ voices: 4 }),
    { 0: [on(1, 60, 100), on(1, 64, 80), bend(1, 12288), cc(1, 1, 127), clock], 7: [on(1, 64, 80)] },
    10,
    { 5: (m) => m.setParam("voices", 2) },
  );
  vals(b, "PITCH", 4, [0, E4, 0, 0]);
  vals(b, "GATE", 4, [10, 10, 0, 0]);
  vals(b, "RTRG", 4, [10, 10, 0, 0]);
  for (const n of [5, 6]) {
    for (const o of ["PITCH", "GATE", "VEL", "RTRG"] as const) vals(b, o, n, [0, 0]);
  }
  span(b, "PW", 0, 9, [2.5]);
  span(b, "MOD", 0, 9, [10]);
  span(b, "CLK", 0, 9, [10]);
  span(b, "PITCH", 7, 9, [E4, 0]);
  span(b, "GATE", 7, 9, [10, 0]);
  span(b, "VEL", 7, 9, [V80, 0]);
  span(b, "RTRG", 7, 9, [10, 0]);
  // (c)
  const c = run(
    mk({ voices: 4, channel: 1 }),
    { 0: [on(1, 60, 100), on(1, 64, 80)], 7: [on(2, 67, 60)], 8: [on(2, 60, 60)] },
    10,
    { 5: (m) => m.setParam("channel", 2) },
  );
  span(c, "GATE", 5, 6, [0, 0, 0, 0]);
  span(c, "PITCH", 5, 6, [0, E4, 0, 0]);
  span(c, "VEL", 5, 6, [V100, V80, 0, 0]);
  span(c, "RTRG", 5, 6, [10, 10, 0, 0]);
  vals(c, "PITCH", 7, [0, E4, G4, 0]);
  vals(c, "GATE", 7, [0, 0, 10, 0]);
  span(c, "GATE", 8, 9, [10, 0, 10, 0]);
  span(c, "VEL", 8, 9, [V60, V80, V60, 0]);
});

tv("TV-MOD-IO-002-23", () => {
  const script: Script = {
    0: [on(1, 60, 100)],
    10: [on(1, 64, 80)],
    20: [on(1, 67, 60)],
    25: [bend(1, 12000)],
    40: [off(1, 67)],
    50: [on(1, 72, 90)],
    60: [off(1, 64)],
    70: [on(1, 64, 30)],
  };
  const a = mk({ voices: 2 });
  const ra = run(a, script, 31);
  const st = a.getState();
  assert.deepEqual(st.held, [
    [60, 100],
    [64, 80],
    [67, 60],
  ]);
  assert.deepEqual(st.v_note, [67, 64]);
  assert.deepEqual(st.p_note, [67, 64]);
  assert.deepEqual(st.rtrg_cnt, [37, 27]);
  assert.equal(st.last_voice, 0);
  const nv = st.note_voice as (number | null)[];
  nv.forEach((v, k) => assert.equal(v, k === 60 || k === 67 ? 0 : k === 64 ? 1 : null, `note_voice[${k}]`));
  assert.equal(st.pw_v, 2.32421875);
  const b = mk({ voices: 2 });
  b.setState(JSON.parse(JSON.stringify(st)) as Record<string, unknown>);
  run(a, script, 200, {}, ra, 31);
  const rb = run(b, script, 200, {}, newRec(), 31);
  for (let n = 31; n < 200; n++) {
    for (const o of OUTS) {
      const x = ra[o][n]!;
      const y = rb[o][n]!;
      assert.equal(x.length, y.length);
      x.forEach((v, c) => assert.ok(Object.is(v, y[c]), `${o}[n=${n}][${c}] ${v} / ${y[c]}`));
    }
  }
  vals(ra, "PITCH", 30, [G4, E4]);
  vals(ra, "GATE", 30, [10, 10]);
  vals(ra, "VEL", 30, [V60, V80]);
  span(rb, "PITCH", 40, 49, [0, E4]);
  span(rb, "VEL", 40, 49, [V100, V80]);
  span(rb, "PITCH", 50, 59, [1, E4]);
  span(rb, "VEL", 50, 59, [V90, V80]);
  span(rb, "PITCH", 60, 69, [1, 0]);
  span(rb, "VEL", 60, 69, [V90, V100]);
  span(rb, "PITCH", 70, 199, [1, E4]);
  span(rb, "VEL", 70, 199, [V90, 2.3622047244]);
  span(ra, "GATE", 10, 199, [10, 10]);
  span(rb, "GATE", 31, 199, [10, 10]);
  high(ra, "RTRG", 0, [[0, 97]]);
  high(ra, "RTRG", 1, [
    [10, 57],
    [70, 117],
  ]);
  span(ra, "PW", 25, 199, [2.32421875]);
  span(rb, "PW", 31, 199, [2.32421875]);
});

tv("TV-MOD-IO-002-24", () => {
  const r = run(mk({ voices: 4 }), {}, 50);
  for (let n = 0; n < 50; n++) allZero(r, n, 4);
});
