// パッチの編集画面(Issue #22)。素の DOM。
// 画面は状態を直接書き換えない: 操作はすべて共通コマンド(deps.run / deps.send)で送り、
// 表示は通知とコマンドの応答の後に、Session のパッチから描き直す(operation-contract §1)。
import { valueLabel } from "../view/labels.js";
import type { ParamInfo, TypeCatalog, TypeInfo } from "../control/catalog.js";
import type { ControllerEvent } from "../control/controller.js";
import type { ActorInfo, Change, CommandResponse, HistoryFlags, Patch, PatchModule } from "../control/types.js";

export interface EditorDeps {
  catalog: TypeCatalog;
  getPatch(): Patch;
  getHistory(): HistoryFlags;
  /** コマンドを送り、失敗なら画面にエラーを表示し、描き直す(main.ts の run)。 */
  run(command: string, args?: Record<string, unknown>): Promise<CommandResponse>;
  /** コマンドを送るだけ(エラー表示は呼び出し側で行う)。 */
  send(command: string, args?: Record<string, unknown>): Promise<CommandResponse>;
  showError(text: string, detail?: string): void;
  showNotice(text: string, detail?: string): void;
}

export interface Editor {
  /** パッチの表示を現在の状態に合わせる。force のときは編集中の入力欄も実際の値に戻す。 */
  render(force?: boolean): void;
  /** 通知を変更の履歴に記録する。 */
  onEvent(ev: ControllerEvent): void;
  /** 保存済みパッチの一覧を取り直す。 */
  refreshLibrary(): void;
  /** メーター(MOD-IO-003)の読出し値を表示する。 */
  renderMeters(meters: Record<string, Record<string, unknown>> | null): void;
  /** 楽譜が動かしているパラメータの、音声側のいまの値を表示する(ラックの板と同じ値。DEC-029)。止まれば、パッチの値に戻す。 */
  renderLive(overrides: Readonly<Record<string, Readonly<Record<string, number>>>>): void;
}

const OUTPUT_TYPE = "MOD-IO-001"; // 常設の出力(追加・削除不可: 契約 §2.2)
const FOLD_PARAMS = 8; // これより多いパラメータは折りたたむ
const HISTORY_MAX = 10;
const PATCH_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** 機能分類(仕様のフロントマター category)の表示名。 */
const CATEGORY_LABEL: Record<string, string> = {
  oscillator: "OSC",
  noise: "NOISE",
  filter: "FILTER",
  waveshaper: "SHAPER",
  amplifier: "AMP / MIX",
  modulation: "ENV / LFO",
  clock_sequencer: "CLOCK / SEQ",
  random_logic: "RANDOM / LOGIC",
  time_effect: "TIME FX",
  utility: "UTILITY",
  io_utility: "IO / METER",
};

