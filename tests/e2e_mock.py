"""Synthetic Chrome-like storage and Telegram-like DOM. Never reaches Telegram."""
from pathlib import Path
from playwright.sync_api import sync_playwright
base=Path(__file__).resolve().parents[1]

def start(page, html, preset=None):
    page.set_content(html)
    page.add_script_tag(content="""
      window.__mockStore = JSON.parse(window.__PRESET || '{}');
      window.chrome = {storage:{local:{
        get:async function(k){if(k===null) return {...window.__mockStore};let r={};if(Array.isArray(k))for(const q of k)r[q]=window.__mockStore[q];else r[k]=window.__mockStore[k];return r;},
        set:async function(v){Object.assign(window.__mockStore,v);},
        remove:async function(k){delete window.__mockStore[k];}
      }}};
    """.replace("window.__PRESET",repr(__import__('json').dumps(preset or {},ensure_ascii=False))))
    for script in ('scanner.js','profiles.js','content.js'):
        page.add_script_tag(path=str(base/script))
    page.wait_for_selector('#cc-profile')

def html_fixture(statuses, search=True, extras=''):
    html='''<!doctype html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial;margin:15px}.ListItem{height:54px;padding:5px;border:1px solid #ddd}.name,.status{display:block}
    #scroller{height:210px;width:min(380px,calc(100vw - 42px));overflow-y:auto;border:2px solid}
    </style></head><body>'''
    html+=extras+'<main id="modal"><h2>Подписчики</h2>'
    if search:html+='<input type="search" id="members-search" placeholder="Поиск">'
    html+='<div id="scroller">'
    for i, status in enumerate(statuses):
        html+=f'<div class="ListItem"><span class="name">Человек {i}</span><span class="status">{status}</span></div>'
    return html+'</div></main></body></html>'

def add(page,name):
    page.locator('#cc-name').fill(name)
    page.locator('#cc-add').click()
    page.wait_for_function('(n)=>document.querySelector("#cc-message").textContent.includes(n)',arg='Выбран «'+name+'»')
    assert page.locator('#cc-profile option').count()>=2
    assert page.locator('#cc-profile').input_value()

def choose(page,name):
    page.locator('#cc-profile').select_option(label=name+' · '+('10' if name=='@канал-А' else '0')+' групп')
    page.wait_for_function('(n)=>document.querySelector("#cc-message").textContent.includes(n)',arg='Выбран «'+name+'»')

