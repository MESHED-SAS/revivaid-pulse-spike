'use strict';
// ===== Utilitaires =====
const $ = id => document.getElementById(id);
const R = { device: {}, tests: {} };           // relevé des mesures
const now = () => performance.now();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)));
function log(id, m){ const e=$(id); e.textContent = new Date().toLocaleTimeString()+' '+m+'\n'+e.textContent.slice(0,6000); }
function kv(id, rows){ $(id).innerHTML = rows.map(r=>`<span>${r[0]}</span><b class="${r[2]||''}">${r[1]}</b>`).join(''); }
const fmtB = n => n>1e9?(n/1e9).toFixed(2)+' Go':n>1e6?(n/1e6).toFixed(1)+' Mo':(n/1e3).toFixed(0)+' Ko';
function stats(a){ if(!a.length)return {n:0}; const s=[...a].sort((x,y)=>x-y); const sum=a.reduce((x,y)=>x+y,0); return {n:a.length,moy:+(sum/a.length).toFixed(1),p95:+s[Math.min(s.length-1,Math.floor(s.length*.95))].toFixed(1),max:+s[s.length-1].toFixed(1)}; }
const rec = (k,v) => { R.tests[k] = Object.assign(R.tests[k]||{}, v, {at:new Date().toISOString()}); };

// ===== IndexedDB =====
const STORES = ['meta','keys','photos','fiches','outbox','server'];
let _db;
function db(){ return _db || (_db = new Promise((res,rej)=>{ const r=indexedDB.open('pulse-spike',1);
  r.onupgradeneeded=()=>{ STORES.forEach(s=>r.result.createObjectStore(s,{keyPath:'id'})); };
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
async function tx(stores, mode, fn){ const d=await db(); return new Promise((res,rej)=>{ const t=d.transaction(stores,mode); let out; 
  try{ out=fn(...[].concat(stores).map(s=>t.objectStore(s))); }catch(e){ try{t.abort();}catch(_){} return rej(e); }
  t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error||new Error('abort')); }); }
const req = r => new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
async function getAll(s){ const d=await db(); return req(d.transaction(s).objectStore(s).getAll()); }
async function count(s){ const d=await db(); return req(d.transaction(s).objectStore(s).count()); }
async function getOne(s,id){ const d=await db(); return req(d.transaction(s).objectStore(s).get(id)); }
async function putOne(s,o){ const d=await db(); return new Promise((res,rej)=>{ const t=d.transaction(s,'readwrite'); t.objectStore(s).put(o); t.oncomplete=()=>res(); t.onerror=()=>rej(t.error); }); }
async function clearStore(s){ const d=await db(); return new Promise((res,rej)=>{ const t=d.transaction(s,'readwrite'); t.objectStore(s).clear(); t.oncomplete=()=>res(); t.onerror=()=>rej(t.error); }); }

// ===== Onglets =====
$('nav').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return;
  document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('section').forEach(s=>s.classList.toggle('on',s.id===b.dataset.t));
  if(b.dataset.t==='t5') renderRel(); });

// ===== 1. Environnement, persistance =====
async function env(){
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
  const sw = 'serviceWorker' in navigator ? ((await navigator.serviceWorker.getRegistration())?'actif':(swErr?'ERREUR : '+swErr:'non enregistré')) : 'absent';
  let persisted='?', est={};
  try{ persisted = await navigator.storage.persisted(); est = await navigator.storage.estimate(); }catch(e){}
  R.device = { ua:navigator.userAgent, standalone, sw, persisted, quota:est.quota, usage:est.usage, barcodeDetector:'BarcodeDetector' in window, webauthn:!!window.PublicKeyCredential, subtle:!!(crypto&&crypto.subtle), online:navigator.onLine };
  kv('env',[['Installée (écran d\'accueil)',standalone?'oui':'non',standalone?'ok':'ko'],['Service worker',sw],['Stockage persistant',String(persisted),persisted===true?'ok':'ko'],
    ['Quota / utilisé',est.quota?fmtB(est.quota)+' / '+fmtB(est.usage||0):'?'],['BarcodeDetector',R.device.barcodeDetector?'oui':'non (jsQR utilisé)'],['WebCrypto',R.device.subtle?'oui':'non',R.device.subtle?'ok':'ko'],['WebAuthn',R.device.webauthn?'oui':'non'],['Réseau',navigator.onLine?'en ligne':'hors ligne']]);
  const m = await getOne('meta','first'); 
  if(!m){ await putOne('meta',{id:'first',at:Date.now()}); }
  const first=(await getOne('meta','first')).at; const days=((Date.now()-first)/864e5);
  const np=await count('photos'), nf=await count('fiches');
  kv('persist',[['Premier lancement',new Date(first).toLocaleString()],['Ancienneté',days.toFixed(2)+' jours'],['Photos stockées',np],['Fiches stockées',nf]]);
  rec('persistance',{ancienneteJours:+days.toFixed(2),photos:np,fiches:nf,persisted});
}
$('btnEnv').onclick=env;
$('btnPersist').onclick=async()=>{ try{ const ok=await navigator.storage.persist(); rec('persistance',{demandePersist:ok}); }catch(e){} env(); };
let swErr='';
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').then(()=>navigator.serviceWorker.ready).then(()=>env()).catch(e=>{ swErr=e.name+' '+e.message; env(); });
}
env();

