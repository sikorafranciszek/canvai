/** Globalny stan UI poza stronami (dialog tworzenia tablicy, panel boczny edytora). */
import { create } from 'zustand'

interface UiState {
  sidePanelOpen: boolean
  toggleSidePanel: () => void
  createBoardOpen: boolean
  openCreateBoard: () => void
  closeCreateBoard: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  sidePanelOpen: true,
  toggleSidePanel: () => set((s) => ({ sidePanelOpen: !s.sidePanelOpen })),
  createBoardOpen: false,
  openCreateBoard: () => set({ createBoardOpen: true }),
  closeCreateBoard: () => set({ createBoardOpen: false }),
}))
