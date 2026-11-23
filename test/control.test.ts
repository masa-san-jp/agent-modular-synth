// 共通コマンド処理(src/control/session.ts)の試験。
// 前半は operation-contract §18 の受入例(AX-01〜AX-16)。期待値は契約の表のまま。
// 後半は、人とエージェントの交互操作、batch、冪等キー、競合、取り消し、seed、自動採番など。
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCatalog } from "../src/control/catalog.js";
import { ERRORS } from "../src/control/errors.js";
import { RecordingBackend, Session } from "../src/control/session.js";
import {
  ActorKind,
  AudioState,
  CommandResponse,
  FailureResponse,
  Patch,
  PatchModule,
  SessionEvent,
  SuccessResponse,
} from "../src/control/types.js";
import { REGISTRY } from "../src/modules/registry.js";

const CATALOG = buildCatalog(REGISTRY);

/** 基準パッチ P0 = data-contract §11 の完全な例。 */
const P0: Patch = {
  format: "modular-synth-patch",
  schema_version: 1,
  meta: {
    title: "基本の減算シンセ",
    description: "MIDI-CV → VCO(saw) → LPF → VCA → 出力。ADSRがVCAを開閉する。",
    created_at: "2026-11-13T09:00:00Z",
    modified_at: "2026-11-13T09:30:00Z",
    saved_by: { kind: "human" },
    app_version: "0.1.0",
  },
  modules: [
    { id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1.0, mute: 0 }, ui: { x: 40, y: 0 } },
    { id: "midi1", type: "MOD-IO-002", spec_version: "0.2", params: { channel: 0, transpose: 0, voices: 1, cc_number: 1 }, ui: { x: 0, y: 0 } },
    { id: "vco1", type: "MOD-OSC-001", spec_version: "0.2", params: { range: 0, tune: 0.0, fm_amt: 0.0, pw: 0.5, pwm_amt: 0.0 }, ui: { x: 10, y: 0 } },
    { id: "vcf1", type: "MOD-FLT-001", spec_version: "0.2", params: { cutoff: 1.0, res: 0.3, cv2_level: 1.0, cv3_level: 1.0 }, ui: { x: 20, y: 0 } },
    {
      id: "vca1",
      type: "MOD-AMP-001",
      spec_version: "0.2",
      params: { gain: 0.0, in1_level: 1.0, in2_level: 1.0, cv2_level: 1.0, out_level: 1.0, response: 0 },
      ui: { x: 30, y: 0 },
    },
    { id: "env1", type: "MOD-ENV-001", spec_version: "0.2", params: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 }, ui: { x: 20, y: 1 } },
  ],
  cables: [
    { id: "c1", from: { module: "midi1", port: "PITCH" }, to: { module: "vco1", port: "pitch" } },
    { id: "c2", from: { module: "vco1", port: "saw" }, to: { module: "vcf1", port: "in" } },
    { id: "c3", from: { module: "vcf1", port: "out" }, to: { module: "vca1", port: "in1" } },
    { id: "c4", from: { module: "midi1", port: "GATE" }, to: { module: "env1", port: "gate" } },
    { id: "c5", from: { module: "env1", port: "env" }, to: { module: "vca1", port: "cv1" } },
    { id: "c6", from: { module: "vca1", port: "out" }, to: { module: "out", port: "IN_L" } },
  ],
};

interface Rig {
  s: Session;
  be: RecordingBackend;
  events: SessionEvent[];
  /** 要求を送る(封筒の v と request_id を補う)。 */
  send(actor: ActorKind, command: string, args?: Record<string, unknown>, extra?: Record<string, unknown>): CommandResponse;
  ok(actor: ActorKind, command: string, args?: Record<string, unknown>, extra?: Record<string, unknown>): SuccessResponse;
  fail(actor: ActorKind, command: string, args?: Record<string, unknown>, extra?: Record<string, unknown>): FailureResponse;
  param(module: string, name: string): number;
  module(id: string): PatchModule | undefined;
}

let counter = 0;

function rig(opts: { audioState?: AudioState; patch?: Patch | null; revision?: number; limits?: Record<string, number> } = {}): Rig {
  const be = new RecordingBackend({ audioState: opts.audioState ?? "running" });
  const patch = opts.patch === null ? undefined : (opts.patch ?? P0);
  const s = new Session({
    catalog: CATALOG,
    backend: be,
    sessionId: "s-test",
    ...(patch ? { patch } : {}),
    revision: opts.revision ?? (patch ? 10 : 0),
    ...(opts.limits ? { limits: opts.limits } : {}),
  });
  be.calls.length = 0;
  const events: SessionEvent[] = [];
  s.subscribe((ev) => events.push(ev));
  const send: Rig["send"] = (actor, command, args, extra) =>
    s.handle({ v: 1, request_id: `r-${++counter}`, command, ...(args ? { args } : {}), ...(extra ?? {}) }, actor);
  return {
    s,
    be,
    events,
    send,
    ok(actor, command, args, extra) {
      const r = send(actor, command, args, extra);
      assert.equal(r.ok, true, `${command} は成功するはず: ${JSON.stringify(r)}`);
      return r as SuccessResponse;
    },
    fail(actor, command, args, extra) {
      const r = send(actor, command, args, extra);
      assert.equal(r.ok, false, `${command} は失敗するはず: ${JSON.stringify(r)}`);
      return r as FailureResponse;
    },
    param: (module, name) => s.getPatch().modules.find((m) => m.id === module)!.params[name]!,
    module: (id) => s.getPatch().modules.find((m) => m.id === id),
  };
}

/** 失敗した要求が状態を一切変えないこと(パッチ・リビジョン・履歴・通知・音声側)を確かめる枠。 */
function unchanged(r: Rig, fn: () => void): void {
  const patch = r.s.getPatch();
  const rev = r.s.revision;
  const history = r.s.history;
  const events = r.events.length;
  const calls = r.be.calls.length;
  fn();
  assert.deepEqual(r.s.getPatch(), patch, "パッチは不変");
  assert.equal(r.s.revision, rev, "リビジョンは不変");
  assert.deepEqual(r.s.history, history, "履歴は不変");
  assert.equal(r.events.length, events, "通知なし");
  assert.equal(r.be.calls.length, calls, "音声側への呼出しなし");
}

function expectError(res: FailureResponse, id: keyof typeof ERRORS): void {
  assert.equal(res.error.id, id, JSON.stringify(res.error));
  assert.equal(res.error.code, ERRORS[id]);
}

const patchChanged = (events: SessionEvent[]) => events.filter((e) => e.event === "patch.changed");
const outputChanged = (events: SessionEvent[]) => events.filter((e) => e.event === "output.changed");

// =====================================================================================
// 受入例(operation-contract §18)
// =====================================================================================

test("前提: P0 は revision 10、running、patch.get が P0 と一致する", () => {
  const r = rig();
  const res = r.ok("agent", "patch.get");
  assert.equal(res.revision, 10);
  assert.equal(res.audio_state, "running");
  assert.equal(res.session_id, "s-test");
  assert.deepEqual(res.actor, { kind: "agent" });
  assert.deepEqual(res.result.patch, P0);
  assert.deepEqual(res.result.history, { can_undo: false, can_redo: false });
});

test("AX-01: パッチ保存→復元", { skip: "この層(Session 単体)の対象外: 保存先を使うコマンドは Controller が処理する。AX-01 の確認は test/controller.test.ts" }, () => {});

test("AX-02a: 無効な接続(方向)", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.fail("agent", "cable.connect", { from: { module: "vco1", port: "pitch" }, to: { module: "vcf1", port: "cv2" } });
    expectError(res, "ERR-112");
    assert.equal(res.revision, 10);
  });
});

test("AX-02b: 無効な接続(入力が使用中)", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.fail("agent", "cable.connect", { from: { module: "vco1", port: "pulse" }, to: { module: "vcf1", port: "in" } });
    expectError(res, "ERR-114");
    assert.equal(res.error.details.existing_cable_id, "c2");
    assert.equal(res.error.details.same_source, false);
  });
});

test("AX-02c: 無効な接続(接続できないポート)", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.fail("agent", "cable.connect", { from: { module: "out", port: "DEV_L" }, to: { module: "vcf1", port: "cv2" } });
    expectError(res, "ERR-113");
  });
});

test("AX-03a: 存在しないモジュール", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.fail("agent", "param.set", { module_id: "m99", param: "cutoff", value: 1.0 });
    expectError(res, "ERR-102");
    assert.equal(res.error.details.module_id, "m99");
    assert.equal(res.revision, 10);
  });
});

test("AX-03b: 存在しないポート", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.fail("agent", "cable.connect", { from: { module: "vco1", port: "square" }, to: { module: "vcf1", port: "cv2" } });
    expectError(res, "ERR-111");
  });
});

test("AX-03c: 存在しないケーブル", () => {
  const r = rig();
  unchanged(r, () => {
    expectError(r.fail("agent", "cable.disconnect", { cable_id: "c99" }), "ERR-115");
  });
});

test("AX-03d: 存在しないパラメータ", () => {
  const r = rig();
  unchanged(r, () => {
    expectError(r.fail("agent", "param.set", { module_id: "vcf1", param: "resonance", value: 0.5 }), "ERR-121");
  });
});

test("AX-04a: 不正パラメータ(範囲外)", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.fail("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: 7.5 });
    expectError(res, "ERR-123");
    assert.equal(res.error.details.min, -5);
    assert.equal(res.error.details.max, 6);
  });
  assert.equal(r.param("vcf1", "cutoff"), 1.0, "6 にクランプされない");
});

