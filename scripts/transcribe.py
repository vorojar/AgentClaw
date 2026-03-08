"""Speech-to-text using faster-whisper. Supports SILK (QQ voice), WAV, MP3, OGG, etc.

Usage: python scripts/transcribe.py <audio_file>
"""

import os
import sys
import wave

# Force UTF-8 output on Windows (default is GBK)
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")


def decode_silk(silk_path: str) -> str:
    """Convert SILK_V3 (QQ/WeChat voice) to WAV via pilk."""
    import pilk

    pcm_path = silk_path + ".pcm"
    wav_path = silk_path + ".wav"

    pilk.decode(silk_path, pcm_path)

    with open(pcm_path, "rb") as f:
        pcm = f.read()
    with wave.open(wav_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(24000)  # SILK default sample rate
        w.writeframes(pcm)

    os.remove(pcm_path)
    return wav_path


def is_silk(path: str) -> bool:
    """Check if file starts with SILK_V3 header."""
    try:
        with open(path, "rb") as f:
            header = f.read(10)
        return b"SILK_V3" in header or b"#!SILK" in header
    except Exception:
        return False


def main():
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <audio_file>", file=sys.stderr)
        sys.exit(1)

    audio_file = sys.argv[1]
    cleanup = None

    # Auto-detect SILK format (QQ voice)
    if is_silk(audio_file):
        audio_file = decode_silk(audio_file)
        cleanup = audio_file

    from faster_whisper import WhisperModel

    model = WhisperModel("turbo", device="auto")
    segments, _ = model.transcribe(audio_file, language="zh")
    print("".join(s.text for s in segments))

    if cleanup and os.path.exists(cleanup):
        os.remove(cleanup)


if __name__ == "__main__":
    main()
