import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n";
import { Button } from "@/ui/button";

import { ViewMenu } from "@/features/settings/ViewMenu";

interface TitleBarProps {
  title: string;
  subtitle?: string;
}

/** Custom title bar (`decorations: false`): drag region, document title, window controls. */
export function TitleBar({ title, subtitle }: TitleBarProps) {
  const t = useT();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface pr-1 pl-3 text-sm select-none"
    >
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
        <span data-tauri-drag-region className="truncate font-medium">
          {title}
        </span>
        {subtitle && (
          <span data-tauri-drag-region className="truncate text-muted-text">
            {subtitle}
          </span>
        )}
      </div>
      <ViewMenu />
      <div className="ml-1 flex items-center">
        <WindowButton
          label={t("shell.minimize")}
          onClick={() => void getCurrentWindow().minimize()}
        >
          <Minus />
        </WindowButton>
        <WindowButton
          label={maximized ? t("shell.restore") : t("shell.maximize")}
          onClick={() => void getCurrentWindow().toggleMaximize()}
        >
          <Square className="size-3" />
        </WindowButton>
        <WindowButton
          label={t("shell.close")}
          onClick={() => void getCurrentWindow().close()}
          danger
        >
          <X />
        </WindowButton>
      </div>
    </header>
  );
}

function WindowButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={onClick}
      className={danger ? "hover:bg-danger hover:text-white" : undefined}
    >
      {children}
    </Button>
  );
}