test("AX-04b: 不正パラメータ(型違い)", () => {
  const r = rig();
  unchanged(r, () => {
    expectError(r.fail("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: "high" }), "ERR-122");
  });
});

test("AX-04c: 不正パラメータ(NaNの代用)", () => {
  const r = rig();
  unchanged(r, () => {
    expectError(r.fail("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: null }), "ERR-122");
    expectError(r.fail("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: "NaN" }), "ERR-122");
  });
});

test("AX-04d: 不正パラメータ(整数型に非整数)", () => {
  const r = rig();
  unchanged(r, () => {
    expectError(r.fail("agent", "param.set", { module_id: "vco1", param: "range", value: 0.5 }), "ERR-122");
  });
  assert.equal(r.param("vco1", "range"), 0, "1 に丸められない");
});

test("AX-05a: 中断・再送", () => {
  const r = rig();
  const args = { module_id: "vcf1", param: "res", value: 0.4 };
  const first = r.ok("agent", "param.set", args, { idempotency_key: "k-001" });
  assert.equal(first.revision, 11);
  assert.equal(first.replayed, false);
  const second = r.ok("agent", "param.set", args, { idempotency_key: "k-001" });
  assert.equal(second.revision, 11);
  assert.equal(second.replayed, true);
  assert.notEqual(second.request_id, first.request_id, "request_id は再送側の値");
  assert.deepEqual(second.result, first.result);
  assert.equal(r.param("vcf1", "res"), 0.4);
  assert.equal(r.s.revision, 11);
  assert.equal(patchChanged(r.events).length, 1, "EVT-01 は1件");
  // 履歴は1件だけ増える
  r.ok("agent", "history.undo");
  assert.equal(r.param("vcf1", "res"), 0.3);
  expectError(r.fail("agent", "history.undo"), "ERR-141");
});

test("AX-05b: 冪等キーの使い回し", () => {
  const r = rig();
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.4 }, { idempotency_key: "k-001" });
  unchanged(r, () => {
    const res = r.fail("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.8 }, { idempotency_key: "k-001" });
    expectError(res, "ERR-009");
    assert.equal(res.revision, 11);
  });
  assert.equal(r.param("vcf1", "res"), 0.4);
});

test("AX-06: 競合", () => {
  const r = rig();
  assert.equal(r.ok("human", "param.set", { module_id: "vcf1", param: "cutoff", value: 3.0 }).revision, 11);
  unchanged(r, () => {
    const res = r.fail("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: 2.0 }, { expected_revision: 10 });
    expectError(res, "ERR-008");
    assert.equal(res.error.details.expected_revision, 10);
    assert.equal(res.error.details.current_revision, 11);
    assert.equal(res.revision, 11);
  });
  assert.equal(r.param("vcf1", "cutoff"), 3.0, "人の変更が残る");
});

test("AX-07: フィードバック接続(自己接続)", () => {
  const r = rig();
  const res = r.ok("agent", "cable.connect", { from: { module: "vcf1", port: "out" }, to: { module: "vcf1", port: "cv2" }, id: "fb1" });
  assert.equal(res.revision, 11);
  assert.equal((res.result.cable as { id: string }).id, "fb1");
  assert.equal(res.warnings[0]!.code, "type_mismatch");
  assert.deepEqual(
    { from: res.warnings[0]!.details.from_type, to: res.warnings[0]!.details.to_type },
    { from: "audio", to: "cv" },
  );
  assert.deepEqual(
    r.s.getPatch().cables.find((c) => c.id === "fb1"),
    { id: "fb1", from: { module: "vcf1", port: "out" }, to: { module: "vcf1", port: "cv2" } },
  );
  // 「ループは1サンプル遅延で動作する」はエンジンの性質(COM-06)。ここでは音声側へ接続が渡ることまでを見る
  assert.equal(r.be.callsOf("connect").length, 1);
});

const AX08_OPS = (freq: number) => [
  { command: "module.add", args: { type: "MOD-LFO-001", id: "lfo1" } },
  { command: "cable.connect", args: { from: { module: "lfo1", port: "sine" }, to: { module: "vcf1", port: "cv3" } } },
  { command: "param.set", args: { module_id: "lfo1", param: "freq", value: freq } },
];

test("AX-08a: batch の部分失敗", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.fail("agent", "batch", { ops: AX08_OPS(9999) });
    expectError(res, "ERR-131");
    assert.equal(res.error.details.failed_index, 2);
    assert.equal((res.error.details.cause as { id: string }).id, "ERR-123");
    assert.equal(res.revision, 10);
  });
  assert.equal(r.module("lfo1"), undefined);
  assert.equal(r.s.getPatch().cables.length, 6);
});

test("AX-08b: batch の成功", () => {
  const r = rig();
  const res = r.ok("agent", "batch", { ops: AX08_OPS(0.5) });
  assert.equal(res.revision, 11);
  assert.equal((res.result.results as unknown[]).length, 3);
  assert.ok(r.module("lfo1"));
  assert.equal(r.param("lfo1", "freq"), 0.5);
  assert.equal(r.s.getPatch().cables.length, 7);
  assert.equal(r.s.revision, 11, "リビジョンは1だけ進む");
  assert.equal(patchChanged(r.events).length, 1, "通知は1件");
  const undo = r.ok("agent", "history.undo");
  assert.equal(undo.revision, 12);
  assert.deepEqual(r.s.getPatch(), P0, "history.undo 1回で3つとも戻る");
});

test("AX-09a: 音声未開始時の編集", () => {
  const r = rig({ audioState: "stopped" });
  const res = r.ok("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: 2.0 });
  assert.equal(res.revision, 11);
  assert.equal(res.audio_state, "stopped");
  assert.equal(r.param("vcf1", "cutoff"), 2.0);
  // 開始後のエンジンは cutoff = 2.0 で始まる: 開始時に現在のパッチ全体を渡す
  r.ok("human", "engine.start");
  const built = r.be.callsOf("applyPatch").at(-1)![1] as Patch;
  assert.equal(built.modules.find((m) => m.id === "vcf1")!.params.cutoff, 2.0);
});

test("AX-09b: 音声未開始時の読出し", () => {
  const r = rig({ audioState: "stopped" });
  assert.equal(r.ok("agent", "module.add", { type: "MOD-IO-003", id: "scope1" }).revision, 11);
  unchanged(r, () => {
    const res = r.fail("agent", "meter.read", { module_id: "scope1" });
    expectError(res, "ERR-301");
    assert.equal(res.error.details.audio_state, "stopped");
  });
});

test("AX-09c: 音声の自動開始の試み", () => {
  const r = rig({ audioState: "stopped" });
  unchanged(r, () => {
    const res = r.fail("agent", "engine.start");
    expectError(res, "ERR-005");
    assert.equal(res.audio_state, "stopped");
  });
  assert.equal(r.be.audioState, "stopped", "音声は開始されない");
});

test("AX-10a: 権限外(緊急停止の解除)", () => {
  const r = rig();
  const first = r.ok("agent", "engine.panic");
  assert.equal(first.result.panic, true);
  const second = r.fail("agent", "engine.release_panic");
  expectError(second, "ERR-005");
  assert.equal(r.be.panicOn, true, "緊急停止のまま");
  assert.deepEqual(r.s.getPatch(), P0);
  assert.equal(r.s.revision, 10);
});

test("AX-10b: 権限外(音量上限)", () => {
  const r = rig();
  assert.equal(r.be.agentMaxLevelDb, -20);
  const before = r.be.levelDb;
  unchanged(r, () => {
    const res = r.fail("agent", "output.set_level", { level_db: -6 });
    expectError(res, "ERR-302");
    assert.equal(res.error.details.max_db, -20);
  });
  assert.equal(r.be.levelDb, before, "音量は不変(−20 にクランプされない)");
});

test("AX-10c: 権限外(保存先)", () => {
  // patch.save 自体は未実装だが、名前の検査(ERR-201)はこの層で行う。「ファイルは作られない」は保存の実装がないので自明
  const r = rig();
  unchanged(r, () => {
    expectError(r.fail("agent", "patch.save", { name: "../etc/x" }), "ERR-201");
  });
});

test("AX-10d: 常設モジュールの削除", () => {
  const r = rig();
  unchanged(r, () => {
    expectError(r.fail("agent", "module.remove", { module_id: "out" }), "ERR-104");
  });
});

test("AX-10e: トークンなし", { skip: "この層(Session 単体)の対象外: 認証(ERR-004)はローカルサーバーの責務。AX-10e の確認は test/server.test.ts" }, () => {});

test("AX-11: 人とエージェントの取り消し", () => {
  const r = rig();
  assert.equal(r.ok("agent", "param.set", { module_id: "env1", param: "attack", value: 0.5 }).revision, 11);
  r.events.length = 0;
  const res = r.ok("human", "history.undo");
  assert.equal(res.revision, 12);
  const undone = res.result.undone as { command: string; actor: { kind: string } };
  assert.equal(undone.command, "param.set");
  assert.equal(undone.actor.kind, "agent");
  assert.equal(r.param("env1", "attack"), 0.01);
  const ev = patchChanged(r.events);
  assert.equal(ev.length, 1);
  const data = ev[0]!.data as { actor: { kind: string }; command: string };
  assert.equal(data.actor.kind, "human");
  assert.equal(data.command, "history.undo");
});

test("AX-12: 壊れたパッチの読込", { skip: "この層(Session 単体)の対象外: patch.load と読込時の検証は Controller が処理する。AX-12 の確認は test/controller.test.ts" }, () => {});

test("AX-13: seed の自動割当", () => {
  const r = rig();
  const a = r.ok("agent", "module.add", { type: "MOD-NSE-001", id: "n1" });
  const b = r.ok("agent", "module.add", { type: "MOD-NSE-001", id: "n2" });
  assert.equal((a.result.module as PatchModule).params.seed, 1);
  assert.equal((b.result.module as PatchModule).params.seed, 17);
  assert.equal(a.revision, 11);
  assert.equal(b.revision, 12);
  // 「異なる乱数列を出す」は seed が違うこと(COM-11)による。音声側へも別の seed が渡る
  const seeds = r.be.callsOf("addModule").map((c) => (c[1] as PatchModule).params.seed);
  assert.deepEqual(seeds, [1, 17]);
});

test("AX-14: セッションなし", { skip: "この層(Session 単体)の対象外: タブがない場合(ERR-006)はローカルサーバーの責務。AX-14 の確認は test/server.test.ts" }, () => {});

test("AX-15: 同じ値の設定", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.ok("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: 1.0 });
    assert.equal(res.revision, 10);
    assert.equal(res.result.changed, false);
  });
});

test("AX-16: 読込で音量が上がらない", () => {
  const r = rig();
  const D = r.be.defaultLevelDb;
  r.ok("human", "output.set_level", { level_db: D - 10 });
  assert.equal(r.be.levelDb, D - 10);
  assert.equal(r.be.agentMaxLevelDb, D - 10);
  r.events.length = 0;
  r.be.calls.length = 0;
  assert.equal(r.ok("agent", "patch.new").revision, 11);
  assert.equal(r.ok("agent", "history.undo").revision, 12);
  const st = r.ok("agent", "engine.get_status");
  const output = st.result.output as { level_db: number; agent_max_level_db: number };
  assert.equal(output.level_db, D - 10);
  assert.equal(output.agent_max_level_db, D - 10);
  // ①②のそれぞれで全体を作り直す(フェードインは音声側が行う)
  assert.equal(r.be.callsOf("applyPatch").length, 2);
  assert.equal(outputChanged(r.events).length, 0, "EVT-03(reset_to_default)は出ない");
  assert.deepEqual(r.s.getPatch().modules, P0.modules);
});

// =====================================================================================
// 封筒と処理順(§3)
// =====================================================================================

test("封筒: 壊れた要求は ERR-001、未対応の版は ERR-012、未定義のコマンドは ERR-002", () => {
  const r = rig();
  unchanged(r, () => {
    for (const bad of [null, "x", 42, [], { request_id: "a", command: "patch.get" }, { v: 1, command: "patch.get" }]) {
      const res = r.s.handle(bad, "agent") as FailureResponse;
      expectError(res, "ERR-001");
      assert.equal(res.revision, 10);
      assert.equal(res.session_id, "s-test");
    }
    expectError(r.s.handle({ v: 1, request_id: "", command: "patch.get" }, "agent") as FailureResponse, "ERR-001");
    expectError(r.s.handle({ v: 1, request_id: "a", command: 5 }, "agent") as FailureResponse, "ERR-001");
    expectError(r.s.handle({ v: 1, request_id: "a", command: "patch.get", args: [] }, "agent") as FailureResponse, "ERR-001");
    expectError(r.s.handle({ v: 1, request_id: "a", command: "patch.get", expected_revision: -1 }, "agent") as FailureResponse, "ERR-001");
    expectError(r.s.handle({ v: 1, request_id: "a", command: "patch.get", idempotency_key: "" }, "agent") as FailureResponse, "ERR-001");
    const v2 = r.s.handle({ v: 2, request_id: "a", command: "patch.get" }, "agent") as FailureResponse;
    expectError(v2, "ERR-012");
    const unknown = r.fail("agent", "server.stop");
    expectError(unknown, "ERR-002");
    assert.equal(unknown.error.details.command, "server.stop");
  });
});

test("封筒: actor は要求で指定できない(受け口の値だけが使われる)。client_id は応答に写る", () => {
  const r = rig({ audioState: "stopped" });
  // 要求に actor を書いても人にはなれない
  const forged = r.s.handle({ v: 1, request_id: "a", command: "engine.start", actor: { kind: "human" } }, "agent") as FailureResponse;
  assert.equal(forged.ok, false);
  assert.equal(r.be.audioState, "stopped");
  const res = r.ok("agent", "patch.get", undefined, { client_id: "agent-a" });
  assert.deepEqual(res.actor, { kind: "agent", client_id: "agent-a" });
});

test("封筒: 未知の引数は ERR-003(打ち間違いを黙って無視しない)", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.fail("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: 2, valeu: 3 });
    expectError(res, "ERR-003");
    assert.equal(res.error.details.arg, "valeu");
    expectError(r.fail("agent", "patch.get", { x: 1 }), "ERR-003");
    expectError(r.fail("agent", "param.set", { module_id: "vcf1", param: "cutoff" }), "ERR-003");
    expectError(r.fail("agent", "module.add", { type: "MOD-LFO-001", id: "Bad-ID" }), "ERR-003");
    expectError(r.fail("agent", "module.move", { module_id: "vcf1", ui: { x: 1 } }), "ERR-003");
    expectError(r.fail("agent", "cable.disconnect", {}), "ERR-003");
    expectError(r.fail("agent", "cable.disconnect", { cable_id: "c1", to: { module: "vco1", port: "pitch" } }), "ERR-003");
    expectError(r.fail("agent", "patch.set_meta", {}), "ERR-003");
    expectError(r.fail("agent", "patch.set_meta", { title: "x".repeat(121) }), "ERR-003");
  });
});

