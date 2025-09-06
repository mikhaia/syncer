// 🧡 Простой и чистый код

NL_ON('ready', async () => {
  // автозаполнение путей из последней сессии
  loadSession();
  await loadSettings();
});

const els = {
  src: document.getElementById('src'),
  dst: document.getElementById('dst'),
  btnPreview: document.getElementById('btnPreview'),
  btnCopyAll: document.getElementById('btnCopyAll'),
  btnCopySel: document.getElementById('btnCopySel'),
  btnSettings: document.getElementById('btnSettings'),
  btnExit: document.getElementById('btnExit'),
  btnSrcBrowse: document.getElementById('btnSrcBrowse'),
  btnDstBrowse: document.getElementById('btnDstBrowse'),
  dlgSettings: document.getElementById('dlgSettings'),
  txtIgnore: document.getElementById('txtIgnore'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),
  chkShowExtra: document.getElementById('chkShowExtra'),
  chkShowOlder: document.getElementById('chkShowOlder'),
  chkSelectAll: document.getElementById('chkSelectAll'),
  tbody: document.getElementById('tbody'),
  log: document.getElementById('log'),
  hint: document.getElementById('hint')
};

let rows = []; // [{status, rel, abs, from:'src'|'dst', selected}]
let settings = { ignore: '' };

els.btnPreview.onclick = preview;
els.btnCopyAll.onclick = copyAll;
els.btnCopySel.onclick = copySelected;
els.chkSelectAll.onchange = () => setAllSelected(els.chkSelectAll.checked);
els.chkShowExtra.onchange = renderTable;
els.chkShowOlder.onchange = renderTable;
els.btnExit.onclick = () => Neutralino.app.exit();
els.btnSettings.onclick = () => {
  els.txtIgnore.value = settings.ignore;
  els.dlgSettings.showModal();
};
els.btnSaveSettings.onclick = async () => {
  settings.ignore = els.txtIgnore.value;
  await saveSettings();
  els.dlgSettings.close();
  toast('Сохранено ✨');
};
els.btnSrcBrowse.onclick = async () => {
  const p = await Neutralino.os.showFolderDialog('Source', { defaultPath: els.src.value });
  if (p) els.src.value = p;
};
els.btnDstBrowse.onclick = async () => {
  const p = await Neutralino.os.showFolderDialog('Dest', { defaultPath: els.dst.value });
  if (p) els.dst.value = p;
};

async function preview() {
  const src = norm(els.src.value);
  const dst = norm(els.dst.value);
  if (!src || !dst) return toast("Укажи SRC и DST 💛");
  await saveSession(src, dst);

  const excl = parseExclude(settings.ignore);
  // /L — только список, /MIR — чтобы показать Extra File, /S — подкаталоги
  // /NJH /NJS — без шапки/итогов, /FP — полный путь, /NDL — без директорий
  const cmd = `robocopy "${src}" "${dst}" /L /MIR /S /NJH /NJS /FP /NDL`;
  log(`> ${cmd}\n`);

  const r = await Neutralino.os.execCommand(cmd);
  const lines = r.stdOut.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  rows = parseRobocopy(lines, src, dst).filter(x => !isExcluded(x.rel, excl));
  // по умолчанию выделяем только New/Updated
  rows.forEach(x => x.selected = (x.status === 'New' || x.status === 'Updated'));
  els.chkSelectAll.checked = true;
  renderTable();
  hint(`Найдено: ${rows.length}. Отмечены к копированию: ${rows.filter(x=>x.selected).length}`);
}

function parseRobocopy(lines, src, dst) {
  // Примеры строк:
  // "New File          C:\src\path\file.txt"
  // "Newer             C:\src\path\file.txt"
  // "Older             C:\src\path\file.txt"
  // "Extra File        C:\dst\path\file.txt"
  const out = [];
  const rx = /^(New File|Newer|Older|Extra File)\s+(.*)$/i;

  for (const ln of lines) {
    const m = ln.match(rx);
    if (!m) continue;
    const tag = m[1];
    const full = m[2];

    if (tag === 'Extra File') {
      const rel = toRel(full, dst);
      out.push({ status: 'OnlyInDst', rel, abs: full, from: 'dst', selected: false });
    } else if (tag === 'New File') {
      const rel = toRel(full, src);
      out.push({ status: 'New', rel, abs: full, from: 'src', selected: true });
    } else if (tag === 'Newer') {
      const rel = toRel(full, src);
      out.push({ status: 'Updated', rel, abs: full, from: 'src', selected: true });
    } else if (tag === 'Older') {
      const rel = toRel(full, src);
      out.push({ status: 'Older', rel, abs: full, from: 'src', selected: false });
    }
  }
  return out.sort((a,b) => (a.status+b.rel).localeCompare(b.status+b.rel));
}

