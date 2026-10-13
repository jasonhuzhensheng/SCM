import { useEffect, useRef } from "react";
import { IconEye, IconTrash } from "@tabler/icons-react";

export function AssetContextMenu({ x, y, filesLocked = false, disabled, onDelete, onSimilar, onPreview, onClose }: { filesLocked?: boolean; x: number; y: number; disabled: boolean; onDelete: (original: boolean) => void; onSimilar?: () => void; onPreview: () => void; onClose: () => void }) {
 const ref = useRef<HTMLDivElement>(null);
 useEffect(() => {
  const previous = document.activeElement as HTMLElement | null;
  ref.current?.focus();
  const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
  const dismiss = () => onClose();
  document.addEventListener("pointerdown", outside);
  window.addEventListener("blur", dismiss);
  window.addEventListener("resize", dismiss);
  window.addEventListener("scroll", dismiss, true);
  return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("blur", dismiss); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); previous?.focus({ preventScroll: true }); };
 }, [onClose]);
 return <div ref={ref} role="menu" aria-label="素材操作" tabIndex={-1} className="asset-context-menu" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 256)), top: Math.max(8, Math.min(y, window.innerHeight - (onSimilar ? 206 : 158))) }} onContextMenu={event => event.preventDefault()} onKeyDown={event => { if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); onClose(); } if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []); const at = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } }}><button role="menuitem" className="context-preview" onClick={onPreview}><IconEye size={17} />预览</button>{onSimilar && <button role="menuitem" className="context-preview" disabled={disabled} onClick={onSimilar}>查找相似照片</button>}<button role="menuitem" className="delete-action" disabled={disabled || filesLocked} onClick={() => onDelete(true)}><IconTrash size={17} />删除原文件及素材…</button><button role="menuitem" className="delete-action" disabled={disabled || filesLocked} onClick={() => onDelete(false)}><IconTrash size={17} />仅删除素材库副本…</button></div>;
}
