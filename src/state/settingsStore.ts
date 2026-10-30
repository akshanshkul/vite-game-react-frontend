import { create } from "zustand";
import { defaultSettings, type Settings } from "../services/storage";
export const useSettings = create<{
  settings: Settings;
  setSettings: (value: Settings) => void;
}>((set) => ({
  settings: defaultSettings,
  setSettings: (settings) => set({ settings }),
}));
