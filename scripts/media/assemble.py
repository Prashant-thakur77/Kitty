"""Assemble the demo: per-segment mp4 (video trimmed to the measured length, narration padded to it),
concat, a quiet room-tone bed so there is never dead air, burned captions, and a faststart mp4.
Usage: python3 scripts/media/assemble.py <narrationDir> <recordDir> <out.mp4>"""
import json, os, subprocess, sys, textwrap

NARR, REC, OUT = sys.argv[1:4]
meta = json.load(open(os.path.join(NARR, 'durations.json')))
text, dur = meta['text'], meta['durations']
timeline = json.load(open(os.path.join(REC, 'timeline.json')))
work = os.path.join(REC, 'work'); os.makedirs(work, exist_ok=True)
run = lambda *a: subprocess.run(a, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)

# Playwright writes one webm per page; several segments may share a file. Split by cumulative offset.
offset = {}
for t in timeline:
    t['start'] = offset.get(t['file'], 0.0)
    offset[t['file']] = t['start'] + t['seconds']

# segments that are mostly a page waiting on the steward may be compressed harder than the rest
MAX_SPEED = {'08_miss': 1.8, '04_enable': 1.5, '05_live': 1.9, '05b_create': 2.05}
# the 3D story chapters carry their own on-screen captions
NO_CAPTIONS = {'02_problem', '03_split', '04_enable'}
parts, srt, clock = [], [], 0.0
for i, t in enumerate(timeline):
    name, sec = t['name'], t['seconds']
    seg = os.path.join(work, f'{i:02d}_{name}.mp4')
    wav = os.path.join(NARR, name + '.wav')
    card = name in ('01_hook', '13_close')  # title cards get a fade
    # when the on-chain actions ran longer than the narration, gently speed the picture up to fit so the
    # voice never falls silent while the screen is still busy (never more than 1.35x)
    cap = MAX_SPEED.get(name, 1.35)
    target = max(dur[name] + 0.5, sec / cap)
    speed = sec / target
    vf = f"trim=start={t['start']:.3f}:duration={sec:.3f},setpts=PTS-STARTPTS,setpts=PTS/{speed:.4f},scale=1920:1080:flags=lanczos,fps=30,format=yuv420p"
    sec = target
    if card: vf += f",fade=t=in:st=0:d=0.6,fade=t=out:st={max(0, sec-0.8):.2f}:d=0.8"
    af = f"aresample=48000,apad=whole_dur={sec:.3f},atrim=0:{sec:.3f},afade=t=in:st=0:d=0.05"
    run('ffmpeg', '-y', '-i', t['file'], '-i', wav, '-filter_complex', f"[0:v]{vf}[v];[1:a]{af}[a]", '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-c:a', 'aac', '-b:a', '160k', '-t', f'{sec:.3f}', seg)
    parts.append(seg)
    # caption: the narration text, wrapped into ≤2-line cues spread across the clip
    words = text[name].split()
    cues = [] if name in NO_CAPTIONS else textwrap.wrap(text[name], 78)
    per = dur[name] / max(1, len(cues))
    for j, cue in enumerate(cues):
        a, b = clock + j * per, clock + min((j + 1) * per, dur[name])
        fmt = lambda s: f"{int(s//3600):02d}:{int(s%3600//60):02d}:{int(s%60):02d},{int((s%1)*1000):03d}"
        srt.append(f"{len(srt)+1}\n{fmt(a)} --> {fmt(b - 0.05)}\n{cue}\n")
    clock += sec
    print(f"{name:12s} {sec:5.1f}s", flush=True)

with open(os.path.join(work, 'list.txt'), 'w') as f:
    for p in parts: f.write(f"file '{p}'\n")
open(os.path.join(work, 'captions.srt'), 'w').write("\n".join(srt))
joined = os.path.join(work, 'joined.mp4')
run('ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', os.path.join(work, 'list.txt'), '-c', 'copy', joined)

# room tone: filtered noise far below the voice, so pauses are never digital silence; captions burned in
style = "FontName=DejaVu Sans,FontSize=15,PrimaryColour=&H00E8F0EB,OutlineColour=&H80000000,BackColour=&H90000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=42,Alignment=2"
srt_path = os.path.join(work, 'captions.srt').replace(':', '\\:')
run('ffmpeg', '-y', '-i', joined, '-f', 'lavfi', '-i', f'anoisesrc=color=brown:amplitude=0.05:sample_rate=48000:duration={clock:.2f}',
    '-filter_complex', f"[1:a]lowpass=f=180,volume=0.18[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0[a];[0:v]subtitles='{srt_path}':force_style='{style}'[v]",
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT)
print(f"done {OUT} · {clock:.1f}s")
