use std::collections::HashMap;

use base64::{
    engine::general_purpose::STANDARD as BASE64_STANDARD,
    Engine as _,
};
use reqwest::Method;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct LaravelRequest {
    method: Option<String>,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
struct LaravelResponse {
    status: u16,
    ok: bool,
    headers: HashMap<String, String>,
    body: String,
}

#[tauri::command]
async fn laravel_request(
    request: LaravelRequest,
) -> Result<LaravelResponse, String> {
    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<Method>()
        .map_err(|error| {
            format!("Método HTTP inválido: {error}")
        })?;

    let client = reqwest::Client::new();

    let mut builder = client.request(
        method,
        &request.url,
    );

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
            format!(
                "No se pudo alcanzar Laravel: {error}"
            )
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

#[cfg_attr(
    mobile,
    tauri::mobile_entry_point
)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_opener::init()
        )
        .invoke_handler(
            tauri::generate_handler![
                laravel_request
            ]
        )
        .run(
            tauri::generate_context!()
        )
        .expect(
            "error while running tauri application"
        );
}