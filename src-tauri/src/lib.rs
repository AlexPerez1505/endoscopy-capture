use std::collections::HashMap;
use std::net::IpAddr;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

use base64::{
    engine::general_purpose::STANDARD as BASE64_STANDARD,
    Engine as _,
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

fn apply_window_icon(app: &tauri::App) -> tauri::Result<()> {
    if let Some(window) =
        app.get_webview_window("main")
    {
        let icon = tauri::image::Image::new(
            include_bytes!(
                "../icons/taskbar-icon.rgba"
            ),
            512,
            512,
        );

        window.set_icon(icon)?;
    }

    Ok(())
}

/*
 * Host de producción permitido para el proxy HTTP hacia Laravel.
 *
 * Es una constante COMPILADA en el binario, no un valor leído de
 * localStorage/JS: aunque el WebView estuviera comprometido (XSS), no puede
 * modificar esta lista, porque no vive en el lado que controla.
 */
const PRODUCTION_HOST: &str = "sistema.enclaii.com";
const DEFAULT_REQUEST_TIMEOUT_SECONDS: u64 = 30;
const MAX_REQUEST_TIMEOUT_SECONDS: u64 = 60 * 60;

/*
 * Hosts adicionales permitidos SOLO en builds de desarrollo (para apuntar a
 * un Laravel corriendo localmente). `#[cfg(debug_assertions)]` hace que esta
 * ruta ni siquiera exista en el binario de release que se distribuye a las
 * clínicas: no es "está desactivada por configuración", es código que no se
 * compila.
 */
#[cfg(debug_assertions)]
const ALLOWED_DEV_HOSTS: &[&str] = &["localhost", "127.0.0.1", "::1"];

fn is_allowed_host(host: &str) -> bool {
    if host == PRODUCTION_HOST {
        return true;
    }

    #[cfg(debug_assertions)]
    {
        if ALLOWED_DEV_HOSTS.contains(&host) {
            return true;
        }
    }

    false
}

fn validate_request_url(raw_url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(raw_url)
        .map_err(|error| format!("URL inválida: {error}"))?;

    let host = parsed
        .host_str()
        .ok_or_else(|| "La URL no tiene un host válido.".to_string())?
        .to_ascii_lowercase();

    if !is_allowed_host(&host) {
        return Err(format!("Host no autorizado para esta aplicación: {host}"));
    }

    if host == PRODUCTION_HOST && parsed.scheme() != "https" {
        return Err(
            "Solo se permiten conexiones HTTPS al servidor de producción.".to_string(),
        );
    }

    Ok(parsed)
}

fn is_blocked_asset_host(host: &str) -> bool {
    let normalized = host
        .trim()
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();

    if normalized == "localhost" || normalized.ends_with(".localhost") {
        return true;
    }

    if let Ok(ip) = normalized.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(value) => {
                value.is_private()
                    || value.is_loopback()
                    || value.is_link_local()
                    || value.is_broadcast()
                    || value.is_documentation()
                    || value.is_unspecified()
            }
            IpAddr::V6(value) => {
                value.is_loopback()
                    || value.is_unspecified()
                    || value.is_unique_local()
                    || value.is_unicast_link_local()
            }
        };
    }

    false
}

fn validate_asset_url(raw_url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(raw_url)
        .map_err(|error| format!("URL de archivo invalida: {error}"))?;

    let host = parsed
        .host_str()
        .ok_or_else(|| "La URL del archivo no tiene un host valido.".to_string())?
        .to_ascii_lowercase();

    if is_allowed_host(&host) {
        if host == PRODUCTION_HOST && parsed.scheme() != "https" {
            return Err(
                "Solo se permiten archivos HTTPS del servidor de produccion.".to_string(),
            );
        }

        return Ok(parsed);
    }

    if parsed.scheme() != "https" {
        return Err("Solo se permiten archivos externos por HTTPS.".to_string());
    }

    if is_blocked_asset_host(&host) {
        return Err(format!("Host de archivo no permitido: {host}"));
    }

    Ok(parsed)
}

