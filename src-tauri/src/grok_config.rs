use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

use crate::config::{get_home_dir, write_text_file};
use crate::error::AppError;
use crate::provider::Provider;

pub const DEFAULT_MODEL: &str = "grok-4.5";
pub const DEFAULT_API_BACKEND: &str = "responses";
pub const DEFAULT_CONTEXT_WINDOW: i64 = 500_000;
pub const PUPPYROUTER_BASE_URL: &str = "https://puppyrouter.com/v1";
pub const PUPPYROUTER_PROVIDER_NAME: &str = "PuppyRouter";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrokModelConfig {
    pub profile: String,
    pub model: String,
    pub base_url: String,
    pub name: String,
    pub api_key: Option<String>,
    pub api_backend: String,
    pub context_window: i64,
}

/// Grok Build configuration directory (`~/.grok`).
pub fn get_grok_config_dir() -> PathBuf {
    crate::settings::get_grok_override_dir().unwrap_or_else(|| get_home_dir().join(".grok"))
}

/// Grok Build live configuration path (`~/.grok/config.toml`).
pub fn get_grok_config_path() -> PathBuf {
    get_grok_config_dir().join("config.toml")
}

fn required_non_empty_string<'a>(
    table: &'a toml::value::Table,
    key: &str,
) -> Result<&'a str, AppError> {
    table
        .get(key)
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::localized(
                "provider.grokbuild.field.missing",
                format!("Grok Build 配置缺少有效的 {key} 字段"),
                format!("Grok Build configuration is missing a valid {key} field"),
            )
        })
}

