// タブ側の本体。パッチの正本(Session)はここにあり、人の操作もエージェントの操作も同じコマンドで処理する(DEC-105)。
// 音声は「音声開始」を押したときにだけ始める(product-spec §3.3)。
import type { FromWorklet } from "../audio/messages.js";
import { WorkletBackend } from "../audio/worklet-backend.js";
import { buildCatalog } from "../control/catalog.js";
import { Controller } from "../control/controller.js";
import { parsePatchText, serializePatchDocument } from "../control/patch-doc.js";
import { Session } from "../control/session.js";
import type { PatchStore, StoreResult, StoredPatchInfo } from "../control/store.js";
import type { CommandResponse, Patch } from "../control/types.js";
import { REGISTRY } from "../modules/registry.js";
import type { ServerToTab, TabToServer } from "../server/protocol.js";
import { MidiLink } from "./midi.js";
import type { MidiState } from "./midi.js";
import { createRackView } from "./rack-view.js";
import type { RackView } from "./rack-view.js";
import { createEditor } from "./ui.js";
import type { Editor } from "./ui.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const AUTOSAVE_KEY = "modular-synth.autosave.v1";
/** 読めなかった自動保存の退避先(1件だけ。新しい退避で上書きする)。 */
const AUTOSAVE_BROKEN_KEY = "modular-synth.autosave.broken.v1";
/** 編集するタブを1つにするための鍵の名前(Web Locks。同じブラウザ・同じ保存領域の中で1つ)。 */
const TAB_LOCK_NAME = "modular-synth.tab";
/** サーバーへ接続し直すまでの待ち時間 [ms](最初 → 最大)。 */
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 5000;
const AUTOSAVE_DELAY_MS = 1000;
/** クリップ表示を保持する時間(DEC-011: 1秒)。 */
const CLIP_HOLD_MS = 1000;

// ---------------------------------------------------------------------------------------
// サーバーとの接続(エージェントの要求の中継、パッチファイルの保存先)
// ---------------------------------------------------------------------------------------

class ServerLink implements PatchStore {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private waiting = new Map<number, (r: StoreResult<unknown>) => void>();
  private stopped = false;
  private retryMs = RECONNECT_MIN_MS;
  private retryTimer: number | null = null;
  accepted = false;
  rejectedReason: string | null = null;
  onRequest: ((id: number, request: unknown) => void) | null = null;
  onChange: (() => void) | null = null;

  connect(token: string): void {
    if (this.stopped) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/tab?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      let m: ServerToTab;
      try {
        m = JSON.parse(String(ev.data)) as ServerToTab;
      } catch {
        return; // 壊れた1通は捨てる
      }
      if (m.t === "hello") {
        this.accepted = m.accepted;
        this.rejectedReason = m.accepted ? null : (m.reason ?? "rejected");
        if (m.accepted) this.retryMs = RECONNECT_MIN_MS;
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
      if (this.ws !== ws) return;
      this.accepted = false;
      this.ws = null;
      for (const w of this.waiting.values()) w({ ok: false, error: "unavailable", message: "サーバーとの接続が切れた" });
      this.waiting.clear();
      this.onChange?.();
      // 別のタブが使用中で断られたときは、つなぎ直さない(このタブは編集しない)。それ以外は、間隔を延ばしながらつなぎ直す
      if (this.rejectedReason !== "another_tab") this.scheduleReconnect();
    };
  }

  /** 以後、接続しない(このタブを編集に使わないとき)。 */
  stop(): void {
    this.stopped = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.accepted = false;
    try {
      ws?.close();
    } catch {
      // 既に閉じている
    }
  }

