Neutralino.init();

Neutralino.events.on("ready", async () => {
  loadSession();
  await loadSettings();
  await loadPresets();
  await loadTheme();
  await detectTool();
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
  lstIgnoreFiles: document.getElementById('lstIgnoreFiles'),
  lstIgnoreDirs: document.getElementById('lstIgnoreDirs'),
  txtIgnoreFile: document.getElementById('txtIgnoreFile'),
  txtIgnoreDir: document.getElementById('txtIgnoreDir'),
  btnAddIgnoreFile: document.getElementById('btnAddIgnoreFile'),
  btnAddIgnoreDir: document.getElementById('btnAddIgnoreDir'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),
  chkShowExtra: document.getElementById('chkShowExtra'),
  chkShowOlder: document.getElementById('chkShowOlder'),
  chkSelectAll: document.getElementById('chkSelectAll'),
  selPreset: document.getElementById('selPreset'),
  btnSavePreset: document.getElementById('btnSavePreset'),
  tbody: document.getElementById('tbody'),
  log: document.getElementById('log'),
  hint: document.getElementById('hint'),
  progress: document.getElementById('progress'),
  btnTheme: document.getElementById('btnTheme')
};

let rows = []; // [{status, rel, abs, sizeSrc, sizeDst, from:'src'|'dst', selected}]
let settings = { files: [], dirs: [] };
let presets = [];
let theme = 'light';
let hasRobocopy = false;

els.btnPreview.onclick = preview;
els.btnCopyAll.onclick = copyAll;
els.btnCopySel.onclick = copySelected;
els.chkSelectAll.onchange = () => setAllSelected(els.chkSelectAll.checked);
els.chkShowExtra.onchange = renderTable;
els.chkShowOlder.onchange = renderTable;
els.btnSavePreset.onclick = savePreset;
els.selPreset.onchange = () => {
  const i = parseInt(els.selPreset.value, 10);
  if (!isNaN(i) && presets[i]) {
    els.src.value = presets[i].src;
    els.dst.value = presets[i].dst;
  }
};
els.btnExit.onclick = () => Neutralino.app.exit();
els.btnSettings.onclick = () => {
  renderIgnoreLists();
  els.dlgSettings.showModal();
};
els.btnTheme.onclick = toggleTheme;
els.btnSaveSettings.onclick = async () => {
  await saveSettings();
  els.dlgSettings.close();
  toast('Сохранено ✨');
};
els.btnAddIgnoreFile.onclick = () => addIgnore('file');
els.btnAddIgnoreDir.onclick = () => addIgnore('dir');
els.lstIgnoreFiles.onclick = e => removeIgnore(e, 'file');
els.lstIgnoreDirs.onclick = e => removeIgnore(e, 'dir');
els.btnSrcBrowse.onclick = async () => {
  const p = await Neutralino.os.showFolderDialog('Source', { defaultPath: els.src.value });
  if (p) els.src.value = p;
};
els.btnDstBrowse.onclick = async () => {
  const p = await Neutralino.os.showFolderDialog('Dest', { defaultPath: els.dst.value });
  if (p) els.dst.value = p;
};

async function detectTool(){
  try{
    if(NL_OS === 'Windows')
      await Neutralino.os.execCommand('where robocopy');
    else
      await Neutralino.os.execCommand('command -v robocopy');
    hasRobocopy = true;
  }catch{ hasRobocopy = false; }
}

async function preview() {
  const src = norm(els.src.value);
  const dst = norm(els.dst.value);
  if (!src || !dst) return toast("Укажи SRC и DST 💛");
  await saveSession(src, dst);
  showProgress('indeterminate');
  try {
    if(hasRobocopy){
      // /L — только список, /MIR — чтобы показать Extra File, /S — подкаталоги
      // /NJH /NJS — без шапки/итогов, /FP — полный путь, /NDL — без директорий
      const ps = `powershell -NoProfile -Command `
        + `"$OutputEncoding=[Text.UTF8Encoding]::new(); `
        + `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); `
        + `robocopy '${src}' '${dst}' /L /MIR /S /NJH /NJS /FP /NDL"`;
      const r = await Neutralino.os.execCommand(ps);
      const lines = r.stdOut.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      rows = (await parseRobocopy(lines, src, dst)).filter(x => !isExcluded(x.rel));
    }else{
      const cmd = `rsync -ain --delete ${q(src)}/ ${q(dst)}/`;
      const r = await Neutralino.os.execCommand(cmd);
      const lines = r.stdOut.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      rows = (await parseRsync(lines, src, dst)).filter(x => !isExcluded(x.rel));
    }
    // по умолчанию выделяем только New/Updated
    rows.forEach(x => x.selected = (x.status === 'New' || x.status === 'Updated'));
    els.chkSelectAll.checked = true;
    renderTable();
    hint(`Найдено: ${rows.length}. Отмечены к копированию: ${rows.filter(x=>x.selected).length}`);
  } finally {
    hideProgress();
  }
}

async function parseRobocopy(lines, src, dst) {
  // Примеры строк:
  // "New File          C:\src\path\file.txt"
  // "Newer             C:\src\path\file.txt"
  // "Older             C:\src\path\file.txt"
  // "Extra File        C:\dst\path\file.txt"
  const out = [];
  // строки могут начинаться со звёздочки и содержать размер файла
  const rx = /^\*?(New File|Newer|Older|Extra File)\s+(?:([0-9]+)\s+)?(.+)$/i;

  for (const ln of lines) {
    const m = ln.match(rx);
    if (!m) continue;
    const tag = m[1];
    const size = parseInt(m[2] || '0', 10);
    const full = m[3];

    if (tag.toLowerCase() === 'extra file') {
      const rel = toRel(full, dst);
      out.push({ status: 'OnlyInDst', rel, abs: full, from: 'dst', selected: false, sizeSrc: 0, sizeDst: size });
    } else if (tag.toLowerCase() === 'new file') {
      const rel = toRel(full, src);
      out.push({ status: 'New', rel, abs: full, from: 'src', selected: true, sizeSrc: size, sizeDst: 0 });
    } else if (tag.toLowerCase() === 'newer') {
      const rel = toRel(full, src);
      out.push({ status: 'Updated', rel, abs: full, from: 'src', selected: true, sizeSrc: size, sizeDst: 0 });
    } else if (tag.toLowerCase() === 'older') {
      const rel = toRel(full, src);
      out.push({ status: 'Older', rel, abs: full, from: 'src', selected: false, sizeSrc: size, sizeDst: 0 });
    }
  }

  for (const r of out) {
    if (!r.sizeSrc) {
      try {
        const st = await Neutralino.filesystem.getStats(winPath(join(src, r.rel)));
        r.sizeSrc = st.size;
      } catch { r.sizeSrc = 0; }
    }
    if (!r.sizeDst) {
      try {
        const st = await Neutralino.filesystem.getStats(winPath(join(dst, r.rel)));
        r.sizeDst = st.size;
      } catch { r.sizeDst = 0; }
    }
  }

  return out.sort((a,b) => (a.status+b.rel).localeCompare(b.status+b.rel));
}

async function parseRsync(lines, src, dst){
  const out = [];
  const rxDel = /^\*deleting\s+(.+)$/i;
  const rxChg = /^>f[^\s]*\s+(.+)$/i;
  for(const ln of lines){
    let m;
    if(m = ln.match(rxDel)){
      const rel = m[1];
      out.push({ status:'OnlyInDst', rel, abs: join(dst, rel), from:'dst', selected:false, sizeSrc:0, sizeDst:0 });
    }else if(m = ln.match(rxChg)){
      const code = ln.slice(0,11);
      const rel = ln.slice(12).trim();
      const status = code.includes('+++++++++') ? 'New' : 'Updated';
      out.push({ status, rel, abs: join(src, rel), from:'src', selected:true, sizeSrc:0, sizeDst:0 });
    }
  }
  for(const r of out){
    if(!r.sizeSrc){
      try{ const st = await Neutralino.filesystem.getStats(winPath(join(src, r.rel))); r.sizeSrc = st.size; }catch{ r.sizeSrc = 0; }
    }
    if(!r.sizeDst){
      try{ const st = await Neutralino.filesystem.getStats(winPath(join(dst, r.rel))); r.sizeDst = st.size; }catch{ r.sizeDst = 0; }
    }
  }
  return out.sort((a,b)=>(a.status+b.rel).localeCompare(b.status+b.rel));
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

    const tdSizeSrc = document.createElement('td');
    tdSizeSrc.className = 'text-right';
    tdSizeSrc.textContent = formatKB(r.sizeSrc);
    if (r.sizeSrc > r.sizeDst) {
      tdSizeSrc.style.color = 'green';
    } else if (r.sizeSrc < r.sizeDst) {
      tdSizeSrc.style.color = 'red';
    }

    const tdSizeDst = document.createElement('td');
    tdSizeDst.className = 'text-right';
    tdSizeDst.textContent = formatKB(r.sizeDst);

    tr.appendChild(tdSel);
    tr.appendChild(tdStatus);
    tr.appendChild(tdPath);
    tr.appendChild(tdSizeSrc);
    tr.appendChild(tdSizeDst);
    els.tbody.appendChild(tr);
  }
}

