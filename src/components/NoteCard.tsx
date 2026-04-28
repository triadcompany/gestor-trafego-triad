import { useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { clientColor } from "@/lib/client-colors";
import type { NoteWithClient } from "@/lib/queries";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "agora" : `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

interface NoteCardProps {
  note: NoteWithClient;
  onUpdate: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => void;
}

export function NoteCard({ note, onUpdate, onDelete }: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const color = clientColor(note.client_id);

  async function handleSave() {
    if (!draft.trim() || draft === note.content) {
      setEditing(false);
      setDraft(note.content);
      return;
    }
    setSaving(true);
    try {
      await onUpdate(note.id, draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(note.content);
    setEditing(false);
  }

  function handleDelete() {
    if (window.confirm("Deletar esta anotação?")) onDelete(note.id);
  }

  return (
    <div
      className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2"
      style={{ borderLeft: `3px solid ${color.border}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded ${color.badgeBg} ${color.badgeText}`}>
          {note.client_name.toUpperCase()}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-muted-foreground">{relativeTime(note.created_at)}</span>
          {!editing && (
            <>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(true)}>
                <Pencil className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={handleDelete}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="text-sm min-h-[80px] font-sans"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saving}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancelar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !draft.trim()}>
              <Check className="h-3.5 w-3.5 mr-1" /> Salvar
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{note.content}</p>
      )}
    </div>
  );
}
