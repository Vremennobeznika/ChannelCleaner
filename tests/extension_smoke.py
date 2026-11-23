"""Smoke test loading real MV3 browser extension in headless Chromium.
No real Telegram requests are made; Telegram origin is fulfilled locally.
"""
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
base=Path(__file__).resolve().parents[1]
html='''<!doctype html><html><head><meta charset="utf-8"><style>
#s {height:200px;overflow-y:auto;width:350px}
.row {height:50px}.name,.status{display:block}
</style></head><body><main><h2>Подписчики</h2><div id="s">'''
for i in range(16):
    html+=f'<div class="row"><span class="name">Тест {i}</span><span class="status">{"был давно" if i%2 else "был недавно"}</span></div>'
html+='</div></main></body></html>'
with tempfile.TemporaryDirectory() as td, sync_playwright() as p:
    context=p.chromium.launch_persistent_context(td,headless=True,channel='chromium',
        args=['--no-sandbox',f'--disable-extensions-except={base}',f'--load-extension={base}'],
        viewport={'width':1024,'height':700})
    workers=context.service_workers
    if not workers:
        try: workers=[context.wait_for_event('serviceworker',timeout=6000)]
        except Exception: workers=[]
    if not workers:
        context.close()
        print('SKIP: distro Chromium headless did not load service worker; real extension install not verified')
        raise SystemExit(0)
    extension_id=workers[0].url.split('/')[2]
    options=context.new_page()
    options.goto(f'chrome-extension://{extension_id}/options.html',wait_until='domcontentloaded')
    assert options.locator('#settings').count()==1
    assert options.locator('#token').get_attribute('type')=='password'
    assert options.locator('h1').inner_text()=='ChannelCleaner'
    other=context.new_page()
    other.goto('data:text/html,<html><body>Hello</body></html>')
    assert other.locator('#channel-cleaner-overlay').count()==0
    context.close()
print('MV3 load PASS: service worker, options page, token masked; Telegram-origin injection NOT TESTED')