/*
 * Cliente HTTP único y reutilizado (no se crea uno nuevo por cada petición),
 * con timeout explícito: sin esto, si Laravel se cuelga o hay un problema de
 * red que deja la conexión abierta, el `await` de la petición podía
 * quedarse esperando indefinidamente y la UI de JS nunca se enteraba.
 */
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("no se pudo construir el cliente HTTP")
    })
}

fn request_timeout(seconds: Option<u64>) -> Duration {
    let seconds = seconds
        .unwrap_or(DEFAULT_REQUEST_TIMEOUT_SECONDS)
        .clamp(1, MAX_REQUEST_TIMEOUT_SECONDS);

    Duration::from_secs(seconds)
}

#[derive(Debug, Deserialize)]
struct LaravelRequest {
    method: Option<String>,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
struct LaravelResponse {
    status: u16,
    ok: bool,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Debug, Deserialize)]
struct LaravelAssetRequest {
    url: String,
    headers: Option<HashMap<String, String>>,
    timeout_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
struct LaravelAssetResponse {
    status: u16,
    ok: bool,
    headers: HashMap<String, String>,
    content_type: String,
    body_base64: String,
}

#[tauri::command]
async fn laravel_request(
    request: LaravelRequest,
) -> Result<LaravelResponse, String> {
    let timeout = request_timeout(request.timeout_seconds);

    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<Method>()
        .map_err(|error| {
            format!("Método HTTP inválido: {error}")
        })?;

    let validated_url = validate_request_url(&request.url)?;

    let client = http_client();

    let mut builder = client.request(
        method,
        validated_url,
    )
    .timeout(timeout);

    /*
     * Este valor indica si el body recibido desde JavaScript
     * está codificado en Base64.
     *
     * Se utiliza especialmente para multipart/form-data,
     * imágenes, videos y documentos.
     */
    let mut body_encoding: Option<String> = None;

    if let Some(headers) = request.headers {
        for (key, value) in headers {
            let normalized =
                key.to_ascii_lowercase();

            /*
             * Headers que reqwest debe calcular
             * automáticamente.
             */
            if matches!(
                normalized.as_str(),
                "host"
                    | "connection"
                    | "content-length"
            ) {
                continue;
            }

            /*
             * Este es un header interno entre JavaScript
             * y Rust. No debe enviarse a Laravel.
             */
            if normalized == "x-body-encoding" {
                body_encoding = Some(
                    value
                        .trim()
                        .to_ascii_lowercase(),
                );

                continue;
            }

            builder = builder.header(
                key,
                value,
            );
        }
    }

    if let Some(body) = request.body {
        match body_encoding.as_deref() {
            Some("base64") => {
                /*
                 * Convierte el texto Base64 nuevamente
                 * en bytes reales.
                 *
                 * Esto permite que Laravel reconozca:
                 * - multipart/form-data
                 * - nombre_completo
                 * - folio
                 * - fotografía
                 * - documentos
                 */
                let decoded_body = BASE64_STANDARD
                    .decode(body.as_bytes())
                    .map_err(|error| {
                        format!(
                            "No se pudo decodificar el cuerpo Base64: {error}"
                        )
                    })?;

                builder = builder.body(
                    decoded_body,
                );
            }

            _ => {
                /*
                 * Para JSON, texto o formularios simples,
                 * el cuerpo se envía normalmente.
                 */
                builder = builder.body(body);
            }
        }
    }

    let response = builder
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "Laravel no respondió a tiempo (timeout).".to_string()
            } else {
                format!(
                    "No se pudo alcanzar Laravel: {error}"
                )
            }
        })?;

    let status = response.status();

    let mut response_headers =
        HashMap::new();

    for (key, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            response_headers.insert(
                key.as_str()
                    .to_ascii_lowercase(),
                value.to_string(),
            );
        }
    }

    let body = response
        .text()
        .await
        .map_err(|error| {
            format!(
                "Laravel respondió, pero no se pudo leer el cuerpo: {error}"
            )
        })?;

    Ok(LaravelResponse {
        status: status.as_u16(),
        ok: status.is_success(),
        headers: response_headers,
        body,
    })
}