function renderTable() {
  const showExtra = els.chkShowExtra.checked;
  const showOlder = els.chkShowOlder.checked;

  els.tbody.innerHTML = '';
  for (const r of rows) {
    if (r.status === 'OnlyInDst' && !showExtra) continue;
    if (r.status === 'Older' && !showOlder) continue;

    const tr = document.createElement('tr');

    const tdSel = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = r.selected;
    cb.onchange = () => r.selected = cb.checked;
    tdSel.appendChild(cb);

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `status ${r.status}`;
    badge.textContent = r.status;
    tdStatus.appendChild(badge);

    const tdPath = document.createElement('td');
    tdPath.textContent = r.rel;

    tr.appendChild(tdSel);
    tr.appendChild(tdStatus);
    tr.appendChild(tdPath);
    els.tbody.appendChild(tr);
  }
}

async function copyAll() {
  const src = norm(els.src.value);
  const dst = norm(els.dst.value);
  const excl = parseExclude(settings.ignore);

  // Формируем /XF и /XD
  const xf = excl.files.length ? (' /XF ' + excl.files.map(q).join(' ')) : '';
  const xd = excl.dirs.length ? (' /XD ' + excl.dirs.map(q).join(' ')) : '';

  const cmd = `robocopy "${src}" "${dst}" /MIR /R:1 /W:1 /MT:8 /NFL /NDL /NP${xf}${xd}`;
  log(`> ${cmd}\n`);
  const r = await Neutralino.os.execCommand(cmd);
  log(r.stdOut || r.stdErr || 'done');
  toast('Готово ✨');
}

async function copySelected() {
  const src = norm(els.src.value);
  const dst = norm(els.dst.value);
  const items = rows.filter(x => x.selected);

  if (items.length === 0) return toast('Ничего не выбрано');

  // Простая логика:
  // - New/Updated: Copy-Item файла
  // - OnlyInDst: удаляем файл в DST
  for (const it of items) {
    if (it.status === 'OnlyInDst') {
      const target = winPath(join(dst, it.rel));
      const del = `powershell -NoProfile -Command "if(Test-Path -LiteralPath '${psq(target)}'){ Remove-Item -LiteralPath '${psq(target)}' -Force }"`;
      log(`> ${del}\n`);
      await Neutralino.os.execCommand(del);
    } else {
      const srcFile = winPath(join(src, it.rel));
      const dstFile = winPath(join(dst, it.rel));
      const dstDir = winPath(dirOf(dstFile));
      const cmd = `powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path '${psq(dstDir)}' | Out-Null; Copy-Item -LiteralPath '${psq(srcFile)}' -Destination '${psq(dstFile)}' -Force"`;
      log(`> ${cmd}\n`);
      await Neutralino.os.execCommand(cmd);
    }
  }
  toast('Готово ✨');
}

function setAllSelected(v){ rows.forEach(r => r.selected = v); renderTable(); }

// ===== Helpers =====
function norm(p){ return (p || '').replace(/\//g, '\\').replace(/[\\]+$/,''); }
function winPath(p){ return p.replace(/\//g,'\\'); }
function join(a,b){ return a.replace(/[\\\/]+$/,'') + '\\' + b.replace(/^[\\\/]+/,''); }
function dirOf(p){ return p.replace(/[\\\/][^\\\/]+$/,''); }
function q(s){ return `"${s}"`; }
function psq(s){ return s.replace(/'/g,"''"); }
function toRel(full, root){
  const A = norm(full).toLowerCase();
  const R = norm(root).toLowerCase();
  if (A.startsWith(R)) return full.slice(R.length).replace(/^[\\\/]+/,'');
  return full;
}
function parseExclude(text){
  const arr = (text || '').split(',').map(s => s.trim()).filter(Boolean);
  const files = [], dirs = [];
  for (const a of arr){ if (a.includes('.')) files.push(a); else dirs.push(a); }
  return { files, dirs };
}
function isExcluded(rel, excl){
  const name = rel.split(/\\|\//).pop();
  if (excl.files.includes(name)) return true;
  const parts = rel.split(/\\|\//);
  return parts.some(p => excl.dirs.includes(p));
}
function log(s){ els.log.textContent += s; els.log.scrollTop = els.log.scrollHeight; }
function hint(s){ els.hint.textContent = s; }
async function saveSession(src,dst){
  try{ await Neutralino.storage.setData('robogui', JSON.stringify({src,dst,ts:Date.now()})); }catch{}
}
async function loadSession(){
  try{
    const s = await Neutralino.storage.getData('robogui');
    if(!s) return;
    const {src,dst} = JSON.parse(s);
    if(src) els.src.value = src;
    if(dst) els.dst.value = dst;
  }catch{}
}

async function loadSettings(){
  try{
    const s = await Neutralino.storage.getData('robogui_settings');
    if(!s) return;
    const obj = JSON.parse(s);
    settings = Object.assign(settings, obj);
  }catch{}
}

async function saveSettings(){
  try{
    await Neutralino.storage.setData('robogui_settings', JSON.stringify(settings));
  }catch{}
}
