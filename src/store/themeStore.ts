import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { settingsStorage } from '../lib/settingsStorage';

interface Theme {
  primary: string;
  isCustom: boolean;
  setPrimary: (primary: string) => void;
  setCustom: (isCustom: boolean) => void;
}

export const useThemeStore = create<Theme>()(
  persist(
    (set) => ({
      primary: settingsStorage.getPrimaryColor(),
      isCustom: settingsStorage.isCustomTheme(),
      setPrimary: (primary: string) => {
        set({ primary });
        settingsStorage.setPrimaryColor(primary);
      },
      setCustom: (isCustom: boolean) => {
        set({ isCustom });
        settingsStorage.setCustomTheme(isCustom);
      },
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
