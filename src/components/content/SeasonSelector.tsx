import React, { type CSSProperties, useEffect, useId, useState } from "react";
import * as Select from "@radix-ui/react-select";
import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { LuCheck as Check, LuChevronDown as ChevronDown } from "react-icons/lu";
import type { Link } from "../../lib/providers/types";
import { settingsStorage } from "../../lib/storage";

interface SeasonSelectorProps {
  seasons: Link[];
  activeSeason: Link | null;
  onChange: (season: Link) => void;
  themeStyle?: CSSProperties;
}

const getSeasonLabel = (season: Link, index: number): string =>
  season.title?.trim() || `Source ${index + 1}`;

const getActiveSeasonIndex = (seasons: Link[], activeSeason: Link | null): number => {
  if (!activeSeason) return -1;

  const referenceIndex = seasons.indexOf(activeSeason);
  if (referenceIndex >= 0) return referenceIndex;

  return seasons.findIndex((season) => season.title === activeSeason.title);
};

export const SeasonSelector: React.FC<SeasonSelectorProps> = ({
  seasons,
  activeSeason,
  onChange,
  themeStyle,
}) => {
  const [open, setOpen] = useState(false);
  const instanceId = useId().replace(/:/g, "");
  const activeIndex = getActiveSeasonIndex(seasons, activeSeason);
  const tvMode = settingsStorage.isTvModeEnabled();
  const triggerFocusKey = `SEASON_SELECT_TRIGGER_${instanceId}`;
  const {
    ref,
    focused,
    focusSelf: focusTrigger,
  } = useFocusable({
    focusable: tvMode,
    focusKey: triggerFocusKey,
    onEnterPress: () => setOpen((current) => !current),
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  return (
    <Select.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && tvMode) {
          window.setTimeout(() => focusTrigger(), 0);
        }
      }}
      value={activeIndex >= 0 ? String(activeIndex) : undefined}
      onValueChange={(value) => {
        const index = Number.parseInt(value, 10);
        const season = Number.isInteger(index) ? seasons[index] : undefined;
        if (season) onChange(season);
      }}
    >
      <Select.Trigger
        ref={ref as React.Ref<HTMLButtonElement>}
        className={`season-select-trigger ${focused ? "tv-focus" : ""}`}
        aria-label="Choose season"
      >
        <Select.Value placeholder="Choose season" />
        <Select.Icon>
          <ChevronDown size={18} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        {open && (
          <OpenSeasonContent
            seasons={seasons}
            activeIndex={activeIndex}
            instanceId={instanceId}
            themeStyle={themeStyle}
            tvMode={tvMode}
            onSelect={(season) => {
              onChange(season);
              setOpen(false);
              if (tvMode) window.setTimeout(() => focusTrigger(), 0);
            }}
          />
        )}
      </Select.Portal>
    </Select.Root>
  );
};

const OpenSeasonContent: React.FC<{
  seasons: Link[];
  activeIndex: number;
  instanceId: string;
  themeStyle?: CSSProperties;
  tvMode: boolean;
  onSelect: (season: Link) => void;
}> = ({ seasons, activeIndex, instanceId, themeStyle, tvMode, onSelect }) => {
  const selectedIndex = Math.max(activeIndex, 0);
  const optionFocusKey = (index: number) =>
    `SEASON_SELECT_OPTION_${instanceId}_${index}`;
  const { ref, focusKey, focusSelf } = useFocusable({
    focusable: tvMode,
    isFocusBoundary: true,
    trackChildren: true,
    preferredChildFocusKey: optionFocusKey(selectedIndex),
  });

  useEffect(() => {
    if (!tvMode) return;
    const timer = window.setTimeout(() => focusSelf(), 0);
    return () => window.clearTimeout(timer);
  }, [focusSelf, tvMode]);

  return (
    <FocusContext.Provider value={focusKey}>
      <Select.Content
        ref={ref as React.Ref<HTMLDivElement>}
        className="season-select-content"
        position="popper"
        sideOffset={7}
        style={themeStyle}
        onCloseAutoFocus={(event) => {
          if (tvMode) event.preventDefault();
        }}
      >
        <Select.Viewport>
          {seasons.map((season, index) => (
            <SeasonOption
              key={`${index}:${season.title || "source"}`}
              season={season}
              index={index}
              focusKey={optionFocusKey(index)}
              onSelect={() => onSelect(season)}
            />
          ))}
        </Select.Viewport>
      </Select.Content>
    </FocusContext.Provider>
  );
};

const SeasonOption: React.FC<{
  season: Link;
  index: number;
  onSelect: () => void;
  focusKey: string;
}> = ({ season, index, onSelect, focusKey }) => {
  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref, focused } = useFocusable({
    focusable: tvMode,
    focusKey,
    onEnterPress: onSelect,
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  return (
    <Select.Item
      ref={ref as React.Ref<HTMLDivElement>}
      className={`season-select-item ${focused ? "tv-focus" : ""}`}
      value={String(index)}
    >
      <Select.ItemText>{getSeasonLabel(season, index)}</Select.ItemText>
      <Select.ItemIndicator>
        <Check size={16} />
      </Select.ItemIndicator>
    </Select.Item>
  );
};
