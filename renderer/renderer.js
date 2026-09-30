/* ---------- Tipos de artefacto (fijos, cada uno con icono propio) ---------- */
const TYPES = [
  {id:'servidor',   name:'Servidor',            icon:'🖥️', color:'#e7ecff', nests:['aplicacion', 'api','pwa']},
  {id:'aplicacion', name:'Aplicación',          icon:'🧩', color:'#e8f7ec'},
  {id:'api',        name:'Api',                 icon:'🔌', color:'#e8f7ec'},
  {id:'pwa',        name:'Power Automate Flow', icon:'🤖', color:'#e8f7ec'},
  {id:'bd',         name:'Base de Datos',       icon:'🗄️', color:'#fff3e0'},
  {id:'red',        name:'Red',                 icon:'🌐', color:'#e6f7ff'},
  {id:'almacen',    name:'Almacenamiento',      icon:'💾', color:'#f3e8ff'},
  {id:'servicio',   name:'Servicio',            icon:'⚙️', color:'#fdf0f0'},
  {id:'usuario',    name:'Usuario',             icon:'👤', color:'#f0f4ff'},
  {id:'externo',    name:'Sistema Externo',     icon:'🔗', color:'#f5f5f0'},
];
const typeById = id => TYPES.find(t=>t.id===id);

const REL_TYPES = [
  'Depende de','Se comunica (Rest) con','Usa',
  'Accede (In) a','Accede (Out) a','Accede (I/O) a',
  'Contiene','Publica (Fichero) en','Autentica contra'
];

const SVG_NS = 'http://www.w3.org/2000/svg';

// Cada tipo de relación se identifica por un color y, cuando dos tipos comparten
// color (la familia "Accede"), también por un patrón de trazo distinto — así la
// distinción no depende solo del color. Paleta con buen contraste entre sí
// (inspirada en Okabe-Ito, pensada para daltonismo).
const REL_STYLES = {
  'Depende de':              { color:'#0072B2', dash:null,          markerId:'arrow-1' },
  'Se comunica (Rest) con':  { color:'#009E73', dash:null,          markerId:'arrow-2' },
  'Usa':                     { color:'#E69F00', dash:null,          markerId:'arrow-3' },
  'Accede (In) a':           { color:'#56B4E9', dash:null,          markerId:'arrow-4' },
  'Accede (Out) a':          { color:'#56B4E9', dash:'7,4',         markerId:'arrow-5' },
  'Accede (I/O) a':          { color:'#56B4E9', dash:'9,3,2,3',     markerId:'arrow-6' },
  'Contiene':                { color:'#CC79A7', dash:null,          markerId:'arrow-7' },
  'Publica (Fichero) en':    { color:'#D55E00', dash:null,          markerId:'arrow-8' },
  'Autentica contra':        { color:'#111827', dash:null,          markerId:'arrow-9' }
};
// Relación con un tipo que no está en la lista (texto personalizado, o el nombre
// de un tipo antiguo tras renombrarlos): color neutro y trazo punteado propio.
const DEFAULT_REL_STYLE = { color:'#6b7280', dash:'2,3', markerId:'arrow-default' };

function relStyleFor(type){ return REL_STYLES[type] || DEFAULT_REL_STYLE; }

// Crea (una sola vez) el marcador de flecha de cada tipo, con el color a juego,
// dentro de <defs> del SVG del lienzo.
function buildRelMarkers(){
  const defs = document.querySelector('#lines defs');
  if(!defs) return;
  const all = [...Object.values(REL_STYLES), DEFAULT_REL_STYLE];
  all.forEach(style=>{
    if(document.getElementById(style.markerId)) return;
    const marker = document.createElementNS(SVG_NS,'marker');
    marker.setAttribute('id', style.markerId);
    marker.setAttribute('markerWidth','10');
    marker.setAttribute('markerHeight','10');
    marker.setAttribute('refX','8');
    marker.setAttribute('refY','3');
    marker.setAttribute('orient','auto');
    marker.setAttribute('markerUnits','strokeWidth');
    const path = document.createElementNS(SVG_NS,'path');
    path.setAttribute('d','M0,0 L0,6 L8,3 z');
    path.setAttribute('fill', style.color);
    marker.appendChild(path);
    defs.appendChild(marker);
  });
}

// Panel de leyenda: un tramo de línea por tipo (con su color y trazo) + su nombre.
function renderLegend(){
  const list = document.getElementById('legendList');
  if(!list) return;
  const rows = REL_TYPES.map(rt => ({ label:rt, style:REL_STYLES[rt] }));
  rows.push({ label:'Otro (tipo personalizado)', style:DEFAULT_REL_STYLE });
  list.innerHTML = rows.map(({label, style}) => `
    <div class="legend-row">
      <svg class="legend-swatch" viewBox="0 0 30 10" width="30" height="10" aria-hidden="true">
        <line x1="1" y1="5" x2="29" y2="5" stroke="${style.color}" stroke-width="3"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}/>
      </svg>
      <span class="legend-label">${escapeHtml(label)}</span>
    </div>
  `).join('');
}

function initLegend(){
  renderLegend();
  const panel = document.getElementById('legendPanel');
  const toggle = document.getElementById('legendToggle');
  const caret = document.getElementById('legendCaret');
  if(!panel || !toggle) return;
  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    if(caret) caret.textContent = collapsed ? '▸' : '▾';
  });
}


/* ---------- Estado (persistido en disco por el proceso principal) ---------- */
let state = { artifacts:[], nodes:[], relations:[] };

const saveStatusEl = () => document.getElementById('saveStatus');
let saveTimer = null;
function save(){
  const el = saveStatusEl();
  if(el) el.textContent = 'Guardando…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    await window.api.saveData(state);
    if(el) el.textContent = 'Guardado';
  }, 150);
}
function uid(){ return 'id'+Math.random().toString(36).slice(2,10); }

/* ---------- Biblioteca + buscador ---------- */
const libSearch = { text: '', typeId: '' };
const collapsedGroups = new Set();   // grupos plegados a mano (se conservan entre renders)
let libDragArtifactId = null;        // artefacto que se está arrastrando desde la biblioteca

