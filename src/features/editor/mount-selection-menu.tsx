import { createRoot } from "react-dom/client";

import type { MountMenu } from "./cm/selection-menu";
import { SelectionMenu } from "./SelectionMenu";

/** Mounts {@link SelectionMenu} into a CodeMirror tooltip. */
export const mountSelectionMenu: MountMenu = (dom, view) => {
  const root = createRoot(dom);
  root.render(<SelectionMenu view={view} />);
  return () => {
    // Unmounting synchronously inside a React render (CodeMirror updates run during
    // dispatch) logs a warning; defer it.
    queueMicrotask(() => {
      root.unmount();
    });
  };
};
