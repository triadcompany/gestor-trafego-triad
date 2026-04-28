import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, X } from "lucide-react";
import type { ClientRow } from "@/lib/queries";

interface NoteComposerProps {
  clients: ClientRow[];
  fixedClientId?: string; // when used inside a client profile
  onSave: (payload: { client_id: string; content: string }) => Promise<void>;
  onCancel: () => void;
}

export function NoteComposer({ clients, fixedClientId, onSave, onCancel }: NoteComposerProps) {
  const [clientId, setClientId] = useState(fixedClientId ?? "");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!clientId || !content.trim()) return;
    setSaving(true);
    try {
      await onSave({ client_id: clientId, content: content.trim() });
      setContent("");
      if (!fixedClientId) setClientId("");
    } finally {
      setSaving(false);
    }
  }

  const fixedClient = fixedClientId ? clients.find((c) => c.id === fixedClientId) : undefined;

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      {fixedClient ? (
        <p className="text-xs text-muted-foreground font-mono">
          Anotação para <span className="text-foreground font-semibold">{fixedClient.name}</span>
        </p>
      ) : (
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="w-full text-sm">
            <SelectValue placeholder="Selecionar cliente..." />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Textarea
        placeholder="Escreva a anotação..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="text-sm min-h-[80px] font-sans"
        autoFocus
      />

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5 mr-1" /> Cancelar
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !clientId || !content.trim()}>
          <Check className="h-3.5 w-3.5 mr-1" /> Salvar
        </Button>
      </div>
    </div>
  );
}
