#!/usr/bin/env python
"""Extract subtitles from video using Whisper (GPU/CPU auto-detect)"""
import argparse
import sys

def format_ts(sec):
    h, m, s = int(sec // 3600), int(sec % 3600 // 60), sec % 60
    return f'{h:02}:{m:02}:{s:06.3f}'.replace('.', ',')

def write_srt(segments, output):
    with open(output, 'w', encoding='utf-8') as f:
        for i, s in enumerate(segments, 1):
            start, end, text = s['start'], s['end'], s['text'].strip()
            f.write(f'{i}\n{format_ts(start)} --> {format_ts(end)}\n{text}\n\n')

def main():
    parser = argparse.ArgumentParser(description='Extract subtitles from video')
    parser.add_argument('video', help='Input video file')
    parser.add_argument('-o', '--output', default='original.srt', help='Output SRT file')
    parser.add_argument('-l', '--language', default='en', help='Language code (default: en)')
    parser.add_argument('-m', '--model', default='small', help='Whisper model (default: small)')
    args = parser.parse_args()

    print(f'Processing: {args.video}')
    print(f'Language: {args.language}, Model: {args.model}')

    # CUDA GPU: faster-whisper
    try:
        import torch
        if torch.cuda.is_available():
            from faster_whisper import WhisperModel
            print('Detected CUDA GPU, using GPU acceleration...')
            model = WhisperModel(args.model, device='cuda', compute_type='float16')
            segs, _ = model.transcribe(args.video, language=args.language)
            write_srt([{'start': s.start, 'end': s.end, 'text': s.text} for s in segs], args.output)
            print(f'Done! Saved to {args.output}')
            return 0
    except ImportError:
        pass

    # Apple Silicon: mlx-whisper
    try:
        import platform
        if platform.system() == 'Darwin' and platform.machine() == 'arm64':
            import mlx_whisper
            print('Using mlx-whisper (Apple Silicon)...')
            result = mlx_whisper.transcribe(args.video, path_or_hf_repo=f'mlx-community/whisper-{args.model}-mlx')
            write_srt(result['segments'], args.output)
            print(f'Done! Saved to {args.output}')
            return 0
    except ImportError:
        pass

    # Fallback: faster-whisper CPU
    try:
        from faster_whisper import WhisperModel
        print('Using CPU mode...')
        model = WhisperModel(args.model, compute_type='int8')
        segs, _ = model.transcribe(args.video, language=args.language)
        write_srt([{'start': s.start, 'end': s.end, 'text': s.text} for s in segs], args.output)
        print(f'Done! Saved to {args.output}')
        return 0
    except ImportError:
        pass

    print('Error: Please install faster-whisper or mlx-whisper')
    return 1

if __name__ == '__main__':
    sys.exit(main())
