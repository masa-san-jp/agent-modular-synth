// 手元の LLM に演奏させるプログラム(agents/local-llm。Issue #55、DEC-027)の試験。LLM とシンセは試験用の偽物。
import assert from "node:assert/strict";
import { test } from "node:test";
import { clip, contextBudget, createLlmClient, END_MARK, parseArgs, readStatus, run, runToolCall, toolSpecs, trimHistory, wakeReason } from "../agents/local-llm/runner.js";
import type { ChatMessage, ChatReply, CommandSender, LlmClient, PerfStatus, ToolSpec } from "../agents/local-llm/runner.js";
import { TOOLS } from "../src/mcp/tools.js";
import { englishizeResponse, hasJapanese, moduleCatalogText, TOOL_TEXT_EN } from "../agents/local-llm/english.js";
import { buildCatalog } from "../src/control/catalog.js";
import { REGISTRY } from "../src/modules/registry.js";
import { firstUserMessage, moduleCatalog, systemPrompt, wakeMessage } from "../agents/local-llm/runner.js";
import { detectStyle, STYLE_HINTS } from "../agents/local-llm/style-hints.js";

type Obj = Record<string, any>;

/** fetch の偽物: 送られた要求を記録し、決めた応答を返す。 */
function fakeFetch(reply: Obj) {
  const sent: { url: string; headers: Record<string, string>; body: Obj }[] = [];
  const f = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) as Obj });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, sent };
}

const HISTORY: ChatMessage[] = [
  { role: "system", content: "s" },
  { role: "user", content: "u" },
  { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "patch_get", arguments: { a: 1 } }] },
  { role: "tool", content: "{\"ok\":true}", toolCallId: "c1", toolName: "patch_get" },
];
const SPECS: ToolSpec[] = toolSpecs("full").slice(0, 2);

test("LLM の口(Ollama): 会話・ツール・文脈長を Ollama の形で送り、ツール呼出しを読む", async () => {
  const { f, sent } = fakeFetch({ message: { role: "assistant", content: "鳴らす", tool_calls: [{ function: { name: "score_play", arguments: { notes: [] } } }] } });
  const c = createLlmClient({ api: "ollama", baseUrl: "http://127.0.0.1:11434/", model: "gpt-oss:20b", numCtx: 16384, fetchImpl: f });
  const r = await c.chat(HISTORY, SPECS);
  assert.equal(sent[0]!.url, "http://127.0.0.1:11434/api/chat");
  const b = sent[0]!.body;
  assert.equal(b.model, "gpt-oss:20b");
  assert.equal(b.stream, false);
  assert.equal(b.options.num_ctx, 16384);
  assert.deepEqual(b.messages[2].tool_calls, [{ function: { name: "patch_get", arguments: { a: 1 } } }], "引数はオブジェクトのまま");
  assert.deepEqual(b.messages[3], { role: "tool", content: "{\"ok\":true}", tool_name: "patch_get" });
  assert.equal(b.tools[0].type, "function");
  assert.equal(b.tools[0].function.name, SPECS[0]!.name);
  assert.equal(r.content, "鳴らす");
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.toolCalls[0]!.name, "score_play");
  assert.ok(r.toolCalls[0]!.id.length > 0, "id のない呼出しにも id を付ける");
});

test("LLM の口(OpenAI 互換): 引数は JSON の文字列、結果は tool_call_id で返す。鍵があれば Authorization を付ける", async () => {
  const { f, sent } = fakeFetch({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "x9", type: "function", function: { name: "patch_get", arguments: "{}" } }] } }] });
  const c = createLlmClient({ api: "openai", baseUrl: "http://127.0.0.1:1234/v1", model: "m", apiKey: "k", fetchImpl: f });
  const r = await c.chat(HISTORY, SPECS);
  assert.equal(sent[0]!.url, "http://127.0.0.1:1234/v1/chat/completions");
  assert.equal(sent[0]!.headers.Authorization, "Bearer k");
  const b = sent[0]!.body;
  assert.deepEqual(b.messages[2].tool_calls, [{ id: "c1", type: "function", function: { name: "patch_get", arguments: "{\"a\":1}" } }]);
  assert.deepEqual(b.messages[3], { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" });
  assert.equal(b.tool_choice, "auto");
  assert.equal(r.content, "");
  assert.deepEqual(r.toolCalls, [{ id: "x9", name: "patch_get", arguments: "{}" }]);
});

