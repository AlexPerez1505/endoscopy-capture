# Tauri + Vanilla

This template should help get you started developing with Tauri in vanilla HTML, CSS and Javascript.

## Build macOS

Para generar el `.app` y el `.dmg` en Mac, usa:

```sh
npm run build:mac
```

Ese comando elimina `src-tauri/target`, regenera los iconos desde
`src-tauri/installer/icon-source.png` y vuelve a empaquetar la aplicacion.

Si macOS sigue mostrando el icono anterior despues de instalar una version
nueva, borra la app vieja de `/Applications`, copia el `.app` nuevo y reinicia
Finder/Dock o vuelve a iniciar sesion. macOS puede cachear iconos por el mismo
`identifier` (`com.enclaii.desktop`).

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
