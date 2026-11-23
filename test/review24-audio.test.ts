// Issue #24 の独立レビューで見つかった、音声まわり(メインスレッド側の写しとワークレットの同期、出力段)の不具合の再発防止の試験。
// ワークレットの中身は本物と同じクラス(src/audio/worklet-core.ts)を、同じプロセス内で動かす。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToWorklet, WorkletStatus } from "../src/audio/messages.js";
import { OutputStage, PROVISIONAL } from "../src/audio/output-stage.js";
import { WorkletBackend } from "../src/audio/worklet-backend.js";
import { WorkletCore } from "../src/audio/worklet-core.js";
import { buildCatalog } from "../src/control/catalog.js";
import { Session } from "../src/control/session.js";
import type { ActorKind, CommandResponse, FailureResponse, SessionEvent, SuccessResponse } from "../src/control/types.js";
import { REGISTRY } from "../src/modules/registry.js";

const FS = 48000;
const CATALOG = buildCatalog(REGISTRY);
type Args = Record<string, unknown>;

class FakeWorklet {
  readonly errors: { message: string; resync?: boolean }[] = [];
  readonly core: WorkletCore;
  readonly received: ToWorklet[] = [];
  statuses = 0;
  constructor(private readonly onStatus: (s: WorkletStatus) => void) {
    this.core = new WorkletCore(FS, REGISTRY, (m) => {
      if (m.type === "error") this.errors.push(m);
    });
  }
  postMessage(msg: ToWorklet): void {
    const copy = JSON.parse(JSON.stringify(msg)) as ToWorklet;
    this.received.push(copy);
    this.core.onMessage(copy);
  }
  render(frames = 128): Float32Array {
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    for (let i = 0; i < frames; i += 128) this.core.process(L.subarray(i, i + 128), R.subarray(i, i + 128));
    this.sendStatus();
    return L;
  }
  sendStatus(): WorkletStatus {
    const st = JSON.parse(JSON.stringify(this.core.status())) as WorkletStatus;
    this.statuses++;
    this.onStatus(st);
    return st;
  }
  real() {
    const s = this.core.be.status();
    return { levelDb: s.levelDb, agentMaxLevelDb: s.agentMaxLevelDb, panic: s.panic, running: s.audioState === "running" };
  }
}

let n = 0;
function rig() {
  const wb = new WorkletBackend({
    initialMeter: () => (REGISTRY.get("MOD-IO-003")!(FS) as unknown as { read(): Record<string, unknown> }).read(),
  });
  const s = new Session({ catalog: CATALOG, backend: wb, sessionId: "s-a24" });
  const events: SessionEvent[] = [];
  s.subscribe((e) => events.push(e));
  const fake = new FakeWorklet((st) => {
    wb.onMessage({ type: "status", status: st });
    s.pollBackend();
  });
  const send = (actor: ActorKind, command: string, args?: Args): CommandResponse =>
    s.handle({ v: 1, request_id: `a-${++n}`, command, ...(args ? { args } : {}) }, actor);
  const ok = (actor: ActorKind, command: string, args?: Args): SuccessResponse => {
    const r = send(actor, command, args);
    assert.equal(r.ok, true, `${command}: ${JSON.stringify(r)}`);
    return r as SuccessResponse;
  };
  const mirror = () => {
    const m = wb.status();
    return { levelDb: m.levelDb, agentMaxLevelDb: m.agentMaxLevelDb, panic: m.panic, running: m.audioState === "running" };
  };
  /** 音が出るパッチ: 定数 → VCO → 出力。 */
  const tone = (): void => {
    ok("agent", "module.add", { id: "vco", type: "MOD-OSC-001" });
    ok("agent", "cable.connect", { from: { module: "vco", port: "saw" }, to: { module: "out", port: "IN_L" } });
  };
  return { wb, s, fake, events, send, ok, mirror, tone };
}
const peak = (b: Float32Array): number => b.reduce((a, v) => Math.max(a, Math.abs(v)), 0);

// ---- 音声の用意ができる前の操作 ----

