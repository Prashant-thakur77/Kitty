"""Places a portrait phone screen recording inside the 1920x1080 demo frame: a blurred, darkened copy of the clip
fills the background, the clip itself sits centred in a rounded dark bezel. Output length = input length.
Usage: python3 scripts/media/phone-frame.py <phone.mp4|mov> <out.mp4>"""
import subprocess, sys
src, out = sys.argv[1], sys.argv[2]
H = 1000                                      # phone height inside the 1080 frame
vf = (
    f"[0:v]split=2[bg][fg];"
    f"[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=40,eq=brightness=-0.35:saturation=0.6[bgb];"
    f"[fg]scale=-2:{H}:flags=lanczos,format=rgba,"
    f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-max(min(X,W-40),40),Y-max(min(Y,H-40),40)),40),255,0)'[fgr];"
    f"[bgb][fgr]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuv420p[v]"
)
subprocess.check_call(['ffmpeg', '-y', '-v', 'error', '-i', src, '-filter_complex', vf, '-map', '[v]', '-an',
                       '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', out])
print('framed', out)
