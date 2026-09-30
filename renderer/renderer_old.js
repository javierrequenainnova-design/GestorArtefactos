/* ---------- Tipos de artefacto (fijos, cada uno con icono propio) ---------- */
const TYPES = [
  {id:'servidor',   name:'Servidor',         icon:'🖥️', color:'#e7ecff', nests:['aplicacion', 'api']},
  {id:'aplicacion', name:'Aplicación',       icon:'🧩', color:'#e8f7ec'},
  {id:'api',        name:'Api',              icon:'🔌', color:'#e8f7ec'},
  {id:'bd',         name:'Base de Datos',    icon:'🗄️', color:'#fff3e0'},
  {id:'red',        name:'Red',              icon:'🌐', color:'#e6f7ff'},
  {id:'almacen',    name:'Almacenamiento',   icon:'💾', color:'#f3e8ff'},
  {id:'servicio',   name:'Servicio',         icon:'⚙️', color:'#fdf0f0'},
  {id:'usuario',    name:'Usuario',          icon:'👤', color:'#f0f4ff'},
  {id:'externo',    name:'Sistema Externo',  icon:'🔗', color:'#f5f5f0'},
];
const typeById = id => TYPES.find(t=>t.id===id);

const REL_TYPES = ['Depende de','Se comunica con','Usa','Accede a','Contiene','Publica en','Autentica contra'];

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

/* ---------- Render biblioteca ---------- */
function renderLibrary(){
  const el = document.getElementById('libraryList');
  el.innerHTML = '';

  if(state.artifacts.length===0){
    el.innerHTML =
      '<div class="empty-msg">Todavía no hay artefactos.<br>Crea uno con "Nuevo artefacto".</div>';
    return;
  }

  TYPES.forEach(type => {

    const artifacts = state.artifacts.filter(a => a.typeId === type.id);

    if(artifacts.length === 0) return;

    const group = document.createElement('div');
    group.className = 'lib-group';

    const header = document.createElement('div');
    header.className = 'lib-group-header';

    header.innerHTML = `
      <span class="toggle">▼</span>
      <span class="group-icon">${type.icon}</span>
      <span class="group-title">${type.name}</span>
      <span class="group-count">(${artifacts.length})</span>
    `;

    const content = document.createElement('div');
    content.className = 'lib-group-content';

    artifacts.forEach(a => {

      const item = document.createElement('div');
      item.className='lib-item';
      item.draggable = true;

      item.ondragstart = e =>
        e.dataTransfer.setData('text/artifact-id', a.id);

      item.innerHTML = `
        <div class="lib-icon" style="background:${type.color}">
          ${type.icon}
        </div>

        <div class="lib-info">
          <div class="name">${escapeHtml(a.name)}</div>
          <div class="type">${type.name}</div>
        </div>

        <div class="lib-item-actions">
          <button class="ghost" title="Editar" data-edit="${a.id}">✏️</button>
          <button class="ghost" title="Eliminar" data-del="${a.id}">🗑️</button>
        </div>
      `;

      item.querySelector('[data-edit]').onclick =
        () => openArtifactModal(a.id);

      item.querySelector('[data-del]').onclick =
        () => deleteArtifact(a.id);

      content.appendChild(item);
    });

    header.onclick = () => {
      const collapsed =
        content.style.display === 'none';

      content.style.display =
        collapsed ? 'block' : 'none';

      header.querySelector('.toggle').textContent =
        collapsed ? '▼' : '▶';
    };

    group.appendChild(header);
    group.appendChild(content);
    el.appendChild(group);
  });
}