// Minúsculas y sin tildes: "produccion" encuentra "Producción"
function normalizeText(s){
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getSearchTerms(){
  return normalizeText(libSearch.text).split(/\s+/).filter(Boolean);
}

// null  -> el artefacto no cumple el filtro.
// array -> sí lo cumple; contiene las propiedades que han coincidido con el texto
//          (vacío si no hay texto o si solo coincide por nombre/tipo).
// Todos los términos deben aparecer en el nombre, el tipo o alguna propiedad
// (clave o valor).
function matchArtifact(artifact, terms){
  if(libSearch.typeId && artifact.typeId !== libSearch.typeId) return null;
  if(terms.length === 0) return [];

  const type = typeById(artifact.typeId);
  const name = normalizeText(artifact.name);
  const typeName = normalizeText(type ? type.name : '');
  const props = (artifact.properties || []).map(p => ({
    prop: p,
    text: normalizeText(p.key + ' ' + p.value)
  }));

  const ok = terms.every(t =>
    name.includes(t) || typeName.includes(t) || props.some(x => x.text.includes(t))
  );
  if(!ok) return null;

  return props
    .filter(x => terms.some(t => x.text.includes(t)))
    .map(x => x.prop);
}

/* ---------- Resultado de la búsqueda también en el lienzo ---------- */

// Nodos del lienzo cuyo artefacto cumple la búsqueda actual (texto y/o tipo).
//   hits    -> nodos que coinciden (se resaltan)
//   context -> servidores que NO coinciden pero contienen un nodo que sí lo hace.
//              Se dejan sin atenuar: la atenuación se hereda a los hijos y
//              apagaría también al resultado que hay dentro.
// Devuelve null si no hay ningún filtro activo.
function getSearchState(){
  const terms = getSearchTerms();
  if(terms.length === 0 && !libSearch.typeId) return null;

  const hits = new Set();
  state.nodes.forEach(n => {
    const a = state.artifacts.find(x => x.id === n.artifactId);
    if(a && matchArtifact(a, terms) !== null) hits.add(n.id);
  });

  const context = new Set();
  hits.forEach(id => {
    const n = state.nodes.find(x => x.id === id);
    if(n && n.parentId && !hits.has(n.parentId)) context.add(n.parentId);
  });
  return { hits, context };
}

// Copia calculada en cada renderizado del lienzo (y al cambiar la búsqueda)
let searchView = null;
function refreshSearchView(){ searchView = getSearchState(); }

// '' (sin marca), 'hit' (coincide) o 'dim' (no coincide)
function searchClassFor(nodeId){
  if(!searchView) return '';
  if(searchView.hits.has(nodeId)) return 'hit';
  if(searchView.context.has(nodeId)) return '';
  return 'dim';
}

// Actualiza el resalte sobre los nodos ya dibujados, sin reconstruir el lienzo
function applySearchHighlight(){
  refreshSearchView();
  document.querySelectorAll('.node').forEach(el => {
    const c = searchClassFor(el.dataset.node);
    el.classList.toggle('search-hit', c === 'hit');
    el.classList.toggle('search-dim', c === 'dim');
  });
  updateLines();
}

// Texto bajo el buscador: resultados en la biblioteca y objetos resaltados en el lienzo
let lastLibraryShown = 0;
function updateSearchInfo(){
  const info = document.getElementById('libSearchInfo');
  if(!info) return;
  const filtering = getSearchTerms().length > 0 || !!libSearch.typeId;
  if(!filtering || state.artifacts.length === 0){ info.textContent = ''; return; }
  let text = `${lastLibraryShown} de ${state.artifacts.length} artefactos`;
  if(lastLibraryShown > 0){
    const view = getSearchState();
    const n = view ? view.hits.size : 0;
    text += n === 0
      ? ' · ninguno en el lienzo'
      : ` · ${n} resaltado${n === 1 ? '' : 's'} en el lienzo`;
  }
  info.textContent = text;
}

function onSearchChanged(){
  renderLibrary();
  applySearchHighlight();
}

function renderLibrary(){
  const el = document.getElementById('libraryList');
  const info = document.getElementById('libSearchInfo');
  el.innerHTML = '';

  if(state.artifacts.length===0){
    el.innerHTML =
      '<div class="empty-msg">Todavía no hay artefactos.<br>Crea uno con "Nuevo artefacto".</div>';
    lastLibraryShown = 0;
    if(info) info.textContent = '';
    return;
  }

  const terms = getSearchTerms();
  const filtering = terms.length > 0 || !!libSearch.typeId;
  let shown = 0;

  TYPES.forEach(type => {
    const matches = [];
    state.artifacts
      .filter(a => a.typeId === type.id)
      .forEach(a => {
        const propHits = matchArtifact(a, terms);
        if(propHits) matches.push({ artifact: a, propHits });
      });

    if(matches.length === 0) return;
    shown += matches.length;

    // Al buscar, los grupos con resultados se muestran siempre desplegados
    const collapsed = !filtering && collapsedGroups.has(type.id);

    const group = document.createElement('div');
    group.className = 'lib-group';

    const header = document.createElement('div');
    header.className = 'lib-group-header';
    header.innerHTML = `
      <span class="toggle">${collapsed ? '▶' : '▼'}</span>
      <span class="group-icon">${type.icon}</span>
      <span class="group-title">${type.name}</span>
      <span class="group-count">(${matches.length})</span>
    `;

    const content = document.createElement('div');
    content.className = 'lib-group-content';
    content.style.display = collapsed ? 'none' : 'block';

    matches.forEach(m => {
      content.appendChild(buildLibraryItem(m.artifact, type, m.propHits));
    });

    header.onclick = () => {
      const wasCollapsed = content.style.display === 'none';
      content.style.display = wasCollapsed ? 'block' : 'none';
      header.querySelector('.toggle').textContent = wasCollapsed ? '▼' : '▶';
      if(wasCollapsed) collapsedGroups.delete(type.id);
      else collapsedGroups.add(type.id);
    };

    group.appendChild(header);
    group.appendChild(content);
    el.appendChild(group);
  });

  lastLibraryShown = shown;
  updateSearchInfo();
  if(filtering && shown === 0){
    el.innerHTML = '<div class="empty-msg">Ningún artefacto coincide con la búsqueda.</div>';
  }
}

function initLibrarySearch(){
  const input = document.getElementById('libSearch');
  const select = document.getElementById('libTypeFilter');

  TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.icon} ${t.name}`;
    select.appendChild(opt);
  });

  input.addEventListener('input', () => {
    libSearch.text = input.value;
    onSearchChanged();
  });
  select.addEventListener('change', () => {
    libSearch.typeId = select.value;
    onSearchChanged();
  });
  input.addEventListener('keydown', e => {
    if(e.key === 'Escape' && input.value){
      input.value = '';
      libSearch.text = '';
      onSearchChanged();
    }
  });

  // Ctrl+F (Cmd+F en Mac) lleva el foco al buscador
  document.addEventListener('keydown', e => {
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f'){
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// propHits: propiedades que han coincidido con la búsqueda (se muestran como pista)
function buildLibraryItem(artifact, type, propHits = []) {
  const item = document.createElement('div');

  item.className = 'lib-item';
  item.draggable = true;
  item.dataset.artifactId = artifact.id;

  item.addEventListener('dragstart', event => {
    libDragArtifactId = artifact.id;
    event.dataTransfer.setData('text/artifact-id', artifact.id);
    event.dataTransfer.effectAllowed = 'copy';
  });
  item.addEventListener('dragend', () => {
    libDragArtifactId = null;
    setDropTarget(null);
  });

  const hintHtml = propHits.length
    ? `<div class="hint">${
        propHits.slice(0, 3)
          .map(p => `<div class="hint-line" title="${escapeHtml(p.key)}: ${escapeHtml(p.value)}">${escapeHtml(p.key)}: <b>${escapeHtml(p.value)}</b></div>`)
          .join('')
      }${propHits.length > 3 ? `<div class="hint-line hint-more">+${propHits.length - 3} más</div>` : ''}</div>`
    : '';

  item.innerHTML = `
    <div
      class="lib-icon"
      style="background:${type.color}"
    >
      ${type.icon}
    </div>

    <div class="lib-info">
      <div class="name">
        ${escapeHtml(artifact.name)}
      </div>

      <div class="type">
        ${escapeHtml(type.name)}
      </div>
    </div>

    <div class="lib-item-actions">
      <button
        type="button"
        class="ghost"
        title="Editar ${escapeHtml(artifact.name)}"
        data-edit="${artifact.id}"
      >
        ✏️
      </button>

      <button
        type="button"
        class="ghost"
        title="Duplicar ${escapeHtml(artifact.name)}"
        data-dup="${artifact.id}"
      >
        📋
      </button>

      <button
        type="button"
        class="ghost"
        title="Eliminar ${escapeHtml(artifact.name)}"
        data-del="${artifact.id}"
      >
        🗑️
      </button>
    </div>
    ${hintHtml}
  `;

  item.querySelector('[data-edit]').addEventListener(
    'click',
    event => {
      event.stopPropagation();
      openArtifactModal(artifact.id);
    }
  );

  item.querySelector('[data-dup]').addEventListener(
    'click',
    event => {
      event.stopPropagation();
      duplicateArtifact(artifact.id);
      renderLibrary();
    }
  );

  item.querySelector('[data-del]').addEventListener(
    'click',
    event => {
      event.stopPropagation();
      deleteArtifact(artifact.id);
    }
  );

  return item;
}

function buildUnknownArtifactsGroup(artifacts) {
  const group = document.createElement('section');
  group.className = 'library-group library-group-unknown';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'library-group-header';
  header.setAttribute('aria-expanded', 'true');

  header.innerHTML = `
    <span class="library-group-icon">
      ❓
    </span>

    <span class="library-group-name">
      Tipo desconocido
    </span>

    <span class="library-group-count">
      ${artifacts.length}
    </span>

    <span class="library-group-arrow">⌄</span>
  `;

  const content = document.createElement('div');
  content.className = 'library-group-content';

  const unknownType = {
    id: 'unknown',
    name: 'Tipo desconocido',
    icon: '❓',
    color: '#eeeeee'
  };

  artifacts.forEach(artifact => {
    content.appendChild(
      buildLibraryItem(artifact, unknownType)
    );
  });

  header.addEventListener('click', () => {
    const collapsed = group.classList.toggle('collapsed');

    header.setAttribute(
      'aria-expanded',
      String(!collapsed)
    );
  });

  group.appendChild(header);
  group.appendChild(content);

  return group;
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- CRUD artefactos ---------- */
// Nombre único para una copia: "X" -> "X (copia)" -> "X (copia 2)"...
// (si el nombre ya terminaba en "(copia)"/"(copia N)" se parte de la base sin ese sufijo)
function uniqueCopyName(baseName){
  const base = baseName.replace(/\s*\(copia(?:\s+\d+)?\)\s*$/i, '').trim() || baseName;
  const existing = new Set(state.artifacts.map(a => a.name));
  let candidate = `${base} (copia)`;
  let n = 2;
  while(existing.has(candidate)){
    candidate = `${base} (copia ${n})`;
    n++;
  }
  return candidate;
}

// Crea una copia independiente del artefacto (nuevo id, propiedades clonadas) justo
// después del original en la biblioteca. Devuelve el nuevo artefacto, o null si el
// original ya no existe.
function duplicateArtifact(id){
  const idx = state.artifacts.findIndex(a => a.id === id);
  if(idx === -1) return null;
  const original = state.artifacts[idx];
  const copy = {
    id: uid(),
    name: uniqueCopyName(original.name),
    typeId: original.typeId,
    description: original.description,
    properties: original.properties.map(p => ({...p}))
  };
  state.artifacts.splice(idx + 1, 0, copy);
  save();
  return copy;
}

// Duplica el artefacto de un nodo del lienzo y coloca la copia justo al lado,
// dentro del mismo servidor si el original estaba anidado.
function duplicateNode(nodeId){
  const node = state.nodes.find(n => n.id === nodeId);
  if(!node) return;
  const copyArtifact = duplicateArtifact(node.artifactId);
  if(!copyArtifact) return;
  state.nodes.push({
    id: uid(),
    artifactId: copyArtifact.id,
    x: node.x + 24,
    y: node.y + 24,
    parentId: node.parentId
  });
  save();
  renderLibrary();
  renderCanvas();
}

function deleteArtifact(id){
  if(!confirm('¿Eliminar este artefacto? También se quitará del lienzo y sus relaciones.')) return;
  state.artifacts = state.artifacts.filter(a=>a.id!==id);
  const nodeIds = state.nodes.filter(n=>n.artifactId===id).map(n=>n.id);
  state.nodes = state.nodes.filter(n=>n.artifactId!==id);
  state.relations = state.relations.filter(r=>!nodeIds.includes(r.from) && !nodeIds.includes(r.to));
  save(); renderLibrary(); renderCanvas();
}

let modalProps = [];

function openArtifactModal(id){
  const a = id ? state.artifacts.find(x=>x.id===id) : null;
  modalProps = a ? a.properties.map(p=>({...p})) : [];
  const overlay = document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${a? 'Editar artefacto' : 'Nuevo artefacto'}</h3>
      <div class="field">
        <label>Nombre</label>
        <input type="text" id="f_name" value="${a?escapeHtml(a.name):''}">
      </div>
      <div class="field">
        <label>Tipo</label>
        <div class="type-grid" id="f_type_grid"></div>
      </div>
      <div class="field">
        <label>Descripción</label>
        <textarea id="f_desc">${a?escapeHtml(a.description):''}</textarea>
      </div>
      <div class="field">
        <label>Propiedades</label>
        <div id="f_props"></div>
        <button type="button" id="f_addprop">＋ Añadir propiedad</button>
      </div>
      <div class="modal-actions">
        <div>${a?'<button class="danger" id="f_delete">Eliminar</button>':''}</div>
        <div class="right">
          <button id="f_cancel">Cancelar</button>
          <button class="primary" id="f_save">Guardar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let selectedType = a ? a.typeId : TYPES[0].id;
  const grid = overlay.querySelector('#f_type_grid');
  function renderTypeGrid(){
    grid.innerHTML='';
    TYPES.forEach(t=>{
      const opt = document.createElement('div');
      opt.className = 'type-opt'+(t.id===selectedType?' selected':'');
      opt.innerHTML = `<div class="ic">${t.icon}</div>${t.name}`;
      opt.onclick = ()=>{ selectedType=t.id; renderTypeGrid(); };
      grid.appendChild(opt);
    });
  }
  renderTypeGrid();

  const propsEl = overlay.querySelector('#f_props');
  function renderProps(){
    propsEl.innerHTML='';
    modalProps.forEach((p,i)=>{
      const row = document.createElement('div');
      row.className='prop-row';
      row.innerHTML = `<input type="text" placeholder="clave" value="${escapeHtml(p.key)}" data-k="${i}">
                        <input type="text" placeholder="valor" value="${escapeHtml(p.value)}" data-v="${i}">
                        <button type="button" data-rm="${i}">✕</button>`;
      row.querySelector('[data-k]').oninput = e=>modalProps[i].key=e.target.value;
      row.querySelector('[data-v]').oninput = e=>modalProps[i].value=e.target.value;
      row.querySelector('[data-rm]').onclick = ()=>{ modalProps.splice(i,1); renderProps(); };
      propsEl.appendChild(row);
    });
  }
  renderProps();
  overlay.querySelector('#f_addprop').onclick = ()=>{ modalProps.push({key:'',value:''}); renderProps(); };

  overlay.querySelector('#f_cancel').onclick = ()=>overlay.remove();
  overlay.querySelector('#f_save').onclick = ()=>{
    const name = overlay.querySelector('#f_name').value.trim();
    if(!name){ alert('El nombre es obligatorio.'); return; }
    const desc = overlay.querySelector('#f_desc').value.trim();
    const props = modalProps.filter(p=>p.key.trim()!=='');
    if(a){
      a.name=name; a.typeId=selectedType; a.description=desc; a.properties=props;
    } else {
      state.artifacts.push({id:uid(), name, typeId:selectedType, description:desc, properties:props});
    }
    save(); renderLibrary(); renderCanvas();
    overlay.remove();
  };
  if(a){
    overlay.querySelector('#f_delete').onclick = ()=>{ overlay.remove(); deleteArtifact(a.id); };
  }
}
document.getElementById('btnNewArtifact').onclick = ()=>openArtifactModal(null);

/* ---------- Canvas / lienzo ---------- */
const canvas = document.getElementById('canvas');
const canvasWrap = document.getElementById('canvasWrap');

/* ---------- Anidado de artefactos dentro de servidores ---------- */

// Servidor (solo los que están en el lienzo, no anidados) bajo el punto (x, y) del
// lienzo que admite el tipo de artefacto indicado. Si hay varios solapados,
// devuelve el que está encima (el último en dibujarse). Toda la tarjeta del
// servidor cuenta como zona válida, no solo el recuadro interior.
function findNestTargetAt(x, y, artifactTypeId, excludeNodeId){
  let target = null;
  state.nodes.forEach(n=>{
    if(n.id===excludeNodeId || n.parentId) return;
    const a = state.artifacts.find(art=>art.id===n.artifactId);
    const t = a ? typeById(a.typeId) : null;
    if(!t || !t.nests || !t.nests.includes(artifactTypeId)) return;
    const boxes = getServerBoxes(n.id);
    if(boxes && x>=boxes.outer.left && x<=boxes.outer.right && y>=boxes.outer.top && y<=boxes.outer.bottom){
      target = {node:n, boxes};
    }
  });
  return target;
}

// Marca (con un resalte visual) el servidor donde se va a anidar el artefacto
// que se está arrastrando.
let dropTargetNodeId = null;
function setDropTarget(nodeId){
  if(dropTargetNodeId===nodeId) return;
  if(dropTargetNodeId){
    const old = document.querySelector(`.node[data-node="${dropTargetNodeId}"]`);
    if(old) old.classList.remove('drop-target');
  }
  dropTargetNodeId = nodeId;
  if(nodeId){
    const el = document.querySelector(`.node[data-node="${nodeId}"]`);
    if(el) el.classList.add('drop-target');
  }
}

/* ---------- Zoom del lienzo ---------- */
// El lienzo se escala con CSS (transform). Todas las posiciones guardadas (x, y de
// los nodos, tamaños de servidor...) están en "unidades del lienzo", independientes
// del zoom; cualquier medida sacada de la pantalla (ratón, getBoundingClientRect)
// hay que dividirla por `zoom` antes de usarla.
const ZOOM_MIN = 0.25, ZOOM_MAX = 2;
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
let zoom = 1;

/* ---------- Tamaño del lienzo: crece si se arrastra algo fuera de sus límites ---------- */
// Tamaño de partida (el mismo que tenía fijo antes). El lienzo solo crece a partir
// de aquí, nunca se encoge por debajo: así el usuario no pierde de vista dónde
// estaba trabajando si mueve algo lejos y luego lo trae de vuelta.
const CANVAS_MIN_WIDTH = 2400, CANVAS_MIN_HEIGHT = 1600;
// Margen que se deja siempre libre más allá del artefacto más alejado, y tamaño
// del "escalón" de crecimiento (para no recalcular el layout en cada píxel).
const CANVAS_MARGIN = 220, CANVAS_GROW_STEP = 400;
let canvasWidth = CANVAS_MIN_WIDTH, canvasHeight = CANVAS_MIN_HEIGHT;

function roundUpToStep(value){
  return Math.ceil(value / CANVAS_GROW_STEP) * CANVAS_GROW_STEP;
}

// Si el punto (x, y) — la esquina más lejana de lo que se está moviendo — ya no
// deja el margen mínimo dentro del lienzo actual, lo amplía (nunca lo encoge).
// Devuelve true si el tamaño ha cambiado.
function ensureCanvasFits(x, y){
  let changed = false;
  if(x + CANVAS_MARGIN > canvasWidth){
    canvasWidth = Math.max(canvasWidth, roundUpToStep(x + CANVAS_MARGIN));
    changed = true;
  }
  if(y + CANVAS_MARGIN > canvasHeight){
    canvasHeight = Math.max(canvasHeight, roundUpToStep(y + CANVAS_MARGIN));
    changed = true;
  }
  if(changed) applyZoomLayout();
  return changed;
}

// Repasa todos los artefactos sueltos en el lienzo (los anidados no cuentan: ya
// quedan englobados por su servidor) y amplía el lienzo si hace falta. Es la red
// de seguridad que se ejecuta tras cada renderizado — cubre soltar desde la
// biblioteca, duplicar, importar datos, etc., sin tener que repetir la
// comprobación en cada una de esas acciones por separado.
function ensureCanvasFitsContent(){
  let maxX = 0, maxY = 0;
  state.nodes.forEach(n=>{
    if(n.parentId) return;
    const el = document.querySelector(`.node[data-node="${n.id}"]`);
    const w = el ? el.offsetWidth : 140;
    const h = el ? el.offsetHeight : 60;
    if(n.x + w > maxX) maxX = n.x + w;
    if(n.y + h > maxY) maxY = n.y + h;
  });
  return ensureCanvasFits(maxX, maxY);
}

// Rectángulo de un elemento en unidades del lienzo (sin el efecto del zoom)
function rectInCanvas(el, canvasRect){
  const r = el.getBoundingClientRect();
  const c = canvasRect || canvas.getBoundingClientRect();
  return {
    left:   (r.left   - c.left) / zoom,
    top:    (r.top    - c.top)  / zoom,
    right:  (r.right  - c.left) / zoom,
    bottom: (r.bottom - c.top)  / zoom
  };
}

function updateZoomUi(){
  const label = document.getElementById('zoomReset');
  const btnIn = document.getElementById('zoomIn');
  const btnOut = document.getElementById('zoomOut');
  if(label) label.textContent = Math.round(zoom * 100) + '%';
  if(btnIn) btnIn.disabled = zoom >= ZOOM_MAX - 0.001;
  if(btnOut) btnOut.disabled = zoom <= ZOOM_MIN + 0.001;
}

// Escala el lienzo y ajusta el contenedor para que el área desplazable coincida
// con el tamaño que ocupa realmente (sin zonas vacías al alejar).
function applyZoomLayout(){
  const sizer = document.getElementById('canvasSizer');
  canvas.style.width = canvasWidth + 'px';
  canvas.style.height = canvasHeight + 'px';
  canvas.style.transform = `scale(${zoom})`;
  sizer.style.width = (canvasWidth * zoom) + 'px';
  sizer.style.height = (canvasHeight * zoom) + 'px';
}

// Cambia el zoom manteniendo fijo el punto de la pantalla (anchorX, anchorY);
// si no se indica, el centro de la zona visible.
function setZoom(newZoom, anchorClientX, anchorClientY){
  newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
  newZoom = Math.round(newZoom * 1000) / 1000;
  if(newZoom === zoom) return;

  const wrapRect = canvasWrap.getBoundingClientRect();
  const ax = (anchorClientX == null ? wrapRect.left + wrapRect.width / 2 : anchorClientX) - wrapRect.left;
  const ay = (anchorClientY == null ? wrapRect.top + wrapRect.height / 2 : anchorClientY) - wrapRect.top;
  // punto del lienzo que hay ahora bajo el ancla
  const cx = (canvasWrap.scrollLeft + ax) / zoom;
  const cy = (canvasWrap.scrollTop + ay) / zoom;

  zoom = newZoom;
  applyZoomLayout();
  canvasWrap.scrollLeft = cx * zoom - ax;
  canvasWrap.scrollTop = cy * zoom - ay;
  updateZoomUi();
}

// Siguiente nivel de la lista por encima (dir > 0) o por debajo (dir < 0)
function zoomStep(dir, anchorClientX, anchorClientY){
  const eps = 0.001;
  let target;
  if(dir > 0) target = ZOOM_LEVELS.find(l => l > zoom + eps);
  else target = [...ZOOM_LEVELS].reverse().find(l => l < zoom - eps);
  if(target == null) target = dir > 0 ? ZOOM_MAX : ZOOM_MIN;
  setZoom(target, anchorClientX, anchorClientY);
}

function initZoom(){
  applyZoomLayout();
  document.getElementById('zoomIn').addEventListener('click', () => zoomStep(1));
  document.getElementById('zoomOut').addEventListener('click', () => zoomStep(-1));
  document.getElementById('zoomReset').addEventListener('click', () => setZoom(1));

  // Ctrl + rueda (o pellizco en el trackpad): zoom centrado en el puntero.
  // La rueda sola sigue desplazando el lienzo.
  canvasWrap.addEventListener('wheel', e => {
    if(!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const d = Math.max(-120, Math.min(120, e.deltaY));
    setZoom(zoom * Math.exp(-d * 0.0015), e.clientX, e.clientY);
  }, {passive: false});

  // Atajos del menú Ver (Ctrl +, Ctrl -, Ctrl 0), enviados por el proceso principal
  if(window.api && window.api.onCanvasZoom){
    window.api.onCanvasZoom(action => {
      if(action === 'in') zoomStep(1);
      else if(action === 'out') zoomStep(-1);
      else if(action === 'reset') setZoom(1);
    });
  }
  applyZoomLayout();
  updateZoomUi();
}

function canvasPoint(e){
  const rect = canvas.getBoundingClientRect();
  return {x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom};
}

canvasWrap.ondragover = e=>{
  e.preventDefault();
  if(e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  const artifact = libDragArtifactId
    ? state.artifacts.find(a=>a.id===libDragArtifactId)
    : null;
  if(!artifact){ setDropTarget(null); return; }
  const p = canvasPoint(e);
  const target = findNestTargetAt(p.x, p.y, artifact.typeId, null);
  setDropTarget(target ? target.node.id : null);
};
canvasWrap.ondragleave = e=>{
  if(!canvasWrap.contains(e.relatedTarget)) setDropTarget(null);
};
canvasWrap.ondrop = e=>{
  e.preventDefault();
  setDropTarget(null);
  libDragArtifactId = null;
  const artifactId = e.dataTransfer.getData('text/artifact-id');
  if(!artifactId) return;
  const p = canvasPoint(e);
  addNode(artifactId, p.x, p.y);
};

function addNode(artifactId, x, y){
  const artifact = state.artifacts.find(a=>a.id===artifactId);
  if(!artifact) return;
  let parentId = null, relX = x, relY = y;
  const target = findNestTargetAt(x, y, artifact.typeId, null);
  if(target){
    parentId = target.node.id;
    relX = Math.max(6, x - target.boxes.inner.left);
    relY = Math.max(6, y - target.boxes.inner.top);
  }
  state.nodes.push({id:uid(), artifactId, x: relX, y: relY, parentId});
  save(); renderCanvas();
}

// Devuelve tanto el rectángulo de toda la tarjeta del servidor (outer, zona válida
// para soltar) como el del recuadro interior (inner, donde se posiciona visualmente
// el artefacto anidado), ambos en coordenadas relativas al lienzo.
function getServerBoxes(nodeId){
  const outerEl = document.querySelector(`.node[data-node="${nodeId}"]`);
  const innerEl = document.querySelector(`.node[data-node="${nodeId}"] .server-inner`);
  if(!outerEl || !innerEl) return null;
  const c = canvas.getBoundingClientRect();
  return {
    outer: rectInCanvas(outerEl, c),
    inner: rectInCanvas(innerEl, c)
  };
}

function removeNodeFromCanvas(nodeId){
  const childIds = state.nodes.filter(n=>n.parentId===nodeId).map(n=>n.id);
  state.nodes = state.nodes.filter(n=>n.id!==nodeId && !childIds.includes(n.id));
  state.relations = state.relations.filter(r=>r.from!==nodeId && r.to!==nodeId && !childIds.includes(r.from) && !childIds.includes(r.to));
  save(); renderCanvas();
}

/* ---------- Foco de relaciones ---------- */
let focusedNodeId = null;

// Devuelve todos los nodos conectados directa o indirectamente con el foco.
// Para la visualizacion, las relaciones se recorren en ambos sentidos.
// La contencion servidor-hijo tambien se considera una relacion implicita.
const NON_TRANSITIVE_TYPE_IDS = new Set([
  'usuario',
  'almacen',
  'bd',
  'servidor',
  'externo',
  'servicio'
]);

function getNodeTypeId(nodeId) {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const artifact = state.artifacts.find(
    a => a.id === node.artifactId
  );

  return artifact ? artifact.typeId : null;
}

function isNonTransitiveNode(nodeId) {
  return NON_TRANSITIVE_TYPE_IDS.has(
    getNodeTypeId(nodeId)
  );
}

function getTransitivelyRelatedNodeIds(startNodeId) {
  if (!startNodeId) {
    return new Set();
  }

  const visited = new Set([startNodeId]);
  const pending = [startNodeId];

  // Si el nodo seleccionado pertenece a un tipo limitado, durante este foco
  // se desactiva la limitacion para TODOS los nodos de ese mismo tipo.
  // Las limitaciones de los otros tipos se mantienen.
  const focusedTypeId = getNodeTypeId(startNodeId);
  const disabledLimitedTypeId = NON_TRANSITIVE_TYPE_IDS.has(focusedTypeId)
    ? focusedTypeId
    : null;

  function canContinueFrom(nodeId) {
    const nodeTypeId = getNodeTypeId(nodeId);

    // El tipo limitado seleccionado queda exento mientras dure el foco.
    if (disabledLimitedTypeId && nodeTypeId === disabledLimitedTypeId) {
      return true;
    }

    return !NON_TRANSITIVE_TYPE_IDS.has(nodeTypeId);
  }

  function addNode(nodeId) {
    if (!nodeId || visited.has(nodeId)) {
      return;
    }

    // El nodo relacionado siempre se muestra.
    visited.add(nodeId);

    // Solo se sigue recorriendo a traves de el si su tipo no esta limitado,
    // o si la limitacion de ese tipo fue desactivada por el nodo seleccionado.
    if (canContinueFrom(nodeId)) {
      pending.push(nodeId);
    }
  }

  while (pending.length > 0) {
    const currentId = pending.shift();

    state.relations.forEach(relation => {
      if (relation.from === currentId) {
        addNode(relation.to);
      }
      if (relation.to === currentId) {
        addNode(relation.from);
      }
    });

    const currentNode = state.nodes.find(
      node => node.id === currentId
    );

    // Contencion implicita: hijo -> servidor.
    if (currentNode && currentNode.parentId) {
      addNode(currentNode.parentId);
    }

    // Contencion implicita: servidor -> hijos.
    state.nodes
      .filter(node => node.parentId === currentId)
      .forEach(child => addNode(child.id));
  }

  return visited;
}

function isRelatedToFocus(nodeId){
  if(!focusedNodeId) return true;
  return getTransitivelyRelatedNodeIds(focusedNodeId).has(nodeId);
}

function toggleFocus(nodeId){
  focusedNodeId = (focusedNodeId===nodeId) ? null : nodeId;
  renderCanvas();
}

function renderCanvas(){
  refreshSearchView();
  updateSearchInfo();
  dropTargetNodeId = null;
  document.querySelectorAll('.node').forEach(n=>n.remove());
  const roots = state.nodes.filter(n=>!n.parentId);
  roots.forEach(n=>canvas.appendChild(buildNodeEl(n)));
  adjustServerSizes();
  ensureCanvasFitsContent();
  // La línea (visual, no interactiva) va por encima de los nodos; la capa de
  // clic (#linesHit) queda por debajo desde el arranque y no hace falta moverla.
  canvas.appendChild(document.getElementById('lines'));
  updateLines();
}

// Ajusta el tamaño de cada tarjeta "Servidor" para que englobe a todos los
// artefactos anidados dentro de ella (crece o encoge según haga falta).
const SERVER_MIN_W = 200;
const SERVER_MIN_H = 60;
const SERVER_PADDING = 14;

// Calcula el tamaño mínimo necesario para contener todos los hijos del servidor.
function getRequiredServerSize(node, innerEl){
  let width = SERVER_MIN_W;
  let height = SERVER_MIN_H;

  state.nodes.filter(child=>child.parentId===node.id).forEach(child=>{
    const childEl = innerEl
      ? innerEl.querySelector(`.node[data-node="${child.id}"]`)
      : null;
    const childWidth = (childEl && childEl.offsetWidth) || 130;
    const childHeight = (childEl && childEl.offsetHeight) || 50;

    width = Math.max(width, child.x + childWidth + SERVER_PADDING);
    height = Math.max(height, child.y + childHeight + SERVER_PADDING);
  });

  return {width, height};
}

// Respeta el tamaño manual, pero amplía automáticamente el servidor cuando
// un artefacto hijo necesita más espacio.
function adjustServerSizes(){
  state.nodes.forEach(node=>{
    const artifact = state.artifacts.find(x=>x.id===node.artifactId);
    const type = artifact ? typeById(artifact.typeId) : null;
    if(!type || type.id!=='servidor') return;

    const outerEl = document.querySelector(`.node[data-node="${node.id}"]`);
    const innerEl = outerEl ? outerEl.querySelector('.server-inner') : null;
    if(!innerEl) return;

    const required = getRequiredServerSize(node, innerEl);
    const width = Math.max(required.width, node.serverWidth || SERVER_MIN_W);
    const height = Math.max(required.height, node.serverHeight || SERVER_MIN_H);

    innerEl.style.width = width + 'px';
    innerEl.style.height = height + 'px';
  });
}

function buildNodeEl(node){
  const artifact = state.artifacts.find(a=>a.id===node.artifactId);
  const t = typeById(artifact.typeId);
  const el = document.createElement('div');
  const related = isRelatedToFocus(node.id);
  let cls = 'node' + (t.id==='servidor' ? ' server' : '');
  if(focusedNodeId===node.id) cls += ' focused';
  else if(!related) cls += ' dimmed';
  const sc = searchClassFor(node.id);
  if(sc === 'hit') cls += ' search-hit';
  else if(sc === 'dim') cls += ' search-dim';
  el.className = cls;
  el.dataset.node = node.id;
  el.style.left = node.x+'px';
  el.style.top = node.y+'px';
  el.style.background = node.parentId ? '#fff' : t.color;
  el.innerHTML = `
    <div class="node-btns">
      <button class="${focusedNodeId===node.id?'focus-active':''}" title="${focusedNodeId===node.id?'Quitar foco de relaciones':'Ver relaciones de este artefacto'}" data-focus="${node.id}">👁</button>
      <button title="Crear relación" data-rel="${node.id}">🔗</button>
      <button title="Duplicar artefacto" data-dup="${node.id}">📋</button>
      <button title="Quitar del lienzo" data-rm="${node.id}">✕</button>
    </div>
    <div class="node-head" data-drag="${node.id}">
      <span class="node-icon">${t.icon}</span>
      <span class="node-name">${escapeHtml(artifact.name)}</span>
    </div>
    <div class="node-type">${t.name}</div>
  `;
  if(t.id==='servidor'){
    const inner = document.createElement('div');
    inner.className='server-inner';
    state.nodes.filter(n=>n.parentId===node.id).forEach(child=>{
      const childEl = buildNodeEl(child);
      childEl.style.left = child.x+'px';
      childEl.style.top = child.y+'px';
      inner.appendChild(childEl);
    });
    el.appendChild(inner);

    // Tirador inferior derecho para redimensionar manualmente el servidor.
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'server-resize-handle';
    resizeHandle.title = 'Arrastra para redimensionar el servidor';
    Object.assign(resizeHandle.style, {
      position: 'absolute',
      right: '3px',
      bottom: '3px',
      width: '14px',
      height: '14px',
      cursor: 'nwse-resize',
      borderRight: '3px solid #667085',
      borderBottom: '3px solid #667085',
      boxSizing: 'border-box',
      zIndex: '20'
    });
    resizeHandle.addEventListener('mousedown', e=>startServerResize(e, node));
    resizeHandle.addEventListener('click', e=>e.stopPropagation());
    resizeHandle.addEventListener('dblclick', e=>e.stopPropagation());
    el.appendChild(resizeHandle);
  }
  el.querySelector('[data-drag]').addEventListener('mousedown', e=>startDrag(e, node));
  el.querySelector('[data-focus]').addEventListener('click', e=>{ e.stopPropagation(); toggleFocus(node.id); });
  el.querySelector('[data-rel]').addEventListener('click', e=>{ e.stopPropagation(); startRelation(node.id, el); });
  el.querySelector('[data-dup]').addEventListener('click', e=>{ e.stopPropagation(); duplicateNode(node.id); });
  el.querySelector('[data-rm]').addEventListener('click', e=>{ e.stopPropagation(); removeNodeFromCanvas(node.id); });
  el.addEventListener('dblclick', e=>{ e.stopPropagation(); openArtifactModal(artifact.id); });
  // Evita que un clic dentro del nodo (arrastrar, etc.) llegue al lienzo y quite el foco
  el.addEventListener('click', e=>e.stopPropagation());
  return el;
}

/* --- redimensionar servidores --- */
let serverResizeCtx = null;

function startServerResize(e, node){
  e.preventDefault();
  e.stopPropagation();

  const outerEl = document.querySelector(`.node[data-node="${node.id}"]`);
  const innerEl = outerEl ? outerEl.querySelector('.server-inner') : null;
  if(!innerEl) return;

  const required = getRequiredServerSize(node, innerEl);
  serverResizeCtx = {
    node,
    innerEl,
    startX: e.clientX,
    startY: e.clientY,
    startWidth: innerEl.offsetWidth,
    startHeight: innerEl.offsetHeight,
    minWidth: required.width,
    minHeight: required.height
  };

  outerEl.classList.add('resizing');
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onServerResize);
  document.addEventListener('mouseup', endServerResize);
}

function onServerResize(e){
  if(!serverResizeCtx) return;

  const width = Math.max(
    serverResizeCtx.minWidth,
    serverResizeCtx.startWidth + (e.clientX - serverResizeCtx.startX) / zoom
  );
  const height = Math.max(
    serverResizeCtx.minHeight,
    serverResizeCtx.startHeight + (e.clientY - serverResizeCtx.startY) / zoom
  );

  serverResizeCtx.node.serverWidth = Math.round(width);
  serverResizeCtx.node.serverHeight = Math.round(height);
  serverResizeCtx.innerEl.style.width = width + 'px';
  serverResizeCtx.innerEl.style.height = height + 'px';
  if(!serverResizeCtx.node.parentId){
    const outerEl = document.querySelector(`.node[data-node="${serverResizeCtx.node.id}"]`);
    if(outerEl) ensureCanvasFits(serverResizeCtx.node.x + outerEl.offsetWidth, serverResizeCtx.node.y + outerEl.offsetHeight);
  }
  updateLines();
}

function endServerResize(){
  if(!serverResizeCtx) return;

  const outerEl = document.querySelector(
    `.node[data-node="${serverResizeCtx.node.id}"]`
  );
  if(outerEl) outerEl.classList.remove('resizing');

  document.body.style.userSelect = '';
  document.removeEventListener('mousemove', onServerResize);
  document.removeEventListener('mouseup', endServerResize);
  serverResizeCtx = null;
  save();
  updateLines();
}

/* --- arrastrar nodos --- */
let dragCtx = null;
const DRAG_THRESHOLD = 4;   // px: por debajo de esto un clic no se considera arrastre

function startDrag(e, node){
  e.preventDefault();
  const el = document.querySelector(`.node[data-node="${node.id}"]`);
  const artifact = state.artifacts.find(a=>a.id===node.artifactId);
  dragCtx = {
    node, el,
    typeId: artifact ? artifact.typeId : null,
    startX:e.clientX, startY:e.clientY,
    origX:node.x, origY:node.y,
    moved:false
  };
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', endDrag);
}
function onDrag(e){
  if(!dragCtx) return;
  // Movimiento del ratón en pantalla -> unidades del lienzo
  const sdx = e.clientX - dragCtx.startX, sdy = e.clientY - dragCtx.startY;
  const dx = sdx / zoom, dy = sdy / zoom;
  if(!dragCtx.moved){
    if(Math.hypot(sdx, sdy) < DRAG_THRESHOLD) return;
    dragCtx.moved = true;
    dragCtx.el.classList.add('dragging');
  }
  // El origen del lienzo (0,0) es un límite fijo, pero solo para artefactos
  // sueltos: si el artefacto está anidado, x/y son relativos a su servidor, no al
  // lienzo, así que aquí no hay que impedir que bajen de 0 (si no, se quedaría
  // "pegado" al borde del servidor en vez de poder sacarlo arrastrándolo).
  if(dragCtx.node.parentId){
    dragCtx.node.x = dragCtx.origX + dx;
    dragCtx.node.y = dragCtx.origY + dy;
  } else {
    dragCtx.node.x = Math.max(0, dragCtx.origX + dx);
    dragCtx.node.y = Math.max(0, dragCtx.origY + dy);
  }
  dragCtx.el.style.left = dragCtx.node.x+'px';
  dragCtx.el.style.top = dragCtx.node.y+'px';
  if(!dragCtx.node.parentId){
    ensureCanvasFits(dragCtx.node.x + dragCtx.el.offsetWidth, dragCtx.node.y + dragCtx.el.offsetHeight);
  }

  // El destino se decide por donde está el puntero, y se resalta mientras se arrastra.
  // (El servidor no crece durante el arrastre: si lo hiciera, siempre "envolvería"
  // al artefacto y nunca se podría sacar de él.)
  const p = canvasPoint(e);
  const target = findNestTargetAt(p.x, p.y, dragCtx.typeId, dragCtx.node.id);
  setDropTarget(target ? target.node.id : null);
  updateLines();
}
function endDrag(e){
  if(!dragCtx) return;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', endDrag);
  const {node, el, typeId, moved} = dragCtx;
  dragCtx = null;
  el.classList.remove('dragging');

  // Un simple clic no cambia nada
  if(!moved){ setDropTarget(null); return; }

  // Posición absoluta de la tarjeta en el lienzo y servidor bajo el puntero
  const nodeRect = rectInCanvas(el);
  const absX = nodeRect.left, absY = nodeRect.top;
  const p = canvasPoint(e);
  const target = findNestTargetAt(p.x, p.y, typeId, node.id);
  setDropTarget(null);

  if(target){
    // Incluye el servidor en el que ya estaba: soltarlo dentro de su propio
    // servidor lo mantiene anidado (solo cambia su posición).
    node.parentId = target.node.id;
    node.x = Math.max(6, absX - target.boxes.inner.left);
    node.y = Math.max(6, absY - target.boxes.inner.top);
  } else {
    node.parentId = null;
    // Ahora sí es un artefacto suelto: el origen del lienzo vuelve a ser un límite
    node.x = Math.max(0, absX);
    node.y = Math.max(0, absY);
  }
  save(); renderCanvas();
}

/* --- relaciones --- */
let relCtx = null;
function startRelation(nodeId, el){
  if(relCtx){
    if(relCtx.from === nodeId){ cancelRelation(); return; }
    openRelTypeModal(relCtx.from, nodeId);
    cancelRelation();
    return;
  }
  relCtx = {from: nodeId};
  el.classList.add('connecting-src');
}
function cancelRelation(){
  document.querySelectorAll('.connecting-src').forEach(e=>e.classList.remove('connecting-src'));
  relCtx = null;
}
function openRelTypeModal(fromId, toId){
  const overlay = document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id = 'relTypeModal';
  overlay.tabIndex = -1;
  overlay.innerHTML = `<div class="modal">
    <h3>Tipo de relación</h3>
    <div id="rt_list"></div>
    <div class="field"><label>O escribe un tipo personalizado</label><input type="text" id="rt_custom"></div>
    <div class="modal-actions"><div></div><div class="right"><button id="rt_cancel">Cancelar</button><button class="primary" id="rt_ok">Crear</button></div></div>
  </div>`;
  document.body.appendChild(overlay);

  let chosen = REL_TYPES[0];
  const list = overlay.querySelector('#rt_list');
  const customInput = overlay.querySelector('#rt_custom');
  const optionButtons = [];

  // Ilumina el tipo elegido. Si se escribe un tipo personalizado, ese tiene
  // prioridad y ninguna de las opciones de la lista queda marcada.
  function refreshSelection(){
    const usingCustom = customInput.value.trim() !== '';
    optionButtons.forEach(({btn, rt})=>{
      const selected = !usingCustom && rt === chosen;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }

  REL_TYPES.forEach(rt=>{
    const b=document.createElement('button');
    b.className='rel-opt'; b.type='button';
    const optStyle = relStyleFor(rt);
    b.innerHTML = `<span class="rel-swatch" style="background:${optStyle.color}"></span>${escapeHtml(rt)}`;
    b.onclick=()=>{ chosen=rt; customInput.value=''; refreshSelection(); };
    optionButtons.push({btn:b, rt});
    list.appendChild(b);
  });
  customInput.addEventListener('input', refreshSelection);
  refreshSelection();

  function createRelation(){
    const type = customInput.value.trim() || chosen;
    state.relations.push({id:uid(), from:fromId, to:toId, type});
    save(); overlay.remove(); updateLines();
  }

  overlay.querySelector('#rt_cancel').onclick=()=>overlay.remove();
  overlay.querySelector('#rt_ok').onclick=createRelation;
  customInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); createRelation(); } });
  overlay.addEventListener('keydown', e=>{ if(e.key==='Escape') overlay.remove(); });
  overlay.focus();
}
canvas.addEventListener('click', ()=>{
  if(relCtx) cancelRelation();
  if(focusedNodeId){ focusedNodeId=null; renderCanvas(); }
});

// Punto donde una línea desde el centro de "rect" hacia (targetX, targetY)
// cruza el borde de ese rectángulo (para que la línea empiece/termine en el
// borde más cercano al otro artefacto, no en el centro).
function rectEdgePoint(rect, targetX, targetY){
  const cx = (rect.left+rect.right)/2, cy = (rect.top+rect.bottom)/2;
  const dx = targetX-cx, dy = targetY-cy;
  if(dx===0 && dy===0) return {x:cx, y:cy};
  const halfW = (rect.right-rect.left)/2, halfH = (rect.bottom-rect.top)/2;
  const scaleX = dx!==0 ? halfW/Math.abs(dx) : Infinity;
  const scaleY = dy!==0 ? halfH/Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return {x: cx+dx*scale, y: cy+dy*scale};
}

/* --- dibujar líneas de relación --- */
function updateLines(){
  const svg = document.getElementById('lines');
  const hitSvg = document.getElementById('linesHit');
  svg.querySelectorAll('.rel-line').forEach(l=>l.remove());
  hitSvg.querySelectorAll('.rel-hit').forEach(l=>l.remove());
  const canvasRect = canvas.getBoundingClientRect();
  state.relations.forEach(r=>{
    const fromEl = document.querySelector(`.node[data-node="${r.from}"]`);
    const toEl = document.querySelector(`.node[data-node="${r.to}"]`);
    if(!fromEl || !toEl) return;
    const frRect = rectInCanvas(fromEl, canvasRect);
    const trRect = rectInCanvas(toEl, canvasRect);
    const fromCenter = {x:(frRect.left+frRect.right)/2, y:(frRect.top+frRect.bottom)/2};
    const toCenter = {x:(trRect.left+trRect.right)/2, y:(trRect.top+trRect.bottom)/2};
    const p1 = rectEdgePoint(frRect, toCenter.x, toCenter.y);
    const p2 = rectEdgePoint(trRect, fromCenter.x, fromCenter.y);

    const relatedNodeIds = focusedNodeId
      ? getTransitivelyRelatedNodeIds(focusedNodeId)
      : null;
    const focusDimmed = relatedNodeIds &&
      (!relatedNodeIds.has(r.from) || !relatedNodeIds.has(r.to));
    // Con búsqueda activa, solo se mantienen las líneas que tocan algún resultado
    const searchDimmed = searchView &&
      !searchView.hits.has(r.from) && !searchView.hits.has(r.to);
    const relDimmed = focusDimmed || searchDimmed;
    const style = relStyleFor(r.type);
    const d = `M${p1.x},${p1.y} L${p2.x},${p2.y}`;

    // Franja invisible más ancha por encima de la línea, solo para que sea más
    // fácil hacer clic y eliminar la relación (la línea visible es fina).
    const hit = document.createElementNS(SVG_NS,'path');
    hit.setAttribute('class', 'rel-hit' + (relDimmed?' dimmed':''));
    hit.setAttribute('d', d);
    hit.addEventListener('click', e=>{
      e.stopPropagation();
      if(confirm(`¿Eliminar la relación "${r.type}"?`)){
        state.relations = state.relations.filter(x=>x.id!==r.id);
        save(); updateLines();
      }
    });
    hitSvg.appendChild(hit);

    const path = document.createElementNS(SVG_NS,'path');
    path.setAttribute('class', 'rel-line' + (relDimmed?' dimmed':''));
    path.setAttribute('d', d);
    path.setAttribute('marker-end', `url(#${style.markerId})`);
    path.style.stroke = style.color;
    path.style.strokeDasharray = style.dash || '';
    const titleEl = document.createElementNS(SVG_NS,'title');
    titleEl.textContent = r.type;
    path.appendChild(titleEl);
    svg.appendChild(path);
  });
}

/* ---------- Exportar / Importar (diálogos nativos del sistema operativo) ---------- */
document.getElementById('btnExport').onclick = async ()=>{
  await window.api.exportData();
};
document.getElementById('btnImport').onclick = async ()=>{
  await window.api.importData();
};
window.api.onDataImported((data)=>{
  state = data;
  renderLibrary(); renderCanvas();
});

/* ---------- Inicio: cargar datos guardados en disco ---------- */
(async function init(){
  initLibrarySearch();
  initZoom();
  buildRelMarkers();
  initLegend();
  state = await window.api.loadData();
  renderLibrary();
  renderCanvas();
})();
window.addEventListener('resize', updateLines);