const COMMAND_LABEL: Record<string, string> = {
  "module.add": "モジュール追加",
  "module.remove": "モジュール削除",
  "module.move": "モジュール移動",
  "cable.connect": "接続",
  "cable.disconnect": "切断",
  "param.set": "パラメータ変更",
  batch: "まとめて適用",
  "patch.new": "新規パッチ",
  "patch.load": "パッチ読込",
  "patch.set_meta": "題名・説明の変更",
  "history.undo": "取り消し",
  "history.redo": "やり直し",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** スライダーと数値欄の刻み(範囲のおよそ 1/1000 を 10 の累乗に丸める。BPM 20〜1000 は 0.1 刻み: DEC-011)。 */
function floatStep(p: ParamInfo): number {
  const range = p.max - p.min;
  if (!(range > 0)) return 1;
  return Math.pow(10, Math.floor(Math.log10(range / 1000) + 1e-9));
}

function decimalsOf(step: number): number {
  return Math.max(0, Math.round(-Math.log10(step)));
}

function formatValue(p: ParamInfo, v: number): string {
  if (p.kind !== "float") return String(v);
  if (p.unit === "BPM") return v.toFixed(1); // BPM は 0.1 刻みで表示(DEC-011)
  return String(Number(v.toPrecision(7)));
}

function actorLabel(a: ActorInfo | null): string {
  if (!a) return "APP";
  return a.kind === "agent" ? "AGENT" : "HUMAN";
}

function describeChange(c: Change): string {
  switch (c.kind) {
    case "module_added":
      return `+ ${c.module.id} ${c.module.type}`;
    case "module_removed":
      return `− ${c.module_id}`;
    case "cable_added":
      return `${c.cable.from.module}.${c.cable.from.port} → ${c.cable.to.module}.${c.cable.to.port}`;
    case "cable_removed":
      return `− ${c.cable_id}`;
    case "param_changed":
      return `${c.module_id}.${c.param} = ${Number(c.value.toPrecision(7))}`;
    case "module_moved":
      return `${c.module_id} moved`;
    case "meta_changed":
      return "meta";
    case "patch_replaced":
      return "patch replaced";
  }
}

interface ParamControl {
  info: ParamInfo;
  number?: HTMLInputElement;
  range?: HTMLInputElement;
  /** 列挙型の選択肢。 */
  select?: HTMLSelectElement;
  check?: HTMLInputElement;
}

interface Card {
  type: string;
  root: HTMLElement;
  controls: ParamControl[];
  readout: HTMLElement | null;
}

interface LogEntry {
  actor: ActorInfo | null;
  text: string;
  mergeKey: string | null;
}

export function createEditor(deps: EditorDeps): Editor {
  const { catalog } = deps;
  const moduleList = byId("module-list");
  const cableList = byId("cable-list");
  const addType = byId<HTMLSelectElement>("add-type");
  const addId = byId<HTMLInputElement>("add-id");
  const addButton = byId<HTMLButtonElement>("add-module");
  const cableFrom = byId<HTMLSelectElement>("cable-from");
  const cableTo = byId<HTMLSelectElement>("cable-to");
  const cableConnect = byId<HTMLButtonElement>("cable-connect");
  const saveName = byId<HTMLInputElement>("save-name");
  const saveButton = byId<HTMLButtonElement>("save");
  const library = byId("library");
  const libraryState = byId("library-state");
  const historyList = byId("history");
  const confirmBox = byId("confirm");
  const confirmText = byId("confirm-text");
  const confirmOk = byId<HTMLButtonElement>("confirm-ok");
  const confirmCancel = byId<HTMLButtonElement>("confirm-cancel");

  const cards = new Map<string, Card>();
  /** 楽譜が動かしている値(DEC-029): モジュールID → いま音声側の値を出しているパラメータ名。 */
  const liveShown = new Map<string, Set<string>>();
  const log: LogEntry[] = [];
  let dragging: HTMLInputElement | null = null;
  let dragKey: string | null = null;
  let dragSeq = 0;
  let portsSignature = "";
  let cablesSignature: string | null = null;

  // ---- 確認(上書き・削除) ----
  let confirmAction: (() => void) | null = null;
  function ask(message: string, okLabel: string, action: () => void): void {
    confirmText.textContent = message;
    confirmOk.textContent = okLabel;
    confirmAction = action;
    confirmBox.hidden = false;
    confirmOk.focus();
  }
  function closeConfirm(): void {
    confirmAction = null;
    confirmBox.hidden = true;
  }
  confirmOk.addEventListener("click", () => {
    const a = confirmAction;
    closeConfirm();
    a?.();
  });
  confirmCancel.addEventListener("click", closeConfirm);

  // ---- モジュール ----
  function typeTitle(type: string): string {
    return catalog.get(type)?.title ?? type;
  }

  function buildParamRow(moduleId: string, p: ParamInfo, controls: ParamControl[]): HTMLElement {
    const inputId = `p-${moduleId}-${p.name}`;
    const label = el("label", { for: inputId, class: "param-name", ...(p.unit ? { title: p.unit } : {}) }, p.name); // 単位は、マウスを載せると出る(パネルには書かない)
    const row = el("div", { class: "param", "data-param": p.name }, label);
    const set = (value: number, coalesceKey?: string): void => {
      void deps.run("param.set", { module_id: moduleId, param: p.name, value, ...(coalesceKey ? { coalesce_key: coalesceKey } : {}) });
    };
    const control: ParamControl = { info: p };

    if (p.kind === "bool") {
      const check = el("input", { id: inputId, type: "checkbox", "data-param": p.name });
      check.addEventListener("change", () => set(check.checked ? 1 : 0));
      control.check = check;
      row.append(check);
    } else if (p.values && p.values.length > 0) {
      // 列挙型: 選択肢を名前で出す(送るのは数値)
      const select = el("select", { id: inputId, "data-param": p.name });
      for (const v of p.values) select.append(el("option", { value: String(v.value), title: v.label }, valueLabel(v.label)));
      select.addEventListener("change", () => set(Number(select.value)));
      control.select = select;
      row.append(select);
    } else {
      const isFloat = p.kind === "float";
      const step = isFloat ? floatStep(p) : 1;
      if (isFloat) {
        const range = el("input", { type: "range", min: String(p.min), max: String(p.max), step: String(step), "data-param": p.name, "aria-label": `${moduleId} ${p.name}` });
        const digits = decimalsOf(step);
        const endDrag = (): void => {
          if (dragging === range) dragging = null;
          dragKey = null;
        };
        range.addEventListener("pointerdown", () => {
          dragging = range;
          dragKey = `ui-drag-${++dragSeq}`;
        });
        // 動かしている間の変更は同じ coalesce_key で送り、取り消し1回で元に戻るようにする(契約 §9.4)
        range.addEventListener("input", () => {
          if (dragKey === null) dragKey = `ui-drag-${++dragSeq}`;
          const v = Math.min(p.max, Math.max(p.min, Number(Number(range.value).toFixed(digits))));
          set(v, dragKey);
        });
        range.addEventListener("change", endDrag);
        range.addEventListener("pointerup", endDrag);
        range.addEventListener("pointercancel", endDrag);
        range.addEventListener("blur", endDrag);
        control.range = range;
        row.append(range);
      }
      const number = el("input", { id: inputId, type: "number", min: String(p.min), max: String(p.max), step: isFloat ? "any" : "1", "data-param": p.name, title: `${p.min} 〜 ${p.max}${p.unit ? " " + p.unit : ""}` });
      number.addEventListener("change", () => {
        const text = number.value.trim();
        const v = Number(text);
        if (text === "" || !Number.isFinite(v)) {
          deps.showError(`${moduleId}.${p.name} ${p.min}..${p.max}`);
          render(true);
          return;
        }
        number.dataset.shown = number.value; // 入力は確定した(以後の通知で書き換えてよい)
        // 範囲外・整数でない値もそのまま送り、コマンド処理の検証結果(ERR-122/123)を表示する。画面では丸めない
        set(v);
      });
      control.number = number;
      row.append(number);
    }
    controls.push(control);
    return row;
  }

  function buildCard(m: PatchModule, info: TypeInfo | undefined): Card {
    const controls: ParamControl[] = [];
    const head = el("header", {}, el("h3", { title: info?.title ?? "" }, m.id.toUpperCase()), el("span", { class: "type-id" }, m.type)); // 板の印字と同じく、名前だけ(種別の日本語名は、マウスを載せると出る)
    if (m.type === OUTPUT_TYPE) {
      head.append(el("span", { class: "badge", title: "常設のモジュールは削除できません" }, "FIXED"));
    } else {
      const remove = el("button", { type: "button", "data-action": "remove", class: "small danger" }, "DEL");
      remove.addEventListener("click", () => void deps.run("module.remove", { module_id: m.id }));
      head.append(remove);
    }
    const root = el("article", { class: "module", "data-module": m.id, "data-type": m.type }, head);
    let readout: HTMLElement | null = null;
    if (info) {
      const ports = (list: TypeInfo["inputs"]): string => list.filter((p) => p.connectable).map((p) => p.name).join(" ") || "–";
      root.append(el("p", { class: "ports" }, `in ${ports(info.inputs)} / out ${ports(info.outputs)}`));
      if (m.type === "MOD-IO-003" || m.type === "MOD-MIX-002") {
        readout = el("p", { class: "readout" });
        root.append(readout);
      }
      const rows = info.params.map((p) => buildParamRow(m.id, p, controls));
      if (rows.length > FOLD_PARAMS) {
        root.append(el("details", {}, el("summary", {}, `params ${rows.length}`), el("div", { class: "params" }, ...rows)));
      } else if (rows.length > 0) {
        root.append(el("div", { class: "params" }, ...rows));
      }
    }
    return { type: m.type, root, controls, readout };
  }

  function setInput(input: HTMLInputElement, text: string, force: boolean): void {
    // 利用者が入力中(値が最後に表示した値と違う)の欄は、強制でなければ書き換えない
    const editing = document.activeElement === input && input.value !== (input.dataset.shown ?? "");
    if (!force && editing) return;
    if (input.value !== text) input.value = text;
    input.dataset.shown = text;
  }

  function setControl(c: ParamControl, v: number, force: boolean): void {
    if (c.check && c.check.checked !== (v !== 0)) c.check.checked = v !== 0;
    if (c.select && c.select.value !== String(v)) c.select.value = String(v);
    if (c.number) setInput(c.number, formatValue(c.info, v), force);
    if (c.range && (force || dragging !== c.range) && Number(c.range.value) !== v) c.range.value = String(v);
  }

  function syncCard(card: Card, m: PatchModule, force: boolean): void {
    const live = liveShown.get(m.id);
    for (const c of card.controls) {
      const v = m.params[c.info.name];
      if (v === undefined || live?.has(c.info.name)) continue; // 楽譜が動かしている間は、音声側のいまの値を出し続ける
      setControl(c, v, force);
    }
  }

  // ---- 楽譜が動かしている値(DEC-029) ----
  const rowOf = (c: ParamControl): Element | null => (c.range ?? c.number ?? c.select ?? c.check)?.closest(".param") ?? null;
  const controlOf = (id: string, name: string): ParamControl | undefined => cards.get(id)?.controls.find((c) => c.info.name === name);

  function renderLive(overrides: Readonly<Record<string, Readonly<Record<string, number>>>>): void {
    const patch = deps.getPatch();
    // 楽譜が動かすのをやめたパラメータは、パッチの値に戻す
    for (const [id, names] of liveShown) {
      for (const name of [...names]) {
        if (overrides[id]?.[name] !== undefined) continue;
        names.delete(name);
        const c = controlOf(id, name);
        if (!c) continue;
        rowOf(c)?.classList.remove("moving");
        const v = patch.modules.find((m) => m.id === id)?.params[name];
        if (v !== undefined) setControl(c, v, false);
      }
      if (names.size === 0) liveShown.delete(id);
    }
    for (const [id, o] of Object.entries(overrides)) {
      for (const [name, v] of Object.entries(o)) {
        const c = controlOf(id, name);
        if (!c || !Number.isFinite(v)) continue;
        setControl(c, v, false);
        rowOf(c)?.classList.add("moving");
        let names = liveShown.get(id);
        if (!names) liveShown.set(id, (names = new Set()));
        names.add(name);
      }
    }
  }

  function renderModules(patch: Patch, force: boolean): void {
    const wanted = new Map(patch.modules.map((m) => [m.id, m]));
    for (const [id, card] of cards) {
      const m = wanted.get(id);
      if (!m || m.type !== card.type) {
        card.root.remove();
        cards.delete(id);
      }
    }
    let prev: Element | null = null;
    for (const m of patch.modules) {
      let card = cards.get(m.id);
      if (!card) {
        card = buildCard(m, catalog.get(m.type));
        cards.set(m.id, card);
      }
      const expected: Element | null = prev ? prev.nextElementSibling : moduleList.firstElementChild;
      if (expected !== card.root) moduleList.insertBefore(card.root, expected);
      prev = card.root;
      syncCard(card, m, force);
    }
  }

  // ---- ケーブル ----
  function fillPortSelect(select: HTMLSelectElement, patch: Patch, direction: "in" | "out", occupied: Set<string>): void {
    const before = select.value;
    select.replaceChildren();
    for (const m of patch.modules) {
      const info = catalog.get(m.type);
      if (!info) continue;
      const ports = (direction === "out" ? info.outputs : info.inputs).filter((p) => p.connectable); // 接続できないポートは出さない(契約 §13.6)
      if (ports.length === 0) continue;
      const group = el("optgroup", { label: m.id });
      for (const p of ports) {
        const value = `${m.id}.${p.name}`;
        group.append(el("option", { value }, `${value}(${p.type})${occupied.has(value) ? " *" : ""}`));
      }
      select.append(group);
    }
    if (before && [...select.options].some((o) => o.value === before)) select.value = before;
  }

  function portType(patch: Patch, moduleId: string, port: string, direction: "in" | "out"): string {
    const m = patch.modules.find((x) => x.id === moduleId);
    const info = m ? catalog.get(m.type) : undefined;
    return (direction === "out" ? info?.outputs : info?.inputs)?.find((p) => p.name === port)?.type ?? "?";
  }

  function renderCables(patch: Patch): void {
    const occupied = new Set(patch.cables.map((c) => `${c.to.module}.${c.to.port}`));
    const signature = patch.modules.map((m) => `${m.id}:${m.type}`).join(",") + "|" + [...occupied].sort().join(",");
    if (signature !== portsSignature) {
      portsSignature = signature;
      fillPortSelect(cableFrom, patch, "out", new Set());
      fillPortSelect(cableTo, patch, "in", occupied);
    }
    cableConnect.disabled = cableFrom.options.length === 0 || cableTo.options.length === 0;

    // 変わっていなければ作り直さない(押している途中のボタンを差し替えない)
    const cs = patch.cables.map((c) => `${c.id}:${c.from.module}.${c.from.port}>${c.to.module}.${c.to.port}`).join(",") + "|" + signature;
    if (cs === cablesSignature) return;
    cablesSignature = cs;
    cableList.replaceChildren();
    if (patch.cables.length === 0) cableList.append(el("li", { class: "empty" }, "–"));
    for (const c of patch.cables) {
      const ft = portType(patch, c.from.module, c.from.port, "out");
      const tt = portType(patch, c.to.module, c.to.port, "in");
      const disconnect = el("button", { type: "button", "data-action": "disconnect", class: "small" }, "DEL");
      disconnect.addEventListener("click", () => void deps.run("cable.disconnect", { cable_id: c.id }));
      cableList.append(
        el(
          "li",
          { "data-cable": c.id },
          el("code", {}, c.id),
          el("span", { class: "route" }, `${c.from.module}.${c.from.port} → ${c.to.module}.${c.to.port}`),
          el("span", { class: ft === tt ? "types" : "types mismatch" }, ft === tt ? ft : `${ft} ≠ ${tt}`),
          disconnect,
        ),
      );
    }
  }

  function splitPort(value: string): { module: string; port: string } {
    const i = value.indexOf("."); // モジュールIDに「.」は含まれない(契約 §2.2)
    return { module: value.slice(0, i), port: value.slice(i + 1) };
  }

  cableConnect.addEventListener("click", () => {
    if (!cableFrom.value || !cableTo.value) return;
    void deps.run("cable.connect", { from: splitPort(cableFrom.value), to: splitPort(cableTo.value) });
  });

  // ---- モジュールの追加 ----
  // 機能分類ごとにまとめて並べる
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const info of catalog.values()) {
    if (info.type === OUTPUT_TYPE) continue; // 常設の出力は追加できない(ERR-105)
    let group = groups.get(info.category);
    if (!group) {
      group = el("optgroup", { label: CATEGORY_LABEL[info.category] ?? info.category });
      groups.set(info.category, group);
      addType.append(group);
    }
    group.append(el("option", { value: info.type, title: info.title }, info.type.replace(/^MOD-/, "")));
  }
  addButton.addEventListener("click", () => {
    const id = addId.value.trim();
    void deps.run("module.add", { type: addType.value, ...(id ? { id } : {}) }).then((r) => {
      if (r.ok) addId.value = "";
    });
  });

  // ---- 保存・一覧・読込・削除 ----
  const updateSaveButton = (): void => {
    saveButton.disabled = saveName.value.trim() === "";
  };
  saveName.addEventListener("input", updateSaveButton);
  updateSaveButton();

  function reportFailure(r: CommandResponse): void {
    if (!r.ok) deps.showError(`${r.error.id} ${r.error.code}`, r.error.message);
  }

  async function save(name: string, overwrite: boolean): Promise<void> {
    const r = await deps.send("patch.save", { name, ...(overwrite ? { overwrite: true } : {}) });
    if (r.ok) {
      deps.showError("");
      deps.showNotice(`${r.result.overwritten ? "OVERWRITTEN" : "SAVED"} ${name}`);
      refreshLibrary();
    } else if (r.error.id === "ERR-203" && !overwrite) {
      ask(`OVERWRITE ${name} ?`, "OVERWRITE", () => void save(name, true));
    } else {
      reportFailure(r);
    }
    render();
  }

  saveButton.addEventListener("click", () => {
    const name = saveName.value.trim();
    if (!PATCH_NAME.test(name)) {
      // 送っても ERR-201 になる。規則を添えて表示する
      void deps.send("patch.save", { name }).then((r) => {
        if (!r.ok) deps.showError(`${r.error.id} ${r.error.code}`, r.error.message);
      });
      return;
    }
    void save(name, false);
  });
  saveName.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !saveButton.disabled) saveButton.click();
  });

  let libraryToken = 0;
  function refreshLibrary(): void {
    const token = ++libraryToken;
    void deps.send("patch.list").then((r) => {
      if (token !== libraryToken) return;
      library.replaceChildren();
      if (!r.ok) {
        libraryState.textContent = `${r.error.id} ${r.error.code}`;
        return;
      }
      const patches = (r.result.patches ?? []) as { name: string; title?: string; bytes?: number; modified_at?: string; saved_by_kind?: string; readable?: boolean }[];
      libraryState.textContent = String(patches.length);
      for (const p of patches) {
        const load = el("button", { type: "button", "data-action": "load", class: "small" }, "LOAD");
        load.disabled = p.readable === false;
        load.addEventListener("click", () => {
          void deps.run("patch.load", { name: p.name }).then((res) => {
            if (res.ok) deps.showNotice(`LOADED ${p.name}`);
          });
        });
        const remove = el("button", { type: "button", "data-action": "delete", class: "small danger" }, "DEL");
        remove.addEventListener("click", () => {
          ask(`DELETE ${p.name} ?`, "DELETE", () => {
            void deps.run("patch.delete", { name: p.name }).then((res) => {
              if (res.ok) deps.showNotice(`DELETED ${p.name}`);
              refreshLibrary();
            });
          });
        });
        const when = p.modified_at ? new Date(p.modified_at) : null;
        const detail = [
          p.readable === false ? "unreadable" : p.title || "",
          when && !Number.isNaN(when.getTime()) ? when.toLocaleString("ja-JP") : "",
          p.saved_by_kind === "agent" ? "AGENT" : p.saved_by_kind === "human" ? "HUMAN" : "",
        ].filter((s) => s !== "");
        library.append(el("li", { "data-patch": p.name }, el("code", {}, p.name), el("span", { class: "detail" }, detail.join(" / ")), load, remove));
      }
    });
  }
  byId("library-refresh").addEventListener("click", refreshLibrary);
  byId("new").addEventListener("click", () => void deps.run("patch.new"));

  // ---- 変更の履歴(誰が何をしたか) ----
  function pushLog(entry: LogEntry): void {
    const top = log[0];
    if (top && entry.mergeKey !== null && top.mergeKey === entry.mergeKey) log[0] = entry; // スライダーの連続操作は1行にまとめる
    else log.unshift(entry);
    if (log.length > HISTORY_MAX) log.length = HISTORY_MAX;
    historyList.replaceChildren();
    for (const e of log) {
      const kind = e.actor?.kind ?? "app";
      const who = actorLabel(e.actor) + (e.actor?.client_id ? `(${e.actor.client_id})` : "");
      historyList.append(el("li", { "data-actor": kind }, el("span", { class: `actor actor-${kind}` }, who), el("span", { class: "what" }, e.text)));
    }
  }

  function onEvent(ev: ControllerEvent): void {
    if (ev.event === "patch.changed") {
      const d = ev.data;
      const shown = d.changes.slice(0, 3).map(describeChange);
      if (d.changes.length > 3) shown.push(`+${d.changes.length - 3}`);
      const first = d.changes[0];
      const mergeKey = d.command === "param.set" && d.changes.length === 1 && first?.kind === "param_changed" ? `${d.actor.kind}|${d.actor.client_id ?? ""}|${first.module_id}|${first.param}` : null;
      pushLog({ actor: d.actor, text: `r${d.revision} ${d.command}  ${shown.join("  ")}`, mergeKey });
    } else if (ev.event === "output.changed") {
      const d = ev.data;
      const text =
        d.reason === "panic"
          ? "panic"
          : d.reason === "release_panic"
            ? `release  level ${d.level_db} dB`
            : `level ${d.level_db} dB`;
      pushLog({ actor: d.actor, text, mergeKey: d.reason === "set_level" && d.actor ? `${d.actor.kind}|${d.actor.client_id ?? ""}|level` : null });
    } else if (ev.event === "library.changed") {
      pushLog({ actor: ev.data.actor, text: `${ev.data.action === "saved" ? "saved" : "deleted"} ${ev.data.name}`, mergeKey: null });
      refreshLibrary();
    }
  }

  function render(force = false): void {
    const patch = deps.getPatch();
    renderModules(patch, force);
    renderCables(patch);
    const h = deps.getHistory();
    for (const id of ["undo", "panel-undo"]) byId<HTMLButtonElement>(id).disabled = !h.can_undo;
    for (const id of ["redo", "panel-redo"]) byId<HTMLButtonElement>(id).disabled = !h.can_redo;
  }

  function renderMeters(meters: Record<string, Record<string, unknown>> | null): void {
    for (const [id, card] of cards) {
      if (!card.readout) continue;
      const v = meters?.[id];
      const num = (k: string): string => (typeof v?.[k] === "number" ? (v[k] as number).toFixed(3) : "—");
      if (!v) {
        card.readout.textContent = "–";
      } else if (card.type === "MOD-MIX-002") {
        // ミキサー卓: チャンネルごとの音量(dB。±5 V を 0 dB とする)。消えているチャンネルは「消」
        const db = (x: unknown): string => (typeof x === "number" && x > 0 ? (20 * Math.log10(x / 5)).toFixed(0) : "−∞");
        const rms = Array.isArray(v.ch_rms) ? (v.ch_rms as unknown[]) : [];
        const audible = Array.isArray(v.ch_audible) ? (v.ch_audible as unknown[]) : [];
        const out = Array.isArray(v.out_rms) ? (v.out_rms as unknown[]) : [];
        card.readout.textContent =
          `dB ${rms.map((x, i) => `${i + 1}:${audible[i] === 0 ? "×" : db(x)}`).join(" ")} / L ${db(out[0])} R ${db(out[1])}` + ` / lo ${db(v.out_low)} mid ${db(v.out_mid)} hi ${db(v.out_high)}`;
      } else {
        card.readout.textContent = `level ${num("level")} / peak ${num("peak")} / rms ${num("rms")}`;
      }
    }
  }

  return { render, onEvent, refreshLibrary, renderMeters, renderLive };
}
