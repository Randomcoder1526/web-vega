import React, { useState, useRef, useEffect, useId, useCallback } from "react";
import {
  LuCheck as Check,
  LuChevronDown as ChevronDown,
} from "react-icons/lu";
import { FocusableButton } from "./layout/FocusableButton";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation";
import { settingsStorage } from "../lib/storage";
import "./CustomSelect.css";

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  options,
  value,
  onChange,
  className = "",
  placeholder = "Select...",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceId = useId().replace(/:/g, "");

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);


  return (
    <div className={`custom-select-container ${className}`} ref={containerRef}>
      <FocusableButton
        type="button"
        className="custom-select-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="custom-select-value">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className={`custom-select-icon ${isOpen ? "open" : ""}`}>
          <ChevronDown size={17} />
        </span>
      </FocusableButton>

      {isOpen && (
        <OpenSelectList
          options={options}
          value={value}
          instanceId={instanceId}
          onSelect={(nextValue) => {
            onChange(nextValue);
            setIsOpen(false);
          }}
        />
      )}
    </div>
  );
};

const OpenSelectList: React.FC<{
  options: Option[];
  value: string;
  instanceId: string;
  onSelect: (value: string) => void;
}> = ({ options, value, instanceId, onSelect }) => {
  const listRef = useRef<HTMLUListElement>(null);
  const tvMode = settingsStorage.isTvModeEnabled();
  const selectedIndex = Math.max(
    options.findIndex((option) => option.value === value),
    0,
  );
  const optionFocusKey = (index: number) =>
    `CUSTOM_SELECT_${instanceId}_${index}`;
  const { ref, focusKey, focusSelf } = useFocusable({
    focusable: tvMode,
    isFocusBoundary: true,
    trackChildren: true,
    preferredChildFocusKey: optionFocusKey(selectedIndex),
  });

  const setListRef = useCallback(
    (node: HTMLUListElement | null) => {
      listRef.current = node;
      (ref as React.MutableRefObject<HTMLUListElement | null>).current = node;
    },
    [ref],
  );

  useEffect(() => {
    const selectedEl = listRef.current?.querySelector<HTMLElement>(
      ".custom-select-option.selected",
    );
    if (selectedEl) selectedEl.scrollIntoView({ block: "nearest" });
    else if (listRef.current) listRef.current.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (!tvMode) return;
    const timer = window.setTimeout(() => focusSelf(), 0);
    return () => window.clearTimeout(timer);
  }, [focusSelf, tvMode]);

  return (
    <FocusContext.Provider value={focusKey}>
      <ul className="custom-select-list" role="listbox" ref={setListRef}>
        {options.map((option, index) => (
          <SelectOptionItem
            key={option.value}
            focusKey={optionFocusKey(index)}
            option={option}
            isSelected={option.value === value}
            onClick={() => onSelect(option.value)}
          />
        ))}
      </ul>
    </FocusContext.Provider>
  );
};

const SelectOptionItem: React.FC<{
  option: Option;
  isSelected: boolean;
  onClick: () => void;
  focusKey: string;
}> = ({ option, isSelected, onClick, focusKey }) => {
  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref, focused } = useFocusable({
    focusable: tvMode,
    focusKey,
    onEnterPress: onClick,
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  return (
    <li
      ref={ref as any}
      className={`custom-select-option ${isSelected ? "selected" : ""} ${focused ? "tv-focus" : ""}`}
      role="option"
      aria-selected={isSelected}
      onClick={onClick}
    >
      <span className="custom-select-option-label">{option.label}</span>
      {isSelected && (
        <div className="custom-select-check-wrap">
          <Check className="custom-select-check" aria-hidden="true" />
        </div>
      )}
    </li>
  );
};