  /**
   * サーバーへつなぎ直す。サーバーが再起動するとタブ用トークンが変わるので、画面(index.html)を取り直して
   * 新しいトークンを読む。取れなければ、また後で試す。
   */
  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer !== null) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(RECONNECT_MAX_MS, this.retryMs * 2);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void (async () => {
        try {
          const res = await fetch(location.pathname, { cache: "no-store" });
          const html = res.ok ? await res.text() : "";
          const token = /<meta\s+name="synth-tab-token"\s+content="([A-Za-z0-9_-]{16,256})"/.exec(html)?.[1];
          if (!token) throw new Error("no token");
          this.connect(token);
        } catch {
          this.scheduleReconnect();
        }
      })();
    }, delay);
  }

  send(msg: TabToServer): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false; // 文字列にできない・送れない
    }
  }

  private call<T>(make: (id: number) => TabToServer): Promise<StoreResult<T>> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.waiting.set(id, resolve as (r: StoreResult<unknown>) => void);
      if (!this.send(make(id))) {
        this.waiting.delete(id);
        resolve({ ok: false, error: "unavailable", message: "サーバーに接続していない" });
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

  /** 演奏データの保存先(サーバーの別の専用フォルダ)。削除の口はない。 */
  /** 演奏データを音声ファイルに書き出す(サーバーが行う。頼む・進み具合を聞く)。 */
  render(name: string, levelDb: number, tailSeconds: number): Promise<StoreResult<Record<string, unknown>>> {
    return this.call((id) => ({ t: "store", id, op: "render", name, level_db: levelDb, tail_seconds: tailSeconds }));
  }
  readonly performances: PatchStore = {
    list: () => this.call((id) => ({ t: "store", id, op: "list", area: "performances" })),
    read: (name) => this.call((id) => ({ t: "store", id, op: "read", name, area: "performances" })),
    write: (name, text, overwrite) => this.call((id) => ({ t: "store", id, op: "write", name, text, overwrite, area: "performances" })),
    remove: () => Promise.resolve({ ok: false, error: "failed", message: "演奏データは削除できない" }),
  };
}

// ---------------------------------------------------------------------------------------
// 起動: 自動保存から復元 → Session → Controller
// ---------------------------------------------------------------------------------------

const catalog = buildCatalog(REGISTRY);
/** 追加した直後のモジュール(まだ測定値が届いていない)の読出し値 = その種別の初期状態の値。 */
function initialMeterOf(moduleId: string): Record<string, unknown> | undefined {
  const type: string | undefined = currentPatch().modules.find((m) => m.id === moduleId)?.type;
  const make = type ? REGISTRY.get(type) : undefined;
  const fresh = make ? (make(48000) as unknown as { read?: () => Record<string, unknown> }) : undefined;
  return typeof fresh?.read === "function" ? fresh.read() : undefined;
}
let currentPatch: () => Patch = () => ({ format: "modular-synth-patch", schema_version: 1, meta: { title: "", description: "" }, modules: [], cables: [] });
const backend = new WorkletBackend({
  // 追加した直後のメーター(まだ測定値が届いていない)の読出し値 = 初期状態のメーターの値
  initialMeter: (moduleId: string): Record<string, unknown> | undefined => initialMeterOf(moduleId),
});
const link = new ServerLink();

interface Autosave {
  revision: number;
  text: string;
}

/** 自動保存を読めなかったときの説明(画面に出す)。読めた・なかったときは null。 */
let autosaveProblem: string | null = null;

