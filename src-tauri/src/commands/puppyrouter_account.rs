use std::collections::HashMap;
use std::time::Duration;

use reqwest::header::{COOKIE, SET_COOKIE};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::app_config::AppType;
use crate::provider::{Provider, ProviderMeta};
use crate::services::ProviderService;
use crate::store::AppState;

const PUPPYROUTER_BASE_URL: &str = "https://puppyrouter.com";
const PUPPYROUTER_UNIVERSAL_ID: &str = "puppyrouter";
const ACCOUNT_SESSION_SETTING: &str = "puppyrouter_account_session";
const LEGACY_ACCOUNT_PENDING_SESSION_SETTING: &str = "puppyrouter_account_pending_session";
const SELECTED_TOKEN_SETTING: &str = "puppyrouter_account_selected_token";
const DEFAULT_TOKEN_NAME: &str = "default_api_key";

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

fn now_timestamp() -> i64 {
    chrono::Utc::now().timestamp()
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("puppyrouter-app/1.0")
        .build()
        .map_err(|e| format!("创建 PuppyRouter HTTP 客户端失败: {e}"))
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
    let response = client
        .get(endpoint(path))
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
    let response = client
        .post(endpoint(path))
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
    Ok(data.key)
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
            if let Ok(id) = id.parse::<i64>() {
                result.insert(id, key);
            }
        }
    }

    Ok(result)
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
        .map(|(provider_key, token_key)| !provider_key.is_empty() && provider_key == token_key)
        .unwrap_or(false);
    let active = active_by_key || active_token_id == Some(token.id);

    PuppyRouterApiKey {
        id: token.id,
        name: token.name,
        masked_key: token.key,
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

fn emit_universal_provider_synced(app: &AppHandle) {
    let _ = app.emit(
        "universal-provider-synced",
        serde_json::json!({
            "action": "sync",
            "id": PUPPYROUTER_UNIVERSAL_ID,
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
            live_config_managed: Some(true),
            provider_type: Some("puppyrouter".to_string()),
            ..ProviderMeta::default()
        }),
        icon: Some("openai".to_string()),
        icon_color: Some("#F59E0B".to_string()),
        in_failover_queue: false,
    }
}

fn sync_puppyrouter_opencode_provider(state: &AppState, api_key: &str) -> Result<(), String> {
    let mut provider = puppyrouter_opencode_provider(api_key);
    if let Some(existing) = state
        .db
        .get_provider_by_id(PUPPYROUTER_UNIVERSAL_ID, AppType::OpenCode.as_str())
        .map_err(|e| e.to_string())?
    {
        provider.created_at = existing.created_at.or(provider.created_at);
        provider.notes = existing.notes;
    }

    state
        .db
        .save_provider(AppType::OpenCode.as_str(), &provider)
        .map_err(|e| e.to_string())?;
    crate::opencode_config::set_provider(&provider.id, provider.settings_config)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_puppyrouter_account_status(
    state: State<'_, AppState>,
) -> Result<PuppyRouterAccountStatus, String> {
    Ok(account_status_from_session(read_session(state.inner())?))
}

#[tauri::command]
pub async fn begin_puppyrouter_account_login() -> Result<PuppyRouterLoginStart, String> {
    let client = http_client()?;
    let response = client
        .post(endpoint("/api/desktop-auth/start"))
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

    let client = http_client()?;
    let response = client
        .post(endpoint("/api/desktop-auth/poll"))
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
    Ok(true)
}

#[tauri::command]
pub async fn list_puppyrouter_api_keys(
    state: State<'_, AppState>,
) -> Result<PuppyRouterApiKeyList, String> {
    let session =
        read_session(state.inner())?.ok_or_else(|| "请先登录 PuppyRouter 账号。".to_string())?;
    let client = http_client()?;
    let (tokens, total) = fetch_all_tokens(&client, &session).await?;

    let selected: Option<StoredSelectedToken> =
        setting_json(state.inner(), SELECTED_TOKEN_SETTING)?;
    let provider_api_key = ProviderService::get_universal(state.inner(), PUPPYROUTER_UNIVERSAL_ID)
        .map_err(|e| e.to_string())?
        .map(|provider| provider.api_key);
    let token_ids: Vec<i64> = tokens.iter().map(|token| token.id).collect();
    let full_key_map = fetch_token_key_map(&client, &session, &token_ids)
        .await
        .unwrap_or_default();

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
pub async fn apply_puppyrouter_api_key(
    app: AppHandle,
    state: State<'_, AppState>,
    token_id: i64,
) -> Result<PuppyRouterApplyKeyResult, String> {
    let session =
        read_session(state.inner())?.ok_or_else(|| "请先登录 PuppyRouter 账号。".to_string())?;
    let client = http_client()?;
    let (tokens, _) = fetch_all_tokens(&client, &session).await?;
    let token = tokens
        .into_iter()
        .find(|token| token.id == token_id)
        .ok_or_else(|| "找不到指定的 PuppyRouter API key。".to_string())?;

    if !is_token_usable(&token) {
        return Err("这个 PuppyRouter API key 当前不可用。".to_string());
    }

    let full_key = fetch_token_key(&client, &session, token_id).await?;
    if full_key.trim().is_empty() {
        return Err("PuppyRouter 返回了空 API key。".to_string());
    }

    let mut provider = ProviderService::get_universal(state.inner(), PUPPYROUTER_UNIVERSAL_ID)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "PuppyRouter universal provider 不存在。".to_string())?;
    provider.api_key = full_key;
    ProviderService::upsert_universal(state.inner(), provider).map_err(|e| e.to_string())?;
    let synced = ProviderService::sync_universal_to_apps(state.inner(), PUPPYROUTER_UNIVERSAL_ID)
        .map_err(|e| e.to_string())?;
    let provider_api_key = ProviderService::get_universal(state.inner(), PUPPYROUTER_UNIVERSAL_ID)
        .map_err(|e| e.to_string())?
        .map(|provider| provider.api_key)
        .ok_or_else(|| "PuppyRouter universal provider 不存在。".to_string())?;
    sync_puppyrouter_opencode_provider(state.inner(), &provider_api_key)?;

    let group = normalize_group(token.group.clone());
    let selected = StoredSelectedToken {
        token_id,
        name: token.name.clone(),
        masked_key: token.key.clone(),
        group: group.clone(),
        applied_at: now_timestamp(),
    };
    set_setting_json(state.inner(), SELECTED_TOKEN_SETTING, &selected)?;
    emit_universal_provider_synced(&app);

    Ok(PuppyRouterApplyKeyResult {
        synced,
        token_id,
        name: token.name,
        masked_key: token.key,
        group,
    })
}
