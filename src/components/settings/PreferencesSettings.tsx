import React, { useEffect, useState } from "react";
import { settingsStorage } from "../../lib/storage";
import { FocusableButton } from "../layout/FocusableButton";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { CustomSelect } from "../CustomSelect";

const QUALITIES = ["360p", "480p", "720p", "1080p", "4k"];

export const PreferencesSettings: React.FC = () => {
  const [excludedQualities, setExcludedQualities] = useState<string[]>([]);
  const [tvModeEnabled, setTvModeEnabled] = useState(false);
  const [devtoolsShortcutsEnabled, setDevtoolsShortcutsEnabled] =
    useState(false);
  const [dohEnabled, setDohEnabled] = useState(true);
  const [dohProvider, setDohProvider] = useState("cloudflare");
  const [dohCustomUrl, setDohCustomUrl] = useState("");
  const [tmdbApiKey, setTmdbApiKey] = useState("");
  const [tmdbKeySaved, setTmdbKeySaved] = useState(false);

  useEffect(() => {
    setExcludedQualities(settingsStorage.getExcludedQualities());
    setTvModeEnabled(settingsStorage.isTvModeEnabled());
    setDevtoolsShortcutsEnabled(settingsStorage.areDevtoolsShortcutsEnabled());
    setDohEnabled(settingsStorage.isDohEnabled());
    setDohProvider(settingsStorage.getDohProvider());
    setDohCustomUrl(settingsStorage.getDohCustomUrl());
    setTmdbApiKey(settingsStorage.getTmdbApiKey());
  }, []);

  const handleToggleQuality = (quality: string) => {
    const updated = excludedQualities.includes(quality)
      ? excludedQualities.filter((item) => item !== quality)
      : [...excludedQualities, quality];
    setExcludedQualities(updated);
    settingsStorage.setExcludedQualities(updated);
  };

  const handleToggleTvMode = () => {
    const nextState = !tvModeEnabled;
    settingsStorage.setTvModeEnabled(nextState);
    setTvModeEnabled(nextState);
    window.location.reload();
  };

  const handleToggleDevtoolsShortcuts = () => {
    const nextState = !devtoolsShortcutsEnabled;
    setDevtoolsShortcutsEnabled(nextState);
    settingsStorage.setDevtoolsShortcutsEnabled(nextState);
  };

  const handleToggleDoh = () => {
    const nextState = !dohEnabled;
    setDohEnabled(nextState);
    settingsStorage.setDohEnabled(nextState);
  };

  const saveTmdbApiKey = () => {
    settingsStorage.setTmdbApiKey(tmdbApiKey);
    setTmdbApiKey(settingsStorage.getTmdbApiKey());
    setTmdbKeySaved(true);
    window.setTimeout(() => setTmdbKeySaved(false), 1800);
  };

  const clearTmdbApiKey = () => {
    setTmdbApiKey("");
    settingsStorage.setTmdbApiKey("");
    setTmdbKeySaved(false);
  };

  return (
    <div className="preferences-settings">
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">TV / Controller Mode</h3>
          <p className="body-md text-muted">
            Enable arrow-key spatial navigation for remotes and gamepads
            (requires app restart)
          </p>
        </div>
        <Switch
          checked={tvModeEnabled}
          onCheckedChange={handleToggleTvMode}
          aria-label="Enable TV mode"
        />
      </div>

      <div className="settings-divider" />

      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Developer Tools Shortcuts</h3>
          <p className="body-md text-muted">
            Allow F12 or Ctrl+Shift+I to toggle developer tools
          </p>
        </div>
        <Switch
          checked={devtoolsShortcutsEnabled}
          onCheckedChange={handleToggleDevtoolsShortcuts}
          aria-label="Enable developer shortcuts"
        />
      </div>

      <div className="settings-divider" />

      <div className="settings-row" style={{ alignItems: "flex-start" }}>
        <div className="settings-info">
          <h3 className="label-lg">TMDB API Key</h3>
          <p className="body-md text-muted">
            Optional custom key for Story metadata. It overrides the bundled
            environment key.
          </p>
        </div>
        <div className="tmdb-key-control">
          <Input
            type="password"
            autoComplete="off"
            aria-label="Custom TMDB API key"
            placeholder={
              import.meta.env.VITE_TMDB_API_KEY
                ? "Using bundled key"
                : "Enter TMDB API key"
            }
            value={tmdbApiKey}
            onChange={(event) => {
              setTmdbApiKey(event.target.value);
              setTmdbKeySaved(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveTmdbApiKey();
            }}
            onBlur={() => {
              if (
                tmdbApiKey.trim() &&
                tmdbApiKey.trim() !== settingsStorage.getTmdbApiKey()
              ) {
                saveTmdbApiKey();
              }
            }}
            className="tmdb-key-input"
          />
          <div className="tmdb-key-actions">
            <FocusableButton
              className="theme-toggle-btn active"
              onClick={saveTmdbApiKey}
            >
              {tmdbKeySaved ? "Saved" : "Save"}
            </FocusableButton>
            {settingsStorage.getTmdbApiKey() && (
              <FocusableButton
                className="theme-toggle-btn"
                onClick={clearTmdbApiKey}
              >
                Clear
              </FocusableButton>
            )}
          </div>
        </div>
      </div>

      <div className="settings-divider" />

      <div className="settings-row" style={{ alignItems: "flex-start" }}>
        <div className="settings-info">
          <h3 className="label-lg">DNS over HTTPS</h3>
          <p className="body-md text-muted">
            Use secure DNS for provider domains that are blocked by the local
            resolver.
          </p>
        </div>
        <div className="settings-stacked-control">
          <Switch
            checked={dohEnabled}
            onCheckedChange={handleToggleDoh}
            aria-label="Enable secure DNS"
          />
          {dohEnabled && (
            <div className="doh-settings-fields">
              <CustomSelect
                value={dohProvider}
                onChange={(value) => {
                  setDohProvider(value);
                  settingsStorage.setDohProvider(value);
                }}
                options={[
                  { value: "cloudflare", label: "Cloudflare (1.1.1.1)" },
                  { value: "google", label: "Google (8.8.8.8)" },
                  { value: "adguard", label: "AdGuard" },
                  { value: "custom", label: "Custom URL" },
                ]}
                className="doh-provider-select"
              />
              {dohProvider === "custom" && (
                <Input
                  type="text"
                  placeholder="https://dns.example.com/dns-query"
                  value={dohCustomUrl}
                  onChange={(event) => {
                    setDohCustomUrl(event.target.value);
                    settingsStorage.setDohCustomUrl(event.target.value);
                  }}
                  aria-label="Custom DNS over HTTPS URL"
                  className="doh-custom-url"
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="settings-divider" />

      <div className="settings-row">
        <div className="settings-info" style={{ width: "100%" }}>
          <h3 className="label-lg">Excluded Qualities</h3>
          <p className="body-md text-muted" style={{ marginBottom: "8px" }}>
            Select qualities you want to hide from playback and downloads.
          </p>
          <div
            className="quality-options"
            role="group"
            aria-label="Excluded playback qualities"
          >
            {QUALITIES.map((quality) => {
              const isExcluded = excludedQualities.includes(quality);
              return (
                <FocusableButton
                  key={quality}
                  className={`quality-option ${isExcluded ? "active" : ""}`}
                  onClick={() => handleToggleQuality(quality)}
                  aria-pressed={isExcluded}
                  title={isExcluded ? "Click to Include" : "Click to Exclude"}
                >
                  {quality}
                </FocusableButton>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
