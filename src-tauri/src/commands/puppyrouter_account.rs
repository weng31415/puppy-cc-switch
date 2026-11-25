use std::collections::HashMap;
use std::str::FromStr;
use std::time::Duration;

use reqwest::header::{COOKIE, SET_COOKIE};
use reqwest::{Method, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::app_config::AppType;
use crate::provider::Provider;
use crate::services::model_fetch::FetchedModel;
use crate::services::provider::puppyrouter;
use crate::services::ProviderService;
use crate::store::AppState;
use crate::sync_utils::MutexExt;

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
const SESSION_EXPIRED_ERROR: &str = "PUPPYROUTER_SESSION_EXPIRED";

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
    pub session_state: PuppyRouterSessionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<PuppyRouterAccountUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logged_in_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PuppyRouterSessionState {
    SignedOut,
    Authenticated,
    Offline,
    Expired,
    ServerError,
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
    pub provider_key_match: Option<bool>,
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

// A delayed 401 can arrive after a new login. Compare and clear under one database lock.
fn clear_account_auth_state(
    state: &AppState,
    expected: Option<&StoredAccountSession>,
) -> Result<bool, crate::error::AppError> {
    let mut conn = crate::database::lock_conn!(state.db.conn);
    let tx = conn.transaction()?;
    if let Some(expected) = expected {
        let matches: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM settings WHERE key = ?1
              AND json_extract(NULLIF(value, ''), '$.cookieHeader') = ?2
              AND json_extract(NULLIF(value, ''), '$.loggedInAt') = ?3)",
            rusqlite::params![
                ACCOUNT_SESSION_SETTING,
                expected.cookie_header,
                expected.logged_in_at
            ],
            |row| row.get(0),
        )?;
        if !matches {
            return Ok(false);
        }
    }
    tx.execute(
        "UPDATE settings SET value = '' WHERE key IN (?1, ?2, ?3, ?4)",
        [
            ACCOUNT_SESSION_SETTING,
            LEGACY_ACCOUNT_PENDING_SESSION_SETTING,
            SELECTED_TOKEN_SETTING,
            SELECTED_TOKEN_BY_APP_SETTING,
        ],
    )?;
    tx.commit()?;
    Ok(true)
}

fn read_session(state: &AppState) -> Result<Option<StoredAccountSession>, String> {
    setting_json(state, ACCOUNT_SESSION_SETTING)
}

fn account_status_from_session(session: Option<StoredAccountSession>) -> PuppyRouterAccountStatus {
    match session {
        Some(session) => PuppyRouterAccountStatus {
            logged_in: true,
            session_state: PuppyRouterSessionState::Authenticated,
            user: Some(session.user),
            logged_in_at: Some(session.logged_in_at),
            verified_at: Some(now_timestamp()),
            message: None,
        },
        None => PuppyRouterAccountStatus {
            logged_in: false,
            session_state: PuppyRouterSessionState::SignedOut,
            user: None,
            logged_in_at: None,
            verified_at: None,
            message: None,
        },
    }
}

fn account_status_with_state(
    session: StoredAccountSession,
    session_state: PuppyRouterSessionState,
    message: Option<String>,
) -> PuppyRouterAccountStatus {
    PuppyRouterAccountStatus {
        logged_in: true,
        session_state,
        user: Some(session.user),
        logged_in_at: Some(session.logged_in_at),
        verified_at: None,
        message,
    }
}

fn expired_account_status() -> PuppyRouterAccountStatus {
    PuppyRouterAccountStatus {
        logged_in: false,
        session_state: PuppyRouterSessionState::Expired,
        user: None,
        logged_in_at: None,
        verified_at: None,
        message: None,
    }
}

fn desktop_session_cookie(headers: &reqwest::header::HeaderMap) -> String {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|header| header.to_str().ok())
        .filter_map(|header| header.split(';').next()?.trim().split_once('='))
        .rfind(|(name, _)| *name == "session")
        .filter(|(_, value)| !value.trim().is_empty())
        .map(|(_, value)| format!("session={value}"))
        .unwrap_or_default()
}