test("処理順: 権限(ERR-005)→ 冪等キー(ERR-009)→ expected_revision(ERR-008)→ 引数(ERR-003)→ 対象(ERR-102)→ 値(ERR-123)", () => {
  const r = rig();
  // 権限は expected_revision より先
  expectError(r.fail("agent", "engine.release_panic", {}, { expected_revision: 3 }), "ERR-005");
  // 冪等キーの使い回しは expected_revision より先
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.4 }, { idempotency_key: "k" });
  expectError(r.fail("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 }, { idempotency_key: "k", expected_revision: 3 }), "ERR-009");
  // expected_revision は引数より先
  expectError(r.fail("agent", "param.set", { bogus: 1 }, { expected_revision: 3 }), "ERR-008");
  // 引数の形は対象の存在より先
  expectError(r.fail("agent", "param.set", { module_id: "m99", param: "cutoff", value: 1, bogus: 1 }), "ERR-003");
  // 対象の存在は値より先
  expectError(r.fail("agent", "param.set", { module_id: "m99", param: "cutoff", value: 99 }), "ERR-102");
  expectError(r.fail("agent", "param.set", { module_id: "vcf1", param: "nope", value: "x" }), "ERR-121");
});

test("通知は応答の後に出る(§10)", () => {
  const r = rig();
  const order: string[] = [];
  r.s.subscribe((ev) => order.push(`event:${ev.event}`));
  r.s.handle({ v: 1, request_id: "a", command: "param.set", args: { module_id: "vcf1", param: "res", value: 0.5 } }, "human", (res) =>
    order.push(`response:${res.ok}`),
  );
  assert.deepEqual(order, ["response:true", "event:patch.changed"]);
});

// =====================================================================================
// 人とエージェントの交互操作
// =====================================================================================

test("交互操作: 状態・リビジョン・履歴・通知が1本で進む", () => {
  const r = rig({ patch: null });
  assert.equal(r.s.revision, 0);
  // 人: VCO を追加
  const a = r.ok("human", "module.add", { type: "MOD-OSC-001" });
  assert.equal((a.result.module as PatchModule).id, "m1");
  assert.equal(a.revision, 1);
  // エージェント: フィルタを追加し、つなぐ(人の変更後のリビジョンを前提に)
  const b = r.ok("agent", "module.add", { type: "MOD-FLT-001" }, { expected_revision: 1, client_id: "agent-a" });
  assert.equal((b.result.module as PatchModule).id, "m2");
  assert.equal(b.revision, 2);
  const c = r.ok("agent", "cable.connect", { from: { module: "m1", port: "saw" }, to: { module: "m2", port: "in" } }, { expected_revision: 2 });
  assert.equal((c.result.cable as { id: string }).id, "c1");
  // 人: 出力へつなぎ、パラメータを変える
  const d = r.ok("human", "cable.connect", { from: { module: "m2", port: "out" }, to: { module: "out", port: "IN_L" } });
  assert.equal((d.result.cable as { id: string }).id, "c2");
  const e = r.ok("human", "param.set", { module_id: "m2", param: "cutoff", value: 2 });
  assert.equal(e.revision, 5);
  // エージェント: 古いリビジョンを前提にした変更は競合
  expectError(r.fail("agent", "param.set", { module_id: "m2", param: "res", value: 0.5 }, { expected_revision: 4 }), "ERR-008");
  // エージェント: 最新を前提にやり直す
  const f = r.ok("agent", "param.set", { module_id: "m2", param: "res", value: 0.5 }, { expected_revision: 5 });
  assert.equal(f.revision, 6);

  // 通知: 成功した変更1件につき EVT-01 が1件、リビジョンの順、誰の操作か分かる
  const evs = patchChanged(r.events).map((x) => x.data as { revision: number; previous_revision: number; actor: { kind: string }; command: string });
  assert.deepEqual(
    evs.map((x) => [x.previous_revision, x.revision, x.actor.kind, x.command]),
    [
      [0, 1, "human", "module.add"],
      [1, 2, "agent", "module.add"],
      [2, 3, "agent", "cable.connect"],
      [3, 4, "human", "cable.connect"],
      [4, 5, "human", "param.set"],
      [5, 6, "agent", "param.set"],
    ],
  );
  assert.deepEqual((r.events[1]!.data as { actor: unknown }).actor, { kind: "agent", client_id: "agent-a" });

  // 取り消し: 誰が行ったかに関係なく直前の変更から戻る(履歴は1本)
  const u1 = r.ok("human", "history.undo");
  assert.deepEqual(u1.result.undone, { command: "param.set", actor: { kind: "agent" }, revision: 6 });
  assert.equal(r.param("m2", "res"), 0);
  const u2 = r.ok("agent", "history.undo");
  assert.deepEqual(u2.result.undone, { command: "param.set", actor: { kind: "human" }, revision: 5 });
  assert.equal(r.param("m2", "cutoff"), CATALOG.get("MOD-FLT-001")!.params.find((p) => p.name === "cutoff")!.default);
  assert.equal(u2.revision, 8);
  // やり直しも同じ1本
  const re = r.ok("human", "history.redo");
  assert.deepEqual(re.result.redone, { command: "param.set", actor: { kind: "human" }, revision: 5 });
  assert.equal(r.param("m2", "cutoff"), 2);
  assert.equal(re.revision, 9);
  assert.deepEqual(re.result.history, { can_undo: true, can_redo: true });
  // patch.get は両者に同じ状態を返す
  assert.deepEqual(r.ok("human", "patch.get").result, r.ok("agent", "patch.get").result);
});

// =====================================================================================
// batch(CMD-09)
// =====================================================================================

test("batch: 部分失敗で状態・次番号・履歴・音声側が変わらない", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.fail("agent", "batch", {
      ops: [
        { command: "module.add", args: { type: "MOD-LFO-001" } },
        { command: "module.remove", args: { module_id: "vca1" } },
        { command: "param.set", args: { module_id: "vcf1", param: "res", value: 0.9 } },
        { command: "cable.connect", args: { from: { module: "m1", port: "sine" }, to: { module: "nope", port: "x" } } },
      ],
    });
    expectError(res, "ERR-131");
    assert.equal(res.error.details.failed_index, 3);
    const cause = res.error.details.cause as { id: string; code: string; details: { module_id: string } };
    assert.equal(cause.id, "ERR-102");
    assert.equal(cause.code, "module_not_found");
    assert.equal(cause.details.module_id, "nope");
  });
  // 失敗した batch が使った番号は消費されない(状態は一切変わらない)
  assert.equal((r.ok("agent", "module.add", { type: "MOD-LFO-001" }).result.module as PatchModule).id, "m1");
});

test("batch: 入れられないコマンドは ERR-132(何も検証しない)。操作数の上限は ERR-106", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.fail("agent", "batch", {
      ops: [
        { command: "param.set", args: { module_id: "nope", param: "x", value: 1 } },
        { command: "patch.new", args: {} },
      ],
    });
    expectError(res, "ERR-132");
    assert.deepEqual(res.error.details, { index: 1, command: "patch.new" });
    expectError(r.fail("agent", "batch", { ops: [{ command: "batch", args: { ops: [] } }] }), "ERR-132");
    expectError(r.fail("agent", "batch", { ops: [{ command: "history.undo" }] }), "ERR-132");
    const many = Array.from({ length: 501 }, () => ({ command: "param.set", args: { module_id: "vcf1", param: "res", value: 0.5 } }));
    const over = r.fail("agent", "batch", { ops: many });
    expectError(over, "ERR-106");
    assert.equal(over.error.details.max, 500);
    expectError(r.fail("agent", "batch", { ops: [] }), "ERR-003");
    expectError(r.fail("agent", "batch", { ops: [{ command: "param.set", args: {}, expected_revision: 1 }] }), "ERR-003");
  });
});

