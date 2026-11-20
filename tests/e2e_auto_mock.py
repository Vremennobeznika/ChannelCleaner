"""Local UI test: fake bot and fake Telegram subscriber list. NO real Telegram side effects."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]

def page_setup(page, ids):
    page.set_content('<html><head><meta charset="utf-8"><style>#s{height:195px;overflow-y:auto;width:320px}.r{height:56px}.name,.status{display:block}</style></head><body><section><h2>Подписчики</h2><input type="search"/><div id="s">'+''.join(f'<div class="r" '+(f'data-peer-id="{uid}"' if uid else '')+f'><span class="name">Пользователь {i}</span><span class="status">был(а) давно</span></div>' for i,uid in enumerate(ids))+'</div></section></body></html>')
    page.add_script_tag(content="""
        window.__store={};window.__requests=[];
        window.chrome={storage:{local:{get:async k=>k===null?{...window.__store}:{[k]:window.__store[k]},set:async d=>Object.assign(window.__store,d),remove:async k=>delete window.__store[k]}},runtime:{lastError:null,sendMessage:(req,cb)=>{window.__requests.push(req); if(req.type==='CHANNEL_CLEANER_CHECK_CHANNEL') cb({ok:true,title:'Демо-канал',chatId:'-10012345678901'});else if(req.type==='CHANNEL_CLEANER_REMOVE_MEMBER')cb({ok:true,removed:true,userId:req.userId});else cb({ok:false,error:'wrong test action'});}}};
    """)
    for file in ('scanner.js','profiles.js','content.js'): page.add_script_tag(path=str(root/file))
    page.wait_for_selector('#cc-name')
    page.locator('#cc-name').fill('@mychannel')
    page.locator('#cc-add').click()
    page.wait_for_function('document.querySelector("#cc-message").textContent.includes("Выбран")')
    page.locator('#cc-chat').fill('@mychannel')
    page.locator('#cc-max-remove').fill('2')
    page.locator('#cc-save-settings').click()
    page.wait_for_function('document.querySelector("#cc-message").textContent.includes("сохранены")')
    page.locator('#cc-scope').check()
    page.wait_for_function('document.querySelector("#cc-message").textContent.includes("Запускай")')

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':920,'height':720})
    page.on('dialog',lambda dialog:dialog.accept())
    page_setup(page,['123456789','123456790','123456791','123456792'])
    page.locator('#cc-remove-auto').click()
    page.wait_for_function('document.querySelector("#cc-message").textContent.includes("Лимит достигнут")',timeout=15000)
    requests=page.evaluate('window.__requests')
    acts=[x for x in requests if x['type']=='CHANNEL_CLEANER_REMOVE_MEMBER']
    assert len(acts)==2, requests
    assert all(x['chatRef']=='@mychannel' for x in acts)
    assert [x['userId'] for x in acts]==['123456789','123456790']
    assert 'удалено: 2' in page.locator('#cc-count').inner_text()
    # Missing IDs (even with matching names and statuses) must never be removed.
    second=browser.new_page(viewport={'width':900,'height':700})
    second.on('dialog',lambda dialog:dialog.accept())
    page_setup(second,['','','','','','',''])
    second.locator('#cc-remove-auto').click()
    second.wait_for_function('!document.querySelector("#cc-count").textContent.includes("идёт обход") && document.querySelector("#cc-message").textContent.includes("Прокрутка закончена")',timeout=15000)
    requests=second.evaluate('window.__requests')
    assert not [x for x in requests if x['type']=='CHANNEL_CLEANER_REMOVE_MEMBER']
    assert 'с ID: 0' in second.locator('#cc-count').inner_text()
    browser.close()
print('E2E auto mock PASS: 2 confirmed removals max, correct chat, no-ID zero removals, simulated Bot API')
