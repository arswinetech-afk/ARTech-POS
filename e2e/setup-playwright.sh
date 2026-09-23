#!/usr/bin/env bash
# One-shot Playwright setup for a minimal Debian sandbox without root:
#   installs playwright + chromium into /tmp/pw and unpacks the handful of
#   missing shared libraries into /tmp/libs (no sudo needed).
# Usage:  bash e2e/setup-playwright.sh
#         export LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu:/tmp/libs/lib/x86_64-linux-gnu
#         (cd /tmp/pw && node /path/to/e2e/<script>.mjs)
set -euo pipefail
mkdir -p /tmp/pw /tmp/libs /tmp/debs
cd /tmp/pw
[ -d node_modules/playwright ] || { npm init -y >/dev/null; npm i playwright@1.49.1 --no-audit --no-fund; }
npx playwright install chromium >/dev/null 2>&1 || true
cd /tmp/debs
python3 - <<'EOF'
import re, urllib.request, subprocess, os
POOL = 'https://deb.debian.org/debian/pool/main/'
pk = {  # package -> pool directory (Debian 13 "trixie" names)
  'libxdamage1': 'libx/libxdamage/', 'libasound2t64': 'a/alsa-lib/', 'libatk1.0-0t64': 'a/at-spi2-core/',
  'libatk-bridge2.0-0t64': 'a/at-spi2-core/', 'libatspi2.0-0t64': 'a/at-spi2-core/', 'libnspr4': 'n/nspr/',
  'libnss3': 'n/nss/', 'libxkbcommon0': 'libx/libxkbcommon/', 'libxres1': 'libx/libxres/',
}
def ver_key(v): return [int(x) if x.isdigit() else x for x in re.split(r'[^0-9a-zA-Z]+', v)]
for pkg, d in pk.items():
    html = urllib.request.urlopen(POOL + d, timeout=30).read().decode()
    files = re.findall(r'href="(%s_[^"]+_amd64\.deb)"' % re.escape(pkg), html)
    files = [f for f in files if 'bpo' not in f and '~exp' not in f] or files
    files.sort(key=lambda f: ver_key(f.split('_')[1]))
    f = files[-1]
    if not os.path.exists(f): urllib.request.urlretrieve(POOL + d + f, f)
    subprocess.run(['dpkg-deb', '-x', f, '/tmp/libs'], check=True)
    print('unpacked', f)
EOF
echo "OK. export LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu:/tmp/libs/lib/x86_64-linux-gnu"
