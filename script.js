// --- IndexedDB helpers ---
const DB_NAME='client_notes_db'; const STORE='items'; const VERSION=1;
let dbPromise = new Promise((resolve,reject)=>{
  const req = indexedDB.open(DB_NAME, VERSION);
  req.onupgradeneeded = (e)=>{
    const db = e.target.result;
    if (!db.objectStoreNames.contains(STORE)) {
      const os = db.createObjectStore(STORE,{keyPath:'id'});
      os.createIndex('by_follow','follow');
      os.createIndex('by_created','created');
    }
  };
  req.onsuccess = ()=>resolve(req.result);
  req.onerror = ()=>reject(req.error);
});

async function idbAll(){
  const db = await dbPromise;
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readonly'); const st=tx.objectStore(STORE);
    const out=[]; const req=st.openCursor();
    req.onsuccess=()=>{ const cur=req.result; if(cur){ out.push(cur.value); cur.continue(); } else res(out); };
    req.onerror=()=>rej(req.error);
  });
}
async function idbPut(item){
  const db = await dbPromise;
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(item);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });
}
async function idbBulkPut(items){
  const db = await dbPromise;
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readwrite'); const st=tx.objectStore(STORE);
    items.forEach(it=>st.put(it));
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });
}
async function idbDelete(id){
  const db = await dbPromise;
  return new Promise((res,rej)=>{
    const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).delete(id);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });
}

// --- Migration from localStorage (one-time) ---
const LS_KEY='client_notes_v1';
(async()=>{
  const existing = await idbAll();
  if (existing.length===0) {
    try {
      const ls = JSON.parse(localStorage.getItem(LS_KEY)||'[]');
      if (ls.length) { await idbBulkPut(ls); }
    } catch {}
  }
})();

// --- App state & UI ---
let items = [];
let filterMode='all';
const $=s=>document.querySelector(s);

function fmtDate(dt){ if(!dt) return ''; const d = new Date(dt); if(isNaN(d)) return ''; return d.toLocaleString(); }
function todayKey(d=new Date()){ return d.toISOString().slice(0,10); }

function uuid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36); }

async function loadItems(){
  items = await idbAll();
  render();
}

function render(){
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#list'); list.innerHTML='';
  const now = new Date(); const today = todayKey(now);
  let shown=0; const tpl = document.getElementById('itemTpl').content;
  items.slice().sort((a,b)=>{
    const af=a.follow||'9999-12-31T23:59'; const bf=b.follow||'9999-12-31T23:59';
    if(af!==bf) return af.localeCompare(bf);
    return (b.created||0)-(a.created||0);
  }).forEach(it=>{
    const hay=[it.name,it.phone,it.email,it.note,it.tag].join(' ').toLowerCase();
    if(q && !hay.includes(q)) return;
    if(filterMode==='today' && (!it.follow || it.follow.slice(0,10)!==today)) return;
    if(filterMode==='overdue'){ if(!it.follow) return; if(new Date(it.follow) >= now) return; }
    if(filterMode==='star' && !it.star) return;

    const el = document.importNode(tpl, true);
    el.querySelector('.tName').textContent = it.name || '(без имени)';
    const t=[]; if(it.phone) t.push('☎ '+it.phone); if(it.email) t.push('✉ '+it.email); if(it.source) t.push('Источник: '+it.source);
    el.querySelector('.tMeta').textContent=t.join(' · ');
    el.querySelector('.tNote').textContent=(it.note||'').trim();
    el.querySelector('.tFollow').textContent = it.follow ? ('След. контакт: '+fmtDate(it.follow)) : '';
    const star = el.querySelector('.star'); star.textContent = it.star ? '★' : '☆';
    star.onclick = async ()=>{ it.star=!it.star; await idbPut(it); await loadItems(); };
    const tTag = el.querySelector('.tTag'); if(it.tag){ tTag.classList.remove('hidden'); tTag.textContent=it.tag; }
    const badgeRow = el.querySelector('.tBadgeRow'); badgeRow.innerHTML='';
    if (it.follow){
      const due = new Date(it.follow); let label='';
      if (due.toISOString().slice(0,10)===todayKey(new Date())) label='Сегодня';
      else if (due < new Date()) label='Просрочено'; else label='Заплан.';
      const b=document.createElement('span'); b.className='badge'; b.textContent=label; badgeRow.appendChild(b);
    }
    el.querySelector('.btnCall').onclick=()=>{ if(it.phone) location.href='tel:'+it.phone; };
    el.querySelector('.btnWhats').onclick=()=>{
      if(!it.phone) return;
      const p=it.phone.replace(/[^\d]/g,'');
      const msg=encodeURIComponent((it.name?it.name+', ':'')+(it.note||''));
      location.href='https://wa.me/'+p+'?text='+msg;
    };
    el.querySelector('.btnICS').onclick=()=>downloadICS(it);
    el.querySelector('.btnEdit').onclick=()=>editItem(it);
    el.querySelector('.btnDel').onclick=async()=>{
      if(confirm('Удалить запись?')){ await idbDelete(it.id); await loadItems(); }
    };
    list.appendChild(el); shown++;
  });
  $('#stats').textContent='Показано: '+shown+' / '+items.length;
}

