// 曲の音像を、曲調の目安(demo/styles.mjs)と比べる。曲を卓(MOD-MIX-002)のチャンネルごとに書き出し、
// 大きさ(短期ラウドネスの最大、EBU R128)と明るさ(スペクトル重心、耳に刺さる帯域の割合)を測る。
// 使い方: npm run build && node demo/mixcheck.mjs <曲のファイル>  (ffmpeg が要る。曲は MIX を持つこと)
//   MIX = { style: "ambient", desk: "desk", channels: { 1: "pad", 2: "lead", ... } }
// チャンネルの音は「全体 − そのチャンネルを消した全体」で取り出す(エンジンは毎回同じ計算をするので、引き算で正確に取れる)。
// センドの響きは元のチャンネルの音に含まれる。書き出しは出力の保護が効かない小さな音量(−20 dB)で行う。
// 曲がサウンドチェック(SOUNDCHECK)を持っていれば、実際の演奏と同じく、先に済ませてから書き出す。
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STYLES } from "./styles.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FS = 48000;

// ---- 書き出し(子プロセス: --render <曲> <消すチャンネル(0 = なし)> <出力>) ----
async function render(piecePath, muteCh, outPath) {
  const load = (rel) => import(pathToFileURL(join(root, "dist", "src", rel)).href);
  const { EngineBackend } = await load("control/backend.js");
  const { buildCatalog } = await load("control/catalog.js");
  const { Session } = await load("control/session.js");
  const { REGISTRY } = await load("modules/registry.js");
  const piece = await import(pathToFileURL(piecePath).href);
  const be = new EngineBackend(FS, REGISTRY);
  const s = new Session({ catalog: buildCatalog(REGISTRY), backend: be, sessionId: "mixcheck" });
  let n = 0;
  const send = (actor, command, args) => {
    const r = s.handle({ v: 1, request_id: `m${++n}`, command, ...(args ? { args } : {}) }, actor);
    if (!r.ok) throw new Error(`${command}: ${JSON.stringify(r.error)}`);
    return r.result;
  };
  send("agent", "batch", { ops: piece.PATCH });
  send("human", "engine.start");
  send("human", "output.set_level", { level_db: -20 });
  const chunks = [];
  const L = new Float32Array(128), R = new Float32Array(128);
  let recording = false;
  const run = (sec) => {
    for (let i = 0; i < Math.round((sec * FS) / 128); i++) {
      be.processBlock(L, R);
      if (!recording) continue;
      const c = new Float32Array(256);
      c.set(L, 0);
      c.set(R, 128);
      chunks.push(c);
    }
    s.pollBackend();
  };
  run(0.3);
  // 曲がサウンドチェック(演奏の前に、エージェントが卓のメーターを読んで配分を決める)を持っていれば、先に済ませる。
  // チャンネルを消すのはその後(消したまま配分を決めると、全体の音量が変わり、引き算が合わない)
  if (piece.SOUNDCHECK) {
    const { soundcheck } = await import(pathToFileURL(join(root, "demo", "soundcheck.mjs")).href);
    await soundcheck({ send: async (command, args) => send("agent", command, args), advance: (sec) => run(sec) }, piece.SOUNDCHECK, () => undefined);
    send("agent", "score.stop");
    run(1);
  }
  if (muteCh) send("agent", "param.set", { module_id: piece.MIX.desk ?? "desk", param: `mute[${muteCh}]`, value: 1 });
  recording = true;
  for (let i = 0; i < piece.SECTIONS.length; i++) {
    const r = send("agent", "score.play", piece.SECTIONS[i].score);
    run(r.starts_in);
    const rest = r.remaining - r.starts_in;
    run(i < piece.SECTIONS.length - 1 ? rest - 4 : rest + 4);
  }
  const out = Buffer.alloc(chunks.length * 256 * 4);
  chunks.forEach((c, i) => Buffer.from(c.buffer).copy(out, i * 1024));
  writeFileSync(outPath, out);
}

/** 子プロセスの書き出し(ブロックごとに L 128 + R 128)を、L と R の配列にする。 */
function readRaw(path) {
  const b = readFileSync(path);
  const f = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  const blocks = f.length / 256;
  const L = new Float32Array(blocks * 128), R = new Float32Array(blocks * 128);
  for (let k = 0; k < blocks; k++) {
    L.set(f.subarray(k * 256, k * 256 + 128), k * 128);
    R.set(f.subarray(k * 256 + 128, k * 256 + 256), k * 128);
  }
  return { L, R };
}

