// タブ側の本体。パッチの正本(Session)はここにあり、人の操作もエージェントの操作も同じコマンドで処理する(DEC-105)。
// 音声は「音声開始」を押したときにだけ始める(product-spec §3.3)。
import type { FromWorklet } from "../audio/messages.js";
import { WorkletBackend } from "../audio/worklet-backend.js";
import { buildCatalog } from "../control/catalog.js";
import { Controller } from "../control/controller.js";
import { parsePatchText, serializePatchDocument } from "../control/patch-doc.js";
import type { PatchDocument } from "../control/patch-doc.js";
import { Session } from "../control/session.js";
import type { PatchStore, StoreResult, StoredPatchInfo } from "../control/store.js";
import type { CommandResponse, Patch } from "../control/types.js";
import { REGISTRY } from "../modules/registry.js";
import type { ServerToTab, TabToServer } from "../server/protocol.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const AUTOSAVE_KEY = "modular-synth.autosave.v1";
const AUTOSAVE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------------------
// サーバーとの接続(エージェントの要求の中継、パッチファイルの保存先)
// ---------------------------------------------------------------------------------------

class ServerLink implements PatchStore {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private waiting = new Map<number, (r: StoreResult<unknown>) => void>();
  accepted = false;
  rejectedReason: string | null = null;
  onRequest: ((id: number, request: unknown) => void) | null = null;
  onChange: (() => void) | null = null;

  connect(token: string): void {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/tab?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerToTab;
      if (m.t === "hello") {
        this.accepted = m.accepted;
        this.rejectedReason = m.accepted ? null : (m.reason ?? "rejected");
        this.onChange?.();
      } else if (m.t === "req") {
        this.onRequest?.(m.id, m.request);
      } else if (m.t === "store_res") {
        const w = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        w?.(m.ok ? { ok: true, value: m.value } : { ok: false, error: m.error, ...(m.message ? { message: m.message } : {}) });
      }
    };
    ws.onclose = () => {
      this.accepted = false;
      this.ws = null;
      for (const w of this.waiting.values()) w({ ok: false, error: "failed", message: "サーバーとの接続が切れた" });
      this.waiting.clear();
      this.onChange?.();
    };
  }

  send(msg: TabToServer): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private call<T>(make: (id: number) => TabToServer): Promise<StoreResult<T>> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.waiting.set(id, resolve as (r: StoreResult<unknown>) => void);
      if (!this.send(make(id))) {
        this.waiting.delete(id);
        resolve({ ok: false, error: "failed", message: "サーバーに接続していない" });
      }
    });
  }

  list(): Promise<StoreResult<StoredPatchInfo[]>> {
    return this.call((id) => ({ t: "store", id, op: "list" }));
  }
  read(name: string): Promise<StoreResult<{ text: string; info: StoredPatchInfo }>> {
    return this.call((id) => ({ t: "store", id, op: "read", name }));
  }
  write(name: string, text: string, overwrite: boolean): Promise<StoreResult<StoredPatchInfo>> {
    return this.call((id) => ({ t: "store", id, op: "write", name, text, overwrite }));
  }
  remove(name: string): Promise<StoreResult<null>> {
    return this.call((id) => ({ t: "store", id, op: "remove", name }));
  }
}

// ---------------------------------------------------------------------------------------
// 起動: 自動保存から復元 → Session → Controller
// ---------------------------------------------------------------------------------------

const catalog = buildCatalog(REGISTRY);
const backend = new WorkletBackend();
const link = new ServerLink();

interface Autosave {
  revision: number;
  text: string;
}

function loadAutosave(): { patch: Patch; revision: number } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Autosave;
    const r = parsePatchText(a.text, catalog);
    if (!r.ok || !Number.isInteger(a.revision) || a.revision < 0) return null; // 壊れた自動保存は使わない(空のパッチで始める)
    return { patch: r.patch as unknown as Patch, revision: a.revision };
  } catch {
    return null;
  }
}

