// 生成物。手で直さない。正本はモジュール仕様(specifications/modules/MOD-*.md)のフロントマターと §3・§4。
// 作り直す: python3 tools/build_module_meta.py
export interface PortMeta {
  unit: string;
  /** 入力だけ。未接続時の値: 定数なら value [V]、他の信号へ内部接続されるなら normal(その名前)。 */
  unconnected?: { value: number | null; normal: string | null };
}
export interface ParamMeta {
  unit: string | null;
  /** 列挙型の選択肢。 */
  values?: { value: number; label: string }[];
}
export interface ModuleMeta {
  category: string;
  ports: Record<string, PortMeta>;
  params: Record<string, ParamMeta>;
}

export const MODULE_META: Record<string, ModuleMeta> = {
  "MOD-AMP-001": {
    "category": "amplifier",
    "ports": {
      "in1": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in2": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "cv1": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "cv2": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "out": {
        "unit": "V"
      }
    },
    "params": {
      "gain": {
        "unit": "無次元"
      },
      "in1_level": {
        "unit": "無次元"
      },
      "in2_level": {
        "unit": "無次元"
      },
      "cv2_level": {
        "unit": "無次元"
      },
      "out_level": {
        "unit": "無次元"
      },
      "response": {
        "unit": null,
        "values": [
          {
            "value": 0,
            "label": "線形"
          },
          {
            "value": 1,
            "label": "指数"
          }
        ]
      }
    }
  },
  "MOD-CLK-001": {
    "category": "clock_sequencer",
    "ports": {
      "reset": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "run": {
        "unit": "V",
        "unconnected": {
          "value": 10.0,
          "normal": null
        }
      },
      "bpm_cv": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "clock": {
        "unit": "V"
      },
      "gate": {
        "unit": "V"
      }
    },
    "params": {
      "bpm": {
        "unit": "BPM"
      },
      "ppqn": {
        "unit": "ティック/拍"
      },
      "swing": {
        "unit": "周期の倍率"
      },
      "duty": {
        "unit": "周期の倍率"
      },
      "run": {
        "unit": null
      }
    }
  },
  "MOD-CLK-002": {
    "category": "clock_sequencer",
    "ports": {
      "clock": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "reset": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "out2": {
        "unit": "V"
      },
      "out4": {
        "unit": "V"
      },
      "out8": {
        "unit": "V"
      },
      "out16": {
        "unit": "V"
      },
      "out32": {
        "unit": "V"
      },
      "out64": {
        "unit": "V"
      },
      "out_div": {
        "unit": "V"
      }
    },
    "params": {
      "division": {
        "unit": "クロック数"
      }
    }
  },
  "MOD-DLY-001": {
    "category": "time_effect",
    "ports": {
      "in": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "time_cv": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "out": {
        "unit": "V"
      }
    },
    "params": {
      "time": {
        "unit": "秒"
      },
      "feedback": {
        "unit": "無次元"
      },
      "mix": {
        "unit": "無次元"
      }
    }
  },
  "MOD-ENV-001": {
    "category": "modulation",
    "ports": {
      "gate": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "retrig": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "env": {
        "unit": "V"
      },
      "inv": {
        "unit": "V"
      }
    },
    "params": {
      "attack": {
        "unit": "秒"
      },
      "decay": {
        "unit": "秒"
      },
      "sustain": {
        "unit": "無次元"
      },
      "release": {
        "unit": "秒"
      }
    }
  },
  "MOD-FLT-001": {
    "category": "filter",
    "ports": {
      "in": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "cv1": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "cv2": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "cv3": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "res_cv": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "out": {
        "unit": "V"
      }
    },
    "params": {
      "cutoff": {
        "unit": "V"
      },
      "res": {
        "unit": "無次元"
      },
      "cv2_level": {
        "unit": "無次元"
      },
      "cv3_level": {
        "unit": "無次元"
      }
    }
  },
  "MOD-FNC-001": {
    "category": "modulation",
    "ports": {
      "in": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "trig": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "cycle": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "rise_cv": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "fall_cv": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "out": {
        "unit": "V"
      },
      "eor": {
        "unit": "V"
      },
      "eoc": {
        "unit": "V"
      }
    },
    "params": {
      "rise": {
        "unit": "秒"
      },
      "fall": {
        "unit": "秒"
      },
      "response": {
        "unit": null,
        "values": [
          {
            "value": 0,
            "label": "線形"
          },
          {
            "value": 1,
            "label": "指数"
          }
        ]
      }
    }
  },
  "MOD-IO-001": {
    "category": "io_utility",
    "ports": {
      "IN_L": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "IN_R": {
        "unit": "V",
        "unconnected": {
          "value": null,
          "normal": "IN_L"
        }
      },
      "PRE_L": {
        "unit": "FS"
      },
      "PRE_R": {
        "unit": "FS"
      },
      "DEV_L": {
        "unit": "FS"
      },
      "DEV_R": {
        "unit": "FS"
      },
      "CLIP": {
        "unit": "V"
      }
    },
    "params": {
      "level": {
        "unit": "線形倍率"
      },
      "mute": {
        "unit": null
      }
    }
  },
  "MOD-IO-002": {
    "category": "io_utility",
    "ports": {
      "MIDI": {
        "unit": "メッセージ",
        "unconnected": {
          "value": null,
          "normal": null
        }
      },
      "PITCH": {
        "unit": "V"
      },
      "GATE": {
        "unit": "V"
      },
      "VEL": {
        "unit": "V"
      },
      "PW": {
        "unit": "V"
      },
      "MOD": {
        "unit": "V"
      },
      "RTRG": {
        "unit": "V"
      },
      "CLK": {
        "unit": "V"
      }
    },
    "params": {
      "channel": {
        "unit": "MIDIチャンネル"
      },
      "transpose": {
        "unit": "半音"
      },
      "voices": {
        "unit": "同時発音数"
      },
      "cc_number": {
        "unit": "CC番号"
      }
    }
  },
  "MOD-IO-003": {
    "category": "io_utility",
    "ports": {
      "IN": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "THRU": {
        "unit": "V"
      }
    },
    "params": {
      "window_ms": {
        "unit": "ミリ秒"
      },
      "capture_len": {
        "unit": "サンプル"
      },
      "trig_mode": {
        "unit": null,
        "values": [
          {
            "value": 0,
            "label": "連続"
          },
          {
            "value": 1,
            "label": "立ち上がり"
          },
          {
            "value": 2,
            "label": "立ち下がり"
          }
        ]
      },
      "trig_level": {
        "unit": "V"
      },
      "pre": {
        "unit": "サンプル"
      },
      "channel": {
        "unit": "チャンネル番号"
      }
    }
  },
  "MOD-LFO-001": {
    "category": "modulation",
    "ports": {
      "rate": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "reset": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "saw": {
        "unit": "V"
      },
      "saw_inv": {
        "unit": "V"
      },
      "tri": {
        "unit": "V"
      },
      "sine": {
        "unit": "V"
      },
      "square": {
        "unit": "V"
      }
    },
    "params": {
      "freq": {
        "unit": "Hz"
      },
      "cv_amt": {
        "unit": "oct/V"
      },
      "depth": {
        "unit": "比"
      }
    }
  },
  "MOD-LGC-001": {
    "category": "random_logic",
    "ports": {
      "a": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "b": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "and": {
        "unit": "V"
      },
      "or": {
        "unit": "V"
      },
      "xor": {
        "unit": "V"
      },
      "not": {
        "unit": "V"
      },
      "cmp": {
        "unit": "V"
      }
    },
    "params": {
      "ref": {
        "unit": "V"
      },
      "hyst": {
        "unit": "V"
      }
    }
  },
  "MOD-MIX-001": {
    "category": "amplifier",
    "ports": {
      "in1": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in2": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in3": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in4": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "out": {
        "unit": "V"
      }
    },
    "params": {
      "level1": {
        "unit": "無次元"
      },
      "level2": {
        "unit": "無次元"
      },
      "level3": {
        "unit": "無次元"
      },
      "level4": {
        "unit": "無次元"
      },
      "master": {
        "unit": "無次元"
      }
    }
  },
  "MOD-MIX-002": {
    "category": "amplifier",
    "ports": {
      "in1": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in2": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in3": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in4": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in5": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in6": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in7": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "in8": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "L": {
        "unit": "V"
      },
      "R": {
        "unit": "V"
      },
      "SEND": {
        "unit": "V"
      }
    },
    "params": {
      "level[1]": {
        "unit": "無次元"
      },
      "level[2]": {
        "unit": "無次元"
      },
      "level[3]": {
        "unit": "無次元"
      },
      "level[4]": {
        "unit": "無次元"
      },
      "level[5]": {
        "unit": "無次元"
      },
      "level[6]": {
        "unit": "無次元"
      },
      "level[7]": {
        "unit": "無次元"
      },
      "level[8]": {
        "unit": "無次元"
      },
      "pan[1]": {
        "unit": "無次元"
      },
      "pan[2]": {
        "unit": "無次元"
      },
      "pan[3]": {
        "unit": "無次元"
      },
      "pan[4]": {
        "unit": "無次元"
      },
      "pan[5]": {
        "unit": "無次元"
      },
      "pan[6]": {
        "unit": "無次元"
      },
      "pan[7]": {
        "unit": "無次元"
      },
      "pan[8]": {
        "unit": "無次元"
      },
      "mute[1]": {
        "unit": null
      },
      "mute[2]": {
        "unit": null
      },
      "mute[3]": {
        "unit": null
      },
      "mute[4]": {
        "unit": null
      },
      "mute[5]": {
        "unit": null
      },
      "mute[6]": {
        "unit": null
      },
      "mute[7]": {
        "unit": null
      },
      "mute[8]": {
        "unit": null
      },
      "solo[1]": {
        "unit": null
      },
      "solo[2]": {
        "unit": null
      },
      "solo[3]": {
        "unit": null
      },
      "solo[4]": {
        "unit": null
      },
      "solo[5]": {
        "unit": null
      },
      "solo[6]": {
        "unit": null
      },
      "solo[7]": {
        "unit": null
      },
      "solo[8]": {
        "unit": null
      },
      "send[1]": {
        "unit": "無次元"
      },
      "send[2]": {
        "unit": "無次元"
      },
      "send[3]": {
        "unit": "無次元"
      },
      "send[4]": {
        "unit": "無次元"
      },
      "send[5]": {
        "unit": "無次元"
      },
      "send[6]": {
        "unit": "無次元"
      },
      "send[7]": {
        "unit": "無次元"
      },
      "send[8]": {
        "unit": "無次元"
      },
      "master": {
        "unit": "無次元"
      },
      "window_ms": {
        "unit": "ミリ秒"
      }
    }
  },
  "MOD-NSE-001": {
    "category": "noise",
    "ports": {
      "out": {
        "unit": "V"
      }
    },
    "params": {
      "level": {
        "unit": "V"
      },
      "seed": {
        "unit": null
      }
    }
  },
  "MOD-OSC-001": {
    "category": "oscillator",
    "ports": {
      "pitch": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "fm": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "pwm": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "sync": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "saw": {
        "unit": "V"
      },
      "pulse": {
        "unit": "V"
      },
      "tri": {
        "unit": "V"
      },
      "sine": {
        "unit": "V"
      }
    },
    "params": {
      "range": {
        "unit": "oct"
      },
      "tune": {
        "unit": "oct"
      },
      "fm_amt": {
        "unit": "oct/V"
      },
      "pw": {
        "unit": "比"
      },
      "pwm_amt": {
        "unit": "比/10 V"
      }
    }
  },
  "MOD-RND-001": {
    "category": "random_logic",
    "ports": {
      "IN": {
        "unit": "V",
        "unconnected": {
          "value": null,
          "normal": "NOISE[n]"
        }
      },
      "TRIG": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "OUT": {
        "unit": "V"
      },
      "NOISE": {
        "unit": "V"
      }
    },
    "params": {
      "seed": {
        "unit": null
      },
      "level": {
        "unit": "V"
      },
      "scale": {
        "unit": "倍率"
      },
      "offset": {
        "unit": "V"
      }
    }
  },
  "MOD-SAT-001": {
    "category": "waveshaper",
    "ports": {
      "in": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "drive_cv": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "out": {
        "unit": "V"
      }
    },
    "params": {
      "drive": {
        "unit": "dB"
      },
      "bias": {
        "unit": "無次元"
      },
      "mode": {
        "unit": null,
        "values": [
          {
            "value": 0,
            "label": "ソフト"
          },
          {
            "value": 1,
            "label": "ハード"
          },
          {
            "value": 2,
            "label": "フォールド"
          }
        ]
      },
      "mix": {
        "unit": "無次元"
      },
      "level": {
        "unit": "無次元"
      }
    }
  },
  "MOD-SEQ-001": {
    "category": "clock_sequencer",
    "ports": {
      "CLOCK": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "RESET": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "CV": {
        "unit": "V"
      },
      "GATE": {
        "unit": "V"
      },
      "TRIG": {
        "unit": "V"
      },
      "EOC": {
        "unit": "V"
      }
    },
    "params": {
      "length": {
        "unit": "ステップ"
      },
      "cv[1]": {
        "unit": "V"
      },
      "cv[2]": {
        "unit": "V"
      },
      "cv[3]": {
        "unit": "V"
      },
      "cv[4]": {
        "unit": "V"
      },
      "cv[5]": {
        "unit": "V"
      },
      "cv[6]": {
        "unit": "V"
      },
      "cv[7]": {
        "unit": "V"
      },
      "cv[8]": {
        "unit": "V"
      },
      "cv[9]": {
        "unit": "V"
      },
      "cv[10]": {
        "unit": "V"
      },
      "cv[11]": {
        "unit": "V"
      },
      "cv[12]": {
        "unit": "V"
      },
      "cv[13]": {
        "unit": "V"
      },
      "cv[14]": {
        "unit": "V"
      },
      "cv[15]": {
        "unit": "V"
      },
      "cv[16]": {
        "unit": "V"
      },
      "gate[1]": {
        "unit": null
      },
      "gate[2]": {
        "unit": null
      },
      "gate[3]": {
        "unit": null
      },
      "gate[4]": {
        "unit": null
      },
      "gate[5]": {
        "unit": null
      },
      "gate[6]": {
        "unit": null
      },
      "gate[7]": {
        "unit": null
      },
      "gate[8]": {
        "unit": null
      },
      "gate[9]": {
        "unit": null
      },
      "gate[10]": {
        "unit": null
      },
      "gate[11]": {
        "unit": null
      },
      "gate[12]": {
        "unit": null
      },
      "gate[13]": {
        "unit": null
      },
      "gate[14]": {
        "unit": null
      },
      "gate[15]": {
        "unit": null
      },
      "gate[16]": {
        "unit": null
      },
      "glide": {
        "unit": "秒"
      },
      "run": {
        "unit": null
      }
    }
  },
  "MOD-UTL-001": {
    "category": "utility",
    "ports": {
      "in": {
        "unit": "V",
        "unconnected": {
          "value": 0.0,
          "normal": null
        }
      },
      "out": {
        "unit": "V"
      }
    },
    "params": {
      "gain": {
        "unit": "比"
      },
      "offset": {
        "unit": "V"
      }
    }
  }
};
