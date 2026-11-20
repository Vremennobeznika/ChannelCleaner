'use strict';
const form=document.getElementById('settings');
const token=document.getElementById('token');
const owner=document.getElementById('owner');
const status=document.getElementById('status');
chrome.storage.local.get('channelCleanerSecrets').then(data=>{
  token.value=data.channelCleanerSecrets?.token||'';
  owner.value=data.channelCleanerSecrets?.owner||'';
});
form.addEventListener('submit',async e=>{
  e.preventDefault();
  const t=token.value.trim(), id=owner.value.trim();
  if (!/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(t) || !/^\d{4,20}$/.test(id)) {status.textContent='Проверь формат токена и числового Telegram ID.';return;}
  await chrome.storage.local.set({channelCleanerSecrets:{token:t,owner:id}});
  status.textContent='Настройки сохранены только на этом устройстве.';
});
document.getElementById('erase').addEventListener('click',async()=>{
  await chrome.storage.local.remove('channelCleanerSecrets');
  token.value='';owner.value='';status.textContent='Ключи удалены.';
});
