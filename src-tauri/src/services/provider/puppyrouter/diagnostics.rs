//! Read the settings consumed by the active client. Only status codes cross IPC.
#[cfg(test)]
mod tests;
use super::{owns, provider_id};
use crate::app_config::AppType;
use crate::claude_desktop_config as desktop;
use crate::error::AppError;
use crate::live::engine::DeviceStore;
use crate::live::project::{claude::PROXY_TOKEN_PLACEHOLDER, codex, gemini, grok};
use crate::mode::{current, stack, state as device};
use crate::provider::Provider;
use crate::services::provider::{agy_direct, codex_direct};
use crate::services::ProviderService;
use crate::store::AppState;
use serde::Serialize;
use serde_json::Value;
use toml_edit::{DocumentMut, Item, TableLike};

#[derive(Debug, Clone, Copy, serde::Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Staged,
    Direct,
    Native,
    Proxy,
    Launch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Issue {
    ProviderMissing,
    ProviderNotCurrent,
    NativeMissing,
    ProxyNotSelected,
    ProxyDetached,
    ProxyConfigMismatch,
    ReadFailed,
    SavedConfigInvalid,
    SavedKeyMissing,
    EndpointMismatch,
    KeyMissing,
    KeyMismatch,
    CodexConfigInvalid,
    CodexProviderTableMissing,
    CodexWireApiNotResponses,
    AuthSource,
    ExternalAuth,
    DesktopUnsupported,
    DesktopProfile,
    GeminiAuthMode,
    ModelConfigMismatch,
    NativeProfileConflict,
    NativeDisabled,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Report {
    pub scope: Scope,
    pub issues: Vec<Issue>,
}

impl Report {
    pub(crate) fn allows_cloud_repair(&self, scope: Scope) -> bool {
        self.scope == scope
            && !self.issues.iter().any(|issue| {
                matches!(
                    issue,
                    Issue::ProviderMissing
                        | Issue::SavedConfigInvalid
                        | Issue::ExternalAuth
                        | Issue::NativeProfileConflict
                        | Issue::NativeDisabled
                        | Issue::ReadFailed
                        | Issue::CodexConfigInvalid
                        | Issue::DesktopUnsupported
                )
            })
    }
    fn new(scope: Scope) -> Self {
        Self {
            scope,
            issues: Vec::new(),
        }
    }
    fn flag(&mut self, issue: Issue) {
        if !self.issues.contains(&issue) {
            self.issues.push(issue);
        }
    }
    fn credentials(&mut self, url: &str, key: &str, expected: &(String, String)) {
        if url.trim_end_matches('/') != expected.0.trim_end_matches('/') {
            self.flag(Issue::EndpointMismatch);
        }
        if key.is_empty() {
            self.flag(Issue::KeyMissing);
        } else if key != expected.1 {
            self.flag(Issue::KeyMismatch);
        }
    }
}

fn native_entry(app: &AppType, row: &mut Provider) -> Result<Option<Value>, AppError> {
    let id = row.id.as_str();
    match app {
        AppType::OpenCode => Ok(crate::opencode_config::get_providers_with_format()?
            .shift_remove(id)
            .map(|(entry, format)| {
                row.meta
                    .get_or_insert_with(Default::default)
                    .opencode_config_format = Some(format);
                entry
            })),
        AppType::OpenClaw => crate::openclaw_config::get_provider(id),
        AppType::Hermes => crate::hermes_config::get_provider(id),
        AppType::Pi => crate::pi_config::read_pi_native_provider(id),
        AppType::Omp => crate::omp_config::get_providers().map(|mut p| p.shift_remove(id)),
        AppType::Mcode => crate::mcode_config::get_providers().map(|mut p| p.shift_remove(id)),
        AppType::Kimi => crate::kimi_config::get_providers().map(|mut p| p.shift_remove(id)),
        AppType::Copilot => crate::copilot_config::get_providers().map(|mut p| p.shift_remove(id)),
        _ => Err(AppError::InvalidInput(
            "This application does not use native provider entries".into(),
        )),
    }
}

fn official_endpoint(base: &str) -> bool {
    url::Url::parse(base).is_ok_and(|url| {
        url.scheme() == "https"
            && matches!(
                url.host_str(),
                Some("puppyrouter.com" | "www.puppyrouter.com")
            )
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    })
}

pub(crate) async fn inspect(state: &AppState, app: &AppType) -> Report {
    let mut report = Report::new(Scope::Staged);
    if let Err(issue) = inspect_local(state, app, &mut report).await {
        report.flag(issue);
    }
    report
}

/// Read the current card and client under the same switch lock as the writer.
/// A repair writes only the client; it must never save an old snapshot over the card.
pub(crate) fn reapply(state: &AppState, app: AppType) -> Result<bool, AppError> {
    let _guard = if app.spec().route_mode {
        futures::executor::block_on(crate::mode::controller::lock_settled(state, &app))?
    } else {
        futures::executor::block_on(state.proxy_service.lock_switch_for_app(app.as_str()))
    };
    if app.spec().route_mode
        && device::mode_state(&DeviceStore::for_device(), app.as_str())?.is_proxy()
    {
        return Ok(false);
    }
    let Some(row) = state
        .db
        .get_provider_by_id(provider_id(&app), &app)?
        .filter(|r| owns(&app, r))
    else {
        return Ok(false);
    };
    let mut report = Report::new(Scope::Staged);
    if let Err(issue) =
        futures::executor::block_on(inspect_row(state, &app, row.clone(), &mut report))
    {
        report.flag(issue);
    }
    if !matches!(report.scope, Scope::Direct | Scope::Native)
        || report.issues.is_empty()
        || !report.issues.iter().all(|issue| {
            matches!(
                issue,
                Issue::KeyMissing
                    | Issue::KeyMismatch
                    | Issue::EndpointMismatch
                    | Issue::CodexProviderTableMissing
                    | Issue::CodexWireApiNotResponses
                    | Issue::AuthSource
                    | Issue::DesktopProfile
                    | Issue::GeminiAuthMode
                    | Issue::ModelConfigMismatch
            )
        })
    {
        return Ok(false);
    }
    write_existing_client(state, &app, &row)
}

/// A diagnosis of a staged card may offer a direct switch. If the user has since
/// entered routing or Stack, leave the route alone even when the switch was queued.
pub(crate) fn enable_staged_direct(
    state: &AppState,
    app: AppType,
    id: &str,
) -> Result<crate::services::provider::SwitchResult, AppError> {
    let changed = || {
        AppError::InvalidInput("PuppyRouter configuration changed; run diagnostics again".into())
    };
    if !app.spec().route_mode || id != provider_id(&app) {
        return Err(changed());
    }
    let _guard = crate::mode::controller::lock_settled_blocking(state, &app)?;
    if device::mode_state(&DeviceStore::for_device(), app.as_str())?.is_proxy() {
        return Err(changed());
    }
    let report = futures::executor::block_on(inspect(state, &app));
    if report.scope != Scope::Staged || report.issues != [Issue::ProviderNotCurrent] {
        return Err(changed());
    }
    let rows = state.db.get_provider_rows(&app)?;
    ProviderService::switch_normal(state, app, id, &rows.readable)
}

fn write_existing_client(
    state: &AppState,
    app: &AppType,
    row: &Provider,
) -> Result<bool, AppError> {
    let id = &row.id;
    let config = &row.settings_config;
    match app {
        AppType::Pi => Ok(crate::pi_config::replace_pi_provider_if_present(id, config)?.is_some()),
        AppType::Omp => crate::omp_config::change_and_commit(
            id,
            Some(config),
            crate::omp_config::Change::ReplaceIfPresent,
            |old| Ok(old.is_some()),
        ),
        AppType::Copilot => {
            crate::copilot_config::save_and_commit(id, Some(config), false, || Ok(true))
        }
        AppType::Dsh => {
            crate::dsh_config::save_and_commit(id, Some(config.clone()), false, || Ok(true))
        }
        AppType::Kimi => {
            crate::kimi_config::save_and_commit(id, Some(config.clone()), false, || Ok(true))
        }
        _ => {
            crate::services::provider::write_live_for_state(state, app, row)?;
            Ok(true)
        }
    }
}

async fn inspect_local(state: &AppState, app: &AppType, report: &mut Report) -> Result<(), Issue> {
    let row = state
        .db
        .get_provider_by_id(provider_id(app), app)
        .map_err(|_| Issue::ReadFailed)?
        .filter(|p| owns(app, p))
        .ok_or(Issue::ProviderMissing)?;
    inspect_row(state, app, row, report).await
}

async fn inspect_row(
    state: &AppState,
    app: &AppType,
    mut row: Provider,
    report: &mut Report,
) -> Result<(), Issue> {
    let id = provider_id(app);
    let expected = row.resolve_usage_credentials(app);
    if expected.1.trim().is_empty() {
        report.flag(Issue::SavedKeyMissing);
    }
    let saved_url = if *app == AppType::Codex {
        match codex_direct::project(&row) {
            Ok(projection) => {
                let codex::Route::Custom { table, auth } = projection.route else {
                    return Err(Issue::SavedConfigInvalid);
                };
                if table
                    .get("wire_api")
                    .is_some_and(|v| v.as_str() != Some("responses"))
                {
                    report.flag(Issue::SavedConfigInvalid);
                }
                if matches!(auth, codex::RouteAuth::EnvKey | codex::RouteAuth::Headers) {
                    report.flag(Issue::ExternalAuth);
                }
                table
                    .get("base_url")
                    .and_then(Item::as_str)
                    .unwrap_or_default()
                    .to_owned()
            }
            Err(e) if codex::is_keyless_fallback(&e) => expected.0.clone(),
            Err(_) => return Err(Issue::SavedConfigInvalid),
        }
    } else {
        expected.0.clone()
    };
    if uses_external_auth(app, &row.settings_config)
        || (*app == AppType::Claude && claude_uses_other_auth(&row.settings_config))
        || (*app == AppType::GrokBuild
            && crate::grok_config::extract_model_config(string(&row.settings_config, "/config"))
                .is_some_and(|m| m.env_key.is_some()))
    {
        report.flag(Issue::ExternalAuth);
    }
    if !official_endpoint(&saved_url) {
        report.flag(Issue::SavedConfigInvalid);
    }
    if *app == AppType::Agy {
        report.scope = Scope::Launch;
        let settings = agy_direct::live_settings(&row).map_err(|error| match error {
            AppError::Localized {
                key: "gemini.validation.missing_api_key",
                ..
            } => Issue::SavedKeyMissing,
            _ => Issue::SavedConfigInvalid,
        })?;
        if string(&settings, "/env/GEMINI_API_KEY").is_empty() {
            report.flag(Issue::KeyMissing);
        }
        return Ok(());
    }
    if app.spec().additive {
        return check_native(app, row, expected, report);
    }
    if *app == AppType::ClaudeDesktop && !desktop::is_supported_platform() {
        return Err(Issue::DesktopUnsupported);
    }
    let store = DeviceStore::for_device();
    let mode = device::mode_state(&store, app.as_str()).map_err(|_| Issue::ReadFailed)?;
    let active =
        current::inspect_provider_id(&state.db, app, &mode).map_err(|_| Issue::ReadFailed)?;
    if mode.is_proxy() {
        return check_proxy(state, app, mode.attached, active.as_deref(), report).await;
    }
    if active.as_deref() != Some(id) {
        return Err(Issue::ProviderNotCurrent);
    }
    report.scope = Scope::Direct;
    if *app == AppType::ClaudeDesktop {
        let credentials = desktop::direct_gateway_credentials(&row).map_err(|_| {
            if expected.1.trim().is_empty() {
                Issue::SavedKeyMissing
            } else {
                Issue::SavedConfigInvalid
            }
        })?;
        return check_desktop(report, &(credentials.base_url, credentials.api_key));
    }
    let live = read_client(app)?;
    if *app == AppType::Codex {
        return check_codex(&row, &live, report);
    }
    if *app == AppType::Claude {
        let auth = string(&live, "/env/ANTHROPIC_AUTH_TOKEN");
        let api_key = string(&live, "/env/ANTHROPIC_API_KEY");
        if claude_uses_other_auth(&live) || (!auth.is_empty() && !api_key.is_empty()) {
            report.flag(Issue::AuthSource);
        }
        report.credentials(
            string(&live, "/env/ANTHROPIC_BASE_URL"),
            if auth.is_empty() { api_key } else { auth },
            &expected,
        );
        return Ok(());
    }
    if *app == AppType::Gemini {
        if string(&live, "/config/security/auth/selectedType") != gemini::SELECTED_TYPE_API_KEY {
            report.flag(Issue::GeminiAuthMode);
        }
        report.credentials(
            string(&live, "/env/GOOGLE_GEMINI_BASE_URL"),
            string(&live, "/env/GEMINI_API_KEY"),
            &expected,
        );
        return Ok(());
    }
    if *app == AppType::GrokBuild {
        let model = crate::grok_config::extract_model_config(string(&live, "/config"))
            .ok_or(Issue::ModelConfigMismatch)?;
        let saved =
            crate::grok_config::extract_model_config(string(&row.settings_config, "/config"))
                .ok_or(Issue::SavedConfigInvalid)?;
        if model.profile != saved.profile || model.api_backend != saved.api_backend {
            report.flag(Issue::ModelConfigMismatch);
        }
        if model.env_key.is_some() {
            report.flag(if saved.env_key.is_some() {
                Issue::ExternalAuth
            } else {
                Issue::AuthSource
            });
        }
    }
    row.settings_config = live;
    let (url, key) = row.resolve_usage_credentials(app);
    report.credentials(&url, &key, &expected);
    Ok(())
}

fn check_native(
    app: &AppType,
    mut row: Provider,
    expected: (String, String),
    report: &mut Report,
) -> Result<(), Issue> {
    if *app == AppType::Mcode && mcode_disabled(&row.settings_config) {
        report.flag(Issue::NativeDisabled);
    }
    if *app == AppType::WorkBuddy {
        return check_workbuddy(&row, report);
    }
    if *app == AppType::Dsh {
        let copies = crate::dsh_config::provider_copies_for_diagnostics(&row.id).map_err(
            |error| match error {
                AppError::Localized {
                    key: "dsh.provider_diverged" | "dsh.providers_shadowed_by_home",
                    ..
                } => Issue::NativeProfileConflict,
                AppError::Localized {
                    key: "dsh.provider_plugin_disabled",
                    ..
                } => Issue::NativeDisabled,
                AppError::Localized {
                    key: "dsh.credentials_disabled",
                    ..
                } => Issue::ExternalAuth,
                _ => Issue::ReadFailed,
            },
        )?;
        if copies.iter().all(Option::is_none) {
            return Err(Issue::NativeMissing);
        }
        report.scope = Scope::Native;
        for copy in copies {
            let Some(config) = copy else {
                report.flag(Issue::ModelConfigMismatch);
                continue;
            };
            row.settings_config = config;
            let (url, key) = row.resolve_usage_credentials(app);
            report.credentials(&url, &key, &expected);
        }
        return Ok(());
    }
    let native = native_entry(app, &mut row).map_err(|_| Issue::ReadFailed)?;
    if matches!(app, AppType::Pi | AppType::Omp)
        && model_settings(&row.settings_config).any(|model| {
            model["baseUrl"]
                .as_str()
                .is_some_and(|u| u.trim_end_matches('/') != expected.0.trim_end_matches('/'))
                || model["apiKey"].as_str().is_some_and(|k| k != expected.1)
        })
    {
        report.flag(Issue::SavedConfigInvalid);
    }
    row.settings_config = native.ok_or(Issue::NativeMissing)?;
    report.scope = Scope::Native;
    let (url, key) = row.resolve_usage_credentials(app);
    report.credentials(&url, &key, &expected);
    if matches!(app, AppType::Pi | AppType::Omp) {
        for model in model_settings(&row.settings_config) {
            report.credentials(
                model.get("baseUrl").and_then(Value::as_str).unwrap_or(&url),
                model.get("apiKey").and_then(Value::as_str).unwrap_or(&key),
                &expected,
            );
        }
    }
    if *app == AppType::Mcode && mcode_disabled(&row.settings_config) {
        report.flag(Issue::NativeDisabled);
    }
    if uses_external_auth(app, &row.settings_config) {
        report.flag(Issue::ExternalAuth);
    }
    Ok(())
}

fn mcode_disabled(config: &Value) -> bool {
    config["enabled"] == false
        || !config["models"].as_object().is_some_and(|models| {
            models
                .values()
                .any(|model| model.is_object() && model["enabled"] != false)
        })
}

fn uses_external_auth(app: &AppType, config: &Value) -> bool {
    let provider = &config["provider"];
    (*app == AppType::Kimi
        && (provider.get("api_key_env").is_some() || provider.get("oauth").is_some()))
        || (*app == AppType::Copilot && provider.get("bearerToken").is_some())
        || (*app == AppType::Pi && config.get("oauth").is_some())
        || (*app == AppType::Omp && config["auth"].as_str().is_some_and(|auth| auth != "apiKey"))
}

async fn check_proxy(
    state: &AppState,
    app: &AppType,
    attached: bool,
    route: Option<&str>,
    report: &mut Report,
) -> Result<(), Issue> {
    let id = provider_id(app);
    if route != Some(id) {
        let stack = device::stack(&DeviceStore::for_device(), app.as_str())
            .map_err(|_| Issue::ReadFailed)?;
        let members = stack::published_members(&state.db, app, &stack, route)
            .map_err(|_| Issue::ReadFailed)?;
        if !members
            .iter()
            .any(|m| m.provider.id == id && !m.model_ids.is_empty())
        {
            return Err(Issue::ProxyNotSelected);
        }
    }
    report.scope = Scope::Proxy;
    if !attached || !state.proxy_service.is_running().await {
        return Err(Issue::ProxyDetached);
    }
    let (origin, codex_url) = state
        .proxy_service
        .build_proxy_urls()
        .await
        .map_err(|_| Issue::ProxyDetached)?;
    if *app == AppType::ClaudeDesktop {
        let key = state
            .db
            .get_setting(desktop::GATEWAY_TOKEN_SETTING_KEY)
            .map_err(|_| Issue::ReadFailed)?
            .unwrap_or_default();
        return check_desktop(report, &(desktop::gateway_base_url(&origin), key));
    }
    let live = read_client(app)?;
    if !proxy_matches(app, &live, &origin, &codex_url) {
        return Err(Issue::ProxyConfigMismatch);
    }
    Ok(())
}

fn model_settings(config: &Value) -> impl Iterator<Item = &Value> {
    config["models"].as_array().into_iter().flatten().chain(
        config["modelOverrides"]
            .as_object()
            .into_iter()
            .flat_map(|models| models.values()),
    )
}

fn string<'a>(config: &'a Value, path: &str) -> &'a str {
    config
        .pointer(path)
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn claude_uses_other_auth(config: &Value) -> bool {
    !string(config, "/apiKeyHelper").is_empty()
        || crate::live::floor::CLAUDE_PROTOCOL_SELECTORS
            .iter()
            .any(|key| {
                config["env"]
                    .get(key)
                    .and_then(Value::as_str)
                    .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            })
}