test("batch: 後の操作は前の操作の結果を参照できる。外す → つなぐを1回で行える。warnings は index 付き", () => {
  const r = rig();
  const res = r.ok("agent", "batch", {
    ops: [
      { command: "cable.disconnect", args: { to: { module: "vcf1", port: "in" } } },
      { command: "cable.connect", args: { from: { module: "vco1", port: "pulse" }, to: { module: "vcf1", port: "in" } } },
      { command: "cable.connect", args: { from: { module: "vco1", port: "saw" }, to: { module: "vcf1", port: "cv2" } } },
    ],
  });
  assert.equal(res.revision, 11);
  assert.equal(res.result.changed, true);
  const results = res.result.results as { removed_cable?: { id: string }; cable?: { id: string } }[];
  assert.equal(results[0]!.removed_cable!.id, "c2");
  assert.equal(results[1]!.cable!.id, "c7");
  assert.equal(res.warnings.length, 1);
  assert.equal(res.warnings[0]!.code, "type_mismatch");
  assert.equal(res.warnings[0]!.details.index, 2);
  // エンジンへは1つの差分(commit は1回)
  assert.equal(r.be.callsOf("commit").length, 1);
  assert.deepEqual(r.be.callsOf("commit")[0], ["commit", 11]);
  const ev = patchChanged(r.events);
  assert.equal(ev.length, 1);
  assert.deepEqual(
    (ev[0]!.data as { changes: { kind: string }[] }).changes.map((c) => c.kind),
    ["cable_removed", "cable_added", "cable_added"],
  );
});

test("batch: 全操作が無変更なら changed:false で、リビジョン・履歴・通知は変わらない", () => {
  const r = rig();
  unchanged(r, () => {
    const res = r.ok("agent", "batch", {
      ops: [
        { command: "param.set", args: { module_id: "vcf1", param: "cutoff", value: 1.0 } },
        { command: "module.move", args: { module_id: "vcf1", ui: { x: 20, y: 0 } } },
        { command: "patch.set_meta", args: { title: "基本の減算シンセ" } },
      ],
    });
    assert.equal(res.result.changed, false);
    assert.equal(res.revision, 10);
  });
  // 1件でも変われば通常どおり 1 進む
  const res = r.ok("agent", "batch", {
    ops: [
      { command: "param.set", args: { module_id: "vcf1", param: "cutoff", value: 1.0 } },
      { command: "param.set", args: { module_id: "vcf1", param: "res", value: 0.5 } },
    ],
  });
  assert.equal(res.revision, 11);
  assert.deepEqual((res.result.results as { changed: boolean }[]).map((x) => x.changed), [false, true]);
});

// =====================================================================================
// 冪等な再送(§7)と競合(§8)
// =====================================================================================

test("冪等キー: changed:false の成功も保存する。失敗は保存しない。request_id は再送側の値", () => {
  const r = rig();
  const same = { module_id: "vcf1", param: "cutoff", value: 1.0 };
  const a = r.ok("agent", "param.set", same, { idempotency_key: "k1" });
  assert.equal(a.result.changed, false);
  r.ok("human", "param.set", { module_id: "vcf1", param: "cutoff", value: 2.0 });
  // 現在は 2.0 だが、再送には保存済みの応答(changed:false、revision 10)が返り、適用されない
  const b = r.ok("agent", "param.set", same, { idempotency_key: "k1" });
  assert.equal(b.replayed, true);
  assert.equal(b.result.changed, false);
  assert.equal(b.revision, 10, "revision は最初の応答時の値のまま");
  assert.equal(r.param("vcf1", "cutoff"), 2.0);

  // 失敗は保存しない: 同じ鍵で再送すると、あらためて評価される
  const args = { module_id: "lfo9", param: "freq", value: 1 };
  expectError(r.fail("agent", "param.set", args, { idempotency_key: "k2" }), "ERR-102");
  r.ok("human", "module.add", { type: "MOD-LFO-001", id: "lfo9" });
  const c = r.ok("agent", "param.set", args, { idempotency_key: "k2" });
  assert.equal(c.replayed, false);
  assert.equal(r.param("lfo9", "freq"), 1);
});

test("冪等キー: history.undo の再送で2回分戻らない", () => {
  const r = rig();
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 });
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.7 });
  const a = r.ok("agent", "history.undo", undefined, { idempotency_key: "u1" });
  const b = r.ok("agent", "history.undo", undefined, { idempotency_key: "u1" });
  assert.equal(b.replayed, true);
  assert.deepEqual(b.result, a.result);
  assert.equal(r.param("vcf1", "res"), 0.5);
  assert.equal(r.s.revision, 13);
});

test("冪等キー: 読出しと engine.panic では無視する(毎回実行し、ERR-009 も返さない)", () => {
  const r = rig();
  const a = r.ok("agent", "patch.get", undefined, { idempotency_key: "k" });
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 });
  const b = r.ok("agent", "patch.get", undefined, { idempotency_key: "k" });
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, false);
  assert.equal(b.revision, 11);
  // 同じ鍵で別のコマンドでも、鍵を無視するコマンドは ERR-009 にならない
  assert.equal(r.ok("agent", "engine.get_status", undefined, { idempotency_key: "k" }).replayed, false);
  r.ok("agent", "engine.panic", undefined, { idempotency_key: "k" });
  r.ok("agent", "engine.panic", undefined, { idempotency_key: "k" });
  assert.equal(r.be.callsOf("panic").length, 2);
});

test("冪等キー: output.set_level の古い再送が、その後の設定を上書きしない", () => {
  const r = rig();
  r.ok("human", "output.set_level", { level_db: -30 }, { idempotency_key: "v1" });
  r.ok("human", "output.set_level", { level_db: -40 });
  const again = r.ok("human", "output.set_level", { level_db: -30 }, { idempotency_key: "v1" });
  assert.equal(again.replayed, true);
  assert.equal(r.be.levelDb, -40);
});

test("冪等キー: 保存は直近 1000 件(超えた古いものから捨てる)", () => {
  const r = rig({ limits: { idempotencyKeys: 2 } });
  const set = (v: number, key: string) => r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: v }, { idempotency_key: key });
  set(0.1, "a");
  set(0.2, "b");
  set(0.3, "c");
  assert.equal(set(0.2, "b").replayed, true);
  assert.equal(set(0.1, "a").replayed, false, "捨てられた鍵は新しく適用される");
});

test("競合: expected_revision が一致すれば適用、違えば ERR-008。指定なしは後から来た要求が有効。engine.panic は無視する", () => {
  const r = rig();
  assert.equal(r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 }, { expected_revision: 10 }).revision, 11);
  unchanged(r, () => {
    // 無関係なモジュールへの変更でも競合(リビジョンはパッチ全体で1つ)
    expectError(r.fail("agent", "param.set", { module_id: "env1", param: "attack", value: 0.5 }, { expected_revision: 10 }), "ERR-008");
    expectError(r.fail("agent", "history.undo", undefined, { expected_revision: 10 }), "ERR-008");
  });
  assert.equal(r.ok("human", "param.set", { module_id: "vcf1", param: "res", value: 0.6 }).revision, 12);
  assert.equal(r.ok("agent", "engine.panic", undefined, { expected_revision: 3 }).result.panic, true);
});

// =====================================================================================
// 取り消し・やり直し(§9)
// =====================================================================================

test("取り消し: module.remove を戻すと、同じID・パラメータ・位置のモジュールと同じIDのケーブルが戻る", () => {
  const r = rig();
  const res = r.ok("agent", "module.remove", { module_id: "vcf1" });
  assert.deepEqual(res.result, { removed_module_id: "vcf1", removed_cable_ids: ["c2", "c3"] });
  const removed = patchChanged(r.events)[0]!.data as { changes: unknown[] };
  assert.deepEqual(removed.changes, [
    { kind: "cable_removed", cable_id: "c2" },
    { kind: "cable_removed", cable_id: "c3" },
    { kind: "module_removed", module_id: "vcf1" },
  ]);
  r.be.calls.length = 0;
  r.ok("human", "history.undo");
  const p = r.s.getPatch();
  assert.deepEqual(p.modules.find((m) => m.id === "vcf1"), P0.modules.find((m) => m.id === "vcf1"));
  assert.deepEqual([...p.cables].sort((a, b) => a.id.localeCompare(b.id)), P0.cables);
  // 実際に起きた変更が通知に載り、音声側へも同じ差分が渡る(復活したモジュールは初期状態から)
  const undone = patchChanged(r.events)[1]!.data as { changes: { kind: string }[] };
  assert.deepEqual(undone.changes.map((c) => c.kind), ["module_added", "cable_added", "cable_added"]);
  assert.deepEqual(r.be.calls.map((c) => c[0]), ["addModule", "connect", "connect", "commit"]);
  // やり直しは記録済みの結果を再適用する
  r.ok("agent", "history.redo");
  assert.equal(r.module("vcf1"), undefined);
  assert.equal(r.s.getPatch().cables.length, 4);
});

test("取り消し: 履歴がなければ ERR-141 / ERR-142。新しい変更でやり直し側は消える", () => {
  const r = rig();
  unchanged(r, () => {
    expectError(r.fail("agent", "history.undo"), "ERR-141");
    expectError(r.fail("agent", "history.redo"), "ERR-142");
  });
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 });
  r.ok("agent", "history.undo");
  assert.deepEqual(r.s.history, { can_undo: false, can_redo: true });
  r.ok("human", "param.set", { module_id: "vcf1", param: "res", value: 0.6 });
  assert.deepEqual(r.s.history, { can_undo: true, can_redo: false });
  expectError(r.fail("agent", "history.redo"), "ERR-142");
});

test("取り消し: 読出し・音量・緊急停止は履歴に積まれず、取り消しで音量は戻らない", () => {
  const r = rig();
  r.ok("human", "output.set_level", { level_db: -40 });
  r.ok("agent", "engine.panic");
  r.ok("agent", "patch.get");
  assert.deepEqual(r.s.history, { can_undo: false, can_redo: false });
  assert.equal(r.s.revision, 10);
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 });
  r.ok("agent", "history.undo");
  assert.equal(r.be.levelDb, -40);
  assert.equal(r.be.panicOn, true);
});