test("音声開始の前に行った音量・上限の設定と緊急停止は、音声の用意ができた時点でワークレットへ持ち越される", () => {
  const r = rig();
  r.tone();
  r.ok("human", "output.set_level", { level_db: -40 }); // 上限も −40
  r.ok("agent", "engine.panic");
  assert.equal(r.fake.received.length, 0, "まだワークレットはない");
  r.wb.attach(r.fake, FS);
  assert.deepEqual(r.fake.real(), { levelDb: -40, agentMaxLevelDb: -40, panic: true, running: false });
  r.ok("human", "engine.start");
  assert.deepEqual(r.fake.real(), r.mirror());
  assert.equal(r.fake.real().panic, true, "緊急停止は効いたまま");
  assert.equal(peak(r.fake.render(4800)), 0, "緊急停止中なので音は出ない");
  // エージェントの上限もワークレット側で効いている(写しと同じ判定)
  assert.equal((r.send("agent", "output.set_level", { level_db: -30 }) as FailureResponse).error.id, "ERR-302");
  r.ok("human", "engine.release_panic");
  assert.ok(peak(r.fake.render(4800)) > 0);
  assert.deepEqual(r.fake.real(), r.mirror());
  assert.equal(r.wb.desyncCount, 0, "持ち越しが済んでいるので、ずれの送り直しは起きない");
});

test("音声開始の前に音量を既定値より上げていても、開始時に既定値まで引き下げられ、ワークレットも同じ値になる", () => {
  const r = rig();
  r.tone();
  r.ok("human", "output.set_level", { level_db: -3 });
  r.wb.attach(r.fake, FS);
  assert.equal(r.fake.real().levelDb, -3);
  r.ok("human", "engine.start");
  assert.deepEqual(r.fake.real(), { levelDb: -20, agentMaxLevelDb: -3, panic: false, running: true });
  assert.deepEqual(r.fake.real(), r.mirror());
});

// ---- 中断と復帰 ----

test("中断を知ったらワークレットも止める。復帰は開始と同じ扱い: 音量を既定値まで引き下げ、無音からフェードインする(人の操作によらない復帰でも)", () => {
  const r = rig();
  r.wb.attach(r.fake, FS);
  r.tone();
  r.ok("human", "engine.start");
  r.ok("human", "output.set_level", { level_db: -3 });
  const loud = peak(r.fake.render(9600));
  assert.ok(loud > 0.3, `中断前のピーク ${loud}`);
  r.events.length = 0;

  r.wb.setSuspended(true); // ブラウザ・OSが音声を中断した
  assert.equal(r.wb.status().audioState, "suspended");
  assert.equal(r.fake.real().running, false, "ワークレットも止まっている");
  assert.equal(peak(r.fake.render(1280)), 0, "中断中に処理が走っても無音");

  r.wb.setSuspended(false); // 人の操作なしで復帰した
  assert.equal(r.wb.status().audioState, "running");
  assert.deepEqual(r.fake.real(), { levelDb: -20, agentMaxLevelDb: -3, panic: false, running: true });
  assert.deepEqual(r.fake.real(), r.mirror());
  const first = r.fake.render(128);
  assert.ok(Math.abs(first[0]!) < 0.01, `復帰の最初のサンプル ${first[0]}`);
  const fadeEnd = Math.round(PROVISIONAL.fadeSeconds * FS);
  const rest = r.fake.render(fadeEnd + 4800);
  const quiet = Math.pow(10, -20 / 20) * 1.05;
  assert.ok(peak(rest) <= quiet, `復帰後のピーク ${peak(rest)} は既定の音量以下`);
  assert.ok(peak(rest) > 0, "音は戻る");
  // 通知: 音声状態(中断 → 動作中)と、音量の引き下げ
  const kinds = r.events.map((e) => e.event);
  assert.ok(kinds.includes("engine.state_changed"));
  const out = r.events.filter((e) => e.event === "output.changed").map((e) => e.data as { level_db: number; reason: string });
  assert.deepEqual(out.map((d) => [d.level_db, d.reason]), [[-20, "reset_to_default"]]);
});

test("中断からの「音声開始」(人の操作)でも、音量は引き下げられ、中断前の音量の音は出ない", () => {
  const r = rig();
  r.wb.attach(r.fake, FS);
  r.tone();
  r.ok("human", "engine.start");
  r.ok("human", "output.set_level", { level_db: -3 });
  r.fake.render(9600);
  r.wb.setSuspended(true);
  // AudioContext が先に再開して処理が走っても、開始の指示が届くまでは無音
  assert.equal(peak(r.fake.render(1440)), 0);
  r.ok("human", "engine.start");
  assert.equal(r.wb.status().audioState, "running");
  assert.equal(r.fake.real().levelDb, -20);
  assert.ok(peak(r.fake.render(9600)) <= Math.pow(10, -20 / 20) * 1.05);
});

