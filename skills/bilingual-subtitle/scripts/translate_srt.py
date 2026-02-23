#!/usr/bin/env python
"""Translate SRT subtitles using Google Translate API"""
import argparse
import re
import urllib.request
import urllib.parse
import json
import time
import sys

def translate_text(text, source='en', target='zh-CN'):
    """Translate text using Google Translate API"""
    if not text.strip():
        return text

    url = 'https://translate.googleapis.com/translate_a/single'
    params = {
        'client': 'gtx',
        'sl': source,
        'tl': target,
        'dt': 't',
        'q': text
    }

    full_url = url + '?' + urllib.parse.urlencode(params)

    try:
        req = urllib.request.Request(full_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode('utf-8'))
            translated = ''.join([item[0] for item in result[0] if item[0]])
            return translated
    except Exception as e:
        print(f'Translation error: {e}')
        return text

def main():
    parser = argparse.ArgumentParser(description='Translate SRT subtitles')
    parser.add_argument('input', help='Input SRT file')
    parser.add_argument('-o', '--output', default='zh.srt', help='Output SRT file')
    parser.add_argument('-s', '--source', default='en', help='Source language (default: en)')
    parser.add_argument('-t', '--target', default='zh-CN', help='Target language (default: zh-CN)')
    parser.add_argument('-d', '--delay', type=float, default=0.5, help='Delay between requests (default: 0.5s)')
    args = parser.parse_args()

    print(f'Translating: {args.input} -> {args.output}')
    print(f'Language: {args.source} -> {args.target}')

    with open(args.input, 'r', encoding='utf-8') as f:
        content = f.read()

    blocks = re.split(r'\n\n+', content.strip())

    with open(args.output, 'w', encoding='utf-8') as f:
        for block in blocks:
            lines = block.split('\n')
            if len(lines) >= 3:
                index = lines[0]
                timestamp = lines[1]
                text = '\n'.join(lines[2:])

                print(f'Translating block {index}...')
                translated = translate_text(text, args.source, args.target)

                f.write(f'{index}\n{timestamp}\n{translated}\n\n')
                time.sleep(args.delay)

    print(f'Done! Saved to {args.output}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
