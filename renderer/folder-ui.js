/* Cableado del botón "📁 Carpeta de datos" del encabezado. Vive aparte de
 * renderer.js para no tocar ese archivo (es el mismo en la versión de
 * escritorio); usa lo que storage.js deja expuesto en window.dataFolderUi. */
(function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function openModal() {
    const ui = window.dataFolderUi;
    const st = ui.folderStatus();

    let statusLine;
    if (st.state === 'connected') statusLine = `Carpeta conectada: <b>${escapeHtml(st.name)}</b>`;
    else if (st.state === 'pending') statusLine = `Había una carpeta conectada (<b>${escapeHtml(st.name)}</b>) que hay que volver a autorizar.`;
    else if (st.state === 'unsupported') statusLine = 'Tu navegador no admite carpetas reales — los datos se guardan en este navegador.';
    else statusLine = 'Los datos se están guardando en este navegador (sin carpeta conectada).';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>Carpeta de datos</h3>
        <p class="folder-status-line">${statusLine}</p>
        ${st.state === 'pending' ? '<button type="button" id="df_reconnect" class="primary" style="width:100%;margin-bottom:8px;">🔌 Reconectar esta carpeta</button>' : ''}
        ${ui.FSA_SUPPORTED ? `<button type="button" id="df_change" style="width:100%;margin-bottom:8px;">📁 ${st.state === 'connected' ? 'Elegir otra carpeta…' : 'Elegir una carpeta…'}</button>` : ''}
        ${st.state === 'connected' ? '<button type="button" id="df_disconnect" style="width:100%;margin-bottom:8px;">Dejar de usar esta carpeta (volver al navegador)</button>' : ''}
        <p class="folder-help-text">El archivo se llama <code>artefactos-data.json</code>. Para llevar los datos a otro equipo o navegador sin carpeta compartida, usa Exportar/Importar.</p>
        <details class="folder-onedrive">
          <summary>☁️ Usar una carpeta de OneDrive (para trabajar varias personas)</summary>
          <ol>
            <li>En el Explorador de Windows, crea una subcarpeta dentro de tu OneDrive (p. ej. <code>GestorArtefactos</code>). No sirve la raíz de Documentos/Escritorio/Descargas: el navegador no las permite.</li>
            <li>Clic derecho en esa carpeta → <b>Mantener siempre en este dispositivo</b>.</li>
            <li>Aquí, pulsa «Elegir una carpeta…» y selecciona esa subcarpeta.</li>
            <li>Para compartirla: compártela desde OneDrive con permiso de edición; cada persona la añade a su OneDrive (<i>Agregar acceso directo a Mi OneDrive</i>) y la elige aquí también.</li>
          </ol>
          <p>Los cambios llegan a los demás cuando OneDrive sincroniza (unos segundos). Si dos personas guardan a la vez y OneDrive crea una copia «artefactos-data-NOMBREDELPC.json», la aplicación la incorpora sola y guarda el original en <code>conflictos-resueltos</code>.</p>
        </details>
        <div class="modal-actions"><div></div><div class="right"><button type="button" id="df_close">Cerrar</button></div></div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#df_close').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const reconnectBtn = overlay.querySelector('#df_reconnect');
    if (reconnectBtn) reconnectBtn.onclick = async () => {
      overlay.remove();
      await ui.reconnectFolder();
    };

    const changeBtn = overlay.querySelector('#df_change');
    if (changeBtn) changeBtn.onclick = async () => {
      overlay.remove();
      await ui.connectNewFolder();
    };

    const disconnectBtn = overlay.querySelector('#df_disconnect');
    if (disconnectBtn) disconnectBtn.onclick = async () => {
      overlay.remove();
      await ui.disconnectFolder();
    };
  }

  document.getElementById('btnDataFolder').addEventListener('click', openModal);
})();