// ---- ずれの検出と合わせ直し ----

test("ワークレット側の音量・上限・緊急停止が写しとずれたら、次の状態の受信で写しの値に合わせ直す", () => {
  const r = rig();
  r.wb.attach(r.fake, FS);
  r.tone();
  r.ok("human", "engine.start");
  r.ok("human", "output.set_level", { level_db: -30 });
  r.fake.render();
  assert.equal(r.wb.desyncCount, 0);
  // ワークレット側だけが変わってしまった状況を作る(メッセージの取りこぼし等)
  r.fake.core.be.setLevel(0, "human");
  r.fake.core.be.releasePanic();
  assert.notDeepEqual(r.fake.real(), r.mirror());
  r.fake.render();
  assert.equal(r.wb.desyncCount, 1);
  assert.deepEqual(r.fake.real(), r.mirror(), "写し(人の操作の結果)の値に戻る");
  assert.equal(r.fake.real().levelDb, -30);
  r.fake.render();
  assert.equal(r.wb.desyncCount, 1, "合った後は送り直さない");
});

test("操作が届く途中の状態(まだ反映されていない分がある)を、ずれと見なさない", () => {
  const r = rig();
  r.wb.attach(r.fake, FS);
  r.ok("human", "engine.start");
  const stale = JSON.parse(JSON.stringify(r.fake.core.status())) as WorkletStatus; // 送る前の状態
  r.ok("human", "output.set_level", { level_db: -10 });
  r.wb.onMessage({ type: "status", status: stale }); // 古い状態が後から届く
  assert.equal(r.wb.desyncCount, 0);
  assert.equal(r.wb.status().levelDb, -10);
});

// ---- 差分の失敗と例外 ----

test("ワークレットが差分の途中で失敗したら、その1コマンド分は何も適用せず、渡し直しを求める。渡し直しで正本と一致する", () => {
  const r = rig();
  r.wb.attach(r.fake, FS);
  r.tone();
  r.ok("human", "engine.start");
  r.fake.render();
  const ids = () => (r.fake.core.be as unknown as { engine: { ids(): string[] } }).engine.ids().sort();
  // 2件目が失敗する差分を直接送る(未知の種別)
  r.fake.postMessage({
    type: "ops",
    revision: 99,
    ops: [
      { op: "add", module: { id: "ok1", type: "MOD-UTL-001", spec_version: "0.2", params: {} } },
      { op: "add", module: { id: "bad", type: "MOD-XXX-999", spec_version: "0.2", params: {} } },
    ],
  });
  r.fake.render();
  assert.deepEqual(ids(), ["out", "vco"], "1件目も適用されていない");
  assert.equal(r.fake.errors.filter((e) => e.resync).length, 1);
  assert.equal(r.fake.core.be.status().engineRevision, r.s.revision, "反映済みのリビジョンは進まない");
  r.s.resyncBackend();
  r.fake.render();
  assert.deepEqual(ids(), r.s.getPatch().modules.map((m) => m.id).sort());
  assert.ok(peak(r.fake.render(9600)) > 0, "音は出続ける");
});

test("音声の処理が例外を出したら、無音にして1回だけ知らせる(毎ブロックは知らせない)。パッチ全体が届けば再開する", () => {
  const r = rig();
  r.wb.attach(r.fake, FS);
  r.tone();
  r.ok("human", "engine.start");
  r.fake.render(1280);
  const be = r.fake.core.be as unknown as { engine: { tick(): void } };
  const tick = be.engine.tick;
  be.engine.tick = () => {
    throw new Error("壊れた");
  };
  const out = r.fake.render(1280); // 10 ブロック
  assert.equal(peak(out), 0);
  assert.equal(r.fake.errors.length, 1, "知らせるのは1回");
  assert.equal(r.fake.errors[0]!.resync, true);
  be.engine.tick = tick;
  assert.equal(peak(r.fake.render(1280)), 0, "渡し直しが届くまでは無音のまま");
  r.s.resyncBackend();
  assert.ok(peak(r.fake.render(9600)) > 0);
  assert.equal(r.fake.errors.length, 1);
});