async fn parse_api_response<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<(ApiResponse<T>, String), String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("PuppyRouter HTTP {status}"));
    }
    let set_cookie_header = desktop_session_cookie(response.headers());
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取 PuppyRouter 响应失败: {e}"))?;

    let api = serde_json::from_str::<ApiResponse<T>>(&text)
        .map_err(|e| format!("解析 PuppyRouter 响应失败: {e}"))?;
    Ok((api, set_cookie_header))
}

async fn parse_authenticated_api_response<T: DeserializeOwned>(
    state: &AppState,
    session: &StoredAccountSession,
    response: reqwest::Response,
) -> Result<(ApiResponse<T>, String), String> {
    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(if clear_account_auth_state(state, Some(session))? {
            SESSION_EXPIRED_ERROR.to_string()
        } else {
            "PuppyRouter 账号已切换。".to_string()
        });
    }
    parse_api_response(response).await
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
    state: &AppState,
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
    let (api, _) = parse_authenticated_api_response::<T>(state, session, response).await?;
    ensure_api_success(api)
}

async fn auth_post_json<B: Serialize + ?Sized, T: DeserializeOwned>(
    state: &AppState,
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
    let (api, _) = parse_authenticated_api_response::<T>(state, session, response).await?;
    ensure_api_success(api)
}

async fn auth_patch_json<B: Serialize + ?Sized, T: DeserializeOwned>(
    state: &AppState,
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
    let (api, _) = parse_authenticated_api_response::<T>(state, session, response).await?;
    ensure_api_success(api)
}

