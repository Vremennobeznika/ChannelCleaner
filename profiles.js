/* Profiles and migration policy for multiple Telegram channels. No dependencies. */
(function (root) {
  'use strict';
  const PREFIX = 'channelCleanerV4:';
  const LEGACY = 'channelCleanerV3:';
  const MAX_PROFILES = 100;
  const MAX_ROWS = 25000;
  const DEFAULT_SETTINGS = Object.freeze({maxSteps:180, pauseMs:800, maxRemovals:10, chatRef:''});
  function label(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g,' ').trim();
  }
  function normalized(value) { return label(value).toLocaleLowerCase('ru'); }
  function validateLabel(value, profiles=[], excludedId=null) {
    const name=label(value);
    if (!name || name.length > 120) throw new Error('Название канала: от 1 до 120 символов.');
    if (profiles.some(x => x.id !== excludedId && normalized(x.label) === normalized(name)))
      throw new Error('Этот канал уже есть в списке. Выбери его вместо добавления дубля.');
    return name;
  }
  function intValue(value, min, max, labelName) {
    if (String(value).trim()==='' || !/^\d+$/.test(String(value))) throw new Error('Некорректно: '+labelName);
    const n=Number(value);
    if (!Number.isSafeInteger(n) || n<min || n>max) throw new Error(labelName+': диапазон '+min+'–'+max+'.');
    return n;
  }
  function settings(value={}) {
    return {
      maxSteps: intValue(value.maxSteps??DEFAULT_SETTINGS.maxSteps,10,300,'Число прокруток'),
      pauseMs: intValue(value.pauseMs??DEFAULT_SETTINGS.pauseMs,350,3000,'Задержка, мс'),
      maxRemovals: intValue(value.maxRemovals??DEFAULT_SETTINGS.maxRemovals,1,50,'Максимум исключений за проход'),
      chatRef: validateChatRef(value.chatRef??DEFAULT_SETTINGS.chatRef)
    };
  }
  function validateChatRef(value) {
    const s=String(value||'').trim();
    if (s==='' || /^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(s) || /^-100[1-9][0-9]{5,18}$/.test(s)) return s;
    throw new Error('Укажи @username публичного канала или числовой ID -100… приватного.');
  }
  function rowsKey(id) { return PREFIX+'rows:'+id; }
  function sanitizeRows(value) {
    if (!Array.isArray(value)) return [];
    const seen=new Set(), results=[];
    for (const r of value) {
      if (results.length >= MAX_ROWS) break;
      if (!r || typeof r.name !== 'string' || typeof r.status !== 'string') continue;
      const name=label(r.name).slice(0,140);
      if (!name || !/^(?:был(?:\(а\)|а)? давно|last seen a long time ago)$/iu.test(r.status.trim())) continue;
      const userId=/^[1-9]\d{4,17}$/.test(String(r.userId||'')) ? String(r.userId) : '';
      const key=userId ? 'uid:'+userId : normalized(name);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({key,name,status:r.status.trim(),capturedAt:String(r.capturedAt||'').slice(0,40),evidence:'Виден статус в интерфейсе',identityVerified:false,userId});
    }
    return results;
  }
  function newId() {
    if (root.crypto && typeof root.crypto.randomUUID==='function') return root.crypto.randomUUID();
    if (root.crypto && typeof root.crypto.getRandomValues==='function') {
      const bytes=new Uint8Array(16);root.crypto.getRandomValues(bytes);
      return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    }
    // Fail closed rather than generate predictable/colliding storage keys.
    throw new Error('Безопасный генератор ID недоступен.');
  }
  function makeProfile(name, existing=[], id=null) {
    const l=validateLabel(name,existing);
    return {id:id||newId(),label:l,settings:settings(),lastScanAt:null,lastCount:0};
  }
  function readProfiles(raw) {
    if (!Array.isArray(raw)) return [];
    const usedIds=new Set(),names=new Set(), result=[];
    for(const p of raw.slice(0,MAX_PROFILES)) {
      if (!p || typeof p.id!=='string' || !/^[a-zA-Z0-9_-]{8,90}$/.test(p.id)) continue;
      const l=label(p.label);
      if (!l || l.length>120 || usedIds.has(p.id) || names.has(normalized(l))) continue;
      let s;
      try{s=settings(p.settings||{});}catch{ s=settings(); }
      usedIds.add(p.id);names.add(normalized(l));
      result.push({id:p.id,label:l,settings:s,lastScanAt:typeof p.lastScanAt==='string'?p.lastScanAt:null,lastCount:Number.isSafeInteger(p.lastCount)?p.lastCount:0});
    }
    return result;
  }
  function migrateV3(storage) {
    const existing=storage && storage[PREFIX+'profiles'];
    if(Array.isArray(existing)) return {profiles:readProfiles(existing),records:{},migrated:false};
    const profiles=[],records={};
    for(const [key,val] of Object.entries(storage||{})) {
      if(!key.startsWith(LEGACY) || key===LEGACY+'last' || !Array.isArray(val)) continue;
      if(profiles.length>=MAX_PROFILES) break;
      let name;try{name=decodeURIComponent(key.slice(LEGACY.length));}catch{continue;}
      try {
        const p=makeProfile(name,profiles);
        profiles.push(p);
        const recordsForProfile=sanitizeRows(val);
        records[rowsKey(p.id)]=recordsForProfile;
        p.lastCount=recordsForProfile.length;
      } catch { /* keep old storage untouched for unsupported entries */ }
    }
    return {profiles,records,migrated:true};
  }
  const api={PREFIX,MAX_PROFILES,DEFAULT_SETTINGS,label,normalized,validateLabel,validateChatRef,intValue,settings,rowsKey,sanitizeRows,makeProfile,readProfiles,migrateV3};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  root.ChannelCleanerProfiles=api;
})(typeof window !== 'undefined' ? window : globalThis);
