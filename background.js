'use strict';
// Bot token lives only in extension storage, never in web.telegram.org page DOM.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CHANNEL_CLEANER_SEND_REPORT') return false;
  (async () => {
    try {
      // Only the content script on telegram web may invoke this action.
      if (sender.id && chrome.runtime.id && sender.id !== chrome.runtime.id) throw new Error('Недопустимый источник.');
      if (!sender.tab || (new URL(sender.tab.url)).hostname !== 'web.telegram.org') throw new Error('Отчёт можно отправить только из Telegram Web.');
      const { channelCleanerSecrets: sec } = await chrome.storage.local.get('channelCleanerSecrets');
      const token = String(sec?.token || '').trim();
      const owner = String(sec?.owner || '').trim();
      if (!/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(token) || !/^\d{4,20}$/.test(owner))
        throw new Error('Открой настройки расширения и заполни токен и числовой Telegram ID.');
      if (!Array.isArray(message.rows) || message.rows.length < 1 || message.rows.length > 25000)
        throw new Error('Нет данных или их слишком много для отправки.');
      const channel = String(message.channel || '').trim().slice(0,120);
      if (!channel) throw new Error('Канал не указан.');
      const rows = message.rows.map(x => ({
        name: String(x.name || '').slice(0,140),
        status: String(x.status || '').slice(0,100),
        capturedAt: String(x.capturedAt || '').slice(0,50)
      }));
      // Recreate CSV in trusted extension worker: reject formula syntax in data.
      const csvCell = v => {
        let s = String(v??'');
        if (/^[\s\uFEFF\u200B\u200C\u200D]*[=+@\-\t\r]/u.test(s)) s = "'"+s;
        return '"'+s.replaceAll('"','""')+'"';
      };
      const csv = '\ufeff'+[['Канал (введён вручную)','Имя (не ID)','Статус','Когда записано (UTC)','Примечание'],...rows.map(x=>[channel,x.name,x.status,x.capturedAt,'Группа по имени, неуникальная идентичность; не удалять автоматически'])].map(r=>r.map(csvCell).join(';')).join('\r\n')+'\r\n';
      const f = new FormData();
      f.append('chat_id',owner);
      f.append('caption','ChannelCleaner: предварительный список отображаемых имён. Telegram «был давно» НЕ доказывает неактивность. Удалять автоматически нельзя.');
      f.append('document',new Blob([csv],{type:'text/csv;charset=utf-8'}),'ChannelCleaner_candidates.csv');
      const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20000) : undefined;
      const res=await fetch('https://api.telegram.org/bot'+token+'/sendDocument',{method:'POST',body:f,signal});
      const data=await res.json();
      if (!res.ok || !data.ok) throw new Error('Telegram: '+(data.description||('HTTP '+res.status)));
      sendResponse({ok:true});
    } catch(e) {sendResponse({ok:false,error:String(e.message||e)});}
  })();
  return true;
});

// A separate, explicit removal action. No channel scanning occurs in the bot:
// the Telegram Web list supplies the visible status and the numeric peer ID.
function validTelegramRef(v) {return /^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(v)||/^-100[1-9][0-9]{5,18}$/.test(v);}
function validTelegramId(v) {return /^[1-9]\d{4,17}$/.test(String(v||''));}
async function botCall(token, method, payload) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const res=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal
    });
    const value=await res.json();
    if(!res.ok || !value?.ok) throw new Error(method+': '+(value?.description||'HTTP '+res.status));
    return value.result;
  } finally {clearTimeout(timeout);}
}
async function removalAction(message, sender) {
  if(sender.id && sender.id!==chrome.runtime.id) throw new Error('Недопустимый источник.');
  if(!sender.tab || new URL(sender.tab.url).hostname!=='web.telegram.org') throw new Error('Открой Telegram Web.');
  if(!['CHANNEL_CLEANER_CHECK_CHANNEL','CHANNEL_CLEANER_REMOVE_MEMBER'].includes(message.type)) throw new Error('Неверная команда.');
  const raw=await chrome.storage.local.get('channelCleanerSecrets');
  const token=String(raw.channelCleanerSecrets?.token||'').trim();
  if(!/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('Токен BotFather отсутствует. Заполни настройки расширения.');
  const chat=String(message.chatRef||'').trim();
  if(!validTelegramRef(chat)) throw new Error('Неверный адрес канала: @username или -100…');
  const chatInfo=await botCall(token,'getChat',{chat_id:chat});
  if(chatInfo?.type!=='channel') throw new Error('Адрес должен указывать на канал, не группу.');
  const me=await botCall(token,'getMe',{});
  const role=await botCall(token,'getChatMember',{chat_id:chat,user_id:me.id});
  if(!['creator','administrator'].includes(role?.status) || (role.status==='administrator' && role.can_restrict_members!==true))
    throw new Error('Дай боту право блокировать участников в этом канале.');
  if(message.type==='CHANNEL_CLEANER_CHECK_CHANNEL') return {ok:true,chatId:String(chatInfo.id),title:String(chatInfo.title||''),canRemove:true};
  const userId=String(message.userId||'');
  if(!validTelegramId(userId) || userId===String(me.id)) throw new Error('Telegram ID не определён достоверно или это сам бот.');
  const member=await botCall(token,'getChatMember',{chat_id:chat,user_id:userId});
  if(member?.status!=='member') return {ok:true,removed:false,reason:'Статус не обычный подписчик: '+String(member?.status||'неизвестно')};
  // Official Bot API explicitly states that unbanChatMember without
  // only_if_banned removes an existing member without blocking future re-entry.
  await botCall(token,'unbanChatMember',{chat_id:chat,user_id:userId});
  const after=await botCall(token,'getChatMember',{chat_id:chat,user_id:userId});
  if(after?.status!=='left') throw new Error('Удаление отправлено, но не подтверждено: статус '+String(after?.status||'неизвестно')+'. Остановлено без повторной попытки.');
  return {ok:true,removed:true,userId};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!['CHANNEL_CLEANER_CHECK_CHANNEL','CHANNEL_CLEANER_REMOVE_MEMBER'].includes(message?.type))return false;
  removalAction(message,sender).then(sendResponse).catch(e=>sendResponse({ok:false,error:String(e.message||e)}));
  return true;
});
if(typeof module!=='undefined'&&module.exports)module.exports={validTelegramRef,validTelegramId,removalAction};