async fn fetch_all_tokens(
    state: &AppState,
    client: &reqwest::Client,
    session: &StoredAccountSession,
) -> Result<(Vec<TokenItem>, i64), String> {
    let mut page = 1;
    let page_size = 100;
    let mut tokens = Vec::new();
    let mut total = 0;

    loop {
        let path = format!("/api/token/?p={page}&size={page_size}");
        let page_info: PageInfo<TokenItem> = auth_get(state, client, session, &path).await?;
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
    state: &AppState,
    client: &reqwest::Client,
    session: &StoredAccountSession,
    token_id: i64,
) -> Result<String, String> {
    let data: TokenKeyData = auth_post_json(
        state,
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
    state: &AppState,
    client: &reqwest::Client,
    session: &StoredAccountSession,
    token_ids: &[i64],
) -> Result<HashMap<i64, String>, String> {
    let mut result = HashMap::new();

    for chunk in token_ids.chunks(100) {
        let data: TokenKeysBatchData = auth_post_json(
            state,
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
    // A batch lookup can fail or omit a key. Absence of evidence is distinct
    // from a successful comparison with a different credential.
    let provider_key_match = match provider_api_key {
        None => Some(false),
        Some(saved) => full_key
            .map(|key| normalize_puppyrouter_api_key(saved) == normalize_puppyrouter_api_key(key)),
    };
    let active = provider_key_match == Some(true) || active_token_id == Some(token.id);

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
        provider_key_match,
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

fn selected_tokens_by_app(
    state: &AppState,
) -> Result<HashMap<String, StoredSelectedToken>, String> {
    Ok(
        setting_json::<HashMap<String, StoredSelectedToken>>(state, SELECTED_TOKEN_BY_APP_SETTING)?
            .unwrap_or_default(),
    )
}

const LEGACY_CLOUD_APPS: [AppType; 6] = [
    AppType::Claude,
    AppType::ClaudeDesktop,
    AppType::Codex,
    AppType::Gemini,
    AppType::GrokBuild,
    AppType::OpenCode,
];

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
    if LEGACY_CLOUD_APPS.contains(app_type) {
        setting_json(state, SELECTED_TOKEN_SETTING)
    } else {
        Ok(None)
    }
}

fn set_selected_token_for_app(
    state: &AppState,
    app_type: &AppType,
    selected: StoredSelectedToken,
) -> Result<(), String> {
    let mut selected_by_app = selected_tokens_by_app(state)?;
    if selected_by_app.is_empty() {
        if let Some(old) = setting_json::<StoredSelectedToken>(state, SELECTED_TOKEN_SETTING)? {
            for legacy_app in LEGACY_CLOUD_APPS {
                selected_by_app.insert(legacy_app.as_str().into(), old.clone());
            }
        }
    }
    selected_by_app.insert(app_type.as_str().to_string(), selected);
    set_setting_json(state, SELECTED_TOKEN_BY_APP_SETTING, &selected_by_app)
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

fn update_codex_model(config: &str, model: &str) -> Result<String, String> {
    let mut doc = config
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| e.to_string())?;
    doc["model"] = toml_edit::value(model);
    Ok(doc.to_string())
}

async fn refresh_codex_model_catalog_from_puppyrouter(
    provider: &mut Provider,
    api_key: &str,
) -> Result<(), String> {
    let config_text = codex_config_text(&provider.settings_config).unwrap_or_default();
    let base_url = format!("{PUPPYROUTER_BASE_URL}/v1");
    let preferred_model = codex_model_from_config(config_text);

    let fetched_models = crate::services::model_fetch::fetch_models(
        &base_url, api_key, false, None, None, None, None,
    )
    .await?;
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
                if let Ok(updated_config) = update_codex_model(config, &first_model) {
                    settings.insert("config".to_string(), Value::String(updated_config));
                }
            }
        }
    }

    Ok(())
}

async fn save_puppyrouter_provider_for_app(
    state: &AppState,
    app_type: &AppType,
    api_key: &str,
) -> Result<(), String> {
    let existing = state
        .db
        .get_provider_by_id(puppyrouter::provider_id(app_type), app_type)
        .map_err(|e| e.to_string())?
        .ok_or("PuppyRouter provider is missing")?;
    if !puppyrouter::owns(app_type, &existing) {
        return Err("PuppyRouter provider ID conflicts with an existing custom provider".into());
    }
    let mut provider =
        puppyrouter::with_api_key(app_type, &existing, api_key).map_err(|e| e.to_string())?;
    if matches!(app_type, AppType::Codex) {
        if let Err(_error) =
            refresh_codex_model_catalog_from_puppyrouter(&mut provider, api_key).await
        {
            log::warn!("PuppyRouter model catalog refresh failed; keeping saved models");
        }
        // Fetching the catalog yields to the editor. A fresh apply can merge the user's latest edits.
        let current = state
            .db
            .get_provider_by_id(&existing.id, app_type)
            .map_err(|e| e.to_string())?;
        if serde_json::to_value(current).map_err(|e| e.to_string())?
            != serde_json::to_value(&existing).map_err(|e| e.to_string())?
        {
            return Err("模型列表加载期间供应商已更改，请重新选择密钥。".into());
        }
    }
    // Upstream update owns all live writes and preserves direct/routing/stack state.
    // It updates an additive entry only if already present, and never enables it.
    ProviderService::update(state, app_type.clone(), None, provider)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn puppyrouter_provider_api_key_for_app(
    state: &AppState,
    app_type: &AppType,
) -> Result<Option<String>, String> {
    let provider_id = puppyrouter::provider_id(app_type);
    let Some(provider) = state
        .db
        .get_provider_by_id(provider_id, app_type)
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    if !puppyrouter::owns(app_type, &provider) {
        return Ok(None);
    }
    let (_, api_key) = provider.resolve_usage_credentials(app_type);
    Ok((!api_key.trim().is_empty()).then_some(api_key))
}

fn emit_universal_provider_synced(app: &AppHandle, target_app: &AppType, state: &AppState) {
    let id = puppyrouter::provider_id(target_app);
    let live = if target_app.spec().additive {
        crate::services::provider::provider_exists_in_live_config(target_app, id).unwrap_or(false)
    } else {
        *target_app != AppType::Agy
            && !crate::mode::current::is_proxy(target_app)
            && ProviderService::current(state, target_app.clone())
                .is_ok_and(|current| current == id)
    };
    let _ = app.emit(
        "universal-provider-synced",
        serde_json::json!({
            "action": "sync",
            "id": PUPPYROUTER_UNIVERSAL_ID,
            // localOnly=true means the client live config was not touched (provider
            // is not current); false means the live config was already refreshed.
            "localOnly": !live,
            "appType": target_app.as_str(),
        }),
    );
}

#[tauri::command]
pub async fn get_puppyrouter_account_status(
    state: State<'_, AppState>,
) -> Result<PuppyRouterAccountStatus, String> {
    let Some(session) = read_session(state.inner())? else {
        return Ok(account_status_from_session(None));
    };

    let client = http_client();
    let response = match account_request(&client, Method::GET, "/api/user/self")
        .header(COOKIE, session.cookie_header.as_str())
        .header("New-Api-User", session.user.id.to_string())
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Ok(account_status_with_state(
                session,
                PuppyRouterSessionState::Offline,
                Some(format!("连接 PuppyRouter 失败: {error}")),
            ));
        }
    };

    if response.status() == StatusCode::UNAUTHORIZED {
        return Ok(
            if clear_account_auth_state(state.inner(), Some(&session))? {
                expired_account_status()
            } else {
                account_status_from_session(read_session(state.inner())?)
            },
        );
    }

    if !response.status().is_success() {
        let status = response.status();
        return Ok(account_status_with_state(
            session,
            PuppyRouterSessionState::ServerError,
            Some(format!("PuppyRouter HTTP {status}")),
        ));
    }

    match parse_api_response::<SelfData>(response)
        .await
        .and_then(|(api, _)| ensure_api_success(api))
    {
        Ok(_) => Ok(account_status_from_session(Some(session))),
        Err(error) => Ok(account_status_with_state(
            session,
            PuppyRouterSessionState::ServerError,
            Some(error),
        )),
    }
}

