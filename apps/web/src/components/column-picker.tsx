"use client";

import { useMemo, useState } from "react";
import { Columns3, GripVertical, RotateCcw } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ColumnPickerItem {
  id: string;
  label: string;
  /** Optional grouping shown in "Available" section. */
  group?: string;
}

interface ColumnPickerProps {
  /** Every column the page knows about — registry values in a stable order. */
  allColumns: ColumnPickerItem[];
  /** Currently visible ids, in display order. */
  order: string[];
  /** When true the Reset affordance is shown; callers own the "is this the default?" comparison. */
  canReset: boolean;
  onChange: (nextOrder: string[]) => void;
  onReset: () => void;
  /** Shown as the trigger button label. */
  triggerLabel?: string;
}

export function ColumnPicker({
  allColumns,
  order,
  canReset,
  onChange,
  onReset,
  triggerLabel = "Columns",
}: ColumnPickerProps) {
  const [open, setOpen] = useState(false);

  const { visible, hiddenByGroup } = useMemo(() => {
    const visibleIds = new Set(order);
    const visible = order
      .map((id) => allColumns.find((c) => c.id === id))
      .filter((c): c is ColumnPickerItem => !!c);
    const hidden = allColumns.filter((c) => !visibleIds.has(c.id));
    const groups = new Map<string, ColumnPickerItem[]>();
    for (const h of hidden) {
      const g = h.group ?? "Available";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(h);
    }
    return { visible, hiddenByGroup: [...groups.entries()] };
  }, [allColumns, order]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function toggleVisibility(id: string) {
    if (order.includes(id)) {
      onChange(order.filter((o) => o !== id));
    } else {
      onChange([...order, id]);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(order, oldIndex, newIndex));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          <Columns3 className="h-3.5 w-3.5 mr-1.5" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-xs font-medium">Columns</span>
          {canReset && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onReset}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {visible.length === 0 ? (
                <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                  No columns shown. Enable some below.
                </div>
              ) : (
                visible.map((col) => (
                  <SortableRow
                    key={col.id}
                    id={col.id}
                    label={col.label}
                    group={col.group}
                    checked
                    onToggle={() => toggleVisibility(col.id)}
                  />
                ))
              )}
            </SortableContext>
          </DndContext>

          {hiddenByGroup.length > 0 && (
            <div className="mt-2 pt-2 border-t border-dashed border-border/60">
              {hiddenByGroup.map(([groupName, items]) => (
                <div key={groupName} className="pt-1">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                    {groupName}
                  </div>
                  {items.map((col) => (
                    <StaticRow
                      key={col.id}
                      label={col.label}
                      checked={false}
                      onToggle={() => toggleVisibility(col.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface SortableRowProps {
  id: string;
  label: string;
  group?: string;
  checked: boolean;
  onToggle: () => void;
}

function SortableRow({ id, label, group, checked, onToggle }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-accent/60 group"
    >
      <button
        type="button"
        className="flex h-6 w-4 items-center justify-center text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="h-3.5 w-3.5"
      />
      <span className="flex-1 text-xs truncate">{label}</span>
      {group && (
        <span className="text-[10px] text-muted-foreground/70">{group}</span>
      )}
    </div>
  );
}

interface StaticRowProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
}

function StaticRow({ label, checked, onToggle }: StaticRowProps) {
  return (
    <div className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-accent/60">
      <div className="flex h-6 w-4 items-center justify-center text-muted-foreground/20">
        <GripVertical className="h-3.5 w-3.5" />
      </div>
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="h-3.5 w-3.5"
      />
      <span className="flex-1 text-xs text-muted-foreground truncate">{label}</span>
    </div>
  );
}
