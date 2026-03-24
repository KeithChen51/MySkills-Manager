import { memo, type ReactNode } from "react";

type EvalFloatingModalProps = {
  open: boolean;
  children: ReactNode;
};

function EvalFloatingModalBase({ open, children }: EvalFloatingModalProps) {
  if (!open) {
    return null;
  }
  return <>{children}</>;
}

const EvalFloatingModal = memo(EvalFloatingModalBase);

export default EvalFloatingModal;
