use crate::{db::Database, model::Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

/// Local application UI preferences, deliberately excluded from project exports.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct AppPreferences {
    pub main_nav_collapsed: bool,
    pub reader_nav_collapsed: bool,
}

/// Patch saves avoid overwriting unrelated fields from another component.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct AppPreferencesPatch {
    pub main_nav_collapsed: Option<bool>,
    pub reader_nav_collapsed: Option<bool>,
}

impl Database {
    pub fn load_app_preferences(&self) -> Result<AppPreferences> {
        let conn = self.lock()?;
        let data: Option<String> = conn
            .query_row("SELECT data FROM app_preferences WHERE id=1", [], |r| {
                r.get(0)
            })
            .optional()?;
        Ok(match data {
            Some(data) => serde_json::from_str(&data)?,
            None => AppPreferences::default(),
        })
    }
    pub fn save_app_preferences(&self, patch: AppPreferencesPatch) -> Result<AppPreferences> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let data: Option<String> = tx
            .query_row("SELECT data FROM app_preferences WHERE id=1", [], |r| {
                r.get(0)
            })
            .optional()?;
        let mut prefs: AppPreferences = match data {
            Some(data) => serde_json::from_str(&data)?,
            None => AppPreferences::default(),
        };
        if let Some(value) = patch.main_nav_collapsed {
            prefs.main_nav_collapsed = value;
        }
        if let Some(value) = patch.reader_nav_collapsed {
            prefs.reader_nav_collapsed = value;
        }
        tx.execute("INSERT INTO app_preferences(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [serde_json::to_string(&prefs)?])?;
        tx.commit()?;
        Ok(prefs)
    }
}