fn optional_non_empty_string(table: &toml::value::Table, key: &str) -> Option<String> {
    table
        .get(key)
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

/// Validate a Grok Build document without requiring a custom model table.
///
/// Official Grok Build mode has no `[models]` or `[model.*]` sections and
/// uses the application's native login state. Full validation remains required
/// for PuppyRouter and every custom provider.
pub fn validate_config_toml_syntax(config_toml: &str) -> Result<(), AppError> {
    if config_toml.trim().is_empty() {
        return Ok(());
    }

    config_toml
        .parse::<toml::Value>()
        .map(|_| ())
        .map_err(|error| {
            AppError::localized(
                "provider.grokbuild.config.invalid_toml",
                format!("Grok Build config.toml 格式错误: {error}"),
                format!("Invalid Grok Build config.toml: {error}"),
            )
        })
}

/// Official mode has no custom model routing. Extra non-model settings are
/// preserved verbatim so switching back does not erase them.
pub fn is_official_live_config(config_toml: &str) -> bool {
    let Ok(document) = config_toml.parse::<toml::Value>() else {
        return false;
    };

    document
        .as_table()
        .is_some_and(|root| !root.contains_key("models") && !root.contains_key("model"))
}

/// Validate the official Grok Build state. Official mode must not carry a
/// custom model table, otherwise an entry labelled "Official" could silently
/// route requests through a third party.
pub fn validate_official_config_toml(config_toml: &str) -> Result<(), AppError> {
    validate_config_toml_syntax(config_toml)?;

    if !is_official_live_config(config_toml) {
        return Err(AppError::localized(
            "provider.grokbuild.official.custom_model_unsupported",
            "Grok Official 配置不能包含自定义模型路由。",
            "Grok Official configuration cannot contain custom model routing.",
        ));
    }

    Ok(())
}

/// Validate the provider-owned Grok Build TOML document.
///
/// PuppyRouter intentionally requires an inline `api_key`. It never resolves
/// credentials from `env_key` or `XAI_API_KEY`, so the selected local provider
/// remains the only source of the live credential.
pub fn validate_config_toml(config_toml: &str) -> Result<(), AppError> {
    let document = config_toml.parse::<toml::Value>().map_err(|error| {
        AppError::localized(
            "provider.grokbuild.config.invalid_toml",
            format!("Grok Build config.toml 格式错误: {error}"),
            format!("Invalid Grok Build config.toml: {error}"),
        )
    })?;

    let root = document.as_table().ok_or_else(|| {
        AppError::localized(
            "provider.grokbuild.config.not_table",
            "Grok Build 配置必须是 TOML 表结构",
            "Grok Build configuration must be a TOML table",
        )
    })?;
    let models = root
        .get("models")
        .and_then(toml::Value::as_table)
        .ok_or_else(|| {
            AppError::localized(
                "provider.grokbuild.models.missing",
                "Grok Build 配置缺少 [models]",
                "Grok Build configuration is missing [models]",
            )
        })?;
    let default_model = required_non_empty_string(models, "default")?;
    let model_entries = root
        .get("model")
        .and_then(toml::Value::as_table)
        .ok_or_else(|| {
            AppError::localized(
                "provider.grokbuild.model.missing",
                "Grok Build 配置缺少 [model.<name>]",
                "Grok Build configuration is missing [model.<name>]",
            )
        })?;
    let selected_model = model_entries
        .get(default_model)
        .and_then(toml::Value::as_table)
        .ok_or_else(|| {
            AppError::localized(
                "provider.grokbuild.default_model.missing",
                format!("Grok Build 配置缺少 [model.\"{default_model}\"]"),
                format!("Grok Build configuration is missing [model.\"{default_model}\"]"),
            )
        })?;

    required_non_empty_string(selected_model, "model")?;
    required_non_empty_string(selected_model, "base_url")?;
    required_non_empty_string(selected_model, "name")?;
    required_non_empty_string(selected_model, "api_key").map_err(|_| {
        AppError::localized(
            "provider.grokbuild.credentials.missing",
            "Grok Build 配置缺少有效的内联 api_key 字段",
            "Grok Build configuration is missing a valid inline api_key field",
        )
    })?;
    if selected_model.contains_key("env_key") {
        return Err(AppError::localized(
            "provider.grokbuild.credentials.env_key_unsupported",
            "Grok Build 配置不支持 env_key；请使用内联 api_key。",
            "Grok Build configuration does not support env_key; use an inline api_key.",
        ));
    }
    required_non_empty_string(selected_model, "api_backend")?;

    selected_model
        .get("context_window")
        .and_then(toml::Value::as_integer)
        .filter(|value| *value > 0)
        .ok_or_else(|| {
            AppError::localized(
                "provider.grokbuild.context_window.invalid",
                "Grok Build context_window 必须是正整数",
                "Grok Build context_window must be a positive integer",
            )
        })?;

    Ok(())
}

pub fn extract_model_config(config_toml: &str) -> Option<GrokModelConfig> {
    let document = config_toml.parse::<toml::Value>().ok()?;
    let root = document.as_table()?;
    let default_model = root
        .get("models")?
        .as_table()?
        .get("default")?
        .as_str()?
        .trim();
    let selected_model = root
        .get("model")?
        .as_table()?
        .get(default_model)?
        .as_table()?;

    Some(GrokModelConfig {
        profile: default_model.to_string(),
        model: selected_model.get("model")?.as_str()?.trim().to_string(),
        base_url: selected_model
            .get("base_url")?
            .as_str()?
            .trim_end_matches('/')
            .to_string(),
        name: selected_model.get("name")?.as_str()?.trim().to_string(),
        api_key: optional_non_empty_string(selected_model, "api_key"),
        api_backend: selected_model
            .get("api_backend")?
            .as_str()?
            .trim()
            .to_string(),
        context_window: selected_model.get("context_window")?.as_integer()?,
    })
}

pub fn extract_credentials(config_toml: &str) -> Option<(String, String)> {
    let config = extract_model_config(config_toml)?;
    Some((config.base_url, config.api_key?))
}

fn update_selected_model_string(
    config_toml: &str,
    field: &str,
    value: &str,
) -> Result<String, AppError> {
    let mut document = config_toml
        .parse::<toml_edit::DocumentMut>()
        .map_err(|error| {
            AppError::localized(
                "provider.grokbuild.config.invalid_toml",
                format!("Grok Build config.toml 格式错误: {error}"),
                format!("Invalid Grok Build config.toml: {error}"),
            )
        })?;
    let default_model = document
        .get("models")
        .and_then(|item| item.get("default"))
        .and_then(toml_edit::Item::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .ok_or_else(|| {
            AppError::localized(
                "provider.grokbuild.default_model.missing",
                "Grok Build 配置缺少 models.default",
                "Grok Build configuration is missing models.default",
            )
        })?
        .to_string();

    let selected_model = document
        .get_mut("model")
        .and_then(|item| item.get_mut(&default_model))
        .and_then(toml_edit::Item::as_table_like_mut)
        .ok_or_else(|| {
            AppError::localized(
                "provider.grokbuild.default_model.missing",
                format!("Grok Build 配置缺少 [model.\"{default_model}\"]"),
                format!("Grok Build configuration is missing [model.\"{default_model}\"]"),
            )
        })?;
    selected_model.insert(field, toml_edit::value(value));
    Ok(document.to_string())
}

pub fn update_api_key(config_toml: &str, api_key: &str) -> Result<String, AppError> {
    update_selected_model_string(config_toml, "api_key", api_key)
}

/// Build the locked PuppyRouter Grok Build configuration. Existing local
/// model/profile choices are retained, while endpoint, provider name, backend,
/// and inline API key are normalized to the PuppyRouter contract.
pub fn build_puppyrouter_config(existing_config: Option<&str>, api_key: &str) -> String {
    let existing = existing_config.and_then(extract_model_config);
    let profile = existing
        .as_ref()
        .map(|config| config.profile.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_MODEL);
    let model = existing
        .as_ref()
        .map(|config| config.model.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(profile);
    let context_window = existing
        .as_ref()
        .map(|config| config.context_window)
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_CONTEXT_WINDOW);

    let mut selected_model = toml::map::Map::new();
    selected_model.insert("model".to_string(), toml::Value::String(model.to_string()));
    selected_model.insert(
        "base_url".to_string(),
        toml::Value::String(PUPPYROUTER_BASE_URL.to_string()),
    );
    selected_model.insert(
        "name".to_string(),
        toml::Value::String(PUPPYROUTER_PROVIDER_NAME.to_string()),
    );
    selected_model.insert(
        "api_key".to_string(),
        toml::Value::String(api_key.to_string()),
    );
    selected_model.insert(
        "api_backend".to_string(),
        toml::Value::String(DEFAULT_API_BACKEND.to_string()),
    );
    selected_model.insert(
        "context_window".to_string(),
        toml::Value::Integer(context_window),
    );

    let mut models = toml::map::Map::new();
    models.insert(
        "default".to_string(),
        toml::Value::String(profile.to_string()),
    );
    let mut model_entries = toml::map::Map::new();
    model_entries.insert(profile.to_string(), toml::Value::Table(selected_model));

    let mut root = toml::map::Map::new();
    root.insert("models".to_string(), toml::Value::Table(models));
    root.insert("model".to_string(), toml::Value::Table(model_entries));

    toml::to_string(&toml::Value::Table(root))
        .expect("serializing a fixed Grok Build PuppyRouter config must succeed")
}

pub fn read_grok_live_settings() -> Result<Value, AppError> {
    let path = get_grok_config_path();
    if !path.exists() {
        return Err(AppError::localized(
            "grokbuild.config.missing",
            "Grok Build 配置文件不存在",
            "Grok Build configuration file not found",
        ));
    }

    let config = fs::read_to_string(&path).map_err(|error| AppError::io(&path, error))?;
    validate_config_toml_syntax(&config)?;
    Ok(json!({ "config": config }))
}

pub fn write_grok_provider_live(provider: &Provider) -> Result<(), AppError> {
    let settings = provider.settings_config.as_object().ok_or_else(|| {
        AppError::localized(
            "provider.grokbuild.settings.not_object",
            "Grok Build 配置必须是 JSON 对象",
            "Grok Build configuration must be a JSON object",
        )
    })?;
    let config = settings
        .get("config")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::localized(
                "provider.grokbuild.config.missing",
                "Grok Build 配置缺少 config 字段",
                "Grok Build configuration is missing the config field",
            )
        })?;

    if provider.category.as_deref() == Some("official") {
        validate_official_config_toml(config)?;
    } else {
        validate_config_toml(config)?;
    }

    write_grok_live_settings(&json!({ "config": config }))
}

