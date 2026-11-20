"""Headless local DOM benchmark, NOT real Telegram performance."""
from pathlib import Path
from statistics import median
from playwright.sync_api import sync_playwright
base=Path(__file__).resolve().parents[1]

def html_for(n):
    body=''.join(f'<div class="row" style="height:45px"><span class="name">Имя {i}</span><span class="status">{"был давно" if i%2 else "был недавно"}</span></div>' for i in range(n))
    return f'<html><head><meta charset="utf-8"></head><body><main><h2>Подписчики</h2><div id="s" style="overflow-y:auto;height:200px;width:380px">{body}</div></main></body></html>'

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1000,'height':800})
    for n in (100,1000,3000):
        page.set_content(html_for(n))
        page.add_script_tag(path=str(base/'scanner.js'))
        page.add_script_tag(content="""window.__mockStore = {}; window.chrome = {storage:{local:{get:async k=>k===null?{...window.__mockStore}:{[k]:window.__mockStore[k]},set:async d=>Object.assign(window.__mockStore,d),remove:async k=>delete window.__mockStore[k]}}};""")
        page.add_script_tag(path=str(base/'profiles.js'))
        page.add_script_tag(path=str(base/'content.js'))
        page.locator('#cc-name').fill('@benchmark')
        page.locator('#cc-add').click()
        page.wait_for_function('document.querySelector("#cc-message").textContent.includes("Выбран")')
        page.locator('#cc-scope').check()
        page.wait_for_function('document.querySelector("#cc-message").textContent.includes("Запускай проверку")')
        samples=[]
        for i in range(5):
            delta=page.evaluate('''() => {const t=performance.now();document.querySelector('#cc-check').click();return performance.now()-t}''')
            samples.append(delta)
        print(f'{n} rows in DOM; click synchronous scanning median {median(samples):.1f} ms; max {max(samples):.1f} ms, n=5')
        page.reload() if False else None
        page.close()
        page=browser.new_page(viewport={'width':1000,'height':800})
    browser.close()