#[tauri::command]
pub async fn get_puppyrouter_account_balance(
    state: State<'_, AppState>,
) -> Result<PuppyRouterAccountBalance, String> {
    let session =
        read_session(state.inner())?.ok_or_else(|| "请先登录 PuppyRouter 账号。".to_string())?;
    let client = http_client();
    let data: SelfData = auth_get(state.inner(), &client, &session, "/api/user/self").await?;
    let status: StatusData = auth_get(state.inner(), &client, &session, "/api/status").await?;
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

// The browser may approve after the dialog is cancelled or a newer grant is opened.
#[derive(Default)]
struct LoginAttempt {
    generation: u64,
    device_code: Option<String>,
}

impl LoginAttempt {
    fn reset(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.device_code = None;
        self.generation
    }

    fn set_grant(&mut self, generation: u64, code: &str) -> Result<(), String> {
        if self.generation != generation {
            return Err("本次登录已取消。".into());
        }
        self.device_code = Some(code.into());
        Ok(())
    }

    fn cancel(&mut self, code: &str) {
        if self.device_code.as_deref() == Some(code) {
            self.reset();
        }
    }
}

static ACTIVE_LOGIN: std::sync::LazyLock<std::sync::Mutex<LoginAttempt>> =
    std::sync::LazyLock::new(Default::default);

#[tauri::command]
pub fn cancel_puppyrouter_account_login(device_code: String) {
    ACTIVE_LOGIN.lock_recover().cancel(&device_code);
}

#[tauri::command]
pub async fn begin_puppyrouter_account_login() -> Result<PuppyRouterLoginStart, String> {
    let generation = ACTIVE_LOGIN.lock_recover().reset();
    let client = http_client();
    let response = account_request(&client, Method::POST, "/api/desktop-auth/start")
        .json(&serde_json::json!({
            "client_name": "puppyrouter app",
        }))
        .send()
        .await
        .map_err(|e| format!("连接 PuppyRouter 失败: {e}"))?;

    let (api, _) = parse_api_response::<DesktopAuthStartData>(response).await?;
    let start = login_start(ensure_api_success(api)?)?;
    ACTIVE_LOGIN
        .lock_recover()
        .set_grant(generation, &start.device_code)?;
    Ok(start)
}

fn login_start(data: DesktopAuthStartData) -> Result<PuppyRouterLoginStart, String> {
    if data.device_code.trim().is_empty() || data.user_code.trim().is_empty() {
        return Err("PuppyRouter 授权响应缺少授权码。".into());
    }
    let authorize_url =
        reqwest::Url::parse_with_params(&endpoint("/desktop-auth"), &[("code", &data.user_code)])
            .map_err(|e| e.to_string())?;
    Ok(PuppyRouterLoginStart {
        device_code: data.device_code,
        user_code: data.user_code,
        authorize_url: authorize_url.into(),
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
            let mut active = ACTIVE_LOGIN.lock_recover();
            if active.device_code.as_deref() != Some(&device_code) {
                return Ok(PuppyRouterLoginPollResult::Invalid {
                    message: String::new(),
                });
            }
            clear_setting(state.inner(), LEGACY_ACCOUNT_PENDING_SESSION_SETTING)?;
            set_setting_json(state.inner(), ACCOUNT_SESSION_SETTING, &session)?;
            active.reset();
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
    let mut active = ACTIVE_LOGIN.lock_recover();
    active.reset();
    clear_account_auth_state(state.inner(), None)?;
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
    let (tokens, total) = fetch_all_tokens(state.inner(), &client, &session).await?;

    let selected = selected_token_for_app(state.inner(), &target_app)?;
    let provider_api_key = puppyrouter_provider_api_key_for_app(state.inner(), &target_app)?;
    let token_ids: Vec<i64> = tokens.iter().map(|token| token.id).collect();
    let full_key_map = if provider_api_key
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        match fetch_token_key_map(state.inner(), &client, &session, &token_ids).await {
            Ok(keys) => keys,
            Err(error) if error == SESSION_EXPIRED_ERROR => return Err(error),
            Err(_) => HashMap::new(),
        }
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
        auth_get(state.inner(), &client, &session, "/api/user/self/groups").await?;
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
        state.inner(),
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
    // Applying two selections at once must preserve both per-app choices.
    static APPLY_KEY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = APPLY_KEY.lock().await;

    let session =
        read_session(state.inner())?.ok_or_else(|| "请先登录 PuppyRouter 账号。".to_string())?;
    let client = http_client();
    let (tokens, _) = fetch_all_tokens(state.inner(), &client, &session).await?;
    let token = tokens
        .into_iter()
        .find(|token| token.id == token_id)
        .ok_or_else(|| "找不到指定的 PuppyRouter API key。".to_string())?;

    if !is_token_usable(&token) {
        return Err("这个 PuppyRouter API key 当前不可用。".to_string());
    }

    let full_key = fetch_token_key(state.inner(), &client, &session, token_id).await?;
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
    emit_universal_provider_synced(&app, &target_app, state.inner());

    Ok(PuppyRouterApplyKeyResult {
        synced: true,
        token_id,
        name: token.name,
        masked_key: display_puppyrouter_api_key(&token.key),
        group,
    })
}

/// Return only findings. Client configuration can contain unrelated official login credentials.
#[tauri::command]
pub async fn diagnose_puppyrouter_config(
    state: State<'_, AppState>,
    target_app: String,
) -> Result<puppyrouter::diagnostics::Report, String> {
    let app = AppType::from_str(&target_app)?;
    Ok(puppyrouter::diagnostics::inspect(state.inner(), &app).await)
}

#[tauri::command]
pub async fn reapply_puppyrouter_config(
    state: State<'_, AppState>,
    target_app: String,
) -> Result<bool, String> {
    let app = AppType::from_str(&target_app)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || puppyrouter::diagnostics::reapply(&state, app))
        .await
        .map_err(|_| "PuppyRouter configuration update interrupted".to_string())?
        .map_err(|_| "Could not reapply the saved PuppyRouter configuration".to_string())
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
    fn a_legacy_global_selection_only_carries_over_to_legacy_apps() {
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        let old = StoredSelectedToken {
            token_id: 1,
            name: "old".into(),
            masked_key: "masked".into(),
            group: None,
            applied_at: 1,
        };
        set_setting_json(&state, SELECTED_TOKEN_SETTING, &old).unwrap();
        assert!(selected_token_for_app(&state, &AppType::Kimi)
            .unwrap()
            .is_none());
        set_selected_token_for_app(
            &state,
            &AppType::Pi,
            StoredSelectedToken { token_id: 2, ..old },
        )
        .unwrap();
        assert_eq!(
            selected_token_for_app(&state, &AppType::Codex)
                .unwrap()
                .unwrap()
                .token_id,
            1
        );
        assert_eq!(
            selected_token_for_app(&state, &AppType::Pi)
                .unwrap()
                .unwrap()
                .token_id,
            2
        );
        assert!(selected_token_for_app(&state, &AppType::Kimi)
            .unwrap()
            .is_none());
    }

    #[test]
    fn account_status_serializes_stable_session_state_names() {
        let expired = serde_json::to_value(expired_account_status()).expect("serialize status");
        assert_eq!(expired["loggedIn"], false);
        assert_eq!(expired["sessionState"], "expired");

        let signed_out =
            serde_json::to_value(account_status_from_session(None)).expect("serialize status");
        assert_eq!(signed_out["loggedIn"], false);
        assert_eq!(signed_out["sessionState"], "signed_out");
    }

    #[test]
    fn cancelled_or_replaced_login_cannot_overwrite_a_newer_grant() {
        let mut active = LoginAttempt::default();
        let old = active.reset();
        let latest = active.reset();
        active.set_grant(latest, "current").unwrap();
        assert!(active.set_grant(old, "stale").is_err());
        active.cancel("stale");
        assert_eq!(active.device_code.as_deref(), Some("current"));
        active.cancel("current");
        assert!(active.device_code.is_none());
        assert!(active.set_grant(latest, "current").is_err());
    }

    #[test]
    fn only_an_issued_session_cookie_completes_desktop_login() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.append(SET_COOKIE, "other=fixture; Path=/".parse().unwrap());
        assert!(desktop_session_cookie(&headers).is_empty());
        headers.append(SET_COOKIE, "session=fixture==; HttpOnly".parse().unwrap());
        assert_eq!(desktop_session_cookie(&headers), "session=fixture==");
        headers.append(SET_COOKIE, "session=; Max-Age=0".parse().unwrap());
        assert!(desktop_session_cookie(&headers).is_empty());
    }

    #[test]
    fn browser_approval_link_contains_only_the_displayed_code_on_the_official_origin() {
        let start = login_start(
            serde_json::from_value(json!({
                "device_code": "local-test-device",
                "user_code": "ABCD EFGH",
                "authorize_url": "https://example.invalid/",
                "expires_at": 120,
                "interval": 2
            }))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            start.authorize_url,
            "https://puppyrouter.com/desktop-auth?code=ABCD+EFGH"
        );
    }

    #[test]
    fn delayed_unauthorized_response_preserves_the_new_login_and_selection() {
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        let old: StoredAccountSession = serde_json::from_value(json!({
            "user": {"id": 1, "username": "fixture"}, "loggedInAt": 1, "cookieHeader": "session=first-fixture"
        })).unwrap();
        let new = StoredAccountSession {
            cookie_header: "session=second-fixture".into(),
            ..old.clone()
        };
        set_setting_json(&state, ACCOUNT_SESSION_SETTING, &new).unwrap();
        state
            .db
            .set_setting(SELECTED_TOKEN_BY_APP_SETTING, "fixture selection")
            .unwrap();
        assert!(!clear_account_auth_state(&state, Some(&old)).unwrap());
        assert!(read_session(&state).unwrap().is_some());
        assert_eq!(
            state
                .db
                .get_setting(SELECTED_TOKEN_BY_APP_SETTING)
                .unwrap()
                .as_deref(),
            Some("fixture selection")
        );
        assert!(clear_account_auth_state(&state, Some(&new)).unwrap());
        assert!(read_session(&state).unwrap().is_none());
    }

    #[test]
    fn clearing_expired_session_preserves_unrelated_local_configuration() {
        let state = AppState::new(Arc::new(Database::memory().expect("create database")));
        for key in [
            ACCOUNT_SESSION_SETTING,
            LEGACY_ACCOUNT_PENDING_SESSION_SETTING,
            SELECTED_TOKEN_SETTING,
            SELECTED_TOKEN_BY_APP_SETTING,
        ] {
            state
                .db
                .set_setting(key, r#"{"test":true}"#)
                .expect("seed account metadata");
        }
        state
            .db
            .set_setting("unrelated_local_provider_config", "keep-me")
            .expect("seed unrelated local configuration");

        clear_account_auth_state(&state, None).expect("clear expired account session");

        for key in [
            ACCOUNT_SESSION_SETTING,
            LEGACY_ACCOUNT_PENDING_SESSION_SETTING,
            SELECTED_TOKEN_SETTING,
            SELECTED_TOKEN_BY_APP_SETTING,
        ] {
            assert_eq!(
                state.db.get_setting(key).expect("read account metadata"),
                Some(String::new())
            );
        }
        assert_eq!(
            state
                .db
                .get_setting("unrelated_local_provider_config")
                .expect("read unrelated local configuration"),
            Some("keep-me".to_string())
        );
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
    #[serial_test::serial]
    fn every_cloud_key_can_be_staged_without_enabling_the_client() {
        let home = TestHomeGuard::new();
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        ProviderService::ensure_locked_puppyrouter_defaults(&state).unwrap();
        for app in AppType::all() {
            let key = format!("sk-fixture-staged-{}", app.as_str());
            let id = puppyrouter::provider_id(&app);
            let row = state.db.get_provider_by_id(id, &app).unwrap().unwrap();
            let row = puppyrouter::with_api_key(&app, &row, &key).unwrap();
            ProviderService::update(&state, app.clone(), None, row)
                .unwrap_or_else(|error| panic!("{}: {error}", app.as_str()));
            let stored = state.db.get_provider_by_id(id, &app).unwrap().unwrap();
            assert!(puppyrouter::owns(&app, &stored), "{}", app.as_str());
            assert_eq!(
                stored.resolve_usage_credentials(&app).1,
                key,
                "{}",
                app.as_str()
            );
        }
        let mut dirs = vec![home._dir.path().to_owned()];
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(dir).unwrap() {
                let entry = entry.unwrap();
                if entry.file_type().unwrap().is_dir() {
                    dirs.push(entry.path());
                } else if entry.file_type().unwrap().is_file() {
                    let content = std::fs::read(entry.path()).unwrap();
                    assert!(
                        !content
                            .windows(b"sk-fixture-staged-".len())
                            .any(|w| w == b"sk-fixture-staged-"),
                        "key leaked to {:?}",
                        entry.path()
                    );
                }
            }
        }
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn additive_cloud_keys_round_trip_through_the_native_provider_commands() {
        use puppyrouter::diagnostics::{inspect, Issue, Scope};
        let _home = TestHomeGuard::new();
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        ProviderService::ensure_locked_puppyrouter_defaults(&state).unwrap();
        // Kimi protects its default model from removal. Keep an independent native model selected.
        crate::kimi_config::add_and_commit("fixture-default", json!({"provider":{"type":"openai","base_url":"https://example.invalid/v1","api_key":"fixture"},"models":{"fixture-model":{"model":"fixture-model","max_context_size":32000}}}), || Ok(())).unwrap();
        for app in AppType::all().filter(|app| app.spec().additive) {
            let id = puppyrouter::provider_id(&app);
            let row = state.db.get_provider_by_id(id, &app).unwrap().unwrap();
            let row = puppyrouter::with_api_key(&app, &row, "sk-explicit-enable-fixture").unwrap();
            ProviderService::update(&state, app.clone(), None, row.clone()).unwrap();
            assert_eq!(
                inspect(&state, &app).await.issues,
                [Issue::NativeMissing],
                "{app:?}"
            );
            let enabled = if matches!(app, AppType::Kimi | AppType::Copilot) {
                ProviderService::add_to_live_config(&state, app.clone(), id)
            } else {
                ProviderService::switch(&state, app.clone(), id).map(|_| ())
            };
            enabled.unwrap_or_else(|error| panic!("enable {}: {error}", app.as_str()));
            let report = inspect(&state, &app).await;
            assert_eq!(
                (report.scope, report.issues),
                (Scope::Native, vec![]),
                "{app:?}"
            );
            ProviderService::remove_from_live_config(&state, app.clone(), id)
                .unwrap_or_else(|error| panic!("remove {}: {error}", app.as_str()));
            assert!(
                inspect(&state, &app)
                    .await
                    .issues
                    .contains(&Issue::NativeMissing),
                "{app:?}"
            );
            assert_eq!(
                state
                    .db
                    .get_provider_by_id(id, &app)
                    .unwrap()
                    .unwrap()
                    .resolve_usage_credentials(&app)
                    .1,
                "sk-explicit-enable-fixture",
                "{}",
                app.as_str()
            );
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
        let path = crate::grok_config::get_grok_config_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, official_snapshot).expect("seed official Grok Build live config");

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
            .get_provider_by_id("universal-grokbuild-puppyrouter", &AppType::GrokBuild)
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

        std::fs::write(
            &path,
            crate::grok_config::build_puppyrouter_config(
                enabled["config"].as_str(),
                "sk-wrong-live",
            ),
        )
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
            .get_provider_by_id("universal-grokbuild-puppyrouter", &AppType::GrokBuild)
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
