/* ---------------------------------------------------------------------------
 * Control de concurrencia: combina los cambios de dos ediciones que han
 * partido del mismo estado "base" (la última versión que ambas partes tenían
 * en común), para que el guardado de una persona no borre los cambios de otra
 * que guardó mientras tanto.
 *
 * Se combina registro a registro (cada artefacto, nodo o relación, por su
 * "id"), no el archivo entero:
 *   - Si solo un lado cambió un registro -> se usa ese cambio.
 *   - Si ambos lados cambiaron el MISMO registro de forma distinta -> gana el
 *     lado local ("ours"), porque es quien lo está viendo/editando ahora
 *     mismo; el cambio remoto perdido se reporta en "conflicts" para poder
 *     avisar en la interfaz.
 *   - Si un lado borró un registro y el otro lo modificó -> gana la
 *     modificación (nunca se pierde en silencio una edición por un borrado
 *     concurrente).
 *   - Las altas de ambos lados se conservan siempre.
 *
 * Funciona igual en Node (Electron) y en el navegador: se expone como
 * `module.exports` o como `window.mergeArtifactState`, según dónde se cargue.
 * ------------------------------------------------------------------------- */
(function (root) {

  function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function toMap(arr) {
    const m = new Map();
    (arr || []).forEach(item => { if (item && item.id != null) m.set(item.id, item); });
    return m;
  }

  // Combina una colección (artifacts, nodes o relations) de los tres lados.
  // Devuelve { result: [...], conflicts: [ids] }.
  function mergeCollection(baseArr, oursArr, theirsArr) {
    const baseMap = toMap(baseArr), oursMap = toMap(oursArr), theirsMap = toMap(theirsArr);

    // Orden: primero como estaban en "ours" (para no reordenar lo que el
    // usuario local ya tenía delante), luego las altas nuevas de "theirs".
    const orderedIds = [...oursMap.keys()];
    theirsMap.forEach((_, id) => { if (!oursMap.has(id)) orderedIds.push(id); });

    const result = [];
    const conflicts = [];

    orderedIds.forEach(id => {
      const b = baseMap.get(id), o = oursMap.get(id), t = theirsMap.get(id);

      if (o === undefined && t === undefined) return; // borrado en ambos lados

      if (o === undefined) {
        // Lo borramos nosotros localmente.
        const tChanged = !deepEqual(b, t);
        if (tChanged) result.push(t); // su modificación gana sobre nuestro borrado
        return; // si no lo tocaron, se queda borrado
      }

      if (t === undefined) {
        // Lo borraron en el otro lado.
        const oChanged = !deepEqual(b, o);
        if (oChanged) result.push(o); // nuestra modificación gana sobre su borrado
        return; // si no lo tocamos, se queda borrado
      }

      // Existe en los dos lados.
      const oChanged = !deepEqual(b, o);
      const tChanged = !deepEqual(b, t);
      if (!oChanged && !tChanged) { result.push(b !== undefined ? b : o); return; }
      if (oChanged && !tChanged) { result.push(o); return; }
      if (!oChanged && tChanged) { result.push(t); return; }
      // Los dos lo cambiaron de forma distinta: gana el local, se reporta el conflicto.
      result.push(o);
      if (!deepEqual(o, t)) conflicts.push(id);
    });

    return { result, conflicts };
  }

  // Tras combinar, elimina referencias que hayan quedado colgando (un nodo
  // cuyo artefacto ya no existe, una relación que apunta a un nodo borrado...),
  // igual que ya hace la propia aplicación al borrar un artefacto a mano.
  function cleanupOrphans(data) {
    const artifactIds = new Set(data.artifacts.map(a => a.id));
    const nodes = data.nodes.filter(n => artifactIds.has(n.artifactId));
    const nodeIds = new Set(nodes.map(n => n.id));
    // Un nodo anidado cuyo padre ya no existe pasa a quedar suelto en el lienzo,
    // en vez de desaparecer sin más.
    nodes.forEach(n => { if (n.parentId && !nodeIds.has(n.parentId)) n.parentId = null; });
    const relations = data.relations.filter(r => nodeIds.has(r.from) && nodeIds.has(r.to));
    return { artifacts: data.artifacts, nodes, relations };
  }

  function mergeArtifactState(base, ours, theirs) {
    base = base || { artifacts: [], nodes: [], relations: [] };
    ours = ours || { artifacts: [], nodes: [], relations: [] };
    theirs = theirs || { artifacts: [], nodes: [], relations: [] };

    const a = mergeCollection(base.artifacts, ours.artifacts, theirs.artifacts);
    const n = mergeCollection(base.nodes, ours.nodes, theirs.nodes);
    const r = mergeCollection(base.relations, ours.relations, theirs.relations);

    const data = cleanupOrphans({ artifacts: a.result, nodes: n.result, relations: r.result });
    const conflicts = {
      artifacts: a.conflicts,
      nodes: n.conflicts,
      relations: r.conflicts,
      total: a.conflicts.length + n.conflicts.length + r.conflicts.length
    };
    return { data, conflicts };
  }

  // Incorpora una "copia de conflicto" (p. ej. los archivos que OneDrive crea
  // como "artefactos-data-NOMBREDEPC.json" cuando dos equipos modifican el mismo
  // archivo a la vez) al estado actual.
  //
  // De una copia de conflicto NO se conoce el estado común del que partió, así
  // que no se puede saber qué falta en ella porque se borró y qué falta porque
  // simplemente no lo tenía aún. Por eso esta combinación es solo ADITIVA:
  //   - lo que está en la copia y no en el estado actual, se añade;
  //   - lo que está en los dos y es igual, se deja;
  //   - lo que está en los dos y es distinto, se queda la versión ACTUAL y se
  //     cuenta como conflicto;
  //   - nunca se borra nada del estado actual.
  // Es preferible que reaparezca algo que se había borrado a perder trabajo.
  function mergeConflictCopy(current, copy) {
    current = current || { artifacts: [], nodes: [], relations: [] };
    copy = copy || { artifacts: [], nodes: [], relations: [] };
    const keys = ['artifacts', 'nodes', 'relations'];
    const result = {};
    const conflictIds = [];
    const currentIds = {};

    keys.forEach(key => {
      const arr = (current[key] || []).slice();
      const map = toMap(arr);
      currentIds[key] = new Set(map.keys());
      (copy[key] || []).forEach(item => {
        if (!item || item.id == null) return;
        const existing = map.get(item.id);
        if (existing === undefined) {
          arr.push(item);
          map.set(item.id, item);
        } else if (!deepEqual(existing, item)) {
          conflictIds.push(item.id);
        }
      });
      result[key] = arr;
    });

    const data = cleanupOrphans(result);
    // "added" se cuenta DESPUÉS de limpiar referencias colgantes, para no
    // anunciar elementos que acaban descartándose.
    let added = 0;
    keys.forEach(key => {
      data[key].forEach(item => { if (!currentIds[key].has(item.id)) added++; });
    });
    return { data, added, conflicts: conflictIds.length };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mergeArtifactState, mergeConflictCopy };
  } else {
    root.mergeArtifactState = mergeArtifactState;
    root.mergeConflictCopy = mergeConflictCopy;
  }
})(typeof window !== 'undefined' ? window : globalThis);
