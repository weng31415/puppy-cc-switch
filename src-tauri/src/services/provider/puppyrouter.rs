//! PuppyRouter-owned provider identity and cloud-key projection.
//!
//! Seeding is database-only. Applying a key goes through ProviderService::update,
//! so the upstream mode controller retains ownership of live configuration.
use super::*;
use crate::provider::{ClaudeDesktopMode, UniversalProvider, UniversalProviderApps};
use serde_json::json;

pub(crate) const BASE_URL: &str = "https://puppyrouter.com";
pub(crate) const UNIVERSAL_ID: &str = "puppyrouter";

pub(crate) fn provider_id(app: &AppType) -> &'static str {
    match app {
        AppType::Claude => "universal-claude-puppyrouter",
        AppType::ClaudeDesktop => "universal-claude-desktop-puppyrouter",
        AppType::Codex => "universal-codex-puppyrouter",
        AppType::Gemini => "universal-gemini-puppyrouter",
        AppType::GrokBuild => "universal-grokbuild-puppyrouter",
        AppType::OpenCode => "puppyrouter",
        AppType::OpenClaw
        | AppType::Hermes
        | AppType::Pi
        | AppType::Mcode
        | AppType::Kimi
        | AppType::Dsh
        | AppType::Agy
        | AppType::Omp
        | AppType::Copilot
        | AppType::WorkBuddy => "puppyrouter-cloud",
    }
}

pub(crate) fn is_puppyrouter(app: &AppType, id: &str) -> bool {
    id == provider_id(app)
}

pub(crate) fn owns(app: &AppType, provider: &Provider) -> bool {
    is_puppyrouter(app, &provider.id)
        && (provider.id != "puppyrouter-cloud"
            || provider
                .meta
                .as_ref()
                .and_then(|m| m.provider_type.as_deref())
                == Some("puppyrouter"))
}

pub(crate) fn locked_row(state: &AppState, app: &AppType, id: &str) -> Result<bool, AppError> {
    if id != "puppyrouter-cloud" || !is_puppyrouter(app, id) {
        return Ok(is_locked(app, id));
    }
    Ok(state
        .db
        .get_provider_by_id(id, app)?
        .is_some_and(|p| owns(app, &p)))
}

pub(crate) fn is_default_official(app: &AppType, id: &str) -> bool {
    matches!(
        (app, id),
        (AppType::Claude, "claude-official")
            | (AppType::ClaudeDesktop, "claude-desktop-official")
            | (AppType::Codex, "codex-official")
            | (AppType::Gemini, "gemini-official")
            | (AppType::GrokBuild, "grokbuild-official")
    )
}

pub(crate) fn is_locked(app: &AppType, id: &str) -> bool {
    is_puppyrouter(app, id) || is_default_official(app, id)
}

pub(super) fn prepare_update(
    state: &AppState,
    app: &AppType,
    original_id: Option<&str>,
    provider: &mut Provider,
) -> Result<(), AppError> {
    if let Some(id) = original_id.filter(|id| *id != provider.id) {
        if locked_row(state, app, id)? || is_locked(app, &provider.id) {
            return Err(AppError::InvalidInput(
                "Default provider IDs cannot be changed".into(),
            ));
        }
    }
    if provider.id == "puppyrouter-cloud" && is_puppyrouter(app, &provider.id) {
        // The database owns this marker. Editors may omit it and older custom rows may share this ID.
        let saved = state.db.get_provider_by_id(&provider.id, app)?;
        if saved.as_ref().is_some_and(|row| owns(app, row)) {
            provider
                .meta
                .get_or_insert_with(Default::default)
                .provider_type = Some("puppyrouter".into());
        } else if owns(app, provider) {
            return Err(AppError::InvalidInput(
                "The default provider ID belongs to an existing custom card".into(),
            ));
        }
    }
    normalize_identity(app, provider);
    Ok(())
}

