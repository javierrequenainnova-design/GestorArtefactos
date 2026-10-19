/* ---------------------------------------------------------------------------
 * Persistencia para la versión de navegador (sin Electron).
 *
 * Implementa el mismo "window.api" que renderer.js ya espera (loadData,
 * saveData, exportData, importData, onDataImported, onCanvasZoom), así que
 * renderer.js no necesita ningún cambio.
 *
 * Preferencia de almacenamiento:
 *   1) Carpeta real elegida por el usuario (File System Access API de
 *      Chrome/Edge) — el archivo artefactos-data.json vive ahí, igual que en
 *      la versión de escritorio.
 *   2) Si el navegador no soporta esa API, o se pierde el permiso, o algo
 *      falla: localStorage, de forma automática y silenciosa, para que la
 *      app nunca se quede sin poder guardar.
 * ------------------------------------------------------------------------- */
(function () {
  const FSA_SUPPORTED = typeof window.showDirectoryPicker === 'function';
  const DATA_FILE_NAME = 'artefactos-data.json';
  const LS_KEY = 'gestorArtefactos:data';
  const EMPTY_STATE = { artifacts: [], nodes: [], relations: [] };

  let dirHandle = null;      // carpeta conectada y con permiso concedido (o null)
  let pendingHandle = null;  // carpeta recordada de una sesión anterior, pendiente de reconectar
  let lastState = { ...EMPTY_STATE };
  let importedCallback = null;
  let zoomCallback = null;

  /* ---------- Control de concurrencia (varios usuarios/pestañas a la vez) ----------
   * Cada guardado lleva un número de revisión. "syncedSnapshot"/"syncedRevision" son
   * el último estado que sabemos que coincide con lo guardado en disco (o en
   * localStorage): es la "base" común para combinar cambios con mergeArtifactState
   * (de merge-logic.js) cuando se detecta que alguien más ha guardado mientras
   * tanto, en vez de que el último guardado machaque sin más al anterior. */
  let syncedRevision = 0;
  let syncedSnapshot = { ...EMPTY_STATE };
  let pollTimer = null;
  const POLL_INTERVAL_MS = 8000;

  // Copia independiente: "syncedSnapshot" es la base para combinar cambios y
  // NUNCA debe compartir los mismos arrays/objetos que el "state" en vivo de
  // la aplicación — si los compartiera, una edición posterior (p.ej. añadir un
  // artefacto con state.artifacts.push(...)) modificaría también la base "a
  // la vez", y la detección de cambios concurrentes dejaría de funcionar.
  function deepClone(data) { return JSON.parse(JSON.stringify(data)); }

  // Una carpeta sincronizada (OneDrive, red...) falla a veces de forma puntual:
  // el cliente de OneDrive tiene el archivo bloqueado un instante mientras lo
  // sube o lo descarga, o el archivo llega a medias. Casi siempre se arregla
  // solo, así que se reintenta un par de veces antes de darlo por fallido.
  // (No se reintentan "no existe" ni "cancelado", que no son transitorios.)
  async function retryAsync(fn) {
    const delays = window.__retryDelays || [250, 700];
    let lastErr;
    for (let i = 0; i <= delays.length; i++) {
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        if (e && (e.name === 'NotFoundError' || e.name === 'AbortError')) throw e;
        if (i < delays.length) await new Promise(r => setTimeout(r, delays[i]));
      }
    }
    throw lastErr;
  }

  function normalize(data) {
    if (!data || typeof data !== 'object') return { ...EMPTY_STATE };
    return {
      artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      relations: Array.isArray(data.relations) ? data.relations : []
    };
  }

  /* ---------- IndexedDB: recordar el handle de la carpeta entre sesiones ---------- */
  // Gancho solo para pruebas automatizadas: permite sustituir el almacén por uno
  // en memoria, ya que un FileSystemDirectoryHandle simulado (sin soporte nativo
  // del navegador) no se puede clonar de verdad en una IndexedDB real. En
  // producción esto no se usa (window.__idbOverride no existe).
  function idbBackend() {
    return window.__idbOverride || null;
  }
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('gestor-artefactos-fs', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const override = idbBackend();
    if (override) return override.get(key);
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const r = db.transaction('handles', 'readonly').objectStore('handles').get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, val) {
    const override = idbBackend();
    if (override) return override.set(key, val);
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbDel(key) {
    const override = idbBackend();
    if (override) return override.del(key);
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------- lectura/escritura dentro de una carpeta real ---------- */
  // Devuelven/reciben { revision, data } — la revisión es lo que permite
  // detectar que alguien más ha guardado desde la última vez que leímos.
  async function readDataFileRaw(handle) {
    return retryAsync(async () => {
      let fh;
      try { fh = await handle.getFileHandle(DATA_FILE_NAME); }
      catch (e) {
        if (e && e.name === 'NotFoundError') return { revision: 0, data: { ...EMPTY_STATE } };
        throw e;
      }
      const file = await fh.getFile();
      const raw = JSON.parse(await file.text()); // si llegó a medias, falla y se reintenta
      return { revision: (raw && typeof raw.revision === 'number') ? raw.revision : 0, data: normalize(raw) };
    });
  }
  async function writeDataFileRaw(handle, revision, data) {
    return retryAsync(async () => {
      const fh = await handle.getFileHandle(DATA_FILE_NAME, { create: true });
      const writable = await fh.createWritable();
      await writable.write(JSON.stringify({ revision, ...data }, null, 2));
      await writable.close();
    });
  }

  /* ---------- lectura/escritura en localStorage, con la misma revisión ---------- */
  function readLocalStorageRaw() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY));
      return { revision: (raw && typeof raw.revision === 'number') ? raw.revision : 0, data: normalize(raw) };
    } catch (e) { return { revision: 0, data: { ...EMPTY_STATE } }; }
  }
  function writeLocalStorageRaw(revision, data) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ revision, ...data })); }
    catch (e) { console.error('No se pudo guardar en localStorage:', e); }
  }

  /* ---------- trabajo que no ha podido guardarse en la carpeta ----------
   * Si la carpeta (OneDrive, red...) no responde, el último estado se guarda
   * aparte en el navegador y se reintenta solo en el siguiente sondeo. Importante:
   * esto NO toca syncedSnapshot/syncedRevision (la base para combinar): si lo
   * hiciera, cuando la carpeta se recuperase, lo que nunca llegó a ella se
   * interpretaría como "borrado por otro usuario" y se perdería. */
  const PENDING_KEY = 'gestorArtefactos:pendingFolderSave';
  function writePending(folderName, data) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ folder: folderName, data })); } catch (e) {}
  }
  function readPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY)); } catch (e) { return null; }
  }
  function clearPending() {
    try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
  }
  function setSaveStatus(text) {
    const el = document.getElementById('saveStatus');
    if (el) el.textContent = text;
  }

  /* ---------- aviso breve en pantalla cuando se combinan cambios ---------- */
  let toastTimer = null;
  function showToast(message) {
    let el = document.getElementById('concurrencyToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'concurrencyToast';
      el.className = 'concurrency-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 6000);
  }
  function notifyMerge(conflicts) {
    const n = (conflicts && conflicts.total) || 0;
    showToast(n > 0
      ? `🔀 Combinado con cambios de otro usuario (${n} con conflicto: ha ganado tu versión).`
      : '🔀 Combinado con cambios guardados por otro usuario mientras tanto.');
  }

  /* ---------- combinar + escribir cuando hay un cambio concurrente ---------- */
  async function applyMergeAndWrite(writeRaw, ours, theirsRaw) {
    const { data: merged, conflicts } = window.mergeArtifactState(syncedSnapshot, ours, theirsRaw.data);
    const newRevision = Math.max(theirsRaw.revision, syncedRevision) + 1;
    await writeRaw(newRevision, merged);
    syncedRevision = newRevision;
    syncedSnapshot = deepClone(merged);
    lastState = merged;
    notifyMerge(conflicts);
    if (importedCallback) importedCallback(merged);
    return merged;
  }

  // Guarda "ours"; si alguien más ha guardado desde la última sincronización
  // (revisión distinta), combina en vez de sobrescribir.
  async function saveWithMerge(readRaw, writeRaw, ours) {
    let current;
    try { current = await readRaw(); }
    catch (e) { current = { revision: syncedRevision, data: syncedSnapshot }; }
    if (current.revision === syncedRevision) {
      const newRevision = syncedRevision + 1;
      await writeRaw(newRevision, ours);
      syncedRevision = newRevision;
      syncedSnapshot = deepClone(ours);
      lastState = ours;
      return ours;
    }
    return applyMergeAndWrite(writeRaw, ours, current);
  }

  /* ---------- sondeo: ver cambios de otros aunque nosotros no guardemos ---------- */
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function startPolling() {
    stopPolling();
    if (!dirHandle) return;
    pollTimer = setInterval(pollForRemoteChanges, POLL_INTERVAL_MS);
    // Primera comprobación enseguida (p. ej. por si OneDrive dejó copias de
    // conflicto mientras la aplicación estaba cerrada).
    setTimeout(pollForRemoteChanges, 1200);
  }

  /* ---------- copias de conflicto de OneDrive ----------
   * Cuando dos equipos modifican a la vez el mismo archivo, OneDrive no lo
   * combina: conserva uno y deja el otro como una copia con otro nombre, del
   * estilo "artefactos-data-NOMBREDELPC.json" o "artefactos-data (1).json".
   * Esas copias contienen trabajo de alguien, así que en vez de ignorarlas se
   * incorporan al archivo principal (solo añadiendo, nunca borrando: ver
   * mergeConflictCopy), se guarda una copia de seguridad del original en la
   * subcarpeta "conflictos-resueltos" y entonces se retira de la carpeta. */
  const CONFLICT_DIR_NAME = 'conflictos-resueltos';
  function isConflictCopyName(name) {
    if (name === DATA_FILE_NAME) return false;
    if (!/^artefactos-data.*\.json$/i.test(name)) return false;
    if (/\.copia-/i.test(name)) return false; // copias de seguridad de la versión de escritorio
    return true;
  }
  async function listConflictCopies() {
    const copies = [];
    try {
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file' && isConflictCopyName(name)) copies.push({ name, handle });
      }
    } catch (e) { return []; }
    return copies;
  }
  function timestampForName() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  async function archiveConflictCopy(name, text) {
    const sub = await retryAsync(() => dirHandle.getDirectoryHandle(CONFLICT_DIR_NAME, { create: true }));
    const archivedName = name.replace(/\.json$/i, '') + '.' + timestampForName() + '.json';
    await retryAsync(async () => {
      const fh = await sub.getFileHandle(archivedName, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
    });
  }

  let absorbing = false;
  async function absorbConflictCopies() {
    if (!dirHandle || absorbing) return;
    absorbing = true;
    try {
      const copies = await listConflictCopies();
      if (copies.length === 0) return;

      // 1) Leer y combinar en memoria (sin tocar nada todavía).
      let combined = lastState;
      let added = 0, conflicts = 0;
      const readable = [];
      for (const c of copies) {
        let text, parsed;
        try {
          text = await retryAsync(async () => await (await c.handle.getFile()).text());
          parsed = JSON.parse(text);
        } catch (e) { continue; } // ilegible o ya retirada por otra persona: se deja como está
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.artifacts)) continue; // no es un archivo de datos
        const res = window.mergeConflictCopy(combined, normalize(parsed));
        combined = res.data; added += res.added; conflicts += res.conflicts;
        readable.push({ name: c.name, text });
      }
      if (readable.length === 0) return;

      // 2) Si aportan algo, se guarda como un guardado normal (que a su vez
      //    combina con lo que haya cambiado mientras tanto en el principal).
      if (added > 0) {
        const result = await saveWithMerge(
          () => readDataFileRaw(dirHandle),
          (rev, d) => writeDataFileRaw(dirHandle, rev, d),
          combined
        );
        if (importedCallback) importedCallback(result);
      }

      // 3) Copia de seguridad del original y, solo si se ha podido guardar, retirarlo.
      for (const r of readable) {
        try {
          await archiveConflictCopy(r.name, r.text);
          await dirHandle.removeEntry(r.name);
        } catch (e) { /* si no se puede archivar, la copia se queda donde está (y no se pierde nada) */ }
      }

      if (added > 0 || conflicts > 0) {
        showToast(`📥 Se ha recuperado trabajo de ${readable.length} copia${readable.length === 1 ? '' : 's'} de conflicto de OneDrive` +
          ` (${added} elemento${added === 1 ? '' : 's'} nuevo${added === 1 ? '' : 's'}` +
          (conflicts > 0 ? `; en ${conflicts} con diferencias se mantiene la versión actual` : '') +
          `). Los originales están en «${CONFLICT_DIR_NAME}».`);
      }
    } catch (e) {
      console.error('No se pudieron procesar las copias de conflicto:', e);
    } finally {
      absorbing = false;
    }
  }

  let pollBusy = false;
  async function pollForRemoteChanges() {
    if (!dirHandle || pollBusy) return;
    pollBusy = true;
    try {
      let current;
      try { current = await readDataFileRaw(dirHandle); }
      catch (e) { return; } // la carpeta no esta disponible ahora mismo: se reintentara en el siguiente sondeo
      if (current.revision !== syncedRevision) {
        await applyMergeAndWrite((rev, d) => writeDataFileRaw(dirHandle, rev, d), lastState, current);
      }
      // La carpeta responde: si había cambios que no pudieron guardarse, se reintentan ya.
      const pending = readPending();
      if (pending && pending.folder === dirHandle.name) {
        try {
          await saveWithMerge(
            () => readDataFileRaw(dirHandle),
            (rev, d) => writeDataFileRaw(dirHandle, rev, d),
            lastState
          );
          clearPending();
          setSaveStatus('Guardado');
          showToast('✅ Los cambios que estaban pendientes ya se han guardado en la carpeta.');
        } catch (e) { /* sigue sin poder: se reintentará en el siguiente sondeo */ }
      } else if (pending) {
        clearPending(); // era de otra carpeta distinta de la actual
      }
      await absorbConflictCopies();
    } catch (e) {
      console.error('Error al sincronizar con la carpeta:', e);
    } finally {
      pollBusy = false;
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollForRemoteChanges(); });
  window.addEventListener('focus', () => pollForRemoteChanges());

  // Mismo navegador, varias pestañas guardando en localStorage: el evento
  // 'storage' avisa automaticamente a las OTRAS pestañas cuando una guarda.
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_KEY || dirHandle) return;
    let current;
    try { current = e.newValue ? { revision: (JSON.parse(e.newValue).revision) || 0, data: normalize(JSON.parse(e.newValue)) } : { revision: 0, data: { ...EMPTY_STATE } }; }
    catch (err) { return; }
    if (current.revision === syncedRevision) return;
    applyMergeAndWrite(async (rev, d) => writeLocalStorageRaw(rev, d), lastState, current);
  });

  async function hasAnyData(d) {
    return !!d && (d.artifacts.length || d.nodes.length || d.relations.length);
  }

  /* ---------- API pública usada por el botón "Carpeta de datos" ---------- */
  async function connectNewFolder() {
    if (!FSA_SUPPORTED) {
      alert('Tu navegador no admite elegir una carpeta real. Prueba con una versión reciente de Chrome o Edge.\n\nMientras tanto, los datos se siguen guardando en este navegador.');
      return;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
      if (e && e.name !== 'AbortError') {
        // No es "el usuario ha cancelado": el navegador ha rechazado la carpeta.
        alert('El navegador no ha permitido usar esa carpeta' + (e.message ? ' (' + e.message + ')' : '') + '.\n\n' +
              'Chrome y Edge no permiten elegir carpetas del sistema ni la raíz de Documentos, Escritorio o Descargas. ' +
              'Si es una carpeta de OneDrive, crea dentro una subcarpeta (por ejemplo «GestorArtefactos») y elige esa.');
      }
      return; // cancelado o rechazado
    }

    let existingRaw = null;
    try { existingRaw = await readDataFileRaw(handle); } catch (e) { /* no se pudo leer: se trata como vacía */ }
    const existing = existingRaw ? existingRaw.data : null;

    let dataToUse = lastState;
    // Se parte SIEMPRE de la revisión que hubiera en la carpeta (aunque esté
    // vacía): si no, dos personas conectando a la misma carpeta casi a la vez
    // podrían calcular ambas "revisión 1" y una pisaría a la otra sin que
    // saveWithMerge llegue a detectarlo.
    let baseRevision = existingRaw ? existingRaw.revision : 0;
    if (await hasAnyData(existing)) {
      const useExisting = confirm(
        `La carpeta "${handle.name}" ya tiene datos guardados ` +
        `(${existing.artifacts.length} artefactos).\n\n` +
        `Aceptar: usar esos datos.\nCancelar: reemplazarlos por los datos actuales.`
      );
      if (useExisting) dataToUse = existing;
    }

    const newRevision = baseRevision + 1;
    try {
      await writeDataFileRaw(handle, newRevision, dataToUse);
    } catch (e) {
      alert('No se pudo escribir en esa carpeta: ' + e.message + '\n\n' +
            'Si es una carpeta de OneDrive, comprueba que está sincronizada y marcada como «Mantener siempre en este dispositivo».');
      return;
    }

    dirHandle = handle;
    pendingHandle = null;
    syncedRevision = newRevision;
    syncedSnapshot = deepClone(dataToUse);
    lastState = dataToUse;
    try { await idbSet('dir', handle); } catch (e) { /* si falla, funciona igual durante esta sesión */ }

    startPolling();
    if (importedCallback) importedCallback(dataToUse);
    refreshFolderButton();
  }

  async function reconnectFolder() {
    if (!pendingHandle) return;
    try {
      const perm = await pendingHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return;
      dirHandle = pendingHandle;
      pendingHandle = null;
      const { revision, data } = await readDataFileRaw(dirHandle);
      syncedRevision = revision;
      syncedSnapshot = deepClone(data);
      lastState = data;
      startPolling();
      if (importedCallback) importedCallback(data);
      refreshFolderButton();
    } catch (e) {
      alert('No se pudo reconectar la carpeta: ' + e.message);
    }
  }

  async function disconnectFolder() {
    stopPolling();
    dirHandle = null;
    pendingHandle = null;
    try { await idbDel('dir'); } catch (e) {}
    const newRevision = syncedRevision + 1;
    writeLocalStorageRaw(newRevision, lastState);
    syncedRevision = newRevision;
    syncedSnapshot = deepClone(lastState);
    clearPending();
    refreshFolderButton();
  }

  function folderStatus() {
    if (dirHandle) return { state: 'connected', name: dirHandle.name };
    if (pendingHandle) return { state: 'pending', name: pendingHandle.name };
    if (!FSA_SUPPORTED) return { state: 'unsupported' };
    return { state: 'none' };
  }

  /* ---------- window.api: el contrato que ya usa renderer.js ---------- */
  const api = {};

  api.loadData = async () => {
    if (FSA_SUPPORTED) {
      let saved = null;
      try { saved = await idbGet('dir'); } catch (e) {}
      if (saved) {
        try {
          const perm = await saved.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            dirHandle = saved;
            const { revision, data } = await readDataFileRaw(dirHandle);
            // La base de comparación es SIEMPRE lo que hay en la carpeta.
            syncedRevision = revision;
            syncedSnapshot = deepClone(data);
            let shown = data;
            // Si la sesión anterior se cerró con cambios que no llegaron a guardarse
            // en esta carpeta, se recuperan (solo añadiendo) y se guardan enseguida.
            const pending = readPending();
            if (pending && pending.folder === dirHandle.name && pending.data) {
              const res = window.mergeConflictCopy(data, normalize(pending.data));
              if (res.added > 0) shown = res.data; else clearPending();
            } else if (pending) {
              clearPending();
            }
            lastState = shown;
            startPolling();   // el primer sondeo reintenta guardar lo pendiente
            refreshFolderButton();
            return shown;
          }
          // Permiso no concedido todavía en esta sesión: se deja preparada
          // para reconectar con un clic (no se puede pedir permiso sin que
          // el usuario interactúe primero).
          pendingHandle = saved;
        } catch (e) {
          // El handle ya no es válido (la carpeta se movió, se borró...).
        }
      }
    }
    const { revision, data } = readLocalStorageRaw();
    syncedRevision = revision;
    syncedSnapshot = deepClone(data);
    lastState = data;
    refreshFolderButton();
    return data;
  };

  api.saveData = async (data) => {
    if (dirHandle) {
      try {
        await saveWithMerge(
          () => readDataFileRaw(dirHandle),
          (rev, d) => writeDataFileRaw(dirHandle, rev, d),
          data
        );
        clearPending();
        return true;
      } catch (e) {
        console.error('No se pudo guardar en la carpeta conectada:', e);
        // El aviso es visible (antes el fallback era silencioso: con OneDrive el
        // usuario creería que sus cambios están en la nube cuando no es así).
        lastState = data;
        writePending(dirHandle.name, data);
        showToast(`⚠️ No se pudo guardar en la carpeta «${dirHandle.name}» (¿OneDrive bloqueado un momento, sin espacio o sin conexión?). ` +
                  'Tus cambios están a salvo en este navegador y se reintentará solo en unos segundos.');
        return false;
      }
    }
    await saveWithMerge(
      async () => readLocalStorageRaw(),
      async (rev, d) => writeLocalStorageRaw(rev, d),
      data
    );
    return true;
  };

  api.exportData = async () => {
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'artefactos_export.json',
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
        });
        const w = await handle.createWritable();
        await w.write(JSON.stringify(lastState, null, 2));
        await w.close();
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        // si falla por otra razón, se sigue con la descarga normal de abajo
      }
    }
    const blob = new Blob([JSON.stringify(lastState, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'artefactos_export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  api.importData = async () => {
    let text = null;
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
        });
        text = await (await handle.getFile()).text();
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    if (text == null) {
      text = await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = () => {
          const f = input.files[0];
          if (!f) { resolve(null); return; }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsText(f);
        };
        input.click();
      });
      if (text == null) return;
    }

    let data;
    try { data = normalize(JSON.parse(text)); }
    catch (e) { alert('El archivo no es un JSON válido.'); return; }

    // Importar es una orden explícita de "usar este archivo", no se combina con
    // cambios concurrentes — pero sí se parte de la revisión actual del archivo,
    // para que un guardado posterior no crea equivocadamente que no hay cambios
    // que combinar.
    lastState = data;
    if (dirHandle) {
      try {
        let current;
        try { current = await readDataFileRaw(dirHandle); } catch (e) { current = { revision: syncedRevision }; }
        const newRevision = current.revision + 1;
        await writeDataFileRaw(dirHandle, newRevision, data);
        syncedRevision = newRevision;
        syncedSnapshot = deepClone(data);
      } catch (e) {
        const newRevision = syncedRevision + 1;
        writeLocalStorageRaw(newRevision, data);
        syncedRevision = newRevision;
        syncedSnapshot = deepClone(data);
      }
    } else {
      const current = readLocalStorageRaw();
      const newRevision = current.revision + 1;
      writeLocalStorageRaw(newRevision, data);
      syncedRevision = newRevision;
      syncedSnapshot = deepClone(data);
    }
    if (importedCallback) importedCallback(data);
  };

  api.onDataImported = (cb) => { importedCallback = cb; };

  // No hay menú nativo en el navegador: los atajos de teclado hacen lo mismo
  // que hacía el menú "Ver" de Electron.
  api.onCanvasZoom = (cb) => {
    zoomCallback = cb;
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); cb('in'); }
      else if (e.key === '-') { e.preventDefault(); cb('out'); }
      else if (e.key === '0') { e.preventDefault(); cb('reset'); }
    });
  };

  window.api = api;

  // Expuesto aparte (renderer.js no lo necesita) para el botón de carpeta
  // que añade esta versión de navegador.
  window.dataFolderUi = { connectNewFolder, reconnectFolder, disconnectFolder, folderStatus, FSA_SUPPORTED };

  // Gancho solo para pruebas automatizadas: fuerza un sondeo sin esperar al
  // intervalo real. No lo usa ninguna parte de la aplicación en producción.
  window.pollForRemoteChanges = pollForRemoteChanges;

  /* ---------- botón "Carpeta de datos" del encabezado ---------- */
  function refreshFolderButton() {
    const btn = document.getElementById('btnDataFolder');
    if (!btn) return;
    const st = folderStatus();
    btn.classList.toggle('folder-pending', st.state === 'pending');
    if (st.state === 'connected') btn.textContent = `📁 ${st.name}`;
    else if (st.state === 'pending') btn.textContent = `🔌 Reconectar: ${st.name}`;
    else if (st.state === 'unsupported') btn.textContent = '📁 Guardado en el navegador';
    else btn.textContent = '📁 Carpeta de datos…';
  }
  window.refreshDataFolderButton = refreshFolderButton;
})();