pub fn write_grok_live_settings(settings: &Value) -> Result<(), AppError> {
    let config = settings
        .get("config")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::localized(
                "provider.grokbuild.config.missing",
                "Grok Build 配置缺少 config 字段",
                "Grok Build configuration is missing the config field",
            )
        })?;
    validate_config_toml_syntax(config)?;
    write_text_file(&get_grok_config_path(), config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    fn valid_config() -> &'static str {
        r#"[models]
default = "grok-4.5"

[model."grok-4.5"]
model = "grok-4.5"
base_url = "https://example.com/v1"
name = "Example"
api_key = "secret"
api_backend = "responses"
context_window = 500000
"#
    }

    #[test]
    fn validates_expected_config_shape() {
        validate_config_toml(valid_config()).expect("valid Grok Build config");
    }

    #[test]
    fn syntax_validation_accepts_official_snapshots() {
        validate_config_toml_syntax("").expect("empty official snapshot");
        validate_config_toml_syntax("[settings]\ntheme = \"dark\"\n")
            .expect("official snapshot with settings");
        assert!(is_official_live_config(""));
        assert!(is_official_live_config("[settings]\ntheme = \"dark\"\n"));
        assert!(!is_official_live_config(valid_config()));
        assert!(validate_config_toml_syntax("not = [valid").is_err());
    }

    #[test]
    fn official_validation_rejects_custom_model_routing() {
        validate_official_config_toml("[settings]\ntheme = \"dark\"\n").expect("official snapshot");
        assert!(validate_official_config_toml(valid_config()).is_err());
    }

    #[test]
    fn rejects_env_key_only_configuration() {
        let config = valid_config().replace("api_key = \"secret\"", "env_key = \"XAI_API_KEY\"");
        let error = validate_config_toml(&config).expect_err("inline key should be required");
        assert!(error.to_string().contains("api_key"));
    }

    #[test]
    fn rejects_env_key_even_when_an_inline_key_is_present() {
        let config = format!("{}\nenv_key = \"XAI_API_KEY\"\n", valid_config().trim_end());
        let error = validate_config_toml(&config).expect_err("env_key must be rejected");
        assert!(error.to_string().contains("env_key"));
    }

    #[test]
    fn extracts_inline_credentials_without_environment_fallback() {
        let config = format!("{}\nenv_key = \"XAI_API_KEY\"\n", valid_config().trim_end());
        let credentials = extract_credentials(&config).expect("inline credentials");

        assert_eq!(credentials.0, "https://example.com/v1");
        assert_eq!(credentials.1, "secret");
    }

    #[test]
    fn puppyrouter_config_preserves_model_but_normalizes_connection() {
        let existing = valid_config().replace("model = \"grok-4.5\"", "model = \"grok-4.20\"");
        let config = build_puppyrouter_config(Some(&existing), "sk-selected");
        let selected = extract_model_config(&config).expect("selected config");

        assert_eq!(selected.model, "grok-4.20");
        assert_eq!(selected.base_url, PUPPYROUTER_BASE_URL);
        assert_eq!(selected.name, PUPPYROUTER_PROVIDER_NAME);
        assert_eq!(selected.api_key.as_deref(), Some("sk-selected"));
        assert_eq!(selected.api_backend, DEFAULT_API_BACKEND);
    }

    #[test]
    #[serial]
    fn writes_and_reads_live_config() {
        let temp = TempDir::new().expect("temp dir");
        let original_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());

        let provider = Provider::with_id(
            "grok".to_string(),
            "Example".to_string(),
            json!({ "config": valid_config() }),
            None,
        );
        write_grok_provider_live(&provider).expect("write live config");

        let path = get_grok_config_path();
        assert_eq!(path, temp.path().join(".grok").join("config.toml"));
        assert_eq!(
            fs::read_to_string(path).expect("read config"),
            valid_config()
        );
        assert_eq!(
            read_grok_live_settings()
                .expect("read live settings")
                .get("config")
                .and_then(Value::as_str),
            Some(valid_config())
        );

        match original_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }

    #[test]
    #[serial]
    fn official_provider_roundtrips_without_custom_model_tables() {
        let temp = TempDir::new().expect("temp dir");
        let original_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());

        let mut official = Provider::with_id(
            "grokbuild-official".to_string(),
            "Grok Official".to_string(),
            json!({ "config": "[settings]\ntheme = \"dark\"\n" }),
            None,
        );
        official.category = Some("official".to_string());

        write_grok_provider_live(&official).expect("official snapshot is writable");
        assert_eq!(
            fs::read_to_string(get_grok_config_path()).expect("read official config"),
            "[settings]\ntheme = \"dark\"\n"
        );

        match original_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }
}
