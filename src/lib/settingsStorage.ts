import { mainStorage } from './storage';

export enum SettingsKeys {
  PRIMARY_COLOR = 'primaryColor',
  IS_CUSTOM_THEME = 'isCustomTheme',
  CUSTOM_COLOR = 'customColor',
  SHOW_TAB_BAR_LABELS = 'showTabBarLabels',
  AUTO_CHECK_UPDATE = 'autoCheckUpdate',
  SHOW_MEDIA_CONTROLS = 'showMediaControls',
  SHOW_HAMBURGER_MENU = 'showHamburgerMenu',
  HIDE_SEEK_BUTTONS = 'hideSeekButtons',
  ENABLE_SWIPE_GESTURE = 'enableSwipeGesture',
  EXCLUDED_QUALITIES = 'excludedQualities',
  SUBTITLE_FONT_SIZE = 'subtitleFontSize',
  SUBTITLE_OPACITY = 'subtitleOpacity',
  SUBTITLE_BOTTOM_PADDING = 'subtitleBottomPadding',
  LIST_VIEW_TYPE = 'viewType',
  FRAME_DISPLAY_MODE = 'frameDisplayMode',
}

export class SettingsStorage {
  getPrimaryColor(): string {
    return mainStorage.getString(SettingsKeys.PRIMARY_COLOR) || '#FF6347';
  }

  setPrimaryColor(color: string): void {
    mainStorage.setString(SettingsKeys.PRIMARY_COLOR, color);
  }

  isCustomTheme(): boolean {
    return mainStorage.getBool(SettingsKeys.IS_CUSTOM_THEME);
  }

  setCustomTheme(isCustom: boolean): void {
    mainStorage.setBool(SettingsKeys.IS_CUSTOM_THEME, isCustom);
  }

  getCustomColor(): string {
    return mainStorage.getString(SettingsKeys.CUSTOM_COLOR) || '#FF6347';
  }

  setCustomColor(color: string): void {
    mainStorage.setString(SettingsKeys.CUSTOM_COLOR, color);
  }

  showTabBarLabels(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_TAB_BAR_LABELS, false);
  }

  showMediaControls(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_MEDIA_CONTROLS, true);
  }

  showHamburgerMenu(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_HAMBURGER_MENU, true);
  }

  hideSeekButtons(): boolean {
    return mainStorage.getBool(SettingsKeys.HIDE_SEEK_BUTTONS, false);
  }

  isSwipeGestureEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.ENABLE_SWIPE_GESTURE, true);
  }

  isAutoCheckUpdateEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.AUTO_CHECK_UPDATE, true);
  }

  getSubtitleFontSize(): number {
    return mainStorage.getNumber(SettingsKeys.SUBTITLE_FONT_SIZE) || 16;
  }

  setSubtitleFontSize(size: number): void {
    mainStorage.setNumber(SettingsKeys.SUBTITLE_FONT_SIZE, size);
  }

  getSubtitleOpacity(): number {
    const val = mainStorage.getString(SettingsKeys.SUBTITLE_OPACITY);
    return val ? parseFloat(val) : 1;
  }

  setSubtitleOpacity(opacity: number): void {
    mainStorage.setString(SettingsKeys.SUBTITLE_OPACITY, opacity.toString());
  }

  getSubtitleBottomPadding(): number {
    return mainStorage.getNumber(SettingsKeys.SUBTITLE_BOTTOM_PADDING) || 10;
  }

  setSubtitleBottomPadding(padding: number): void {
    mainStorage.setNumber(SettingsKeys.SUBTITLE_BOTTOM_PADDING, padding);
  }

  getListViewType(): number {
    return parseInt(mainStorage.getString(SettingsKeys.LIST_VIEW_TYPE) || '1', 10);
  }

  setListViewType(type: number): void {
    mainStorage.setString(SettingsKeys.LIST_VIEW_TYPE, type.toString());
  }

  getFrameDisplayMode(): string {
    return mainStorage.getString(SettingsKeys.FRAME_DISPLAY_MODE) || 'fit';
  }

  setFrameDisplayMode(mode: string): void {
    mainStorage.setString(SettingsKeys.FRAME_DISPLAY_MODE, mode);
  }

  getBool(key: string, defaultValue = false): boolean {
    return mainStorage.getBool(key, defaultValue);
  }

  setBool(key: string, value: boolean): void {
    mainStorage.setBool(key, value);
  }

  getString(key: string): string | undefined {
    return mainStorage.getString(key);
  }

  setString(key: string, value: string): void {
    mainStorage.setString(key, value);
  }
}

export const settingsStorage = new SettingsStorage();