// ===== 1. Caméra et QR =====
let stream=null, scanning=false;
$('btnCam').onclick=async()=>{
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    const v=$('vid'); v.srcObject=stream; await v.play(); $('btnCam').disabled=true; $('btnStop').disabled=false;
    scanning=true; loopScan(now());
  }catch(e){ log('logScan','Erreur caméra : '+e.name+' '+e.message); rec('qr',{erreurCamera:e.name}); }
};
$('btnStop').onclick=()=>{ scanning=false; if(stream) stream.getTracks().forEach(t=>t.stop()); $('btnCam').disabled=false; $('btnStop').disabled=true; };
let bd=null; if('BarcodeDetector' in window){ try{ bd=new BarcodeDetector({formats:['qr_code']}); }catch(e){} }
const reads=[]; let last='', lastAt=0;
async function loopScan(t0){
  const v=$('vid'), c=$('cv'), ctx=c.getContext('2d',{willReadFrequently:true}); let tStart=t0, frames=0;
  while(scanning){
    if(v.readyState>=2){
      const w=Math.min(640,v.videoWidth), h=Math.round(v.videoHeight*w/v.videoWidth); c.width=w; c.height=h; ctx.drawImage(v,0,0,w,h); frames++;
      let txt=null, how='';
      try{ if(bd){ const r=await bd.detect(c); if(r.length){ txt=r[0].rawValue; how='BarcodeDetector'; } }
        if(!txt){ const img=ctx.getImageData(0,0,w,h); const q=jsQR(img.data,w,h,{inversionAttempts:'dontInvert'}); if(q){ txt=q.data; how='jsQR'; } } }catch(e){}
      if(txt && (txt!==last || now()-lastAt>3000)){ const ms=now()-tStart; last=txt; lastAt=now(); reads.push(ms);
        log('logScan',`QR lu en ${ms.toFixed(0)} ms (${how}) : ${txt.slice(0,40)}`); rec('qr',{lectures:reads.length,delai:stats(reads),decodeur:how}); tStart=now(); }
      kv('scanStat',[['Images analysées',frames],['Lectures',reads.length],['Délai moyen (ms)',stats(reads).moy||'-'],['Cible','< 2000 ms']]);
    }
    await new Promise(r=>setTimeout(r,60));
  }
}
$('btnQr').onclick=()=>{ const id=uuid(); const q=qrcode(0,'M'); q.addData(id); q.make(); const cell=+$('qrCell').value||4;
  $('qrOut').innerHTML=`<img alt="QR" src="${q.createDataURL(cell,cell*2)}" style="image-rendering:pixelated"><div style="font:12px monospace">${id}</div>`; };