test("LLM の口: HTTP の失敗と、JSON でない応答は、理由つきの例外になる", async () => {
  const bad = (async () => new Response("model not found", { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(createLlmClient({ api: "ollama", baseUrl: "http://127.0.0.1:11434", model: "x", fetchImpl: bad }).chat(HISTORY, SPECS), /HTTP 404: model not found/);
  const notJson = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(createLlmClient({ api: "openai", baseUrl: "http://127.0.0.1:1", model: "x", fetchImpl: notJson }).chat(HISTORY, SPECS), /JSON でない/);
});

test("ツールの一覧は MCP と同じ(人のみのコマンドを含まない)", () => {
  const specs = toolSpecs();
  assert.deepEqual(specs.map((s) => s.name), TOOLS.map((t) => t.name));
  assert.ok(!specs.some((s) => s.name === "engine_start" || s.name === "engine_release_panic" || s.name === "prompt_send"));
  assert.ok(specs.some((s) => s.name === "score_play"));
});

test("ツールの説明を縮める(compact、既定): 封筒の項目と検査だけの項目を除き、範囲と選択肢と引数の説明は残す。full は MCP と同じ", () => {
  const full = toolSpecs("full");
  const compact = toolSpecs();
  assert.deepEqual(compact.map((t) => t.name), full.map((t) => t.name), "ツールは同じ 30 個");
  assert.deepEqual(full.map((t) => t.description), TOOLS.map((t) => t.description));
  const text = JSON.stringify(compact);
  assert.ok(text.length < JSON.stringify(full).length * 0.5, `半分以下になる: ${text.length} / ${JSON.stringify(full).length}`);
  for (const k of ["\"expected_revision\":", "\"idempotency_key\":", "maxItems", "minItems", "minLength", "maxLength", "\"pattern\"", "\"additionalProperties\":false", "共通コマンド", "応答の封筒"]) {
    assert.ok(!text.includes(k), `compact に ${k} がない`);
  }
  const play = compact.find((t) => t.name === "score_play")!;
  const note = (play.parameters as Obj).properties.notes.items.properties.note;
  assert.equal(note.minimum, 0);
  assert.equal(note.maximum, 127, "値の範囲は残す");
  assert.match(note.description, /MIDI note number/, "引数の説明は残す(英語)");
  assert.match(play.description, /remaining/, "使い方の注意は残す");
  assert.deepEqual((play.parameters as Obj).required, ["notes"]);
  const add = compact.find((t) => t.name === "module_add")!;
  assert.ok((add.parameters as Obj).properties.type.enum.includes("MOD-OSC-001"), "選択肢は残す");
  assert.ok((add.parameters as Obj).properties.params.additionalProperties, "additionalProperties の型の指定は残す");
  assert.match(compact.find((t) => t.name === "patch_get")!.description, /Read-only/);
});

test("文脈長から、履歴とツールの結果に使える長さを見積もる。足りなければ知らせる", () => {
  const b16 = contextBudget(16384);
  assert.ok(b16.fixedTokens > 4000 && b16.fixedTokens < 7000, `ツールの説明と指示文: ${b16.fixedTokens}`);
  assert.ok(b16.historyChars > 15000 && b16.historyChars < 20000, `履歴: ${b16.historyChars}`);
  assert.equal(b16.tight, false);
  assert.ok(contextBudget(32768).historyChars > b16.historyChars * 2);
  assert.ok(contextBudget(16384, "full").historyChars < b16.historyChars, "full は説明が長い分、履歴が短い");
  const small = contextBudget(8192);
  assert.equal(small.tight, true);
  assert.equal(small.historyChars, 4000, "下限");
  assert.ok(b16.toolResultChars <= 6000);
});

test("LLM とのやりとりは英語: ツールの説明・指示文・一覧表・起こす知らせ・誤りの知らせに日本語がない。訳は余らない", async () => {
  const text = JSON.stringify(toolSpecs());
  const ja = [...text.matchAll(/"description":"([^"]*)"/g)].map((m) => m[1]!).filter(hasJapanese);
  assert.deepEqual(ja, [], "訳のない説明(english.ts の TOOL_TEXT_EN に足す)");
  assert.ok(!hasJapanese(text));
  assert.ok(!hasJapanese(systemPrompt()), "指示文");
  for (const st of Object.keys(STYLE_HINTS) as (keyof typeof STYLE_HINTS)[]) assert.ok(!hasJapanese(systemPrompt(st)), `指示文(${st})`);
  assert.ok(!hasJapanese(moduleCatalog()), "一覧表(単位・選択肢の名前の訳が足りなければ english.ts に足す)");
  const st = { audioState: "running", playing: true, remaining: 3, unackedPrompts: [], plan: null };
  for (const r of ["remaining_low", "new_prompt", "audio_started", "stopped"] as const) assert.ok(!hasJapanese(wakeMessage(r, st)));
  assert.ok(!hasJapanese(firstUserMessage("goal", st)));
  // 使われない訳がない(MCP 側のツールや引数が消えたら、訳も消す)
  const used = new Set<string>();
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, path));
    if (typeof v !== "object" || v === null) return;
    for (const [k, x] of Object.entries(v as Obj)) {
      if (k === "properties") for (const [pk, pv] of Object.entries(x as Obj)) { used.add(`${path}.properties.${pk}`); walk(pv, `${path}.properties.${pk}`); }
      else walk(x, k === "items" ? `${path}.items` : path);
    }
  };
  for (const t of toolSpecs()) { used.add(t.name); walk(t.parameters, t.name); }
  assert.deepEqual(Object.keys(TOOL_TEXT_EN).filter((k) => !used.has(k)), [], "使われない訳");
  // 誤りの知らせ(プログラム自身が作るもの)
  const send: CommandSender = async () => ({ ok: true, result: {} });
  assert.ok(!hasJapanese((await runToolCall({ id: "1", name: "nope", arguments: {} }, send, 99999)).text));
  assert.ok(!hasJapanese((await runToolCall({ id: "2", name: "patch_get", arguments: "{" }, send, 99999)).text));
  assert.ok(!hasJapanese(clip("x".repeat(20), 5)));
});

