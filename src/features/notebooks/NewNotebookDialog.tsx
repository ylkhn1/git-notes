import { useId, useState } from "react";

import { errorMessage } from "@/lib/result";
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

import { useNotebooksStore } from "./store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewNotebookDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <NewNotebookForm onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so its state resets on every opening. */
function NewNotebookForm({ onClose }: { onClose: () => void }) {
  const defaultDir = useNotebooksStore((s) => s.defaultDir);
  const [name, setName] = useState("Notes");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    if (/[/\\]/.test(trimmed)) {
      setError("Name cannot contain slashes");
      return;
    }
    setBusy(true);
    try {
      await useNotebooksStore.getState().createNew(trimmed);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sep = defaultDir.includes("\\") ? "\\" : "/";

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>New notebook</DialogTitle>
        <DialogDescription>A notebook is a folder of Markdown files.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-xs font-medium text-muted-text">
          Name
        </label>
        <Input
          id={id}
          value={name}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
        />
        <p
          className="truncate font-mono text-xs text-faint"
          title={`${defaultDir}${sep}${name.trim()}`}
        >
          {defaultDir}
          {sep}
          {name.trim() || "…"}
        </p>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}
