#!/usr/bin/env python3
"""Genererar komprimerade mp3-filer med edge-tts för spelets uppläsbara texter.

Förutsätter en venv med edge-tts, t.ex. /workspace/laro/venv-tts, och ffmpeg.
Kör efter collect-voice-texts.mts:

  npx tsx scripts/collect-voice-texts.mts scripts/voice-texts.json
  /workspace/laro/venv-tts/bin/python scripts/generate-voice.py

Skriver public/assets/voice/<hash>.mp3 och public/assets/voice/manifest.json.
Avbryter om total storlek skulle överstiga 60 MB.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXTS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "scripts" / "voice-texts.json"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "public" / "assets" / "voice"
MAX_BYTES = 60 * 1024 * 1024
CONCURRENCY = 4
RATE = "-10%"
BITRATE = "32k"
SAMPLE_RATE = "24000"
VOICES = {
    "sv-SE": "sv-SE-SofieNeural",
    "en-US": "en-US-AvaNeural",
    "en-GB": "en-GB-SoniaNeural",
}

def clip_id(lang: str, text: str) -> str:
    raw = f"{lang}|{text.strip()}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:20]


def find_edge_tts() -> str:
    candidates = [
        Path("/workspace/laro/venv-tts/bin/python"),
        Path(sys.executable),
    ]
    for py in candidates:
        if not py.exists():
            continue
        check = subprocess.run(
            [str(py), "-c", "import edge_tts"],
            capture_output=True,
        )
        if check.returncode == 0:
            return str(py)
    raise SystemExit("edge-tts saknas. Skapa en venv och kör: pip install edge-tts")


async def synth_one(text: str, voice: str, dest: Path, py: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tts-") as tmp:
        raw = Path(tmp) / "raw.mp3"
        compact = Path(tmp) / "out.mp3"
        # Kör edge-tts i en underprocess så en krasch inte tar ner hela körningen.
        code = f"""
import asyncio, edge_tts, sys
async def main():
    c = edge_tts.Communicate(sys.argv[1], sys.argv[2], rate={RATE!r})
    await c.save(sys.argv[3])
asyncio.run(main())
"""
        proc = await asyncio.create_subprocess_exec(
            py,
            "-c",
            code,
            text,
            voice,
            str(raw),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0 or not raw.exists() or raw.stat().st_size < 200:
            raise RuntimeError(err.decode("utf-8", "replace") or f"edge-tts misslyckades ({proc.returncode})")
        ff = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-y",
            "-i",
            str(raw),
            "-ac",
            "1",
            "-ar",
            SAMPLE_RATE,
            "-b:a",
            BITRATE,
            "-c:a",
            "libmp3lame",
            "-map_metadata",
            "-1",
            str(compact),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, ferr = await ff.communicate()
        if ff.returncode != 0 or not compact.exists() or compact.stat().st_size < 200:
            raise RuntimeError(ferr.decode("utf-8", "replace") or "ffmpeg misslyckades")
        shutil.move(str(compact), str(dest))


async def main() -> None:
    if not TEXTS.exists():
        raise SystemExit(f"Hittar inte {TEXTS}. Kör först: npx tsx scripts/collect-voice-texts.mts")
    data = json.loads(TEXTS.read_text(encoding="utf-8"))
    parts = data["parts"] if isinstance(data, dict) else data
    py = find_edge_tts()
    OUT.mkdir(parents=True, exist_ok=True)
    unique = []
    seen = set()
    for part in parts:
        lang = part["lang"]
        text = part["text"].strip()
        if not text:
            continue
        key = f"{lang}|{text}"
        if key in seen:
            continue
        seen.add(key)
        if lang not in VOICES:
            raise SystemExit(f"Okänt språk: {lang}")
        unique.append((lang, text, clip_id(lang, text)))

    # Kollisionskontroll
    ids = {}
    for lang, text, cid in unique:
        if cid in ids and ids[cid] != (lang, text):
            raise SystemExit(f"Hashkollision: {cid}")
        ids[cid] = (lang, text)

    sem = asyncio.Semaphore(CONCURRENCY)
    errors: list[str] = []
    done = 0
    skipped = 0

    async def work(lang: str, text: str, cid: str) -> int:
        nonlocal done, skipped
        dest = OUT / f"{cid}.mp3"
        if dest.exists() and dest.stat().st_size >= 200:
            skipped += 1
            return dest.stat().st_size
        async with sem:
            last = None
            for attempt in range(4):
                try:
                    await synth_one(text, VOICES[lang], dest, py)
                    done += 1
                    if (done + skipped) % 25 == 0:
                        print(f"  {done} nya, {skipped} fanns, {done + skipped}/{len(unique)}", flush=True)
                    return dest.stat().st_size
                except Exception as exc:  # noqa: BLE001
                    last = exc
                    await asyncio.sleep(1.5 * (attempt + 1))
            errors.append(f"{cid} {lang}: {last}")
            return 0

    sizes = await asyncio.gather(*(work(lang, text, cid) for lang, text, cid in unique))
    total = 0
    clips = []
    missing = 0
    for (lang, text, cid), size in zip(unique, sizes):
        dest = OUT / f"{cid}.mp3"
        if not dest.exists() or dest.stat().st_size < 200:
            missing += 1
            continue
        bytes_ = dest.stat().st_size
        total += bytes_
        clips.append(
            {
                "id": cid,
                "lang": lang,
                "text": text,
                "file": f"{cid}.mp3",
                "bytes": bytes_,
            }
        )

    # räkna även manifestet grovt
    manifest = {
        "version": 1,
        "format": "mp3",
        "voices": VOICES,
        "rate": RATE,
        "clips": clips,
    }
    man_path = OUT / "manifest.json"
    man_text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    src_man = ROOT / "src" / "data" / "voice_manifest.json"
    extra = len(man_text.encode("utf-8"))
    grand = total + extra + extra  # samma manifest i public och src
    print(
        f"klipp={len(clips)} nya={done} fanns={skipped} saknas={missing} "
        f"ljud={total} bytes manifest={extra} totalt={grand} ({grand/1024/1024:.2f} MB)",
        flush=True,
    )
    if errors:
        print("FEL:", file=sys.stderr)
        for line in errors[:20]:
            print(" ", line, file=sys.stderr)
        if len(errors) > 20:
            print(f"  ... och {len(errors) - 20} till", file=sys.stderr)
    if grand > MAX_BYTES:
        print(
            f"STOPP: total storlek {grand/1024/1024:.2f} MB överstiger 60 MB. Manifest och filer lämnas men ska inte pushas.",
            file=sys.stderr,
        )
        man_path.write_text(man_text, encoding="utf-8")
        src_man.write_text(man_text, encoding="utf-8")
        raise SystemExit(2)
    man_path.write_text(man_text, encoding="utf-8")
    src_man.write_text(man_text, encoding="utf-8")
    if missing or errors:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
