use std::collections::HashMap;

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
async fn laravel_request(request: LaravelRequest) -> Result<LaravelResponse, String> {
    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<Method>()
        .map_err(|error| format!("Metodo HTTP invalido: {error}"))?;

    let client = reqwest::Client::new();
    let mut builder = client.request(method, &request.url);

    if let Some(headers) = request.headers {
        for (key, value) in headers {
            let normalized = key.to_ascii_lowercase();
            if matches!(normalized.as_str(), "host" | "connection" | "content-length") {
                continue;
            }
            builder = builder.header(key, value);
        }
    }

    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("No se pudo alcanzar Laravel: {error}"))?;

    let status = response.status();
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            headers.insert(key.as_str().to_ascii_lowercase(), value.to_string());
        }
    }

    let body = response
        .text()
        .await
        .map_err(|error| format!("Laravel respondio, pero no se pudo leer el cuerpo: {error}"))?;

    Ok(LaravelResponse {
        status: status.as_u16(),
        ok: status.is_success(),
        headers,
        body,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![laravel_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
