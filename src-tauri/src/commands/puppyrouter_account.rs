use std::collections::HashMap;
use std::str::FromStr;
use std::time::Duration;

use reqwest::header::{COOKIE, SET_COOKIE};
use reqwest::Method;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::app_config::AppType;
use crate::provider::{ClaudeDesktopMode, Provider, ProviderMeta};
use crate::services::model_fetch::FetchedModel;
use crate::services::ProviderService;
use crate::store::AppState;

const PUPPYROUTER_BASE_URL: &str = "https://puppyrouter.com";
const PUPPYROUTER_UNIVERSAL_ID: &str = "puppyrouter";
const ACCOUNT_SESSION_SETTING: &str = "puppyrouter_account_session";
const LEGACY_ACCOUNT_PENDING_SESSION_SETTING: &str = "puppyrouter_account_pending_session";
const SELECTED_TOKEN_SETTING: &str = "puppyrouter_account_selected_token";
const SELECTED_TOKEN_BY_APP_SETTING: &str = "puppyrouter_account_selected_tokens_by_app";
const DEFAULT_TOKEN_NAME: &str = "default_api_key";
const CODEX_MODEL_CATALOG_LIMIT: usize = 200;
const ACCOUNT_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const ACCOUNT_USER_AGENT: &str = "puppyrouter-app/1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PuppyRouterAccountUser {
    pub id: i64,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAccountSession {
    pub user: PuppyRouterAccountUser,
    pub cookie_header: String,
    pub logged_in_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSelectedToken {
    pub token_id: i64,
    pub name: String,
    pub masked_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub applied_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuppyRouterAccountStatus {
    pub logged_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<PuppyRouterAccountUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logged_in_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuppyRouterAccountBalance {
    pub quota: i64,
    pub used_quota: i64,
    pub quota_per_unit: i64,
    pub balance_usd: f64,
    pub usd_exchange_rate: f64,
    pub formatted_balance: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum PuppyRouterLoginPollResult {
    Pending { message: String, interval: i64 },
    Approved { account: PuppyRouterAccountStatus },
    Expired { message: String },
    Denied { message: String },
    Invalid { message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuppyRouterLoginStart {
    pub device_code: String,
    pub user_code: String,
    pub authorize_url: String,
    pub expires_at: i64,
    pub interval: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuppyRouterApiKey {
    pub id: i64,
    pub name: String,
    pub masked_key: String,
    pub status: i64,
    pub remain_quota: i64,
    pub used_quota: i64,
    pub unlimited_quota: bool,
    pub expired_time: i64,
    pub created_time: i64,
    pub accessed_time: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub cross_group_retry: bool,
    pub model_limits_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_limits: Option<String>,
    pub usable: bool,
    pub recommended: bool,
    pub provider_key_match: bool,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuppyRouterApiKeyList {
    pub keys: Vec<PuppyRouterApiKey>,
    pub total: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_token_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuppyRouterApplyKeyResult {
    pub synced: bool,
    pub token_id: i64,
    pub name: String,
    pub masked_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuppyRouterAccountGroup {
    pub name: String,
    pub description: String,
    pub ratio: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuppyRouterGroupUpdateResult {
    pub token_id: i64,
    pub group: String,
    pub cross_group_retry: bool,
}

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    success: bool,
    message: Option<String>,
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct LoginData {
    id: Option<i64>,
    username: Option<String>,
    display_name: Option<String>,
    role: Option<i64>,
    status: Option<i64>,
    group: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SelfData {
    quota: Option<i64>,
    used_quota: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct StatusData {
    quota_per_unit: Option<i64>,
    usd_exchange_rate: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct DesktopAuthStartData {
    device_code: String,
    user_code: String,
    authorize_url: String,
    expires_at: i64,
    interval: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct DesktopAuthPollData {
    status: String,
    message: Option<String>,
    interval: Option<i64>,
    user: Option<LoginData>,
}

#[derive(Debug, Deserialize)]
struct PageInfo<T> {
    total: Option<i64>,
    items: Option<Vec<T>>,
}

#[derive(Debug, Clone, Deserialize)]
struct TokenItem {
    id: i64,
    name: String,
    key: String,
    status: i64,
    remain_quota: Option<i64>,
    used_quota: Option<i64>,
    unlimited_quota: Option<bool>,
    expired_time: Option<i64>,
    created_time: Option<i64>,
    accessed_time: Option<i64>,
    group: Option<String>,
    cross_group_retry: Option<bool>,
    model_limits_enabled: Option<bool>,
    model_limits: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenKeyData {
    key: String,
}

#[derive(Debug, Deserialize)]
struct TokenKeysBatchData {
    keys: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct AccountGroupData {
    #[serde(default)]
    desc: String,
    #[serde(default)]
    ratio: Value,
}

fn now_timestamp() -> i64 {
    chrono::Utc::now().timestamp()
}

fn format_usd_balance(value: f64) -> String {
    let formatted = if value.abs() >= 1.0 {
        format!("{value:.2}")
    } else {
        format!("{value:.4}")
    };
    let trimmed = formatted
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string();
    format!("${}", if trimmed == "-0" { "0" } else { &trimmed })
}

fn normalize_quota_per_unit(value: Option<i64>) -> i64 {
    value
        .filter(|quota_per_unit| *quota_per_unit > 0)
        .unwrap_or(500_000)
}

fn normalize_usd_exchange_rate(value: Option<f64>) -> f64 {
    value
        .filter(|exchange_rate| exchange_rate.is_finite() && *exchange_rate > 0.0)
        .unwrap_or(7.3)
}

fn http_client() -> reqwest::Client {
    crate::proxy::http_client::get()
}

fn account_request(
    client: &reqwest::Client,
    method: Method,
    path: &str,
) -> reqwest::RequestBuilder {
    client
        .request(method, endpoint(path))
        .timeout(ACCOUNT_REQUEST_TIMEOUT)
        .header(reqwest::header::USER_AGENT, ACCOUNT_USER_AGENT)
}

fn endpoint(path: &str) -> String {
    format!("{PUPPYROUTER_BASE_URL}{path}")
}

fn setting_json<T: DeserializeOwned>(state: &AppState, key: &str) -> Result<Option<T>, String> {
    let Some(raw) = state.db.get_setting(key).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    serde_json::from_str(trimmed)
        .map(Some)
        .map_err(|e| format!("读取 PuppyRouter 账号状态失败: {e}"))
}

fn set_setting_json<T: Serialize>(state: &AppState, key: &str, value: &T) -> Result<(), String> {
    let raw =
        serde_json::to_string(value).map_err(|e| format!("保存 PuppyRouter 状态失败: {e}"))?;
    state.db.set_setting(key, &raw).map_err(|e| e.to_string())
}

fn clear_setting(state: &AppState, key: &str) -> Result<(), String> {
    state.db.set_setting(key, "").map_err(|e| e.to_string())
}

fn read_session(state: &AppState) -> Result<Option<StoredAccountSession>, String> {
    setting_json(state, ACCOUNT_SESSION_SETTING)
}

fn account_status_from_session(session: Option<StoredAccountSession>) -> PuppyRouterAccountStatus {
    match session {
        Some(session) => PuppyRouterAccountStatus {
            logged_in: true,
            user: Some(session.user),
            logged_in_at: Some(session.logged_in_at),
        },
        None => PuppyRouterAccountStatus {
            logged_in: false,
            user: None,
            logged_in_at: None,
        },
    }
}

fn cookie_pairs_from_set_cookie(headers: &reqwest::header::HeaderMap) -> Vec<String> {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.contains('='))
        .map(ToString::to_string)
        .collect()
}

fn merge_cookie_header(existing: Option<&str>, headers: &reqwest::header::HeaderMap) -> String {
    let mut cookies: HashMap<String, String> = HashMap::new();

    if let Some(existing) = existing {
        for pair in existing.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            if let Some((name, _)) = pair.split_once('=') {
                cookies.insert(name.to_string(), pair.to_string());
            }
        }
    }

    for pair in cookie_pairs_from_set_cookie(headers) {
        if let Some((name, _)) = pair.split_once('=') {
            cookies.insert(name.to_string(), pair);
        }
    }

    let mut values: Vec<String> = cookies.into_values().collect();
    values.sort();
    values.join("; ")
}

async fn parse_api_response<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<(ApiResponse<T>, String), String> {
    let status = response.status();
    let set_cookie_header = merge_cookie_header(None, response.headers());
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取 PuppyRouter 响应失败: {e}"))?;

    if !status.is_success() {
        let body = text.trim();
        let body = if body.len() > 240 { &body[..240] } else { body };
        return Err(format!("PuppyRouter HTTP {status}: {body}"));
    }

    let api = serde_json::from_str::<ApiResponse<T>>(&text)
        .map_err(|e| format!("解析 PuppyRouter 响应失败: {e}"))?;
    Ok((api, set_cookie_header))
}

fn ensure_api_success<T>(api: ApiResponse<T>) -> Result<T, String> {
    if api.success {
        api.data
            .ok_or_else(|| "PuppyRouter 响应缺少 data 字段".to_string())
    } else {
        Err(api
            .message
            .filter(|message| !message.trim().is_empty())
            .unwrap_or_else(|| "PuppyRouter 请求失败".to_string()))
    }
}

fn login_data_to_user(
    data: LoginData,
    fallback_username: &str,
) -> Result<PuppyRouterAccountUser, String> {
    let id = data
        .id
        .ok_or_else(|| "PuppyRouter 登录响应缺少用户 ID".to_string())?;
    Ok(PuppyRouterAccountUser {
        id,
        username: data
            .username
            .filter(|username| !username.trim().is_empty())
            .unwrap_or_else(|| fallback_username.to_string()),
        display_name: data.display_name,
        group: data.group,
        role: data.role,
        status: data.status,
    })
}

async fn auth_get<T: DeserializeOwned>(
    client: &reqwest::Client,
    session: &StoredAccountSession,
    path: &str,
) -> Result<T, String> {
    let response = account_request(client, Method::GET, path)
        .header(COOKIE, session.cookie_header.as_str())
        .header("New-Api-User", session.user.id.to_string())
        .send()
        .await
        .map_err(|e| format!("连接 PuppyRouter 失败: {e}"))?;
    let (api, _) = parse_api_response::<T>(response).await?;
    ensure_api_success(api)
}

async fn auth_post_json<B: Serialize + ?Sized, T: DeserializeOwned>(
    client: &reqwest::Client,
    session: &StoredAccountSession,
    path: &str,
    body: &B,
) -> Result<T, String> {
    let response = account_request(client, Method::POST, path)
        .header(COOKIE, session.cookie_header.as_str())
        .header("New-Api-User", session.user.id.to_string())
        .json(body)
        .send()
        .await
        .map_err(|e| format!("连接 PuppyRouter 失败: {e}"))?;
    let (api, _) = parse_api_response::<T>(response).await?;
    ensure_api_success(api)
}

async fn auth_patch_json<B: Serialize + ?Sized, T: DeserializeOwned>(
    client: &reqwest::Client,
    session: &StoredAccountSession,
    path: &str,
    body: &B,
) -> Result<T, String> {
    let response = account_request(client, Method::PATCH, path)
        .header(COOKIE, session.cookie_header.as_str())
        .header("New-Api-User", session.user.id.to_string())
        .json(body)
        .send()
        .await
        .map_err(|e| format!("连接 PuppyRouter 失败: {e}"))?;
    let (api, _) = parse_api_response::<T>(response).await?;
    ensure_api_success(api)
}

async fn fetch_all_tokens(
    client: &reqwest::Client,
    session: &StoredAccountSession,
) -> Result<(Vec<TokenItem>, i64), String> {
    let mut page = 1;
    let page_size = 100;
    let mut tokens = Vec::new();
    let mut total = 0;

    loop {
        let path = format!("/api/token/?p={page}&size={page_size}");
        let page_info: PageInfo<TokenItem> = auth_get(client, session, &path).await?;
        total = page_info.total.unwrap_or(total);

        let items = page_info.items.unwrap_or_default();
        let item_count = items.len();
        tokens.extend(items);

        if item_count < page_size as usize || (total > 0 && tokens.len() as i64 >= total) {
            break;
        }
        page += 1;
        if page > 100 {
            return Err("PuppyRouter API key 数量过多，请先在网页端整理 key 列表。".to_string());
        }
    }

    let fetched = tokens.len() as i64;
    Ok((tokens, total.max(fetched)))
}

async fn fetch_token_key(
    client: &reqwest::Client,
    session: &StoredAccountSession,
    token_id: i64,
) -> Result<String, String> {
    let data: TokenKeyData = auth_post_json(
        client,
        session,
        &format!("/api/token/{token_id}/key"),
        &serde_json::json!({}),
    )
    .await?;
    normalize_puppyrouter_api_key(&data.key)
        .ok_or_else(|| "PuppyRouter 返回了空 API key。".to_string())
}

async fn fetch_token_key_map(
    client: &reqwest::Client,
    session: &StoredAccountSession,
    token_ids: &[i64],
) -> Result<HashMap<i64, String>, String> {
    let mut result = HashMap::new();

    for chunk in token_ids.chunks(100) {
        let data: TokenKeysBatchData = auth_post_json(
            client,
            session,
            "/api/token/batch/keys",
            &serde_json::json!({ "ids": chunk }),
        )
        .await?;

        for (id, key) in data.keys {
            if let (Ok(id), Some(full_key)) =
                (id.parse::<i64>(), normalize_puppyrouter_api_key(&key))
            {
                result.insert(id, full_key);
            }
        }
    }

    Ok(result)
}

fn normalize_puppyrouter_api_key(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if value.starts_with("sk-") {
        Some(value.to_string())
    } else {
        Some(format!("sk-{value}"))
    }
}

fn display_puppyrouter_api_key(value: &str) -> String {
    normalize_puppyrouter_api_key(value).unwrap_or_default()
}

fn is_token_usable(token: &TokenItem) -> bool {
    let now = now_timestamp();
    let expired_time = token.expired_time.unwrap_or(-1);
    token.status == 1 && (expired_time <= 0 || expired_time > now)
}

fn normalize_group(group: Option<String>) -> Option<String> {
    group
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn token_to_api_key(
    token: TokenItem,
    active_token_id: Option<i64>,
    provider_api_key: Option<&str>,
    full_key: Option<&str>,
) -> PuppyRouterApiKey {
    let usable = is_token_usable(&token);
    let recommended = usable && token.name == DEFAULT_TOKEN_NAME;
    let active_by_key = provider_api_key
        .zip(full_key)
        .map(|(provider_key, token_key)| {
            normalize_puppyrouter_api_key(provider_key) == normalize_puppyrouter_api_key(token_key)
        })
        .unwrap_or(false);
    let active = active_by_key || active_token_id == Some(token.id);

    PuppyRouterApiKey {
        id: token.id,
        name: token.name,
        masked_key: display_puppyrouter_api_key(&token.key),
        status: token.status,
        remain_quota: token.remain_quota.unwrap_or_default(),
        used_quota: token.used_quota.unwrap_or_default(),
        unlimited_quota: token.unlimited_quota.unwrap_or(false),
        expired_time: token.expired_time.unwrap_or(-1),
        created_time: token.created_time.unwrap_or_default(),
        accessed_time: token.accessed_time.unwrap_or_default(),
        group: normalize_group(token.group),
        cross_group_retry: token.cross_group_retry.unwrap_or(false),
        model_limits_enabled: token.model_limits_enabled.unwrap_or(false),
        model_limits: token
            .model_limits
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        usable,
        recommended,
        provider_key_match: active_by_key,
        active,
    }
}

fn sort_api_keys(keys: &mut [PuppyRouterApiKey]) {
    keys.sort_by(|a, b| {
        b.active
            .cmp(&a.active)
            .then_with(|| b.recommended.cmp(&a.recommended))
            .then_with(|| b.usable.cmp(&a.usable))
            .then_with(|| b.created_time.cmp(&a.created_time))
            .then_with(|| b.id.cmp(&a.id))
    });
}

fn parse_target_app(target_app: Option<String>) -> Result<AppType, String> {
    let raw = target_app
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少要应用 API key 的目标客户端。".to_string())?;
    AppType::from_str(&raw).map_err(|e| e.to_string())
}

fn is_auto_apply_app(app_type: &AppType) -> bool {
    matches!(
        app_type,
        AppType::Claude
            | AppType::ClaudeDesktop
            | AppType::Codex
            | AppType::Gemini
            | AppType::GrokBuild
            | AppType::OpenCode
    )
}

fn puppyrouter_provider_id_for_app(app_type: &AppType) -> Option<&'static str> {
    match app_type {
        AppType::Claude => Some("universal-claude-puppyrouter"),
        AppType::ClaudeDesktop => Some("universal-claude-desktop-puppyrouter"),
        AppType::Codex => Some("universal-codex-puppyrouter"),
        AppType::Gemini => Some("universal-gemini-puppyrouter"),
        AppType::GrokBuild => Some("universal-grokbuild-puppyrouter"),
        AppType::OpenCode => Some(PUPPYROUTER_UNIVERSAL_ID),
        AppType::OpenClaw | AppType::Hermes => None,
    }
}

fn selected_tokens_by_app(
    state: &AppState,
) -> Result<HashMap<String, StoredSelectedToken>, String> {
    Ok(
        setting_json::<HashMap<String, StoredSelectedToken>>(state, SELECTED_TOKEN_BY_APP_SETTING)?
            .unwrap_or_default(),
    )
}

fn selected_token_for_app(
    state: &AppState,
    app_type: &AppType,
) -> Result<Option<StoredSelectedToken>, String> {
    let selected_by_app = selected_tokens_by_app(state)?;
    if !selected_by_app.is_empty() {
        return Ok(selected_by_app.get(app_type.as_str()).cloned());
    }

    // Backward compatibility for users who selected a global key before
    // per-client key application existed.
    setting_json(state, SELECTED_TOKEN_SETTING)
}

fn set_selected_token_for_app(
    state: &AppState,
    app_type: &AppType,
    selected: StoredSelectedToken,
) -> Result<(), String> {
    let mut selected_by_app = selected_tokens_by_app(state)?;
    selected_by_app.insert(app_type.as_str().to_string(), selected);
    set_setting_json(state, SELECTED_TOKEN_BY_APP_SETTING, &selected_by_app)
}

fn merge_json(base: &mut serde_json::Value, patch: &serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(base_map), serde_json::Value::Object(patch_map)) => {
            for (key, patch_value) in patch_map {
                match base_map.get_mut(key) {
                    Some(base_value) => merge_json(base_value, patch_value),
                    None => {
                        base_map.insert(key.clone(), patch_value.clone());
                    }
                }
            }
        }
        (base_value, patch_value) => {
            *base_value = patch_value.clone();
        }
    }
}

fn codex_config_text(settings: &Value) -> Option<&str> {
    settings.get("config").and_then(|value| value.as_str())
}

fn codex_model_from_config(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<toml::Value>().ok()?;
    doc.get("model")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(ToString::to_string)
}

fn normalize_catalog_model_id(model_id: &str) -> Option<String> {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn is_codex_catalog_model_id(model_id: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    if normalized.contains("claude") || normalized.contains("anthropic") {
        return false;
    }

    let leaf = normalized.rsplit('/').next().unwrap_or(&normalized);
    leaf.starts_with("gpt")
        || leaf.starts_with("chatgpt")
        || leaf.starts_with("codex")
        || leaf.starts_with("o1")
        || leaf.starts_with("o3")
        || leaf.starts_with("o4")
        || leaf.starts_with("o5")
        || leaf.contains("-codex")
}

fn fetched_models_to_codex_catalog(
    fetched_models: &[FetchedModel],
    preferred_model: Option<&str>,
) -> Option<Value> {
    let mut seen = std::collections::HashSet::new();
    let mut ids = Vec::new();

    for model in fetched_models {
        let Some(id) = normalize_catalog_model_id(&model.id) else {
            continue;
        };
        if !is_codex_catalog_model_id(&id) {
            continue;
        }
        if seen.insert(id.clone()) {
            ids.push(id);
        }
        if ids.len() >= CODEX_MODEL_CATALOG_LIMIT {
            break;
        }
    }

    if ids.is_empty() {
        return None;
    }

    let preferred = preferred_model
        .and_then(normalize_catalog_model_id)
        .filter(|preferred| ids.iter().any(|id| id == preferred));
    if let Some(preferred) = preferred {
        ids.retain(|id| id != &preferred);
        ids.insert(0, preferred);
    }

    let models = ids
        .into_iter()
        .map(|id| {
            json!({
                "model": id,
                "displayName": id,
            })
        })
        .collect::<Vec<_>>();

    Some(json!({ "models": models }))
}

async fn refresh_codex_model_catalog_from_puppyrouter(
    provider: &mut Provider,
    api_key: &str,
) -> Result<(), String> {
    let config_text = codex_config_text(&provider.settings_config).unwrap_or_default();
    let base_url = crate::codex_config::extract_codex_base_url(config_text)
        .unwrap_or_else(|| format!("{PUPPYROUTER_BASE_URL}/v1"));
    let preferred_model = codex_model_from_config(config_text);

    let fetched_models =
        crate::services::model_fetch::fetch_models(&base_url, api_key, false, None, None).await?;
    let Some(model_catalog) =
        fetched_models_to_codex_catalog(&fetched_models, preferred_model.as_deref())
    else {
        return Ok(());
    };

    let first_model = model_catalog
        .get("models")
        .and_then(|models| models.as_array())
        .and_then(|models| models.first())
        .and_then(|model| model.get("model"))
        .and_then(|model| model.as_str())
        .map(ToString::to_string);

    if let Some(settings) = provider.settings_config.as_object_mut() {
        settings.insert("modelCatalog".to_string(), model_catalog);
        if preferred_model.is_none() {
            if let (Some(first_model), Some(config)) = (
                first_model,
                settings.get("config").and_then(|value| value.as_str()),
            ) {
                if let Ok(updated_config) =
                    crate::codex_config::update_codex_toml_field(config, "model", &first_model)
                {
                    settings.insert("config".to_string(), Value::String(updated_config));
                }
            }
        }
    }

    Ok(())
}

fn puppyrouter_provider_for_app(
    state: &AppState,
    app_type: &AppType,
    api_key: &str,
) -> Result<Provider, String> {
    if matches!(app_type, AppType::OpenCode) {
        return Ok(puppyrouter_opencode_provider(api_key));
    }
    if matches!(app_type, AppType::GrokBuild) {
        let existing = state
            .db
            .get_provider_by_id("universal-grokbuild-puppyrouter", app_type.as_str())
            .map_err(|error| error.to_string())?;
        return Ok(ProviderService::puppyrouter_grokbuild_provider(
            api_key,
            existing.as_ref(),
        ));
    }

    let mut universal = ProviderService::get_universal(state, PUPPYROUTER_UNIVERSAL_ID)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "PuppyRouter universal provider 不存在。".to_string())?;
    universal.api_key = api_key.to_string();

    match app_type {
        AppType::Claude => universal
            .to_claude_provider()
            .ok_or_else(|| "PuppyRouter 未启用 Claude Code 配置。".to_string()),
        AppType::ClaudeDesktop => {
            let mut provider = universal
                .to_claude_provider()
                .ok_or_else(|| "PuppyRouter 未启用 Claude Desktop 配置。".to_string())?;
            provider.id = "universal-claude-desktop-puppyrouter".to_string();
            provider.name = "PuppyRouter".to_string();
            provider.website_url = Some(PUPPYROUTER_BASE_URL.to_string());
            provider.category = Some("aggregator".to_string());
            provider.sort_index = Some(0);
            let meta = provider.meta.get_or_insert_with(ProviderMeta::default);
            meta.claude_desktop_mode
                .get_or_insert(ClaudeDesktopMode::Direct);
            Ok(provider)
        }
        AppType::Codex => universal
            .to_codex_provider()
            .ok_or_else(|| "PuppyRouter 未启用 Codex 配置。".to_string()),
        AppType::Gemini => universal
            .to_gemini_provider()
            .ok_or_else(|| "PuppyRouter 未启用 Gemini 配置。".to_string()),
        AppType::GrokBuild => unreachable!("handled before universal provider lookup"),
        AppType::OpenCode => unreachable!("OpenCode handled above"),
        AppType::OpenClaw | AppType::Hermes => {
            Err("该客户端需要手动配置供应商，不能自动应用 PuppyRouter API key。".to_string())
        }
    }
}

async fn save_puppyrouter_provider_for_app(
    state: &AppState,
    app_type: &AppType,
    api_key: &str,
) -> Result<(), String> {
    if !is_auto_apply_app(app_type) {
        return Err("该客户端需要手动配置供应商，不能自动应用 PuppyRouter API key。".to_string());
    }

    let mut provider = puppyrouter_provider_for_app(state, app_type, api_key)?;
    if let Some(existing) = state
        .db
        .get_provider_by_id(&provider.id, app_type.as_str())
        .map_err(|e| e.to_string())?
    {
        let mut merged_settings = existing.settings_config.clone();
        merge_json(&mut merged_settings, &provider.settings_config);
        provider.settings_config = merged_settings;
        provider.created_at = existing.created_at.or(provider.created_at);
        provider.notes = existing.notes.or(provider.notes);
        provider.meta = existing.meta.or(provider.meta);
        provider.in_failover_queue = existing.in_failover_queue;
    }

    if matches!(app_type, AppType::OpenCode) {
        provider
            .meta
            .get_or_insert_with(ProviderMeta::default)
            .live_config_managed = Some(false);
    }
    if matches!(app_type, AppType::GrokBuild) {
        provider
            .meta
            .get_or_insert_with(ProviderMeta::default)
            .provider_type = Some("puppyrouter".to_string());
    }

    if matches!(app_type, AppType::Codex) {
        if let Err(err) = refresh_codex_model_catalog_from_puppyrouter(&mut provider, api_key).await
        {
            log::warn!(
                "Failed to refresh PuppyRouter Codex model catalog during API key apply: {err}"
            );
        }
    }

    state
        .db
        .save_provider(app_type.as_str(), &provider)
        .map_err(|e| e.to_string())
}

fn puppyrouter_provider_api_key_for_app(
    state: &AppState,
    app_type: &AppType,
) -> Result<Option<String>, String> {
    let Some(provider_id) = puppyrouter_provider_id_for_app(app_type) else {
        return Ok(None);
    };
    let Some(provider) = state
        .db
        .get_provider_by_id(provider_id, app_type.as_str())
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    let (_, api_key) = provider.resolve_usage_credentials(app_type);
    Ok((!api_key.trim().is_empty()).then_some(api_key))
}

fn emit_universal_provider_synced(app: &AppHandle, target_app: &AppType) {
    let _ = app.emit(
        "universal-provider-synced",
        serde_json::json!({
            "action": "sync",
            "id": PUPPYROUTER_UNIVERSAL_ID,
            // Applying a cloud key updates the local PuppyRouter provider only.
            // The actual client config is written later by an explicit Enable.
            "localOnly": true,
            "appType": target_app.as_str(),
        }),
    );
}

fn puppyrouter_opencode_provider(api_key: &str) -> Provider {
    Provider {
        id: PUPPYROUTER_UNIVERSAL_ID.to_string(),
        name: "PuppyRouter".to_string(),
        settings_config: json!({
            "npm": "@ai-sdk/openai-compatible",
            "name": "PuppyRouter",
            "options": {
                "baseURL": format!("{PUPPYROUTER_BASE_URL}/v1"),
                "apiKey": api_key,
            },
            "models": {
                "gpt-5.5": {
                    "name": "GPT-5.5",
                    "limit": {
                        "context": 400000,
                        "output": 128000
                    }
                },
                "claude-sonnet-4-6": {
                    "name": "Claude Sonnet 4.6",
                    "limit": {
                        "context": 1000000,
                        "output": 64000
                    }
                },
                "gemini-3.5-flash": {
                    "name": "Gemini 3.5 Flash",
                    "limit": {
                        "context": 1048576,
                        "output": 65536
                    }
                }
            }
        }),
        website_url: Some(PUPPYROUTER_BASE_URL.to_string()),
        category: Some("aggregator".to_string()),
        created_at: Some(chrono::Utc::now().timestamp_millis()),
        sort_index: Some(0),
        notes: None,
        meta: Some(ProviderMeta {
            live_config_managed: Some(false),
            provider_type: Some("puppyrouter".to_string()),
            ..ProviderMeta::default()
        }),
        icon: Some("openai".to_string()),
        icon_color: Some("#F59E0B".to_string()),
        in_failover_queue: false,
    }
}

#[tauri::command]
pub fn get_puppyrouter_account_status(
    state: State<'_, AppState>,
) -> Result<PuppyRouterAccountStatus, String> {
    Ok(account_status_from_session(read_session(state.inner())?))
}

#[tauri::command]
pub async fn get_puppyrouter_account_balance(
    state: State<'_, AppState>,
) -> Result<PuppyRouterAccountBalance, String> {
    let session =
        read_session(state.inner())?.ok_or_else(|| "请先登录 PuppyRouter 账号。".to_string())?;
    let client = http_client();
    let data: SelfData = auth_get(&client, &session, "/api/user/self").await?;
    let status: StatusData = auth_get(&client, &session, "/api/status").await?;
    let quota = data.quota.unwrap_or_default();
    let used_quota = data.used_quota.unwrap_or_default();
    let quota_per_unit = normalize_quota_per_unit(status.quota_per_unit);
    let usd_exchange_rate = normalize_usd_exchange_rate(status.usd_exchange_rate);
    let balance_usd = quota as f64 / quota_per_unit as f64;

    Ok(PuppyRouterAccountBalance {
        quota,
        used_quota,
        quota_per_unit,
        balance_usd,
        usd_exchange_rate,
        formatted_balance: format_usd_balance(balance_usd),
        updated_at: now_timestamp(),
    })
}

#[tauri::command]
pub async fn begin_puppyrouter_account_login() -> Result<PuppyRouterLoginStart, String> {
    let client = http_client();
    let response = account_request(&client, Method::POST, "/api/desktop-auth/start")
        .json(&serde_json::json!({
            "client_name": "puppyrouter app",
        }))
        .send()
        .await
        .map_err(|e| format!("连接 PuppyRouter 失败: {e}"))?;

    let (api, _) = parse_api_response::<DesktopAuthStartData>(response).await?;
    let data = ensure_api_success(api)?;
    Ok(PuppyRouterLoginStart {
        device_code: data.device_code,
        user_code: data.user_code,
        authorize_url: data.authorize_url,
        expires_at: data.expires_at,
        interval: data.interval.unwrap_or(2).max(1),
    })
}

#[tauri::command]
pub async fn poll_puppyrouter_account_login(
    state: State<'_, AppState>,
    device_code: String,
) -> Result<PuppyRouterLoginPollResult, String> {
    let device_code = device_code.trim().to_string();
    if device_code.is_empty() {
        return Err("PuppyRouter 浏览器授权会话缺少 device code。".to_string());
    }

    let client = http_client();
    let response = account_request(&client, Method::POST, "/api/desktop-auth/poll")
        .json(&serde_json::json!({ "device_code": device_code }))
        .send()
        .await
        .map_err(|e| format!("连接 PuppyRouter 失败: {e}"))?;

    let (api, cookie_header) = parse_api_response::<DesktopAuthPollData>(response).await?;
    let data = ensure_api_success(api)?;
    let message = data.message.unwrap_or_default();
    let interval = data.interval.unwrap_or(2).max(1);

    match data.status.as_str() {
        "pending" => Ok(PuppyRouterLoginPollResult::Pending { message, interval }),
        "approved" => {
            if cookie_header.is_empty() {
                return Err("PuppyRouter 授权成功，但响应没有返回会话 cookie。".to_string());
            }
            let user = login_data_to_user(
                data.user
                    .ok_or_else(|| "PuppyRouter 授权响应缺少用户信息。".to_string())?,
                "PuppyRouter",
            )?;
            let session = StoredAccountSession {
                user,
                cookie_header,
                logged_in_at: now_timestamp(),
            };
            set_setting_json(state.inner(), ACCOUNT_SESSION_SETTING, &session)?;
            clear_setting(state.inner(), LEGACY_ACCOUNT_PENDING_SESSION_SETTING)?;
            Ok(PuppyRouterLoginPollResult::Approved {
                account: account_status_from_session(Some(session)),
            })
        }
        "expired" => Ok(PuppyRouterLoginPollResult::Expired { message }),
        "denied" => Ok(PuppyRouterLoginPollResult::Denied { message }),
        "invalid" => Ok(PuppyRouterLoginPollResult::Invalid { message }),
        other => Err(format!("未知的 PuppyRouter 浏览器授权状态: {other}")),
    }
}

#[tauri::command]
pub fn logout_puppyrouter_account(state: State<'_, AppState>) -> Result<bool, String> {
    clear_setting(state.inner(), ACCOUNT_SESSION_SETTING)?;
    clear_setting(state.inner(), LEGACY_ACCOUNT_PENDING_SESSION_SETTING)?;
    clear_setting(state.inner(), SELECTED_TOKEN_SETTING)?;
    clear_setting(state.inner(), SELECTED_TOKEN_BY_APP_SETTING)?;
    Ok(true)
}

#[tauri::command]
pub async fn list_puppyrouter_api_keys(
    state: State<'_, AppState>,
    target_app: Option<String>,
) -> Result<PuppyRouterApiKeyList, String> {
    let target_app = parse_target_app(target_app)?;
    let session =
        read_session(state.inner())?.ok_or_else(|| "请先登录 PuppyRouter 账号。".to_string())?;
    let client = http_client();
    let (tokens, total) = fetch_all_tokens(&client, &session).await?;

    let selected = selected_token_for_app(state.inner(), &target_app)?;
    let provider_api_key = puppyrouter_provider_api_key_for_app(state.inner(), &target_app)?;
    let token_ids: Vec<i64> = tokens.iter().map(|token| token.id).collect();
    let full_key_map = if provider_api_key
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        fetch_token_key_map(&client, &session, &token_ids)
            .await
            .unwrap_or_default()
    } else {
        HashMap::new()
    };

    let selected_token_id = selected.map(|token| token.token_id);
    let mut keys: Vec<PuppyRouterApiKey> = tokens
        .into_iter()
        .map(|token| {
            let full_key = full_key_map.get(&token.id).map(String::as_str);
            token_to_api_key(
                token,
                selected_token_id,
                provider_api_key.as_deref(),
                full_key,
            )
        })
        .collect();

    sort_api_keys(&mut keys);
    Ok(PuppyRouterApiKeyList {
        keys,
        total,
        selected_token_id,
    })
}

#[tauri::command]
pub async fn list_puppyrouter_account_groups(
    state: State<'_, AppState>,
) -> Result<Vec<PuppyRouterAccountGroup>, String> {
    let session =
        read_session(state.inner())?.ok_or_else(|| "请先登录 PuppyRouter 账号。".to_string())?;
    let client = http_client();
    let groups: HashMap<String, AccountGroupData> =
        auth_get(&client, &session, "/api/user/self/groups").await?;
    let mut groups = groups
        .into_iter()
        .map(|(name, data)| PuppyRouterAccountGroup {
            name,
            description: data.desc,
            ratio: data.ratio,
        })
        .collect::<Vec<_>>();
    groups.sort_by(|a, b| {
        let a_auto = a.name == "auto";
        let b_auto = b.name == "auto";
        b_auto
            .cmp(&a_auto)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(groups)
}

#[tauri::command]
pub async fn update_puppyrouter_api_key_group(
    state: State<'_, AppState>,
    token_id: i64,
    group: String,
) -> Result<PuppyRouterGroupUpdateResult, String> {
    let group = group.trim().to_string();
    if group.is_empty() {
        return Err("API key 分组不能为空。".to_string());
    }
    let session =
        read_session(state.inner())?.ok_or_else(|| "请先登录 PuppyRouter 账号。".to_string())?;
    let client = http_client();
    let token: TokenItem = auth_patch_json(
        &client,
        &session,
        &format!("/api/token/{token_id}/group"),
        &json!({ "group": group }),
    )
    .await?;
    let group = normalize_group(token.group)
        .ok_or_else(|| "PuppyRouter 返回了空的 API key 分组。".to_string())?;
    Ok(PuppyRouterGroupUpdateResult {
        token_id: token.id,
        group,
        cross_group_retry: token.cross_group_retry.unwrap_or(false),
    })
}

#[tauri::command]
pub async fn apply_puppyrouter_api_key(
    app: AppHandle,
    state: State<'_, AppState>,
    token_id: i64,
    target_app: Option<String>,
) -> Result<PuppyRouterApplyKeyResult, String> {
    let target_app = parse_target_app(target_app)?;
    if !is_auto_apply_app(&target_app) {
        return Err("该客户端需要手动配置供应商，不能自动应用 PuppyRouter API key。".to_string());
    }

    let session =
        read_session(state.inner())?.ok_or_else(|| "请先登录 PuppyRouter 账号。".to_string())?;
    let client = http_client();
    let (tokens, _) = fetch_all_tokens(&client, &session).await?;
    let token = tokens
        .into_iter()
        .find(|token| token.id == token_id)
        .ok_or_else(|| "找不到指定的 PuppyRouter API key。".to_string())?;

    if !is_token_usable(&token) {
        return Err("这个 PuppyRouter API key 当前不可用。".to_string());
    }

    let full_key = fetch_token_key(&client, &session, token_id).await?;
    save_puppyrouter_provider_for_app(state.inner(), &target_app, &full_key).await?;

    let group = normalize_group(token.group.clone());
    let selected = StoredSelectedToken {
        token_id,
        name: token.name.clone(),
        masked_key: display_puppyrouter_api_key(&token.key),
        group: group.clone(),
        applied_at: now_timestamp(),
    };
    set_selected_token_for_app(state.inner(), &target_app, selected)?;
    emit_universal_provider_synced(&app, &target_app);

    Ok(PuppyRouterApplyKeyResult {
        synced: true,
        token_id,
        name: token.name,
        masked_key: display_puppyrouter_api_key(&token.key),
        group,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use std::ffi::OsString;
    use std::sync::Arc;
    use tempfile::TempDir;

    struct TestHomeGuard {
        _dir: TempDir,
        original_home: Option<OsString>,
        original_test_home: Option<OsString>,
    }

    impl TestHomeGuard {
        fn new() -> Self {
            let dir = TempDir::new().expect("create temporary home");
            let original_home = std::env::var_os("HOME");
            let original_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
            std::env::set_var("HOME", dir.path());
            std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
            crate::settings::reload_settings().expect("reload isolated settings");

            Self {
                _dir: dir,
                original_home,
                original_test_home,
            }
        }
    }

    impl Drop for TestHomeGuard {
        fn drop(&mut self) {
            match self.original_home.take() {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            match self.original_test_home.take() {
                Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            }
            let _ = crate::settings::reload_settings();
        }
    }

    #[test]
    fn normalize_puppyrouter_api_key_adds_sk_prefix_once() {
        assert_eq!(
            normalize_puppyrouter_api_key("raw-token").as_deref(),
            Some("sk-raw-token")
        );
        assert_eq!(
            normalize_puppyrouter_api_key(" sk-existing ").as_deref(),
            Some("sk-existing")
        );
        assert_eq!(normalize_puppyrouter_api_key("   "), None);
    }

    #[test]
    fn display_puppyrouter_api_key_matches_full_key_shape() {
        assert_eq!(
            display_puppyrouter_api_key("abcd********wxyz"),
            "sk-abcd********wxyz"
        );
        assert_eq!(
            display_puppyrouter_api_key("sk-abcd********wxyz"),
            "sk-abcd********wxyz"
        );
        assert_eq!(display_puppyrouter_api_key("   "), "");
    }

    #[test]
    fn every_auto_apply_app_has_a_locked_puppyrouter_provider() {
        for app_type in [
            AppType::Claude,
            AppType::ClaudeDesktop,
            AppType::Codex,
            AppType::Gemini,
            AppType::GrokBuild,
            AppType::OpenCode,
        ] {
            assert!(is_auto_apply_app(&app_type));
            assert!(
                puppyrouter_provider_id_for_app(&app_type).is_some(),
                "{} must resolve to a local PuppyRouter provider before applying a cloud key",
                app_type.as_str()
            );
        }

        for app_type in [AppType::OpenClaw, AppType::Hermes] {
            assert!(!is_auto_apply_app(&app_type));
            assert!(puppyrouter_provider_id_for_app(&app_type).is_none());
        }
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn grokbuild_cloud_key_flows_one_way_until_explicit_enable() {
        let _home = TestHomeGuard::new();
        let state = AppState::new(Arc::new(Database::memory().expect("create database")));
        ProviderService::ensure_locked_puppyrouter_defaults(&state)
            .expect("seed locked Grok Build providers");

        let official_snapshot = "[settings]\ntheme = \"dark\"\n";
        crate::grok_config::write_grok_live_settings(&json!({
            "config": official_snapshot,
        }))
        .expect("seed official Grok Build live config");

        save_puppyrouter_provider_for_app(&state, &AppType::GrokBuild, "sk-cloud-selected")
            .await
            .expect("stage cloud key in local PuppyRouter provider");

        assert_eq!(
            crate::grok_config::read_grok_live_settings().expect("read unchanged live config")
                ["config"],
            official_snapshot,
            "applying a cloud key must not enable or rewrite Grok Build"
        );

        let staged = state
            .db
            .get_provider_by_id(
                "universal-grokbuild-puppyrouter",
                AppType::GrokBuild.as_str(),
            )
            .expect("read staged provider")
            .expect("staged PuppyRouter provider");
        assert_eq!(
            staged.resolve_usage_credentials(&AppType::GrokBuild).1,
            "sk-cloud-selected"
        );

        ProviderService::switch(
            &state,
            AppType::GrokBuild,
            "universal-grokbuild-puppyrouter",
        )
        .expect("explicitly enable PuppyRouter");
        let enabled =
            crate::grok_config::read_grok_live_settings().expect("read enabled Grok Build config");
        assert_eq!(
            crate::grok_config::extract_credentials(
                enabled["config"].as_str().expect("enabled config text")
            )
            .map(|(_, key)| key)
            .as_deref(),
            Some("sk-cloud-selected")
        );

        crate::grok_config::write_grok_live_settings(&json!({
            "config": crate::grok_config::build_puppyrouter_config(
                enabled["config"].as_str(),
                "sk-wrong-live",
            ),
        }))
        .expect("simulate an externally modified live key");

        ProviderService::switch(
            &state,
            AppType::GrokBuild,
            crate::database::GROKBUILD_OFFICIAL_PROVIDER_ID,
        )
        .expect("switch to Grok Official");
        ProviderService::switch(
            &state,
            AppType::GrokBuild,
            "universal-grokbuild-puppyrouter",
        )
        .expect("switch back to PuppyRouter");

        let saved = state
            .db
            .get_provider_by_id(
                "universal-grokbuild-puppyrouter",
                AppType::GrokBuild.as_str(),
            )
            .expect("read preserved provider")
            .expect("preserved PuppyRouter provider");
        assert_eq!(
            saved.resolve_usage_credentials(&AppType::GrokBuild).1,
            "sk-cloud-selected",
            "live config must never flow back into the locked PuppyRouter provider"
        );

        let restored = crate::grok_config::read_grok_live_settings()
            .expect("read restored PuppyRouter live config");
        assert_eq!(
            crate::grok_config::extract_credentials(
                restored["config"].as_str().expect("restored config text")
            )
            .map(|(_, key)| key)
            .as_deref(),
            Some("sk-cloud-selected")
        );
    }

    #[test]
    fn fetched_models_to_codex_catalog_dedupes_and_keeps_preferred_first() {
        let models = vec![
            FetchedModel {
                id: "gpt-5.6-luna".to_string(),
                owned_by: None,
            },
            FetchedModel {
                id: "gpt-5.6-sol".to_string(),
                owned_by: None,
            },
            FetchedModel {
                id: "gpt-5.6-luna".to_string(),
                owned_by: None,
            },
            FetchedModel {
                id: "claude-sonnet-4-5".to_string(),
                owned_by: None,
            },
        ];

        let catalog = fetched_models_to_codex_catalog(&models, Some("gpt-5.6-sol"))
            .expect("non-empty models should produce catalog");
        let ids = catalog["models"]
            .as_array()
            .expect("catalog models should be an array")
            .iter()
            .map(|model| {
                model["model"]
                    .as_str()
                    .expect("catalog model id should be a string")
            })
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["gpt-5.6-sol", "gpt-5.6-luna"]);
    }

    #[test]
    fn fetched_models_to_codex_catalog_ignores_blank_ids() {
        let models = vec![FetchedModel {
            id: "   ".to_string(),
            owned_by: None,
        }];

        assert!(fetched_models_to_codex_catalog(&models, None).is_none());
    }

    #[test]
    fn fetched_models_to_codex_catalog_ignores_claude_family_models() {
        let models = vec![
            FetchedModel {
                id: "anthropic/claude-opus-4-1".to_string(),
                owned_by: None,
            },
            FetchedModel {
                id: "claude-sonnet-4-5".to_string(),
                owned_by: None,
            },
        ];

        assert!(fetched_models_to_codex_catalog(&models, None).is_none());
    }
}
