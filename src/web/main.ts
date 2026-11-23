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
      for (const w of this.waiting.values()) w({ ok: false, error: "failed", message: "サーバーとの接続が切れた" });
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
const controller = new Controller({ session, store: link, now: () => new Date() });

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
    box.textContent = reason;
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
    showError(`${msg}(このままタブを閉じると、作業中のパッチが失われます。「保存」でファイルに保存してください)`);
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
window.addEventListener("pagehide", flushAutosave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushAutosave();
});

const recentEvents: unknown[] = [];
controller.subscribe((ev) => {
  recentEvents.push(ev);
  if (recentEvents.length > 200) recentEvents.shift();
  link.send({ t: "evt", event: ev });
  if ((ev as { event?: string }).event === "patch.changed" || (ev as { type?: string }).type === "patch.changed") scheduleAutosave();
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
  showError(`${reason}。音声を止めました。「音声開始」でやり直せます。`);
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
        renderStatus();
      } else if (m.type === "error") {
        debug.errors.push(m.message);
        showError(m.message);
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
    showError(`音声を開始できませんでした: ${msg}`);
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
      ? "未接続(「MIDI を接続」を押すと、ブラウザが許可を尋ねます)"
      : state.kind === "unsupported"
        ? "このブラウザは MIDI 機器の接続(Web MIDI)に対応していません。画面鍵盤は使えます"
        : state.kind === "denied"
          ? `MIDI を使えません(許可されなかった、または取得に失敗: ${state.reason})`
          : state.inputs.length === 0
            ? "MIDI は使えます。入力機器がつながっていません(つなぐと自動で使えます)"
            : `MIDI 入力: ${state.inputs.join("、")}`;
}

function showError(text: string): void {
  $("error").textContent = text;
}
function showNotice(text: string): void {
  $("notice").textContent = text;
}

/** 人の操作を送り、結果を画面に出す。失敗したらエラーID・コード・メッセージを表示し、入力欄を実際の値に戻す。 */
async function run(command: string, args?: Record<string, unknown>): Promise<CommandResponse> {
  const r = await human(command, args);
  showError(r.ok ? "" : `${r.error.id} ${r.error.code}: ${r.error.message}`);
  // 成功時の注意(型違いの接続など。状態は変わっている: 契約 §3.2)
  showNotice(r.ok ? r.warnings.map((w) => `注意(${w.code}): ${w.message}`).join(" / ") : "");
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
      ? "停止中(音声は始まっていません。「音声開始」を押すと始まります)"
      : st.panic
        ? "緊急停止中(音は出ません)"
        : st.audioState === "running"
          ? "動作中"
          : "中断中(「音声開始」で再開します)";
  const patch = session.getPatch();
  $("patch").textContent =
    `リビジョン ${session.revision} / モジュール ${patch.modules.length} / ケーブル ${patch.cables.length}` +
    ` / サーバー ${link.accepted ? "接続中" : link.rejectedReason === "another_tab" ? "別のタブが使用中" : "未接続"}`;
  $("meter").textContent = w
    ? `出力ピーク ${w.peak.toFixed(3)} / リミッター利得 ${w.limiterGain.toFixed(3)}` +
      ` / サンプルレート ${w.fs} Hz / 非有限値 ${w.nonfiniteModules + w.nonfiniteOutputStage} / 最終クリップ ${w.clipCount}`
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
  $("levelLabel").textContent = `${st.levelDb} dB(エージェントが設定できる上限 ${st.agentMaxLevelDb} dB)`;
  renderPerformance();
  $<HTMLButtonElement>("start").disabled = st.audioState === "running";
  $<HTMLButtonElement>("release").disabled = !st.panic;
  editor?.renderMeters(st.audioState === "running" && w ? w.meters : null);
}

/** エージェントの演奏(予約済みの楽譜と、人からの指示)の表示。 */
let shownPrompts = "";
function renderPerformance(): void {
  const p = session.performance;
  $("perf-state").textContent = p.playing
    ? `演奏中(予約 ${p.scores.length} 件、残り ${p.remaining.toFixed(1)} 秒)`
    : "演奏していません(エージェントが楽譜を送ると始まります)";
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
    li.textContent = `${q.acked ? "反映済み" : "未反映"}: ${q.text}`;
    list.appendChild(li);
  }
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
  if (autosaveProblem !== null) showNotice(autosaveProblem);

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
  $("level").addEventListener("pointerdown", () => {
    levelDragging = true;
  });
  for (const ev of ["pointerup", "pointercancel", "blur"]) {
    $("level").addEventListener(ev, () => {
      levelDragging = false;
      renderStatus();
    });
  }

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
