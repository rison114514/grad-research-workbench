#!/usr/bin/env python3
"""科研工作台本地 TTS sidecar。

只监听 127.0.0.1，由 Electron 主进程持有端口和生命周期。模型在首次请求时加载，
参考音频路径只来自主进程验证过的声音档案目录。
"""

import argparse
import io
import json
import os
import sys
import inspect
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL = None
MODEL_ID = ""


def load_tts(model_id):
    global MODEL, MODEL_ID
    if MODEL is None or MODEL_ID != model_id:
        print(json.dumps({"stage": "model", "detail": "正在加载本地塞西语音模型"}, ensure_ascii=False), flush=True)
        from mlx_audio.tts.utils import load_model
        MODEL = load_model(model_id)
        MODEL_ID = model_id
    return MODEL


def sample_rate(model, results):
    if results and getattr(results[0], "sample_rate", None):
        return int(results[0].sample_rate)
    for obj in (model, getattr(model, "config", None)):
        if obj is None:
            continue
        for key in ("sample_rate", "sampling_rate"):
            value = getattr(obj, key, None)
            if value:
                return int(value)
    return 24000


def synthesize(payload):
    import numpy as np
    import soundfile as sf

    text = str(payload.get("text") or "").strip()
    if not text:
        raise ValueError("合成文本为空")
    model_id = str(payload.get("model") or MODEL_ID).strip()
    if not model_id:
        raise ValueError("未指定模型")
    mode = str(payload.get("mode") or "zero_shot").strip()
    ref_audio = str(payload.get("referencePath") or "").strip()
    ref_text = str(payload.get("referenceText") or "").strip()
    voice = str(payload.get("voice") or "Xaihi").strip()
    instruct = str(payload.get("instruct") or "").strip()
    speed = float(payload.get("speed") or 1.0)
    if mode == "zero_shot":
        if not ref_audio or not os.path.isfile(ref_audio):
            raise ValueError("本地声音档案缺少参考音频")
        if not ref_text:
            raise ValueError("本地声音档案缺少参考音频逐字稿")

    model = load_tts(model_id)
    supported = inspect.signature(model.generate).parameters
    kwargs = {"text": text}
    if "speed" in supported:
        kwargs["speed"] = max(0.6, min(1.6, speed))
    if mode == "custom_voice":
        if not voice:
            raise ValueError("已微调模型缺少说话人名称")
        if "voice" in supported:
            kwargs["voice"] = voice
        if instruct and "instruct" in supported:
            kwargs["instruct"] = instruct
    else:
        kwargs["ref_audio"] = ref_audio
        kwargs["ref_text"] = ref_text
    chunks = list(model.generate(**kwargs))
    if not chunks:
        raise RuntimeError("模型没有返回音频")
    arrays = [np.asarray(item.audio, dtype=np.float32).reshape(-1) for item in chunks]
    audio = np.concatenate(arrays) if len(arrays) > 1 else arrays[0]
    output = io.BytesIO()
    sf.write(output, audio, sample_rate(model, chunks), format="WAV", subtype="PCM_16")
    return output.getvalue()


class VoiceHandler(BaseHTTPRequestHandler):
    server_version = "ResearchWorkbenchVoice/1.0"

    def log_message(self, fmt, *args):
        return

    def send_json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True, "modelLoaded": MODEL is not None, "model": MODEL_ID})
        else:
            self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 256 * 1024:
                raise ValueError("请求大小无效")
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
            data = synthesize(payload)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": str(exc)[:500]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--preload", action="store_true")
    args = parser.parse_args()
    if args.preload:
        load_tts(args.model)
        print(json.dumps({"stage": "ready", "detail": "本地 TTS 模型已准备"}, ensure_ascii=False), flush=True)
        return
    server = HTTPServer(("127.0.0.1", args.port), VoiceHandler)
    global MODEL_ID
    MODEL_ID = args.model
    print(json.dumps({"stage": "ready", "port": server.server_port}, ensure_ascii=False), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(json.dumps({"stage": "error", "error": str(error)[:1000]}, ensure_ascii=False), flush=True)
        sys.exit(1)