function loadAutosave(): { patch: Patch; revision: number } | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Autosave;
    const r = parsePatchText(a.text, catalog);
    if (!r.ok) throw new Error(`${r.error.id}: ${r.error.message}`);
    if (!Number.isInteger(a.revision) || a.revision < 0) throw new Error("リビジョンが不正");
    return { patch: r.patch, revision: a.revision };
  } catch (e) {
    if (raw === null) return null; // 保存領域を読めない
    // 壊れた自動保存は使わない(空のパッチで始める)。黙って捨てず、退避して知らせる(data-contract DAT-24)
    const why = e instanceof Error ? e.message : String(e);
    let kept = false;
    try {
      localStorage.setItem(AUTOSAVE_BROKEN_KEY, raw);
      kept = true;
    } catch {
      // 退避できない(容量など)
    }
    autosaveProblem =
      `前回の作業中のパッチ(自動保存)を読めなかったため、空のパッチで始めました(${why})。` +
      (kept ? `元の内容はブラウザの保存領域の「${AUTOSAVE_BROKEN_KEY}」に退避しました。` : "元の内容は退避できませんでした。");
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
/** 起動時のリビジョン(自動保存から復元した値、または 0)。 */
const initialRevision = session.revision;
currentPatch = () => session.getPatch();
const controller = new Controller({
  session,
  store: link,
  performanceStore: link.performances,
  renderer: (name, options) => link.render(name, options.levelDb, options.tailSeconds),
  now: () => new Date(),
});

let requestSeq = 0;
/** 人の操作(この画面からのコマンド)。 */
function human(command: string, args?: Record<string, unknown>): Promise<CommandResponse> {
  return controller.handle({ v: 1, request_id: `ui-${++requestSeq}`, command, ...(args ? { args } : {}) }, "human");
}

// ---- このタブを編集に使うか(単一タブ: data-contract DAT-25) ----
// 編集と自動保存をするのは、鍵(Web Locks)を取れたタブ1つだけ。2つ目のタブは、編集も自動保存もサーバーへの接続もしない
// (2つ目のタブが自動保存を上書きして、1つ目のタブの作業が再読込で失われないようにする)。
type TabRole = "pending" | "owner" | "blocked";
let tabRole: TabRole = "pending";
let domReady = false;
let linkStarted = false;

function blockTab(reason: string): void {
  tabRole = "blocked";
  link.stop();
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = null;
  applyBlocked(reason);
}
let blockedReason: string | null = null;
function applyBlocked(reason: string): void {
  blockedReason = reason;
  if (!domReady) return;
  const box = document.getElementById("blocked");
  if (box) {
    // 画面には短い語だけ。理由の文は、マウスを載せると出る
    box.textContent = "OTHER TAB";
    box.title = reason;
    box.hidden = false;
  }
  // 画面の操作を受け付けない(キーボードの操作も含む)
  for (const e of Array.from(document.body.children)) {
    if (e.id !== "blocked" && e instanceof HTMLElement) e.inert = true;
  }
}
function maybeConnect(): void {
  if (tabRole !== "owner" || !domReady || linkStarted) return;
  const token = document.querySelector<HTMLMetaElement>('meta[name="synth-tab-token"]')?.content ?? "";
  if (!token) return;
  linkStarted = true;
  link.connect(token);
}
function becomeOwner(): void {
  if (tabRole !== "pending") return;
  tabRole = "owner";
  maybeConnect();
  if (session.revision !== initialRevision) autosaveNow(); // 鍵を待つ間に行われた変更
}
{
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks && typeof locks.request === "function") {
    locks
      .request(TAB_LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) {
          blockTab("別のタブがこのシンセを使っています。このタブでは編集・保存できません(先に開いたタブを使うか、そちらを閉じてからこのタブを再読込してください)。");
          return undefined;
        }
        becomeOwner();
        return new Promise<void>(() => undefined); // タブを閉じるまで鍵を持ち続ける
      })
      .catch(() => queueMicrotask(becomeOwner));
  } else {
    queueMicrotask(becomeOwner); // 鍵の仕組みがないブラウザ: サーバーの単一タブの検査だけに頼る
  }
}

// 自動保存(作業中のパッチをブラウザ内に保存: REQ-F-008)
let autosaveTimer: number | null = null;
/** 今すぐ自動保存する。編集するタブでなければ何もしない。 */
function autosaveNow(): void {
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (tabRole !== "owner") return;
  try {
    const text = serializePatchDocument(session.getPatch());
    const a: Autosave = { revision: session.revision, text };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(a));
    autosavedRevision = session.revision;
  } catch (e) {
    const msg = `自動保存に失敗: ${e instanceof Error ? e.message : String(e)}`;
    debug.errors.push(msg);
    showError("AUTOSAVE FAILED", msg);
  }
}
/** 最後に自動保存できたリビジョン(まだなら −1)。 */
let autosavedRevision = restored ? restored.revision : -1;
function scheduleAutosave(): void {
  if (autosaveTimer !== null || tabRole === "blocked") return;
  autosaveTimer = window.setTimeout(autosaveNow, AUTOSAVE_DELAY_MS);
}
// タブを閉じる・再読込する・裏に回るときは、待たずに保存する(変更から1秒以内の再読込で変更が消えないようにする)
function flushAutosave(): void {
  if (autosaveTimer !== null || session.revision !== autosavedRevision) autosaveNow();
}
window.addEventListener("pagehide", () => {
  flushAutosave();
  // 記録中の演奏データを閉じて保存する(演奏し終えて続きを待っている間に閉じても、終わりの印が残るように。DEC-024)
  if (tabRole === "owner" && session.closePerformanceOnExit()) void controller.savePerformances();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushAutosave();
});

