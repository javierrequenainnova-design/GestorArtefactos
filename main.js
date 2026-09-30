const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Persistencia
//
// TODO (biblioteca de artefactos + nodos del lienzo + relaciones) se guarda en un
// único archivo, artefactos-data.json, dentro de la "carpeta de datos".
//
// Por defecto es la carpeta de datos de usuario de la aplicación, pero se puede
// cambiar (Archivo -> Cambiar carpeta de datos…). La carpeta elegida se recuerda en
// config.json, que siempre está en la carpeta de datos de usuario: ahí es donde se
// mira al arrancar para saber qué carpeta hay que usar.
// ---------------------------------------------------------------------------
const DATA_FILE_NAME = 'artefactos-data.json';
const DEFAULT_DATA_DIR = app.getPath('userData');
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

const EMPTY_STATE = { artifacts: [], nodes: [], relations: [] };

let dataDir = DEFAULT_DATA_DIR;   // carpeta de datos en uso
let unavailableDir = null;        // carpeta configurada que no estaba disponible al arrancar
let mainWindow;

function dataFile() {
  return path.join(dataDir, DATA_FILE_NAME);
}

function sameDir(a, b) {
  const x = path.resolve(a), y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

// Escritura atómica: se escribe en un archivo temporal y se renombra, así un corte
// (p. ej. desconectar un USB) nunca deja el archivo de datos a medio escribir.
function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* nada que limpiar */ }
    throw e;
  }
}

function normalizeData(data) {
  return {
    artifacts: data.artifacts || [],
    nodes: data.nodes || [],
    relations: data.relations || []
  };
}

// Lectura estricta de un archivo de datos: {data} si es válido, {error} si no.
function readDataFileStrict(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    return { error: e.code === 'ENOENT' ? 'no existe' : e.message };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.artifacts)) {
      return { error: 'formato no válido' };
    }
    return { data: normalizeData(parsed) };
  } catch (e) {
    return { error: 'no es un JSON válido' };
  }
}

function timestamp() {
  return new Date().toISOString().replace('T', '_').replace(/[:.]/g, '-').slice(0, 19);
}

// Copia de seguridad junto al original: artefactos-data.copia-AAAA-MM-DD_hh-mm-ss.json
function backupFile(file) {
  const backup = file.replace(/\.json$/i, '') + '.copia-' + timestamp() + '.json';
  fs.copyFileSync(file, backup);
  return backup;
}

function readData() {
  const file = dataFile();
  const result = readDataFileStrict(file);
  if (result.data) return result.data;
  // Si el archivo existe pero está dañado, se conserva una copia antes de que el
  // siguiente guardado lo sobrescriba con datos vacíos.
  if (fs.existsSync(file)) {
    try { backupFile(file); } catch (e) { /* mejor esfuerzo */ }
  }
  return { ...EMPTY_STATE };
}

function writeData(data) {
  writeJsonAtomic(dataFile(), data);
}

// --- configuración (carpeta elegida) ---
function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  } catch (e) {
    return {};
  }
}

function writeConfig(cfg) {
  writeJsonAtomic(CONFIG_FILE, cfg);
}

