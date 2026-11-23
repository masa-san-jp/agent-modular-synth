// サウンドチェック: エージェントは音を聞けないので、ミキサー卓(MOD-MIX-002)のメーターを読んで音量の配分を決める。
// 手順: 全パートが鳴る楽譜を流す → meter.read で各チャンネルの音量を読む → 目標に合うよう level[i] を param.set で直す
//       → もう一度読んで確かめる → 出力の最大が目標になるよう master を決める → 止める。
// `api` は、実際の経路(HTTP)でも、同じプロセス内のエンジンでも使えるよう、2 つの関数だけを受け取る:
//   send(command, args) → 応答の result(失敗したら例外)、  advance(seconds) → その時間だけ演奏を進める(待つ)。

const dB = (v) => (v > 0 ? `${(20 * Math.log10(v / 5)).toFixed(1)} dB` : "−∞");

export async function soundcheck(api, cfg, log = console.log) {
  const { desk, targets, names } = cfg;
  const levelOf = async () => (await api.send("module.get", { module_id: desk })).module.params;
  const table = (v) => Object.keys(targets).map((i) => `${names[i]} ${v.ch_rms[i - 1].toFixed(2)} V`).join(" / ");
  /**
   * 数秒ぶんを平均して読む。1 回の読出しは窓 1 つぶん(約 0.4 秒)なので、間を置いて鳴るパート(スタブなど)は
   * 窓によって値が大きく変わる。窓ごとに読んで、二乗の平均を取る。出力の最大は、その間の最大。
   */
  const measure = async (windows = 12) => {
    const first = await api.send("meter.read", { module_id: desk, fields: ["windows"] });
    let last = first.values.windows;
    const sq = new Array(8).fill(0);
    const band = [0, 0, 0];
    const peak = [0, 0];
    let n = 0;
    for (let guard = 0; n < windows && guard < windows * 6; guard++) {
      // 確かめている間、音が途切れないよう、残りが少なくなったら同じ楽譜を続きに足す
      if ((await api.send("score.get_status")).remaining < 6) await api.send("score.play", cfg.score);
      await api.advance(0.2);
      const v = (await api.send("meter.read", { module_id: desk })).values;
      if (v.windows === last) continue; // まだ新しい窓が閉じていない
      last = v.windows;
      n++;
      v.ch_rms.forEach((x, i) => (sq[i] += x * x));
      [v.out_low, v.out_mid, v.out_high].forEach((x, i) => (band[i] += x * x));
      v.out_peak.forEach((x, i) => (peak[i] = Math.max(peak[i], x)));
    }
    const mean = (x) => Math.sqrt(x / Math.max(1, n));
    return { ch_rms: sq.map(mean), out_low: mean(band[0]), out_mid: mean(band[1]), out_high: mean(band[2]), out_peak: peak };
  };

  await api.send("score.play", { ...cfg.score, mode: "replace" });
  await api.advance(cfg.settleSeconds ?? 3); // 全パートが鳴り始め、ゆっくり立ち上がる音が落ち着くまで
  let v = await measure();
  log(`  読んだ音量(直す前): ${table(v)}`);
  log(`  出力の最大 ${v.out_peak.map((x) => x.toFixed(2)).join(" / ")} V、帯域 低 ${dB(v.out_low)} 中 ${dB(v.out_mid)} 高 ${dB(v.out_high)}`);

  // 2 回くり返す(1 回目で大きく直し、2 回目で確かめて微調整)
  for (let pass = 1; pass <= 2; pass++) {
    const params = await levelOf();
    const changes = [];
    for (const [i, target] of Object.entries(targets)) {
      const now = v.ch_rms[i - 1];
      const level = params[`level[${i}]`];
      if (!(now > 1e-4)) continue; // 鳴っていないチャンネルは触らない
      const next = Math.max(0, Math.min(1, Math.round(level * (target / now) * 1000) / 1000));
      if (Math.abs(next - level) > 0.004) {
        await api.send("param.set", { module_id: desk, param: `level[${i}]`, value: next });
        changes.push(`${names[i]} ${level} → ${next}`);
      }
    }
    log(`  ${pass} 回目の調整: ${changes.length ? changes.join("、") : "変更なし"}`);
    await api.advance(0.5);
    v = await measure();
  }
  // 全体の音量: 卓の出力の最大を目標に合わせる
  const params = await levelOf();
  const peak = Math.max(...v.out_peak);
  const master = Math.max(0, Math.min(1, Math.round(params.master * (cfg.outPeak / peak) * 1000) / 1000));
  if (Math.abs(master - params.master) > 0.004) await api.send("param.set", { module_id: desk, param: "master", value: master });
  await api.advance(0.5);
  v = await measure();
  log(`  読んだ音量(直した後): ${table(v)}`);
  log(`  全体の音量 ${params.master} → ${master}。出力の最大 ${v.out_peak.map((x) => x.toFixed(2)).join(" / ")} V、帯域 低 ${dB(v.out_low)} 中 ${dB(v.out_mid)} 高 ${dB(v.out_high)}`);
  await api.send("score.stop");
  await api.advance(1.5); // ディレイの尾が消えるのを待つ
  return v;
}
