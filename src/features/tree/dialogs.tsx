import { useId, useState } from "react";

import { t, useT } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";
import { errorMessage } from "@/lib/result";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";

export interface NameDialogProps {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  submitLabel?: string;
  /** Reject invalid names with a message; return null to accept. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

/**
 * Single text field dialog used for new note / new folder / rename.
 * Form state lives in the inner component, which Radix unmounts on close, so every
 * opening starts fresh without effects.
 */
export function NameDialog({ open, onOpenChange, ...form }: NameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <NameForm {...form} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NameForm({
  title,
  description,
  label,
  initialValue = "",
  submitLabel,
  validate,
  onSubmit,
  onClose,
}: Omit<NameDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  useT();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  const submit = async () => {
    const trimmed = value.trim();
    const problem = trimmed ? (validate?.(trimmed) ?? null) : t("tree.nameRequired");
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="contents"
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="text-xs font-medium text-muted-text">
          {label}
        </label>
        <Input
          id={inputId}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          autoFocus
          onFocus={(e) => {
            // Select the stem so typing replaces the name but keeps the extension.
            const dot = e.target.value.lastIndexOf(".");
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        {error && (
          <p id={`${inputId}-error`} role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {submitLabel ?? t("common.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export interface ConfirmDeleteProps {
  open: boolean;
  path: string | null;
  isDir: boolean;
  onConfirm: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmDeleteDialog({
  open,
  path,
  isDir,
  onConfirm,
  onOpenChange,
}: ConfirmDeleteProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <DeleteBody
          path={path}
          isDir={isDir}
          onConfirm={onConfirm}
          onClose={() => onOpenChange(false)}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteBody({
  path,
  isDir,
  onConfirm,
  onClose,
}: {
  path: string | null;
  isDir: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  useT();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {isDir ? t("tree.deleteFolderTitle") : t("tree.deleteNoteTitle")}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {rich(
            isDir ? "tree.deleteFolderDescription" : "tree.deleteNoteDescription",
            { b: (text) => <span className="font-medium text-text">{text}</span> },
            { path: path ?? "" },
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          onClick={(e) => {
            e.preventDefault();
            setError(null);
            onConfirm()
              .then(onClose)
              .catch((err: unknown) => {
                setError(errorMessage(err));
              });
          }}
        >
          {t("common.delete")}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

export interface MoveDialogProps {
  open: boolean;
  path: string | null;
  folders: string[];
  onMove: (toDir: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

/** Picks a destination folder; HTML5 drag-and-drop is unreliable inside Tauri webviews. */
export function MoveDialog({ open, onOpenChange, ...rest }: MoveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <MoveBody {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function MoveBody({
  path,
  folders,
  onMove,
  onClose,
}: Omit<MoveDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  useT();
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const options = [
    "",
    ...folders.filter((f) => path === null || (f !== path && !f.startsWith(`${path}/`))),
  ];
  const move = (dir: string) => {
    onMove(dir)
      .then(onClose)
      .catch((err: unknown) => {
        setError(errorMessage(err));
      });
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("tree.moveTitle", { path: path ?? "" })}</DialogTitle>
        <DialogDescription>{t("tree.moveDescription")}</DialogDescription>
      </DialogHeader>
      <div
        role="radiogroup"
        aria-label={t("tree.destinationFolder")}
        className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-line p-1"
      >
        {options.map((folder) => (
          <button
            key={folder || "/"}
            type="button"
            role="radio"
            aria-checked={target === folder}
            onClick={() => setTarget(folder)}
            onDoubleClick={() => move(folder)}
            className={`flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm ${
              target === folder ? "bg-accent-soft text-text" : "hover:bg-surface-2"
            }`}
          >
            {folder || t("tree.notebookRoot")}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => move(target)}>{t("tree.move")}</Button>
      </DialogFooter>
    </>
  );
}
