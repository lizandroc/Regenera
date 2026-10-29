"""Build the Cloudflare Pages site from the reviewed artifact page.

    python3 build.py <artifact index.html> <legal.html> <media dir> <img dir> <fonts dir or ->

Writes public/: a standalone index.html (doctype, head, CSP-friendly external app.js),
legal.html, the referenced images and videos, _headers and robots.txt.
"""
import re, shutil, sys, pathlib

src, legal, media_dir, img_dir, fonts_dir = sys.argv[1:6]
here = pathlib.Path(__file__).parent
out = here / 'public'
# Clear the previous build but keep the hand-written dashboard (public/admin) and font notes.
out.mkdir(exist_ok=True)
for item in out.iterdir():
    if item.name == 'admin':
        continue
    if item.name == 'fonts':
        for f in item.iterdir():
            if f.name != 'README.md':
                f.unlink()
        continue
    shutil.rmtree(item) if item.is_dir() else item.unlink()

page = open(src, encoding='utf-8').read()
scripts = re.findall(r'<script>\n?(.*?)</script>', page, flags=re.S)
assert len(scripts) == 1, 'expected one inline script'
(out / 'app.js').write_text(scripts[0], encoding='utf-8')
page = re.sub(r'<script>.*?</script>', '<script src="app.js" defer></script>', page, flags=re.S)
page = page.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
page = page.replace('family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap',
                    'family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Quicksand:wght@400;700&display=swap')
head = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Regenera brings together distinctive places, aligned capital, operating expertise, and multidisciplinary capabilities to create regenerative wellness destinations.">
<meta name="turnstile-sitekey" content="">
<meta name="copyright" content="© 2026 Regenera. All rights reserved.">
<style>
  html, body { margin: 0; }
  [hidden] { display: none !important; }
</style>
'''
title_end = page.index('</style>') + len('</style>')
page = head + page[:title_end] + '\n</head>\n<body>\n' + page[title_end:].lstrip('\n') + '\n</body>\n</html>\n'
(out / 'index.html').write_text(page, encoding='utf-8')
shutil.copy(legal, out / 'legal.html')

refs = set(re.findall(r'(?:src|poster)="((?:img|media)/[^"]+)"|url\("((?:img|media)/[^"]+)"\)', page))
refs = {a or b for a, b in refs}
for r in sorted(refs):
    d = media_dir if r.startswith('media/') else img_dir
    f = pathlib.Path(d) / r.split('/', 1)[1]
    assert f.exists(), f'missing asset {f}'
    (out / r).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(f, out / r)
if fonts_dir != '-':
    (out / 'fonts').mkdir(exist_ok=True)
    for f in pathlib.Path(fonts_dir).glob('*.ttf'):
        shutil.copy(f, out / 'fonts' / f.name)

shutil.copy(here / '_headers', out / '_headers')
(out / 'robots.txt').write_text('User-agent: *\nAllow: /\n', encoding='utf-8')
print('built', len(refs), 'assets')
