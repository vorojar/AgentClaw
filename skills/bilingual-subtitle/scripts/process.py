#!/usr/bin/env python
"""
双语字幕一键生成工具
- 使用 Whisper 提取字幕（自动检测 GPU）
- 翻译为中文（批量模式）
- 合并双语字幕
- GPU 加速烧录字幕
"""
import sys
import os

# Windows 控制台 UTF-8 编码支持
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

import argparse
import re
import json
import time
import platform
import subprocess
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

# ============== 工具函数 ==============

def format_duration(seconds):
    """格式化时长"""
    if seconds < 60:
        return f'{seconds:.1f}秒'
    elif seconds < 3600:
        m, s = divmod(seconds, 60)
        return f'{int(m)}分{s:.1f}秒'
    else:
        h, rem = divmod(seconds, 3600)
        m, s = divmod(rem, 60)
        return f'{int(h)}时{int(m)}分{s:.1f}秒'

def format_size(bytes):
    """格式化文件大小"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes < 1024:
            return f'{bytes:.1f}{unit}'
        bytes /= 1024
    return f'{bytes:.1f}TB'

def format_video_duration(seconds):
    """格式化视频时长 (mm:ss)"""
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f'{h}:{m:02}:{s:02}'
    return f'{m}:{s:02}'

def get_media_info(video):
    """获取视频详细信息"""
    info = {
        'size': 0,
        'duration': 0,
        'width': 0,
        'height': 0,
        'codec': '',
        'bitrate': 0
    }

    # 文件大小
    try:
        info['size'] = os.path.getsize(video)
    except:
        pass

    # 使用 ffprobe 获取详细信息
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json',
             '-show_format', '-show_streams', video],
            capture_output=True, text=True, timeout=10
        )
        data = json.loads(result.stdout)

        # 时长
        if 'format' in data and 'duration' in data['format']:
            info['duration'] = float(data['format']['duration'])

        # 视频流信息
        for stream in data.get('streams', []):
            if stream.get('codec_type') == 'video':
                info['width'] = stream.get('width', 0)
                info['height'] = stream.get('height', 0)
                info['codec'] = stream.get('codec_name', '')
                if 'bit_rate' in stream:
                    info['bitrate'] = int(stream['bit_rate'])
                break

        # 如果视频流没有码率，用总码率
        if not info['bitrate'] and 'format' in data and 'bit_rate' in data['format']:
            info['bitrate'] = int(data['format']['bit_rate'])
    except:
        pass

    return info

def print_file_comparison(input_video, output_video, srt_file):
    """打印输入输出文件对比"""
    input_info = get_media_info(input_video)
    output_info = get_media_info(output_video)

    print('\n文件信息对比:')
    print('-' * 50)
    print(f'{"":12} {"输入":>16}    {"输出":>16}')
    print('-' * 50)

    # 文件大小
    print(f'{"大小":12} {format_size(input_info["size"]):>16}    {format_size(output_info["size"]):>16}')

    # 时长
    if input_info['duration']:
        print(f'{"时长":12} {format_video_duration(input_info["duration"]):>16}    {format_video_duration(output_info["duration"]):>16}')

    # 分辨率
    if input_info['width']:
        in_res = f'{input_info["width"]}x{input_info["height"]}'
        out_res = f'{output_info["width"]}x{output_info["height"]}'
        print(f'{"分辨率":12} {in_res:>16}    {out_res:>16}')

    # 编码
    if input_info['codec']:
        print(f'{"编码":12} {input_info["codec"]:>16}    {output_info["codec"]:>16}')

    # 码率
    if input_info['bitrate']:
        in_br = f'{input_info["bitrate"]//1000}kbps'
        out_br = f'{output_info["bitrate"]//1000}kbps'
        print(f'{"码率":12} {in_br:>16}    {out_br:>16}')

    # SRT 文件大小
    try:
        srt_size = os.path.getsize(srt_file)
        print(f'{"字幕文件":12} {format_size(srt_size):>16}')
    except:
        pass

    print('-' * 50)

def format_ts(sec):
    """转换秒数为 SRT 时间戳格式"""
    h, m, s = int(sec // 3600), int(sec % 3600 // 60), sec % 60
    return f'{h:02}:{m:02}:{s:06.3f}'.replace('.', ',')

def format_ass_ts(sec):
    """转换秒数为 ASS 时间戳格式 (H:MM:SS.cc)"""
    h, m, s = int(sec // 3600), int(sec % 3600 // 60), sec % 60
    return f'{h}:{m:02}:{s:05.2f}'

def parse_srt(content):
    """解析 SRT 内容"""
    blocks = []
    for block in re.split(r'\n\n+', content.strip()):
        lines = block.split('\n')
        if len(lines) >= 3:
            blocks.append({
                'index': lines[0],
                'timestamp': lines[1],
                'text': '\n'.join(lines[2:])
            })
    return blocks

def write_srt(blocks, output):
    """写入 SRT 文件"""
    with open(output, 'w', encoding='utf-8') as f:
        for b in blocks:
            f.write(f"{b['index']}\n{b['timestamp']}\n{b['text']}\n\n")

# ============== 步骤 1: 提取字幕 ==============

def extract_subtitles(video, output, language='en', model='small', word_timestamps=False, no_speech_threshold=0.6):
    """使用 Whisper 提取字幕，自动检测硬件"""
    step_start = time.time()
    print(f'\n[1/4] 提取字幕...')
    print(f'  视频: {video}')
    print(f'  语言: {language}, 模型: {model}')
    print(f'  VAD 过滤: 已启用')
    if word_timestamps:
        print(f'  词级时间戳: 已启用')

    segments = []
    filtered_count = 0

    # 优先级 1: Apple Silicon (mlx-whisper)
    if platform.system() == 'Darwin' and platform.machine() == 'arm64':
        try:
            import mlx_whisper
            print('  引擎: mlx-whisper (Apple Silicon)')
            result = mlx_whisper.transcribe(
                video,
                path_or_hf_repo=f'mlx-community/whisper-{model}-mlx',
                word_timestamps=word_timestamps
            )
            # mlx-whisper 的 no_speech_prob 过滤
            for seg in result['segments']:
                if seg.get('no_speech_prob', 0) > no_speech_threshold:
                    filtered_count += 1
                    continue
                segments.append(seg)
            print(f'  提取 {len(segments)} 条字幕（过滤 {filtered_count} 条非语音），耗时 {format_duration(time.time() - step_start)}')
            return segments
        except ImportError:
            pass

    # 优先级 2: NVIDIA CUDA GPU
    try:
        import torch
        if torch.cuda.is_available():
            from faster_whisper import WhisperModel
            print(f'  引擎: faster-whisper (CUDA GPU: {torch.cuda.get_device_name(0)})')
            whisper_model = WhisperModel(model, device='cuda', compute_type='float16')
            segs, _ = whisper_model.transcribe(
                video,
                language=language,
                word_timestamps=word_timestamps,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500)
            )
            for s in segs:
                # 过滤高 no_speech_prob 的片段
                if s.no_speech_prob > no_speech_threshold:
                    filtered_count += 1
                    continue
                seg = {'start': s.start, 'end': s.end, 'text': s.text}
                if word_timestamps and s.words:
                    seg['words'] = [{'start': w.start, 'end': w.end, 'word': w.word} for w in s.words]
                segments.append(seg)
            print(f'  提取 {len(segments)} 条字幕（过滤 {filtered_count} 条非语音），耗时 {format_duration(time.time() - step_start)}')
            return segments
    except ImportError:
        pass

    # 优先级 3: CPU 回退
    try:
        from faster_whisper import WhisperModel
        print('  引擎: faster-whisper (CPU int8)')
        whisper_model = WhisperModel(model, compute_type='int8')
        segs, _ = whisper_model.transcribe(
            video,
            language=language,
            word_timestamps=word_timestamps,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500)
        )
        for s in segs:
            # 过滤高 no_speech_prob 的片段
            if s.no_speech_prob > no_speech_threshold:
                filtered_count += 1
                continue
            seg = {'start': s.start, 'end': s.end, 'text': s.text}
            if word_timestamps and s.words:
                seg['words'] = [{'start': w.start, 'end': w.end, 'word': w.word} for w in s.words]
            segments.append(seg)
        print(f'  提取 {len(segments)} 条字幕（过滤 {filtered_count} 条非语音），耗时 {format_duration(time.time() - step_start)}')
        return segments
    except ImportError:
        pass

    print('  错误: 未找到 Whisper 后端，请安装 faster-whisper 或 mlx-whisper')
    sys.exit(1)

# ============== 步骤 2: 翻译字幕 ==============

def translate_batch(texts, source='en', target='zh-CN'):
    """批量翻译（使用 Google Translate）"""
    if not texts:
        return texts

    separator = '\n###\n'
    combined = separator.join(texts)

    url = 'https://translate.googleapis.com/translate_a/single'
    params = {
        'client': 'gtx',
        'sl': source,
        'tl': target,
        'dt': 't',
        'q': combined
    }

    full_url = url + '?' + urllib.parse.urlencode(params)

    try:
        req = urllib.request.Request(full_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            translated = ''.join([item[0] for item in result[0] if item[0]])
            return translated.split('###')
    except Exception as e:
        return None

def translate_single(text, source='en', target='zh-CN'):
    """单条翻译"""
    if not text.strip():
        return text

    url = 'https://translate.googleapis.com/translate_a/single'
    params = {'client': 'gtx', 'sl': source, 'tl': target, 'dt': 't', 'q': text}
    full_url = url + '?' + urllib.parse.urlencode(params)

    try:
        req = urllib.request.Request(full_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode('utf-8'))
            return ''.join([item[0] for item in result[0] if item[0]])
    except:
        return text

def translate_subtitles(segments, source='en', target='zh-CN', batch_size=10):
    """批量翻译字幕"""
    step_start = time.time()
    print(f'\n[2/4] 翻译字幕...')
    print(f'  语言: {source} -> {target}')
    print(f'  总计: {len(segments)} 条')

    texts = [s['text'].strip() for s in segments]
    translated = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        batch_num = i // batch_size + 1
        total_batches = (len(texts) + batch_size - 1) // batch_size
        print(f'  翻译批次 {batch_num}/{total_batches}...', end=' ', flush=True)

        result = translate_batch(batch, source, target)
        if result and len(result) == len(batch):
            translated.extend([r.strip() for r in result])
            print('完成')
        else:
            print('批量失败，逐条翻译')
            for text in batch:
                translated.append(translate_single(text, source, target))
                time.sleep(0.1)

        time.sleep(0.2)

    print(f'  翻译 {len(translated)} 条字幕，耗时 {format_duration(time.time() - step_start)}')
    return translated

# ============== 步骤 3: 合并字幕 ==============

def generate_karaoke_ass(segments, output, fontsize=14, margin=25, highlight_color='&H00FFFF&'):
    """生成卡拉OK风格 ASS 字幕（逐词高亮）"""
    step_start = time.time()
    print(f'\n[3/4] 生成卡拉OK字幕...')

    # ASS 文件头
    ass_header = f'''[Script Info]
Title: Karaoke Subtitles
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,{fontsize},&HFFFFFF&,{highlight_color},&H000000&,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,{margin},1
Style: Highlight,Arial,{fontsize},{highlight_color},{highlight_color},&H000000&,&H80000000,1,0,0,0,100,100,0,0,1,2,1,2,10,10,{margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''

    events = []
    for seg in segments:
        start_ts = format_ass_ts(seg['start'])
        end_ts = format_ass_ts(seg['end'])

        if 'words' in seg and seg['words']:
            # 有词级时间戳，生成卡拉OK效果
            karaoke_text = ''
            for word in seg['words']:
                # \kf 是渐变填充效果，duration 单位是厘秒 (1/100秒)
                duration_cs = int((word['end'] - word['start']) * 100)
                karaoke_text += f"{{\\kf{duration_cs}}}{word['word']}"
            events.append(f"Dialogue: 0,{start_ts},{end_ts},Default,,0,0,0,,{karaoke_text}")
        else:
            # 没有词级时间戳，使用普通字幕
            events.append(f"Dialogue: 0,{start_ts},{end_ts},Default,,0,0,0,,{seg['text'].strip()}")

    with open(output, 'w', encoding='utf-8') as f:
        f.write(ass_header)
        f.write('\n'.join(events))

    print(f'  保存到: {output}，耗时 {format_duration(time.time() - step_start)}')
    return output

def merge_bilingual(segments, translated_texts, output, chinese_only=False, source_only=False):
    """合并双语字幕"""
    step_start = time.time()
    if source_only:
        mode = '仅原文'
    elif chinese_only:
        mode = '仅中文'
    else:
        mode = '双语'
    print(f'\n[3/4] 生成{mode}字幕...')

    blocks = []
    for i, seg in enumerate(segments, 1):
        if source_only:
            text = seg['text'].strip()
        elif chinese_only:
            text = translated_texts[i-1].strip()
        else:
            text = f"{seg['text'].strip()}\n{translated_texts[i-1].strip()}"
        blocks.append({
            'index': str(i),
            'timestamp': f"{format_ts(seg['start'])} --> {format_ts(seg['end'])}",
            'text': text
        })

    write_srt(blocks, output)
    print(f'  保存到: {output}，耗时 {format_duration(time.time() - step_start)}')
    return blocks

# ============== 步骤 4: 烧录字幕 ==============

def get_video_info(video):
    """获取视频码率和位深"""
    info = {'bitrate': None, 'bit_depth': 8}

    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-select_streams', 'v:0',
             '-show_entries', 'stream=bit_rate', '-of', 'csv=p=0', video],
            capture_output=True, text=True, timeout=10
        )
        if result.stdout.strip():
            info['bitrate'] = int(result.stdout.strip())
    except:
        pass

    if not info['bitrate']:
        try:
            result = subprocess.run(
                ['ffprobe', '-v', 'quiet', '-show_entries', 'format=bit_rate',
                 '-of', 'csv=p=0', video],
                capture_output=True, text=True, timeout=10
            )
            if result.stdout.strip():
                info['bitrate'] = int(result.stdout.strip())
        except:
            pass

    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-select_streams', 'v:0',
             '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', video],
            capture_output=True, text=True, timeout=10
        )
        pix_fmt = result.stdout.strip().lower()
        if '10' in pix_fmt or 'p010' in pix_fmt:
            info['bit_depth'] = 10
    except:
        pass

    return info

def get_available_encoders():
    """获取可用编码器列表"""
    encoders = set()
    try:
        result = subprocess.run(
            ['ffmpeg', '-hide_banner', '-encoders'],
            capture_output=True, text=True, timeout=10
        )
        for line in result.stdout.split('\n'):
            for enc in ['hevc_nvenc', 'h264_nvenc', 'hevc_amf', 'h264_amf',
                        'hevc_qsv', 'h264_qsv', 'h264_videotoolbox', 'hevc_videotoolbox',
                        'libx265', 'libx264', 'libopenh264']:
                if enc in line:
                    encoders.add(enc)
    except:
        pass
    return encoders

def select_encoder(available_encoders, bit_depth, bitrate_kbps):
    """根据位深和可用编码器选择最佳编码器"""
    system = platform.system()
    bitrate_str = f'{bitrate_kbps}k'

    # 10-bit 视频优先使用 HEVC 编码器
    if bit_depth == 10:
        if 'hevc_nvenc' in available_encoders:
            return 'hevc_nvenc', ['-preset', 'p4', '-b:v', bitrate_str, '-maxrate', f'{int(bitrate_kbps * 1.5)}k', '-bufsize', f'{bitrate_kbps * 2}k']
        if 'hevc_amf' in available_encoders:
            return 'hevc_amf', ['-b:v', bitrate_str]
        if 'hevc_qsv' in available_encoders:
            return 'hevc_qsv', ['-b:v', bitrate_str]
        if 'hevc_videotoolbox' in available_encoders:
            return 'hevc_videotoolbox', ['-b:v', bitrate_str]
        if 'libx265' in available_encoders:
            return 'libx265', ['-preset', 'medium', '-b:v', bitrate_str]

    # 8-bit 视频或回退
    if system == 'Darwin':
        if 'h264_videotoolbox' in available_encoders:
            return 'h264_videotoolbox', ['-b:v', bitrate_str]
        if 'hevc_videotoolbox' in available_encoders:
            return 'hevc_videotoolbox', ['-b:v', bitrate_str]

    # Windows/Linux GPU 编码器
    if 'h264_nvenc' in available_encoders and bit_depth == 8:
        return 'h264_nvenc', ['-preset', 'p4', '-b:v', bitrate_str, '-maxrate', f'{int(bitrate_kbps * 1.5)}k', '-bufsize', f'{bitrate_kbps * 2}k']
    if 'hevc_nvenc' in available_encoders:
        return 'hevc_nvenc', ['-preset', 'p4', '-b:v', bitrate_str, '-maxrate', f'{int(bitrate_kbps * 1.5)}k', '-bufsize', f'{bitrate_kbps * 2}k']
    if 'h264_amf' in available_encoders and bit_depth == 8:
        return 'h264_amf', ['-b:v', bitrate_str]
    if 'hevc_amf' in available_encoders:
        return 'hevc_amf', ['-b:v', bitrate_str]
    if 'h264_qsv' in available_encoders and bit_depth == 8:
        return 'h264_qsv', ['-b:v', bitrate_str]
    if 'hevc_qsv' in available_encoders:
        return 'hevc_qsv', ['-b:v', bitrate_str]

    # 软件编码回退
    if 'libx265' in available_encoders:
        return 'libx265', ['-preset', 'medium', '-b:v', bitrate_str]
    if 'libx264' in available_encoders:
        return 'libx264', ['-preset', 'fast', '-b:v', bitrate_str]
    if 'libopenh264' in available_encoders:
        return 'libopenh264', ['-b:v', bitrate_str]

    return None, None

def burn_subtitles(video, subtitle_file, output, fontsize=14, margin=25, is_ass=False):
    """烧录字幕到视频"""
    step_start = time.time()
    print(f'\n[4/4] 烧录字幕...')

    # 获取源视频信息（读取一次）
    video_info = get_video_info(video)
    src_bitrate = video_info['bitrate']
    bit_depth = video_info['bit_depth']

    # 默认 2000kbps
    bitrate_kbps = (src_bitrate // 1000) if src_bitrate else 2000

    print(f'  源码率: {bitrate_kbps}kbps')
    print(f'  位深: {bit_depth}-bit')

    # 获取可用编码器（检测一次）
    available_encoders = get_available_encoders()
    print(f'  可用编码器: {", ".join(sorted(available_encoders)) if available_encoders else "未检测到"}')

    # 选择最佳编码器
    encoder, encoder_opts = select_encoder(available_encoders, bit_depth, bitrate_kbps)

    if not encoder:
        print('  错误: 未找到可用的视频编码器')
        print('  请安装支持 libx264 或 libx265 的 FFmpeg')
        return False

    print(f'  选择编码器: {encoder}')

    # 转义字幕路径
    sub_escaped = subtitle_file.replace('\\', '/').replace(':', r'\:')

    # ASS 字幕使用 ass 滤镜，SRT 使用 subtitles 滤镜
    if is_ass:
        vf = f"ass='{sub_escaped}'"
    else:
        style = f"FontSize={fontsize},MarginV={margin},BorderStyle=4,BackColour=&H80000000"
        vf = f"subtitles='{sub_escaped}':force_style='{style}'"

    cmd = [
        'ffmpeg', '-y',
        '-i', video,
        '-vf', vf,
        '-c:v', encoder,
        *encoder_opts,
        '-c:a', 'copy',
        output
    ]

    print(f'  输出: {output}')
    print('  编码中...', flush=True)

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode == 0:
        print(f'  完成，耗时 {format_duration(time.time() - step_start)}')
        return True

    # 编码器失败，尝试回退
    print(f'  编码器 {encoder} 失败，尝试其他编码器...')

    fallback_order = []
    if bit_depth == 10:
        fallback_order = ['hevc_nvenc', 'hevc_amf', 'hevc_qsv', 'libx265', 'libopenh264']
    else:
        fallback_order = ['h264_nvenc', 'hevc_nvenc', 'h264_amf', 'hevc_amf', 'libx264', 'libx265', 'libopenh264']

    for fallback_enc in fallback_order:
        if fallback_enc in available_encoders and fallback_enc != encoder:
            print(f'  尝试: {fallback_enc}')
            _, fallback_opts = select_encoder({fallback_enc}, bit_depth, bitrate_kbps)

            cmd = [
                'ffmpeg', '-y',
                '-i', video,
                '-vf', vf,
                '-c:v', fallback_enc,
                *fallback_opts,
                '-c:a', 'copy',
                output
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                print(f'  完成，耗时 {format_duration(time.time() - step_start)}')
                return True

    print(f'  错误: 所有编码器均失败')
    print(f'  最后错误: {result.stderr[-500:] if result.stderr else "未知错误"}')
    return False

# ============== 主程序 ==============

def main():
    start_time = time.time()

    parser = argparse.ArgumentParser(
        description='双语字幕一键生成工具',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  python process.py video.mp4
  python process.py video.mp4 -o output.mp4 -l en -t zh-CN
  python process.py video.mp4 --fontsize 16 --margin 30
        '''
    )
    parser.add_argument('video', help='输入视频文件')
    parser.add_argument('-o', '--output', help='输出视频文件')
    parser.add_argument('-l', '--language', default='en', help='源语言 (默认: en)')
    parser.add_argument('-t', '--target', default='zh-CN', help='目标语言 (默认: zh-CN)')
    parser.add_argument('-m', '--model', default='small', help='Whisper 模型 (默认: small)')
    parser.add_argument('--fontsize', type=int, default=14, help='字幕字号 (默认: 14)')
    parser.add_argument('--margin', type=int, default=25, help='字幕底部边距 (默认: 25)')
    parser.add_argument('--srt-only', action='store_true', help='仅生成 SRT，跳过视频编码')
    parser.add_argument('--chinese-only', action='store_true', help='仅输出中文字幕（适用于已有英文硬字幕的视频）')
    parser.add_argument('--source-only', action='store_true', help='仅输出原文字幕（不翻译）')
    parser.add_argument('--karaoke', action='store_true', help='卡拉OK模式（逐词高亮）')
    parser.add_argument('--highlight-color', default='&H00FFFF&', help='高亮颜色 ASS 格式 (默认: &H00FFFF& 黄色)')
    parser.add_argument('--no-speech-threshold', type=float, default=0.6, help='非语音过滤阈值 0-1 (默认: 0.6)')
    args = parser.parse_args()

    # 互斥检查
    if args.chinese_only and args.source_only:
        print('错误: --chinese-only 和 --source-only 不能同时使用')
        return 1

    if args.karaoke and (args.chinese_only or not args.source_only and not args.chinese_only):
        # 卡拉OK模式强制为仅原文
        if not args.source_only:
            print('提示: 卡拉OK模式自动启用 --source-only（仅原文）')
            args.source_only = True

    # 验证输入
    if not os.path.exists(args.video):
        print(f'错误: 视频文件不存在: {args.video}')
        return 1

    # 设置输出路径
    video_dir = os.path.dirname(os.path.abspath(args.video))
    video_base = os.path.splitext(os.path.basename(args.video))[0]

    if args.karaoke:
        suffix = '_karaoke'
        sub_ext = '.ass'
    elif args.source_only:
        suffix = '_source'
        sub_ext = '.srt'
    elif args.chinese_only:
        suffix = '_zh'
        sub_ext = '.srt'
    else:
        suffix = '_bilingual'
        sub_ext = '.srt'
    subtitle_output = os.path.join(video_dir, f'{video_base}{suffix}{sub_ext}')
    video_output = args.output or os.path.join(video_dir, f'{video_base}{suffix}.mp4')

    print('=' * 50)
    print('双语字幕生成器')
    print('=' * 50)
    print(f'输入: {args.video}')
    print(f'输出: {video_output}')

    # 步骤 1: 提取
    segments = extract_subtitles(args.video, None, args.language, args.model, word_timestamps=args.karaoke, no_speech_threshold=args.no_speech_threshold)

    # 步骤 2: 翻译（source_only 或 karaoke 模式跳过）
    if args.source_only or args.karaoke:
        print(f'\n[2/4] 跳过翻译（仅原文模式）')
        translated = []
    else:
        translated = translate_subtitles(segments, args.language, args.target)

    # 步骤 3: 生成字幕
    if args.karaoke:
        generate_karaoke_ass(segments, subtitle_output, args.fontsize, args.margin, args.highlight_color)
    else:
        merge_bilingual(segments, translated, subtitle_output, args.chinese_only, args.source_only)

    # 步骤 4: 烧录（可选）
    if not args.srt_only:
        success = burn_subtitles(args.video, subtitle_output, video_output, args.fontsize, args.margin, is_ass=args.karaoke)
        if not success:
            return 1

    elapsed = time.time() - start_time

    # 显示文件对比信息
    if not args.srt_only:
        print_file_comparison(args.video, video_output, subtitle_output)

    print('\n' + '=' * 50)
    print('处理完成!')
    print(f'  字幕: {subtitle_output}')
    if not args.srt_only:
        print(f'  视频: {video_output}')
    print(f'  总耗时: {format_duration(elapsed)}')
    print('=' * 50)

    return 0

if __name__ == '__main__':
    sys.exit(main())