fn check_workbuddy(row: &Provider, report: &mut Report) -> Result<(), Issue> {
    let saved = &row.settings_config;
    let expected = saved["models"]
        .as_array()
        .ok_or(Issue::SavedConfigInvalid)?;
    let (_, saved_key) = row.resolve_usage_credentials(&AppType::WorkBuddy);
    let inherited = |model: &Value, field: &str| {
        model
            .get(field)
            .or_else(|| saved.get(field))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    for model in expected {
        if !official_endpoint(&inherited(model, "url")) || inherited(model, "apiKey") != saved_key {
            report.flag(Issue::SavedConfigInvalid);
        }
    }
    let (models, all_selectable) =
        crate::workbuddy_config::read_provider_models(&row.id).map_err(|_| Issue::ReadFailed)?;
    if models.is_empty() {
        return Err(Issue::NativeMissing);
    }
    report.scope = Scope::Native;
    if !all_selectable {
        report.flag(Issue::NativeDisabled);
    }
    if models.len() != expected.len()
        || expected
            .iter()
            .any(|source| !models.iter().any(|m| m["id"] == source["id"]))
    {
        report.flag(Issue::ModelConfigMismatch);
    }
    for model in &models {
        let Some(source) = expected.iter().find(|m| m["id"] == model["id"]) else {
            report.flag(Issue::ModelConfigMismatch);
            continue;
        };
        report.credentials(
            string(model, "/url"),
            string(model, "/apiKey"),
            &(inherited(source, "url"), inherited(source, "apiKey")),
        );
    }
    Ok(())
}

fn read_client(app: &AppType) -> Result<Value, Issue> {
    let read_json = |path: std::path::PathBuf| {
        let bytes = crate::live::engine::read_current(&path).map_err(|_| Issue::ReadFailed)?;
        crate::live::patch::json::parse(&path, bytes.as_deref())
            .map(|(value, _)| value)
            .map_err(|_| Issue::ReadFailed)
    };
    if *app == AppType::Claude {
        return read_json(crate::config::get_claude_settings_path());
    }
    if *app == AppType::Gemini {
        let env = crate::gemini_config::read_gemini_env().map_err(|_| Issue::ReadFailed)?;
        return Ok(
            serde_json::json!({"env":env,"config":read_json(crate::gemini_config::get_gemini_settings_path())?}),
        );
    }
    if *app == AppType::Codex {
        // The official account's auth.json is separate from the active provider's bearer.
        // The regular editor reader also imports an unrelated model catalog.
        return crate::codex_config::read_codex_live_settings().map_err(|e| match e {
            AppError::Toml { .. } => Issue::CodexConfigInvalid,
            _ => Issue::ReadFailed,
        });
    }
    ProviderService::read_live_settings(app.clone()).map_err(|_| Issue::ReadFailed)
}

fn check_desktop(report: &mut Report, expected: &(String, String)) -> Result<(), Issue> {
    let actual = desktop::active_gateway_credentials()
        .map_err(|_| Issue::ReadFailed)?
        .ok_or(Issue::DesktopProfile)?;
    report.credentials(&actual.base_url, &actual.api_key, expected);
    Ok(())
}

fn active_table(doc: &DocumentMut) -> Option<&dyn TableLike> {
    let id = doc.get("model_provider")?.as_str()?;
    if codex::is_built_in_id(id) {
        return None;
    }
    doc.get("model_providers")?
        .as_table_like()?
        .get(id)?
        .as_table_like()
}

fn check_codex(row: &Provider, live: &Value, report: &mut Report) -> Result<(), Issue> {
    let projection = codex_direct::project(row).map_err(|e| {
        if codex::is_keyless_fallback(&e) {
            Issue::SavedKeyMissing
        } else {
            Issue::SavedConfigInvalid
        }
    })?;
    let codex::Route::Custom {
        table: expected,
        auth,
    } = projection.route
    else {
        return Err(Issue::SavedConfigInvalid);
    };
    let config = string(live, "/config");
    let doc = config
        .parse::<DocumentMut>()
        .map_err(|_| Issue::CodexConfigInvalid)?;
    let table = active_table(&doc).ok_or(Issue::CodexProviderTableMissing)?;
    if table
        .get("wire_api")
        .is_some_and(|v| v.as_str() != Some("responses"))
    {
        report.flag(Issue::CodexWireApiNotResponses);
    }
    let url = table
        .get("base_url")
        .and_then(Item::as_str)
        .unwrap_or_default();
    let expected_url = expected
        .get("base_url")
        .and_then(Item::as_str)
        .unwrap_or_default();
    let declared = codex::declared_auth(table);
    if auth != codex::RouteAuth::Bearer || declared.is_some() {
        if url.trim_end_matches('/') != expected_url.trim_end_matches('/') {
            report.flag(Issue::EndpointMismatch);
        }
        // Commands, environment references and user-supplied auth headers cannot prove cloud-key equality.
        return Err(match auth {
            codex::RouteAuth::EnvKey | codex::RouteAuth::Headers => Issue::ExternalAuth,
            codex::RouteAuth::None => Issue::KeyMissing,
            codex::RouteAuth::Bearer => Issue::AuthSource,
        });
    }
    let bearer = |t: &dyn TableLike| {
        t.get("experimental_bearer_token")
            .and_then(Item::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    report.credentials(
        url,
        &bearer(table),
        &(expected_url.to_owned(), bearer(&expected)),
    );
    let login = codex_login(
        live,
        crate::settings::preserve_codex_official_auth_on_switch(),
    );
    if table.get("requires_openai_auth").and_then(Item::as_bool)
        != Some(codex::requires_openai_auth(auth, login))
    {
        report.flag(Issue::AuthSource);
    }
    Ok(())
}

fn codex_login(live: &Value, opaque_store_login: bool) -> bool {
    use crate::codex_config::{
        codex_auth_has_openai_account_material, codex_config_auth_store_mode, CodexAuthStoreMode,
    };
    match codex_config_auth_store_mode(string(live, "/config")) {
        CodexAuthStoreMode::File => codex_auth_has_openai_account_material(&live["auth"]),
        CodexAuthStoreMode::Ephemeral => false,
        _ => opaque_store_login,
    }
}

fn proxy_matches(app: &AppType, live: &Value, origin: &str, codex_url: &str) -> bool {
    let at = |path| string(live, path).trim_end_matches('/');
    match app {
        AppType::Claude => {
            let keys = [
                string(live, "/env/ANTHROPIC_AUTH_TOKEN"),
                string(live, "/env/ANTHROPIC_API_KEY"),
            ];
            at("/env/ANTHROPIC_BASE_URL") == origin
                && !claude_uses_other_auth(live)
                && keys
                    .iter()
                    .copied()
                    .filter(|k| !k.is_empty())
                    .eq([PROXY_TOKEN_PLACEHOLDER])
        }
        AppType::Gemini => {
            at("/env/GOOGLE_GEMINI_BASE_URL") == origin
                && string(live, "/env/GEMINI_API_KEY") == PROXY_TOKEN_PLACEHOLDER
                && string(live, "/config/security/auth/selectedType")
                    == gemini::SELECTED_TYPE_API_KEY
        }
        AppType::GrokBuild => crate::grok_config::extract_model_config(string(live, "/config"))
            .is_some_and(|model| {
                model.base_url == grok::proxy_base_url(origin)
                    && model.api_key.as_deref() == Some(PROXY_TOKEN_PLACEHOLDER)
                    && model.api_backend == grok::PROXY_API_BACKEND
            }),
        AppType::Codex => {
            let text = string(live, "/config");
            let Ok(doc) = text.parse::<DocumentMut>() else {
                return false;
            };
            let login =
                !crate::settings::codex_proxy_without_official_login() && codex_login(live, true);
            let official = login
                && crate::codex_config::codex_config_routes_official_to_proxy(text, |url| {
                    url == codex_url
                });
            let Some(table) = active_table(&doc) else {
                return official;
            };
            let token = table
                .get("experimental_bearer_token")
                .and_then(Item::as_str);
            table
                .get("base_url")
                .and_then(Item::as_str)
                .is_some_and(|url| url.trim_end_matches('/') == codex_url)
                && table.get("wire_api").and_then(Item::as_str) == Some("responses")
                && codex::declared_auth(table).is_none()
                && ((token == Some(PROXY_TOKEN_PLACEHOLDER)
                    && table
                        .get("requires_openai_auth")
                        .and_then(Item::as_bool)
                        .unwrap_or(false)
                        == login)
                    || (token.is_none() && official))
        }
        _ => false,
    }
}
