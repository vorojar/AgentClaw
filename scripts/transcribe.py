"""Speech-to-text using faster-whisper. Usage: python scripts/transcribe.py <audio_file>"""

import sys
from faster_whisper import WhisperModel

model = WhisperModel("turbo", device="auto")
segments, _ = model.transcribe(sys.argv[1], language="zh")
print("".join(s.text for s in segments))