const restored = loadAutosave();
const session = new Session({
  catalog,
  backend,
  sessionId: `tab-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
  ...(restored ? { patch: restored.patch, revision: restored.revision } : {}),
});
const controller = new Controller({ session, store: link, now: () => new Date() });

let requestSeq = 0;
/** 人の操作(この画面からのコマンド)。 */
function human(command: string, args?: Record<string, unknown>): Promise<CommandResponse> {
  return controller.handle({ v: 1, request_id: `ui-${++requestSeq}`, command, ...(args ? { args } : {}) }, "human");
}

// 自動保存(作業中のパッチをブラウザ内に保存: REQ-F-008)
let autosaveTimer: number | null = null;
function scheduleAutosave(): void {
  if (autosaveTimer !== null) return;
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    try {
      const text = serializePatchDocument(session.getPatch() as unknown as PatchDocument);
      const a: Autosave = { revision: session.revision, text };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(a));
    } catch (e) {
      debug.errors.push(`自動保存に失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, AUTOSAVE_DELAY_MS);
}

const recentEvents: unknown[] = [];
controller.subscribe((ev) => {
  recentEvents.push(ev);
  if (recentEvents.length > 200) recentEvents.shift();
  link.send({ t: "evt", event: ev });
  if ((ev as { event?: string }).event === "patch.changed" || (ev as { type?: string }).type === "patch.changed") scheduleAutosave();
  render();
});
// 通知の種類の名前に依存しないよう、リビジョンが進んだら必ず自動保存する
let savedRevision = session.revision;
function autosaveIfChanged(): void {
  if (session.revision !== savedRevision) {
    savedRevision = session.revision;
    scheduleAutosave();
  }
}

// エージェントの要求(サーバーが中継)。人の操作と同じ待ち行列で順に処理される。
link.onRequest = (id, request) => {
  void controller.handle(request, "agent").then((response) => {
    link.send({ t: "res", id, response });
    autosaveIfChanged();
    render();
  });
};
link.onChange = () => render();

// ---------------------------------------------------------------------------------------
// 音声
// ---------------------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;

async function ensureAudio(): Promise<void> {
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" }); // 既定で 48000 Hz を要求し、得られた値を使う(DEC-107)
    await ctx.audioWorklet.addModule("dist/worklet.js");
    node = new AudioWorkletNode(ctx, "synth-processor", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.port.onmessage = (ev: MessageEvent<FromWorklet>) => {
      const m = ev.data;
      if (m.type === "status") {
        backend.onMessage(m);
        session.pollBackend(); // 音声状態・診断の変化を通知にする
        render();
      } else if (m.type === "error") {
        debug.errors.push(m.message);
        $("error").textContent = m.message;
      }
    };
    node.connect(ctx.destination);
    backend.attach(node.port, ctx.sampleRate);
    ctx.onstatechange = () => {
      backend.setSuspended(ctx !== null && ctx.state !== "running");
      session.pollBackend();
      render();
    };
  }
  if (ctx.state !== "running") await ctx.resume();
}

