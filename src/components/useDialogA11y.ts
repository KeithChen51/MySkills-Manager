import { useEffect, useRef, type RefObject } from "react";

type UseDialogA11yOptions = {
  open: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

type UseDialogA11yResult = {
  dialogRef: RefObject<HTMLElement | null>;
};

function findFirstFocusable(container: HTMLElement): HTMLElement | null {
  const candidates = container.querySelectorAll<HTMLElement>(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
  );
  return candidates[0] ?? null;
}

export default function useDialogA11y({
  open,
  onClose,
  initialFocusRef,
}: UseDialogA11yOptions): UseDialogA11yResult {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusTarget =
      initialFocusRef?.current ??
      (dialogRef.current ? findFirstFocusable(dialogRef.current) : null);

    if (focusTarget) {
      focusTarget.focus();
    } else {
      dialogRef.current?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [initialFocusRef, onClose, open]);

  return { dialogRef };
}
