import React from "react";
import { ChevronDown, ChevronRight, RotateCcw, Trash2 } from "lucide-react";

import {
  canRestoreFieldToPrimary,
  isFieldDeletable,
  isFieldFromSecondary,
  isFieldManuallyEdited,
  type EditableHeaderField
} from "../lib/headerDraft";

interface HeaderTreeNode {
  id: string;
  name: string;
  label: string;
  xmlPath: string;
  children: HeaderTreeNode[];
  field: EditableHeaderField | null;
}

interface HeaderTreeProps {
  fields: EditableHeaderField[];
  filter: string;
  onFieldChange: (key: string, value: string) => void;
  onFieldRestore: (key: string) => void;
  onToggleFieldRemoved: (key: string, removed: boolean) => void;
  onToggleNodeRemoved: (xmlPath: string, removed: boolean) => void;
}

export function HeaderTree(props: HeaderTreeProps): React.JSX.Element {
  const tree = React.useMemo(() => buildHeaderTree(props.fields, props.filter), [props.fields, props.filter]);
  const forceOpen = props.filter.trim().length > 0;

  return (
    <div className="rounded-lg bg-card">
      <div className="space-y-1">
        {tree.children.map((node) => (
          <HeaderTreeNodeView
            key={node.id}
            node={node}
            depth={0}
            forceOpen={forceOpen}
            allFields={props.fields}
            onFieldChange={props.onFieldChange}
            onFieldRestore={props.onFieldRestore}
            onToggleFieldRemoved={props.onToggleFieldRemoved}
            onToggleNodeRemoved={props.onToggleNodeRemoved}
          />
        ))}
      </div>
    </div>
  );
}

