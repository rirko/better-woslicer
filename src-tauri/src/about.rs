//! Only the About dialog's project and credit links can open an external browser.

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AboutLink {
    Project,
    Woslicer,
    Bmhelper,
    Audacity,
}

fn link_url(link: AboutLink) -> Result<String, String> {
    let (json, key) = match link {
        AboutLink::Project => (
            include_str!(concat!(env!("OUT_DIR"), "/build-info.json")),
            "repositoryUrl",
        ),
        AboutLink::Woslicer => (
            include_str!("../../src/platform/about-links.json"),
            "woslicer",
        ),
        AboutLink::Bmhelper => (
            include_str!("../../src/platform/about-links.json"),
            "bmhelper",
        ),
        AboutLink::Audacity => (
            include_str!("../../src/platform/about-links.json"),
            "audacity",
        ),
    };
    let data: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    data[key]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "This build does not include the project URL".into())
}

#[tauri::command]
pub(crate) fn open_about_link(link: AboutLink) -> Result<(), String> {
    tauri_plugin_opener::open_url(link_url(link)?, None::<&str>).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_cannot_supply_urls_paths_or_programs() {
        for input in [
            r#""https://example.org""#,
            r#""file:///C:/private.txt""#,
            r#""cmd.exe""#,
            r#"{"url":"https://example.org"}"#,
        ] {
            assert!(serde_json::from_str::<AboutLink>(input).is_err(), "{input}");
        }
    }

    #[test]
    fn credit_links_resolve_to_the_bundled_https_sites() -> Result<(), Box<dyn std::error::Error>> {
        for link in [
            AboutLink::Woslicer,
            AboutLink::Bmhelper,
            AboutLink::Audacity,
        ] {
            let url: tauri::Url = link_url(link)?.parse()?;
            assert_eq!(url.scheme(), "https");
            assert!(url.username().is_empty());
            assert!(url.password().is_none());
        }
        Ok(())
    }
}