// ---- メーター ----

test("メーターを追加した直後(測定値がまだ届いていない)の meter.read は、初期状態の値を返す(ERR-010 にならない)", () => {
  const r = rig();
  r.wb.attach(r.fake, FS);
  r.ok("human", "engine.start");
  r.fake.render();
  // ワークレットへの配送を止めた状態を作る: 追加の直後、状態が届く前に読む
  r.ok("agent", "module.add", { id: "mt", type: "MOD-IO-003" });
  const got = r.ok("agent", "meter.read", { module_id: "mt", fields: ["level", "peak", "windows", "frame_seq", "frame"] });
  const v = got.result.values as Record<string, unknown>;
  assert.equal(v.level, 0);
  assert.equal(v.windows, 0);
  assert.equal(v.frame_seq, 0);
  assert.ok(Array.isArray(v.frame));
});

test("波形フレームは変わったときだけ状態に載る。meter.read の frame は、最後に届いたフレーム", () => {
  const r = rig();
  r.wb.attach(r.fake, FS);
  r.tone();
  r.ok("agent", "module.add", { id: "mt", type: "MOD-IO-003", params: { trig_mode: 0, capture_len: 64 } });
  r.ok("agent", "cable.connect", { from: { module: "vco", port: "saw" }, to: { module: "mt", port: "IN" } });
  r.ok("human", "engine.start");
  r.fake.render(4800);
  const a = r.fake.sendStatus(); // 処理を挟まない: フレームは変わっていない
  assert.equal("frame" in a.meters.mt!, false, "変わっていないフレームは運ばない");
  assert.equal(typeof a.meters.mt!.frame_seq, "number");
  const read = r.ok("agent", "meter.read", { module_id: "mt", fields: ["frame", "frame_seq"] }).result.values as { frame: number[]; frame_seq: number };
  assert.equal(read.frame.length, 64);
  assert.ok(read.frame.some((x) => x !== 0));
  assert.equal(read.frame_seq, a.meters.mt!.frame_seq);
  r.fake.core.process(new Float32Array(4800), new Float32Array(4800));
  const b = r.fake.sendStatus();
  assert.equal("frame" in b.meters.mt!, true, "変わったら運ぶ");
});

// ---- ワークレットとの接続を失ったとき ----

test("ワークレットとの接続を捨てる(detach)と音声は「停止」になり、開始は ERR-304。つなぎ直せば、開始で全体が渡り、音量・緊急停止も持ち越される", () => {
  const r = rig();
  r.wb.attach(r.fake, FS);
  r.tone();
  r.ok("human", "engine.start");
  r.ok("agent", "engine.panic");
  r.wb.detach("音声の処理が停止した");
  assert.equal(r.wb.status().audioState, "stopped");
  assert.equal((r.send("human", "engine.start") as FailureResponse).error.id, "ERR-304");
  assert.equal(r.wb.status().panic, true, "緊急停止は消えない");
  const r2 = new FakeWorklet((st) => r.wb.onMessage({ type: "status", status: st }));
  r.wb.attach(r2, FS);
  r.ok("human", "engine.start");
  assert.equal(r2.received.map((m) => m.type).join(","), "sync,apply,start");
  assert.equal(r2.real().panic, true);
  assert.equal(peak(r2.render(4800)), 0);
});

// ---- 出力段 ----

test("出力段: 内部の状態が非数になっても、出力は有限で ±1.0 以内(非数を外へ出さない)", () => {
  const st = new OutputStage(FS);
  st.start();
  for (let i = 0; i < 4800; i++) st.step(0.5, 0.5);
  (st as unknown as { levelGain: number }).levelGain = NaN; // 状態が壊れた状況
  st.step(0.5, 0.5);
  assert.equal(st.outL[0], 0);
  assert.equal(st.outR[0], 0);
  assert.ok(st.status().nonfiniteCount >= 1);
  for (let i = 0; i < 4800; i++) {
    st.step(0.5, 0.5);
    assert.ok(Number.isFinite(st.outL[0]!) && Math.abs(st.outL[0]!) <= 1);
  }
  assert.ok(Math.abs(st.outL[0]!) > 0, "作り直した状態で復帰する");
});

