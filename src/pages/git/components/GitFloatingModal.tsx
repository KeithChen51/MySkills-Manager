import { memo, type ReactNode } from "react";

type GitFloatingModalProps = {
  open: boolean;
  children: ReactNode;
};

function GitFloatingModalBase({ open, children }: GitFloatingModalProps) {
  if (!open) {
    return null;
  }
  return <>{children}</>;
}

const GitFloatingModal = memo(GitFloatingModalBase);

export default GitFloatingModal;
