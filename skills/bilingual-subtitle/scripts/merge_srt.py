#!/usr/bin/env python
"""Merge two SRT files into bilingual subtitles"""
import argparse
import re
import sys

def main():
    parser = argparse.ArgumentParser(description='Merge two SRT files into bilingual subtitles')
    parser.add_argument('primary', help='Primary SRT file (e.g., English)')
    parser.add_argument('secondary', help='Secondary SRT file (e.g., Chinese)')
    parser.add_argument('-o', '--output', default='bilingual.srt', help='Output SRT file')
    args = parser.parse_args()

    print(f'Merging: {args.primary} + {args.secondary} -> {args.output}')

    with open(args.primary, 'r', encoding='utf-8') as f:
        primary_content = f.read()

    with open(args.secondary, 'r', encoding='utf-8') as f:
        secondary_content = f.read()

    primary_blocks = re.split(r'\n\n+', primary_content.strip())
    secondary_blocks = re.split(r'\n\n+', secondary_content.strip())

    with open(args.output, 'w', encoding='utf-8') as f:
        for i, (pri_block, sec_block) in enumerate(zip(primary_blocks, secondary_blocks)):
            pri_lines = pri_block.split('\n')
            sec_lines = sec_block.split('\n')

            if len(pri_lines) >= 3 and len(sec_lines) >= 3:
                index = pri_lines[0]
                timestamp = pri_lines[1]
                pri_text = '\n'.join(pri_lines[2:])
                sec_text = '\n'.join(sec_lines[2:])

                f.write(f'{index}\n{timestamp}\n{pri_text}\n{sec_text}\n\n')

    print(f'Done! Saved to {args.output}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