test("取り消し: 連続操作のまとめ(coalesce_key)は履歴1件。リビジョンと通知は1回ごと", () => {
  const r = rig();
  const set = (actor: ActorKind, v: number, key?: string, param = "cutoff") =>
    r.ok(actor, "param.set", { module_id: "vcf1", param, value: v, ...(key ? { coalesce_key: key } : {}) });
  set("human", 1.5, "drag1");
  set("human", 2.0, "drag1");
  set("human", 2.5, "drag1");
  assert.equal(r.s.revision, 13);
  assert.equal(patchChanged(r.events).length, 3);
  const u = r.ok("human", "history.undo");
  assert.equal(r.param("vcf1", "cutoff"), 1.0, "戻り先は最初の変更の前の値");
  assert.equal((u.result.history as { can_undo: boolean }).can_undo, false);
  r.ok("human", "history.redo");
  assert.equal(r.param("vcf1", "cutoff"), 2.5);

  // まとめない場合: 鍵が違う、パラメータが違う、操作者が違う、間に他の変更が入る
  const r2 = rig();
  const count = (fn: (s: Rig) => void): number => {
    const x = rig();
    fn(x);
    let n = 0;
    while (x.send("human", "history.undo").ok) n++;
    return n;
  };
  void r2;
  assert.equal(count((x) => { x.ok("human", "param.set", { module_id: "vcf1", param: "cutoff", value: 2, coalesce_key: "a" }); x.ok("human", "param.set", { module_id: "vcf1", param: "cutoff", value: 3, coalesce_key: "b" }); }), 2);
  assert.equal(count((x) => { x.ok("human", "param.set", { module_id: "vcf1", param: "cutoff", value: 2, coalesce_key: "a" }); x.ok("human", "param.set", { module_id: "vcf1", param: "res", value: 0.9, coalesce_key: "a" }); }), 2);
  assert.equal(count((x) => { x.ok("human", "param.set", { module_id: "vcf1", param: "cutoff", value: 2, coalesce_key: "a" }); x.ok("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: 3, coalesce_key: "a" }); }), 2);
  assert.equal(
    count((x) => {
      x.ok("human", "param.set", { module_id: "vcf1", param: "cutoff", value: 2, coalesce_key: "a" });
      x.ok("agent", "param.set", { module_id: "env1", param: "attack", value: 0.5 });
      x.ok("human", "param.set", { module_id: "vcf1", param: "cutoff", value: 3, coalesce_key: "a" });
    }),
    3,
  );
  assert.equal(count((x) => { x.ok("human", "param.set", { module_id: "vcf1", param: "cutoff", value: 2 }); x.ok("human", "param.set", { module_id: "vcf1", param: "cutoff", value: 3 }); }), 2);
});

test("取り消し: patch.new は履歴を消さず1件積む。取り消すと置き換え前のパッチへ戻る(patch_replaced)", () => {
  const r = rig();
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 });
  const res = r.ok("agent", "patch.new");
  assert.equal(res.revision, 12);
  const empty = res.result.patch as Patch;
  assert.deepEqual(empty, {
    format: "modular-synth-patch",
    schema_version: 1,
    meta: { title: "", description: "" },
    modules: [{ id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1.0, mute: 0 } }],
    cables: [],
  });
  assert.deepEqual((patchChanged(r.events)[1]!.data as { changes: unknown[] }).changes, [{ kind: "patch_replaced" }]);
  const u = r.ok("human", "history.undo");
  assert.deepEqual(u.result.undone, { command: "patch.new", actor: { kind: "agent" }, revision: 12 });
  assert.deepEqual((patchChanged(r.events)[2]!.data as { changes: unknown[] }).changes, [{ kind: "patch_replaced" }]);
  assert.equal(r.param("vcf1", "res"), 0.5);
  // 置き換えを取り消すと、置き換わるパッチが持っていた保存時刻なども戻る(DAT-35)
  assert.deepEqual(r.s.getPatch().meta, P0.meta);
  r.ok("human", "history.undo");
  assert.deepEqual(r.s.getPatch(), P0);
  r.ok("human", "history.redo");
  r.ok("human", "history.redo");
  assert.deepEqual(r.s.getPatch(), empty);
  assert.equal(r.s.revision, 16);
});

test("取り消し: 履歴の保持件数を超えた古いものから捨てる", () => {
  const r = rig({ limits: { history: 3 } });
  for (let i = 1; i <= 5; i++) r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: i / 10 });
  let n = 0;
  while (r.send("agent", "history.undo").ok) n++;
  assert.equal(n, 3);
  assert.equal(r.param("vcf1", "res"), 0.2);
});

test("取り消し: module.move と patch.set_meta も戻せる。リビジョンは取り消しでも進む(減らない)", () => {
  const r = rig();
  const mv = r.ok("human", "module.move", { module_id: "vco1", ui: { x: 99, y: 5 } });
  assert.deepEqual(mv.result, { module_id: "vco1", ui: { x: 99, y: 5 }, changed: true });
  const meta = r.ok("agent", "patch.set_meta", { title: "新しい題名" });
  assert.equal((meta.result.meta as { title: string; description: string }).title, "新しい題名");
  assert.equal((meta.result.meta as { description: string }).description, P0.meta.description);
  assert.equal(r.be.calls.filter((c) => c[0] !== "commit").length, 0, "音には影響しない");
  r.ok("human", "history.undo");
  r.ok("human", "history.undo");
  assert.deepEqual(r.s.getPatch(), P0);
  assert.equal(r.s.revision, 14);
  const kinds = patchChanged(r.events).map((e) => (e.data as { changes: { kind: string }[] }).changes.map((c) => c.kind));
  assert.deepEqual(kinds, [["module_moved"], ["meta_changed"], ["meta_changed"], ["module_moved"]]);
});

// =====================================================================================
// seed の自動割当(§14)
// =====================================================================================

test("seed: 16 刻みで、どのモジュールの値も [候補, 候補+15] に入っていない最小の候補", () => {
  const r = rig({ patch: null });
  const add = (type: string, params?: Record<string, number>) =>
    r.ok("agent", "module.add", { type, ...(params ? { params } : {}) });
  const seed = (res: SuccessResponse) => (res.result.module as PatchModule).params.seed;
  assert.equal(seed(add("MOD-NSE-001")), 1);
  assert.equal(seed(add("MOD-NSE-001")), 17);
  // MOD-RND-001 も同じ集まりで数える
  assert.equal(seed(add("MOD-RND-001")), 33);
  // 指定した値はそのまま使う。49〜64 の範囲に入るので、次の候補 49 は使えない
  const explicit = add("MOD-NSE-001", { seed: 60 });
  assert.equal(seed(explicit), 60);
  assert.deepEqual(explicit.warnings, []);
  assert.equal(seed(add("MOD-NSE-001")), 65);
  // 削除で空いた候補は、パッチの状態だけから再び選ばれる
  r.ok("agent", "module.remove", { module_id: "m2" });
  assert.equal(seed(add("MOD-RND-001")), 17);
});

test("seed: 指定した値が他と同じ・差が16未満なら成功させて duplicate_seed を警告する(module.add と param.set)", () => {
  const r = rig({ patch: null });
  r.ok("agent", "module.add", { type: "MOD-NSE-001", id: "n1" });
  const dup = r.ok("agent", "module.add", { type: "MOD-NSE-001", id: "n2", params: { seed: 1 } });
  assert.equal((dup.result.module as PatchModule).params.seed, 1);
  assert.equal(dup.warnings.length, 1);
  assert.equal(dup.warnings[0]!.code, "duplicate_seed");
  const near = r.ok("agent", "param.set", { module_id: "n2", param: "seed", value: 16 });
  assert.equal(near.warnings[0]!.code, "duplicate_seed");
  const far = r.ok("agent", "param.set", { module_id: "n2", param: "seed", value: 17 });
  assert.deepEqual(far.warnings, []);
  // seed は整数型: 非整数は ERR-122、範囲外は ERR-123
  expectError(r.fail("agent", "param.set", { module_id: "n2", param: "seed", value: 1.5 }), "ERR-122");
  expectError(r.fail("agent", "param.set", { module_id: "n2", param: "seed", value: -1 }), "ERR-123");
});

test("seed: やり直しは自動割当した seed と採番したIDを計算し直さない", () => {
  const r = rig({ patch: null });
  r.ok("agent", "module.add", { type: "MOD-NSE-001" }); // m1, seed 1
  r.ok("agent", "module.add", { type: "MOD-NSE-001" }); // m2, seed 17
  r.ok("agent", "history.undo");
  r.ok("agent", "module.remove", { module_id: "m1" });
  r.ok("agent", "history.undo");
  r.ok("agent", "history.undo"); // m1 の追加まで戻す
  r.ok("agent", "history.redo");
  assert.deepEqual(r.s.getPatch().modules.map((m) => [m.id, m.params.seed]), [["out", undefined], ["m1", 1]]);
});

// =====================================================================================
// ID の自動採番(§2.2)
// =====================================================================================

test("自動採番: m<N>・c<N> は 1 から。削除・取り消し・patch.new でも戻らない", () => {
  const r = rig({ patch: null });
  const addId = () => (r.ok("agent", "module.add", { type: "MOD-UTL-001" }).result.module as PatchModule).id;
  const connectId = (from: string, to: string) =>
    (r.ok("agent", "cable.connect", { from: { module: from, port: "out" }, to: { module: to, port: "in" } }).result.cable as { id: string }).id;
  assert.equal(addId(), "m1");
  assert.equal(addId(), "m2");
  assert.equal(connectId("m1", "m2"), "c1");
  // 削除しても再利用しない
  r.ok("agent", "module.remove", { module_id: "m2" });
  assert.equal(addId(), "m3");
  assert.equal(connectId("m1", "m3"), "c2");
  // 取り消しても戻さない
  r.ok("agent", "history.undo");
  r.ok("agent", "history.undo");
  assert.equal(addId(), "m4");
  assert.equal(connectId("m1", "m4"), "c3");
  // patch.new の直後に 1 へ戻らない
  r.ok("agent", "patch.new");
  assert.equal(addId(), "m5");
});

