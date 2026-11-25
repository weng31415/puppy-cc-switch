use super::*;
use crate::database::Database;
use crate::mode::controller;
use crate::services::provider::puppyrouter;
use crate::test_support::{EnvVars, TestHome};
use serde_json::json;
use std::{fs, sync::Arc};

const KEY: &str = "sk-puppy-diagnosis-fixture";

struct Fixture {
    state: AppState,
    _env: EnvVars,
    _home: TestHome,
}

impl Fixture {
    async fn new() -> Self {
        let home = TestHome::new();
        let env = EnvVars::new()
            .set("HOME", home.path())
            .set("USERPROFILE", home.path())
            .set("LOCALAPPDATA", home.path().join("AppData/Local"))
            .set("XDG_CONFIG_HOME", home.path().join(".config"))
            .set("DSH_HOME", home.path().join(".dsh"))
            .set("WORKBUDDY_CONFIG_DIR", home.path().join(".workbuddy"));
        let db = Arc::new(Database::memory().unwrap());
        let mut proxy = db.get_global_proxy_config().await.unwrap();
        proxy.listen_address = "127.0.0.1".into();
        proxy.listen_port = 0;
        db.update_global_proxy_config(proxy).await.unwrap();
        let state = AppState::new(db);
        ProviderService::ensure_locked_puppyrouter_defaults(&state).unwrap();
        Self {
            state,
            _env: env,
            _home: home,
        }
    }
    fn stage(&self, app: &AppType) -> Provider {
        let id = provider_id(app);
        let row = self.state.db.get_provider_by_id(id, app).unwrap().unwrap();
        let saved = puppyrouter::with_api_key(app, &row, KEY).unwrap();
        ProviderService::update(&self.state, app.clone(), None, saved.clone()).unwrap();
        saved
    }
    fn enable(&self, app: &AppType) {
        ProviderService::switch(&self.state, app.clone(), provider_id(app)).unwrap();
    }
    async fn clean(&self, app: &AppType, scope: Scope) {
        let result = inspect(&self.state, app).await;
        assert_eq!((result.scope, result.issues), (scope, vec![]), "{app:?}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial_test::serial]
async fn actual_direct_and_router_writes_pass_then_drift_is_reported() {
    let f = Fixture::new().await;
    for app in AppType::all().filter(|a| a.spec().route_mode) {
        f.stage(&app);
        f.enable(&app);
        f.clean(&app, Scope::Direct).await;
        controller::enter_with_route(&f.state, &app, false, Some(provider_id(&app)))
            .await
            .unwrap();
        f.clean(&app, Scope::Proxy).await;
        if app == AppType::Claude {
            let store = DeviceStore::for_device();
            device::update(&store, |s| {
                s.apps.get_mut(app.as_str()).unwrap().proxy_route = None
            })
            .unwrap();
            f.clean(&app, Scope::Proxy).await;
            device::update(&store, |s| {
                s.apps.get_mut(app.as_str()).unwrap().attached = false
            })
            .unwrap();
            assert_eq!(inspect(&f.state, &app).await.issues, [Issue::ProxyDetached]);
            device::update(&store, |s| {
                let record = s.apps.get_mut(app.as_str()).unwrap();
                record.attached = true;
                record.proxy_route = Some(provider_id(&app).into());
            })
            .unwrap();
        }
        match app {
            AppType::Claude => fs::write(crate::config::get_claude_settings_path(), "{}").unwrap(),
            AppType::Gemini => fs::write(
                crate::gemini_config::get_gemini_settings_path(),
                r#"{"security":{"auth":{"selectedType":"oauth-personal"}}}"#,
            )
            .unwrap(),
            AppType::Codex => fs::write(
                crate::codex_config::get_codex_config_path(),
                "[model_providers.custom]\nbase_url='https://puppyrouter.com/v1'\n",
            )
            .unwrap(),
            AppType::GrokBuild => {
                fs::write(crate::grok_config::get_grok_config_path(), "").unwrap()
            }
            AppType::ClaudeDesktop => {
                let status = desktop::get_status(&f.state.db, true).unwrap();
                let meta =
                    std::path::Path::new(&status.config_library_path.unwrap()).join("_meta.json");
                let bytes = fs::read(&meta).unwrap();
                let mut doc: Value = serde_json::from_slice(&bytes).unwrap();
                doc["appliedId"] = json!("fixture-other-profile");
                fs::write(&meta, serde_json::to_vec(&doc).unwrap()).unwrap();
                assert_eq!(
                    inspect(&f.state, &app).await.issues,
                    [Issue::DesktopProfile]
                );
                doc["appliedId"] = json!(desktop::PROFILE_ID);
                doc["entries"] = json!([]);
                fs::write(&meta, serde_json::to_vec(&doc).unwrap()).unwrap();
                assert_eq!(
                    inspect(&f.state, &app).await.issues,
                    [Issue::DesktopProfile]
                );
                fs::write(meta, bytes).unwrap();
                fs::write(status.profile_path.unwrap(), "{}").unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            !inspect(&f.state, &app).await.issues.is_empty(),
            "{app:?} reported healthy after drift"
        );
        controller::exit(&f.state, &app).await.unwrap();
        f.clean(&app, Scope::Direct).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial_test::serial]
async fn official_login_stays_separate_from_the_codex_route_and_real_bearer() {
    let f = Fixture::new().await;
    let app = AppType::Codex;
    let mut settings = crate::settings::get_settings();
    settings.preserve_codex_official_auth_on_switch = true;
    crate::settings::update_settings(settings).unwrap();
    let auth_path = crate::codex_config::get_codex_auth_path();
    fs::create_dir_all(auth_path.parent().unwrap()).unwrap();
    let login = br#"{"auth_mode":"chatgpt","tokens":{"access_token":"fixture-access","refresh_token":"fixture-refresh","account_id":"fixture-user"}}"#;
    fs::write(&auth_path, login).unwrap();
    f.stage(&app);
    f.enable(&app);
    f.clean(&app, Scope::Direct).await;
    controller::enter_with_route(&f.state, &app, false, Some(provider_id(&app)))
        .await
        .unwrap();
    f.clean(&app, Scope::Proxy).await;
    controller::exit(&f.state, &app).await.unwrap();
    f.clean(&app, Scope::Direct).await;
    let path = crate::codex_config::get_codex_config_path();
    let mut config = fs::read_to_string(&path)
        .unwrap()
        .parse::<DocumentMut>()
        .unwrap();
    assert_eq!(
        config["model_providers"]["custom"]["requires_openai_auth"].as_bool(),
        Some(true)
    );
    config["model_providers"]["custom"]["experimental_bearer_token"] =
        toml_edit::value("wrong-fixture");
    fs::write(&path, config.to_string()).unwrap();
    assert!(inspect(&f.state, &app)
        .await
        .issues
        .contains(&Issue::KeyMismatch));
    assert!(reapply(&f.state, app.clone()).unwrap());
    f.clean(&app, Scope::Direct).await;
    assert_eq!(fs::read(&auth_path).unwrap(), login);
    config["model_providers"]["custom"]["experimental_bearer_token"] = toml_edit::value(KEY);
    config["model_providers"]["custom"]["env_key"] = toml_edit::value("FIXTURE_OTHER_KEY");
    fs::write(&path, config.to_string()).unwrap();
    assert!(inspect(&f.state, &app)
        .await
        .issues
        .contains(&Issue::AuthSource));
    fs::write(&path, "model_provider = 'missing'\n[model_providers.dormant]\nbase_url='https://puppyrouter.com/v1'\n").unwrap();
    assert!(inspect(&f.state, &app)
        .await
        .issues
        .contains(&Issue::CodexProviderTableMissing));
    fs::write(&path, "[broken").unwrap();
    assert!(inspect(&f.state, &app)
        .await
        .issues
        .contains(&Issue::CodexConfigInvalid));
    assert!(!reapply(&f.state, app.clone()).unwrap());
    assert_eq!(fs::read_to_string(path).unwrap(), "[broken");
    assert_eq!(fs::read(auth_path).unwrap(), login);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial_test::serial]
async fn stage_diagnosis_respects_direct_selection_route_and_published_stack_members() {
    let f = Fixture::new().await;
    let app = AppType::Claude;
    let mut other = f.stage(&app);
    other.id = "fixture-other".into();
    other.name = "Other".into();
    other.meta = None;
    f.state.db.save_provider(&app, &other).unwrap();
    ProviderService::switch(&f.state, app.clone(), &other.id).unwrap();
    assert!(!reapply(&f.state, app.clone()).unwrap());
    assert_eq!(
        inspect(&f.state, &app).await.issues,
        [Issue::ProviderNotCurrent]
    );
    controller::enter_with_route(&f.state, &app, false, Some(&other.id))
        .await
        .unwrap();
    assert_eq!(
        inspect(&f.state, &app).await.issues,
        [Issue::ProxyNotSelected]
    );
    assert!(enable_staged_direct(&f.state, app.clone(), provider_id(&app)).is_err());
    assert_eq!(
        inspect(&f.state, &app).await.issues,
        [Issue::ProxyNotSelected]
    );
    controller::enter_with_route(&f.state, &app, true, Some(&other.id))
        .await
        .unwrap();
    controller::set_stack_member(&f.state, &app, provider_id(&app), true)
        .await
        .unwrap();
    f.clean(&app, Scope::Proxy).await;
    controller::set_stack_member(&f.state, &app, provider_id(&app), false)
        .await
        .unwrap();
    assert_eq!(
        inspect(&f.state, &app).await.issues,
        [Issue::ProxyNotSelected]
    );
    controller::exit(&f.state, &app).await.unwrap();
    enable_staged_direct(&f.state, app.clone(), provider_id(&app)).unwrap();
    f.clean(&app, Scope::Direct).await;
    let agy = AppType::Agy;
    f.stage(&agy);
    f.clean(&agy, Scope::Launch).await;
    assert!(!crate::agy_config::settings_path().exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial_test::serial]
async fn one_drifted_workbuddy_model_or_dsh_profile_fails_the_check() {
    let f = Fixture::new().await;
    let app = AppType::WorkBuddy;
    let mut row = f.stage(&app);
    row.settings_config["models"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"other-fixture"}));
    ProviderService::update(&f.state, app.clone(), None, row.clone()).unwrap();
    let mut wrong_endpoint = row.clone();
    wrong_endpoint.settings_config["models"][0]["url"] = json!("https://other.invalid/v1");
    f.state.db.save_provider(&app, &wrong_endpoint).unwrap();
    let staged = inspect(&f.state, &app).await;
    assert!(staged.issues.contains(&Issue::SavedConfigInvalid));
    assert!(!staged.allows_cloud_repair(staged.scope));
    f.state.db.save_provider(&app, &row).unwrap();
    f.enable(&app);
    f.clean(&app, Scope::Native).await;
    let path = crate::workbuddy_config::config_path();
    let mut disk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    disk["availableModels"] = json!(["other-fixture"]);
    fs::write(&path, serde_json::to_vec(&disk).unwrap()).unwrap();
    assert_eq!(
        inspect(&f.state, &app).await.issues,
        [Issue::NativeDisabled]
    );
    disk.as_object_mut().unwrap().remove("availableModels");
    disk["models"][1].as_object_mut().unwrap().remove("apiKey");
    disk["models"][1]["url"] = json!("https://other.invalid/v1/chat/completions");
    let bytes = serde_json::to_vec(&disk).unwrap();
    fs::write(&path, &bytes).unwrap();
    let report = inspect(&f.state, &app).await;
    assert!(
        report.issues.contains(&Issue::KeyMissing)
            && report.issues.contains(&Issue::EndpointMismatch)
    );
    assert_eq!(fs::read(&path).unwrap(), bytes);
    reapply(&f.state, app.clone()).unwrap();
    f.clean(&app, Scope::Native).await;
    let dsh = AppType::Dsh;
    f.stage(&dsh);
    f.enable(&dsh);
    f.clean(&dsh, Scope::Native).await;
    let path = crate::dsh_config::profile_path("desktop");
    let text = fs::read_to_string(&path)
        .unwrap()
        .replace("https://puppyrouter.com/v1", "https://other.invalid/v1");
    fs::write(&path, &text).unwrap();
    assert_eq!(
        inspect(&f.state, &dsh).await.issues,
        [Issue::NativeProfileConflict]
    );
    assert!(!reapply(&f.state, dsh.clone()).unwrap());
    assert_eq!(fs::read_to_string(path).unwrap(), text);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial_test::serial]
async fn pi_and_omp_cloud_selection_overrides_only_model_credentials() {
    let f = Fixture::new().await;
    for app in [AppType::Pi, AppType::Omp] {
        let mut row = f.stage(&app);
        row.settings_config["models"][0]["apiKey"] = json!("old-fixture");
        row.settings_config["modelOverrides"] =
            json!({"other-model":{"baseUrl":"https://example.invalid","contextWindow":32000}});
        let row = puppyrouter::with_api_key(&app, &row, KEY).unwrap();
        assert!(row.settings_config["models"][0].get("apiKey").is_none());
        assert_eq!(
            row.settings_config["modelOverrides"]["other-model"],
            json!({"contextWindow":32000})
        );
        ProviderService::update(&f.state, app.clone(), None, row).unwrap();
        f.enable(&app);
        f.clean(&app, Scope::Native).await;
    }
    let app = AppType::Pi;
    let id = provider_id(&app);
    let before = crate::pi_config::read_pi_native_provider(id)
        .unwrap()
        .unwrap();
    let mut drift = before.clone();
    drift["models"][0]["apiKey"] = json!("other-fixture");
    crate::pi_config::replace_pi_provider(id, &before, &drift).unwrap();
    assert_eq!(inspect(&f.state, &app).await.issues, [Issue::KeyMismatch]);
    reapply(&f.state, app.clone()).unwrap();
    f.clean(&app, Scope::Native).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial_test::serial]
async fn a_disabled_mcode_card_preserves_the_clients_choice() {
    let f = Fixture::new().await;
    let app = AppType::Mcode;
    let row = f.stage(&app);
    f.enable(&app);
    let mut disabled = row.settings_config;
    disabled["enabled"] = json!(false);
    crate::mcode_config::set_provider(&row.id, disabled.clone()).unwrap();
    assert_eq!(
        inspect(&f.state, &app).await.issues,
        [Issue::NativeDisabled]
    );
    assert!(!reapply(&f.state, app.clone()).unwrap());
    assert_eq!(
        crate::mcode_config::get_providers().unwrap()[&row.id],
        disabled
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial_test::serial]
async fn inspection_preserves_stale_preferences_and_reads_the_native_opencode_format() {
    use crate::provider::OpenCodeConfigFormat;
    let f = Fixture::new().await;
    let claude = AppType::Claude;
    f.stage(&claude);
    f.enable(&claude);
    let path = crate::config::get_claude_settings_path();
    let original = fs::read(&path).unwrap();
    crate::settings::set_current_provider(&claude, Some("deleted-fixture-card")).unwrap();
    let _report = inspect(&f.state, &claude).await;
    assert_eq!(
        current::local_direct_pointer(&claude).as_deref(),
        Some("deleted-fixture-card")
    );
    assert_eq!(fs::read(path).unwrap(), original);

    let app = AppType::OpenCode;
    let mut row = f.stage(&app);
    row.settings_config = json!({"package":"@ai-sdk/openai-compatible","settings":{"baseURL":"https://puppyrouter.com/v1","apiKey": KEY}});
    row.meta
        .get_or_insert_with(Default::default)
        .opencode_config_format = Some(OpenCodeConfigFormat::V2);
    ProviderService::update(&f.state, app.clone(), None, row.clone()).unwrap();
    f.enable(&app);
    f.clean(&app, Scope::Native).await;
    row.settings_config["settings"]["apiKey"] = json!("old-fixture");
    crate::opencode_config::set_provider_with_format(
        &row.id,
        row.settings_config,
        OpenCodeConfigFormat::V2,
    )
    .unwrap();
    assert_eq!(inspect(&f.state, &app).await.issues, [Issue::KeyMismatch]);
    reapply(&f.state, app.clone()).unwrap();
    f.clean(&app, Scope::Native).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial_test::serial]
async fn fresh_cards_require_a_saved_key_and_never_repair_the_client() {
    let f = Fixture::new().await;
    for app in AppType::all() {
        let report = inspect(&f.state, &app).await;
        assert!(
            report.issues.contains(&Issue::SavedKeyMissing),
            "{app:?}: {report:?}"
        );
        assert!(
            !report.issues.contains(&Issue::SavedConfigInvalid),
            "{app:?}: {report:?}"
        );
        if app.spec().route_mode {
            assert!(enable_staged_direct(&f.state, app.clone(), provider_id(&app)).is_err());
        }
        assert!(!reapply(&f.state, app).unwrap());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial_test::serial]
async fn every_writable_client_round_trips_drift_without_changing_the_saved_card() {
    let f = Fixture::new().await;
    for app in AppType::all().filter(|a| *a != AppType::Agy) {
        if app == AppType::ClaudeDesktop && !desktop::is_supported_platform() {
            continue;
        }
        let saved = f.stage(&app);
        if matches!(app, AppType::Kimi | AppType::Copilot) {
            ProviderService::add_to_live_config(&f.state, app.clone(), &saved.id).unwrap();
        } else {
            f.enable(&app);
        }
        let row = || {
            f.state
                .db
                .get_provider_by_id(&saved.id, &app)
                .unwrap()
                .unwrap()
        };
        let before = serde_json::to_value(row()).unwrap();
        let scope = if app.spec().additive {
            Scope::Native
        } else {
            Scope::Direct
        };
        f.clean(&app, scope).await;
        let drift = puppyrouter::with_api_key(&app, &row(), "sk-fixture-drift").unwrap();
        assert!(
            write_existing_client(&f.state, &app, &drift).unwrap(),
            "{app:?}"
        );
        let report = inspect(&f.state, &app).await;
        assert_eq!(report.issues, [Issue::KeyMismatch], "{app:?}");
        assert!(reapply(&f.state, app.clone()).unwrap(), "{app:?}");
        f.clean(&app, scope).await;
        assert_eq!(serde_json::to_value(row()).unwrap(), before, "{app:?}");
        assert!(
            !reapply(&f.state, app.clone()).unwrap(),
            "{app:?} already repaired"
        );
    }
}