const recentEvents: unknown[] = [];
controller.subscribe((ev) => {
  recentEvents.push(ev);
  if (recentEvents.length > 200) recentEvents.shift();
  link.send({ t: "evt", event: ev });
  if ((ev as { event?: string }).event === "patch.changed" || (ev as { type?: string }).type === "patch.changed") scheduleAutosave();
  if ((ev as { event?: string }).event === "patch.changed") {
    // 変わったモジュールを、ラックの上で短く明滅させる(誰の操作でも同じ)
    const ids: string[] = [];
    for (const c of ((ev as { data?: { changes?: Record<string, any>[] } }).data?.changes ?? [])) {
      if (c.kind === "module_added") ids.push(c.module.id);
      else if (c.kind === "param_changed" || c.kind === "module_moved") ids.push(c.module_id);
      else if (c.kind === "cable_added") ids.push(c.cable.from.module, c.cable.to.module);
    }
    rack?.markChanged(ids);
  }
  if ((ev as { event?: string }).event === "performance.saved") {
    const d = (ev as { data: { name: string | null; ok: boolean; entries: number; closed: boolean; reason?: string } }).data;
    lastSaved = d.ok ? `${d.name} · ${d.entries}` : `save failed: ${d.reason ?? ""}`;
    if (d.ok && d.closed) void refreshPerformances();
  }
  editor?.onEvent(ev); // 誰が何をしたかを変更の履歴に出す
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
let wasAccepted = false;
link.onChange = () => {
  if (link.rejectedReason === "another_tab" && tabRole !== "blocked") {
    // 別のブラウザ(保存領域が別)のタブが、先にサーバーへつないでいる
    blockTab("別のタブ(別のブラウザやプロファイル)がこのシンセを使っています。このタブでは編集・保存できません。");
  }
  if (link.accepted !== wasAccepted) {
    wasAccepted = link.accepted;
    editor?.refreshLibrary(); // 保存済みパッチの一覧はサーバーにある
    if (link.accepted) void controller.retryPerformances(); // つながっていない間に書けなかった演奏データを書き直す(DEC-025)
  }
  render();
};

// ---------------------------------------------------------------------------------------
// 音声
// ---------------------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
/** 音声側の合わせ直し(全体の渡し直し)を行った時刻。短い間に繰り返すなら、音声を止める。 */
let resyncTimes: number[] = [];

/** 音声の出力を片付けて「停止」にする(音声の処理が止まった、出力が閉じられた)。「音声開始」でやり直せる。 */
function teardownAudio(reason: string): void {
  const old = ctx;
  ctx = null;
  node = null;
  backend.detach();
  if (old) {
    old.onstatechange = null;
    void old.close().catch(() => undefined);
  }
  session.pollBackend();
  debug.errors.push(reason);
  showError("AUDIO STOPPED", reason);
  render();
}

async function ensureAudio(): Promise<void> {
  if (!ctx) {
    const c = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" }); // 既定で 48000 Hz を要求し、得られた値を使う(DEC-107)
    await c.audioWorklet.addModule("dist/worklet.js");
    const n = new AudioWorkletNode(c, "synth-processor", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    n.port.onmessage = (ev: MessageEvent<FromWorklet>) => {
      if (node !== n) return;
      const m = ev.data;
      if (m.type === "status") {
        backend.onMessage(m);
        session.pollBackend(); // 音声状態・診断の変化を通知にする
        void controller.savePerformances(); // 演奏し終えた後に閉じた演奏データを保存する
        renderStatus();
      } else if (m.type === "error") {
        debug.errors.push(m.message);
        showError("AUDIO ERROR", m.message);
        if (m.resync) {
          // 音声側がパッチの正本とずれた: 全体を渡し直す。短い間に繰り返すなら、音声を止める
          const now = Date.now();
          resyncTimes = resyncTimes.filter((t) => now - t < 10000);
          resyncTimes.push(now);
          if (resyncTimes.length > 3) teardownAudio("音声側の合わせ直しに繰り返し失敗しました");
          else session.resyncBackend();
          render();
        }
      }
    };
    // 音声の処理(AudioWorkletProcessor)が例外で止まった: 以後は無音のままになるので、片付けて「停止」にする
    n.onprocessorerror = () => {
      if (node === n) teardownAudio("音声の処理が停止しました");
    };
    n.connect(c.destination);
    ctx = c;
    node = n;
    backend.attach(n.port, c.sampleRate); // ここで、開始前に行われた操作(音量・上限・緊急停止)を音声側へ持ち越す
    c.onstatechange = () => {
      if (ctx !== c) return;
      if (c.state === "closed") {
        teardownAudio("音声の出力が閉じられました");
        return;
      }
      // 中断: 音声側も止める。復帰(人の操作によらないものを含む): 開始と同じ扱い(音量の引き下げとフェードイン)
      backend.setSuspended(c.state !== "running");
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
    showError("START FAILED", msg);
  }
  render();
}

// ---------------------------------------------------------------------------------------
// 画面。パッチの編集部分は ui.ts。操作はすべてコマンド経由。鍵盤だけは演奏入力(MIDI と同じ経路。コマンド・履歴の対象外: DEC-008)
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

let editor: Editor | null = null;

// ---- MIDI 機器(Web MIDI)。画面鍵盤と同じ経路でエンジンへ渡す ----
let midiMessages = 0;
const midi = new MidiLink({
  onMessage: (bytes) => {
    midiMessages++;
    backend.midi(bytes);
  },
  onChange: (state) => {
    backend.midiAvailable = state.kind === "ready";
    session.pollBackend(); // 利用可否の変化を通知にする(EVT-02)
    renderMidi(state);
  },
});
function renderMidi(state: MidiState): void {
  if (!domReady) return;
  const button = $<HTMLButtonElement>("midi-connect");
  const label = $("midi-state");
  button.disabled = state.kind === "ready" || state.kind === "unsupported";
  label.textContent =
    state.kind === "idle"
      ? "off"
      : state.kind === "unsupported"
        ? "unsupported"
        : state.kind === "denied"
          ? `denied: ${state.reason}`
          : state.inputs.length === 0
            ? "no device"
            : state.inputs.join(", ");
}

/** エラーと知らせ: 画面には短い語(エラーの ID とコードなど)だけを出す。説明の文は、マウスを載せると出る(title)。 */
function showError(text: string, detail = ""): void {
  $("error").textContent = text;
  $("error").title = detail;
}
function showNotice(text: string, detail = ""): void {
  $("notice").textContent = text;
  $("notice").title = detail;
}

/** 人の操作を送り、結果を画面に出す。失敗したらエラーID・コード・メッセージを表示し、入力欄を実際の値に戻す。 */
async function run(command: string, args?: Record<string, unknown>): Promise<CommandResponse> {
  const r = await human(command, args);
  showError(r.ok ? "" : `${r.error.id} ${r.error.code}`, r.ok ? "" : r.error.message);
  // 成功時の注意(型違いの接続など。状態は変わっている: 契約 §3.2)
  showNotice(r.ok ? r.warnings.map((w) => w.code).join(" / ") : "", r.ok ? r.warnings.map((w) => w.message).join(" / ") : "");
  autosaveIfChanged();
  render(!r.ok);
  return r;
}

let lastClipCount = 0;
let levelDragging = false;
let clipTimer: number | null = null;

/** 音声の状態・音量・メーターの表示(状態の通知のたびに呼ぶ。パッチの表示は作り直さない)。 */
function renderStatus(): void {
  const st = backend.status();
  const w = backend.lastStatus;
  $("state").textContent =
    st.audioState === "stopped"
      ? "off"
      : st.panic
        ? "panic"
        : st.audioState === "running"
          ? "run"
          : "hold";
  const patch = session.getPatch();
  $("patch").textContent =
    `rev ${session.revision}  mod ${patch.modules.length}  cbl ${patch.cables.length}` + `  srv ${link.accepted ? "on" : link.rejectedReason === "another_tab" ? "other tab" : "off"}`;
  $("meter").textContent = w
    ? `peak ${w.peak.toFixed(3)}  gr ${w.limiterGain.toFixed(3)}` + `  ${w.fs} hz  nan ${w.nonfiniteModules + w.nonfiniteOutputStage}  clip ${w.clipCount}`
    : "";
  // 最終クリップが新たに起きたら、表示を1秒保持する(DEC-011)
  const clipCount = w ? w.clipCount : 0;
  if (clipCount > lastClipCount) {
    $("clip").hidden = false;
    if (clipTimer !== null) window.clearTimeout(clipTimer);
    clipTimer = window.setTimeout(() => {
      clipTimer = null;
      $("clip").hidden = true;
    }, CLIP_HOLD_MS);
  }
  lastClipCount = clipCount;
  // スライダーは実際の値に合わせる。つまみを動かしている最中だけは書き換えない(フォーカスがあるだけなら書き換える:
  // 引き下げの後に矢印キーを押したとき、古い位置から計算した値で音量が跳ね上がらないようにする)
  const level = $<HTMLInputElement>("level");
  if (!levelDragging && Number(level.value) !== st.levelDb) level.value = String(st.levelDb);
  $("levelLabel").textContent = `${st.levelDb} dB`;
  renderPerformance();
  $<HTMLButtonElement>("start").disabled = st.audioState === "running";
  $<HTMLButtonElement>("release").disabled = !st.panic;
  editor?.renderMeters(st.audioState === "running" && w ? w.meters : null);
  rack?.update({ activity: st.audioState === "running" && w && !st.panic ? (w.activity ?? null) : null, overrides: w?.overrides ?? {}, peak: w ? w.peak : 0, panic: st.panic });
}

const formatClock = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
/** 最後に保存した演奏データの表示。 */
let lastSaved = "";

/** 保存された演奏データの一覧(新しい順)。再演奏のボタンを付ける。 */
async function refreshPerformances(): Promise<void> {
  const list = $("performance-list");
  const r = await human("performance.list");
  list.textContent = "";
  if (!r.ok) {
    list.appendChild(Object.assign(document.createElement("li"), { textContent: "–" }));
    return;
  }
  const items = (r.result.performances as { name: string; bytes: number }[]).slice(0, 30);
  if (items.length === 0) list.appendChild(Object.assign(document.createElement("li"), { textContent: "–" }));
  for (const it of items) {
    const li = document.createElement("li");
    li.dataset.performance = it.name;
    li.append(`${it.name} `);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "small";
    b.textContent = "REPLAY";
    b.title = "今のパッチを、この演奏を始めた時点のパッチに置き換えて演奏します(「取り消し」で戻せます)";
    b.addEventListener("click", () => void run("performance.replay", { name: it.name }));
    li.append(b);
    // 音声ファイルへの書き出し(演奏はしない。サーバーが別に計算する)
    const w = document.createElement("button");
    w.type = "button";
    w.className = "small";
    w.textContent = "WAV";
    w.title = "演奏せずに、この演奏の音声ファイル(WAV)を作ります。保存先は、演奏データと同じフォルダです";
    const note = document.createElement("span");
    note.className = "render-state";
    w.addEventListener("click", () => void renderToFile(it.name, w, note));
    li.append(" ", w, " ", note);
    list.appendChild(li);
  }
}

/** 音声ファイルへの書き出しを頼み、終わるまで進み具合を聞いて表示する。 */
async function renderToFile(name: string, button: HTMLButtonElement, note: HTMLElement): Promise<void> {
  button.disabled = true;
  try {
    for (;;) {
      const r = await human("performance.render", { name });
      if (!r.ok) {
        note.textContent = `${r.error.id} ${r.error.code}`;
        return;
      }
      const s = r.result as { status: string; progress?: number; path?: string; seconds?: number; peak?: number; clip_count?: number; error?: { message: string } };
      if (s.status === "done") {
        const loud = (s.clip_count ?? 0) > 0 ? ` clip ${s.clip_count}` : "";
        note.textContent = `${s.path}${loud}`;
        return;
      }
      if (s.status === "failed") {
        note.textContent = "failed";
        note.title = s.error?.message ?? "";
        return;
      }
      note.textContent = s.status === "queued" ? "…" : `${Math.round((s.progress ?? 0) * 100)}%`;
      await new Promise((ok) => setTimeout(ok, 700));
    }
  } finally {
    button.disabled = false;
  }
}

/** エージェントの演奏(予約済みの楽譜と、人からの指示)の表示。 */
let shownPrompts = "";
function renderPerformance(): void {
  const p = session.performance;
  // 経過 / 予定(予定がなければ、経過だけ)
  const clock = p.plan.duration_seconds === null ? formatClock(p.plan.elapsed_seconds) : `${formatClock(p.plan.elapsed_seconds)} / ${formatClock(p.plan.duration_seconds)}`;
  // 演奏中だけ、時計を出す(経過 / 予定、残りの秒)。演奏していないときは、何も書かない
  $("perf-state").textContent = p.playing ? `▶ ${clock}  +${p.remaining.toFixed(1)}s` : "";
  $("perf-saved").textContent = lastSaved;
  $<HTMLButtonElement>("score-stop").disabled = !p.playing;
  // 指示の一覧は、中身が変わったときだけ作り直す
  const key = JSON.stringify(p.prompts);
  if (key === shownPrompts) return;
  shownPrompts = key;
  const list = $("prompt-list");
  list.textContent = "";
  for (const q of [...p.prompts].reverse()) {
    const li = document.createElement("li");
    li.dataset.prompt = String(q.id);
    li.dataset.acked = String(q.acked);
    li.textContent = `${q.acked ? "✓" : "·"} ${q.text}`;
    list.appendChild(li);
  }
}

let rack: RackView | null = null;
/** ラックの下の帯に出す、短い状態(等幅・大文字)。 */
function hudItems(): string[] {
  const st = backend.status();
  const patch = session.getPatch();
  const p = session.performance;
  return [
    st.panic ? "panic" : st.audioState === "running" ? "audio run" : st.audioState === "stopped" ? "audio off" : "audio hold",
    `rev ${session.revision}`,
    `mod ${patch.modules.length} · cbl ${patch.cables.length}`,
    p.playing ? `play ${Math.ceil(p.remaining)}s` : "idle",
    `out ${st.levelDb}db`,
  ];
}

function render(force = false): void {
  renderStatus();
  editor?.render(force);
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
  /** ラックの表示(色相、配置、倍率)。 */
  get rack() {
    return rack;
  },
  /** 人の操作としてコマンドを送る(自動試験用)。 */
  human(command: string, args?: Record<string, unknown>) {
    return human(command, args);
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
  get autosaveProblem(): string | null {
    return autosaveProblem;
  },
  /** 性能の測定(npm run bench:browser が使う)。ワークレット側でブロックごとの処理時間を集計する。 */
  perf(enabled: boolean): void {
    backend.setPerf(enabled);
  },
  /** 性能の測定用: 演奏入力(MIDI のバイト列)を送る。画面鍵盤と同じ経路。 */
  sendMidiForBench(bytes: number[]): void {
    backend.midi(bytes);
  },
  /** 音声の出力の時計と遅延(L3 の計算値)。 */
  get audioClock() {
    return ctx ? { currentTime: ctx.currentTime, baseLatency: ctx.baseLatency, outputLatency: (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? null, sampleRate: ctx.sampleRate } : null;
  },
  get midiState(): MidiState {
    return midi.current;
  },
  get midiMessages(): number {
    return midiMessages;
  },
  get tabRole(): string {
    return tabRole;
  },
  get desyncCount(): number {
    return backend.desyncCount;
  },
  /** ワークレット側の実際の音量・上限・緊急停止(最後に届いた状態)。 */
  get workletState() {
    const w = backend.lastStatus;
    return w ? { levelDb: w.levelDb, agentMaxLevelDb: w.agentMaxLevelDb, panic: w.panic, running: w.running, received: w.received } : null;
  },
  get backendState() {
    const b = backend.status();
    return { levelDb: b.levelDb, agentMaxLevelDb: b.agentMaxLevelDb, panic: b.panic, audioState: b.audioState };
  },
  errors: [] as string[],
};
(window as unknown as { __synth: typeof debug }).__synth = debug;

window.addEventListener("DOMContentLoaded", () => {
  rack = createRackView({
    canvas: $<HTMLCanvasElement>("rack"),
    hud: $("rack-hud"),
    hueSelect: $<HTMLSelectElement>("hue"),
    periodSelect: $<HTMLSelectElement>("hue-period"),
    catalog,
    getPatch: () => session.getPatch(),
    getRevision: () => session.revision,
    hudItems,
    onPick: (id) => {
      const card = document.querySelector<HTMLElement>(`#module-list [data-module="${CSS.escape(id)}"]`);
      if (!card) return;
      card.scrollIntoView({ block: "center" });
      card.classList.add("picked");
      window.setTimeout(() => card.classList.remove("picked"), 1000);
      card.querySelector<HTMLElement>("input, select, button")?.focus({ preventScroll: true });
    },
  });
  editor = createEditor({
    catalog,
    getPatch: () => session.getPatch(),
    getHistory: () => session.history,
    run,
    send: async (command, args) => {
      const r = await human(command, args);
      autosaveIfChanged();
      return r;
    },
    showError,
    showNotice,
  });
  domReady = true;
  if (blockedReason !== null) applyBlocked(blockedReason);
  maybeConnect();
  if (autosaveProblem !== null) showNotice("AUTOSAVE MOVED", autosaveProblem);

  $("start").addEventListener("click", () => void startAudio());
  $("demo").addEventListener("click", () => {
    void (async () => {
      await run("patch.new");
      await run("batch", { ops: demoOps() });
    })();
  });
  $("panic").addEventListener("click", () => void run("engine.panic"));
  // 緊急停止のボタンは画面の下にあるので、どこからでも Esc キーで止められるようにする(REQ-S-002: 即時に実行できる)
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !ev.repeat) void run("engine.panic");
  });
  $("release").addEventListener("click", () => void run("engine.release_panic"));
  $("undo").addEventListener("click", () => void run("history.undo"));
  $("redo").addEventListener("click", () => void run("history.redo"));
  $("level").addEventListener("input", () => void run("output.set_level", { level_db: Number($<HTMLInputElement>("level").value) }));
  $("level").addEventListener("pointerdown", () => {
    levelDragging = true;
  });
  for (const ev of ["pointerup", "pointercancel", "blur"]) {
    $("level").addEventListener(ev, () => {
      levelDragging = false;
      renderStatus();
    });
  }

  // 演奏データ: 一覧と、演奏の長さの予定
  $("performance-refresh").addEventListener("click", () => void refreshPerformances());
  $("plan-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = $<HTMLInputElement>("plan-minutes").value.trim();
    const minutes = Number(text);
    void run("performance.set_plan", { duration_seconds: text === "" || !(minutes > 0) ? null : minutes * 60 });
  });
  // エージェントの演奏: 止める、指示を送る
  $("score-stop").addEventListener("click", () => void run("score.stop"));
  $("prompt-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = $<HTMLInputElement>("prompt-text");
    const text = input.value.trim();
    if (!text) return;
    void run("prompt.send", { text }).then((r) => {
      if (r.ok) input.value = "";
    });
  });

  // MIDI 機器。非対応のブラウザでは、その旨を出してボタンを無効にする
  $("midi-connect").addEventListener("click", () => void midi.connect());
  if (!MidiLink.supported()) void midi.connect(); // 「非対応」の状態にする(許可は尋ねない)
  else renderMidi(midi.current);

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