test("自動採番: 起動時は復元したパッチ内の最大値+1。id 指定の m<N> は次番号を N+1 以上にする", () => {
  const r = rig(); // P0: m<N> 形式はなし、ケーブルは c1〜c6
  assert.equal((r.ok("agent", "module.add", { type: "MOD-UTL-001" }).result.module as PatchModule).id, "m1");
  const cable = r.ok("agent", "cable.connect", { from: { module: "m1", port: "out" }, to: { module: "vcf1", port: "cv2" } });
  assert.equal((cable.result.cable as { id: string }).id, "c7");
  r.ok("human", "module.add", { type: "MOD-UTL-001", id: "m7" });
  assert.equal((r.ok("agent", "module.add", { type: "MOD-UTL-001" }).result.module as PatchModule).id, "m8");
  r.ok("human", "cable.connect", { from: { module: "m7", port: "out" }, to: { module: "vcf1", port: "cv3" }, id: "c20" });
  const next = r.ok("agent", "cable.connect", { from: { module: "m8", port: "out" }, to: { module: "vcf1", port: "res_cv" } });
  assert.equal((next.result.cable as { id: string }).id, "c21");
  // m<N> 形式でないIDは次番号に影響しない
  r.ok("human", "module.add", { type: "MOD-UTL-001", id: "mix99" });
  assert.equal((r.ok("agent", "module.add", { type: "MOD-UTL-001" }).result.module as PatchModule).id, "m9");
});

test("自動採番: 指定したIDの重複は ERR-103 / ERR-116", () => {
  const r = rig();
  unchanged(r, () => {
    const m = r.fail("agent", "module.add", { type: "MOD-LFO-001", id: "vco1" });
    expectError(m, "ERR-103");
    assert.equal(m.error.details.module_id, "vco1");
    const c = r.fail("agent", "cable.connect", { from: { module: "vco1", port: "tri" }, to: { module: "vcf1", port: "cv2" }, id: "c1" });
    expectError(c, "ERR-116");
    assert.equal(c.error.details.cable_id, "c1");
  });
});

// =====================================================================================
// モジュール・接続・パラメータの規則(§12、§13)
// =====================================================================================

test("module.add: 全パラメータを返す。未知の種別 ERR-101、出力の追加 ERR-105、未知のパラメータ ERR-121、値は §12", () => {
  const r = rig();
  const res = r.ok("agent", "module.add", { type: "MOD-FLT-001", params: { cutoff: -2 }, ui: { x: 5, y: 6 } });
  const defaults = Object.fromEntries(CATALOG.get("MOD-FLT-001")!.params.map((p) => [p.name, p.default]));
  assert.deepEqual(res.result.module, {
    id: "m1",
    type: "MOD-FLT-001",
    spec_version: CATALOG.get("MOD-FLT-001")!.specVersion,
    params: { ...defaults, cutoff: -2 },
    ui: { x: 5, y: 6 },
  });
  assert.deepEqual(r.ok("agent", "module.get", { module_id: "m1" }).result, { module: res.result.module, cables: [] });
  unchanged(r, () => {
    const t = r.fail("agent", "module.add", { type: "MOD-XYZ-999" });
    expectError(t, "ERR-101");
    assert.equal(t.error.details.type, "MOD-XYZ-999");
    expectError(r.fail("agent", "module.add", { type: "MOD-IO-001" }), "ERR-105");
    expectError(r.fail("agent", "module.add", { type: "MOD-IO-001", id: "out2" }), "ERR-105");
    expectError(r.fail("agent", "module.add", { type: "MOD-FLT-001", params: { resonance: 1 } }), "ERR-121");
    expectError(r.fail("agent", "module.add", { type: "MOD-FLT-001", params: { cutoff: 7.5 } }), "ERR-123");
    expectError(r.fail("agent", "module.add", { type: "MOD-FLT-001", params: { cutoff: "1" } }), "ERR-122");
    expectError(r.fail("agent", "module.add", { type: "MOD-OSC-001", params: { range: 0.5 } }), "ERR-122");
    expectError(r.fail("agent", "module.get", { module_id: "nope" }), "ERR-102");
  });
});

test("module.get: モジュールと、つながるケーブルを返す", () => {
  const r = rig();
  const res = r.ok("agent", "module.get", { module_id: "vcf1" });
  assert.deepEqual(res.result.module, P0.modules.find((m) => m.id === "vcf1"));
  assert.deepEqual((res.result.cables as { id: string }[]).map((c) => c.id), ["c2", "c3"]);
});