async function startAudio(): Promise<void> {
  try {
    await ensureAudio();
    const r = await human("engine.start");
    if (!r.ok) throw new Error(`${r.error.id}: ${r.error.message}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    debug.errors.push(msg);
    $("error").textContent = `音声を開始できませんでした: ${msg}`;
  }
  render();
}

// ---------------------------------------------------------------------------------------
// 画面(最小)。操作はすべてコマンド経由。鍵盤だけは演奏入力(MIDI と同じ経路。コマンド・履歴の対象外: DEC-008)
// ---------------------------------------------------------------------------------------

/** デモ用のパッチ: MIDI-CV → VCO → VCA → 出力。ADSR が VCA を開閉する。1つのまとめ適用(batch)で組む。 */
function demoOps(): { command: string; args: Record<string, unknown> }[] {
  const add = (id: string, type: string, params?: Record<string, number>) => ({ command: "module.add", args: { id, type, ...(params ? { params } : {}) } });
  const con = (from: string, to: string) => {
    const [fm, fp] = from.split(".");
    const [tm, tp] = to.split(".");
    return { command: "cable.connect", args: { from: { module: fm, port: fp }, to: { module: tm, port: tp } } };
  };
  return [
    add("midi", "MOD-IO-002"),
    add("vco", "MOD-OSC-001"),
    add("env", "MOD-ENV-001", { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 }),
    add("trim", "MOD-UTL-001", { gain: 0.5, offset: 0 }),
    add("vca", "MOD-AMP-001"),
    con("midi.PITCH", "vco.pitch"),
    con("midi.GATE", "env.gate"),
    con("vco.saw", "vca.in1"),
    con("env.env", "trim.in"),
    con("trim.out", "vca.cv1"),
    con("vca.out", "out.IN_L"),
  ];
}

async function run(command: string, args?: Record<string, unknown>): Promise<CommandResponse> {
  const r = await human(command, args);
  $("error").textContent = r.ok ? "" : `${r.error.id} ${r.error.code}: ${r.error.message}`;
  autosaveIfChanged();
  render();
  return r;
}

function render(): void {
  const st = backend.status();
  const w = backend.lastStatus;
  $("state").textContent =
    st.audioState === "stopped"
      ? "停止中(音声は始まっていません)"
      : st.panic
        ? "緊急停止中(音は出ません)"
        : st.audioState === "running"
          ? "動作中"
          : "中断中";
  const patch = session.getPatch();
  $("patch").textContent =
    `リビジョン ${session.revision} / モジュール ${patch.modules.length} / ケーブル ${patch.cables.length}` +
    ` / サーバー ${link.accepted ? "接続中" : link.rejectedReason === "another_tab" ? "別のタブが使用中" : "未接続"}`;
  $("modules").textContent = patch.modules.map((m) => `${m.id}(${m.type})`).join("、");
  if (w) {
    $("meter").textContent =
      `出力ピーク ${w.peak.toFixed(3)} / 音量 ${st.levelDb.toFixed(1)} dB / リミッター利得 ${w.limiterGain.toFixed(3)}` +
      ` / サンプルレート ${w.fs} Hz / 非有限値 ${w.nonfiniteModules + w.nonfiniteOutputStage} / 最終クリップ ${w.clipCount}`;
  }
  const level = $<HTMLInputElement>("level");
  if (document.activeElement !== level && Number(level.value) !== st.levelDb) level.value = String(st.levelDb);
  $("levelLabel").textContent = `${st.levelDb} dB`;
  $<HTMLButtonElement>("start").disabled = st.audioState === "running";
}

// 自動試験と状態確認のために公開する(読み取り専用の情報)
const debug = {
  get contextState(): string {
    return ctx ? ctx.state : "none";
  },
  get status() {
    return backend.lastStatus;
  },
  get audioState(): string {
    return backend.status().audioState;
  },
  get revision(): number {
    return session.revision;
  },
  get patch() {
    return session.getPatch();
  },
  get serverAccepted(): boolean {
    return link.accepted;
  },
  get events(): unknown[] {
    return recentEvents;
  },
  get restoredFromAutosave(): boolean {
    return restored !== null;
  },
  errors: [] as string[],
};
(window as unknown as { __synth: typeof debug }).__synth = debug;

window.addEventListener("DOMContentLoaded", () => {
  const token = document.querySelector<HTMLMetaElement>('meta[name="synth-tab-token"]')?.content ?? "";
  if (token) link.connect(token);

  $("start").addEventListener("click", () => void startAudio());
  $("demo").addEventListener("click", () => {
    void (async () => {
      await run("patch.new");
      await run("batch", { ops: demoOps() });
    })();
  });
  $("panic").addEventListener("click", () => void run("engine.panic"));
  $("release").addEventListener("click", () => void run("engine.release_panic"));
  $("undo").addEventListener("click", () => void run("history.undo"));
  $("redo").addEventListener("click", () => void run("history.redo"));
  $("level").addEventListener("input", () => void run("output.set_level", { level_db: Number($<HTMLInputElement>("level").value) }));

  // 画面鍵盤(C4〜C5)。押している間だけ鳴る。
  const keys = $("keys");
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B", "C"];
  names.forEach((name, i) => {
    const b = document.createElement("button");
    b.textContent = name;
    b.dataset.note = String(60 + i);
    const note = 60 + i;
    b.addEventListener("pointerdown", () => backend.midi([0x90, note, 100]));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => backend.midi([0x80, note, 0]));
    keys.appendChild(b);
  });
  render();
});