pub(crate) fn normalize_identity(app: &AppType, provider: &mut Provider) {
    if owns(app, provider) {
        provider.name = "PuppyRouter".into();
        provider.website_url = Some(BASE_URL.into());
        provider.category = Some("aggregator".into());
        provider.sort_index.get_or_insert(0);
        provider
            .meta
            .get_or_insert_with(Default::default)
            .provider_type = Some("puppyrouter".into());
    } else if is_default_official(app, &provider.id) {
        provider.category = Some("official".into());
        provider.sort_index.get_or_insert(1);
    }
}

fn set_path(root: &mut Value, path: &[&str], value: Value) -> Result<(), AppError> {
    if path.is_empty() {
        *root = value;
        return Ok(());
    }
    if root.is_null() {
        *root = json!({});
    }
    if !root.is_object() {
        return Err(AppError::InvalidInput(
            "Invalid nested PuppyRouter configuration".into(),
        ));
    }
    set_path(&mut root[path[0]], &path[1..], value)
}

/// Change only the credential. Existing model catalogs, protocol selections,
/// reasoning settings, metadata and per-app keys stay owned by their app row.
pub(crate) fn with_api_key(
    app: &AppType,
    existing: &Provider,
    key: &str,
) -> Result<Provider, AppError> {
    if !existing.settings_config.is_object() {
        return Err(AppError::InvalidInput(
            "PuppyRouter configuration must be an object".into(),
        ));
    }
    let mut provider = existing.clone();
    let settings = &mut provider.settings_config;
    let key_value = Value::String(key.to_string());
    let base = json!(format!("{BASE_URL}/v1"));
    match app {
        AppType::Claude | AppType::ClaudeDesktop => {
            set_path(settings, &["env", "ANTHROPIC_AUTH_TOKEN"], key_value)?;
            set_path(settings, &["env", "ANTHROPIC_BASE_URL"], json!(BASE_URL))?;
            if let Some(env) = settings.get_mut("env").and_then(Value::as_object_mut) {
                env.remove("ANTHROPIC_API_KEY");
            }
        }
        AppType::Codex => {
            set_path(settings, &["auth", "OPENAI_API_KEY"], key_value)?;
            if let Some(config) = settings.get("config").and_then(Value::as_str) {
                let mut doc = config
                    .parse::<toml_edit::DocumentMut>()
                    .map_err(|_| AppError::InvalidInput("Invalid Codex config".into()))?;
                let name = doc
                    .get("model_provider")
                    .and_then(toml_edit::Item::as_str)
                    .unwrap_or("custom")
                    .to_string();
                if let Some(table) = doc
                    .get_mut("model_providers")
                    .and_then(toml_edit::Item::as_table_like_mut)
                    .and_then(|providers| providers.get_mut(&name))
                    .and_then(toml_edit::Item::as_table_like_mut)
                {
                    table.insert("base_url", toml_edit::value(format!("{BASE_URL}/v1")));
                    let declares_auth = ["env_key", "auth", "aws"]
                        .iter()
                        .any(|field| table.contains_key(field))
                        || ["http_headers", "env_http_headers"].iter().any(|field| {
                            table
                                .get(field)
                                .and_then(toml_edit::Item::as_table_like)
                                .is_some_and(|headers| {
                                    headers
                                        .iter()
                                        .any(|(name, _)| name.eq_ignore_ascii_case("authorization"))
                                })
                        });
                    if !declares_auth {
                        table.insert("experimental_bearer_token", toml_edit::value(key));
                        table.insert("requires_openai_auth", toml_edit::value(true));
                    }
                }
                let rendered = doc.to_string();
                if crate::codex_config::extract_codex_base_url(&rendered).as_deref()
                    != Some("https://puppyrouter.com/v1")
                {
                    return Err(AppError::InvalidInput(
                        "The PuppyRouter Codex provider needs its own model provider table".into(),
                    ));
                }
                settings["config"] = Value::String(rendered);
            } else {
                return Err(AppError::InvalidInput(
                    "Missing PuppyRouter Codex configuration".into(),
                ));
            }
        }
        AppType::Gemini | AppType::Agy => {
            set_path(settings, &["env", "GEMINI_API_KEY"], key_value)?;
            set_path(
                settings,
                &["env", "GOOGLE_GEMINI_BASE_URL"],
                json!(BASE_URL),
            )?;
        }
        AppType::GrokBuild => {
            let config = settings
                .get("config")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let mut doc = config
                .parse::<toml_edit::DocumentMut>()
                .map_err(|_| AppError::InvalidInput("Invalid Grok Build configuration".into()))?;
            let selected = crate::grok_config::extract_model_config(config).ok_or_else(|| {
                AppError::InvalidInput("Grok Build model profile is missing".into())
            })?;
            doc["model"][&selected.profile]["api_key"] = toml_edit::value(key);
            doc["model"][&selected.profile]["base_url"] =
                toml_edit::value(format!("{BASE_URL}/v1"));
            if let Some(table) = doc["model"][&selected.profile].as_table_like_mut() {
                table.remove("env_key");
            }
            settings["config"] = Value::String(doc.to_string());
        }
        AppType::OpenCode => {
            use crate::provider::OpenCodeConfigFormat;
            let (_, format) = crate::opencode_config::provider_fragment(
                &existing.id,
                settings,
                existing.opencode_config_format(),
            )?;
            let (group, options) = match format {
                OpenCodeConfigFormat::V1 => ("provider", "options"),
                OpenCodeConfigFormat::V2 => ("providers", "settings"),
            };
            let fragment = if settings
                .get(group)
                .and_then(|rows| rows.get(&existing.id))
                .is_some()
            {
                &mut settings[group][&existing.id]
            } else {
                settings
            };
            set_path(fragment, &[options, "apiKey"], key_value)?;
            set_path(fragment, &[options, "baseURL"], base)?;
        }
        AppType::Mcode | AppType::Dsh => {
            set_path(settings, &["options", "apiKey"], key_value)?;
            set_path(settings, &["options", "baseURL"], base)?;
        }
        AppType::OpenClaw | AppType::Pi | AppType::Omp => {
            set_path(settings, &["apiKey"], key_value)?;
            set_path(settings, &["baseUrl"], base)?;
        }
        AppType::WorkBuddy => {
            set_path(settings, &["apiKey"], key_value)?;
            set_path(
                settings,
                &["url"],
                json!(format!("{BASE_URL}/v1/chat/completions")),
            )?;
            // Native per-model overrides outrank the shared credential and endpoint.
            if let Some(models) = settings.get_mut("models").and_then(Value::as_array_mut) {
                for model in models {
                    if let Some(model) = model.as_object_mut() {
                        model.remove("apiKey");
                        model.remove("url");
                    }
                }
            }
        }
        AppType::Hermes => {
            set_path(settings, &["api_key"], key_value)?;
            set_path(settings, &["base_url"], base)?;
        }
        AppType::Kimi => {
            set_path(settings, &["provider", "api_key"], key_value)?;
            set_path(settings, &["provider", "base_url"], base)?;
            if let Some(p) = settings.get_mut("provider").and_then(Value::as_object_mut) {
                p.remove("api_key_env");
            }
        }
        AppType::Copilot => {
            set_path(settings, &["provider", "apiKey"], key_value)?;
            set_path(settings, &["provider", "baseUrl"], base)?;
            if let Some(provider) = settings.get_mut("provider").and_then(Value::as_object_mut) {
                provider.remove("bearerToken");
            }
        }
    }
    normalize_identity(app, &mut provider);
    Ok(provider)
}