function HeaderTreeNodeView(props: {
  node: HeaderTreeNode;
  depth: number;
  forceOpen: boolean;
  allFields: EditableHeaderField[];
  onFieldChange: (key: string, value: string) => void;
  onFieldRestore: (key: string) => void;
  onToggleFieldRemoved: (key: string, removed: boolean) => void;
  onToggleNodeRemoved: (xmlPath: string, removed: boolean) => void;
}): React.JSX.Element {
  const { node, depth, forceOpen, allFields, onFieldChange, onFieldRestore, onToggleFieldRemoved, onToggleNodeRemoved } = props;
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftValue, setDraftValue] = React.useState(node.field?.value ?? "");
  const descendantFields = React.useMemo(
    () => allFields.filter((field) => isPathWithinNode(field.xmlPath, node.xmlPath)),
    [allFields, node.xmlPath]
  );
  const nodeCanDelete = descendantFields.length > 0 && descendantFields.every(isFieldDeletable);
  const nodeRemoved = descendantFields.length > 0 && descendantFields.every((field) => field.isRemoved);

  React.useEffect(() => {
    setOpen(forceOpen);
  }, [forceOpen]);

  React.useEffect(() => {
    if (!node.field) return;
    setDraftValue(node.field.value);
  }, [node.field?.key, node.field?.value]);

  if (!hasChildren && node.field) {
    const commitEdit = (): void => {
      setIsEditing(false);
      if (draftValue !== node.field!.value) {
        onFieldChange(node.field!.key, draftValue);
      }
    };

    const fieldTextStyle: React.CSSProperties = {
      fontSize: "13px",
      lineHeight: "1.2",
      letterSpacing: "0"
    };
    const fieldRemoved = node.field.isRemoved;
    const fieldManual = isFieldManuallyEdited(node.field);
    const fieldSecondary = isFieldFromSecondary(node.field);
    const canDelete = isFieldDeletable(node.field);
    const canRestore = canRestoreFieldToPrimary(node.field);
    const labelClassName = fieldRemoved ? "truncate line-through text-[#505367]" : "truncate";
    const valueClassName = fieldRemoved
      ? "text-[#505367] line-through"
      : fieldManual
        ? "text-[#d8b36a]"
        : fieldSecondary
          ? "text-[#7ec3ff]"
          : "text-[#cfd3dd]";

    return (
      <div className="group rounded-md px-2 py-2 hover:bg-muted">
        <div className="grid gap-3 md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
          <div className="flex min-w-0 items-center" style={{ paddingLeft: `${depth * 20}px` }}>
            <div
              className="flex min-w-0 items-center gap-2 font-medium text-foreground"
              style={fieldTextStyle}
              title={node.field.xmlPath}
            >
              <span className={labelClassName}>{node.field.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isEditing ? (
              <input
                autoFocus
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                onBlur={commitEdit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitEdit();
                  } else if (event.key === "Escape") {
                    setDraftValue(node.field!.value);
                    setIsEditing(false);
                  }
                }}
                className="block w-full rounded-sm border border-[rgba(255,255,255,0.06)] bg-[#0a0d12] px-2 py-1 font-normal text-foreground outline-none focus:border-[rgba(255,255,255,0.12)]"
                style={fieldTextStyle}
              />
            ) : (
              <button
                type="button"
                className="block w-full rounded-sm px-2 py-1 text-left font-normal hover:bg-[rgba(255,255,255,0.03)]"
                style={fieldTextStyle}
                onClick={() => {
                  if (!fieldRemoved) {
                    setIsEditing(true);
                  }
                }}
                title="Click to edit"
              >
                <span className={`truncate ${valueClassName}`}>{node.field.value || " "}</span>
              </button>
            )}
            {canRestore ? (
              <button
                type="button"
                className="rounded-sm p-1 text-[#8b8fa3] hover:bg-[rgba(255,255,255,0.03)] hover:text-foreground"
                title="Restore to primary value"
                onClick={() => onFieldRestore(node.field!.key)}
              >
                <RotateCcw className="size-3.5" />
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className={`rounded-sm p-1 hover:bg-[rgba(255,255,255,0.03)] ${fieldRemoved ? "text-[#d8b36a]" : "text-[#8b8fa3] hover:text-foreground"}`}
                title={fieldRemoved ? "Restore field" : "Remove field"}
                onClick={() => onToggleFieldRemoved(node.field!.key, !fieldRemoved)}
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md">
      <div className="flex h-[30px] items-center justify-between gap-3 rounded-md px-2 hover:bg-muted">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((current) => !current)}
        >
          <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * 20}px` }}>
            {open ? <ChevronDown className="size-4 text-[#505367]" /> : <ChevronRight className="size-4 text-[#505367]" />}
            <span className={`truncate text-[13px] ${nodeRemoved ? "text-[#505367] line-through" : "text-foreground"}`}>{node.label}</span>
          </div>
        </button>
        <div className="flex items-center gap-1">
          {nodeCanDelete ? (
            <button
              type="button"
              className={`rounded-sm p-1 hover:bg-[rgba(255,255,255,0.03)] ${nodeRemoved ? "text-[#d8b36a]" : "text-[#8b8fa3] hover:text-foreground"}`}
              title={nodeRemoved ? "Restore section" : "Remove section"}
              onClick={(event) => {
                event.stopPropagation();
                onToggleNodeRemoved(node.xmlPath, !nodeRemoved);
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
          <span className="min-w-6 text-right text-[11px] tabular-nums text-[#505367]">{node.children.length}</span>
        </div>
      </div>
      {open ? (
        <div className="space-y-1">
          {node.children.map((child) => (
            <HeaderTreeNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              forceOpen={forceOpen}
              allFields={allFields}
              onFieldChange={onFieldChange}
              onFieldRestore={onFieldRestore}
              onToggleFieldRemoved={onToggleFieldRemoved}
              onToggleNodeRemoved={onToggleNodeRemoved}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildHeaderTree(fields: EditableHeaderField[], filter: string): HeaderTreeNode {
  const root: HeaderTreeNode = {
    id: "root",
    name: "root",
    label: "root",
    xmlPath: "",
    children: [],
    field: null
  };

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredFields = normalizedFilter
    ? fields.filter((field) =>
        [field.label, field.xmlPath, field.value, field.source].some((value) =>
          value.toLowerCase().includes(normalizedFilter)
        )
      )
    : fields;

  for (const field of filteredFields) {
    const segments = field.xmlPath.split("/");
    let current = root;

    for (const segment of segments) {
      const parsed = parseXmlPathSegment(segment);
      const nodeId = current.id === "root" ? segment : `${current.id}/${segment}`;
      let child = current.children.find((entry) => entry.id === nodeId);
      if (!child) {
        child = {
          id: nodeId,
          name: parsed.name,
          label: parsed.label,
          xmlPath: current.xmlPath ? `${current.xmlPath}/${segment}` : segment,
          children: [],
          field: null
        };
        current.children.push(child);
      }
      current = child;
    }

    current.field = field;
  }

  sortTree(root);
  return root;
}

function sortTree(node: HeaderTreeNode): void {
  node.children.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
  for (const child of node.children) sortTree(child);
}

function parseXmlPathSegment(segment: string): { name: string; label: string } {
  const match = /^(.+)\[(\d+)\]$/.exec(segment);
  const name = match ? match[1] : segment;
  const index = match ? Number.parseInt(match[2], 10) : 0;
  const pretty = name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return {
    name,
    label: match ? `${pretty} ${index + 1}` : pretty
  };
}

export function isPathWithinNode(fieldPath: string, nodePath: string): boolean {
  return fieldPath === nodePath || fieldPath.startsWith(`${nodePath}/`);
}