// Una carpeta es utilizable si existe y se puede leer y escribir en ella.
function isFolderUsable(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
    // Prueba real de escritura: accessSync no detecta todas las unidades de solo lectura
    const probe = path.join(dir, '.artefactos-prueba-' + process.pid);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

function getFolderInfo() {
  return {
    dir: dataDir,
    file: dataFile(),
    isDefault: sameDir(dataDir, DEFAULT_DATA_DIR),
    defaultDir: DEFAULT_DATA_DIR,
    unavailable: unavailableDir
  };
}

// Al arrancar: decide qué carpeta usar. Devuelve false si el usuario prefiere salir.
function resolveDataDirAtStartup() {
  const cfg = readConfig();
  const configured = typeof cfg.dataFolder === 'string' && cfg.dataFolder ? cfg.dataFolder : null;

  if (!configured || sameDir(configured, DEFAULT_DATA_DIR)) {
    dataDir = DEFAULT_DATA_DIR;
    return true;
  }

  for (;;) {
    if (isFolderUsable(configured)) {
      dataDir = configured;
      return true;
    }
    // No se arranca en silencio con otra carpeta: los cambios irían a un sitio
    // distinto del esperado y parecería que se han perdido los datos.
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Carpeta de datos no disponible',
      message: 'No se puede acceder a la carpeta de datos configurada.',
      detail: configured + '\n\n¿Es una unidad externa o de red que no está conectada?',
      buttons: ['Reintentar', 'Usar la carpeta predeterminada esta vez', 'Salir'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    if (choice === 0) continue;
    if (choice === 1) {
      dataDir = DEFAULT_DATA_DIR;
      unavailableDir = configured;   // la configuración no se toca: la próxima vez se vuelve a intentar
      return true;
    }
    return false;
  }
}

function describeData(d) {
  return d.artifacts.length + ' artefactos, ' + d.nodes.length + ' en el lienzo, ' +
         d.relations.length + ' relaciones';
}

function notifyFolderChanged() {
  if (mainWindow) mainWindow.webContents.send('folder:changed', getFolderInfo());
}

// Cambia la carpeta de datos a newDir. Nunca borra nada: los datos de la carpeta
// anterior se conservan, y si hay que sobrescribir un archivo se guarda antes una copia.
async function switchDataFolder(newDir) {
  const target = path.resolve(newDir);
  const win = mainWindow;

  if (sameDir(dataDir, target)) {
    await dialog.showMessageBox(win, {
      type: 'info',
      message: 'Esa ya es la carpeta de datos actual.',
      detail: target
    });
    return { changed: false, dir: dataDir };
  }

  if (!isFolderUsable(target)) {
    dialog.showErrorBox('Carpeta no válida',
      'No se puede leer y escribir en esta carpeta:\n' + target);
    return { changed: false, dir: dataDir };
  }

  const targetFile = path.join(target, DATA_FILE_NAME);
  // Se leen los datos actuales DESPUÉS de elegir la carpeta, para incluir cualquier
  // guardado que estuviera pendiente.
  const current = readData();
  let nextData = current;
  let note;

  try {
    if (fs.existsSync(targetFile)) {
      const existing = readDataFileStrict(targetFile);

      if (existing.data) {
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          title: 'La carpeta ya contiene datos',
          message: 'La carpeta seleccionada ya contiene un archivo de datos.',
          detail: target + '\n\n' +
                  'En esa carpeta: ' + describeData(existing.data) + '\n' +
                  'Datos actuales: ' + describeData(current),
          buttons: ['Usar los datos de esa carpeta', 'Reemplazar con los datos actuales', 'Cancelar'],
          defaultId: 0,
          cancelId: 2,
          noLink: true
        });
        if (response === 2) return { changed: false, dir: dataDir };
        if (response === 0) {
          nextData = existing.data;
          note = 'Ahora se usan los datos que había en esa carpeta.';
        } else {
          const backup = backupFile(targetFile);
          writeJsonAtomic(targetFile, current);
          note = 'Se han copiado los datos actuales. El archivo que había se conserva como:\n' + backup;
        }
      } else {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          title: 'Archivo de datos ilegible',
          message: 'La carpeta contiene un archivo de datos que no se puede leer.',
          detail: targetFile + '\n(' + existing.error + ')\n\n' +
                  'Si continúas, se guardará una copia de ese archivo y se creará uno nuevo con los datos actuales.',
          buttons: ['Reemplazar (guardando copia)', 'Cancelar'],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        });
        if (response !== 0) return { changed: false, dir: dataDir };
        const backup = backupFile(targetFile);
        writeJsonAtomic(targetFile, current);
        note = 'Se han copiado los datos actuales. El archivo ilegible se conserva como:\n' + backup;
      }
    } else {
      writeJsonAtomic(targetFile, current);
      note = 'Se han copiado los datos actuales a la nueva carpeta.';
    }

    // Todo escrito: ahora se recuerda la elección y se activa la carpeta.
    const cfg = readConfig();
    if (sameDir(target, DEFAULT_DATA_DIR)) delete cfg.dataFolder;
    else cfg.dataFolder = target;
    writeConfig(cfg);
  } catch (e) {
    dialog.showErrorBox('No se pudo cambiar la carpeta de datos',
      e.message + '\n\nSe sigue usando la carpeta anterior:\n' + dataDir);
    return { changed: false, dir: dataDir };
  }

  const previousDir = dataDir;
  dataDir = target;
  unavailableDir = null;

  if (win) win.webContents.send('data:imported', nextData);
  notifyFolderChanged();

  await dialog.showMessageBox(win, {
    type: 'info',
    message: 'Carpeta de datos cambiada',
    detail: target + '\n\n' + note + '\n\n' +
            'Los datos de la carpeta anterior no se han borrado:\n' + previousDir
  });
  return { changed: true, dir: dataDir };
}

async function chooseDataFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegir carpeta de datos',
    buttonLabel: 'Usar esta carpeta',
    defaultPath: dataDir,
    properties: ['openDirectory', 'createDirectory']
  });
  if (canceled || !filePaths[0]) return { changed: false, dir: dataDir };
  return switchDataFolder(filePaths[0]);
}