// ===== 2. Photos : compression, chiffrement, stockage =====
async function getKey(){
  let k=await getOne('keys','k'); if(k) return k.key;
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']); // non exportable
  await putOne('keys',{id:'k',key,at:Date.now()}); return key;
}
const hex = buf => [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
async function compress(bitmap){ const max=1280, s=Math.min(1,max/Math.max(bitmap.width,bitmap.height)); const w=Math.round(bitmap.width*s), h=Math.round(bitmap.height*s);
  const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(bitmap,0,0,w,h);
  return new Promise(r=>c.toBlob(r,'image/jpeg',0.75)); }
async function encryptStore(blob, extra){
  const t={}; let t0=now(); const plain=await blob.arrayBuffer(); const key=await getKey(); const iv=crypto.getRandomValues(new Uint8Array(12));
  t0=now(); const hash=hex(await crypto.subtle.digest('SHA-256',plain)); t.hash=now()-t0;
  t0=now(); const enc=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain); t.encrypt=now()-t0;
  const rec_={id:uuid(),iv,data:enc,hash,size:plain.byteLength,created:Date.now(),...extra};
  t0=now(); await putOne('photos',rec_); t.write=now()-t0; return {rec:rec_,t};
}
async function synthPhoto(i){ const c=document.createElement('canvas'); c.width=1920; c.height=1440; const x=c.getContext('2d');
  const g=x.createLinearGradient(0,0,1920,1440); g.addColorStop(0,`hsl(${(i*37)%360},40%,40%)`); g.addColorStop(1,`hsl(${(i*91)%360},50%,70%)`); x.fillStyle=g; x.fillRect(0,0,1920,1440);
  for(let k=0;k<400;k++){ x.fillStyle=`hsla(${Math.random()*360},60%,50%,.5)`; x.fillRect(Math.random()*1900,Math.random()*1400,20+Math.random()*120,20+Math.random()*120); }
  x.fillStyle='#fff'; x.font='64px sans-serif'; x.fillText('Photo test '+i,80,200);
  const id=x.getImageData(0,0,1920,1440); for(let p=0;p<id.data.length;p+=4*7){ const n=(Math.random()*40-20)|0; id.data[p]+=n; id.data[p+1]+=n; id.data[p+2]+=n; } x.putImageData(id,0,0);
  return createImageBitmap(c); }
$('file').onchange=async e=>{ const f=e.target.files[0]; if(!f)return; const t0=now(); const bm=await createImageBitmap(f); const b=await compress(bm); const tc=now()-t0; const {t,rec:r_}=await encryptStore(b);
  kv('photoOne',[['Original',fmtB(f.size)],['Compressée',fmtB(b.size)],['Compression (ms)',tc.toFixed(0)],['Chiffrement (ms)',t.encrypt.toFixed(0)],['Écriture (ms)',t.write.toFixed(0)]]); rec('photoReelle',{origine:f.size,compressee:b.size,compressMs:+tc.toFixed(0),chiffreMs:+t.encrypt.toFixed(0)}); env(); };
$('btnGen').onclick=async()=>{ const n=+$('nPh').value||1; const ms={c:[],e:[],w:[]}; let bytes=0; const T0=now(); $('btnGen').disabled=true;
  try{ for(let i=0;i<n;i++){ let t0=now(); const bm=await synthPhoto(i); const blob=await compress(bm); bm.close&&bm.close(); ms.c.push(now()-t0);
      const {t,rec:r_}=await encryptStore(blob); ms.e.push(t.encrypt); ms.w.push(t.write); bytes+=r_.size;
      if(i%10===0){ kv('phStat',[['Progression',`${i+1} / ${n}`],['Taille moyenne',fmtB(bytes/(i+1))],['Chiffrement moy. (ms)',stats(ms.e).moy],['Écriture moy. (ms)',stats(ms.w).moy]]); await new Promise(r=>setTimeout(r));} }
    const tot=(now()-T0)/1000; log('logPh',`${n} photos en ${tot.toFixed(1)} s, ${fmtB(bytes)} au total`);
    rec('lotPhotos',{n,totalS:+tot.toFixed(1),octets:bytes,compressionMs:stats(ms.c),chiffrementMs:stats(ms.e),ecritureMs:stats(ms.w)});
    kv('phStat',[['Terminé',`${n} photos`],['Volume clair',fmtB(bytes)],['Compression (ms)',JSON.stringify(stats(ms.c))],['Chiffrement (ms)',JSON.stringify(stats(ms.e))],['Écriture (ms)',JSON.stringify(stats(ms.w))]]);
  }catch(e){ log('logPh','ERREUR '+e.name+' '+e.message+' (quota ?)'); rec('lotPhotos',{erreur:e.name}); }
  $('btnGen').disabled=false; env(); };