def accept(page):
    page.locator('#cc-scope').check()
    page.wait_for_function('document.querySelector("#cc-message").textContent.includes("Запускай проверку")')

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':900,'height':700},accept_downloads=True)
    page.on('dialog',lambda d:d.accept())
    statuses=['был(а) недавно' if i<10 else 'был(а) давно' for i in range(20)]
    start(page,html_fixture(statuses,extras='<aside><div class="ListItem"><span>ПОСТОРОННИЙ</span><span>был(а) давно</span></div></aside>'))
    page.locator('#cc-auto').click()
    assert 'Сначала выбери канал' in page.locator('#cc-message').inner_text()
    add(page,'@канал-А')
    page.locator('#members-search').fill('в')
    page.locator('#cc-scope').click()
    assert not page.locator('#cc-scope').is_checked()
    assert 'Очисти поиск' in page.locator('#cc-message').inner_text()
    page.locator('#members-search').fill('')
    accept(page)
    page.locator('#cc-check').click()
    assert 'Видимых статусов' in page.locator('#cc-message').inner_text()
    page.locator('#cc-auto').click()
    page.wait_for_function('!document.querySelector("#cc-count").textContent.includes("идёт сканирование") && document.querySelector("#cc-message").textContent.includes("Прокрутка закончена")',timeout=30000)
    assert page.locator('#cc-count').inner_text().startswith('Кандидатов: 10')
    assert 'ПОСТОРОННИЙ' not in page.locator('#cc-list').inner_text()
    with page.expect_download() as dl:
        page.locator('#cc-export').click()
    csv=Path(dl.value.path()).read_text(encoding='utf-8-sig')
    assert '@канал-А' in csv and 'Человек 10' in csv and 'ПОСТОРОННИЙ' not in csv
    # Profile 1 custom settings.
    page.locator('#cc-steps').fill('34')
    page.locator('#cc-pause').fill('810')
    page.locator('#cc-save-settings').click()
    page.wait_for_function('document.querySelector("#cc-message").textContent.includes("сохранены отдельно")')
    # New profile with isolated empty candidates and independent defaults.
    add(page,'@канал-Б')
    assert page.locator('#cc-count').inner_text().startswith('Кандидатов: 0')
    assert page.locator('#cc-steps').input_value()=='180'
    assert page.locator('#cc-pause').input_value()=='800'
    # Switch back A without re-adding; scan confirmation resets.
    page.locator('#cc-profile').select_option(label='@канал-А · 10 групп')
    page.wait_for_function('document.querySelector("#cc-count").textContent.includes("10")')
    assert not page.locator('#cc-scope').is_checked()
    assert page.locator('#cc-steps').input_value()=='34'
    assert page.locator('#cc-pause').input_value()=='810'
    # Rename without changing data or local storage ID.
    profile_id=page.locator('#cc-profile').input_value()
    page.locator('#cc-name').fill('@канал-А-новый')
    page.locator('#cc-rename').click()
    page.wait_for_function('document.querySelector("#cc-message").textContent.includes("переименован")')
    assert page.locator('#cc-profile').input_value()==profile_id
    assert page.locator('#cc-count').inner_text().startswith('Кандидатов: 10')
    with page.expect_download() as dl:
        page.locator('#cc-export').click()
    assert '@канал-А-новый' in Path(dl.value.path()).read_text(encoding='utf-8-sig')
    # Duplicates rejected and profiles unchanged.
    page.locator('#cc-name').fill('@канал-Б')
    page.locator('#cc-add').click()
    page.wait_for_function('document.querySelector("#cc-message").textContent.includes("уже есть")')
    assert page.locator('#cc-profile option').count()==3
    # Deleting profile does not delete another profile or Telegram users.
    page.locator('#cc-profile').select_option(label='@канал-Б · 0 групп')
    page.wait_for_function('document.querySelector("#cc-count").textContent.includes("0")')
    page.locator('#cc-remove').click()
    page.wait_for_function('document.querySelector("#cc-message").textContent.includes("Профиль удалён")')
    assert page.locator('#cc-profile option').count()==2
    assert page.locator('#cc-count').inner_text().startswith('Кандидатов: 10')
    # Reload data into second page - browser storage is mocked but persists at snapshot.
    data=page.evaluate('structuredClone(window.__mockStore)')
    reloaded=browser.new_page(viewport={'width':390,'height':844},accept_downloads=True)
    start(reloaded,html_fixture(statuses),data)
    reloaded.wait_for_function('document.querySelector("#cc-count").textContent.includes("10")')
    assert reloaded.locator('#cc-steps').input_value()=='34'
    assert reloaded.locator('#cc-profile option').count()==2
    assert reloaded.evaluate('document.documentElement.scrollWidth <= innerWidth')
    # v0.3 migration preserves old data and does not destroy source.
    legacy=browser.new_page(viewport={'width':900,'height':700})
    start(legacy,html_fixture(statuses),{'channelCleanerV3:%40old': [{'name':'Катя','status':'была давно','capturedAt':'2026-11-20'}], 'channelCleanerV3:last':'@old'})
    legacy.wait_for_function('document.querySelector("#cc-count").textContent.includes("1")')
    assert legacy.locator('#cc-profile option').count()==2
    assert legacy.evaluate("Object.keys(window.__mockStore).some(k=>k.startsWith('channelCleanerV3:%40old'))")
    # If subscriber modal disappears, checks fail closed.
    reloaded.locator('#modal').evaluate('(el)=>el.remove()')
    reloaded.locator('#cc-scope').click()
    assert not reloaded.locator('#cc-scope').is_checked()
    browser.close()
print('E2E synthetic PASS: two channels, independent settings, rename, remove, migration, export, viewport, fail closed')
