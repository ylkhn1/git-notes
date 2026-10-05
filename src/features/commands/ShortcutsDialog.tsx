import { useBackClose } from "@/lib/back-stack";
import { useT } from "@/lib/i18n";
import { formatShortcut } from "@/lib/shortcuts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";

import { useUiStore } from "@/features/shell/ui-store";

import { commandGroupLabel, editorShortcuts, groupOrder, listCommands } from "./registry";

/** Every shortcut the app understands, from the command registry plus the editor keymap. */
export function ShortcutsDialog() {
  const open = useUiStore((s) => s.dialog === "shortcuts");
  const close = useUiStore((s) => s.closeDialog);
  const t = useT();
  useBackClose(open, close);

  const groups = new Map<string, { title: string; shortcut: string }[]>();
  for (const c of listCommands().sort((a, b) => groupOrder(a.group) - groupOrder(b.group))) {
    if (!c.shortcut) continue;
    const group = commandGroupLabel(c.group);
    const list = groups.get(group) ?? [];
    list.push({ title: c.title, shortcut: c.shortcut });
    groups.set(group, list);
  }
  groups.set(t("shortcuts.editorGroup"), editorShortcuts());

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-line px-6 py-4">
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>
            {t("shortcuts.description", { shortcut: formatShortcut("Mod+K") })}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <dl className="space-y-5">
            {Array.from(groups.entries()).map(([group, items]) => (
              <div key={group}>
                <dt className="mb-1.5 text-2xs font-medium tracking-wide text-faint uppercase">
                  {group}
                </dt>
                {items.map((item) => (
                  <dd key={item.title} className="flex items-center justify-between gap-4 py-1">
                    <span className="text-sm">{item.title}</span>
                    <kbd className="shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-xs text-muted-text">
                      {item.shortcut.includes(" / ")
                        ? item.shortcut
                            .split(" / ")
                            .map((s) => formatShortcut(s))
                            .join(" / ")
                        : formatShortcut(item.shortcut)}
                    </kbd>
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </div>
      </DialogContent>
    </Dialog>
  );
}