async function resetDataFolder() {
  if (sameDir(dataDir, DEFAULT_DATA_DIR)) {
    const cfg = readConfig();
    if (cfg.dataFolder) {
      // Se estaba usando la predeterminada solo porque la configurada no estaba disponible
      delete cfg.dataFolder;
      writeConfig(cfg);
      unavailableDir = null;
      notifyFolderChanged();
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: 'Se usará siempre la carpeta de datos predeterminada.',
        detail: DEFAULT_DATA_DIR
      });
    } else {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: 'Ya se está usando la carpeta de datos predeterminada.',
        detail: DEFAULT_DATA_DIR
      });
    }
    return { changed: false, dir: dataDir };
  }
  return switchDataFolder(DEFAULT_DATA_DIR);
}

function openDataFolder() {
  if (fs.existsSync(dataFile())) shell.showItemInFolder(dataFile());
  else shell.openPath(dataDir);
}

// Envuelve una acción de carpeta para que un fallo inesperado no quede sin avisar
async function guardedFolderAction(action) {
  try {
    await action();
  } catch (e) {
    dialog.showErrorBox('Error con la carpeta de datos', e.message);
  }
  return getFolderInfo();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  Menu.setApplicationMenu(buildMenu());
}

async function exportDataDialog() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar biblioteca y diseño',
    defaultPath: 'artefactos_export.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return null;
  const data = readData();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

async function importDataDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar biblioteca y diseño',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths[0]) return null;
  const raw = fs.readFileSync(filePaths[0], 'utf-8');
  const data = JSON.parse(raw);
  const normalized = {
    artifacts: data.artifacts || [],
    nodes: data.nodes || [],
    relations: data.relations || []
  };
  writeData(normalized);
  if (mainWindow) mainWindow.webContents.send('data:imported', normalized);
  return normalized;
}

function sendCanvasZoom(action) {
  if (mainWindow) mainWindow.webContents.send('canvas:zoom', action);
}

function buildMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Exportar biblioteca y diseño…',
          click: async () => {
            const filePath = await exportDataDialog();
            if (filePath) dialog.showMessageBox(mainWindow, { message: 'Exportado correctamente a:\n' + filePath });
          }
        },
        {
          label: 'Importar biblioteca y diseño…',
          click: async () => {
            try {
              const data = await importDataDialog();
              if (data) dialog.showMessageBox(mainWindow, { message: 'Datos importados correctamente.' });
            } catch (e) {
              dialog.showErrorBox('Error al importar', e.message);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Abrir carpeta de datos',
          click: () => openDataFolder()
        },
        {
          label: 'Cambiar carpeta de datos…',
          click: () => guardedFolderAction(chooseDataFolder)
        },
        {
          label: 'Usar la carpeta de datos predeterminada',
          click: () => guardedFolderAction(resetDataFolder)
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        // Zoom del lienzo (no de toda la ventana): lo aplica la interfaz
        { label: 'Acercar lienzo', accelerator: 'CmdOrCtrl+Plus', click: () => sendCanvasZoom('in') },
        { label: 'Alejar lienzo', accelerator: 'CmdOrCtrl+-', click: () => sendCanvasZoom('out') },
        { label: 'Zoom normal del lienzo', accelerator: 'CmdOrCtrl+0', click: () => sendCanvasZoom('reset') }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

app.whenReady().then(() => {
  // Antes de abrir la ventana se decide qué carpeta de datos usar
  if (!resolveDataDirAtStartup()) {
    app.quit();
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- Comunicación con la interfaz (renderer) ---
ipcMain.handle('data:load', () => readData());
ipcMain.handle('data:save', (event, data) => {
  try {
    writeData(data);
    return true;
  } catch (e) {
    // Por ejemplo, si la carpeta (un USB o una unidad de red) ya no está disponible
    console.error('No se pudo guardar los datos:', e);
    return false;
  }
});
ipcMain.handle('folder:get', () => getFolderInfo());
ipcMain.handle('folder:change', () => guardedFolderAction(chooseDataFolder));
ipcMain.handle('folder:reset', () => guardedFolderAction(resetDataFolder));
ipcMain.handle('folder:open', () => { openDataFolder(); return getFolderInfo(); });
ipcMain.handle('dialog:export', () => exportDataDialog());
ipcMain.handle('dialog:import', async () => {
  try {
    return await importDataDialog();
  } catch (e) {
    dialog.showErrorBox('Error al importar', e.message);
    return null;
  }
});
