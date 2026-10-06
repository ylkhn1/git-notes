import { create } from "zustand";

interface LightboxState {
  image: { notebookId: string; path: string } | null;
  hide: () => void;
}

export const useLightbox = create<LightboxState>((set) => ({
  image: null,
  hide: () => set({ image: null }),
}));

/** Shows a notebook image full-size. */
export function showImage(notebookId: string, path: string) {
  useLightbox.setState({ image: { notebookId, path } });
}
