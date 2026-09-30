# Gestor de Artefactos (escritorio)

Aplicación de escritorio (Electron) para gestionar artefactos, su biblioteca y un
lienzo de diseño con relaciones entre ellos.

## Persistencia

Todo se guarda automáticamente en disco (no en el navegador) en un archivo
`artefactos-data.json` dentro de la carpeta de datos de la aplicación del sistema
operativo (accesible desde el menú **Archivo → Abrir carpeta de datos**). Esto
incluye:
- La biblioteca de artefactos (nombre, tipo, descripción, propiedades).
- El lienzo de diseño (posición de cada nodo, incluidos los anidados en servidores).
- Las relaciones entre artefactos y su tipo.

Desde **Archivo → Exportar / Importar** puedes copiar ese archivo JSON a otro
equipo para llevarte tus datos.

## Requisitos

- [Node.js](https://nodejs.org) instalado (incluye npm). Esto es lo único que
  necesitas antes de empezar.

## Puesta en marcha (modo desarrollo)

```bash
npm install
npm start
```

Esto abre la aplicación en una ventana nativa.

## Generar el ejecutable de escritorio

```bash
npm run dist
```

Esto usa `electron-builder` y genera en la carpeta `dist/`:
- **Windows**: un `.exe` portable (no requiere instalación, se ejecuta directamente).
- **macOS**: un `.dmg`.
- **Linux**: un `.AppImage` (también portable, un único archivo ejecutable).

`electron-builder` compila para el sistema operativo en el que ejecutes el
comando. Si necesitas generar el ejecutable de Windows desde Linux/Mac (o
viceversa), consulta la documentación de electron-builder sobre compilación
cruzada.

## Estructura del proyecto

```
gestor-artefactos-desktop/
├── package.json      Configuración del proyecto y del build
├── main.js            Proceso principal: ventana, menú y persistencia en disco
├── preload.js          Puente seguro entre main.js y la interfaz
└── renderer/
    ├── index.html       Interfaz
    ├── styles.css        Estilos
    └── renderer.js        Lógica: biblioteca, lienzo, relaciones y anidado
```
