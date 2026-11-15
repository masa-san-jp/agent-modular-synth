// 最小の画面。音声は「音声開始」を押したときにだけ始める(product-spec §3.3)。
import { DEMO_PATCH } from "../audio/core.js";
import type { CoreStatus } from "../audio/core.js";
import type { FromWorklet, ToWorklet } from "../audio/messages.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
let lastStatus: (CoreStatus & { peak: number }) | null = null;

// 自動試験と状態確認のために公開する(読み取り専用の情報)
const debug = {
  get contextState(): string {
    return ctx ? ctx.state : "none";
  },
  get status() {
    return lastStatus;
  },
  errors: [] as string[],
};
(window as unknown as { __synth: typeof debug }).__synth = debug;

function send(msg: ToWorklet): void {
  node?.port.postMessage(msg);
}

function showState(): void {
  const s = lastStatus;
  $("state").textContent = !ctx
    ? "停止中(音声は始まっていません)"
    : s?.panic
      ? "緊急停止中(音は出ません)"
      : ctx.state === "running"
        ? "動作中"
        : `中断中(${ctx.state})`;
  if (s) {
    $("meter").textContent =
      `出力ピーク ${s.peak.toFixed(3)} / 音量 ${s.levelDb.toFixed(1)} dB / リミッター利得 ${s.limiterGain.toFixed(3)}` +
      ` / サンプルレート ${s.fs} Hz / 非有限値 ${s.nonfiniteCount + s.moduleNonfiniteCount} / 最終クリップ ${s.clipCount}`;
  }
}

async function startAudio(): Promise<void> {
  try {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" }); // 既定で 48000 Hz を要求し、得られた値を使う(DEC-107)
      await ctx.audioWorklet.addModule("dist/worklet.js");
      node = new AudioWorkletNode(ctx, "synth-processor", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.onmessage = (ev: MessageEvent<FromWorklet>) => {
        const m = ev.data;
        if (m.type === "status") {
          lastStatus = { ...m.status, peak: m.peak };
          syncLevel(m.status.levelDb);
          showState();
        } else if (m.type === "error") {
          debug.errors.push(m.message);
          $("error").textContent = m.message;
        }
      };
      node.connect(ctx.destination);
      send({ type: "load", patch: DEMO_PATCH });
      applyPitch();
    }
    if (ctx.state !== "running") await ctx.resume();
    send({ type: "start" });
    $<HTMLButtonElement>("start").disabled = true;
    for (const id of ["note", "panic", "release", "level", "pitch", "wave"]) $<HTMLInputElement>(id).disabled = false;
    showState();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    debug.errors.push(msg);
    $("error").textContent = `音声を開始できませんでした: ${msg}`;
  }
}

function applyPitch(): void {
  const semis = Number($<HTMLInputElement>("pitch").value);
  send({ type: "param", module: "pitch", name: "offset", value: semis / 12 }); // 1 V/oct(COM-03)
  $("pitchLabel").textContent = `${semis >= 0 ? "+" : ""}${semis} 半音(C4 基準)`;
}

/** 人がスライダーを動かしたときだけ音量を送る(音量を上げられるのは人の操作だけ: DEC-111)。 */
function applyLevel(): void {
  const db = Number($<HTMLInputElement>("level").value);
  send({ type: "level", db, actor: "human" });
  $("levelLabel").textContent = `${db} dB`;
}

/** 音量が引き下げられたとき(パッチの読込、緊急停止の解除など)、スライダーを実際の値に合わせる。 */
function syncLevel(db: number): void {
  const el = $<HTMLInputElement>("level");
  if (document.activeElement === el) return; // 操作中は触らない
  if (Number(el.value) !== db) el.value = String(db);
  $("levelLabel").textContent = `${db} dB`;
}

function gate(on: boolean): void {
  send({ type: "param", module: "gate", name: "offset", value: on ? 10 : 0 }); // ゲート high = 10 V(COM-04)
}

window.addEventListener("DOMContentLoaded", () => {
  $("start").addEventListener("click", () => void startAudio());
  const note = $<HTMLButtonElement>("note");
  note.addEventListener("pointerdown", () => gate(true));
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) note.addEventListener(ev, () => gate(false));
  $("panic").addEventListener("click", () => {
    send({ type: "panic" });
    gate(false);
  });
  $("release").addEventListener("click", () => send({ type: "release_panic" }));
  $("pitch").addEventListener("input", applyPitch);
  $("level").addEventListener("input", applyLevel);
  $<HTMLSelectElement>("wave").addEventListener("change", () => {
    // 波形の切替はケーブルの付け替えに当たる。パッチ編集は未実装なので、パッチ全体を読み込み直す。
    const wave = $<HTMLSelectElement>("wave").value;
    const patch = structuredClone(DEMO_PATCH);
    patch.cables = patch.cables.map((c) => (c.from[0] === "vco" ? { from: ["vco", wave], to: c.to } : c));
    send({ type: "load", patch }); // 読込で音量は min(現在値, 既定値) に下がる。ここで音量を送り直さない
    applyPitch();
  });
  showState();
});
