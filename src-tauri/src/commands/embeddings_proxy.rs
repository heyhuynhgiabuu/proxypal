/// Lightweight axum-based HTTP proxy that exposes a `/v1/embeddings` endpoint.
///
/// CLIProxyAPI (the main router sidecar) does not support the OpenAI `/v1/embeddings`
/// endpoint. This module starts a small in-process HTTP server that forwards all
/// `/v1/embeddings` requests to the copilot-api sidecar on its configured port.
///
/// The server also exposes `/v1/models` listing only the three embedding models
/// available through GitHub Copilot, so callers can discover them.
///
/// Lifecycle: started alongside copilot-api, stopped when copilot-api stops.

use axum::{
    body::Body,
    extract::State as AxumState,
    http::{Request, Response, StatusCode},
    routing::{get, post},
    Router,
};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Embedding models exposed by GitHub Copilot (free quota, no policy restrictions).
const EMBEDDING_MODELS: &[&str] = &[
    "text-embedding-3-small",
    "text-embedding-3-small-inference",
    "text-embedding-ada-002",
];

#[derive(Clone)]
struct ProxyConfig {
    upstream_base: String,
}

/// Start the embeddings proxy on `bind_port`, forwarding to copilot-api on `upstream_port`.
/// Returns a shutdown sender — drop or send `()` to stop the server.
pub async fn start_embeddings_proxy(
    bind_port: u16,
    upstream_port: u16,
) -> Result<oneshot::Sender<()>, String> {
    let upstream_base = format!("http://127.0.0.1:{}/v1", upstream_port);
    let config = ProxyConfig { upstream_base };

    let app = Router::new()
        .route("/v1/embeddings", post(handle_embeddings))
        .route("/v1/models", get(handle_models))
        .with_state(config);

    let addr = format!("127.0.0.1:{}", bind_port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind embeddings proxy to {}: {}", addr, e))?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    eprintln!("[ProxyPal] Embeddings proxy listening on http://{}", addr);
    Ok(shutdown_tx)
}

/// POST /v1/embeddings — forward the request body verbatim to copilot-api.
async fn handle_embeddings(
    AxumState(config): AxumState<ProxyConfig>,
    req: Request<Body>,
) -> Result<Response<Body>, StatusCode> {
    let client = reqwest::Client::new();

    // Forward Authorization header from the incoming request if present,
    // otherwise use a dummy key (copilot-api ignores the key).
    let auth_header = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Bearer dummy".to_string());

    // Read body bytes
    let (_, body) = req.into_parts();
    let bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let upstream_url = format!("{}/embeddings", config.upstream_base);
    let response = client
        .post(&upstream_url)
        .header("Content-Type", "application/json")
        .header("Authorization", auth_header)
        .body(bytes.to_vec())
        .send()
        .await
        .map_err(|e| {
            eprintln!("[ProxyPal] Embeddings proxy upstream error: {}", e);
            StatusCode::BAD_GATEWAY
        })?;

    let status = response.status();
    let resp_bytes = response.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

    let http_status = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    Ok(Response::builder()
        .status(http_status)
        .header("Content-Type", "application/json")
        .body(Body::from(resp_bytes))
        .unwrap())
}

/// GET /v1/models — return a minimal OpenAI-compatible model list for the embedding models.
async fn handle_models(
    AxumState(_config): AxumState<ProxyConfig>,
) -> Response<Body> {
    let models_json: Vec<serde_json::Value> = EMBEDDING_MODELS
        .iter()
        .map(|&id| {
            serde_json::json!({
                "id": id,
                "object": "model",
                "created": 1677610602,
                "owned_by": "github-copilot"
            })
        })
        .collect();

    let body = serde_json::json!({
        "object": "list",
        "data": models_json
    });

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}