test("param.set: 範囲の端は受理、範囲外・非数値は拒否。パッチの値は常に範囲内の有限値", () => {
  const r = rig();
  const res = r.ok("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: 6 });
  assert.deepEqual(res.result, { module_id: "vcf1", param: "cutoff", value: 6, previous: 1.0, changed: true });
  r.ok("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: -5 });
  unchanged(r, () => {
    for (const v of [true, [1], { a: 1 }, "1", null]) {
      expectError(r.fail("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: v }), "ERR-122");
    }
    expectError(r.fail("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: -5.0001 }), "ERR-123");
    expectError(r.fail("agent", "param.set", { module_id: "vco1", param: "range", value: 3 }), "ERR-123");
  });
  // out のパラメータ変更は通常どおりできる(§13.8)
  assert.equal(r.ok("agent", "param.set", { module_id: "out", param: "level", value: 0.5 }).result.changed, true);
});

test("接続規則: 1入力1本、分岐可、重複は same_source:true、フィードバック可、型が同じなら警告なし", () => {
  const r = rig();
  // 1つの出力からは何本でも
  const a = r.ok("agent", "cable.connect", { from: { module: "vco1", port: "saw" }, to: { module: "vca1", port: "in2" } });
  assert.deepEqual(a.warnings, [], "audio → audio は警告なし");
  // 同じ接続の重複
  const dup = r.fail("agent", "cable.connect", { from: { module: "vco1", port: "saw" }, to: { module: "vcf1", port: "in" } });
  expectError(dup, "ERR-114");
  assert.deepEqual(dup.error.details, { existing_cable_id: "c2", same_source: true });
  // 複数モジュールを回るループ: vca1.out → vcf1.cv3(audio → cv は警告つきで成功)
  const loop = r.ok("agent", "cable.connect", { from: { module: "vca1", port: "out" }, to: { module: "vcf1", port: "cv3" } });
  assert.equal(loop.warnings[0]!.code, "type_mismatch");
  // 自動の置き換えはしない: 外してからつなぐ
  r.ok("agent", "cable.disconnect", { to: { module: "vcf1", port: "in" } });
  r.ok("agent", "cable.connect", { from: { module: "vco1", port: "pulse" }, to: { module: "vcf1", port: "in" } });
});

test("接続規則: 接続できないポート(PRE_L/PRE_R/DEV_L/DEV_R、MIDI)は ERR-113。out への接続・切断はできる", () => {
  const r = rig();
  unchanged(r, () => {
    for (const port of ["PRE_L", "PRE_R", "DEV_L", "DEV_R"]) {
      const res = r.fail("agent", "cable.connect", { from: { module: "out", port }, to: { module: "vcf1", port: "cv2" } });
      expectError(res, "ERR-113");
      assert.deepEqual(res.error.details, { module_id: "out", port });
    }
    expectError(r.fail("agent", "cable.connect", { from: { module: "vco1", port: "saw" }, to: { module: "midi1", port: "MIDI" } }), "ERR-113");
    // 向きの違い: to が出力
    const dir = r.fail("agent", "cable.connect", { from: { module: "vco1", port: "saw" }, to: { module: "vcf1", port: "out" } });
    expectError(dir, "ERR-112");
    // 存在しないモジュール
    expectError(r.fail("agent", "cable.connect", { from: { module: "nope", port: "saw" }, to: { module: "vcf1", port: "cv2" } }), "ERR-102");
  });
  r.ok("agent", "cable.connect", { from: { module: "vca1", port: "out" }, to: { module: "out", port: "IN_R" } });
  const gone = r.ok("agent", "cable.disconnect", { to: { module: "out", port: "IN_L" } });
  assert.deepEqual(gone.result.removed_cable, P0.cables[5]);
  // CLIP は接続できる出力
  r.ok("agent", "cable.connect", { from: { module: "out", port: "CLIP" }, to: { module: "vcf1", port: "cv2" } });
});

test("cable.disconnect: cable_id でも to でも外せる。to にケーブルがなければ ERR-115、ポートがなければ ERR-111", () => {
  const r = rig();
  assert.deepEqual(r.ok("agent", "cable.disconnect", { cable_id: "c4" }).result.removed_cable, P0.cables[3]);
  unchanged(r, () => {
    const none = r.fail("agent", "cable.disconnect", { to: { module: "env1", port: "gate" } });
    expectError(none, "ERR-115");
    assert.deepEqual(none.error.details.to, { module: "env1", port: "gate" });
    expectError(r.fail("agent", "cable.disconnect", { to: { module: "env1", port: "nope" } }), "ERR-111");
    expectError(r.fail("agent", "cable.disconnect", { to: { module: "nope", port: "gate" } }), "ERR-102");
  });
  r.ok("agent", "history.undo");
  assert.deepEqual(r.s.getPatch().cables.find((c) => c.id === "c4"), P0.cables[3], "取り消しは同じIDで接続し直す");
});

test("上限: モジュール数・ケーブル数を超える操作は ERR-106", () => {
  const r = rig({ limits: { modules: 7, cables: 7 } });
  r.ok("agent", "module.add", { type: "MOD-UTL-001" });
  unchanged(r, () => {
    const res = r.fail("agent", "module.add", { type: "MOD-UTL-001" });
    expectError(res, "ERR-106");
    assert.equal(res.error.details.max, 7);
  });
  r.ok("agent", "cable.connect", { from: { module: "m1", port: "out" }, to: { module: "vcf1", port: "cv2" } });
  unchanged(r, () => {
    expectError(r.fail("agent", "cable.connect", { from: { module: "m1", port: "out" }, to: { module: "vcf1", port: "cv3" } }), "ERR-106");
  });
});

test("上限: 既定はモジュール 256、ケーブル 1024、batch 500", () => {
  const r = rig({ patch: null });
  const ops = (n: number) => Array.from({ length: n }, () => ({ command: "module.add", args: { type: "MOD-UTL-001" } }));
  // out を含めて 256 まで
  r.ok("agent", "batch", { ops: ops(255) });
  assert.equal(r.s.getPatch().modules.length, 256);
  const over = r.fail("agent", "module.add", { type: "MOD-UTL-001" });
  expectError(over, "ERR-106");
  assert.equal(over.error.details.max, 256);
});

// =====================================================================================
// 権限(§15)、音量(CMD-25、§2.4)、音声状態
// =====================================================================================

test("権限: 人のみのコマンドはエージェントに ERR-005。人はすべて行える", () => {
  const r = rig({ audioState: "stopped" });
  for (const command of ["engine.start", "engine.release_panic", "patch.delete"]) {
    const res = r.fail("agent", command, command === "patch.delete" ? { name: "x" } : undefined);
    expectError(res, "ERR-005");
    assert.deepEqual(res.error.details, { command, actor_kind: "agent" });
  }
  const st = r.ok("human", "engine.start");
  assert.deepEqual(st.result, { audio_state: "running", fs: 48000 });
  assert.equal(st.audio_state, "running");
  r.ok("agent", "engine.panic");
  assert.equal(r.ok("human", "engine.release_panic").result.panic, false);
  assert.equal(r.be.panicOn, false);
});

test("output.set_level: 検査順は ERR-003 → ERR-123 → ERR-302。クランプしない", () => {
  const r = rig();
  unchanged(r, () => {
    for (const v of ["-10", null, true, [], {}, "NaN"]) {
      const res = r.fail("agent", "output.set_level", { level_db: v });
      expectError(res, "ERR-003");
    }
    expectError(r.fail("agent", "output.set_level", {}), "ERR-003");
    for (const v of [0.1, -60.5, 6]) {
      const res = r.fail("agent", "output.set_level", { level_db: v });
      expectError(res, "ERR-123");
      assert.deepEqual(res.error.details, { arg: "level_db", value: v, min: -60, max: 0 });
    }
    // 人でも範囲外は拒否
    expectError(r.fail("human", "output.set_level", { level_db: 3 }), "ERR-123");
    const over = r.fail("agent", "output.set_level", { level_db: -19.9 });
    expectError(over, "ERR-302");
    assert.deepEqual(over.error.details, { level_db: -19.9, max_db: -20 });
  });
  assert.equal(r.be.levelDb, -20);
});

test("output.set_level: 人の設定が上限になる。エージェントは上限内だけ設定でき、上限を変えられない(DEC-010)", () => {
  const r = rig();
  const h = r.ok("human", "output.set_level", { level_db: -6 });
  assert.deepEqual(h.result, { level_db: -6, agent_max_level_db: -6, changed: true });
  assert.equal(h.revision, 10, "リビジョンの対象外");
  const a = r.ok("agent", "output.set_level", { level_db: -12 });
  assert.deepEqual(a.result, { level_db: -12, agent_max_level_db: -6, changed: true });
  // 上限ちょうどは可、超えると拒否
  r.ok("agent", "output.set_level", { level_db: -6 });
  expectError(r.fail("agent", "output.set_level", { level_db: -5 }), "ERR-302");
  // 人が下げると上限も下がる
  r.ok("human", "output.set_level", { level_db: -30 });
  expectError(r.fail("agent", "output.set_level", { level_db: -12 }), "ERR-302");
  const evs = outputChanged(r.events).map((e) => e.data as { level_db: number; agent_max_level_db: number; actor: { kind: string }; reason: string });
  assert.deepEqual(
    evs.map((e) => [e.level_db, e.agent_max_level_db, e.actor.kind, e.reason]),
    [
      [-6, -6, "human", "set_level"],
      [-12, -6, "agent", "set_level"],
      [-6, -6, "agent", "set_level"],
      [-30, -30, "human", "set_level"],
    ],
  );
  assert.deepEqual(r.s.history, { can_undo: false, can_redo: false });
});

test("output.set_level: 現在と同じ値なら changed:false で通知なし(人の設定による上限の更新は行う)", () => {
  const r = rig();
  r.ok("human", "output.set_level", { level_db: -10 });
  r.ok("agent", "output.set_level", { level_db: -25 });
  r.events.length = 0;
  const same = r.ok("human", "output.set_level", { level_db: -25 });
  assert.deepEqual(same.result, { level_db: -25, agent_max_level_db: -25, changed: false });
  assert.equal(r.events.length, 0);
  // 緊急停止中も値は設定できる
  r.ok("agent", "engine.panic");
  assert.equal(r.ok("agent", "output.set_level", { level_db: -40 }).result.changed, true);
  assert.equal(r.be.panicOn, true);
});

test("§2.4: patch.new は音量を min(現在値, 既定値) に引き下げ、上限は変えない。変わったときだけ EVT-03(reset_to_default)", () => {
  const r = rig();
  const D = r.be.defaultLevelDb;
  r.ok("human", "output.set_level", { level_db: D + 10 });
  r.events.length = 0;
  r.ok("agent", "patch.new");
  assert.equal(r.be.levelDb, D);
  assert.equal(r.be.agentMaxLevelDb, D + 10, "上限は不変(DEC-111)");
  assert.deepEqual(r.events.map((e) => e.event), ["patch.changed", "output.changed"]);
  assert.deepEqual(r.events[1]!.data, { level_db: D, agent_max_level_db: D + 10, panic: false, actor: { kind: "agent" }, reason: "reset_to_default" });
  // 置き換えを伴わない取り消しでは音量を変えない
  r.ok("human", "output.set_level", { level_db: D + 5 });
  r.ok("agent", "param.set", { module_id: "out", param: "level", value: 0.5 });
  r.ok("agent", "history.undo");
  assert.equal(r.be.levelDb, D + 5);
  // 置き換えの取り消しでは引き下げる(取り消しで音量が上がることはない)
  r.events.length = 0;
  r.ok("agent", "history.undo");
  assert.equal(r.be.levelDb, D);
  assert.equal(outputChanged(r.events).length, 1);
});

test("engine.start: stopped から人が開始すると、現在のパッチを渡して開始し、EVT-02 を出す。running なら何もしない", () => {
  const r = rig({ audioState: "stopped" });
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 });
  assert.equal(r.be.calls.length, 0, "stopped の間は差分を渡さない(開始時にまとめて構築)");
  const status = r.ok("agent", "engine.get_status").result as { fs: unknown; engine_revision: unknown; audio_state: string };
  assert.deepEqual([status.audio_state, status.fs, status.engine_revision], ["stopped", null, null]);
  const res = r.ok("human", "engine.start");
  assert.equal(res.revision, 11, "リビジョンは進まない");
  assert.deepEqual(r.be.calls.map((c) => c[0]), ["applyPatch", "start"]);
  assert.deepEqual(r.be.calls[0]![1], r.s.getPatch());
  assert.deepEqual(r.events.at(-1), {
    v: 1,
    event: "engine.state_changed",
    session_id: "s-test",
    data: { audio_state: "running", fs: 48000, midi: { available: false } },
  });
  assert.equal((r.ok("agent", "engine.get_status").result as { engine_revision: number }).engine_revision, 11);
  // 既に running なら何もせず成功(音量も変えない)
  r.ok("human", "output.set_level", { level_db: -5 });
  const n = r.be.calls.length;
  const ev = r.events.length;
  assert.deepEqual(r.ok("human", "engine.start").result, { audio_state: "running", fs: 48000 });
  assert.equal(r.be.calls.length, n);
  assert.equal(r.events.length, ev);
  assert.equal(r.be.levelDb, -5);
});

test("engine.start: 開始できなければ ERR-304。suspended からの再開はパッチを作り直さない", () => {
  const r = rig({ audioState: "stopped" });
  r.be.startFailure = "NotAllowedError";
  const res = r.fail("human", "engine.start");
  expectError(res, "ERR-304");
  assert.equal(res.error.details.reason, "NotAllowedError");
  assert.equal(res.audio_state, "stopped");

  const s = rig({ audioState: "suspended" });
  // suspended: 編集は成功し、差分は音声側へ渡る(ためるのは音声側)
  s.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 });
  assert.deepEqual(s.be.calls.map((c) => c[0]), ["setParam", "commit"]);
  expectError(s.fail("agent", "meter.read", { module_id: "vcf1" }), "ERR-303");
  s.be.calls.length = 0;
  s.ok("human", "engine.start");
  assert.deepEqual(s.be.calls.map((c) => c[0]), ["start"]);
});

test("engine.panic / release_panic: 何度呼んでも成功。通知は状態が変わったときだけ。パッチ・リビジョン・履歴は不変", () => {
  const r = rig();
  r.ok("human", "output.set_level", { level_db: -5 });
  r.events.length = 0;
  assert.equal(r.ok("agent", "engine.panic").result.panic, true);
  assert.equal(r.ok("human", "engine.panic").result.panic, true);
  assert.equal(r.be.callsOf("panic").length, 2);
  assert.deepEqual(r.events.map((e) => (e.data as { reason: string }).reason), ["panic"]);
  assert.equal(r.s.revision, 10);
  assert.deepEqual(r.s.getPatch(), P0);
  // 緊急停止中もパッチ編集はできる
  assert.equal(r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 }).revision, 11);
  // 解除: 音量は引き下げ後の値で通知される
  r.events.length = 0;
  assert.equal(r.ok("human", "engine.release_panic").result.panic, false);
  assert.deepEqual(r.events.map((e) => e.data), [
    { level_db: -20, agent_max_level_db: -5, panic: false, actor: { kind: "human" }, reason: "release_panic" },
  ]);
  // 緊急停止中でなければ何もせず成功
  r.events.length = 0;
  const calls = r.be.calls.length;
  assert.equal(r.ok("human", "engine.release_panic").result.panic, false);
  assert.equal(r.events.length, 0);
  assert.equal(r.be.calls.length, calls);
  // stopped 中でも panic は受け付ける
  const s = rig({ audioState: "stopped" });
  assert.equal(s.ok("agent", "engine.panic").result.panic, true);
  assert.equal((s.ok("agent", "engine.get_status").result as { panic: boolean }).panic, true);
});

test("engine.get_status: 契約の形で返す(音声状態・音量は音声側から読む)", () => {
  const r = rig();
  r.be.sampleTime = 4800;
  r.be.clipCount = 3;
  r.be.nonfiniteModules = 2;
  r.be.nonfiniteOutputStage = 1;
  r.be.midiAvailable = true;
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 });
  assert.deepEqual(r.ok("agent", "engine.get_status").result, {
    audio_state: "running",
    panic: false,
    fs: 48000,
    engine_revision: 11,
    sample_time: 4800,
    output: {
      level_db: -20,
      agent_max_level_db: -20,
      clip_count: 3,
      nonfinite_count: 3,
      nonfinite_detail: { modules: 2, output_stage: 1 },
    },
    midi: { available: true },
    history: { can_undo: true, can_redo: false },
  });
  expectError(r.fail("agent", "engine.get_status", { x: 1 }), "ERR-003");
});