test("シンセの応答の英語化: エラーと注意の日本語の message を code ごとの英語に置き換える。人が書いた中身は変えない", () => {
  const res = {
    ok: false,
    error: { id: "ERR-131", code: "batch_failed", message: "batch の操作が失敗", details: { failed_index: 2, cause: { id: "ERR-111", code: "port_not_found", message: "ポートがない", details: { port: "x" } } } },
    warnings: [{ code: "no_midi_module", message: "MIDI-CV がない" }, { code: "something_new", message: "新しい注意" }],
    result: { prompts: [{ id: 1, text: "もっと高い音で", acked: false }] },
  };
  const en = englishizeResponse(res) as Obj;
  assert.match(en.error.message, /operation in the batch failed/);
  assert.match(en.error.details.cause.message, /no port/);
  assert.equal(en.error.details.cause.details.port, "x");
  assert.match(en.warnings[0].message, /no MIDI-CV/);
  assert.equal(en.warnings[1].message, undefined, "訳のない日本語の文は外す(code は残る)");
  assert.equal(en.warnings[1].code, "something_new");
  assert.equal(en.result.prompts[0].text, "もっと高い音で", "人が書いた指示は変えない");
  assert.equal(res.error.message, "batch の操作が失敗", "元の応答は変えない");
});

