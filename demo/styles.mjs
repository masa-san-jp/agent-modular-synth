// 曲調ごとの音作りの目安(音像を曲調に合わせるため)。曲を書くエージェントが参照し、demo/mixcheck.mjs が確かめる。
// 文章の説明は docs/sound-design-by-style.md。
//
// 役割(role)ごとに:
//   lufs     基準の役割(ref)との差 [LU] の範囲。短期ラウドネス(EBU R128、3 秒)の最大で比べる(まばらに鳴る音も、鳴った瞬間の大きさで比べられる)
//   centroid 明るさ(スペクトル重心 [Hz]。音の大きい所ほど重く数える)の範囲
//   presenceMax  耳に刺さる帯域(2〜5 kHz)のエネルギーの割合の上限(省略時は確かめない)
// 数値は、作例(demo/)の各チャンネルを測った値と、曲調の慣習から決めた出発点。耳で聞いて直したら、ここも直す。

export const STYLES = {
  ambient: {
    label: "アンビエント",
    ref: "pad",
    roles: {
      pad: { lufs: [0, 0], centroid: [120, 700] },
      lead: { lufs: [-9, -4], centroid: [250, 750], presenceMax: 0.02 }, // 背景より 1 オクターブ程度の明るさに留める
      fx: { lufs: [-12, -6], centroid: [120, 800] }, // 響きは暗く
      texture: { lufs: [-14, -8], centroid: [100, 1500] },
      sub: { lufs: [-12, -7], centroid: [30, 150] },
    },
    rules: [
      "主役の音域は C4〜A5 まで。C6 より上を主役にしない",
      "倍音の少ない波形(正弦波・三角波)を使うか、低域通過フィルタで丸める。FM は整数倍の比で、浅く",
      "立ち上がりは 20 ms 以上(打つ音でも角を落とす)。和音は 0.5 秒以上",
      "強さの幅を狭く(例: 60〜90)。突き出る音を作らない",
      "響き(ディレイ)は暗く、量は多め。戻りのフィルタは元の音より下に",
    ],
  },
  minimal: {
    label: "ミニマル",
    ref: "lead",
    roles: {
      lead: { lufs: [0, 0], centroid: [300, 1600] },
      counter: { lufs: [-5, -1], centroid: [300, 1600] },
      fx: { lufs: [-10, -5], centroid: [200, 1500] },
      bass: { lufs: [-4, -1], centroid: [50, 400] },
      kick: { lufs: [-5, -1], centroid: [40, 200] },
      hats: { lufs: [-11, -6], centroid: [3000, 9000] }, // 白色ノイズのままは鋭すぎる(12 kHz)
    },
    rules: [
      "型は短く、くり返す。音色の変化はフィルタの開き具合でつける",
      "型どうしは音域か左右でずらす",
      "ハイハットは低域通過で鋭さを落とす",
    ],
  },
  vaporwave: {
    label: "ヴェイパーウェイヴ",
    ref: "lead",
    roles: {
      lead: { lufs: [0, 0], centroid: [250, 1500] },
      pad: { lufs: [-6, -2], centroid: [150, 800] },
      keys: { lufs: [-6, -2], centroid: [200, 1000] },
      bass: { lufs: [-6, -2], centroid: [40, 250] },
      kick: { lufs: [-7, -2], centroid: [40, 200] },
      snare: { lufs: [-7, -2], centroid: [700, 4500] },
      hats: { lufs: [-13, -8], centroid: [2500, 9000] },
      fx: { lufs: [-11, -6], centroid: [200, 1500] },
    },
    rules: [
      "全体をこもらせる(高域を削る)。明るすぎる音を作らない",
      "テープの揺れ: 遅い LFO で音程をわずかに揺らす",
      "響きは深く、スネアに多め",
    ],
  },
  chiptune: {
    label: "チップチューン",
    ref: "lead",
    roles: {
      lead: { lufs: [0, 0], centroid: [400, 6000] },
      arp: { lufs: [-7, -3], centroid: [400, 6000] },
      bass: { lufs: [-6, -2], centroid: [60, 600] },
      kick: { lufs: [-7, -3], centroid: [60, 2000] },
      perc: { lufs: [-8, -4], centroid: [1500, 9000] },
    },
    rules: [
      "フィルタを使わず、生の波形(パルス幅 12.5 / 25 / 50 %、三角波、ノイズ)",
      "全体をサンプル&ホールドに通し、サンプリング周波数を落とす(粗い、安っぽい音)",
      "左右はほぼ中央。響きは使わない",
    ],
  },
  techno: {
    label: "テクノ",
    ref: "kick",
    roles: {
      kick: { lufs: [0, 0], centroid: [40, 400] },
      bass: { lufs: [-4, -1], centroid: [60, 600] },
      rumble: { lufs: [-12, -5], centroid: [30, 200] },
      hats: { lufs: [-12, -6], centroid: [2500, 10000] },
      stab: { lufs: [-9, -3], centroid: [200, 2000] },
      fx: { lufs: [-12, -6], centroid: [200, 2000] },
      drone: { lufs: [-12, -6], centroid: [40, 400] },
    },
    rules: ["キックがいちばん大きい", "低音はキックを避けて刻む"],
  },
  trance: {
    label: "トランス",
    ref: "kick",
    roles: {
      kick: { lufs: [0, 0], centroid: [40, 400] },
      lead: { lufs: [-3, 0], centroid: [800, 6000] },
      delay: { lufs: [-10, -5], centroid: [300, 3000] },
      pad: { lufs: [-9, -4], centroid: [150, 2000] },
      bass: { lufs: [-8, -3], centroid: [60, 600] },
      perc: { lufs: [-13, -8], centroid: [2500, 10000] },
      arp: { lufs: [-10, -5], centroid: [300, 3000] },
      riser: { lufs: [-8, -3], centroid: [500, 8000] },
    },
    rules: [
      "キックと主旋律がいちばん大きい。主旋律は鋸歯を少しずつずらして重ね、高い音域(A5 より上)で鳴らす",
      "低音は裏拍。和音・アルペジオ・低音はフィルタで丸め、主旋律とライザーより暗く",
      "主旋律の響きは付点 8 分のディレイ。戻りは暗く、片側へ",
    ],
  },
};