function editItem(it){
  const name=prompt('Имя', it.name||''); if(name===null)return;
  const phone=prompt('Телефон', it.phone||''); if(phone===null)return;
  const email=prompt('Почта', it.email||''); if(email===null)return;
  const tag=prompt('Тег', it.tag||''); if(tag===null)return;
  const note=prompt('Заметка', it.note||''); if(note===null)return;
  const follow=prompt('Следующий контакт (YYYY-MM-DDTHH:MM)', it.follow||''); if(follow===null)return;
  it.name=name; it.phone=phone; it.email=email; it.tag=tag; it.note=note; it.follow=follow;
  idbPut(it).then(loadItems);
}

// Add new
document.getElementById('quickForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const it = {
    id: uuid(),
    created: Date.now(),
    name: document.getElementById('name').value.trim(),
    tag: document.getElementById('tag').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    email: document.getElementById('email').value.trim(),
    note: document.getElementById('note').value.trim(),
    follow: document.getElementById('follow').value,
    source: document.getElementById('source').value,
    star: false,
  };
  await idbPut(it); await loadItems();
  e.target.reset(); document.getElementById('name').focus();
});

document.getElementById('btnClear').onclick=()=>{ document.getElementById('quickForm').reset(); document.getElementById('name').focus(); };
document.getElementById('search').addEventListener('input', render);
document.getElementById('filterAll').onclick=()=>{ filterMode='all'; render(); };
document.getElementById('filterToday').onclick=()=>{ filterMode='today'; render(); };
document.getElementById('filterOverdue').onclick=()=>{ filterMode='overdue'; render(); };
document.getElementById('filterStar').onclick=()=>{ filterMode='star'; render(); };

// --- CSV export/import (old, kept) ---
function exportCSV(){
  const cols=['id','created','name','tag','phone','email','note','follow','source','star'];
  const rows=[cols.join(',')];
  items.forEach(it=>{
    const line = cols.map(k=>{
      let v = it[k]; if(v===undefined||v===null) v='';
      v = String(v).replace(/"/g,'""'); if(/[",\n]/.test(v)) v='"'+v+'"';
      return v;
    }).join(',');
    rows.push(line);
  });
  const blob=new Blob([rows.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='clients.csv'; a.click();
}
document.getElementById('btnExportCSV').onclick=exportCSV;
document.getElementById('importFileCSV').addEventListener('change', e=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async()=>{
    const text=reader.result; const lines=text.split(/\r?\n/).filter(Boolean);
    if(!lines.length) return; const header=lines.shift().split(',');
    const idx={}; header.forEach((h,i)=>idx[h.replace(/(^"|"$)/g,'')]=i);
    for (const line of lines){
      const cells=parseCSVLine(line);
      const it={
        id: cells[idx.id] || uuid(),
        created: Number(cells[idx.created] || Date.now()),
        name: cells[idx.name] || '',
        tag: cells[idx.tag] || '',
        phone: cells[idx.phone] || '',
        email: cells[idx.email] || '',
        note: cells[idx.note] || '',
        follow: cells[idx.follow] || '',
        source: cells[idx.source] || '',
        star: (cells[idx.star]||'').toLowerCase()==='true',
      };
      await idbPut(it);
    }
    await loadItems();
  };
  reader.readAsText(file);
});
function parseCSVLine(line){
  const out=[]; let cur=''; let q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(q){
      if(ch=='"' && line[i+1]=='"'){ cur+='"'; i++; }
      else if(ch=='"'){ q=false; }
      else cur+=ch;
    } else {
      if(ch===','){ out.push(cur); cur=''; }
      else if(ch=='"'){ q=true; }
      else cur+=ch;
    }
  }
  out.push(cur); return out;
}

// --- JSON export/import (portable) ---
document.getElementById('btnExportJSON').onclick=()=>{
  const blob = new Blob([JSON.stringify(items,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='clients.json'; a.click();
};
document.getElementById('importFileJSON').addEventListener('change', e=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async()=>{
    try{
      const arr=JSON.parse(reader.result);
      if(!Array.isArray(arr)) throw new Error('Неверный формат JSON');
      for(const it of arr){
        if(!it.id) it.id = uuid();
        if(!it.created) it.created = Date.now();
        await idbPut({
          id: it.id, created: it.created, name: it.name||'',
          tag: it.tag||'', phone: it.phone||'', email: it.email||'',
          note: it.note||'', follow: it.follow||'', source: it.source||'',
          star: !!it.star
        });
      }
      await loadItems();
      alert('Импортировано записей: '+arr.length);
    }catch(err){ alert('Ошибка импорта: '+err.message); }
  };
  reader.readAsText(file);
});

// --- ICS helper ---
function downloadICS(it){
  if(!it.follow){ alert('Установи дату/время следующего контакта.'); return; }
  const dt=new Date(it.follow); if(isNaN(dt)){ alert('Некорректная дата.'); return; }
  const dtStart=dt.toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  const dtEnd=new Date(dt.getTime()+30*60*1000).toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  const title=`Follow-up: ${it.name||'клиент'}`;
  const desc=(it.note||'')+(it.phone?` | Тел.: ${it.phone}`:'')+(it.email?` | Почта: ${it.email}`:'');
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ClientNotes//RU//EN','BEGIN:VEVENT','UID:'+it.id+'@clientnotes','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z','DTSTART:'+dtStart,'DTEND:'+dtEnd,'SUMMARY:'+escapeICS(title),'DESCRIPTION:'+escapeICS(desc),'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='followup.ics'; a.click();
}
function escapeICS(s){ return String(s).replace(/([,;])/g,'\\$1').replace(/\n/g,'\\n'); }

// Start
loadItems();
