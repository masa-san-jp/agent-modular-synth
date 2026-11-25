// 曲調ごとの音作りの目安(英語)。LLM への指示文に足し、音像を曲調に合わせる(docs/sound-design-by-style.md、demo/styles.mjs と同じ方針)。
// 演奏の目標の文から曲調を読み取る(--style で直接指定もできる)。

export type StyleName = "ambient" | "minimal" | "vaporwave" | "chiptune" | "techno";

/** 目標の文に含まれる語 → 曲調。先に当たったものを使う。 */
const KEYWORDS: readonly [StyleName, RegExp][] = [
  ["vaporwave", /vapou?r ?wave|ヴェイパー|ベイパー|ヴェーパー/i],
  ["chiptune", /chip ?tune|8[- ]?bit|8 ?ビット|チップ|ファミコン|レトロゲーム|game ?boy/i],
  ["ambient", /ambient|アンビエント|ドローン|drone|環境音楽/i],
  ["minimal", /minimal|ミニマル|反復|reich|ライヒ/i],
  ["techno", /techno|テクノ/i],
];

export function detectStyle(goal: string): StyleName | null {
  for (const [name, re] of KEYWORDS) if (re.test(goal)) return name;
  return null;
}

/** すべての曲調に共通の目安。 */
export const GENERAL_HINTS = [
  "Fit the sound to the style. Nothing should stick out harshly: no shrill high leads, no raw white noise at full level.",
  "Rank the parts by loudness on purpose (reference part loudest, accents and textures quieter). Use the mixing desk (MOD-MIX-002) levels for this.",
  "High pitches, noise and sparse hits sound louder than their voltage suggests: set them lower than you think.",
  "Raw white noise is very bright; put hats/noise through a low-pass filter (MOD-FLT-001 cutoff about 5) before the VCA.",
];

export const STYLE_HINTS: Readonly<Record<StyleName, readonly string[]>> = {
  ambient: [
    "Reference: the pad. Pad: slow attack (0.5 s or more), long release, detuned saws/triangles through a low-pass filter (cutoff around -1..0).",
    "Leads/bells: keep them within about one octave above the pad (C4..A5, MIDI 60..81), never the main voice above C6.",
    "Use sine or triangle waves, or low-pass them. FM only at integer ratios (modulator range +1) and shallow (fm_amt 0.05 or less).",
    "Attack 20 ms or more even for plucks; narrow velocity range (60..90). Leads about 6 LU below the pad.",
    "Echoes: long delay (1-1.5 s), dark returns (low-pass the delay output below the source), plenty of it. Sub sine and noise textures quiet.",
  ],
  minimal: [
    "Reference: the main pattern. Short repeating patterns of different lengths (e.g. 12 and 7 sixteenths) drifting against the bar.",
    "Change the sound with filter cutoff/resonance, not with new notes. Separate patterns by register or pan.",
    "Kick soft and short; bass close to the pattern level; hats low-passed and about 8 LU below.",
  ],
  vaporwave: [
    "Reference: the lead. Slow tempo (70-85 BPM), major 7th / 9th chords, muffled overall (low-pass everything a bit).",
    "Tape wobble: a slow LFO (about 0.3 Hz) into the VCO fm inputs with tiny fm_amt (0.004).",
    "E-piano: a sine VCO frequency-modulated by another sine an octave up, short decay. Deep delay, more on the snare.",
  ],
  chiptune: [
    "Reference: the lead. Raw waves only, no filters: pulse with pw 0.125 / 0.25 / 0.5, triangle bass with constant level, noise drums.",
    "Fast arpeggios (16ths) for chords. Keep everything near the center, no echoes.",
    "Lo-fi grit: run the whole mix (desk L) through a sample & hold MOD-RND-001 (IN) triggered by a VCO pulse at about 9 kHz (pitch from MOD-UTL-001 offset 5.1 V, gain 0), and send its OUT to the output IN_L.",
  ],
  techno: [
    "Reference: the kick, the loudest part. Bass rolls between the kicks. Hats low-passed, 6-12 LU below the kick.",
    "Distortion (MOD-SAT-001) on kick and bass for weight; dark drone underneath.",
  ],
};

/** 指示文に足す文(曲調が分からなければ、共通の目安だけ)。 */
export function styleSection(style: StyleName | null): string {
  const lines = ["# Sound design", ...GENERAL_HINTS.map((h) => `- ${h}`)];
  if (style) lines.push("", `# Style: ${style}`, ...STYLE_HINTS[style].map((h) => `- ${h}`));
  return lines.join("\n");
}