pub(crate) fn default_provider(
    app: &AppType,
    universal: &UniversalProvider,
) -> Result<Provider, AppError> {
    // New application cards wait for an explicit per-app key selection even when the legacy universal card has a key.
    let mut template = universal.clone();
    if provider_id(app) == "puppyrouter-cloud" {
        template.api_key.clear();
    }
    let universal = &template;
    let model = universal
        .models
        .codex
        .as_ref()
        .and_then(|m| m.model.as_deref())
        .unwrap_or("gpt-5.5");
    let base = format!("{BASE_URL}/v1");
    let key = &universal.api_key;
    let native_model = json!({"id":model,"name":model,"input":["text"],"reasoning":false,"contextWindow":128000,"maxTokens":16384,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}});
    let mut provider = match app {
        AppType::Claude | AppType::ClaudeDesktop => universal.to_claude_provider(),
        AppType::Codex => universal.to_codex_provider(),
        AppType::Gemini | AppType::Agy => universal.to_gemini_provider(),
        _ => None,
    }
    .unwrap_or_else(|| {
        Provider::with_id(
            provider_id(app).into(),
            "PuppyRouter".into(),
            json!({}),
            Some(BASE_URL.into()),
        )
    });
    provider.id = provider_id(app).into();
    match app {
        AppType::Claude
        | AppType::ClaudeDesktop
        | AppType::Codex
        | AppType::Gemini
        | AppType::Agy => {}
        AppType::GrokBuild => {
            provider.settings_config =
                json!({"config":crate::grok_config::build_puppyrouter_config(None, key)})
        }
        AppType::OpenCode => {
            provider.settings_config = json!({"npm":"@ai-sdk/openai-compatible","name":"PuppyRouter","options":{"baseURL":base,"apiKey":key},"models":{model:{"name":model,"limit":{"context":128000,"output":16384}}}})
        }
        AppType::OpenClaw => {
            provider.settings_config = json!({"baseUrl":base,"apiKey":key,"api":"openai-completions","models":[native_model]})
        }
        AppType::Hermes => {
            provider.settings_config = json!({"name":"PuppyRouter","base_url":base,"api_key":key,"api_mode":"chat_completions","models":[{"id":model,"context_length":128000}],"model":model})
        }
        AppType::Pi | AppType::Omp => {
            provider.settings_config = json!({"baseUrl":base,"apiKey":key,"api":"openai-completions","models":[native_model]})
        }
        AppType::Mcode | AppType::Dsh => {
            provider.settings_config = json!({"name":"PuppyRouter","kind":"custom","enabled":true,"api":"openai-completions","options":{"baseURL":base,"apiKey":key},"models":{model:{"name":model,"limit":{"context":128000,"output":16384}}}})
        }
        AppType::Kimi => {
            provider.settings_config = json!({"provider":{"type":"openai","base_url":base,"api_key":key},"models":{model:{"model":model,"max_context_size":128000,"capabilities":["tool_use"]}}})
        }
        AppType::Copilot => {
            provider.settings_config = json!({"provider":{"type":"openai","baseUrl":base,"apiKey":key},"models":[{"id":model,"maxContextWindowTokens":128000}]})
        }
        AppType::WorkBuddy => {
            provider.settings_config = json!({"vendor":"PuppyRouter","url":format!("{base}/chat/completions"),"apiKey":key,"models":[{"id":model,"supportsToolCall":true}]})
        }
    }
    if matches!(app, AppType::ClaudeDesktop) {
        provider
            .meta
            .get_or_insert_with(Default::default)
            .claude_desktop_mode = Some(ClaudeDesktopMode::Direct);
    }
    if app.spec().additive {
        provider
            .meta
            .get_or_insert_with(Default::default)
            .live_config_managed = Some(false);
    }
    provider
        .meta
        .get_or_insert_with(Default::default)
        .provider_type = Some("puppyrouter".into());
    normalize_identity(app, &mut provider);
    Ok(provider)
}