#[tauri::command]
async fn laravel_asset(
    request: LaravelAssetRequest,
) -> Result<LaravelAssetResponse, String> {
    let timeout = request_timeout(request.timeout_seconds);
    let validated_url = validate_asset_url(&request.url)?;
    let client = http_client();

    let mut builder = client
        .get(validated_url)
        .timeout(timeout);

    if let Some(headers) = request.headers {
        for (key, value) in headers {
            let normalized =
                key.to_ascii_lowercase();

            if matches!(
                normalized.as_str(),
                "host"
                    | "connection"
                    | "content-length"
            ) {
                continue;
            }

            builder = builder.header(
                key,
                value,
            );
        }
    }

    let response = builder
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "Laravel no respondiÃ³ a tiempo (timeout).".to_string()
            } else {
                format!(
                    "No se pudo alcanzar Laravel: {error}"
                )
            }
        })?;

    let status = response.status();

    let mut response_headers =
        HashMap::new();

    for (key, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            response_headers.insert(
                key.as_str()
                    .to_ascii_lowercase(),
                value.to_string(),
            );
        }
    }

    let content_type = response_headers
        .get("content-type")
        .cloned()
        .unwrap_or_else(|| "application/octet-stream".to_string());

    let body = response
        .bytes()
        .await
        .map_err(|error| {
            format!(
                "Laravel respondiÃ³, pero no se pudo leer el archivo: {error}"
            )
        })?;

    Ok(LaravelAssetResponse {
        status: status.as_u16(),
        ok: status.is_success(),
        headers: response_headers,
        content_type,
        body_base64: BASE64_STANDARD.encode(body),
    })
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct CropImageRequest {
    data_base64: String,
    filename: String,
    folder: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct CropImageResponse {
    path: String,
    bytes: usize,
}

#[tauri::command]
async fn save_crop_image(
    app: tauri::AppHandle,
    request: CropImageRequest,
) -> Result<CropImageResponse, String> {
    let bytes = BASE64_STANDARD
        .decode(&request.data_base64)
        .map_err(|error| format!("Base64 invalido: {error}"))?;

    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("No se pudo obtener directorio local: {error}"))?;

    let folder = request.folder.unwrap_or_else(|| "focus_captures".to_string());
    let dir = app_dir.join(&folder);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("No se pudo crear carpeta: {error}"))?;

    let path = dir.join(
        Path::new(&request.filename)
            .file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new("capture.jpg")),
    );
    std::fs::write(&path, &bytes)
        .map_err(|error| format!("No se pudo guardar imagen: {error}"))?;

    Ok(CropImageResponse {
        path: path.to_string_lossy().to_string(),
        bytes: bytes.len(),
    })
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
struct RoiProfile {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    device_name: Option<String>,
}

#[tauri::command]
async fn load_roi_profile(app: tauri::AppHandle, device_name: Option<String>) -> Result<Option<RoiProfile>, String> {
    let store = app.store("roi-profiles.json").map_err(|e| e.to_string())?;
    let key = device_name.unwrap_or_else(|| "__default__".to_string());
    let value = store.get(&key);
    match value {
        Some(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
async fn save_roi_profile(app: tauri::AppHandle, profile: RoiProfile) -> Result<(), String> {
    let store = app.store("roi-profiles.json").map_err(|e| e.to_string())?;
    let key = profile.device_name.clone().unwrap_or_else(|| "__default__".to_string());
    store.set(&key, serde_json::to_value(&profile).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(
    mobile,
    tauri::mobile_entry_point
)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            apply_window_icon(app)?;

            Ok(())
        })
        .plugin(
            tauri_plugin_opener::init()
        )
        .plugin(
            tauri_plugin_store::Builder::new().build()
        )
        .invoke_handler(
            tauri::generate_handler![
                laravel_request,
                laravel_asset,
                save_crop_image,
                load_roi_profile,
                save_roi_profile
            ]
        )
        .run(
            tauri::generate_context!()
        )
        .expect(
            "error while running tauri application"
        );
}
