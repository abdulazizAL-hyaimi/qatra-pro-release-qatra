#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PATHS = [
    'app/src/main/java/com/qatra/pro/UnifiedMainActivity.java',
    'app/src/main/java/com/qatra/pro/MainActivity.java',
]

for relative in PATHS:
    path = ROOT / relative
    value = path.read_text(encoding='utf-8')
    # Generated integrations must not accumulate blank lines across idempotent runs.
    stable = re.sub(r'\n{3,}', '\n\n', value).rstrip() + '\n'
    path.write_text(stable, encoding='utf-8')

print('Unified ERP generated source formatting is stable.')