$('btnVerify').onclick=async()=>{ const key=await getKey(); const all=await getAll('photos'); let ok=0,ko=0; const ms=[]; const T0=now();
  for(const p of all){ try{ const t0=now(); const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:p.iv},key,p.data); ms.push(now()-t0); (hex(await crypto.subtle.digest('SHA-256',plain))===p.hash)?ok++:ko++; }catch(e){ ko++; } }
  const msg=`Vérification : ${ok} OK, ${ko} en échec sur ${all.length} (${((now()-T0)/1000).toFixed(1)} s)`; log('logPh',msg); rec('verification',{ok,ko,total:all.length,dechiffrementMs:stats(ms)}); };
$('btnClr').onclick=async()=>{ await clearStore('photos'); log('logPh','Photos vidées'); env(); };

// ===== 3. Fiches, file d'envoi, synchronisation =====
const cnt={sent:0,fail:0,dup:0}; let syncing=false;
async function obRefresh(){ const ob=await getAll('outbox'); const pend=ob.filter(o=>o.state!=='SENT').length; const sent=ob.filter(o=>o.state==='SENT').length;
  kv('obStat',[['Fiches locales',await count('fiches')],['En attente',pend,pend?'ko':'ok'],['Envoyées',sent],['Reçues par le serveur simulé',await count('server')],['Doublons reçus',cnt.dup,cnt.dup?'ko':'ok'],['Échecs réseau',cnt.fail],['Réseau',navigator.onLine?'en ligne':'hors ligne']]); }
$('btnFi').onclick=async()=>{ const n=+$('nFi').value||1; const t0=now(); const key=await getKey();
  for(let i=0;i<n;i++){ const bm=await synthPhoto(i); const blob=await compress(bm); const plain=await blob.arrayBuffer(); const iv=crypto.getRandomValues(new Uint8Array(12)); const enc=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain);
    const fid=uuid(), pid=uuid(), num='PLS-TEST-'+String(Date.now()%100000).padStart(5,'0')+'-'+i;
    // Écriture atomique : fiche + photo + 2 entrées de file dans une seule transaction.
    await tx(['fiches','photos','outbox'],'readwrite',(F,P,O)=>{ F.put({id:fid,num,created:Date.now()}); P.put({id:pid,iv,data:enc,size:plain.byteLength,created:Date.now(),fiche:fid});
      O.put({id:uuid(),type:'fiche',payload:{id:fid,num},state:'PENDING',tries:0,ts:Date.now()}); O.put({id:uuid(),type:'photo',payload:{id:pid,fiche:fid,size:enc.byteLength},state:'PENDING',tries:0,ts:Date.now()}); }); }
  log('logOb',`${n} fiches créées hors ligne en ${((now()-t0)/1000).toFixed(1)} s`); obRefresh(); env(); };
async function sendOne(o){
  const delay=+$('delay').value||0; if(delay) await new Promise(r=>setTimeout(r,delay));
  if(!navigator.onLine) throw new Error('hors ligne');
  const cut=+$('cut').value||0; if(cut && cnt.sent>0 && cnt.sent%cut===0 && !o._passed){ cnt.sent++; throw new Error('coupure simulée'); }
  if($('mode').value==='real'){ const r=await fetch($('url').value,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:o.id,type:o.type,payload:o.payload})}); if(!r.ok) throw new Error('HTTP '+r.status); }
  else { const ex=await getOne('server',o.id); if(ex){ cnt.dup++; } else await putOne('server',{id:o.id,type:o.type,at:Date.now()}); }
}
async function sync(){ if(syncing)return; syncing=true; $('btnSync').disabled=true; const T0=now(); let n=0;
  try{ const ob=(await getAll('outbox')).filter(o=>o.state!=='SENT').sort((a,b)=>a.ts-b.ts);
    for(const o of ob){ try{ await sendOne(o); o.state='SENT'; o.tries++; await putOne('outbox',o); n++; cnt.sent++; }catch(e){ o.tries++; o.last=e.message; await putOne('outbox',o); cnt.fail++; log('logOb','Arrêt : '+e.message+' (reprise possible)'); break; } if(n%5===0) obRefresh(); }
    log('logOb',`${n} éléments envoyés en ${((now()-T0)/1000).toFixed(1)} s`); rec('envoi',{derniereSynchro:n,doublons:cnt.dup,echecsReseau:cnt.fail});
  }finally{ syncing=false; $('btnSync').disabled=false; obRefresh(); } }
