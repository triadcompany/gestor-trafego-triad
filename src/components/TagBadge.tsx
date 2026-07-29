import type { TagRow } from "@/lib/queries";

export const TAG_COLORS: { value: string; label: string; bg: string; text: string; ring: string }[] = [
  { value: "blue",   label: "Azul",    bg: "bg-blue-100 dark:bg-blue-500/15",     text: "text-blue-700 dark:text-blue-400",     ring: "ring-blue-500/30" },
  { value: "green",  label: "Verde",   bg: "bg-green-100 dark:bg-green-500/15",   text: "text-green-700 dark:text-green-400",   ring: "ring-green-500/30" },
  { value: "red",    label: "Vermelho",bg: "bg-red-100 dark:bg-red-500/15",       text: "text-red-700 dark:text-red-400",       ring: "ring-red-500/30" },
  { value: "yellow", label: "Amarelo", bg: "bg-yellow-100 dark:bg-yellow-500/15", text: "text-yellow-800 dark:text-yellow-400", ring: "ring-yellow-500/30" },
  { value: "purple", label: "Roxo",   bg: "bg-purple-100 dark:bg-purple-500/15",  text: "text-purple-700 dark:text-purple-400", ring: "ring-purple-500/30" },
  { value: "orange", label: "Laranja", bg: "bg-orange-100 dark:bg-orange-500/15", text: "text-orange-700 dark:text-orange-400", ring: "ring-orange-500/30" },
  { value: "pink",   label: "Rosa",    bg: "bg-pink-100 dark:bg-pink-500/15",     text: "text-pink-700 dark:text-pink-400",     ring: "ring-pink-500/30" },
  { value: "teal",   label: "Teal",    bg: "bg-teal-100 dark:bg-teal-500/15",     text: "text-teal-700 dark:text-teal-400",     ring: "ring-teal-500/30" },
];

function getColorClasses(color: string) {
  return TAG_COLORS.find((c) => c.value === color) ?? TAG_COLORS[0];
}

export function TagBadge({ tag }: { tag: TagRow }) {
  const { bg, text, ring } = getColorClasses(tag.color);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${bg} ${text} ${ring}`}
    >
      {tag.name}
    </span>
  );
}