function writeWav(path, L, R) {
  const n = L.length, buf = Buffer.alloc(44 + n * 8);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(FS, 24); buf.writeUInt32LE(FS * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { buf.writeFloatLE(L[i], 44 + i * 8); buf.writeFloatLE(R[i], 48 + i * 8); }
  writeFileSync(path, buf);
}

/** 短期ラウドネス(3 秒)の最大 [LUFS]。 */
function loudness(wavPath) {
  let log = "";
  try {
    log = execFileSync("bash", ["-c", `ffmpeg -hide_banner -nostats -i '${wavPath}' -af ebur128 -f null - 2>&1`], { encoding: "utf8", maxBuffer: 1 << 28 });
  } catch (e) {
    log = String(e.stdout ?? "");
  }
  let max = -Infinity;
  for (const m of log.matchAll(/ S: *(-?[\d.]+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

// ---- 明るさ ----
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
/** 重心 [Hz] と、2〜5 kHz のエネルギーの割合(音の大きい所ほど重く数える)。 */
function brightness(L, R, N = 4096) {
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  let sumE = 0, sumFE = 0, pres = 0;
  for (let s = 0; s + N <= L.length; s += N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = ((L[s + i] + R[s + i]) / 2) * win[i];
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * FS) / N, e = re[k] * re[k] + im[k] * im[k];
      sumE += e; sumFE += f * e;
      if (f >= 2000 && f < 5000) pres += e;
    }
  }
  return { centroid: sumE > 0 ? sumFE / sumE : 0, presence: sumE > 0 ? pres / sumE : 0 };
}

async function main() {
  if (process.argv[2] === "--render") return render(process.argv[3], Number(process.argv[4]), process.argv[5]);
  const piecePath = resolve(process.argv[2] ?? "");
  const piece = await import(pathToFileURL(piecePath).href);
  if (!piece.MIX) throw new Error("曲に MIX(曲調と、卓のチャンネルの役割)がない");
  const style = STYLES[piece.MIX.style];
  if (!style) throw new Error(`曲調 ${piece.MIX.style} の目安がない(demo/styles.mjs)`);
  const chans = Object.entries(piece.MIX.channels).map(([ch, role]) => ({ ch: Number(ch), role }));
  const dir = mkdtempSync(join(tmpdir(), "mixcheck-"));
  try {
    // 全体と、チャンネルごとに消した全体を、並列に書き出す(同時に 4 つまで)
    const jobs = [0, ...chans.map((c) => c.ch)];
    const self = fileURLToPath(import.meta.url);
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const ch = jobs[next++];
        await new Promise((ok, ng) => {
          const p = spawn(process.execPath, [self, "--render", piecePath, String(ch), join(dir, `m${ch}.raw`)], { stdio: ["ignore", "ignore", "inherit"] });
          p.on("exit", (code) => (code === 0 ? ok() : ng(new Error(`書き出し(チャンネル ${ch})が失敗`))));
        });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const full = readRaw(join(dir, "m0.raw"));
    const rows = [];
    for (const { ch, role } of chans) {
      const m = readRaw(join(dir, `m${ch}.raw`));
      const L = full.L.map((x, i) => x - m.L[i]), R = full.R.map((x, i) => x - m.R[i]);
      writeWav(join(dir, `ch${ch}.wav`), L, R);
      rows.push({ ch, role, lufs: loudness(join(dir, `ch${ch}.wav`)), ...brightness(L, R) });
    }
    const ref = rows.find((r) => r.role === style.ref);
    if (!ref) throw new Error(`基準の役割 ${style.ref} のチャンネルがない`);
    console.log(`${piece.TITLE ?? piecePath} — 曲調: ${style.label}(基準: ${style.ref} ${ref.lufs.toFixed(1)} LUFS)`);
    console.log("ch 役割      差 [LU]   目安          明るさ [Hz]  目安            2-5kHz");
    let problems = 0;
    for (const r of rows) {
      const t = style.roles[r.role];
      const d = r.lufs - ref.lufs;
      const marks = [];
      if (!t) marks.push(`役割 ${r.role} の目安がない`);
      else {
        if (d < t.lufs[0] - 0.5) marks.push("小さい");
        if (d > t.lufs[1] + 0.5) marks.push("大きい");
        if (r.centroid < t.centroid[0]) marks.push("暗い");
        if (r.centroid > t.centroid[1]) marks.push("明るすぎる");
        if (t.presenceMax !== undefined && r.presence > t.presenceMax) marks.push("耳に刺さる");
      }
      problems += marks.length;
      const range = t ? `${t.lufs[0]}〜${t.lufs[1]}` : "-";
      const crange = t ? `${t.centroid[0]}〜${t.centroid[1]}` : "-";
      console.log(`${String(r.ch).padStart(2)} ${r.role.padEnd(8)} ${d.toFixed(1).padStart(6)}   ${range.padEnd(12)}  ${String(Math.round(r.centroid)).padStart(6)}      ${crange.padEnd(14)} ${(r.presence * 100).toFixed(1).padStart(5)}%  ${marks.length ? "← " + marks.join("、") : "ok"}`);
    }
    console.log(problems ? `目安から外れた所: ${problems}` : "すべて目安の範囲");
    process.exitCode = problems ? 1 : 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