async function copyAll() {
  const src = norm(els.src.value);
  const dst = norm(els.dst.value);
  showProgress('indeterminate');
  try {
    let cmd = '';
    if(hasRobocopy){
      const xf = settings.files.length ? (' /XF ' + settings.files.map(q).join(' ')) : '';
      const xd = settings.dirs.length ? (' /XD ' + settings.dirs.map(q).join(' ')) : '';
      cmd = `robocopy ${q(src)} ${q(dst)} /MIR /R:1 /W:1 /MT:8 /NFL /NDL /NP${xf}${xd}`;
    } else {
      const ex = settings.files.map(f => `--exclude ${q(f)}`).concat(settings.dirs.map(d => `--exclude ${q(d)}`)).join(' ');
      cmd = `rsync -a --delete ${ex} ${q(src)}/ ${q(dst)}/`;
    }
    log(`> ${cmd}\n`);
    const r = await Neutralino.os.execCommand(cmd);
    log(r.stdOut || r.stdErr || 'done');
    toast('Готово ✨');
  } finally {
    hideProgress();
  }
}

async function copySelected() {
  const src = norm(els.src.value);
  const dst = norm(els.dst.value);
  const items = rows.filter(x => x.selected);

  if (items.length === 0) return toast('Ничего не выбрано');

  showProgress('determinate', items.length);
  let done = 0;
  // Простая логика:
  // - New/Updated: Copy-Item файла
  // - OnlyInDst: удаляем файл в DST
  try {
    for (const it of items) {
      if (hasRobocopy) {
        if (it.status === 'OnlyInDst') {
          const target = winPath(join(dst, it.rel));
          const del = `powershell -NoProfile -Command "if(Test-Path -LiteralPath '${psq(target)}'){ Remove-Item -LiteralPath '${psq(target)}' -Force }"`;
          await Neutralino.os.execCommand(del);
          log(`файл ${target} удалён\n`);
        } else {
          const srcFile = winPath(join(src, it.rel));
          const dstFile = winPath(join(dst, it.rel));
          const dstDir = winPath(dirOf(dstFile));
          const cmd = `powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path '${psq(dstDir)}' | Out-Null; Copy-Item -LiteralPath '${psq(srcFile)}' -Destination '${psq(dstFile)}' -Force"`;
          await Neutralino.os.execCommand(cmd);
          log(`файл ${srcFile} скопирован в ${dstFile}\n`);
        }
      } else {
        if (it.status === 'OnlyInDst') {
          const target = join(dst, it.rel);
          const del = `rm -f ${q(target)}`;
          await Neutralino.os.execCommand(del);
          log(`файл ${target} удалён\n`);
        } else {
          const srcFile = join(src, it.rel);
          const dstFile = join(dst, it.rel);
          const dstDir = dirOf(dstFile);
          const cmd = `mkdir -p ${q(dstDir)} && cp -f ${q(srcFile)} ${q(dstFile)}`;
          await Neutralino.os.execCommand(cmd);
          log(`файл ${srcFile} скопирован в ${dstFile}\n`);
        }
      }
      updateProgress(++done);
    }
    toast('Готово ✨');
  } finally {
    hideProgress();
  }
}