test("シンセの応答の英語化: 種別の一覧(module.list_types)の名前・単位・選択肢の名前を英語にする。全種別で日本語が残らない", () => {
  const types = [...buildCatalog(REGISTRY).values()].map((t) => ({
    type: t.type,
    title: t.title,
    inputs: t.inputs.map((p) => ({ name: p.name, unit: p.unit })),
    outputs: t.outputs.map((p) => ({ name: p.name, unit: p.unit })),
    params: t.params.map((p) => ({ name: p.name, ...(p.unit !== undefined ? { unit: p.unit } : {}), ...(p.values ? { values: p.values } : {}) })),
  }));
  const en = JSON.stringify(englishizeResponse({ ok: true, result: { types } }));
  const left = en.match(/[^"]{0,30}[\u3040-\u30ff\u3400-\u9fff][^"]{0,30}/g);
  assert.equal(left, null, `訳の足りない語(english.ts に足す): ${left?.join(" | ")}`);
  assert.match(en, /"title":"VCO"/);
});

test("モジュールの一覧表: 全種別を 1 行ずつ、つなげる端子と、パラメータの範囲・既定値を英語で載せる。番号つきのパラメータはまとめる", () => {
  const catalog = buildCatalog(REGISTRY);
  const text = moduleCatalogText(catalog);
  const lines = text.split("\n");
  assert.equal(lines.length, catalog.size);
  for (const t of catalog.values()) assert.ok(lines.some((l) => l.startsWith(`${t.type} `)), t.type);
  const vco = lines.find((l) => l.startsWith("MOD-OSC-001"))!;
  assert.match(vco, /in: pitch,fm,pwm,sync \| out: saw,pulse,tri,sine/);
  assert.match(vco, /tune -1\.\.1 def 0 oct/);
  const midi = lines.find((l) => l.startsWith("MOD-IO-002"))!;
  assert.match(midi, /in: - \| out: PITCH,GATE/, "MIDI の入力(つなげない)は載せない");
  assert.match(lines.find((l) => l.startsWith("MOD-MIX-002"))!, /level\[1\.\.8\] 0\.\.1 def 0\.7/);
  assert.match(lines.find((l) => l.startsWith("MOD-SAT-001"))!, /mode \{0=soft,1=hard,2=fold\}/);
  assert.ok(!hasJapanese(text));
});