function buildLibraryItem(artifact, type) {
  const item = document.createElement('div');

  item.className = 'lib-item';
  item.draggable = true;
  item.dataset.artifactId = artifact.id;

  item.addEventListener('dragstart', event => {
    event.dataTransfer.setData(
      'text/artifact-id',
      artifact.id
    );

    event.dataTransfer.effectAllowed = 'copy';
  });

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
        title="Eliminar ${escapeHtml(artifact.name)}"
        data-del="${artifact.id}"
      >
        🗑️
      </button>
    </div>
  `;

  item.querySelector('[data-edit]').addEventListener(
    'click',
    event => {
      event.stopPropagation();
      openArtifactModal(artifact.id);
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

canvasWrap.ondragover = e=>e.preventDefault();
canvasWrap.ondrop = e=>{
  e.preventDefault();
  const artifactId = e.dataTransfer.getData('text/artifact-id');
  if(!artifactId) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  addNode(artifactId, x, y);
};

function addNode(artifactId, x, y){
  const artifact = state.artifacts.find(a=>a.id===artifactId);
  if(!artifact) return;
  let parentId = null, relX = x, relY = y;
  for(const n of state.nodes){
    const pa = state.artifacts.find(a=>a.id===n.artifactId);
    const pt = typeById(pa.typeId);
    if(pt.nests && pt.nests.includes(artifact.typeId)){
      const boxes = getServerBoxes(n.id);
      // Toda la tarjeta del servidor (no solo el recuadro interior) cuenta como zona de anidado
      if(boxes && x>boxes.outer.left && x<boxes.outer.right && y>boxes.outer.top && y<boxes.outer.bottom){
        parentId = n.id;
        relX = Math.max(6, x-boxes.inner.left);
        relY = Math.max(6, y-boxes.inner.top);
        break;
      }
    }
  }
  state.nodes.push({id:uid(), artifactId, x: parentId?relX:x, y: parentId?relY:y, parentId});
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
  const o = outerEl.getBoundingClientRect();
  const i = innerEl.getBoundingClientRect();
  return {
    outer: {left:o.left-c.left, top:o.top-c.top, right:o.right-c.left, bottom:o.bottom-c.top},
    inner: {left:i.left-c.left, top:i.top-c.top, right:i.right-c.left, bottom:i.bottom-c.top}
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

function isRelatedToFocus(nodeId){
  if(!focusedNodeId) return true;
  if(nodeId===focusedNodeId) return true;
  const focusedNode = state.nodes.find(n=>n.id===focusedNodeId);
  const node = state.nodes.find(n=>n.id===nodeId);
  // La contención cuenta como relación implícita: si el foco es una aplicación,
  // el servidor que la contiene se mantiene iluminado; si el foco es un servidor,
  // todas las aplicaciones que contiene se mantienen iluminadas.
  if(focusedNode && focusedNode.parentId===nodeId) return true;
  if(node && node.parentId===focusedNodeId) return true;
  return state.relations.some(r =>
    (r.from===focusedNodeId && r.to===nodeId) || (r.to===focusedNodeId && r.from===nodeId)
  );
}

function toggleFocus(nodeId){
  focusedNodeId = (focusedNodeId===nodeId) ? null : nodeId;
  renderCanvas();
}

function renderCanvas(){
  document.querySelectorAll('.node').forEach(n=>n.remove());
  const roots = state.nodes.filter(n=>!n.parentId);
  roots.forEach(n=>canvas.appendChild(buildNodeEl(n)));
  adjustServerSizes();
  // Las líneas de relación (y sus etiquetas) deben quedar por encima de los nodos
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
  el.className = cls;
  el.dataset.node = node.id;
  el.style.left = node.x+'px';
  el.style.top = node.y+'px';
  el.style.background = node.parentId ? '#fff' : t.color;
  el.innerHTML = `
    <div class="node-btns">
      <button class="${focusedNodeId===node.id?'focus-active':''}" title="${focusedNodeId===node.id?'Quitar foco de relaciones':'Ver relaciones de este artefacto'}" data-focus="${node.id}">👁</button>
      <button title="Crear relación" data-rel="${node.id}">🔗</button>
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
    serverResizeCtx.startWidth + e.clientX - serverResizeCtx.startX
  );
  const height = Math.max(
    serverResizeCtx.minHeight,
    serverResizeCtx.startHeight + e.clientY - serverResizeCtx.startY
  );

  serverResizeCtx.node.serverWidth = Math.round(width);
  serverResizeCtx.node.serverHeight = Math.round(height);
  serverResizeCtx.innerEl.style.width = width + 'px';
  serverResizeCtx.innerEl.style.height = height + 'px';
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
function startDrag(e, node){
  e.preventDefault();
  const el = document.querySelector(`.node[data-node="${node.id}"]`);
  el.classList.add('dragging');
  dragCtx = { node, startX:e.clientX, startY:e.clientY, origX:node.x, origY:node.y };
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', endDrag);
}
function onDrag(e){
  if(!dragCtx) return;
  const dx = e.clientX - dragCtx.startX, dy = e.clientY - dragCtx.startY;
  dragCtx.node.x = dragCtx.origX + dx;
  dragCtx.node.y = dragCtx.origY + dy;
  const el = document.querySelector(`.node[data-node="${dragCtx.node.id}"]`);
  if(el){ el.style.left = dragCtx.node.x+'px'; el.style.top = dragCtx.node.y+'px'; }
  if(dragCtx.node.parentId) adjustServerSizes();
  updateLines();
}
function endDrag(e){
  if(!dragCtx) return;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', endDrag);
  const node = dragCtx.node;
  const artifact = state.artifacts.find(a=>a.id===node.artifactId);
  const el = document.querySelector(`.node[data-node="${node.id}"]`);
  if(el) el.classList.remove('dragging');
  dragCtx = null;

  const canvasRect = canvas.getBoundingClientRect();
  const nodeRect = el.getBoundingClientRect();
  const absX = nodeRect.left - canvasRect.left, absY = nodeRect.top - canvasRect.top;

  let newParent = null, newRelX = absX, newRelY = absY;
  state.nodes.forEach(n=>{
    if(n.id===node.id || n.id===node.parentId) return;
    const pa = state.artifacts.find(a=>a.id===n.artifactId);
    const pt = typeById(pa.typeId);
    if(pt.nests && pt.nests.includes(artifact.typeId)){
      const boxes = getServerBoxes(n.id);
      // Toda la tarjeta del servidor cuenta como zona de anidado, no solo el recuadro interior
      if(boxes && absX>boxes.outer.left-20 && absX<boxes.outer.right && absY>boxes.outer.top-20 && absY<boxes.outer.bottom){
        newParent = n.id;
        newRelX = Math.max(6, absX-boxes.inner.left);
        newRelY = Math.max(6, absY-boxes.inner.top);
      }
    }
  });
  node.parentId = newParent;
  node.x = newParent ? newRelX : absX;
  node.y = newParent ? newRelY : absY;
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
  overlay.innerHTML = `<div class="modal">
    <h3>Tipo de relación</h3>
    <div id="rt_list"></div>
    <div class="field"><label>O escribe un tipo personalizado</label><input type="text" id="rt_custom"></div>
    <div class="modal-actions"><div></div><div class="right"><button id="rt_cancel">Cancelar</button><button class="primary" id="rt_ok">Crear</button></div></div>
  </div>`;
  document.body.appendChild(overlay);
  let chosen = REL_TYPES[0];
  const list = overlay.querySelector('#rt_list');
  REL_TYPES.forEach(rt=>{
    const b=document.createElement('button');
    b.className='rel-opt'; b.type='button'; b.textContent=rt;
    b.onclick=()=>{chosen=rt; overlay.querySelector('#rt_custom').value='';};
    list.appendChild(b);
  });
  overlay.querySelector('#rt_cancel').onclick=()=>overlay.remove();
  overlay.querySelector('#rt_ok').onclick=()=>{
    const custom = overlay.querySelector('#rt_custom').value.trim();
    const type = custom || chosen;
    state.relations.push({id:uid(), from:fromId, to:toId, type});
    save(); overlay.remove(); updateLines();
  };
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
  svg.querySelectorAll('.rel-line').forEach(l=>l.remove());
  document.querySelectorAll('.rel-label').forEach(l=>l.remove());
  const canvasRect = canvas.getBoundingClientRect();
  state.relations.forEach(r=>{
    const fromEl = document.querySelector(`.node[data-node="${r.from}"]`);
    const toEl = document.querySelector(`.node[data-node="${r.to}"]`);
    if(!fromEl || !toEl) return;
    const fr = fromEl.getBoundingClientRect(), tr = toEl.getBoundingClientRect();
    const frRect = {left:fr.left-canvasRect.left, top:fr.top-canvasRect.top, right:fr.right-canvasRect.left, bottom:fr.bottom-canvasRect.top};
    const trRect = {left:tr.left-canvasRect.left, top:tr.top-canvasRect.top, right:tr.right-canvasRect.left, bottom:tr.bottom-canvasRect.top};
    const fromCenter = {x:(frRect.left+frRect.right)/2, y:(frRect.top+frRect.bottom)/2};
    const toCenter = {x:(trRect.left+trRect.right)/2, y:(trRect.top+trRect.bottom)/2};
    const p1 = rectEdgePoint(frRect, toCenter.x, toCenter.y);
    const p2 = rectEdgePoint(trRect, fromCenter.x, fromCenter.y);

    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    const relDimmed = focusedNodeId && r.from!==focusedNodeId && r.to!==focusedNodeId;
    path.setAttribute('class', 'rel-line' + (relDimmed?' dimmed':''));
    path.setAttribute('d', `M${p1.x},${p1.y} L${p2.x},${p2.y}`);
    svg.appendChild(path);

    const label = document.createElement('div');
    label.className='rel-label' + (relDimmed?' dimmed':'');
    label.textContent = r.type;
    label.style.left = ((p1.x+p2.x)/2)+'px';
    label.style.top = ((p1.y+p2.y)/2)+'px';
    label.title = 'Clic para eliminar la relación';
    label.onclick = e=>{ e.stopPropagation(); if(confirm('¿Eliminar esta relación?')){ state.relations = state.relations.filter(x=>x.id!==r.id); save(); updateLines(); } };
    canvas.appendChild(label);
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
  state = await window.api.loadData();
  renderLibrary();
  renderCanvas();
})();
window.addEventListener('resize', updateLines);