test("出力段: 過大入力(±1000)と非有限値を混ぜた入力でも、全サンプルが有限で ±1.0 以内。音量は、既定値より上から始めても引き下げの契機で上がらない", () => {
  const st = new OutputStage(FS);
  st.setLevel(0, "human"); // 既定値(−20)より上
  st.start();
  assert.equal(st.status().levelDb, -20, "開始で引き下げ");
  st.setLevel(-5, "human");
  let worst = 0;
  const inputs = [1000, -1000, NaN, Infinity, -Infinity, 0.5, 1e30, -1e-30];
  for (let i = 0; i < 48000; i++) {
    st.step(inputs[i % inputs.length]!, inputs[(i * 7) % inputs.length]!);
    assert.ok(Number.isFinite(st.outL[0]!) && Number.isFinite(st.outR[0]!));
    worst = Math.max(worst, Math.abs(st.outL[0]!), Math.abs(st.outR[0]!));
    if (i === 10000) {
      st.reduce("patch_replaced");
      assert.equal(st.status().levelDb, -20);
    }
    if (i === 20000) {
      st.setLevel(-40, "agent");
      st.reduce("patch_replaced");
      assert.equal(st.status().levelDb, -40, "既定値より下なら変えない(上げない)");
    }
    if (i === 30000) {
      st.panic();
      assert.equal(st.releasePanic(), true);
      assert.equal(st.status().levelDb, -40);
    }
  }
  assert.ok(worst <= 1, `最大 ${worst}`);
  assert.ok(worst <= PROVISIONAL.limiterThreshold + 1e-9, "リミッターのしきい値を超えない");
});

test("出力段: 開始・引き下げの直後は無音から始まり、フェードの時間をかけて目標の音量に達する", () => {
  const st = new OutputStage(FS);
  st.start();
  const steps = Math.round(PROVISIONAL.fadeSeconds * FS);
  const target = Math.pow(10, -20 / 20) * 0.5;
  st.step(0.5, 0.5);
  assert.ok(Math.abs(st.outL[0]!) <= target / steps + 1e-9, "最初のサンプルはほぼ無音");
  let prev = st.outL[0]!;
  for (let i = 1; i < steps; i++) {
    st.step(0.5, 0.5);
    assert.ok(st.outL[0]! >= prev - 1e-12, "単調に増える");
    prev = st.outL[0]!;
  }
  assert.ok(Math.abs(prev - target) < target * 0.01, `フェードの終わりで目標 ${target} に達する(${prev})`);
  const half = new OutputStage(FS);
  half.start();
  for (let i = 0; i < steps / 2; i++) half.step(0.5, 0.5);
  assert.ok(half.outL[0]! < target * 0.6, "半分の時点では、まだ目標の約半分");
});

// ---- MIDI(Issue #29) ----

test("演奏入力(MIDI)は、音声が動作中のときだけ音声側へ渡す。止まっている間・中断中のメッセージはためない", () => {
  const r = rig();
  r.wb.attach(r.fake, FS);
  for (let i = 0; i < 100; i++) r.wb.midi([0xf8]); // 開始前の MIDI クロック
  assert.equal(r.fake.received.filter((m) => m.type === "midi").length, 0);
  r.ok("human", "engine.start");
  r.wb.midi([0x90, 60, 100]);
  assert.equal(r.fake.received.filter((m) => m.type === "midi").length, 1);
  r.wb.setSuspended(true);
  r.wb.midi([0x90, 62, 100]);
  assert.equal(r.fake.received.filter((m) => m.type === "midi").length, 1);
  r.fake.render();
  assert.equal(r.wb.desyncCount, 0, "渡さなかった分で、送受信の数がずれない");
});

test("MIDI の利用可否は engine.get_status の midi.available に出て、変わると EVT-02 が出る", () => {
  const r = rig();
  const available = () => (r.ok("agent", "engine.get_status").result.midi as { available: boolean }).available;
  assert.equal(available(), false);
  r.events.length = 0;
  r.wb.midiAvailable = true;
  r.s.pollBackend();
  assert.equal(available(), true);
  const ev = r.events.filter((e) => e.event === "engine.state_changed");
  assert.equal(ev.length, 1);
  assert.deepEqual((ev[0]!.data as { midi: unknown }).midi, { available: true });
  r.s.pollBackend();
  assert.equal(r.events.filter((e) => e.event === "engine.state_changed").length, 1, "変わらなければ出ない");
});
