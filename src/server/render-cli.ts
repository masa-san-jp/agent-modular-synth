// 演奏データを、演奏せずに音声ファイル(WAV)へ書き出すコマンド。サーバーが動いていなくても使える。
// 使い方: npm run render -- <演奏データの名前、またはファイル> [出力.wav] [--level <dB>] [--tail <秒>]
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CommandError } from "../control/errors.js";
import { RENDER_DEFAULTS } from "../control/render.js";
import { renderToFile } from "./render-worker.js";

const argv = process.argv.slice(2);
const opt = (flag: string, fallback: number): number => {
  const i = argv.indexOf(flag);
  if (i < 0) return fallback;
  const v = Number(argv[i + 1]);
  argv.splice(i, 2);
  return v;
};
const levelDb = opt("--level", RENDER_DEFAULTS.levelDb);
const tailSeconds = opt("--tail", RENDER_DEFAULTS.tailSeconds);
const [source, out] = argv;
if (!source || !Number.isFinite(levelDb) || !Number.isFinite(tailSeconds)) {
  console.error("使い方: npm run render -- <演奏データの名前、またはファイル> [出力.wav] [--level <dB>] [--tail <秒>]");
  process.exit(2);
}
const dir = resolve(process.env.SYNTH_PERFORMANCE_DIR ?? join(homedir(), ".agent-modular-synth", "performances"));
const file = existsSync(source) ? resolve(source) : join(dir, `${source}.performance.json`);
if (!existsSync(file)) {
  console.error(`演奏データがない: ${file}`);
  process.exit(1);
}
const outPath = resolve(out ?? file.replace(/(\.performance)?\.json$/, "") + ".wav");
try {
  let shown = -1;
  const { summary, bytes } = await renderToFile({ text: readFileSync(file, "utf8"), options: { levelDb, tailSeconds }, outPath }, (done, total) => {
    const pct = Math.floor((done / total) * 10) * 10;
    if (pct !== shown) process.stderr.write(`\r書き出し中… ${(shown = pct)}%`);
  });
  process.stderr.write("\n");
  console.log(`書き出し: ${outPath}(${summary.seconds.toFixed(1)} 秒、${(bytes / 2 ** 20).toFixed(1)} MiB、楽譜 ${summary.scores} 個、ピーク ${summary.peak.toFixed(3)}、頭打ち ${summary.clip_count} サンプル、音量 ${summary.level_db} dB)`);
} catch (e) {
  console.error(`\n書き出せない: ${e instanceof CommandError ? `${e.id} ${e.message}` : e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
