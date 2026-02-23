#!/usr/bin/env python
"""Burn subtitles into video using FFmpeg"""
import argparse
import subprocess
import sys
import os

def main():
    parser = argparse.ArgumentParser(description='Burn subtitles into video')
    parser.add_argument('video', help='Input video file')
    parser.add_argument('subtitle', help='Input SRT subtitle file')
    parser.add_argument('-o', '--output', help='Output video file (default: <video>_bilingual.mp4)')
    parser.add_argument('--fontsize', type=int, default=12, help='Font size (default: 12)')
    parser.add_argument('--margin', type=int, default=20, help='Bottom margin (default: 20)')
    args = parser.parse_args()

    # Default output filename
    if args.output is None:
        base, ext = os.path.splitext(args.video)
        args.output = f'{base}_bilingual.mp4'

    print(f'Burning subtitles: {args.video} + {args.subtitle} -> {args.output}')

    # FFmpeg needs forward slashes and escaped colons for subtitles filter
    srt_escaped = args.subtitle.replace('\\', '/').replace(':', r'\:')

    style = f"FontSize={args.fontsize},MarginV={args.margin}"

    cmd = [
        'ffmpeg',
        '-i', args.video,
        '-vf', f"subtitles='{srt_escaped}':force_style='{style}'",
        '-c:a', 'copy',
        args.output,
        '-y'
    ]

    print(f'Running FFmpeg...')
    result = subprocess.run(cmd)

    if result.returncode == 0:
        print(f'Done! Output: {args.output}')
    else:
        print(f'FFmpeg failed with code {result.returncode}')

    return result.returncode

if __name__ == '__main__':
    sys.exit(main())