impl ProviderService {
    /// Must never write a client file or overwrite an existing per-app key.
    pub fn ensure_locked_puppyrouter_defaults(state: &AppState) -> Result<(), AppError> {
        for (app, id) in [
            (AppType::Claude, "claude-official"),
            (AppType::ClaudeDesktop, "claude-desktop-official"),
            (AppType::Codex, "codex-official"),
            (AppType::Gemini, "gemini-official"),
            (AppType::GrokBuild, "grokbuild-official"),
        ] {
            state.db.ensure_official_seed_by_id(id, app)?;
        }
        let existing = state.db.get_universal_provider(UNIVERSAL_ID)?;
        let universal = Self::puppyrouter_universal_provider(existing);
        state.db.save_universal_provider(&universal)?;
        for app in AppType::all() {
            let id = provider_id(&app);
            let mut provider = match state.db.get_provider_by_id(id, &app)? {
                Some(provider)
                    if id == "puppyrouter-cloud"
                        && provider
                            .meta
                            .as_ref()
                            .and_then(|m| m.provider_type.as_deref())
                            != Some("puppyrouter") =>
                {
                    continue
                }
                Some(provider) => provider,
                None => default_provider(&app, &universal)?,
            };
            // Older desktop versions stored literal PuppyRouter tokens without the API prefix.
            // Leave native environment references and proxy placeholders in the user's configuration.
            if id != "puppyrouter-cloud" {
                let (endpoint, old_key) = match app {
                    AppType::GrokBuild => provider.settings_config["config"]
                        .as_str()
                        .and_then(crate::grok_config::extract_model_config)
                        .map(|model| (model.base_url, model.api_key.unwrap_or_default()))
                        .unwrap_or_default(),
                    AppType::Claude | AppType::ClaudeDesktop => {
                        let env = &provider.settings_config["env"];
                        (
                            env["ANTHROPIC_BASE_URL"]
                                .as_str()
                                .unwrap_or_default()
                                .into(),
                            env["ANTHROPIC_AUTH_TOKEN"]
                                .as_str()
                                .or(env["ANTHROPIC_API_KEY"].as_str())
                                .unwrap_or_default()
                                .into(),
                        )
                    }
                    _ => provider.resolve_usage_credentials(&app),
                };
                let key = old_key.trim();
                let trusted = url::Url::parse(&endpoint).ok().is_some_and(|url| {
                    url.scheme() == "https"
                        && matches!(
                            url.host_str(),
                            Some("puppyrouter.com" | "www.puppyrouter.com")
                        )
                });
                if trusted
                    && !key.is_empty()
                    && !key.starts_with("sk-")
                    && !key.eq_ignore_ascii_case("PROXY_MANAGED")
                    && key
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
                {
                    match with_api_key(&app, &provider, &format!("sk-{key}")) {
                        Ok(repaired) => provider = repaired,
                        Err(_) => log::warn!(
                            "Leaving an unrecognized legacy {} provider configuration intact",
                            app.as_str()
                        ),
                    }
                }
            }
            if matches!(app, AppType::Claude | AppType::ClaudeDesktop) {
                // Upgrade only historical defaults. Per-app model aliases can differ from the universal card.
                if let (Some(env), Some(models)) = (
                    provider.settings_config["env"].as_object_mut(),
                    universal.models.claude.as_ref(),
                ) {
                    for (field, legacy, default) in [
                        ("ANTHROPIC_MODEL", "claude-sonnet-4-6", &models.model),
                        (
                            "ANTHROPIC_DEFAULT_SONNET_MODEL",
                            "claude-sonnet-4-6",
                            &models.sonnet_model,
                        ),
                        (
                            "ANTHROPIC_DEFAULT_OPUS_MODEL",
                            "claude-opus-4-8",
                            &models.opus_model,
                        ),
                        ("ANTHROPIC_DEFAULT_FABLE_MODEL", "", &models.fable_model),
                    ] {
                        if let Some(default) = default {
                            if env.get(field).is_none_or(|v| {
                                v.as_str()
                                    .is_some_and(|v| v.trim().is_empty() || v == legacy)
                            }) {
                                env.insert(field.into(), json!(default));
                            }
                        }
                    }
                }
            }
            normalize_identity(&app, &mut provider);
            state.db.save_provider(&app, &provider)?;
        }
        Ok(())
    }
}