function setAllSelected(v){ rows.forEach(r => r.selected = v); renderTable(); }

// ===== Helpers =====
function formatKB(bytes){
  return (bytes / 1024).toFixed(2) + ' Кб';
}
function norm(p){
  const sep = NL_OS === 'Windows' ? '\\' : '/';
  const reTrail = NL_OS === 'Windows' ? /\\+$/ : /\/+$/;
  return (p || '').replace(/[\\\/]/g, sep).replace(reTrail, '');
}
function winPath(p){ return NL_OS === 'Windows' ? p.replace(/\//g,'\\') : p; }
function join(a,b){
  const s = NL_OS === 'Windows' ? '\\' : '/';
  return a.replace(/[\\\/]+$/,'') + s + b.replace(/^[\\\/]+/,'');
}
function dirOf(p){ return p.replace(/[\\\/][^\\\/]+$/,''); }
function q(s){ return `"${s.replace(/"/g,'\\"')}"`; }
function psq(s){ return s.replace(/'/g,"''"); }
function toRel(full, root){
  const A = norm(full).toLowerCase();
  const R = norm(root).toLowerCase();
  if (A.startsWith(R)) return full.slice(R.length).replace(/^[\\\/]+/,'');
  return full;
}
function isExcluded(rel){
  const name = rel.split(/[\\\/]/).pop();
  if (settings.files.includes(name)) return true;
  const parts = rel.split(/[\\\/]/);
  return parts.some(p => settings.dirs.includes(p));
}
function renderIgnoreLists(){
  els.lstIgnoreFiles.innerHTML = '';
  settings.files.forEach((f,i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="col-8">${f}</span><button data-idx="${i}" class="icon-btn"><span class="material-icons">close</span></button>`;
    els.lstIgnoreFiles.appendChild(row);
  });
  els.lstIgnoreDirs.innerHTML = '';
  settings.dirs.forEach((d,i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="col-8">${d}</span><button data-idx="${i}" class="icon-btn"><span class="material-icons">close</span></button>`;
    els.lstIgnoreDirs.appendChild(row);
  });
}
function addIgnore(type){
  const input = type === 'file' ? els.txtIgnoreFile : els.txtIgnoreDir;
  const val = input.value.trim();
  if(!val) return;
  const arr = type === 'file' ? settings.files : settings.dirs;
  if(!arr.includes(val)) arr.push(val);
  input.value = '';
  renderIgnoreLists();
}
function removeIgnore(e, type){
  const btn = e.target.closest('button');
  if(!btn) return;
  const idx = parseInt(btn.dataset.idx,10);
  if(isNaN(idx)) return;
  const arr = type === 'file' ? settings.files : settings.dirs;
  arr.splice(idx,1);
  renderIgnoreLists();
}
function parseIgnoreText(text){
  const arr = (text || '').split(',').map(s => s.trim()).filter(Boolean);
  const files = [], dirs = [];
  for (const a of arr){ if(a.includes('.')) files.push(a); else dirs.push(a); }
  return {files, dirs};
}
function log(s){ els.log.textContent += s; els.log.scrollTop = els.log.scrollHeight; }
function hint(s){ els.hint.textContent = s; }
function toast(msg){ Neutralino.os.showMessageBox('Syncer', msg); }
function showProgress(type, max){
  els.progress.style.display = 'block';
  if(type === 'indeterminate'){
    els.progress.removeAttribute('value');
    els.progress.removeAttribute('max');
  }else{
    els.progress.value = 0;
    els.progress.max = max;
  }
}
function updateProgress(val){
  if(els.progress.hasAttribute('value')) els.progress.value = val;
}
function hideProgress(){
  els.progress.style.display = 'none';
}
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
    if(Array.isArray(obj.files)) settings.files = obj.files;
    if(Array.isArray(obj.dirs)) settings.dirs = obj.dirs;
    if(obj.ignore){
      const {files, dirs} = parseIgnoreText(obj.ignore);
      settings.files = files;
      settings.dirs = dirs;
    }
  }catch{}
}

async function saveSettings(){
  try{
    await Neutralino.storage.setData('robogui_settings', JSON.stringify(settings));
  }catch{}
}

async function loadPresets(){
  try{
    const s = await Neutralino.storage.getData('robogui_presets');
    if(s) presets = JSON.parse(s);
  }catch{}
  renderPresets();
}

async function savePreset(){
  const src = norm(els.src.value);
  const dst = norm(els.dst.value);
  if(!src || !dst) return toast("Укажи SRC и DST 💛");
  presets.push({src,dst});
  try{
    await Neutralino.storage.setData('robogui_presets', JSON.stringify(presets));
  }catch{}
  renderPresets();
  toast('Пресет сохранён ✨');
}

function renderPresets(){
  els.selPreset.innerHTML = '<option value="">-- пресеты --</option>';
  presets.forEach((p,i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${p.src} ➜ ${p.dst}`;
    els.selPreset.appendChild(opt);
  });
}

async function loadTheme(){
  try{
    const t = await Neutralino.storage.getData('robogui_theme');
    if(t) theme = t;
  }catch{}
  applyTheme();
}

async function toggleTheme(){
  theme = theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  try{ await Neutralino.storage.setData('robogui_theme', theme); }catch{}
}

function applyTheme(){
  document.documentElement.setAttribute('data-theme', theme);
  els.btnTheme.innerHTML = theme === 'dark'
    ? '<span class="material-icons">light_mode</span>'
    : '<span class="material-icons">dark_mode</span>';
}
