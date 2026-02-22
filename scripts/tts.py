"""Text-to-speech. Usage: python scripts/tts.py <text> <output.ogg>"""

import os
import subprocess
import sys
import tempfile

text, output = sys.argv[1], sys.argv[2]
provider = os.environ.get("TTS_PROVIDER", "edge")
voice = os.environ.get("TTS_VOICE", "zh-CN-XiaoxiaoNeural")

if provider == "vibevoice":
    import requests

    url = os.environ.get("VIBEVOICE_URL", "http://localhost:8001")
    r = requests.post(f"{url}/tts", json={"text": text, "voice": voice})
    r.raise_for_status()
    tmp = tempfile.mktemp(suffix=".wav")
    with open(tmp, "wb") as f:
        f.write(r.content)
else:
    import asyncio

    import edge_tts

    tmp = tempfile.mktemp(suffix=".mp3")
    asyncio.run(edge_tts.Communicate(text, voice).save(tmp))

subprocess.run(
    ["ffmpeg", "-y", "-i", tmp, "-c:a", "libopus", "-b:a", "48k", output],
    check=True,
    capture_output=True,
)
os.unlink(tmp)
