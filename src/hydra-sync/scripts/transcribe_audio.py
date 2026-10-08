#!/usr/bin/env python3
import sys
import json
import os
import wave

def is_pcm_silence(audio_path):
    if not os.path.exists(audio_path):
        return False
    if audio_path.lower().endswith('.wav'):
        try:
            with wave.open(audio_path, 'rb') as wf:
                data = wf.readframes(min(wf.getnframes(), 320000))
                if len(data) > 0 and all(b == 0 for b in data):
                    return True
        except Exception:
            pass
    return False

def transcribe(audio_path, model_name="base"):
    if not os.path.exists(audio_path):
        return {"error": "File not found", "transcript": ""}
    
    if is_pcm_silence(audio_path):
        return {
            "transcript": "",
            "segments": [],
            "language": "pt"
        }

    try:
        import torch
        torch.set_num_threads(min(2, os.cpu_count() or 1))
        import whisper
        model = whisper.load_model(model_name)
        result = model.transcribe(audio_path, language="pt", fp16=False)
        text = (result.get("text") or "").strip()
        segments = []
        for s in result.get("segments", []):
            segments.append({
                "start": s.get("start"),
                "end": s.get("end"),
                "text": s.get("text", "").strip()
            })
        return {
            "transcript": text,
            "segments": segments,
            "language": result.get("language", "pt")
        }
    except Exception as e:
        return {"error": str(e), "transcript": ""}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No audio path provided", "transcript": ""}))
        sys.exit(1)
    
    path = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else "base"
    res = transcribe(path, model)
    print(json.dumps(res, ensure_ascii=False))
