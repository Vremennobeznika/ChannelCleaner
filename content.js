(() => {
  'use strict';
  if (window.__ChannelCleanerLoaded) return;
  window.__ChannelCleanerLoaded = true;
  const P = window.ChannelCleanerPolicy;
  const M = window.ChannelCleanerProfiles;
  const MAX_GROUPS = 25000;
  const rows = new Map();
  const run = {active:false,stop:false,scanned:0,removed:0,skipped:0};
  let acceptedScope=false, scopeLocation='', currentChannel='', currentProfileId='';
  let profiles=[], savedChain=Promise.resolve(), switchSerial=0;
  let panel,statusEl,resultEl,listEl,scopeEl,profileEl,nameEl,stepsEl,pauseEl,chatEl,maxRemoveEl;

  async function updateProfiles() {
    if (!chrome?.storage?.local) throw new Error('Нет доступа к хранилищу расширения.');
    await chrome.storage.local.set({[M.PREFIX+'profiles']:profiles});
  }
  function activeProfile() { return profiles.find(x=>x.id===currentProfileId)||null; }
  function invalidateScope() {
    acceptedScope=false;scopeLocation='';run.stop=true;
    if(scopeEl) scopeEl.checked=false;
  }
  function renderProfiles() {
    if(!profileEl) return;
    const selected=currentProfileId;
    profileEl.replaceChildren();
    const placeholder=document.createElement('option');
    placeholder.value='';placeholder.textContent='— Выбери канал —';
    profileEl.append(placeholder);
    for (const p of profiles) {
      const option=document.createElement('option');
      option.value=p.id;
      option.textContent=p.label+' · '+p.lastCount+' групп';
      profileEl.append(option);
    }
    profileEl.value=selected;
    const profile=activeProfile();
    if(nameEl) nameEl.value=profile?.label||'';
    if(stepsEl) stepsEl.value=String(profile?.settings.maxSteps??M.DEFAULT_SETTINGS.maxSteps);
    if(pauseEl) pauseEl.value=String(profile?.settings.pauseMs??M.DEFAULT_SETTINGS.pauseMs);
    if(chatEl)chatEl.value=profile?.settings.chatRef||'';
    if(maxRemoveEl)maxRemoveEl.value=String(profile?.settings.maxRemovals??M.DEFAULT_SETTINGS.maxRemovals);
    if(resultEl) paint();
  }
  async function chooseProfile(id) {
    if(run.active) throw new Error('Сначала останови проверку.');
    const serial=++switchSerial;
    const profile=profiles.find(x=>x.id===id)||null;
    invalidateScope();
    // Complete pending writes to the old channel before reading a different one.
    await savedChain;
    const stored=profile ? await chrome.storage.local.get(M.rowsKey(profile.id)) : {};
    if(serial!==switchSerial) return;
    const items=profile ? M.sanitizeRows(stored[M.rowsKey(profile.id)]) : [];
    rows.clear();
    for(const item of items) rows.set(item.key,item);
    currentProfileId=profile?.id||'';
    currentChannel=profile?.label||'';
    await chrome.storage.local.set({[M.PREFIX+'active']:currentProfileId});
    renderProfiles();
    show(profile ? 'Выбран «'+profile.label+'». Открой подписчиков именно этого канала и подтверди список.' :
      'Добавь канал и выбери его, затем открой список подписчиков Telegram Web.');
  }
  async function load() {
    try {
      if(typeof chrome==='undefined' || !chrome.storage?.local) throw new Error('Хранилище недоступно.');
      const data=await chrome.storage.local.get(null);
      const migration=M.migrateV3(data);
      profiles=migration.profiles;
      if(migration.migrated) {
        await chrome.storage.local.set({[M.PREFIX+'profiles']:profiles,...migration.records});
        if(profiles.length) show('Данные предыдущей версии разнесены по каналам; исходные записи сохранены.');
      }
      const savedId=String(data[M.PREFIX+'active']||'');
      let id=profiles.some(x=>x.id===savedId) ? savedId : profiles[0]?.id||'';
      await chooseProfile(id);
    } catch(e) { show('Ошибка загрузки каналов: '+String(e.message||e)); }
    paint();
  }
  function save() {
    if(!currentProfileId || typeof chrome==='undefined' || !chrome.storage?.local) return;
    const key=M.rowsKey(currentProfileId);
    const snapshot=Array.from(rows.values());
    const id=currentProfileId;
    savedChain=savedChain.then(async()=>{
      await chrome.storage.local.set({[key]:snapshot});
      const profile=profiles.find(p=>p.id===id);
      if(profile) { profile.lastCount=snapshot.length;await updateProfiles(); }
    }).catch(e=>show('Ошибка сохранения: '+String(e.message||e)+'. Скачай CSV.'));
  }
  function show(s) { if (statusEl) statusEl.textContent = s; }
  function visible(e) {
    if (!e || !e.isConnected || e.closest('#channel-cleaner-overlay')) return false;
    const r = e.getBoundingClientRect();
    const css = getComputedStyle(e);
    if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && css.visibility !== 'hidden' && css.display !== 'none')) return false;
    for (let parent = e.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const s = getComputedStyle(parent);
      if (!/(auto|scroll|hidden|clip)/.test(s.overflowY + ' ' + s.overflowX)) continue;
      const c = parent.getBoundingClientRect();
      if (r.bottom <= c.top || r.top >= c.bottom || r.right <= c.left || r.left >= c.right) return false;
    }
    return true;
  }
  function inOverlay(el) { return Boolean(el?.closest?.('#channel-cleaner-overlay')); }
  function subscriberContext() {
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],header,div,span')]
      .filter(el => el.childElementCount <= 3 && visible(el) &&
        /^(подписчики|subscribers)$/iu.test((el.textContent || '').trim()));
    for (const heading of headings) {
      const hr = heading.getBoundingClientRect();
      if (hr.height > 90 || inOverlay(heading)) continue;
      let ancestor = heading.parentElement;
      for (let depth = 0; ancestor && depth < 9; depth++, ancestor = ancestor.parentElement) {
        if (ancestor === document.documentElement) break;
        const descendants = ancestor.querySelectorAll('div,section,ul,main,[role="list"]');
        if (descendants.length > 12000) continue;
        const scrollers = [...descendants].filter(el => {
          if (inOverlay(el) || !visible(el) || el.clientHeight < 70 || el.scrollHeight <= el.clientHeight + 20) return false;
          const style = getComputedStyle(el);
          if (!/^(auto|scroll)$/.test(style.overflowY)) return false;
          const rect = el.getBoundingClientRect();
          const overlapX = rect.left < hr.right + 260 && rect.right > hr.left - 260;
          return rect.top >= hr.top - 15 && overlapX;
        });
        if (scrollers.length) {
          scrollers.sort((a, b) => (a.clientWidth * a.clientHeight) - (b.clientWidth * b.clientHeight));
          // Only scan the actual scrollable subscriber list, not surrounding chats.
          const scroll = scrollers.find(el => scanElements(el).length > 0);
          if (scroll) return {heading, root: scroll, scroll};
        }
      }
    }
    return null;
  }
  function activeSubscriberSearch(context) {
    const hr = context.heading.getBoundingClientRect();
    const scope = context.heading.parentElement?.parentElement?.parentElement || document;
    const inputs = [...scope.querySelectorAll('input[type="search"],input[type="text"],input:not([type])')];
    return inputs.some(input => {
      if (!visible(input) || !String(input.value || '').trim() || inOverlay(input)) return false;
      const ir = input.getBoundingClientRect();
      return ir.left < hr.right + 360 && ir.right > hr.left - 200 &&
        ir.top >= hr.top - 10 && ir.top - hr.bottom < 150;
    });
  }
  function scanElements(root) {
    if (!root) return [];
    const found = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textNode, count = 0;
    while ((textNode = walker.nextNode()) && ++count <= 22000) {
      const status = textNode.nodeValue?.trim();
      if (!status || status.length > 90 || !P.isActivityStatus(status)) continue;
      const el = textNode.parentElement;
      if (visible(el) && !inOverlay(el)) found.push({el, status});
    }
    return found;
  }
  function chooseRow(statusElNode, root) {
    let node = statusElNode.parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      if (node === root || !root.contains(node) || inOverlay(node)) break;
      const text = String(node.innerText || '').trim();
      const rect = node.getBoundingClientRect();
      if (rect.height < 20 || rect.height > 160 || text.length > 300) continue;
      const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
      // Fail closed: a parent containing multiple rows can pair the wrong
      // name with the activity status of another subscriber.
      const statuses = lines.filter(P.isActivityStatus);
      const names = lines.filter(x => !P.isActivityStatus(x));
      if (statuses.length !== 1 || names.length !== 1 || names[0].length > 140) continue;
      if (lines.length !== 2) continue;
      return node;
    }
    return null;
  }
  function candidateFrom(node, status) {
    const text = String(node?.innerText || '').trim();
    if (!text || P.isProtected(text)) return null;
    const lines = text.split('\n').map(x=>x.trim()).filter(Boolean).filter(x=>!P.isActivityStatus(x));
    let name = lines[0] || '';
    if (name.length > 140 || name.length < 1) return null;
    // On profile screens, headers are more stable than arbitrary text.
    const named = node.querySelector?.('[class*="name" i], [class*="title" i], h3, h2');
    if (named && visible(named) && !P.isActivityStatus(named.innerText) && named.innerText.trim().length <= 140) {
      name = named.innerText.trim().split('\n')[0];
    }
    const candidate=P.makeCandidate(name, status, text);
    if(candidate){candidate.userId=P.extractUserId(node);if(candidate.userId)candidate.key='uid:'+candidate.userId;}
    return candidate;
  }
  function discover(context = null) {
    if (!acceptedScope || !activeProfile()) {
      show('Сначала укажи канал и подтверди, что открыт его список подписчиков.');
      return {count:0, hits:0, blocked:true};
    }
    if (location.href !== scopeLocation) {
      show('Адрес Telegram изменился. Проверь канал и повторно подтверди область сканирования.');
      acceptedScope = false;
      scopeEl.checked = false;
      return {count:0, hits:0, blocked:true};
    }
    context = context || subscriberContext();
    if (!context || !context.root.isConnected || !context.heading.isConnected) {
      show('Окно «Подписчики» не обнаружено. Открой его именно в Telegram Web.');
      return {count:0, hits:0, blocked:true};
    }
    if (activeSubscriberSearch(context)) {
      show('В списке подписчиков включён поиск. Очисти строку поиска и запусти проверку заново.');
      return {count:0,hits:0,blocked:true};
    }
    const els = scanElements(context.root);
    let count = 0, updated = 0;
    for (const {el, status} of els) {
      const row = chooseRow(el, context.root);
      if (!row || !P.isLongAgo(status)) continue;
      const candidate = candidateFrom(row, status);
      if (!candidate) continue;
      if(rows.has(candidate.key)) {
        const saved=rows.get(candidate.key);
        if(!saved.removed) { rows.set(candidate.key,P.preserveReviewFlag(saved,candidate)); updated++; }
        continue;
      }
      if (rows.size >= MAX_GROUPS) {
        show('Достигнут лимит записей. Скачай CSV.');
        return {count,hits:els.length,blocked:true};
      }
      rows.set(candidate.key, candidate);
      count++;
    }
    if (count || updated) { save(); paint(); }
    return {count, hits:els.length, blocked:false};
  }
  const sleep = ms => new Promise(r=>setTimeout(r, ms));
  function messageWorker(payload) {
    return new Promise((resolve,reject)=>{
      if(!chrome?.runtime?.sendMessage) return reject(new Error('Фоновая служба расширения недоступна.'));
      chrome.runtime.sendMessage(payload, res=>{
        const err=chrome.runtime.lastError;
        if(err)return reject(new Error(err.message));
        if(!res?.ok)return reject(new Error(res?.error||'Нет подтверждения от Telegram.'));
        resolve(res);
      });
    });
  }
  async function removalLog(entry) {
    const id=currentProfileId;
    const key=M.PREFIX+'audit:'+id;
    const value=await chrome.storage.local.get(key);
    const prev=Array.isArray(value[key])?value[key]:[];
    await chrome.storage.local.set({[key]:[...prev,entry].slice(-500)});
  }
  async function removeVisible(context, processed, profile) {
    for(const {el,status} of scanElements(context.root)) {
      if(run.stop||run.removed>=profile.settings.maxRemovals)return;
      if(!P.isLongAgo(status))continue;
      const row=chooseRow(el,context.root);
      const candidate=row && candidateFrom(row,status);
      if(!candidate?.userId || processed.has(candidate.userId))continue;
      processed.add(candidate.userId);
      // Check current row, status, identity, channel and visible scope again immediately.
      if(!row.isConnected || !el.isConnected || !visible(row) || !acceptedScope || location.href!==scopeLocation ||
         activeProfile()?.id!==profile.id || subscriberContext()?.root!==context.root || activeSubscriberSearch(context) ||
         !P.isLongAgo(el.textContent.trim()) || P.extractUserId(row)!==candidate.userId ||
         !P.canRemoveAfterGrace(rows.get(candidate.key),candidate)) {run.skipped++;continue;}
      try {
        const result=await messageWorker({type:'CHANNEL_CLEANER_REMOVE_MEMBER',chatRef:profile.settings.chatRef,userId:candidate.userId});
        if(result.removed){
          run.removed++;
          rows.set(candidate.key,{...P.preserveReviewFlag(rows.get(candidate.key),candidate),removed:true});save();paint();
          await removalLog({userId:candidate.userId,name:candidate.name,time:new Date().toISOString(),chatRef:profile.settings.chatRef,result:'removed'});
        }else{
          run.skipped++;
          await removalLog({userId:candidate.userId,name:candidate.name,time:new Date().toISOString(),chatRef:profile.settings.chatRef,result:result.reason||'skipped'});
        }
        show('Удалено '+run.removed+' / '+profile.settings.maxRemovals+', пропущено '+run.skipped);
      }catch(e){
        run.stop=true;
        show('Очистка ОСТАНОВЛЕНА после ошибки Telegram: '+String(e.message||e));
        break;
      }
      await sleep(Math.max(900,profile.settings.pauseMs));
    }
  }
  async function autoScan(withRemoval=false) {
    if (run.active) return;
    if (!acceptedScope || !activeProfile() || location.href !== scopeLocation) {
      show('Сначала выбери канал и подтверди его список подписчиков.');return;
    }
    const context = subscriberContext();
    if (!context || activeSubscriberSearch(context)) {
      show('Окно подписчиков не найдено или включён фильтр поиска.');return;
    }
    if (!scanElements(context.root).length) {
      show('В списке не обнаружены видимые статусы. Прокрутка остановлена, чтобы не читать чужие данные.');
      return;
    }
    const scroll = context.scroll;
    // Preserve prior flagged observations. Every deletion is evaluated only
    // against a fresh, visible Telegram row from THIS pass.
    if (rows.size && !confirm('Обновить результаты обхода? Предыдущие записи и даты отметок сохранятся для повторной проверки через 30 суток.')) {
      show('Проверка отменена. Предыдущие записи сохранены.'); return;
    }
    const profile=activeProfile();
    if(withRemoval){
      if(chatEl.value.trim()!==profile.settings.chatRef){show('Сохрани адрес канала перед удалением.');return;}
      if(!profile.settings.chatRef){show('Укажи @username или -100… ID выбранного канала и сохрани настройки.');return;}
      // Explicit, destructive-action confirmation. Never infer the channel from names.
      if(!confirm('АВТОМАТИЧЕСКОЕ УДАЛЕНИЕ из '+profile.settings.chatRef+'\n\nТолько явно отмеченные участники с числовым ID, если с отметки прошло минимум 30 суток и статус повторно подтверждён в текущем обходе. Лимит: '+profile.settings.maxRemovals+'.\n\n«Был давно» НЕ доказывает неактивность в канале. Продолжить?'))return;
      try{
        const result=await messageWorker({type:'CHANNEL_CLEANER_CHECK_CHANNEL',chatRef:profile.settings.chatRef});
        if(!confirm('Telegram подтвердил канал «'+result.title+'» ('+result.chatId+').\nОткрытый список подписчиков относится именно к нему? Выполнить исключение?')) return;
      }catch(e){show('Бот не готов удалять: '+String(e.message||e));return;}
    }
    // Keep the per-profile flaggedAt history: clearing it here bypassed the grace period.
    run.active = true; run.stop = false;run.removed=0;run.skipped=0; paint();
    let same = 0, pages = 0;
    const processed=new Set();
    try {
      for (; pages < activeProfile().settings.maxSteps && !run.stop; pages++) {
        if (!scroll.isConnected || !context.heading.isConnected || location.href !== scopeLocation) {
          show('Окно или канал изменились; проход остановлен.'); run.stop = true; break;
        }
        const latest = discover(context);
        if (latest.blocked) { run.stop = true; break; }
        if(withRemoval){
          await removeVisible(context,processed,profile);
          if(run.stop||run.removed>=profile.settings.maxRemovals)break;
        }
        const oldTop = scroll.scrollTop;
        scroll.scrollTop = oldTop + Math.max(140, Math.floor(scroll.clientHeight * 0.70));
        scroll.dispatchEvent(new Event('scroll', {bubbles:true}));
        await sleep(activeProfile().settings.pauseMs);
        const nextTop = scroll.scrollTop;
        same = nextTop <= oldTop + 1 ? same + 1 : 0;
        run.scanned = pages + 1;
        show('Проход ' + (pages+1) + ', групп имён: ' + rows.size);
        if (same >= 3) break;
      }
      if (!run.stop) discover(context);
      const endedAtLimit = pages >= activeProfile().settings.maxSteps;
      show(run.stop ? 'Остановлено. Удалено '+run.removed+', отчёт частичный.' : withRemoval && run.removed>=profile.settings.maxRemovals ? 'Лимит достигнут: удалено '+run.removed+'. Повторный проход — только после нового подтверждения.' : endedAtLimit ?
        'Достигнут лимит прокруток для выбранного канала; отчёт частичный.' :
        'Прокрутка закончена. Полнота списка не подтверждена: Telegram мог не загрузить всех подписчиков.');
    } catch (e) { show('Ошибка сканирования: ' + String(e?.message || e)); }
    finally { run.active = false; run.stop = false; paint(); renderProfiles(); }
  }
  function download() {
    if (!rows.size) { show('Пока нет кандидатов для экспорта.'); return; }
    const csv = P.toCSV(Array.from(rows.values()), currentChannel);
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = 'ChannelCleaner_'+currentChannel.replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,45)+'_'+new Date().toISOString().slice(0,10)+'.csv';
    (document.body || document.documentElement).appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(href),2000);
    show('CSV выгружен; факты исключения отмечены в колонке «Удалён?».');
  }
  function paint() {
    if (!resultEl || !listEl) return;
    resultEl.textContent = 'Кандидатов: '+rows.size+' · с ID: '+[...rows.values()].filter(x=>x.userId).length+' · отмечено: '+[...rows.values()].filter(x=>x.userId&&x.flaggedAt).length+' · удалено: '+run.removed+(run.active?' · идёт обход':'');
    listEl.replaceChildren();
    const data = Array.from(rows.values());
    if(profileEl) profileEl.disabled=run.active;
    for(const id of ['cc-add','cc-rename','cc-remove','cc-save-settings','cc-auto','cc-check','cc-remove-auto','cc-clear']) {const b=panel?.querySelector('#'+id);if(b)b.disabled=run.active;}
    for (const item of data.slice(-80).reverse()) {
      const li = document.createElement('div');
      li.className = 'cc-record';
      li.textContent = item.name + (item.userId?' · ID '+item.userId:' · ID не найден') + ' · ' + item.status +
        (item.flaggedAt?' · отмечен '+item.flaggedAt.slice(0,10)+' (не ранее '+new Date(Date.parse(item.flaggedAt)+P.GRACE_MS).toISOString().slice(0,10)+')':'') +
        (item.removed?' · УДАЛЁН':'');
      if (item.userId && !item.removed) {
        const flag=document.createElement('button');
        flag.type='button';
        flag.textContent=item.flaggedAt?'Снять отметку':'Отметить на повторную проверку';
        flag.disabled=run.active;
        flag.setAttribute('aria-label',(item.flaggedAt?'Снять отметку: ':'Отметить на повторную проверку: ')+item.name);
        flag.addEventListener('click',()=>{
          if(run.active) return;
          const current=rows.get(item.key);
          if(!current || current.userId!==item.userId) return;
          rows.set(item.key,{...current,flaggedAt:current.flaggedAt?'':new Date().toISOString()});
          save();paint();
        });
        li.appendChild(flag);
      }
      listEl.appendChild(li);
    }
  }
  function buildPanel() {
    panel = document.createElement('section');
    panel.id = 'channel-cleaner-overlay';
    panel.innerHTML = `<style>
#channel-cleaner-overlay{all:initial;position:fixed;z-index:2147483647;bottom:12px;right:12px;box-sizing:border-box;width:min(360px,calc(100vw - 24px));font-family:Arial,sans-serif;color:#ecf2f9;background:#15212b;border:1px solid #5c748a;border-radius:14px;box-shadow:0 5px 30px #0009;font-size:14px;direction:ltr}
#channel-cleaner-overlay *{box-sizing:border-box;font-family:inherit}
#channel-cleaner-overlay header{padding:12px 13px;display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid #4a606e;font-weight:700;color:#fff}
#channel-cleaner-overlay button{font-size:14px;line-height:20px;border-radius:8px;border:1px solid #6e8493;background:#263d4e;color:white;padding:8px 10px;cursor:pointer;min-height:44px}
#channel-cleaner-overlay button.primary{background:#24668c}
#channel-cleaner-overlay button:focus-visible{outline:2px solid #fff}
#channel-cleaner-overlay .wrap{padding:12px;display:grid;gap:10px;max-height:60vh;overflow-y:auto}
#channel-cleaner-overlay .buttons{display:grid;grid-template-columns:1fr 1fr;gap:7px}
#channel-cleaner-overlay label{display:flex;align-items:start;gap:9px;line-height:1.3}
#channel-cleaner-overlay input[type=checkbox]{accent-color:#75badf;width:22px;height:22px;flex-shrink:0}
#channel-cleaner-overlay input[type=text],#channel-cleaner-overlay input[type=number],#channel-cleaner-overlay select{width:100%;min-height:42px;background:#223746;color:white;border:1px solid #8195a5;border-radius:8px;padding:8px;font-size:16px}
#channel-cleaner-overlay button:disabled{opacity:.55;cursor:not-allowed}
#channel-cleaner-overlay label.channel-label{display:grid;gap:4px}
#channel-cleaner-overlay .help{font-size:12px;line-height:1.35;color:#c3d3df}
#channel-cleaner-overlay .warning{font-size:12px;line-height:1.35;border-left:3px solid #eda94e;padding:5px 9px}
#channel-cleaner-overlay .records{display:grid;gap:5px;max-height:160px;overflow-y:auto;font-size:12px;color:#d9e8f0}
#channel-cleaner-overlay .cc-record{padding:4px;border-bottom:1px solid #334a5b}
#channel-cleaner-overlay.closed .wrap{display:none}
</style>
<header><span>ChannelCleaner · управление</span><button id="cc-toggle" aria-label="Свернуть">−</button></header>
<div class="wrap">
  <div class="help">Каждый канал настраивается отдельно. Выбирай нужный из списка или добавляй новый. Переключение не смешивает отчёты.</div>
  <label class="channel-label">Текущий канал <select id="cc-profile" aria-label="Выбор канала"><option value="">— Выбери канал —</option></select></label>
  <label class="channel-label">Название выбранного / нового канала <input id="cc-name" type="text" maxlength="120" placeholder="@мой_канал" aria-label="Имя канала"></label>
  <div class="buttons"><button id="cc-add">Добавить канал</button><button id="cc-rename">Переименовать</button><button id="cc-remove">Удалить профиль</button></div>
  <div class="help">Для нового канала напиши его имя и нажми «Добавить канал». Для смены имени выбери канал, измени поле и нажми «Переименовать».</div>
  <label class="channel-label">Адрес канала для бота (@username или -100… ID) <input id="cc-chat" type="text" placeholder="@мой_канал" aria-label="Идентификатор Telegram-канала"></label>
  <div class="buttons"><label class="channel-label">Шагов прокрутки <input id="cc-steps" type="number" min="10" max="300" step="1"></label><label class="channel-label">Пауза, мс <input id="cc-pause" type="number" min="350" max="3000" step="50"></label><label class="channel-label">Удалить за проход, не больше <input id="cc-max-remove" type="number" min="1" max="50" step="1"></label></div>
  <button id="cc-save-settings">Сохранить настройки канала</button>
  <label><input type="checkbox" id="cc-scope"> Подтверждаю: открыт список подписчиков ВЫБРАННОГО канала</label>
  <div class="buttons"><button class="primary" id="cc-check">Проверить экран</button><button id="cc-auto">Пройти список</button><button class="primary" id="cc-remove-auto">Автоматически удалить</button><button id="cc-stop">Остановить</button><button id="cc-export">Скачать CSV</button><button id="cc-send">Отправить в бот</button><button id="cc-clear">Очистить список</button></div>
  <div id="cc-count" role="status" aria-live="polite">Разных имён: 0</div>
  <div id="cc-message" class="help" aria-live="polite">Проверка и удаление запускаются из этой панели; браузер должен оставаться открытым.</div>
  <div id="cc-list" class="records"></div>
  <div class="warning">После обнаружения ID отметь участника кнопкой под записью. Только через 30 суток при повторном обнаружении того же ID и статуса возможна очистка. «Был давно» НЕ подтверждает отсутствие именно в канале, возможна блокировка наблюдателя. Браузер должен быть открыт.</div>
</div>`;
    document.documentElement.appendChild(panel);
    statusEl = panel.querySelector('#cc-message');
    resultEl = panel.querySelector('#cc-count');
    listEl = panel.querySelector('#cc-list');
    scopeEl = panel.querySelector('#cc-scope');
    profileEl = panel.querySelector('#cc-profile');
    nameEl = panel.querySelector('#cc-name');
    stepsEl = panel.querySelector('#cc-steps');
    pauseEl = panel.querySelector('#cc-pause');
    chatEl=panel.querySelector('#cc-chat');maxRemoveEl=panel.querySelector('#cc-max-remove');
    const task=async(fn)=>{ try{await fn();} catch(e){show('Ошибка: '+String(e.message||e));renderProfiles();} };
    profileEl.addEventListener('change',()=>task(()=>chooseProfile(profileEl.value)));
    nameEl.addEventListener('input',()=>{ if(acceptedScope){invalidateScope();show('Название изменено. Сохрани его или выбери другой канал и подтверди список заново.');} });
    panel.querySelector('#cc-add').addEventListener('click',()=>task(async()=>{
      if(run.active) throw new Error('Останови сканирование/очистку.');
      if(profiles.length>=M.MAX_PROFILES) throw new Error('Лимит профилей: '+M.MAX_PROFILES);
      const p=M.makeProfile(nameEl.value,profiles);
      profiles.push(p);
      try{await updateProfiles();await chooseProfile(p.id);}
      catch(e){profiles=profiles.filter(x=>x.id!==p.id);throw e;}
    }));
    panel.querySelector('#cc-rename').addEventListener('click',()=>task(async()=>{
      if(run.active) throw new Error('Останови сканирование/очистку.');
      const p=activeProfile();if(!p) throw new Error('Выбери канал.');
      const name=M.validateLabel(nameEl.value,profiles,p.id);
      const previous=p.label; p.label=name;
      try{await updateProfiles();}catch(e){p.label=previous;throw e;}
      currentChannel=name;invalidateScope();renderProfiles();show('Канал переименован. Его отчёт и настройки сохранены.');
    }));
    panel.querySelector('#cc-remove').addEventListener('click',()=>task(async()=>{
      if(run.active) throw new Error('Останови сканирование/очистку.');
      const p=activeProfile();if(!p) throw new Error('Выбери канал.');
      if(!confirm('Удалить профиль «'+p.label+'» и его локальный отчёт? Подписчики Telegram НЕ затрагиваются.')) return;
      await savedChain;
      profiles=profiles.filter(x=>x.id!==p.id);
      await updateProfiles();
      await chrome.storage.local.remove(M.rowsKey(p.id));
      await chooseProfile(profiles[0]?.id||'');
      show('Профиль удалён. На подписчиков Telegram это не влияет.');
    }));
    panel.querySelector('#cc-save-settings').addEventListener('click',()=>task(async()=>{
      if(run.active) throw new Error('Останови сканирование/очистку.');
      const p=activeProfile();if(!p) throw new Error('Выбери канал.');
      p.settings=M.settings({maxSteps:stepsEl.value,pauseMs:pauseEl.value,chatRef:chatEl.value,maxRemovals:maxRemoveEl.value});
      await updateProfiles();renderProfiles();show('Настройки для «'+p.label+'» сохранены отдельно.');
    }));
    panel.querySelector('#cc-toggle').addEventListener('click',()=>{
      panel.classList.toggle('closed');
      panel.querySelector('#cc-toggle').textContent = panel.classList.contains('closed') ? '+' : '−';
    });
    scopeEl.addEventListener('change', async () => {
      if (!scopeEl.checked) { acceptedScope = false; run.stop = true; return; }
      if (run.active) { scopeEl.checked = false; show('Сначала останови проход.'); return; }
      const context = subscriberContext();
      if (!context) { scopeEl.checked = false; show('Не вижу окно «Подписчики». Открой список в Telegram Web.'); return; }
      if (activeSubscriberSearch(context)) { scopeEl.checked = false; show('Очисти поиск подписчиков перед проверкой.'); return; }
      if (!activeProfile()) {scopeEl.checked=false;show('Сначала добавь или выбери канал.');return;}
      if (M.normalized(nameEl.value)!==M.normalized(activeProfile().label)) {
        scopeEl.checked=false;show('Имя в поле отличается от выбранного. Сохрани новое имя или восстанови прежнее.');return;
      }
      acceptedScope=true;scopeLocation=location.href;
      show('Выбран «'+currentChannel+'»; сохранённых групп: '+rows.size+'. Запускай проверку.');
    });
    panel.querySelector('#cc-check').addEventListener('click',()=>{
      const r = discover();
      if (acceptedScope && !r.blocked) show('Видимых статусов: ' + r.hits + ', новых кандидатов: ' + r.count + '. Если «был давно» нет, всё равно можно нажать «Пройти список».');
    });
    panel.querySelector('#cc-auto').addEventListener('click',()=>autoScan(false));
    panel.querySelector('#cc-remove-auto').addEventListener('click',()=>autoScan(true));
    panel.querySelector('#cc-stop').addEventListener('click',()=>{run.stop=true; show('Остановка после текущей прокрутки.');});
    panel.querySelector('#cc-export').addEventListener('click',download);
    panel.querySelector('#cc-send').addEventListener('click',()=>{
      if (!rows.size) {show('Отправлять пока нечего.'); return;}
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {show('В этом браузере отправка в бот недоступна. Скачай CSV.');return;}
      show('Отправляю отчёт через твоего бота...');
      chrome.runtime.sendMessage({type:'CHANNEL_CLEANER_SEND_REPORT',channel:currentChannel,rows:Array.from(rows.values())},(res)=>{
        if (chrome.runtime.lastError) {show('Не удалось связаться с расширением: '+chrome.runtime.lastError.message);return;}
        show(res?.ok ? 'Отчёт отправлен. Проверь личный чат со своим ботом.' : 'Не отправлено: '+(res?.error||'неизвестная ошибка')+'. Проверь настройки расширения.');
      });
    });
    panel.querySelector('#cc-clear').addEventListener('click',()=>{
      if (!confirm('Удалить только собранный локально список? Подписчики Telegram не затрагиваются.')) return;
      if (run.active) { show('Сначала останови сканирование.'); return; }
      rows.clear();save();paint();show('Список для текущего канала очищен.');
    });
  }
  buildPanel();
  load();
})();