test("曲調の音作りの目安: 目標の文から曲調を読み取り、指示文に足す。分からなければ共通の目安だけ", () => {
  assert.equal(detectStyle("静かなアンビエントを 3 分"), "ambient");
  assert.equal(detectStyle("dark ambient drone"), "ambient");
  assert.equal(detectStyle("ファミコン風の明るい曲"), "chiptune");
  assert.equal(detectStyle("8-bit boss battle"), "chiptune");
  assert.equal(detectStyle("Vaporwave at 3am"), "vaporwave");
  assert.equal(detectStyle("ミニマルな反復"), "minimal");
  assert.equal(detectStyle("暗いテクノ"), "techno");
  assert.equal(detectStyle("自由に"), null);
  const amb = systemPrompt("ambient");
  assert.match(amb, /# Sound design/);
  assert.match(amb, /# Style: ambient/);
  assert.match(amb, /within about one octave above the pad/);
  const none = systemPrompt(null);
  assert.match(none, /# Sound design/, "共通の目安はいつも入る");
  assert.ok(!/# Style:/.test(none));
  assert.match(systemPrompt("chiptune"), /MOD-RND-001/, "チップチューンは粗さの作り方を含む");
});

test("引数の読み方と、ツール呼出しの実行(未知のツール、読めない引数、封筒の項目、長い結果の切り詰め)", async () => {
  assert.deepEqual(parseArgs("{\"a\":1}").value, { a: 1 });
  assert.deepEqual(parseArgs(undefined).value, {});
  assert.equal(parseArgs("[1]").value, null);
  assert.equal(parseArgs("{").value, null);
  const calls: Obj[] = [];
  const send: CommandSender = async (command, args, envelope) => {
    calls.push({ command, args, envelope });
    return { ok: true, result: { big: "x".repeat(500) } };
  };
  const unknown = await runToolCall({ id: "1", name: "engine_start", arguments: {} }, send, 1000);
  assert.equal(unknown.ok, false);
  assert.match(unknown.text, /unknown_tool/);
  const badArgs = await runToolCall({ id: "2", name: "patch_get", arguments: "{" }, send, 1000);
  assert.match(badArgs.text, /bad_arguments/);
  assert.equal(calls.length, 0, "誤った呼出しはシンセへ送らない");
  const r = await runToolCall({ id: "3", name: "param_set", arguments: { module_id: "v", param: "tune", value: 0, expected_revision: 3, idempotency_key: "k" } }, send, 100);
  assert.deepEqual(calls[0], { command: "param.set", args: { module_id: "v", param: "tune", value: 0 }, envelope: { expected_revision: 3, idempotency_key: "k" } });
  assert.equal(r.ok, true);
  assert.ok(r.text.length < 220 && r.text.includes("omitted"), "長い結果は切る");
  assert.equal(clip("abc", 5), "abc");
});

test("履歴を短く保つ: 先頭の指示と目標は残し、新しい方から残す。ツールの結果だけが残らない", () => {
  const msgs: ChatMessage[] = [{ role: "system", content: "S" }, { role: "user", content: "G" }];
  for (let i = 0; i < 20; i++) {
    msgs.push({ role: "assistant", content: "", toolCalls: [{ id: `c${i}`, name: "patch_get", arguments: {} }] });
    msgs.push({ role: "tool", content: "r".repeat(100), toolCallId: `c${i}` });
  }
  const t = trimHistory(msgs, 2, 600);
  assert.equal(t[0]!.content, "S");
  assert.equal(t[1]!.content, "G");
  assert.ok(t.length < msgs.length);
  assert.notEqual(t[2]!.role, "tool", "切れ目はツールの結果にならない");
  assert.equal(t.at(-1), msgs.at(-1), "最新は残る");
  assert.equal(trimHistory(msgs, 2, 1e9).length, msgs.length, "上限に収まれば切らない");
});

const ST = (o: Partial<PerfStatus>): PerfStatus => ({ audioState: "running", playing: true, remaining: 20, unackedPrompts: [], plan: null, ...o });
const PREV = () => ({ audioRunning: true, seenPromptIds: new Set<number>(), ended: false, wokeWhileIdle: false });

test("モデルを起こす時機: 音声の開始、残りが少ない、新しい指示、止まった。音声が止まっている間は起こさない", () => {
  assert.equal(wakeReason(ST({ audioState: "stopped" }), PREV(), 8), null);
  assert.equal(wakeReason(ST({}), { ...PREV(), audioRunning: false }, 8), "audio_started");
  assert.equal(wakeReason(ST({ remaining: 20 }), PREV(), 8), null);
  assert.equal(wakeReason(ST({ remaining: 7.9 }), PREV(), 8), "remaining_low");
  assert.equal(wakeReason(ST({ unackedPrompts: [{ id: 1, text: "高く" }] }), PREV(), 8), "new_prompt");
  const seen = { ...PREV(), seenPromptIds: new Set([1]) };
  assert.equal(wakeReason(ST({ unackedPrompts: [{ id: 1, text: "高く" }] }), seen, 8), null, "見せた指示では起こさない");
  assert.equal(wakeReason(ST({ playing: false, remaining: 0 }), PREV(), 8), "stopped");
  assert.equal(wakeReason(ST({ playing: false, remaining: 0 }), { ...PREV(), wokeWhileIdle: true }, 8), null, "止まっている間に何度も起こさない");
  assert.equal(wakeReason(ST({ remaining: 1 }), { ...PREV(), ended: true }, 8), null, "終わりを宣言した後は、続きを求めない");
  assert.equal(wakeReason(ST({ unackedPrompts: [{ id: 2, text: "x" }] }), { ...PREV(), ended: true }, 8), "new_prompt", "終わった後でも、人の指示では起こす");
  assert.deepEqual(readStatus({ ok: true, audio_state: "running", result: { playing: true, remaining: 3, prompts: [{ id: 1, text: "a", acked: true }, { id: 2, text: "b", acked: false }], plan: { duration_seconds: null, elapsed_seconds: 1 } } }), {
    audioState: "running",
    playing: true,
    remaining: 3,
    unackedPrompts: [{ id: 2, text: "b" }],
    plan: { duration_seconds: null, elapsed_seconds: 1 },
  });
  assert.equal(readStatus({ ok: false }), null);
});

test("全体の流れ: 楽譜を送る → 残りが少なくなったら起こす → 続きを送って終わりを宣言 → 鳴り終わったら終了", async () => {
  // 偽のシンセ: 楽譜の長さを予約に足し、時間が進むと減る
  let remaining = 0;
  const sent: string[] = [];
  const send: CommandSender = async (command, args) => {
    sent.push(command);
    if (command === "score.play") {
      remaining += Number((args as Obj).length ?? 4);
      return { ok: true, audio_state: "running", result: { score_id: sent.length, remaining } };
    }
    if (command === "score.get_status") return { ok: true, audio_state: "running", result: { playing: remaining > 0, remaining, prompts: [], plan: { duration_seconds: null, elapsed_seconds: 0 } } };
    return { ok: true, audio_state: "running", result: {} };
  };
  // 偽の LLM: 決めた順に答える
  const script: ChatReply[] = [
    { content: "", toolCalls: [{ id: "a", name: "patch_get", arguments: {} }] },
    { content: "", toolCalls: [{ id: "b", name: "score_play", arguments: { notes: [{ t: 0, dur: 1, note: 60 }], length: 12 } }] },
    { content: "1 つ目を送った", toolCalls: [] },
    { content: "", toolCalls: [{ id: "c", name: "score_play", arguments: "{\"notes\":[{\"t\":0,\"dur\":1,\"note\":64}],\"length\":6}" }] },
    { content: `続きを送った ${END_MARK}`, toolCalls: [] },
  ];
  const seenByLlm: ChatMessage[][] = [];
  const llm: LlmClient = {
    describe: "fake",
    async chat(messages) {
      seenByLlm.push(messages.map((m) => ({ ...m })));
      const r = script.shift();
      if (!r) throw new Error("台本より多く呼ばれた");
      return r;
    },
  };
  const logs: string[] = [];
  const r = await run({
    llm,
    send,
    goal: "テスト",
    log: (l) => logs.push(l),
    pollMs: 1000,
    leadSeconds: 8,
    sleep: async (ms) => {
      remaining = Math.max(0, remaining - ms / 1000); // 時間を進める
    },
  });
  assert.equal(r.stoppedBy, "end");
  assert.equal(r.ended, true);
  assert.equal(r.toolCalls, 3);
  assert.equal(r.wakes, 2);
  assert.equal(script.length, 0);
  assert.deepEqual(sent.filter((c) => c !== "score.get_status"), ["patch.get", "score.play", "score.play"]);
  const wake = seenByLlm[3]!.at(-1)!;
  assert.equal(wake.role, "user");
  assert.match(wake.content, /queue is running low/);
  assert.ok(seenByLlm[1]!.some((m) => m.role === "tool" && m.toolCallId === "a"), "ツールの結果がモデルに返る");
  assert.ok(logs.some((l) => l.startsWith("[終了]")));
});

test("全体の流れ: 止める合図で止まる。音声が止まっている間は起こさず、動き出したら起こす", async () => {
  let audio = "stopped";
  let polls = 0;
  const send: CommandSender = async (command) => {
    if (command === "score.get_status") {
      polls++;
      if (polls === 4) audio = "running";
      return { ok: true, audio_state: audio, result: { playing: false, remaining: 0, prompts: [] } };
    }
    return { ok: true, audio_state: audio, result: {} };
  };
  const ac = new AbortController();
  let chats = 0;
  const llm: LlmClient = {
    describe: "fake",
    async chat(messages) {
      chats++;
      if (chats === 2) {
        assert.match(messages.at(-1)!.content, /human started audio/);
        ac.abort();
      }
      return { content: "待つ", toolCalls: [] };
    },
  };
  const r = await run({ llm, send, goal: "g", log: () => undefined, sleep: async () => undefined, signal: ac.signal });
  assert.equal(chats, 2, "最初の 1 回と、音声が動き出したときの 1 回");
  assert.equal(r.stoppedBy, "signal");
});