test("meter.read: 既定は frame 以外の全項目。frame は明示したときだけ。未知の項目 ERR-003、メーター以外 ERR-303", () => {
  const r = rig();
  r.ok("agent", "module.add", { type: "MOD-IO-003", id: "scope1" });
  r.be.meterValues.rms = 1.25;
  r.be.meterValues.frame = [0, 1, 2];
  r.be.sampleTime = 960;
  const res = r.ok("agent", "meter.read", { module_id: "scope1" });
  assert.deepEqual(Object.keys(res.result.values as object), [
    "level",
    "peak",
    "rms",
    "mean",
    "vmin",
    "vmax",
    "windows",
    "peak_hold",
    "nonfinite_count",
    "frame_seq",
  ]);
  assert.equal((res.result.values as { rms: number }).rms, 1.25);
  assert.equal(res.result.sample_time, 960);
  assert.equal(res.result.fs, 48000);
  assert.equal(res.result.engine_revision, 11);
  assert.equal(res.revision, 11, "読出しはリビジョンを進めない");
  const frame = r.ok("agent", "meter.read", { module_id: "scope1", fields: ["frame", "frame_seq"] });
  assert.deepEqual(frame.result.values, { frame: [0, 1, 2], frame_seq: 0 });
  unchanged(r, () => {
    expectError(r.fail("agent", "meter.read", { module_id: "scope1", fields: ["loudness"] }), "ERR-003");
    expectError(r.fail("agent", "meter.read", { module_id: "scope1", channel: 2 }), "ERR-003");
    expectError(r.fail("agent", "meter.read", { module_id: "nope" }), "ERR-102");
    const notMeter = r.fail("agent", "meter.read", { module_id: "vcf1" });
    expectError(notMeter, "ERR-303");
    assert.deepEqual(notMeter.error.details, { module_id: "vcf1", type: "MOD-FLT-001" });
  });
});

test("module.list_types: 19種を返す。type 指定で1種、未知なら ERR-101。セッションの状態は変えない", () => {
  const r = rig();
  unchanged(r, () => {
    const all = r.ok("agent", "module.list_types").result.types as { type: string; singleton: boolean }[];
    assert.equal(all.length, 19);
    assert.deepEqual(all.filter((t) => t.singleton).map((t) => t.type), ["MOD-IO-001"]);
    const one = r.ok("agent", "module.list_types", { type: "MOD-IO-001" }).result.types as {
      type: string;
      spec_version: string;
      ports: { name: string; direction: string; signal_type: string; connectable: boolean }[];
      params: { name: string; min: number; max: number; default: number }[];
    }[];
    assert.equal(one.length, 1);
    assert.equal(one[0]!.spec_version, "0.2");
    const port = (name: string) => one[0]!.ports.find((p) => p.name === name)!;
    assert.deepEqual([port("IN_L").direction, port("IN_L").signal_type, port("IN_L").connectable], ["in", "audio", true]);
    assert.deepEqual([port("PRE_L").direction, port("PRE_L").connectable], ["out", false]);
    assert.deepEqual(one[0]!.params.map((p) => p.name), ["level", "mute"]);
    const meter = r.ok("agent", "module.list_types", { type: "MOD-IO-003" }).result.types as { readouts: string[] }[];
    assert.ok(meter[0]!.readouts.includes("frame_seq"));
    expectError(r.fail("agent", "module.list_types", { type: "MOD-XYZ-999" }), "ERR-101");
  });
});

// =====================================================================================
// 音声側への差分、想定外の失敗、未対応のコマンド
// =====================================================================================

test("音声側: running では適用したコマンドを差分として渡し、1コマンドにつき commit を1回呼ぶ", () => {
  const r = rig();
  r.ok("agent", "module.add", { type: "MOD-LFO-001", id: "lfo1" });
  r.ok("agent", "cable.connect", { from: { module: "lfo1", port: "sine" }, to: { module: "vcf1", port: "cv3" }, id: "x1" });
  r.ok("agent", "param.set", { module_id: "lfo1", param: "freq", value: 0.5 });
  r.ok("agent", "cable.disconnect", { cable_id: "x1" });
  r.ok("agent", "module.remove", { module_id: "lfo1" });
  r.ok("agent", "param.set", { module_id: "vcf1", param: "cutoff", value: 1.0 }); // 無変更
  const cable = { id: "x1", from: { module: "lfo1", port: "sine" }, to: { module: "vcf1", port: "cv3" } };
  assert.deepEqual(
    r.be.calls.map((c) => (c[0] === "addModule" ? ["addModule", (c[1] as PatchModule).id] : c)),
    [
      ["addModule", "lfo1"],
      ["commit", 11],
      ["connect", cable],
      ["commit", 12],
      ["setParam", "lfo1", "freq", 0.5],
      ["commit", 13],
      ["disconnect", cable],
      ["commit", 14],
      ["removeModule", "lfo1"],
      ["commit", 15],
    ],
  );
});

test("想定外の失敗: 音声側が例外を投げたら ERR-010 を返し、状態を適用前へ戻す", () => {
  const r = rig();
  r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.5 });
  const patch = r.s.getPatch();
  const history = r.s.history;
  r.events.length = 0;
  r.be.throwOn = "setParam";
  const res = r.fail("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.9 }, { idempotency_key: "z" });
  expectError(res, "ERR-010");
  assert.equal(res.revision, 11);
  assert.deepEqual(r.s.getPatch(), patch);
  assert.deepEqual(r.s.history, history);
  assert.equal(r.events.length, 0, "通知なし");
  // 音声側は現在のパッチで合わせ直される
  assert.deepEqual(r.be.calls.at(-1)!.slice(0, 2), ["applyPatch", patch]);
  // 失敗は保存されないので、同じ鍵で再送できる
  r.be.throwOn = null;
  const again = r.ok("agent", "param.set", { module_id: "vcf1", param: "res", value: 0.9 }, { idempotency_key: "z" });
  assert.equal(again.replayed, false);
  assert.equal(again.revision, 12);
});

test("未対応: patch.save / load / list / read / delete は ERR-207(reason: not_implemented)で、状態を変えない", () => {
  const r = rig();
  unchanged(r, () => {
    const cases: [ActorKind, string, Record<string, unknown> | undefined][] = [
      ["agent", "patch.save", { name: "bass-01" }],
      ["agent", "patch.load", { name: "bass-01" }],
      ["agent", "patch.load", { patch: { format: "modular-synth-patch" } }],
      ["agent", "patch.list", undefined],
      ["agent", "patch.read", { name: "bass-01" }],
      ["human", "patch.delete", { name: "bass-01" }],
    ];
    for (const [actor, command, args] of cases) {
      const res = r.fail(actor, command, args);
      expectError(res, "ERR-207");
      assert.equal(res.error.details.reason, "not_implemented");
    }
    // 引数の形と名前の書式までは検査する
    expectError(r.fail("agent", "patch.load", {}), "ERR-003");
    expectError(r.fail("agent", "patch.load", { name: "a", patch: {} }), "ERR-003");
    for (const name of ["../etc/x", "A", "", "a/b", "con", "lpt1", "x".repeat(65), ".hidden"]) {
      expectError(r.fail("agent", "patch.save", { name }), "ERR-201");
    }
    expectError(r.fail("agent", "patch.read", { name: "a b" }), "ERR-201");
  });
});

test("pollBackend: アプリ起因の変化(自動復帰、診断計数)を通知する。actor は null", () => {
  const r = rig({ audioState: "suspended" });
  r.s.pollBackend();
  assert.equal(r.events.length, 0, "変化がなければ出さない");
  // ブラウザ・OSによる自動復帰(音量は音声側が引き下げ済み)
  r.be.levelDb = -5;
  r.s.pollBackend();
  r.events.length = 0;
  r.be.audioState = "running";
  r.be.levelDb = -20;
  r.s.pollBackend();
  assert.deepEqual(r.events.map((e) => e.event), ["engine.state_changed", "output.changed"]);
  assert.deepEqual(r.events[1]!.data, { level_db: -20, agent_max_level_db: -20, panic: false, actor: null, reason: "reset_to_default" });
  r.events.length = 0;
  r.be.nonfiniteModules = 4;
  r.be.clipCount = 1;
  r.s.pollBackend();
  assert.deepEqual(r.events, [
    {
      v: 1,
      event: "engine.diagnostic",
      session_id: "s-test",
      data: { nonfinite_count: 4, nonfinite_detail: { modules: 4, output_stage: 0 }, clip_count: 1 },
    },
  ]);
  r.events.length = 0;
  r.s.pollBackend();
  assert.equal(r.events.length, 0);
});

test("起動: 自動保存がなければ空のパッチで revision 0。running で生成したら音声側へ現在のパッチを渡す", () => {
  const be = new RecordingBackend({ audioState: "running" });
  const s = new Session({ catalog: CATALOG, backend: be, sessionId: "s-new" });
  assert.equal(s.revision, 0);
  assert.deepEqual(s.getPatch(), {
    format: "modular-synth-patch",
    schema_version: 1,
    meta: { title: "", description: "" },
    modules: [{ id: "out", type: "MOD-IO-001", spec_version: "0.2", params: { level: 1.0, mute: 0 } }],
    cables: [],
  });
  assert.deepEqual(be.calls, [["applyPatch", s.getPatch(), 0]]);
  const stopped = new RecordingBackend();
  new Session({ catalog: CATALOG, backend: stopped, sessionId: "s-new2" });
  assert.equal(stopped.calls.length, 0);
});

test("応答の形: 成功と失敗の封筒(§3.2)。応答・通知を書き換えても正本は変わらない", () => {
  const r = rig();
  const ok = r.s.handle(
    { v: 1, request_id: "r-0001", command: "param.set", args: { module_id: "vcf1", param: "cutoff", value: 2.0 }, expected_revision: 10, client_id: "agent-a" },
    "agent",
  );
  assert.deepEqual(ok, {
    v: 1,
    request_id: "r-0001",
    ok: true,
    command: "param.set",
    revision: 11,
    session_id: "s-test",
    actor: { kind: "agent", client_id: "agent-a" },
    audio_state: "running",
    replayed: false,
    warnings: [],
    result: { module_id: "vcf1", param: "cutoff", value: 2.0, previous: 1.0, changed: true },
  });
  const ng = r.s.handle(
    { v: 1, request_id: "r-0002", command: "param.set", args: { module_id: "vcf1", param: "cutoff", value: 7.5 }, client_id: "agent-a" },
    "agent",
  ) as FailureResponse;
  assert.deepEqual(
    { ...ng, error: { ...ng.error, message: "" } },
    {
      v: 1,
      request_id: "r-0002",
      ok: false,
      command: "param.set",
      revision: 11,
      session_id: "s-test",
      actor: { kind: "agent", client_id: "agent-a" },
      audio_state: "running",
      replayed: false,
      error: { id: "ERR-123", code: "param_out_of_range", message: "", details: { module_id: "vcf1", param: "cutoff", value: 7.5, min: -5, max: 6 } },
    },
  );
  // 返したパッチを書き換えても、Session の正本は変わらない
  const got = r.ok("agent", "patch.get").result.patch as Patch;
  got.modules[0]!.params.level = 99;
  got.cables.length = 0;
  assert.equal(r.param("out", "level"), 1.0);
  assert.equal(r.s.getPatch().cables.length, 6);
});