$('btnSync').onclick=sync;
addEventListener('online',()=>{ log('logOb','Réseau revenu : reprise automatique'); sync(); }); addEventListener('offline',()=>{ log('logOb','Réseau perdu'); obRefresh(); });
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'){ obRefresh(); if(navigator.onLine) sync(); } });
$('btnCheck').onclick=async()=>{ const f=await getAll('fiches'), ob=await getAll('outbox'), sv=await getAll('server'); const svIds=new Set(sv.map(s=>s.id));
  const missing=ob.filter(o=>o.state==='SENT'&&!svIds.has(o.id)).length; const pend=ob.filter(o=>o.state!=='SENT').length;
  const verdict=(missing===0&&cnt.dup===0)?'OK : aucune perte, aucun doublon':'ÉCART : '+missing+' manquant(s), '+cnt.dup+' doublon(s)';
  log('logOb',`Contrôle : ${f.length} fiches, ${pend} en attente, ${verdict}`); rec('integrite',{fiches:f.length,enAttente:pend,manquants:missing,doublons:cnt.dup}); };
$('btnRst').onclick=async()=>{ for(const s of ['fiches','outbox','server']) await clearStore(s); cnt.sent=cnt.fail=cnt.dup=0; log('logOb','Tout effacé'); obRefresh(); };
obRefresh();

// ===== 4. WebAuthn =====
const b64=u=>btoa(String.fromCharCode(...new Uint8Array(u))); const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
(async()=>{ let pa='?'; try{ pa=await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }catch(e){} kv('waInfo',[['WebAuthn',window.PublicKeyCredential?'oui':'non'],['Biométrie de l\'appareil',String(pa),pa===true?'ok':'ko']]); rec('webauthn',{disponible:!!window.PublicKeyCredential,plateforme:pa}); })();
$('btnWaC').onclick=async()=>{ const t0=now(); try{ const c=await navigator.credentials.create({publicKey:{rp:{name:'Pulse Spike',id:location.hostname},user:{id:crypto.getRandomValues(new Uint8Array(16)),name:'testeur',displayName:'Testeur'},challenge:crypto.getRandomValues(new Uint8Array(32)),
  pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'preferred'},timeout:60000}});
  localStorage.setItem('wa',b64(c.rawId)); log('logWa',`Identifiant créé en ${(now()-t0).toFixed(0)} ms`); rec('webauthn',{creation:'OK'}); }catch(e){ log('logWa','Échec création : '+e.name+' '+e.message); rec('webauthn',{creation:e.name}); } };
$('btnWaG').onclick=async()=>{ const id=localStorage.getItem('wa'); if(!id){ log('logWa','Créer d\'abord un identifiant'); return; } const t0=now();
  try{ await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),allowCredentials:[{type:'public-key',id:unb64(id)}],userVerification:'required',timeout:60000}}); log('logWa',`Déverrouillage OK en ${(now()-t0).toFixed(0)} ms`); rec('webauthn',{deverrouillage:'OK'}); }catch(e){ log('logWa','Échec : '+e.name+' '+e.message); rec('webauthn',{deverrouillage:e.name}); } };

// ===== 4. Étiquette =====
function label(){ const num=$('num').value||'PLS-TEST'; const q=qrcode(0,'M'); q.addData(uuid()); q.make(); const url=q.createDataURL(4,2);
  $('lbl').innerHTML=`<img alt="QR" src="${url}"><div>${num.replace(/</g,'')}</div>`; $('lblPrev').innerHTML=`<img alt="aperçu" src="${url}" style="width:120px;image-rendering:pixelated"><div style="font:700 14px monospace">${num.replace(/</g,'')}</div>`; }
$('btnPrint').onclick=()=>{ label(); setTimeout(()=>{ try{ window.print(); rec('impression',{lancee:true}); }catch(e){ rec('impression',{erreur:e.name}); } },150); };

// ===== Relevé =====
function renderRel(){ $('rel').value=JSON.stringify(R,null,1); }
$('btnRel').onclick=async()=>{ await env(); renderRel(); };
$('btnCopy').onclick=async()=>{ renderRel(); try{ await navigator.clipboard.writeText($('rel').value); }catch(e){ $('rel').select(); } };
