import React, { useEffect, useState } from "react";
import { settingsStorage } from "../../lib/storage";
import { Switch } from "../ui/switch";

export const PlayerSettings: React.FC = () => {
  const [showSeekButtons, setShowSeekButtons] = useState(true);
  const [showEpisodeSidebarButton, setShowEpisodeSidebarButton] =
    useState(true);
  const [externalPlayerEnabled, setExternalPlayerEnabled] = useState(false);
  const isAndroid = navigator.userAgent.toLowerCase().includes("android");

  useEffect(() => {
    setShowSeekButtons(!settingsStorage.hideSeekButtons());
    setShowEpisodeSidebarButton(settingsStorage.showPlayerEpisodeSidebar());
    if (isAndroid) {
      setExternalPlayerEnabled(settingsStorage.isExternalPlayerEnabled());
    }
  }, [isAndroid]);

  return (
    <div className="player-settings">
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Seek Buttons</h3>
          <p className="body-md text-muted">
            Show 10-second rewind and forward buttons in the player
          </p>
        </div>
        <Switch
          checked={showSeekButtons}
          onCheckedChange={(enabled) => {
            setShowSeekButtons(enabled);
            settingsStorage.setHideSeekButtons(!enabled);
          }}
          aria-label="Show player seek buttons"
        />
      </div>

      <div className="settings-divider" />

      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Episode List Button</h3>
          <p className="body-md text-muted">
            Show a button on the player edge to quickly open the episode list
          </p>
        </div>
        <Switch
          checked={showEpisodeSidebarButton}
          onCheckedChange={(enabled) => {
            setShowEpisodeSidebarButton(enabled);
            settingsStorage.setShowPlayerEpisodeSidebar(enabled);
          }}
          aria-label="Show player episode list button"
        />
      </div>

      {isAndroid && (
        <>
          <div className="settings-divider" />
          <div className="settings-row">
            <div className="settings-info">
              <h3 className="label-lg">External Player</h3>
              <p className="body-md text-muted">
                Show Android&apos;s app chooser for network streams instead of
                playing them inside Vega.
              </p>
            </div>
            <Switch
              checked={externalPlayerEnabled}
              onCheckedChange={(enabled) => {
                setExternalPlayerEnabled(enabled);
                settingsStorage.setExternalPlayerEnabled(enabled);
              }}
              aria-label="Use an external player"
            />
          </div>
        </>
      )}
    </div>
  );
};
