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
  // Na telefonie panel jest arkuszem od dołu — startuje zamknięty, płótno widać całe (UX-12).
  sidePanelOpen: !(
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches
  ),
  toggleSidePanel: () => set((s) => ({ sidePanelOpen: !s.sidePanelOpen })),
  createBoardOpen: false,
  openCreateBoard: () => set({ createBoardOpen: true }),
  closeCreateBoard: () => set({ createBoardOpen: false }),
}))