use crate::provider::{ClaudeModelConfig, CodexModelConfig, GeminiModelConfig};

const PUPPYROUTER_UNIVERSAL_ID: &str = UNIVERSAL_ID;
const PUPPYROUTER_NAME: &str = "PuppyRouter";
const PUPPYROUTER_BASE_URL: &str = BASE_URL;
const PUPPYROUTER_PROVIDER_TYPE: &str = "puppyrouter";
const PUPPYROUTER_CLAUDE_SONNET_MODEL: &str = "claude-sonnet-5";
const PUPPYROUTER_CLAUDE_OPUS_MODEL: &str = "claude-opus-5";
const PUPPYROUTER_CLAUDE_FABLE_MODEL: &str = "claude-fable-5";
const PUPPYROUTER_CLAUDE_HAIKU_MODEL: &str = "claude-haiku-4-5-20251001";

impl ProviderService {
    fn set_puppyrouter_model_default(
        model: &mut Option<String>,
        legacy_defaults: &[&str],
        current_default: &str,
    ) {
        let should_replace = match model.as_deref().map(str::trim) {
            None | Some("") => true,
            Some(value) => legacy_defaults.contains(&value),
        };
        if should_replace {
            *model = Some(current_default.to_string());
        }
    }
    pub(super) fn puppyrouter_universal_provider(
        existing: Option<crate::provider::UniversalProvider>,
    ) -> crate::provider::UniversalProvider {
        let mut provider = existing.unwrap_or_else(|| {
            crate::provider::UniversalProvider::new(
                PUPPYROUTER_UNIVERSAL_ID.to_string(),
                PUPPYROUTER_NAME.to_string(),
                PUPPYROUTER_PROVIDER_TYPE.to_string(),
                PUPPYROUTER_BASE_URL.to_string(),
                String::new(),
            )
        });

        provider.id = PUPPYROUTER_UNIVERSAL_ID.to_string();
        provider.name = PUPPYROUTER_NAME.to_string();
        provider.provider_type = PUPPYROUTER_PROVIDER_TYPE.to_string();
        provider.base_url = PUPPYROUTER_BASE_URL.to_string();
        provider.apps = UniversalProviderApps {
            claude: true,
            codex: true,
            gemini: true,
        };
        provider.website_url = Some(PUPPYROUTER_BASE_URL.to_string());
        provider.icon = Some("openai".to_string());
        provider.icon_color = Some("#F59E0B".to_string());
        provider.sort_index = Some(0);

        let models = &mut provider.models;
        let claude = models.claude.get_or_insert_with(ClaudeModelConfig::default);
        Self::set_puppyrouter_model_default(
            &mut claude.model,
            &["claude-sonnet-4-6"],
            PUPPYROUTER_CLAUDE_SONNET_MODEL,
        );
        Self::set_puppyrouter_model_default(
            &mut claude.haiku_model,
            &[],
            PUPPYROUTER_CLAUDE_HAIKU_MODEL,
        );
        Self::set_puppyrouter_model_default(
            &mut claude.sonnet_model,
            &["claude-sonnet-4-6"],
            PUPPYROUTER_CLAUDE_SONNET_MODEL,
        );
        Self::set_puppyrouter_model_default(
            &mut claude.opus_model,
            &["claude-opus-4-8"],
            PUPPYROUTER_CLAUDE_OPUS_MODEL,
        );
        Self::set_puppyrouter_model_default(
            &mut claude.fable_model,
            &[],
            PUPPYROUTER_CLAUDE_FABLE_MODEL,
        );

        let codex = models.codex.get_or_insert_with(CodexModelConfig::default);
        codex.model.get_or_insert_with(|| "gpt-5.5".to_string());
        codex
            .reasoning_effort
            .get_or_insert_with(|| "high".to_string());

        let gemini = models.gemini.get_or_insert_with(GeminiModelConfig::default);
        gemini
            .model
            .get_or_insert_with(|| "gemini-3.5-flash".to_string());

        provider
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use std::sync::Arc;

    #[test]
    fn every_cloud_key_adapter_passes_native_validation_and_preserves_metadata() {
        let universal = ProviderService::puppyrouter_universal_provider(None);
        for app in AppType::all() {
            let mut before = default_provider(&app, &universal).unwrap();
            before.notes = Some("keep my notes".into());
            before.created_at = Some(42);
            before.in_failover_queue = true;
            let after = with_api_key(&app, &before, "sk-isolated-fixture").unwrap();
            ProviderService::validate_provider_settings(&app, &after)
                .unwrap_or_else(|error| panic!("{}: {error}", app.as_str()));
            let (base, key) = after.resolve_usage_credentials(&app);
            assert!(base.starts_with(BASE_URL), "{}: {base}", app.as_str());
            assert_eq!(key, "sk-isolated-fixture", "{}", app.as_str());
            assert_eq!(after.notes, before.notes);
            assert_eq!(after.created_at, before.created_at);
            assert_eq!(after.in_failover_queue, before.in_failover_queue);
            assert_eq!(
                serde_json::to_value(after.meta).unwrap(),
                serde_json::to_value(before.meta).unwrap()
            );
        }
    }

    #[test]
    fn a_preexisting_custom_card_can_move_out_of_the_reserved_id() {
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        let app = AppType::Mcode;
        let mut custom =
            default_provider(&app, &ProviderService::puppyrouter_universal_provider(None)).unwrap();
        custom.meta = None;
        custom.name = "User relay".into();
        state.db.save_provider(&app, &custom).unwrap();
        ProviderService::ensure_locked_puppyrouter_defaults(&state).unwrap();
        let mut saved = state
            .db
            .get_provider_by_id(&custom.id, &app)
            .unwrap()
            .unwrap();
        assert_eq!(saved.name, "User relay");
        assert!(!locked_row(&state, &app, &custom.id).unwrap());
        saved.id = "user-relay".into();
        prepare_update(&state, &app, Some(&custom.id), &mut saved).unwrap();
        assert_eq!(saved.name, "User relay");
        let different = AppType::Pi;
        let mut builtin = state
            .db
            .get_provider_by_id(provider_id(&different), &different)
            .unwrap()
            .unwrap();
        builtin.meta = None;
        prepare_update(&state, &different, None, &mut builtin).unwrap();
        assert!(owns(&different, &builtin));
    }

    #[test]
    fn legacy_raw_claude_key_is_repaired_without_changing_the_user_model() {
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        let app = AppType::Claude;
        let mut row =
            default_provider(&app, &ProviderService::puppyrouter_universal_provider(None)).unwrap();
        row.settings_config["env"]["ANTHROPIC_AUTH_TOKEN"] = json!("raw-fixture-token");
        row.settings_config["env"]["ANTHROPIC_MODEL"] = json!("user-model");
        state.db.save_provider(&app, &row).unwrap();
        ProviderService::ensure_locked_puppyrouter_defaults(&state).unwrap();
        let repaired = state.db.get_provider_by_id(&row.id, &app).unwrap().unwrap();
        assert_eq!(
            repaired.resolve_usage_credentials(&app).1,
            "sk-raw-fixture-token"
        );
        assert_eq!(
            repaired.settings_config["env"]["ANTHROPIC_MODEL"],
            "user-model"
        );
    }

    #[test]
    fn native_opencode_cloud_key_uses_the_declared_v2_settings() {
        let app = AppType::OpenCode;
        let mut row =
            default_provider(&app, &ProviderService::puppyrouter_universal_provider(None)).unwrap();
        row.settings_config = json!({"package":"@ai-sdk/openai-compatible","settings":{"headers":{"X-Fixture":"keep"}}});
        let saved = with_api_key(&app, &row, "sk-native-fixture").unwrap();
        assert_eq!(
            saved.settings_config["settings"]["headers"]["X-Fixture"],
            "keep"
        );
        assert!(saved.settings_config.get("options").is_none());
        assert_eq!(
            saved.resolve_usage_credentials(&app),
            (format!("{BASE_URL}/v1"), "sk-native-fixture".into())
        );
    }

    #[test]
    fn reseeding_keeps_per_app_keys_models_and_custom_rows() {
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        ProviderService::ensure_locked_puppyrouter_defaults(&state).unwrap();
        for app in AppType::all() {
            let id = provider_id(&app);
            let mut row = state.db.get_provider_by_id(id, &app).unwrap().unwrap();
            row = with_api_key(&app, &row, &format!("sk-fixture-{}", app.as_str())).unwrap();
            row.notes = Some("user notes".into());
            row.settings_config["userExtension"] = json!({"model":"my-custom-model","keep":true});
            state.db.save_provider(&app, &row).unwrap();
            let custom = Provider::with_id(
                "my-provider".into(),
                "User provider".into(),
                json!({}),
                None,
            );
            state.db.save_provider(&app, &custom).unwrap();
        }
        ProviderService::ensure_locked_puppyrouter_defaults(&state).unwrap();
        for app in AppType::all() {
            let row = state
                .db
                .get_provider_by_id(provider_id(&app), &app)
                .unwrap()
                .unwrap();
            assert_eq!(
                row.resolve_usage_credentials(&app).1,
                format!("sk-fixture-{}", app.as_str())
            );
            assert_eq!(
                row.settings_config["userExtension"]["model"],
                "my-custom-model"
            );
            assert_eq!(row.notes.as_deref(), Some("user notes"));
            assert!(state
                .db
                .get_provider_by_id("my-provider", &app)
                .unwrap()
                .is_some());
            assert!(ProviderService::delete(&state, app, &row.id).is_err());
        }
        assert!(ProviderService::delete_universal(&state, UNIVERSAL_ID).is_err());
    }

    #[test]
    fn cloud_key_projection_preserves_codex_credential_sources_and_grok_settings() {
        let universal = ProviderService::puppyrouter_universal_provider(None);
        for auth in [
            "env_key = \"MY_TOKEN\"",
            "auth = { command = \"credential-helper\" }",
            "aws = { profile = \"my-profile\" }",
            "http_headers = { Authorization = \"fixture\" }",
        ] {
            let mut row = default_provider(&AppType::Codex, &universal).unwrap();
            row.settings_config["config"] = json!(format!("model_provider = \"mine\"\nmodel = \"my-model\"\n[model_providers.mine]\nbase_url = \"https://example.invalid\"\n{auth}\n"));
            let projected = with_api_key(&AppType::Codex, &row, "sk-fixture").unwrap();
            let text = projected.settings_config["config"].as_str().unwrap();
            assert!(text.contains(auth));
            assert!(!text.contains("experimental_bearer_token"));
            assert!(!text.contains("requires_openai_auth"));
            assert!(text.contains("my-model"));
        }
        let mut grok = default_provider(&AppType::GrokBuild, &universal).unwrap();
        grok.settings_config["config"] = json!(format!(
            "{}\n[settings]\ntheme = \"dark\"\n",
            grok.settings_config["config"].as_str().unwrap()
        ));
        let projected = with_api_key(&AppType::GrokBuild, &grok, "sk-fixture").unwrap();
        assert!(projected.settings_config["config"]
            .as_str()
            .unwrap()
            .contains("theme = \"dark\""));
        grok.settings_config["config"] = json!("[broken");
        assert!(with_api_key(&AppType::GrokBuild, &grok, "sk-fixture").is_err());
    }
}
